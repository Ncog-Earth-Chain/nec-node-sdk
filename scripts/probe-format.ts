// Probe which tx wire-format the LIVE node accepts (reverse-engineer old vs new).
// Run: npx ts-node --compiler-options '{"target":"ES2020","module":"CommonJS"}' scripts/probe-format.ts
import axios from 'axios';
import { keccak_256 } from '@noble/hashes/sha3';
import { privateKeyToAddress, __test } from '../src/tx-signer';

const RPC = process.env.NCOG_RPC || 'https://api.dsuite.ncog.earth/chain-rpc';
const { rlpEncode, intToMinimalBytes, hexToBytes, bytesToHex } = __test;

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await axios.post(RPC, { jsonrpc: '2.0', id: 1, method, params }, {
    headers: { 'Content-Type': 'application/json' }, timeout: 20000,
  });
  return res.data;
}

async function main() {
  // @ts-ignore
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;

  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
  const kp = mldsa.keygen(seed);
  const skHex = bytesToHex(kp.secretKey);
  const address = await privateKeyToAddress(skHex);
  const pubAscii = new TextEncoder().encode(bytesToHex(kp.publicKey));

  const chainId = parseInt((await rpc('eth_chainId', [])).result, 16);
  const nonce = parseInt((await rpc('eth_getTransactionCount', [address, 'latest'])).result, 16);
  const gasPrice = (await rpc('eth_gasPrice', [])).result || '0x3b9aca00';
  console.log('addr', address, '| chainId', chainId, '| nonce', nonce, '| gasPrice', gasPrice);

  const N = intToMinimalBytes(BigInt(nonce));
  const GP = intToMinimalBytes(BigInt(gasPrice));
  const G = intToMinimalBytes(BigInt(21000));
  const TO = hexToBytes('22'.repeat(20));
  const V = new Uint8Array(0);        // value 0
  const D = new Uint8Array(0);        // data empty
  const CID = intToMinimalBytes(BigInt(chainId));

  function sign(hashFields: Uint8Array[]): Uint8Array {
    const digest = keccak_256(rlpEncode(hashFields));
    return mldsa.sign(kp.secretKey, digest);
  }

  const variants: { name: string; hashFields: Uint8Array[]; wire: (sig: Uint8Array) => Uint8Array[] }[] = [
    {
      name: 'OLD-8: wire[n,gp,g,to,v,d,sig,pk], hash[n,gp,g,to,v,d]',
      hashFields: [N, GP, G, TO, V, D],
      wire: (sig) => [N, GP, G, TO, V, D, sig, pubAscii],
    },
    {
      name: 'OLD-8+cidHash: wire[...8], hash[n,gp,g,to,v,d,cid]',
      hashFields: [N, GP, G, TO, V, D, CID],
      wire: (sig) => [N, GP, G, TO, V, D, sig, pubAscii],
    },
    {
      name: 'NEW-9: wire[...,sig,pk,cid], hash[n,gp,g,to,v,d,cid]',
      hashFields: [N, GP, G, TO, V, D, CID],
      wire: (sig) => [N, GP, G, TO, V, D, sig, pubAscii, CID],
    },
  ];

  for (const v of variants) {
    const sig = sign(v.hashFields);
    const raw = '0x' + bytesToHex(rlpEncode(v.wire(sig)));
    const send = await rpc('eth_sendRawTransaction', [raw]);
    const msg = send.result ? 'ACCEPTED ' + send.result : (send.error?.message || JSON.stringify(send.error));
    let tag = '  ?';
    if (send.result) tag = 'ACCEPTED';
    else if (/too many|not enough|too few|elements|rlp|decode|prefix/i.test(msg)) tag = 'WRONG-SHAPE';
    else if (/insufficient|not enough funds|balance|underpriced|nonce|gas/i.test(msg)) tag = 'DECODED+SENDER-OK ✅';
    else if (/invalid sender|recover|signature|chain ?id/i.test(msg)) tag = 'DECODED but SIG/SENDER-BAD';
    console.log(`\n[${tag}] ${v.name}`);
    console.log('   ->', msg);
  }
}

main().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
