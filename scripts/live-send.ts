// Live cutover validation: sign a value transfer with the SDK **defaults** (upgraded-chain format:
// chainId in the signing hash + wire, RAW-bytes pubkey) using a funded key, submit it via
// eth_sendRawTransaction, and poll until it is MINED. Proves the full stack end-to-end:
// SDK defaults -> sign -> node decode -> ML-DSA verify -> sender/balance -> block inclusion.
//
//   RPC=http://127.0.0.1:18545 SK=<privkey hex> TO=0x... npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/live-send.ts
import { Wallet } from '../src/wallet';

async function main() {
  // argv form: live-send.ts <skHexOrFile> [rpcUrl] — argv survives WSL->Windows npx interop where env vars don't.
  const url = process.argv[3] || process.env.RPC || 'http://127.0.0.1:18545';
  let sk = process.argv[2] || process.env.SK || '';
  if (sk && !/^[0-9a-fA-F]+$/.test(sk)) {
    // treat as a file path containing the hex key
    const fs = await import('fs');
    sk = fs.readFileSync(sk, 'utf8').trim();
  }
  if (!sk) throw new Error('SK (funded ML-DSA-87 private key hex, as argv[2]/env/file) is required');
  const to = process.env.TO || '0x2222222222222222222222222222222222222222';

  const { signer, provider, address: from } = await Wallet.connect(sk, url);
  const chainId = await provider.getChainId();
  console.log(`from=${from} chainId=${chainId} rpc=${url}`);

  const bal = await provider.callRpc('eth_getBalance', [from, 'latest']);
  console.log(`balance=${bal}`);

  // NOTE: no per-call format options anywhere — this exercises DEFAULT_INCLUDE_CHAINID/DEFAULT_RAW_PUBKEY.
  const txHash = await signer.sendTransaction({
    from,
    to,
    value: '0.001', // NEC; Signer converts to wei hex
    gas: '0x5208',
  } as any);
  console.log(`submitted tx=${txHash}`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const rcpt = await provider.callRpc('eth_getTransactionReceipt', [txHash]);
    if (rcpt && rcpt.blockNumber) {
      console.log(`MINED in block ${rcpt.blockNumber} status=${rcpt.status}`);
      const tx = await provider.callRpc('eth_getTransactionByHash', [txHash]);
      console.log(`tx.from=${tx?.from} (expect ${from})`);
      if ((tx?.from || '').toLowerCase() !== from.toLowerCase()) throw new Error('sender mismatch!');
      console.log('LIVE-SEND OK (SDK defaults byte-compatible with the upgraded chain)');
      return;
    }
  }
  throw new Error('tx not mined within timeout');
}
main().catch((e) => { console.error('LIVE-SEND FAIL:', e?.message || e); process.exit(1); });
