// src/wallet.browser.ts
import { loadWasm, type MlKemBrowser } from './webassembly/mlkem-browser';
import type { Provider } from './provider';
import { serializeForRpc, normalizeResponse } from './utils.js';

export interface TxParams {
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
  public mlkem: MlKemBrowser;
  public privateKey: string;
  public readonly address: string;

  private constructor(mlkem: MlKemBrowser, privateKey: string) {
    this.mlkem = mlkem;
    this.privateKey = privateKey;
    this.address = this.mlkem.privateKeyToAddress(privateKey);
  }

  static async create(hexPrivateKey: string): Promise<Wallet> {
    const mlkem = await loadWasm();
    return new Wallet(mlkem, hexPrivateKey);
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
    const rpcParams = serializeForRpc(txParams);
    const rawSignedObj = this.wallet.mlkem.signTransactionMLDSA87(rpcParams, this.wallet.privateKey);
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
    return normalizeResponse(sendResponse.result) as string; // returns tx hash
  }
} 