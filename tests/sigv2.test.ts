// SigVersion-v2 signer test. Exercises the real tx-signer.ts v2 path, round-trips the decoder, and
// writes js_golden.hex for the Go cross-language verifier (ncog-evm .../TestJSGoldenVector), which
// decodes it + verifies the ML-DSA signature under the node's own verifier.
import { signTransactionMLDSA87, privateKeyToAddress, decodeRLPTransaction, __test } from '../src/tx-signer';
import * as fs from 'fs';
import * as path from 'path';

const { bytesToHex } = __test;

describe('SigVersion v2 tx-signer', () => {
  it('signs a v2 tx, round-trips the decoder, and emits the Go golden vector', async () => {
    // @ts-ignore - bundled JS without types
    const noblePQ: any = await import('../src/noble-post-quantum.js');
    const mldsa = (noblePQ.default || noblePQ).ml_dsa87;

    // Deterministic key (identical to scripts/golden-vector.ts so the Go test's expectedSender holds).
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
    const kp = mldsa.keygen(seed);
    const skHex = bytesToHex(kp.secretKey);
    const address = await privateKeyToAddress(skHex);

    const chainId = 2479;
    const tx = {
      nonce: 0, gasPrice: '0x3b9aca00', gas: '0x5208',
      to: '0x' + '22'.repeat(20), value: '0x0de0b6b3a7640000', data: '0x', chainId,
    };

    const signed = await signTransactionMLDSA87(tx, skHex);

    // v2 decoder round-trip: 11 fields, from == address, sigVer == 2.
    const decoded = decodeRLPTransaction(signed.raw);
    expect(decoded.sigVer).toBe('2');
    expect(String(decoded.from).toLowerCase()).toBe(address.toLowerCase());
    expect(decoded.chainId).toBe(String(chainId));
    expect(decoded.nonce).toBe('0');
    expect(String(decoded.to).toLowerCase()).toBe(('0x' + '22'.repeat(20)).toLowerCase());

    // Emit the golden hex INSIDE THIS REPO. It used to be written straight into the sibling
    // ../../ncog-evm/core/types/ with no guard, which did two wrong things at once:
    //
    //   1. on any checkout without that sibling -- i.e. every CI runner -- the write threw
    //      `ENOENT ... open '.../ncog-evm/core/types/js_golden.hex'` and this suite FAILED;
    //   2. in the monorepo it MUTATED a different repository on every single `npm test`.
    //
    // The Go side's producer was never this test anyway: core/types/js_golden_vector_test.go says
    // "run nec-node-sdk golden-vector.ts first" and skips when the file is absent, and
    // scripts/golden-vector.ts is the script that deliberately writes there. This test keeps its own
    // copy under tests/testdata/ so the vector it just signed is still inspectable after a run.
    const outDir = path.resolve(__dirname, 'testdata');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'js_golden.hex'), signed.raw.slice(2), 'utf8');
    // eslint-disable-next-line no-console
    console.log('sigv2 golden: address=%s hash=%s bytes=%d', address, signed.hash, (signed.raw.length - 2) / 2);
  });
});
