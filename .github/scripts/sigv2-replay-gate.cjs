#!/usr/bin/env node
/*
 * SigVersion-v2 signing-preimage gate for the PUBLISHED artifact (dist/).
 *
 * WHY THIS FILE EXISTS. Before it, every gate in this repo's CI was green while replay protection
 * was deleted from the signer. Measured on a clean-room clone, one line changed in src/tx-signer.ts:
 *
 *   sed -i '259s|, dataBytes, chainId];|, dataBytes];|' src/tx-signer.ts
 *   npx tsc --noEmit  -> 0     npx jest --ci -> 0 (145 passed / 14 skipped)     npm run build -> 0
 *
 * The suite could not see it: tests/sigv2.test.ts signs, then round-trips the DECODER, and chainId
 * survives that round trip because it is still field 8 of the OUTER wire tx. Nothing checked that it
 * was inside the thing the signature covers. A tx signed for chainId 2479 stayed valid on every other
 * NCOG chain, and the artifact that shipped it is dist/, which no test loads at all.
 *
 * WHAT IT CHECKS, AND WHY IN THIS WAY. It does not re-run the SDK's own code and compare it to
 * itself. It rebuilds the signing preimage and the wire tx from the tx parameters using ethers'
 * encodeRlp + keccak256 (an unrelated implementation, already a devDependency), then asks
 * ml_dsa87.verify whether the signature the SDK produced actually covers that preimage. Verification
 * is the only question that cannot be answered by agreeing with the mistake:
 *
 *   digest WITH    chainId -> verify MUST be true    (breaks if a field is dropped/reordered/retyped)
 *   digest WITHOUT chainId -> verify MUST be false   (breaks if chainId was never bound)
 *
 * The differential check (chainId 2479 vs 2480 must not yield the same signature) is a second,
 * cheaper witness of the same property. ml_dsa87.sign is deterministic here, measured on this tree:
 * sign(sk,msg) twice -> identical bytes, length 4627, verify true.
 *
 * Run it AFTER `npm run build`: dist/index.cjs.js is what npm publishes.
 */
'use strict';

const path = require('path');
const { keccak256, encodeRlp, getBytes, hexlify } = require('ethers');

const DIST = path.resolve(__dirname, '../../dist/index.cjs.js');
const NOBLE = path.resolve(__dirname, '../../src/noble-post-quantum.js');

const sdk = require(DIST);
const noble = require(NOBLE);
const ml_dsa87 = (noble.default || noble).ml_dsa87;

// ML-DSA-87 constants (FIPS 204). A signature that is not exactly this long is not an ML-DSA-87
// signature -- in particular, it is an ML-DSA-87 signature with a secp256k1-style V byte glued on.
const MLDSA87_SIG_BYTES = 4627;
const MLDSA87_PUB_BYTES = 2592;
const SIGVER_MLDSA_V2 = 2;

let failures = 0;
function check(name, ok, detail) {
  const tag = ok ? '  ok  ' : '  FAIL';
  if (!ok) failures++;
  console.log(tag + ' ' + name + (detail ? '  [' + detail + ']' : ''));
}

// --- independent field encoders (deliberately NOT imported from src/) ---------------------------
// RLP integers are minimal big-endian, with zero encoded as the empty string.
function minimalHex(v) {
  const n = BigInt(v);
  if (n < 0n) throw new Error('negative field');
  if (n === 0n) return '0x';
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  return '0x' + h;
}

// --- fixture ------------------------------------------------------------------------------------
// Same deterministic key as tests/sigv2.test.ts and scripts/golden-vector.ts.
const seed = new Uint8Array(32);
for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
const kp = ml_dsa87.keygen(seed);
const skHex = Buffer.from(kp.secretKey).toString('hex');

const TX = {
  nonce: 7,
  gasPrice: '0x3b9aca00',
  gas: '0x5208',
  to: '0x' + '22'.repeat(20),
  value: '0x0de0b6b3a7640000',
  data: '0x',
};
const CHAIN_A = 2479;
const CHAIN_B = 2480;

// Rebuild the SigV2 signing preimage from the parameters, independently of src/tx-signer.ts:
//   keccak256( RLP([ sigVer, from, nonce, gasPrice, gas, to, value, data, chainId ]) )
function preimageDigest(fromHex, chainId, opts) {
  const omitChainId = !!(opts && opts.omitChainId);
  const fields = [
    minimalHex(SIGVER_MLDSA_V2),
    fromHex,
    minimalHex(TX.nonce),
    minimalHex(TX.gasPrice),
    minimalHex(TX.gas),
    TX.to,
    minimalHex(TX.value),
    TX.data,
  ];
  if (!omitChainId) fields.push(minimalHex(chainId));
  return getBytes(keccak256(encodeRlp(fields)));
}

async function main() {
  console.log('SigV2 replay-protection gate -- artifact under test: ' + DIST);

  const signedA = await sdk.signTransactionMLDSA87(Object.assign({}, TX, { chainId: CHAIN_A }), skHex);
  const decodedA = sdk.decodeRLPTransaction(signedA.raw);

  const pub = getBytes(signedA.publicKey);
  const sig = getBytes(signedA.signature);
  const fromHex = String(decodedA.from).toLowerCase();

  // 1. the sender address, recomputed here with ethers rather than with the SDK.
  const expectedFrom = '0x' + keccak256(pub).slice(2).slice(24);
  check('from == keccak256(rawPubkey)[12:]', fromHex === expectedFrom, fromHex + ' vs ' + expectedFrom);
  check('pubkey is raw ' + MLDSA87_PUB_BYTES + '-byte ML-DSA-87', pub.length === MLDSA87_PUB_BYTES, pub.length + ' B');

  // 2. THE GATE. The signature must cover a preimage that contains chainId, and must not cover the
  //    same preimage with chainId removed.
  const dWith = preimageDigest(fromHex, CHAIN_A);
  const dWithout = preimageDigest(fromHex, CHAIN_A, { omitChainId: true });
  const okWith = ml_dsa87.verify(pub, dWith, sig);
  const okWithout = ml_dsa87.verify(pub, dWithout, sig);
  check('signature verifies against the 9-field preimage INCLUDING chainId', okWith === true,
    'keccak(RLP[sigVer,from,nonce,gasPrice,gas,to,value,data,chainId])');
  check('signature does NOT verify against the same preimage WITHOUT chainId', okWithout === false,
    okWithout ? 'REPLAY PROTECTION IS NOT SIGNED -- this tx is valid on every NCOG chain'
              : '8-field preimage rejected');

  // 3. length pin: exactly one ML-DSA-87 signature, nothing appended.
  const decSig = getBytes(decodedA.signature);
  check('decoded signature is exactly ' + MLDSA87_SIG_BYTES + ' bytes',
    decSig.length === MLDSA87_SIG_BYTES, decSig.length + ' B');

  // 4. differential: same tx, different chain -> different signature and different tx hash.
  const signedB = await sdk.signTransactionMLDSA87(Object.assign({}, TX, { chainId: CHAIN_B }), skHex);
  check('chainId 2479 and 2480 produce DIFFERENT signatures', signedA.signature !== signedB.signature);
  check('chainId 2479 and 2480 produce DIFFERENT tx hashes', signedA.hash !== signedB.hash);
  check('the 2480 signature does not verify under the 2479 preimage',
    ml_dsa87.verify(pub, dWith, getBytes(signedB.signature)) === false);

  // 5. outer wire layout, rebuilt independently:
  //    RLP([nonce, gasPrice, gas, to, value, data, sig, pubKey, chainId, from, sigVer])
  const expectedRaw = encodeRlp([
    minimalHex(TX.nonce), minimalHex(TX.gasPrice), minimalHex(TX.gas), TX.to,
    minimalHex(TX.value), TX.data, hexlify(sig), hexlify(pub),
    minimalHex(CHAIN_A), fromHex, minimalHex(SIGVER_MLDSA_V2),
  ]);
  check('raw tx equals the independently re-encoded 11-field SigV2 RLP',
    signedA.raw.toLowerCase() === expectedRaw.toLowerCase(),
    ((signedA.raw.length - 2) / 2) + ' B');
  check('decoded sigVer is 2', decodedA.sigVer === String(SIGVER_MLDSA_V2), decodedA.sigVer);
  check('decoded chainId is the one signed', decodedA.chainId === String(CHAIN_A), decodedA.chainId);

  // 6. fail closed: a caller who forgets chainId must be refused, not silently given chainId 0.
  let threw = null;
  try {
    await sdk.signTransactionMLDSA87(Object.assign({}, TX), skHex);
  } catch (e) {
    threw = e && e.message ? e.message : String(e);
  }
  check('signing without chainId throws', threw !== null && /chainId/i.test(threw), threw || 'no throw');

  if (failures > 0) {
    console.error('\nSigV2 replay-protection gate: ' + failures + ' FAILED check(s).');
    process.exit(1);
  }
  console.log('\nSigV2 replay-protection gate: all checks passed.');
}

main().catch(function (e) {
  console.error('SigV2 replay-protection gate: threw before it could finish --', e && e.stack ? e.stack : e);
  process.exit(1);
});
