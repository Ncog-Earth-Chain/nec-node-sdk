// src/wallet.browser.ts
import { loadWasm, type MlKemBrowser } from './webassembly/mlkem-browser';
import type { Provider } from './provider';
import { serializeForRpc, normalizeResponse } from './utils.js';

export interface TxParams {
  nonce: string;
  gasPrice: string;
  gasLimit: string;
  to: string;
  value: string;
  data: string;
  chainId: number;
}

export class Wallet {
  private mlkem: MlKemBrowser;
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
    // 1) sign the transaction via provider RPC
    const rpcParams = serializeForRpc(txParams);
    const signResponse = await this.provider.callRpc('eth_signTransaction', [rpcParams]);

    if (!signResponse.result?.raw) {
      throw new Error(
        'eth_signTransaction failed: ' +
        JSON.stringify(signResponse.error || signResponse)
      );
    }
    const rawSigned: string = signResponse.result.raw;

    // 2) broadcast the signed transaction
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