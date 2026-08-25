import { canonicalDdbOperationHash, canonicalDdbRequestId } from '../src/ddb';

function toHex(b: Uint8Array): string {
  let s = '0x';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

// The two constants below are produced by the CHAIN, not by this file. Regenerate them with:
//
//   go test ./gossip/ddb/ -run TestCanonicalOperationHashGoldenVector -v
//
// in the ncogearthchain repo, which prints GOLDEN_CANONICAL_HASH and GOLDEN_CANONICAL_HASH_NONCE for
// the same two fixed operations pinned here. Never edit them to make this file pass: if they differ,
// this SDK's signatures are being rejected on chain and the encoding is what has to change.
//
// This is worth spelling out because the previous version of this file did exactly that. It pinned a
// constant of its own (0xc10f5838...) computed from an encoding that OMITTED the signed nonce, while
// its comment claimed to cross-check the node -- and the node's test pinned its own value too. Both
// suites passed, in both repos, for as long as the SDK could not sign a single operation the chain
// would accept.
const GOLDEN_NONCE_ZERO = '0xdf419c1221e0ffccf8674d9d6401446731e1fbe0724e2bfdadd19581f3b530e5';
const GOLDEN_NONCE_SET = '0x39630961e2d666eb29bdbaf969e18f61f0ac367cc969a5bf55d04c70375a16c9';

const FROM = '0x000000000000000000000000000000000000abcd';
const DATA = new TextEncoder().encode('{"a":1}');

describe('DDB canonical operation hash', () => {
  // Cross-language byte-for-byte check against gossip/ddb.TestCanonicalOperationHashGoldenVector.
  // If this fails, the SDK's canonical encoding has drifted from the node's and every client-signed
  // DDB op would be rejected on chain with "caller signature verification failed".
  it('matches the node golden vector (nonce 0)', () => {
    const hash = canonicalDdbOperationHash(
      0, // DdbCreateSchema
      'users',
      DATA,
      FROM,
      1234567890,
      100000,
      0,
    );
    expect(toHex(hash)).toBe(GOLDEN_NONCE_ZERO);
  });

  // Same operation, nonce = 0x0102030405060708. This is the vector that pins the nonce's POSITION and
  // byte order (last field, immediately after gasLimit, big-endian), not merely its presence.
  it('matches the node golden vector (non-zero nonce)', () => {
    const nonce = BigInt('0x0102030405060708');
    const hash = canonicalDdbOperationHash(0, 'users', DATA, FROM, 1234567890, 100000, nonce);
    expect(toHex(hash)).toBe(GOLDEN_NONCE_SET);
  });

  // The regression this file failed to catch for its whole existence: an encoding that ignores the
  // nonce still passes every other test here, because nothing else varies it.
  it('changes when only the nonce changes', () => {
    const a = canonicalDdbOperationHash(0, 'users', DATA, FROM, 1234567890, 100000, 1);
    const b = canonicalDdbOperationHash(0, 'users', DATA, FROM, 1234567890, 100000, 2);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  // A u64 nonce exceeds Number.MAX_SAFE_INTEGER, so bigint must round-trip exactly. Passing the same
  // value as a Number would silently lose low bits and produce a hash the chain cannot reproduce.
  it('encodes a full 64-bit nonce without precision loss', () => {
    const a = canonicalDdbOperationHash(0, 'users', DATA, FROM, 1, 1, BigInt('0xfffffffffffffffe'));
    const b = canonicalDdbOperationHash(0, 'users', DATA, FROM, 1, 1, BigInt('0xffffffffffffffff'));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  // Field boundaries must be unambiguous (length-prefixing): moving a byte across the schema/data
  // boundary must change the hash, mirroring the Go encoding's rationale.
  it('is sensitive to the schemaName/data boundary', () => {
    const a = canonicalDdbOperationHash(0, 'ab', new TextEncoder().encode('c'), FROM, 1, 1, 0);
    const b = canonicalDdbOperationHash(0, 'a', new TextEncoder().encode('bc'), FROM, 1, 1, 0);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('rejects a non-20-byte from address', () => {
    expect(() =>
      canonicalDdbOperationHash(0, 'users', new Uint8Array(), '0xabcd', 1, 1, 0),
    ).toThrow(/from address length/);
  });
});

describe('DDB endorsement request id', () => {
  // The requestId is what waitForEndorsement polls. It is derived from the SAME operation bytes, so
  // it has to carry the nonce too -- an SDK that signed with the nonce but derived the requestId
  // without it would submit a valid operation and then poll a handle the node never created.
  it('changes when only the nonce changes', () => {
    const a = canonicalDdbRequestId(0, 'users', DATA, FROM, 1234567890, 100000, 1, FROM);
    const b = canonicalDdbRequestId(0, 'users', DATA, FROM, 1234567890, 100000, 2, FROM);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('binds the requester', () => {
    const a = canonicalDdbRequestId(0, 'users', DATA, FROM, 1, 1, 0, FROM);
    const b = canonicalDdbRequestId(0, 'users', DATA, FROM, 1, 1, 0, '0x0000000000000000000000000000000000001234');
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('rejects a non-20-byte requester', () => {
    expect(() => canonicalDdbRequestId(0, 'users', DATA, FROM, 1, 1, 0, '0xabcd')).toThrow(/requester length/);
  });
});
