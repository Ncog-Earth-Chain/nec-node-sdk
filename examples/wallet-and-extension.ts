/**
 * Two ways to sign on NCOG Earth Chain:
 *   A) Local Wallet signing (Node.js / backend) — you hold the ML-DSA-87 private key.
 *   B) Browser extension wallet — an InjectedProvider signs via ExtensionSigner; the key stays in
 *      the extension and the user approves each transaction.
 */
import { Provider, Wallet, ExtensionSigner, type InjectedProvider } from 'necjs';

const RPC_URL = 'https://rpc.ncog.earth';
const CHAIN_ID = 2479;
const RECIPIENT = '0x0987654321098765432109876543210987654321';

// ---- Path A: local Wallet signing ----
export async function localWalletExample() {
  const provider = new Provider(RPC_URL);
  const wallet = await Wallet.create('0xYOUR_ML_DSA_87_PRIVATE_KEY_HEX');
  const signer = wallet.connect(provider);

  const txHash = await signer.sendTransaction({
    from: wallet.address,
    to: RECIPIENT,
    value: '1', // 1 NEC — the Signer converts it to wei-hex
    gasLimit: '21000',
    gasPrice: await provider.getGasPrice(),
    nonce: await provider.getTransactionCount(wallet.address),
    chainId: CHAIN_ID,
  });

  console.log('[local] tx', txHash);
  return txHash;
}

// ---- Path B: browser extension wallet ----
export async function extensionWalletExample() {
  if (typeof window === 'undefined') return; // browser only

  // The injected NCOG wallet (e.g. window.ncogWallet) implements InjectedProvider.
  const injected = (window as any).ncogWallet as InjectedProvider | undefined;
  if (!injected) throw new Error('NCOG wallet extension not found');

  const provider = new Provider(RPC_URL);
  const signer = new ExtensionSigner(injected, provider);

  const from = await signer.getAddress();
  console.log('[extension] selected account', from);

  // Optional: react to wallet events.
  signer.on('accountsChanged', (accounts) => console.log('[extension] accounts changed', accounts));

  // The extension broadcasts `value` as-is (no NEC->wei conversion here), so pass wei-hex.
  const txHash = await signer.sendTransaction({
    from,
    to: RECIPIENT,
    value: '0x2386f26fc10000', // 0.01 NEC in wei
    gasLimit: '21000',
    gasPrice: await provider.getGasPrice(),
    nonce: 0,
    chainId: CHAIN_ID, // optional — ExtensionSigner auto-fills from eth_chainId when omitted
  });

  console.log('[extension] tx', txHash);
  return txHash;
}
