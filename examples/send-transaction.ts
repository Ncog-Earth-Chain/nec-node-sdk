/**
 * Send NEC value on NCOG Earth Chain and poll for the receipt.
 *
 * Two paths are shown:
 *   A) Wallet + Signer   — the Signer auto-fills chainId/nonce/gasPrice and converts the NEC value.
 *   B) signTransactionMLDSA87 + provider.sendRawTransaction — full manual control.
 *
 * Run against your own node; replace the placeholder private key with a real ML-DSA-87 key.
 */
import { Provider, Wallet, signTransactionMLDSA87, etherToWeiHex } from 'necjs';

const RPC_URL = 'https://rpc.ncog.earth';
// NCOG's chainId. You can also fetch it at runtime with provider.getChainId().
const CHAIN_ID = 2479;
// Placeholder — DO NOT use in production. Replace with a real ML-DSA-87 private key hex.
const PRIVATE_KEY = '0xYOUR_ML_DSA_87_PRIVATE_KEY_HEX';
const RECIPIENT = '0x0987654321098765432109876543210987654321';

/** Poll eth_getTransactionReceipt until the tx is mined (or time out). */
async function waitForReceipt(provider: Provider, hash: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`receipt not found for ${hash} (timed out)`);
}

// ---- Path A: Wallet + Signer (recommended) ----
async function sendWithSigner() {
  const provider = new Provider(RPC_URL);
  const wallet = await Wallet.create(PRIVATE_KEY);
  const signer = wallet.connect(provider);

  // chainId / nonce / gasPrice are auto-filled by the Signer when omitted; they are supplied here
  // explicitly only to satisfy the TxParams type. `value` is a NEC amount — the Signer converts it
  // to wei-hex via etherToWeiHex.
  const txHash = await signer.sendTransaction({
    from: wallet.address,
    to: RECIPIENT,
    value: '1', // 1 NEC
    gasLimit: '21000',
    gasPrice: await provider.getGasPrice(),
    nonce: await provider.getTransactionCount(wallet.address),
    chainId: CHAIN_ID,
  });

  console.log('[A] sent tx:', txHash);
  const receipt = await waitForReceipt(provider, txHash);
  console.log('[A] mined in block:', receipt.blockNumber, 'status:', receipt.status);
}

// ---- Path B: raw signing + sendRawTransaction ----
async function sendRaw() {
  const provider = new Provider(RPC_URL);
  const wallet = await Wallet.create(PRIVATE_KEY);

  // Unlike the Signer, signTransactionMLDSA87 does NOT convert NEC -> wei: `value` must already be
  // in base units. chainId is mandatory (signing throws on chainId 0).
  const chainId = await provider.getChainId();
  const signed = await signTransactionMLDSA87(
    {
      nonce: await provider.getTransactionCount(wallet.address),
      gasPrice: await provider.getGasPrice(),
      gas: '21000',
      to: RECIPIENT,
      value: etherToWeiHex('0.5'), // 0.5 NEC, already in wei
      data: '0x',
      chainId,
    },
    wallet.privateKey
  );

  const txHash = await provider.sendRawTransaction(signed.raw);
  console.log('[B] sent tx:', txHash, '(hash from signer:', signed.hash, ')');
  const receipt = await waitForReceipt(provider, txHash);
  console.log('[B] mined in block:', receipt.blockNumber, 'status:', receipt.status);
}

async function main() {
  await sendWithSigner();
  await sendRaw();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
