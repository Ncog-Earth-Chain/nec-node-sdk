// Live-node validation: sign a tx from a random (unfunded) account and submit it.
// A reply of "insufficient funds" proves the chain verified the ML-DSA signature
// and recovered the sender -> the signer is byte-correct. "invalid sender" /
// decode / chain-id errors would mean the format is wrong.
// Run: npx ts-node --compiler-options '{"target":"ES2020","module":"CommonJS"}' scripts/test-live-node.ts
import axios from 'axios';
import { signTransactionMLDSA87, privateKeyToAddress, __test } from '../src/tx-signer';

const RPC = process.env.NCOG_RPC || 'https://api.dsuite.ncog.earth/chain-rpc';
const { bytesToHex } = __test;

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

  // deterministic seed (unfunded account)
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
  const kp = mldsa.keygen(seed);
  const skHex = bytesToHex(kp.secretKey);
  const address = await privateKeyToAddress(skHex);
  console.log('RPC        :', RPC);
  console.log('from addr  :', address);

  const chainIdHex = (await rpc('eth_chainId', [])).result;
  const chainId = parseInt(chainIdHex, 16);
  const nonceHex = (await rpc('eth_getTransactionCount', [address, 'latest'])).result;
  const nonce = parseInt(nonceHex, 16);
  const gasPrice = (await rpc('eth_gasPrice', [])).result || '0x3b9aca00';
  const balance = (await rpc('eth_getBalance', [address, 'latest'])).result;
  console.log('chainId    :', chainId, `(${chainIdHex})`);
  console.log('nonce      :', nonce, ' balance:', balance, ' gasPrice:', gasPrice);

  const tx = {
    nonce,
    gasPrice,
    gas: '0x5208', // 21000
    to: '0x' + '22'.repeat(20),
    value: '0x0',
    data: '0x',
    chainId,
  };
  const signed = await signTransactionMLDSA87(tx, skHex);
  console.log('raw tx     :', (signed.raw.length - 2) / 2, 'bytes; hash', signed.hash.slice(0, 18) + '…');

  const send = await rpc('eth_sendRawTransaction', [signed.raw]);
  console.log('\n=== eth_sendRawTransaction response ===');
  console.log(JSON.stringify(send, null, 2));

  const errMsg = (send.error && (send.error.message || JSON.stringify(send.error))) || '';
  console.log('\n=== verdict ===');
  if (send.result) {
    console.log('ACCEPTED (tx hash returned) — signer is correct AND account somehow funded.');
  } else if (/insufficient funds|not enough|balance|underpriced|nonce|gas/i.test(errMsg)) {
    console.log('SIGNER CORRECT ✅ — node verified the ML-DSA signature and recovered the sender.');
    console.log('   (rejected only for account state:', errMsg, ')');
  } else if (/invalid sender|recover|rlp|decode|chain ?id|signature|malformed/i.test(errMsg)) {
    console.log('SIGNER WRONG ❌ — format/signature rejected:', errMsg);
    process.exit(1);
  } else {
    console.log('UNCLEAR — inspect the error above:', errMsg);
  }
}

main().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
