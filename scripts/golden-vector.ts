// Emit a golden (raw tx, sender, chainId) vector for the SigVersion-v2 chain format —
// 11-field wire (chainId + from + sigVer) with the RAW-bytes pubkey — to be verified
// against the chain's Go decoder/verifier in a go test (TestJSGoldenVector).
import { signTransactionMLDSA87, privateKeyToAddress, __test } from '../src/tx-signer';
const { bytesToHex } = __test;

async function main() {
  // @ts-ignore
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;
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
  const signed = await signTransactionMLDSA87(tx, skHex); // always SigV2
  // Write the raw hex where the Go test (package types) can read it.
  const fs = await import('fs');
  const path = await import('path');
  const outDir = path.resolve(__dirname, '../../ncog-evm/core/types');
  fs.writeFileSync(path.join(outDir, 'js_golden.hex'), signed.raw.slice(2), 'utf8');
  console.log(JSON.stringify({ address, chainId, hash: signed.hash, wrote: path.join(outDir, 'js_golden.hex') }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
