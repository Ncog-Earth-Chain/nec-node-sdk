// src/wallet.browser.ts
import { signTransactionMLDSA87, privateKeyToAddress, decodeRLPTransaction, SIGVER_MLDSA_V2, SIGVER_ROTATED } from './tx-signer';
import type { Provider } from './provider';
// './utils' (no .js): the only extension-suffixed relative import in src/, and it made this file --
// the BROWSER signer -- unloadable by the test runner, which is why the browser Signer had no unit
// coverage at all. Every other module here imports it extensionless; rollup bundles either form.
import { normalizeResponse, etherToWeiHex } from './utils';

export interface TxParams {
  from: string;
  nonce: any;
  gasPrice: string;
  gasLimit?: string;
  gas?: string;
  to: string;
  value: string;
  data?: string;
  chainId?: number;
}

export class Wallet {
  public privateKey: string;
  public readonly address: string;
  /**
   * Signature-scheme version this wallet signs with: 2 for a normal account whose address is derived
   * from its key, 3 for a ROTATED / guardian-recovered account whose address is decoupled from it.
   */
  public readonly sigVer: number;

  private constructor(privateKey: string, address: string, sigVer: number = SIGVER_MLDSA_V2) {
    this.privateKey = privateKey;
    this.address = address;
    this.sigVer = sigVer;
  }

  static async create(hexPrivateKey: string): Promise<Wallet> {
    const address = await privateKeyToAddress(hexPrivateKey);
    return new Wallet(hexPrivateKey, address);
  }

  /**
   * A wallet for an account whose key has been ROTATED or guardian-RECOVERED (Model B).
   *
   * `accountAddress` is the account's ORIGINAL, STABLE address -- the one that holds the balance. It
   * is deliberately NOT derived from the key: after a rotation the key derives a different, empty
   * address, and a wallet that adopted it would have silently abandoned the account. Verify with
   * `readKeyRegistry(provider, accountAddress)` that `currentKeyHash === keyHashOf(publicKey)` first.
   */
  static async createRotated(hexPrivateKey: string, accountAddress: string): Promise<Wallet> {
    const addr = (accountAddress || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw new Error(`createRotated: accountAddress must be a 20-byte 0x address, got "${accountAddress}"`);
    }
    return new Wallet(hexPrivateKey, addr.toLowerCase(), SIGVER_ROTATED);
  }

  connect(provider: Provider): Signer {
    return new Signer(provider, this);
  }

  /**
   * Unified connect: creates a Wallet, Provider, and Signer in one call (browser version).
   * @param hexPrivateKey The private key as a hex string.
   * @param providerUrl The RPC URL (optional, defaults to http://localhost:8545)
   * @returns { signer, provider, address }
   */
  static async connect(hexPrivateKey: string, providerUrl?: string): Promise<{ signer: Signer, provider: Provider, address: string }> {
    const wallet = await Wallet.create(hexPrivateKey);
    const provider = new (await import('./provider')).Provider(providerUrl || 'http://localhost:8545');
    const signer = wallet.connect(provider);
    return { signer, provider, address: wallet.address };
  }
}

export class Signer {
  constructor(private provider: Provider, private wallet: Wallet) { }

  get address(): string {
    return this.wallet.address;
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  async sendTransaction(txParams: TxParams): Promise<string> {

    if (!txParams?.chainId) {
      txParams.chainId = await this.provider.getChainId();
    }

    // ---- NONCE: read it for the account that SIGNS, and for nothing else --------------------
    // The node validates the nonce of the address the transaction is SIGNED as. preCheck does
    //   stNonce := st.state.GetNonce(st.msg.From())
    // (ncogearthchain/evmcore/state_transition.go) and From() is types.Sender()'s return, which is
    // the signed ClaimedFrom (ncog-evm/core/types/transaction_signing.go, step 6). This Signer
    // always signs as `this.wallet.address` (see the sign call below), so the nonce MUST be read
    // for that account. Reading it for anything else -- a caller/dApp-supplied `from`, a data
    // address, the address a ROTATED account's new key derives -- is a different account's counter,
    // and the node answers "nonce too low" the moment the signing account has sent anything of its
    // own. For an unrotated wallet the two happen to coincide, which is exactly why this survives
    // review; for a rotated wallet (Model B) they are two different accounts.
    const signerAddress = this.wallet.address;
    if (txParams.from && String(txParams.from).toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(
        `sendTransaction: from ${txParams.from} is not this wallet's account ${signerAddress}. ` +
        'This Signer can only sign as its own account; the transaction would be signed as ' +
        `${signerAddress} regardless, so the supplied "from" would only mislead the nonce lookup.`);
    }
    txParams.from = signerAddress;
    // `=== undefined` and not `!txParams.nonce`: an explicit nonce of 0 is a real nonce (the first
    // transaction of a fresh account) and must not be silently replaced by a fetch.
    if (txParams.nonce === undefined || txParams.nonce === null || (txParams.nonce as any) === '') {
      txParams.nonce = await this.provider.getTransactionCount(signerAddress);
    }

    if (!txParams?.gasPrice) {
      txParams.gasPrice = await this.provider.getGasPrice();
    }

    if (txParams.value && txParams.value != '0x') {
      txParams.value = etherToWeiHex(txParams.value)
    }

    // Bind the CLAIMED sender to this wallet's account address, not to whatever the key derives.
    // For a rotated account (sigVer 3) they differ, and signing with the derived address would emit
    // a transaction from an unrelated empty account.
    const rawSignedObj = await signTransactionMLDSA87(txParams, this.wallet.privateKey, {
      from: this.wallet.address,
      sigVer: this.wallet.sigVer,
    });
    if (!rawSignedObj || (!rawSignedObj.raw && !rawSignedObj.rawTransaction)) {
      throw new Error('signTransactionMLDSA87 failed: ' + JSON.stringify(rawSignedObj));
    }
    const rawSigned: string = rawSignedObj.raw || rawSignedObj.rawTransaction;
    const sendResponse = await this.provider.callRpc('eth_sendRawTransaction', [rawSigned]);
    if (sendResponse.error) {
      throw new Error(
        'eth_sendRawTransaction failed: ' +
        JSON.stringify(sendResponse.error)
      );
    }
    return normalizeResponse(sendResponse.result || sendResponse ) as string; // returns tx hash
  }

  async decode(rawSigned: string): Promise<any> {
    return decodeRLPTransaction(rawSigned);
  }
} 