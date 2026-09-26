/**
 * The signed-read preimage (ddb_signedSelect), and the read helpers that use it.
 *
 * Same failure mode as the operation preimage (see ddb-preimage.test.ts): an ML-DSA-87 signature
 * over the WRONG bytes is a perfectly valid signature, and the node only says "caller signature
 * verification failed". So the SDK's encoder is checked against the node's OWN pinned constants,
 * copied verbatim from ncogearthchain/ethapi/ddb_signed_read_test.go TestSignedReadHashGoldenVector,
 * which in turn pins ethapi.SignedReadHash:
 *
 *   "NEC-DDB-READ\x02"                    13 bytes, domain + version
 *   chainID                               32 bytes, big-endian, left-padded (a uint256 word)
 *   u64be(len(schemaName)) || schemaName
 *   u64be(len(tableName))  || tableName
 *   u64be(len(joinTables))                 the COUNT of join tables
 *     u64be(len(joinTables[i])) || joinTables[i]   each, in sorted order
 *   from                                  20 bytes
 *   u64be(timestamp)
 *   u64be(nonce)
 *   SignedReadHash = keccak256(all of it)
 *
 * Nothing here is computed by the SDK's encoder and then compared with itself.
 */
import {
  Ddb, buildDdbSignedRead, canonicalDdbSignedReadBytes, canonicalDdbSignedReadHash, privateKeyDdbSigner,
} from '../src/ddb';

// From TestSignedReadHashGoldenVector -- the node's constants, not ours.
const CHAIN_ID = 2479;
const FROM = '0x000000000000000000000000000000000000abcd';
const SCHEMA = 'c_users';
const TABLE = 'orders';
const TS = 1234567890;
const NONCE = BigInt('0x0102030405060708');
const WANT_PREIMAGE = '4e45432d4444422d524541440200000000000000000000000000000000000000000000000000000000000009af0000000000000007635f757365727300000000000000066f72646572730000000000000000000000000000000000000000000000000000abcd00000000499602d20102030405060708';
const WANT_HASH = 'd00b850c039d2db66619087d1f444cde5fef6d937447a1e8e872d5c8f3b99971';
const WANT_JOINED_PREIMAGE = '4e45432d4444422d524541440200000000000000000000000000000000000000000000000000000000000009af0000000000000007635f757365727300000000000000066f7264657273000000000000000100000000000000056974656d73000000000000000000000000000000000000abcd00000000499602d20102030405060708';
const WANT_JOINED_HASH = '7f534b9038d673b28753639156957d2bb76f85fd28d6c34a5d94e76d67441a37';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

async function mldsa() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  return (noblePQ.default || noblePQ).ml_dsa87;
}

async function deterministicKey() {
  const m = await mldsa();
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 7 + 3) & 0xff;
  const kp = m.keygen(seed);
  return { skHex: Buffer.from(kp.secretKey).toString('hex'), pub: kp.publicKey as Uint8Array };
}

// Records every JSON-RPC call; answers eth_chainId with the golden network and everything else with [].
function recordingProvider(calls: { method: string; params: any[] }[], chainId: string = '0x9af') {
  return {
    send: (method: string, params: any[]) => {
      calls.push({ method, params });
      return Promise.resolve(method === 'eth_chainId' ? chainId : [{ id: 1 }]);
    },
  } as any;
}

describe('signed-read preimage matches the node golden vector', () => {
  it('single-table read: preimage and hash', () => {
    expect(hex(canonicalDdbSignedReadBytes(CHAIN_ID, SCHEMA, TABLE, [], FROM, TS, NONCE))).toBe(WANT_PREIMAGE);
    expect(hex(canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, [], FROM, TS, NONCE))).toBe(WANT_HASH);
  });

  it('joined read: the table set is counted, then each entry length-prefixed', () => {
    expect(hex(canonicalDdbSignedReadBytes(CHAIN_ID, SCHEMA, TABLE, ['items'], FROM, TS, NONCE)))
      .toBe(WANT_JOINED_PREIMAGE);
    expect(hex(canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, ['items'], FROM, TS, NONCE)))
      .toBe(WANT_JOINED_HASH);
  });

  it('chain id is a 32-byte word however it is passed', () => {
    for (const c of [2479, BigInt(2479), '0x9af', '2479']) {
      expect(hex(canonicalDdbSignedReadHash(c, SCHEMA, TABLE, [], FROM, TS, NONCE))).toBe(WANT_HASH);
    }
  });

  it('every field moves the hash', () => {
    const base = hex(canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, [], FROM, TS, NONCE));
    const variants = [
      canonicalDdbSignedReadHash(1, SCHEMA, TABLE, [], FROM, TS, NONCE),
      canonicalDdbSignedReadHash(CHAIN_ID, 'c_users2', TABLE, [], FROM, TS, NONCE),
      canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, 'orders2', [], FROM, TS, NONCE),
      canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, ['items'], FROM, TS, NONCE),
      canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, [], '0x0000000000000000000000000000000000000001', TS, NONCE),
      canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, [], FROM, TS + 1, NONCE),
      canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, [], FROM, TS, NONCE + BigInt(1)),
    ].map(hex);
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('refuses a chain id that is not a non-negative integer word', () => {
    expect(() => canonicalDdbSignedReadHash(-1, SCHEMA, TABLE, [], FROM, TS, NONCE)).toThrow();
    expect(() => canonicalDdbSignedReadHash(1.5, SCHEMA, TABLE, [], FROM, TS, NONCE)).toThrow();
    expect(() => canonicalDdbSignedReadHash(BigInt(1) << BigInt(256), SCHEMA, TABLE, [], FROM, TS, NONCE)).toThrow();
  });
});

describe('buildDdbSignedRead', () => {
  it('canonicalizes the join table set exactly as the node requires (sorted, unique, no base table)', () => {
    const pub = new Uint8Array([1, 2, 3]);
    const a = buildDdbSignedRead(CHAIN_ID, SCHEMA, TABLE, FROM, pub, { joinTables: ['items', 'orders', 'addr', 'items'], timestamp: TS, nonce: NONCE });
    expect(a.envelope.joinTables).toEqual(['addr', 'items']);
    expect(hex(a.hash)).toBe(hex(canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, ['addr', 'items'], FROM, TS, NONCE)));
    // A single-table read omits joinTables from the envelope, as the node's omitempty does.
    const b = buildDdbSignedRead(CHAIN_ID, SCHEMA, TABLE, FROM, pub, { timestamp: TS, nonce: NONCE });
    expect(b.envelope.joinTables).toBeUndefined();
    expect(hex(b.hash)).toBe(WANT_HASH);
    expect(b.envelope).toEqual({
      schemaName: SCHEMA, tableName: TABLE, from: FROM,
      timestamp: '0x499602d2', nonce: '0x102030405060708', callerPubKey: '0x010203',
    });
  });

  it('refuses a milliseconds timestamp and more join tables than the node signs', () => {
    const pub = new Uint8Array([1]);
    expect(() => buildDdbSignedRead(CHAIN_ID, SCHEMA, TABLE, FROM, pub, { timestamp: Date.now() })).toThrow(/milliseconds/);
    const many = Array.from({ length: 33 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    expect(() => buildDdbSignedRead(CHAIN_ID, SCHEMA, TABLE, FROM, pub, { joinTables: many })).toThrow(/at most 32/);
  });
});

describe('Ddb.signedSelect / Ddb.callReadProcedure', () => {
  it('signs the read with the chain id it asked the node for, and sends the query unsigned beside it', async () => {
    const { skHex, pub } = await deterministicKey();
    const m = await mldsa();
    const calls: { method: string; params: any[] }[] = [];
    const ddb = new Ddb(recordingProvider(calls));
    const query = { filters: [{ column: 'id', op: '=', value: '1' }], limit: 5 };

    const rows = await ddb.signedSelect(skHex, SCHEMA, TABLE, query, { timestamp: TS, nonce: NONCE });
    expect(rows).toEqual([{ id: 1 }]);

    expect(calls.map((c) => c.method)).toEqual(['eth_chainId', 'ddb_signedSelect']);
    const [envelope, sentQuery] = calls[1].params;
    expect(sentQuery).toEqual(query);
    const from = await privateKeyDdbSigner(skHex).getAddress();
    expect(envelope.from).toBe(from);
    expect(envelope.callerPubKey).toBe('0x' + hex(pub));

    // The node verifies callerSig over SignedReadHash(chainConfig.ChainID, ...) -- reproduce that.
    const h = canonicalDdbSignedReadHash(CHAIN_ID, SCHEMA, TABLE, [], from, TS, NONCE);
    const sig = Buffer.from(envelope.callerSig.slice(2), 'hex');
    expect(m.verify(pub, h, sig)).toBe(true);
    // ...and a signature for another network does not verify there.
    const other = canonicalDdbSignedReadHash(1, SCHEMA, TABLE, [], from, TS, NONCE);
    expect(m.verify(pub, other, sig)).toBe(false);
  });

  it('uses an explicit chainId without asking the node', async () => {
    const { skHex } = await deterministicKey();
    const calls: { method: string; params: any[] }[] = [];
    await new Ddb(recordingProvider(calls)).signedSelect(skHex, SCHEMA, TABLE, {}, { chainId: CHAIN_ID });
    expect(calls.map((c) => c.method)).toEqual(['ddb_signedSelect']);
  });

  it('callReadProcedure passes schema, procedure and args straight to ddb_callReadProcedure', async () => {
    const calls: { method: string; params: any[] }[] = [];
    const rows = await new Ddb(recordingProvider(calls)).callReadProcedure(SCHEMA, 'getUser', ['alice']);
    expect(rows).toEqual([{ id: 1 }]);
    expect(calls).toEqual([{ method: 'ddb_callReadProcedure', params: [SCHEMA, 'getUser', ['alice']] }]);
  });
});
