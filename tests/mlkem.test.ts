// ML-KEM-1024 (node WASM) functional round-trip. The KEM was previously untested. Exercises the real
// loadWasm() -> keyGen -> asymmetric encrypt -> decrypt path against the bundled Go WASM module.
import { loadWasm } from '../src/webassembly/mlkem';

describe('ML-KEM-1024 node WASM', () => {
  it('keyGen -> encrypt -> decrypt recovers the plaintext', async () => {
    const m = await loadWasm();
    const { pubKey, privKey } = await m.keyGen();
    expect(typeof pubKey).toBe('string');
    expect(typeof privKey).toBe('string');
    expect(pubKey.length).toBeGreaterThan(0);

    const message = 'NCOG post-quantum KEM round-trip ✅';
    const enc = await m.encrypt(pubKey, message);
    expect(typeof enc.encryptedData).toBe('string');
    expect(typeof enc.version).toBe('string');

    const dec = await m.decrypt(privKey, enc.encryptedData, enc.version);
    expect(dec).toBe(message);
  }, 60000);

  it('produces a fresh keypair each call (non-deterministic keyGen)', async () => {
    const m = await loadWasm();
    const a = await m.keyGen();
    const b = await m.keyGen();
    expect(a.pubKey).not.toBe(b.pubKey);
  }, 60000);
});
