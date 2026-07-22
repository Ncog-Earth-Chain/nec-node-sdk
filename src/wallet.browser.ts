// src/wallet.browser.ts
import { signTransactionMLDSA87, privateKeyToAddress, decodeRLPTransaction } from './tx-signer';
import type { Provider } from './provider';
import { normalizeResponse, etherToWeiHex } from './utils.js';

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

  private constructor(privateKey: string, address: string) {
    this.privateKey = privateKey;
    this.address = address;
  }

  static async create(hexPrivateKey: string): Promise<Wallet> {
    const address = await privateKeyToAddress(hexPrivateKey);
    return new Wallet(hexPrivateKey, address);
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

    if (!txParams?.nonce) {
      txParams.nonce = await this.provider.getTransactionCount(txParams.from);
    }

    if (!txParams?.gasPrice) {
      txParams.gasPrice = await this.provider.getGasPrice();
    }

    if (txParams.value && txParams.value != '0x') {
      txParams.value = etherToWeiHex(txParams.value)
    }

    const rawSignedObj = await signTransactionMLDSA87(txParams, this.wallet.privateKey);
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