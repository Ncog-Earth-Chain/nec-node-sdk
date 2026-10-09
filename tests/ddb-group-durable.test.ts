import * as fs from 'fs';
import * as path from 'path';
import {
  verifyGroupDurableReceipt, groupDurableDigest, decodeGroupDurableReceiptRlp,
  type DdbCommittee, type GroupDurableReceipt,
} from '../src/ddb-group-durable';
import { Ddb } from '../src/ddb';

// DB-08 (NEC-83): the SDK's group-durability receipt verifier against the node's own vectors
// (ncogearthchain gossip/ddb/testdata/db08_receipt_vectors.json, TestGroupDurableReceiptVectors). The Go
// suite judges the same file with the node's verifyGroupDurableQuorum; both must agree on every case.
const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'db08_receipt_vectors.json'), 'utf8'));
const committee: DdbCommittee = V.committee;

const byName = (prefix: string) => {
  const c = V.cases.find((x: any) => x.name.startsWith(prefix));
  if (!c) throw new Error(`no vector case "${prefix}"`);
  return c;
};

// Each case carries the network the verifier trusts; the committee object carries the epoch it expects.
const judge = (c: any, receipt: GroupDurableReceipt = c.receipt) =>
  verifyGroupDurableReceipt(receipt, { ...committee, networkId: c.networkId, epoch: c.expectedEpoch });

describe('DB-08 group-durability receipt: cross-language vectors', () => {
  test('the vectors are the node\'s (domain, committee shape, every case present)', () => {
    expect(V.domain).toBe('ddb-group-durable-v1');
    expect(committee.members).toHaveLength(4);
    expect(committee.minSigners).toBe(2);
    expect(V.cases.length).toBeGreaterThanOrEqual(10);
  });

  test('the digest is byte-identical to the node\'s GroupDurableDigest', () => {
    for (const c of V.cases) {
      const r = c.receipt;
      const d = groupDurableDigest(c.networkId, r.operationHash, r.payloadHash, r.ackTimeSec, r.epoch);
      expect('0x' + Buffer.from(d).toString('hex')).toBe(c.digest);
    }
  });

  test('the RLP form decodes to the same receipt', () => {
    for (const c of V.cases) {
      const r = decodeGroupDurableReceiptRlp(c.receiptRlp);
      expect(r.operationHash).toBe(c.receipt.operationHash);
      expect(r.payloadHash).toBe(c.receipt.payloadHash);
      expect(BigInt(r.ackTimeSec)).toBe(BigInt(c.receipt.ackTimeSec));
      expect(BigInt(r.epoch)).toBe(BigInt(c.receipt.epoch));
      expect(r.signatures.map((s) => [s.validator, s.signature]))
        .toEqual(c.receipt.signatures.map((s: any) => [s.validator, s.signature]));
    }
  });

  for (const c of V.cases as any[]) {
    test(`${c.name}: valid=${c.valid}`, async () => {
      const v = await judge(c);
      if (v.valid !== c.valid) throw new Error(`${c.name}: SDK valid=${v.valid} (${v.reason}), node says valid=${c.valid} (${c.why})`);
    });
  }
});

describe('DB-08 group-durability receipt: the rules, named', () => {
  test('approve quorum is by WEIGHT: three light members of four are not a quorum', async () => {
    const v = await judge(byName('under quorum by weight'));
    expect(v.valid).toBe(false);
    expect(v.signers).toBe(3); // a count of signers (2f+1 of 4 = 3) would have accepted it
    expect(v.reason).toMatch(/below the approve quorum/);
  });

  test('a heavy member plus one more is a quorum (11 of 13)', async () => {
    const v = await judge(byName('valid: weight quorum A+B'));
    expect(v).toMatchObject({ valid: true, signers: 2 });
    expect(v.weight).toBe(BigInt(11));
  });

  test('the distinct-signer floor holds whatever the weight', async () => {
    expect((await judge(byName('below the distinct-signer floor'))).reason).toMatch(/below the floor of 2/);
  });

  test('a forged signature fails the receipt', async () => {
    expect((await judge(byName('forged signature'))).reason).toMatch(/does not verify/);
  });

  test('a receipt of another epoch is refused before any signature is checked', async () => {
    const c = byName('wrong epoch');
    expect((await judge(c)).reason).toMatch(/epoch/);
    // ...and the same receipt IS valid for the committee of the epoch it was signed in.
    expect((await verifyGroupDurableReceipt(c.receipt, { ...committee, epoch: c.receipt.epoch })).valid).toBe(true);
  });

  test('a receipt of another network does not verify here', async () => {
    const c = byName('wrong network');
    expect((await judge(c)).valid).toBe(false);
    expect((await verifyGroupDurableReceipt(c.receipt, { ...committee, networkId: 0xa0a })).valid).toBe(true);
  });

  test('the receipt must name the operation the client submitted', async () => {
    const c = byName('valid: every member');
    expect((await judge(c)).valid).toBe(true);
    const other = '0x' + '11'.repeat(32);
    const v = await verifyGroupDurableReceipt(c.receipt, committee, { operationHash: other });
    expect(v.reason).toMatch(/different operation/);
    expect((await verifyGroupDurableReceipt(c.receipt, committee, { operationHash: c.receipt.operationHash })).valid).toBe(true);
  });

  test('a payload the client holds must hash to the signed payloadHash', async () => {
    const c = byName('valid: every member');
    const v = await verifyGroupDurableReceipt(c.receipt, committee, { payload: new Uint8Array([1, 2, 3]) });
    expect(v.reason).toMatch(/does not sign this payload/);
  });

  test('hex ackTimeSec/epoch (the RPC form) verify like numbers', async () => {
    const c = byName('valid: every member');
    const r = { ...c.receipt, ackTimeSec: '0x' + BigInt(c.receipt.ackTimeSec).toString(16), epoch: '0x7' };
    expect((await verifyGroupDurableReceipt(r, { ...committee, epoch: '0x7', networkId: '0xfa3' })).valid).toBe(true);
  });

  test('a committee with no weights falls back to the count threshold', async () => {
    const unweighted: DdbCommittee = { ...committee, members: committee.members.map((m) => ({ ...m, weight: undefined })) };
    expect((await verifyGroupDurableReceipt(byName('under quorum by weight').receipt, unweighted)).valid).toBe(true);
    expect((await verifyGroupDurableReceipt(byName('valid: weight quorum A+B').receipt, unweighted)).reason)
      .toMatch(/below the threshold 3/);
  });
});

describe('DB-08 through the Ddb client', () => {
  async function key() {
    // @ts-ignore - bundled JS without types
    const noblePQ: any = await import('../src/noble-post-quantum.js');
    const kp = (noblePQ.default || noblePQ).ml_dsa87.keygen(new Uint8Array(32).fill(7));
    return Buffer.from(kp.secretKey).toString('hex');
  }

  test('the default submit sends ONE parameter and reads the bare hash, as before', async () => {
    const sent: any[] = [];
    const provider: any = { send: (m: string, p: any[]) => { if (m !== 'nec_rules') sent.push(p); return Promise.resolve('0x' + 'ab'.repeat(32)); } };
    const r = await new Ddb(provider).submitOperationSigned(await key(), 'callprocedure', 'c_' + '00'.repeat(20), { procedure: 'p', args: [] },
      { preimageVersion: 1, nonce: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(r.commitTxHash).toBe('0x' + 'ab'.repeat(32));
    expect(r.groupDurableReceipt).toBeUndefined();
  });

  test('the opt-in sends the second parameter and surfaces a receipt the verifier accepts', async () => {
    const c = byName('valid: every member');
    const sent: any[] = [];
    const provider: any = {
      send: (m: string, p: any[]) => {
        if (m === 'nec_rules') return Promise.resolve({});
        sent.push(p);
        return Promise.resolve({ commitTxHash: '0x' + 'cd'.repeat(32), operationHash: c.receipt.operationHash,
          groupDurableReceipt: c.receipt, groupDurableReceiptRlp: c.receiptRlp });
      },
    };
    const r = await new Ddb(provider).submitOperationSigned(await key(), 'callprocedure', 'c_' + '00'.repeat(20), { procedure: 'p', args: [] },
      { preimageVersion: 1, nonce: 1, groupDurableReceipt: true });
    expect(sent[0][1]).toEqual({ groupDurableReceipt: true });
    expect(r.commitTxHash).toBe('0x' + 'cd'.repeat(32));
    expect((await verifyGroupDurableReceipt(r.groupDurableReceipt!, committee, { operationHash: r.operationHash })).valid).toBe(true);
    expect(decodeGroupDurableReceiptRlp(r.groupDurableReceiptRlp!).operationHash).toBe(r.operationHash);
  });

  test('getDdbCommittee reads the opt-in committee view', async () => {
    const provider: any = {
      send: (m: string, p: any[]) => {
        expect(m).toBe('ddb_getDdbValidators');
        expect(p).toEqual([{ committee: true }]);
        return Promise.resolve({ validators: [], count: 4, threshold: 3, epoch: '0x7', minSigners: 2, networkId: '0xfa3',
          committee: committee.members.map((m) => ({ ...m, weight: '0x' + BigInt(m.weight as string).toString(16) })) });
      },
    };
    const got = await new Ddb(provider).getDdbCommittee();
    expect((await verifyGroupDurableReceipt(byName('valid: weight quorum A+B').receipt, got)).valid).toBe(true);
    expect((await verifyGroupDurableReceipt(byName('under quorum by weight').receipt, got)).valid).toBe(false);
  });
});
