// Local self-consistency test for the native-JS tx signer (no live node needed).
// Run: npx ts-node scripts/test-tx-signer.ts
import { keccak_256 } from '@noble/hashes/sha3';
import {
  signTransactionMLDSA87,
  privateKeyToAddress,
  publicKeyToAddress,
  decodeRLPTransaction,
  __test,
} from '../src/tx-signer';

const { rlpEncode, intToMinimalBytes, hexToBytes, bytesToHex } = __test;

let failures = 0;
function check(cond: boolean, name: string) {
  if (cond) {
    console.log('  ok  -', name);
  } else {
    failures++;
    console.error('  FAIL-', name);
  }
}

async function main() {
  // ---- 1. RLP known vectors (Ethereum spec) ----
  console.log('RLP vectors:');
  check(bytesToHex(rlpEncode(new Uint8Array(0))) === '80', 'empty string -> 0x80');
  check(bytesToHex(rlpEncode([])) === 'c0', 'empty list -> 0xc0');
  check(bytesToHex(rlpEncode(hexToBytes('00'))) === '00', '0x00 -> 0x00');
  check(bytesToHex(rlpEncode(hexToBytes('0f'))) === '0f', '0x0f -> 0x0f');
  check(bytesToHex(rlpEncode(hexToBytes('646f67'))) === '83646f67', '"dog" -> 0x83646f67');
  check(
    bytesToHex(rlpEncode([hexToBytes('636174'), hexToBytes('646f67')])) === 'c88363617483646f67',
    '["cat","dog"] -> 0xc88363617483646f67'
  );
  check(intToMinimalBytes(BigInt(0)).length === 0, 'int 0 -> empty');
  check(bytesToHex(intToMinimalBytes(BigInt(1024))) === '0400', 'int 1024 -> 0x0400');
  check(bytesToHex(intToMinimalBytes(BigInt(2479))) === '09af', 'chainId 2479 -> 0x09af');

  // ---- load bundled noble ml_dsa87 ----
  // @ts-ignore
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;

  // ---- 2. keygen + derivePublicKey consistency ----
  console.log('ML-DSA-87 keys:');
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 7 + 3) & 0xff;
  const kp = mldsa.keygen(seed);
  const skHex = bytesToHex(kp.secretKey);
  const pkHex = bytesToHex(kp.publicKey);
  console.log(`  pubkey ${kp.publicKey.length}B, secret ${kp.secretKey.length}B`);
  check(bytesToHex(mldsa.derivePublicKey(kp.secretKey)) === pkHex, 'derivePublicKey(sk) === keygen pubkey');

  // ---- 3. address derivation ----
  const addr = await privateKeyToAddress(skHex);
  check(addr === publicKeyToAddress(kp.publicKey), 'privateKeyToAddress === keccak256(pubkey)[12:]');
  check(/^0x[0-9a-f]{40}$/.test(addr), 'address is 20-byte hex');
  console.log(`  address ${addr}`);

  // ---- 4. sign a tx, verify the signature over the EXACT digest ----
  console.log('sign / verify:');
  const to = '11'.repeat(20);
  const tx = {
    nonce: 1,
    gasPrice: '0x3b9aca00',
    gas: '0x5208',
    to: '0x' + to,
    value: '0xde0b6b3a7640000', // 1 NEC
    data: '0x',
    chainId: 2479,
  };
  const signed = await signTransactionMLDSA87(tx, skHex, { includeChainId: true });
  const unsigned = [
    intToMinimalBytes(BigInt(1)),
    intToMinimalBytes(BigInt('0x3b9aca00')),
    intToMinimalBytes(BigInt('0x5208')),
    hexToBytes(to),
    intToMinimalBytes(BigInt('0xde0b6b3a7640000')),
    new Uint8Array(0),
    intToMinimalBytes(BigInt(2479)),
  ];
  const digest = keccak_256(rlpEncode(unsigned));
  const sigBytes = hexToBytes(signed.signature);
  check(sigBytes.length === 4627, `signature is 4627 bytes (got ${sigBytes.length})`);
  check(mldsa.verify(kp.publicKey, digest, sigBytes) === true, 'signature verifies over signing digest');
  check(signed.publicKey.slice(2) === pkHex, 'returned pubkey matches');

  // ---- 5. decode round-trip ----
  console.log('decode round-trip:');
  const d = decodeRLPTransaction(signed.raw);
  check(d.nonce === '1', 'decoded nonce');
  check(d.chainId === '2479', 'decoded chainId');
  check(d.to.toLowerCase() === '0x' + to, 'decoded to');
  check(d.gas === '21000', 'decoded gas');
  check(d.publicKey.slice(2) === pkHex, 'decoded pubkey (hex-ascii string field) matches');
  check(d.signature.slice(2) === bytesToHex(sigBytes), 'decoded signature matches');
  check(d.hash === signed.hash, 'decoded tx hash matches');
  console.log(`  raw tx ${(signed.raw.length - 2) / 2} bytes`);

  console.log('');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED ✅');
  } else {
    console.error(`${failures} CHECK(S) FAILED ❌`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('TEST ERROR:', e);
  process.exit(1);
});
