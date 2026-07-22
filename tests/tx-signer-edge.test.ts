// Edge-case coverage for the consensus-critical SigVersion-v2 tx-signer (tx-signer.ts). The happy path +
// Go cross-language golden live in sigv2.test.ts; this file pins the failure modes and encoding invariants.
import {
  signTransactionMLDSA87,
  privateKeyToAddress,
  publicKeyToAddress,
  decodeRLPTransaction,
  __test,
} from '../src/tx-signer';

const { intToMinimalBytes, bytesToHex, rlpEncode } = __test;

// Deterministic key, identical seed to sigv2.test.ts (i*13+5) so the golden address is stable.
async function deterministicKey() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
  const kp = mldsa.keygen(seed);
  return { skHex: bytesToHex(kp.secretKey), pub: kp.publicKey as Uint8Array };
}

const GOLDEN_ADDRESS = '0x0609f7a1e5ac783acc81480059551aa95320219b'; // publicKeyToAddress(pub) for the seed above

describe('tx-signer v2 edge cases', () => {
  it('intToMinimalBytes(0) is empty, and encodes minimally (big-endian, no leading zeros)', () => {
    expect(intToMinimalBytes(BigInt(0)).length).toBe(0);
    expect(bytesToHex(intToMinimalBytes(BigInt(1)))).toBe('01');
    expect(bytesToHex(intToMinimalBytes(BigInt(255)))).toBe('ff');
    expect(bytesToHex(intToMinimalBytes(BigInt(256)))).toBe('0100');
    expect(bytesToHex(intToMinimalBytes(BigInt(2479)))).toBe('09af');
  });

  it('publicKeyToAddress matches privateKeyToAddress and the golden (keccak256(rawPubkey)[12:])', async () => {
    const { skHex, pub } = await deterministicKey();
    const fromPub = publicKeyToAddress(pub);
    const fromSk = await privateKeyToAddress(skHex);
    expect(fromPub.toLowerCase()).toBe(fromSk.toLowerCase());
    expect(fromPub.toLowerCase()).toBe(GOLDEN_ADDRESS);
  });

  it('throws when chainId is missing (0 is never valid on NCOG)', async () => {
    const { skHex } = await deterministicKey();
    const base = { nonce: 0, gasPrice: '0x1', gas: '0x5208', to: '0x' + '11'.repeat(20), value: '0x0', data: '0x' };
    await expect(signTransactionMLDSA87(base, skHex)).rejects.toThrow(/chainId is required/);
    await expect(signTransactionMLDSA87({ ...base, chainId: 0 }, skHex)).rejects.toThrow(/chainId is required/);
  });

  it('throws on a bad "to" length (not 20 bytes)', async () => {
    const { skHex } = await deterministicKey();
    const tx = { nonce: 0, gasPrice: '0x1', gas: '0x5208', to: '0x1234', value: '0x0', data: '0x', chainId: 2479 };
    await expect(signTransactionMLDSA87(tx, skHex)).rejects.toThrow(/invalid "to" address length/);
  });

  it('treats an empty "to" as contract creation (decodes back to null)', async () => {
    const { skHex } = await deterministicKey();
    const tx = { nonce: 3, gasPrice: '0x1', gas: '0x5208', to: '0x', value: '0x0', data: '0x6001', chainId: 2479 };
    const signed = await signTransactionMLDSA87(tx, skHex);
    const decoded = decodeRLPTransaction(signed.raw);
    expect(decoded.to).toBeNull();
    expect(decoded.nonce).toBe('3');
    expect(decoded.data.toLowerCase()).toBe('0x6001');
  });

  it('decodeRLPTransaction rejects a tx that is not the 11-field SigV2 layout', () => {
    const shortList = rlpEncode([Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)]);
    expect(() => decodeRLPTransaction('0x' + bytesToHex(shortList))).toThrow(/expected 11 SigV2 fields/);
  });

  it('decodePubKeyField returns the raw 2592-byte ML-DSA-87 pubkey as hex on round-trip', async () => {
    const { skHex, pub } = await deterministicKey();
    const tx = { nonce: 1, gasPrice: '0x1', gas: '0x5208', to: '0x' + '22'.repeat(20), value: '0x0', data: '0x', chainId: 2479 };
    const signed = await signTransactionMLDSA87(tx, skHex);
    const decoded = decodeRLPTransaction(signed.raw);
    expect(pub.length).toBe(2592);
    expect(decoded.publicKey.toLowerCase()).toBe('0x' + bytesToHex(pub));
    expect(decoded.sigVer).toBe('2');
  });
});
