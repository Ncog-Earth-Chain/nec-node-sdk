import * as fs from 'fs';
import { verifyGroupDurableReceipt, decodeGroupDurableReceiptRlp, ddbCommitteeFromRpc } from '../src/ddb-group-durable';

// DB-08 (NEC-83) live step: the receipts a live testbed returned from ddb_submitSignedOp {groupDurableReceipt}
// (written by ncogearthchain scripts/tools/testbed-groupdurable -phase write -sdk FILE), verified here against
// the committee read from a node other than the first leader. scripts/ddb-group-durable-live.sh runs it with
// DB08_LIVE_RECEIPTS set; without it the suite is skipped.
const FILE = process.env.DB08_LIVE_RECEIPTS;
const d = FILE ? describe : describe.skip;

d('DB-08 live receipts', () => {
  const L = FILE ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { receipts: [], committees: {} };
  const committeeFor = (epoch: string | number) => {
    for (const raw of Object.values(L.committees) as any[]) {
      const c = ddbCommitteeFromRpc(raw);
      if (BigInt(c.epoch) === BigInt(epoch)) return c;
    }
    throw new Error(`no committee of epoch ${epoch} in ${FILE}`);
  };

  test('the testbed returned receipts', () => {
    expect(L.receipts.length).toBeGreaterThan(0);
  });

  test('every returned receipt verifies against its epoch committee, bound to its operation', async () => {
    let ok = 0;
    for (const r of L.receipts) {
      const c = committeeFor(r.receipt.epoch);
      const v = await verifyGroupDurableReceipt(r.receipt, c, { operationHash: r.operationHash });
      if (!v.valid) throw new Error(`receipt for ${r.operationHash} refused: ${v.reason}`);
      // ...and its RLP form is the same receipt.
      const back = decodeGroupDurableReceiptRlp(r.receiptRlp);
      expect(back.operationHash).toBe(r.receipt.operationHash.toLowerCase());
      expect(BigInt(back.ackTimeSec)).toBe(BigInt(r.receipt.ackTimeSec));
      ok++;
    }
    console.log(`DB-08 live: ${ok} of ${L.receipts.length} receipts verified by the SDK`);
  });

  test('a forged copy of a live receipt is refused', async () => {
    const r = L.receipts[0];
    const sig: string = r.receipt.signatures[0].signature;
    const flipped = sig.slice(0, 40) + (sig[40] === '0' ? '1' : '0') + sig.slice(41);
    const forged = { ...r.receipt, signatures: [{ ...r.receipt.signatures[0], signature: flipped }, ...r.receipt.signatures.slice(1)] };
    const v = await verifyGroupDurableReceipt(forged, committeeFor(r.receipt.epoch), { operationHash: r.operationHash });
    expect(v.valid).toBe(false);
  });
});
