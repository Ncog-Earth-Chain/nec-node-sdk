/**
 * DB-01 transactions (NEC-77): the transaction id and member hashes, byte for byte as the node computes
 * them, plus the ddb_submitSignedTransaction envelope and the retry loop.
 *
 * The vector constants are the node's, copied verbatim from ncogearthchain gossip/ddb/txn_vectors_test.go
 * (TestTransactionVectors; fixture vectorOpV2, network 0x9af). None is recomputed from src/ddb.ts. If one of
 * these fails, this SDK signs a transaction the chain refuses with "caller signature verification failed".
 */
import {
  Ddb,
  DdbCanonicalOpV2,
  buildDdbTransaction,
  canonicalDdbOperationHashV2,
  canonicalDdbTxnId,
  canonicalDdbTxnMemberHash,
  isRetryableDdbTxnSkip,
} from '../src/ddb';

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
const utf8 = (s: string) => new TextEncoder().encode(s);

const VECTOR_TXN_ID = '0x2d60f920ef99eb573789abcbed3b96674d200687f1aefde585940218d54287d2';
const VECTOR_MEMBER_HASHES = [
  '0x14d98987eb55726f24967b7cfb481c123c80daa4d82d956d5724f273210bdcf6',
  '0xd275a3170d14e08b39538d79b2b5e8488d1c0f1e8f6e3cb3a94e47e1c9a27f58',
];

// vectorOpV2 (the v2 preimage fixture) for InsertData (4) and UpdateData (5).
const fixOp = (type: number): DdbCanonicalOpV2 => ({
  type,
  chainId: 0x9af,
  schemaName: 'nec_vector_contract',
  data: utf8('{"contract_address":"0x00000000000000000000000000000000000000C0","k":"v"}'),
  from: '0x00000000000000000000000000000000000000a1',
  timestamp: 1700000000,
  gasLimit: 250000,
  nonce: 7,
  expiry: 1700000600,
  keyVersion: 3,
});
const VECTOR_READS = [{ table: 'accounts', pk: ['alice', null] }, {}];

async function deterministicKey() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 7 + 3) & 0xff;
  const kp = mldsa.keygen(seed);
  return { skHex: Buffer.from(kp.secretKey).toString('hex'), pub: kp.publicKey as Uint8Array, mldsa };
}

describe('DB-01 transaction vectors (Go == SDK)', () => {
  it('reproduces the node transaction id and each member signed hash', () => {
    const ops = [fixOp(4), fixOp(5)];
    const id = canonicalDdbTxnId(ops, 41, VECTOR_READS);
    expect(hex(id)).toBe(VECTOR_TXN_ID);
    ops.forEach((op, i) => expect(hex(canonicalDdbTxnMemberHash(op, id, i, ops.length))).toBe(VECTOR_MEMBER_HASHES[i]));
  });

  it('binds every member, the read version and the read set into the id', () => {
    const base = hex(canonicalDdbTxnId([fixOp(4), fixOp(5)], 41, VECTOR_READS));
    expect(hex(canonicalDdbTxnId([fixOp(5), fixOp(4)], 41, VECTOR_READS))).not.toBe(base); // reordered
    expect(hex(canonicalDdbTxnId([fixOp(4)], 41, VECTOR_READS))).not.toBe(base); // trimmed
    expect(hex(canonicalDdbTxnId([fixOp(4), fixOp(5)], 42, VECTOR_READS))).not.toBe(base); // read version
    expect(hex(canonicalDdbTxnId([fixOp(4), fixOp(5)], 41, [{ table: 'accounts', pk: ['alice', ''] }, {}]))).not.toBe(base); // NULL vs ''
    // A member hash is never the plain operation hash: the header is inside the signed preimage.
    const id = canonicalDdbTxnId([fixOp(4), fixOp(5)], 41, VECTOR_READS);
    expect(hex(canonicalDdbTxnMemberHash(fixOp(4), id, 0, 2))).not.toBe(hex(canonicalDdbOperationHashV2(fixOp(4))));
  });

  it('refuses the shapes the node refuses', () => {
    expect(() => canonicalDdbTxnId([], 0, [])).toThrow(/1\.\.4 operations/);
    expect(() => canonicalDdbTxnId([1, 2, 3, 4, 5].map(() => fixOp(4)), 0, [])).toThrow(/1\.\.4 operations/);
    expect(() => canonicalDdbTxnId([fixOp(4)], 0, Array.from({ length: 17 }, () => ({})))).toThrow(/at most 16/);
    expect(() => canonicalDdbTxnId([fixOp(4)], 0, [{ pk: ['x'] }])).toThrow(/no table/);
    expect(() => canonicalDdbTxnId([fixOp(4)], 0, [{ table: 't' }])).toThrow(/no key values/);
  });
});

describe('buildDdbTransaction / ddb_submitSignedTransaction', () => {
  const schema = 'c_0000000000000000000000000000000000abcdef';
  const transfer = [
    { typeName: 'callprocedure' as const, schemaName: schema, data: { procedure: 'debit', args: ['alice', '10'] } },
    { typeName: 'callprocedure' as const, schemaName: schema, data: { procedure: 'credit', args: ['bob', '10'] } },
  ];

  it('stamps every member, carries the read set on member 0 only, and signs what the node verifies', async () => {
    const { skHex, pub, mldsa } = await deterministicKey();
    const sent: any[] = [];
    const provider: any = {
      send: (method: string, params: any[]) => {
        sent.push({ method, params });
        return Promise.resolve(method === 'eth_chainId' ? '0x9af' : '0xcommit');
      },
    };
    const ddb = new Ddb(provider, { opPreimageVersion: 2 });
    const r = await ddb.submitTransactionSigned(skHex, transfer, {
      timestamp: 1700000000, readVersion: '0x29', reads: [{ table: 'accounts', pk: ['alice'] }, { table: 'accounts', pk: ['bob'] }],
    });
    expect(r.commitTxHash).toBe('0xcommit');
    const submit = sent.find((s) => s.method === 'ddb_submitSignedTransaction');
    expect(submit).toBeDefined();
    const envs = submit.params[0];
    expect(envs).toHaveLength(2);
    expect(envs[0].txn).toEqual({
      id: r.id, index: 0, count: 2, read_version: 41,
      reads: [{ table: 'accounts', pk: [{ String: 'alice', Valid: true }] }, { table: 'accounts', pk: [{ String: 'bob', Valid: true }] }],
    });
    expect(envs[1].txn).toEqual({ id: r.id, index: 1, count: 2 });
    for (const e of envs) {
      expect(e.expiry).toBeDefined(); // v2 envelope
      expect(e.from).toBe(envs[0].from);
      expect(e.nonce).not.toBe(envs[1 - envs.indexOf(e)].nonce); // one fresh nonce per member
    }
    // Each signature verifies over the member hash recomputed from the envelope's own fields.
    const ops: DdbCanonicalOpV2[] = envs.map((e: any) => ({
      type: 7, chainId: 0x9af, schemaName: e.schemaName, data: Buffer.from(e.data.slice(2), 'hex'), from: e.from,
      timestamp: BigInt(e.timestamp), gasLimit: BigInt(e.gasLimit), nonce: BigInt(e.nonce),
      expiry: BigInt(e.expiry), keyVersion: BigInt(e.keyVersion),
    }));
    const id = canonicalDdbTxnId(ops, 41, [{ table: 'accounts', pk: ['alice'] }, { table: 'accounts', pk: ['bob'] }]);
    expect(hex(id)).toBe(r.id);
    envs.forEach((e: any, i: number) => {
      const h = canonicalDdbTxnMemberHash(ops[i], id, i, 2);
      expect(hex(h)).toBe(r.operationHashes[i]);
      expect(mldsa.verify(pub, h, Buffer.from(e.callerSig.slice(2), 'hex'))).toBe(true);
    });
  });

  it('refuses two databases and a v1 network before any round', async () => {
    const { skHex, pub } = await deterministicKey();
    expect(() => buildDdbTransaction(
      [transfer[0], { ...transfer[1], schemaName: 'c_00000000000000000000000000000000000000ff' }],
      '0x00000000000000000000000000000000000000a1', pub, { chainId: 0x9af },
    )).toThrow(/ONE database/);
    const provider: any = { send: () => Promise.resolve('0x') };
    await expect(new Ddb(provider, { opPreimageVersion: 1 }).submitTransactionSigned(skHex, transfer))
      .rejects.toThrow(/preimage v2/);
  });

  it('retries a retryable conflict with a fresh read, and stops on any other skip', async () => {
    const { skHex } = await deterministicKey();
    const verdicts = ['txn_read_conflict', 'applied'];
    const provider: any = {
      send: (method: string) => {
        if (method === 'eth_chainId') return Promise.resolve('0x9af');
        if (method === 'ddb_submitSignedTransaction') return Promise.resolve('0xcommit');
        if (method === 'ddb_getCommitStatus') {
          const v = verdicts[0];
          if (v === 'applied') return Promise.resolve({ txHash: '0xcommit', status: 'applied', blockNumber: '0x2c', durable: true, readToken: '0x2c' });
          return Promise.resolve({ txHash: '0xcommit', status: 'skipped', reason: v });
        }
        return Promise.resolve(null);
      },
    };
    const ddb = new Ddb(provider, { opPreimageVersion: 2 });
    const reads: number[] = [];
    const out = await ddb.runTransaction(skHex, async (n) => {
      reads.push(n);
      if (n === 2) verdicts.shift();
      return { members: transfer, readVersion: 40 + n, reads: [{ table: 'accounts', pk: ['alice'] }] };
    }, { intervalMs: 1, timeoutMs: 200 });
    expect(out.attempts).toBe(2);
    expect(out.readToken).toBe('0x2c');
    expect(reads).toEqual([1, 2]);

    verdicts.splice(0, verdicts.length, 'unpayable_gas');
    await expect(ddb.runTransaction(skHex, async () => ({ members: transfer }), { intervalMs: 1, timeoutMs: 200 }))
      .rejects.toThrow(/SKIPPED/);
  });

  it('classifies skip reasons as the node does (IsRetryableTxnSkip)', () => {
    for (const r of ['txn_read_conflict', 'txn_read_too_old', 'row_lock_lost', 'state_chain_break']) expect(isRetryableDdbTxnSkip(r)).toBe(true);
    for (const r of ['txn_read_ahead', 'unpayable_gas', 'replay', undefined]) expect(isRetryableDdbTxnSkip(r)).toBe(false);
  });
});
