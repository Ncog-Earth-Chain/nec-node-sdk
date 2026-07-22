import { canonicalDdbOperationHash } from '../src/ddb';

function toHex(b: Uint8Array): string {
  let s = '0x';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

describe('DDB canonical operation hash', () => {
  // Cross-language byte-for-byte check: the chain pins the SAME fixed operation in
  // gossip/ddb.TestCanonicalOperationHashGoldenVector. If this fails, the SDK's canonical encoding has
  // drifted from the node's and every client-signed DDB op would be rejected on-chain.
  it('matches the node golden vector', () => {
    const data = new TextEncoder().encode('{"a":1}');
    const hash = canonicalDdbOperationHash(
      0, // DdbCreateSchema
      'users',
      data,
      '0x000000000000000000000000000000000000abcd',
      1234567890,
      100000,
    );
    expect(toHex(hash)).toBe('0xc10f5838d8730999f2cf49bc074fd6a775ab4833f9631ceaf9d008f804521320');
  });

  // Field boundaries must be unambiguous (length-prefixing): moving a byte across the schema/data
  // boundary must change the hash, mirroring the Go encoding's rationale.
  it('is sensitive to the schemaName/data boundary', () => {
    const from = '0x000000000000000000000000000000000000abcd';
    const a = canonicalDdbOperationHash(0, 'ab', new TextEncoder().encode('c'), from, 1, 1);
    const b = canonicalDdbOperationHash(0, 'a', new TextEncoder().encode('bc'), from, 1, 1);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('rejects a non-20-byte from address', () => {
    expect(() =>
      canonicalDdbOperationHash(0, 'users', new Uint8Array(), '0xabcd', 1, 1),
    ).toThrow(/from address length/);
  });
});
