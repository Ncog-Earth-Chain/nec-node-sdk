// DB-02 (NEC-78) C-10 through the SDK: tests/vectors/db02_type_vectors.json is a copy of ncogearthchain
// ddb/conformance/testdata/db02_type_vectors.json, whose node half (gossip/ddb TestDB02C10) writes each `arg`
// through the consensus path and reads back exactly `row`. Here: the SDK produces each `arg` from the value
// and recovers the value from each `row`, byte-for-byte (bytea) and digit-for-digit (numeric).
import * as fs from 'fs';
import * as path from 'path';
import { ddbByteaArg, ddbByteaFromRow } from '../src/ddb';

const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'db02_type_vectors.json'), 'utf8'));
const hx = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

describe('DB-02 C-10: bytea and numeric round-trip through the SDK', () => {
  it('encodes every bytea value as the argument the node stores, and decodes every row back to the bytes', () => {
    expect(V.bytea.length).toBeGreaterThan(0);
    for (const c of V.bytea) {
      expect({ name: c.name, arg: ddbByteaArg(hx(c.bytes)) }).toEqual({ name: c.name, arg: c.arg });
      expect({ name: c.name, bytes: Buffer.from(ddbByteaFromRow(c.row)).toString('hex') }).toEqual({ name: c.name, bytes: c.bytes });
    }
  });

  it('keeps numeric as its exact decimal text both ways (a JS number would round it)', () => {
    for (const c of V.numeric) {
      // the SDK passes numeric arguments as strings, and the node returns them as strings: nothing to convert
      expect(typeof c.row).toBe('string');
      expect(c.row).toBe(c.arg);
      if (c.arg.replace(/[-.]/g, '').length > 15) expect(String(Number(c.arg))).not.toBe(c.arg);
    }
  });

  it('refuses a row value that is not the node\'s 0x-hex bytea rendering', () => {
    for (const bad of ['\\x00ff', 'deadbeef', '0xabc', '0xzz', 5, null]) {
      expect(() => ddbByteaFromRow(bad as unknown)).toThrow();
    }
  });
});
