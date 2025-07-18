// src/wallet.ts
import { loadWasm } from './webassembly/mlkem';
import type { Provider } from './provider';
import { etherToWeiHex, normalizeResponse } from './utils';

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

export interface MlKem {
  keyGen(): Promise<{ pubKey: string; privKey: string }>;
  encrypt(pubKey: string, message: string): Promise<{ encryptedData: string; version: string }>;
  decrypt(privKey: string, encryptedData: string, version: string): Promise<string>;
  symEncrypt(ssKey: string, message: string): Promise<{ encryptedData: string; version: string }>;
  symDecrypt(ssKey: string, encryptedData: string, version: string): Promise<string>;
  privateKeyToAddress(privateKey: string): string;
  signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => any;
  decodeRLPTransaction: (txHex: string) => any;
}

export class Wallet {
  public mlkem: MlKem;
  public privateKey: string;
  public readonly address: string;

  private constructor(mlkem: MlKem, privateKey: string) {
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
   * Unified connect: creates a Wallet, Provider, and Signer in one call.
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
    // const rpcParams = serializeForRpc(txParams);

    // console.log("TxParams", txParams)

    if (!txParams?.chainId) {
      txParams.chainId = await this.provider.getChainId();
    }

    if (
      (!txParams.gas && !txParams.gasLimit) ||
      !txParams.gasPrice ||
      (txParams.nonce !== undefined && txParams.nonce < 0)
    ) {
      throw new Error('Missing required transaction parameters: gasLimit, gasPrice, nonce');
    }
    if (txParams.value && txParams.value != '0x') {
      txParams.value = etherToWeiHex(txParams.value)
    }

    const rawSignedObj = this.wallet.mlkem.signTransactionMLDSA87(txParams, this.wallet.privateKey);
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
    return normalizeResponse(sendResponse?.result || sendResponse) as string; // returns tx hash
  }

  async decode(rawSigned: string): Promise<any> {
    const response = this.wallet.mlkem.decodeRLPTransaction(rawSigned);
    if (response.error) {
      throw new Error(
        'eth_decodeRawTransaction failed: ' +
        JSON.stringify(response.error)
      );
    }
    return response;
  }
}
