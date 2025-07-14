import axios, { AxiosError } from 'axios';
import { normalizeResponse, serializeForRpc } from './utils';

/**
 * Represents a structured error returned from a JSON-RPC call.
 */
export class RpcError extends Error {
  public readonly code: number;
  public readonly data?: any;

  constructor(message: string, code: number, data?: any) {
    super(`RPC Error: ${message} (code: ${code})`);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/**
 * The Provider class is a low-level wrapper for making JSON-RPC requests to an NCOG chain node.
 * It handles request creation, error parsing, and provides convenience methods for all standard RPC calls.
 */
export class Provider {
  private url: string;
  private idCounter = 1;

  /**
   * @param url The URL of the JSON-RPC endpoint (e.g., "http://localhost:8545").
   */
  constructor(url: string) {
    this.url = url;
  }

  /**
   * Performs a raw JSON-RPC request. This is the core private method used by all others.
   * @param method The RPC method name.
   * @param params An array of parameters for the RPC method.
   * @returns The result from the RPC call.
   * @throws {RpcError} if the RPC call returns a JSON-RPC error object.
   * @throws {Error} for network or other request-level errors.
   */
  private async rpc(method: string, params: any[] = []): Promise<any> {
    if (!this.url) {
      throw new Error('Provider URL is not set');
    }
    const payload = { jsonrpc: '2.0', id: this.idCounter++, method, params };
    try {
      const { data } = await axios.post(this.url, payload);
      if (data?.error) {
        throw new RpcError(data?.error?.message, data?.error?.code, data?.error?.data);
      }
      return normalizeResponse(data?.result || data);
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new Error(`RPC request failed for method "${method}": ${error.message}`);
      }
      // Re-throw if it's already an RpcError or another type of error
      throw error;
    }
  }

  /**
   * Provides a public way to make any RPC call, for methods not explicitly wrapped.
   * @param method The RPC method name.
   * @param params An array of parameters for the RPC method.
   */
  async callRpc(method: string, params: any[] = []): Promise<any> {
    // Serialize all params for RPC
    const serializedParams = params.map(p => typeof p === 'object' && p !== null ? serializeForRpc(p) : p);
    return this.rpc(method, serializedParams);
  }

  // --- web3 ---
  /**
   * Returns the client version of the node.
   */
  async clientVersion(): Promise<string> { return this.rpc('web3_clientVersion'); }

  // --- net ---
  /**
   * Returns the current network ID.
   */
  async netVersion(): Promise<string> { return this.rpc('net_version'); }
  
  /**
   * Returns true if the client is actively listening for network connections.
   */
  async listening(): Promise<boolean> { return this.rpc('net_listening'); }

  /**
   * Returns the number of peers currently connected to the client.
   */
  async peerCount(): Promise<string> { return this.rpc('net_peerCount'); }

  // --- eth ---
  /**
   * Returns the current protocol version.
   */
  async protocolVersion(): Promise<string> { return this.rpc('eth_protocolVersion'); }
  
  /**
   * Returns an object with data about the sync status or `false` if not syncing.
   */
  async syncing(): Promise<any> { return this.rpc('eth_syncing'); }
  
  /**
   * Returns the coinbase address of the client.
   */
  async coinbase(): Promise<string> { return this.rpc('eth_coinbase'); }

  /**
   * Returns the number of hashes per second that the node is mining with.
   */
  async hashrate(): Promise<string> { return this.rpc('eth_hashrate'); }

  /**
   * Returns the current chain ID.
   */
  async getChainId(): Promise<number> {
   return await this.rpc('eth_chainId');
  }

  /**
   * Returns the current price per gas in wei.
   */
  async getGasPrice(): Promise<string> { return this.rpc('eth_gasPrice'); }

  /**
   * Returns a list of accounts owned by the client.
   */
  async accounts(): Promise<string[]> { return this.rpc('eth_accounts'); }

  /**
   * Returns the number of the most recent block.
   */
  async getBlockNumber(): Promise<number> { 
    return await this.rpc('eth_blockNumber');
  }

  /**
   * Returns the balance of an account in wei.
   * @param address The address to get the balance of.
   * @param tag The block tag (e.g., "latest", "earliest", "pending", or a block number). Defaults to "latest".
   */
  async getBalance(address: string, tag = 'latest'): Promise<string> {
    return this.rpc('eth_getBalance', [address, tag]);
  }

  /**
   * Returns the value from a storage position at a given address.
   * @param address Address of the storage.
   * @param position Hex of the position in storage.
   * @param tag Block tag. Defaults to "latest".
   */
  async getStorageAt(address: string, position: string, tag = 'latest'): Promise<string> {
    return this.rpc('eth_getStorageAt', [address, position, tag]);
  }

  /**
   * Returns the number of transactions sent from an address.
   * @param address The address.
   * @param tag The block tag. Defaults to "latest".
   */
  async getTransactionCount(address: string, tag = 'latest'): Promise<number> {
    return await this.rpc('eth_getTransactionCount', [address, tag]);
  }

  /**
   * Returns the number of transactions in a block from a block matching the given block number.
   * @param tag The block tag.
   */
  async getBlockTransactionCountByNumber(tag: string): Promise<number> {
    return await this.rpc('eth_getBlockTransactionCountByNumber', [tag]);
  }

  /**
   * Returns the code at a given address.
   * @param address The address.
   * @param tag The block tag. Defaults to "latest".
   */
  async getCode(address: string, tag = 'latest'): Promise<string> {
    return this.rpc('eth_getCode', [address, tag]);
  }

  /**
   * Returns a block matching the given block number.
   * @param tag The block tag or number.
   * @param full If true, returns full transaction objects; otherwise, only transaction hashes.
   */
  async getBlockByNumber(tag: string, full = false): Promise<any> {
    return this.rpc('eth_getBlockByNumber', [tag, full]);
  }

  /**
   * Returns a block matching the given block hash.
   * @param hash The hash of the block.
   * @param full If true, returns full transaction objects; otherwise, only transaction hashes.
   */
  async getBlockByHash(hash: string, full = false): Promise<any> {
    return this.rpc('eth_getBlockByHash', [hash, full]);
  }
  
  /**
   * Calculates a signature for data, using a specific account.
   * The account must be unlocked on the node.
   * @param address The address to sign with.
   * @param data The data to sign.
   */
  async sign(address: string, data: string): Promise<string> {
    return this.rpc('eth_sign', [address, data]);
  }
  
  /**
   * Asks the remote node to sign a transaction with an unlocked account.
   * @param txObj The transaction object to sign.
   * @returns An object containing the raw signed transaction and the decoded transaction fields.
   */
  async signTransaction(txObj: any): Promise<{ raw: string; tx: any }> {
    const rpcParams = serializeForRpc(txObj);
    return this.rpc('eth_signTransaction', [rpcParams]);
  }

  /**
   * Submits a transaction to be signed and broadcasted by the remote node.
   * The `from` account must be unlocked.
   * @param obj The transaction object.
   */
  async sendTransaction(obj: any): Promise<string> {
    const rpcParams = serializeForRpc(obj);
    return this.rpc('eth_sendTransaction', [rpcParams]);
  }

  /**
   * Submits a pre-signed transaction to the network.
   * @param signedTx The hex-encoded signed transaction.
   * @returns The transaction hash.
   */
  async sendRawTransaction(signedTx: string): Promise<string> {
    return this.rpc('eth_sendRawTransaction', [signedTx]);
  }

  /**
   * Executes a message call immediately without creating a transaction on the block-chain (read-only).
   * @param tx The transaction call object.
   * @param tag The block tag. Defaults to "latest".
   */
  async call(tx: { from?: string; to: string; gas?: string; gasPrice?: string; value?: string; data?: string; }, tag = 'latest'): Promise<string> {
    const rpcTx = serializeForRpc(tx);
    return this.rpc('eth_call', [rpcTx, tag]);
  }

  /**
   * Estimates the gas necessary to execute a specific transaction.
   * @param obj The transaction object.
   */
  async estimateGas(obj: any): Promise<number> {
    const rpcObj = serializeForRpc(obj);
    return await this.rpc('eth_estimateGas', [rpcObj]);
  }

  /**
   * Returns a transaction by its hash.
   * @param hash The hash of the transaction.
   */
  async getTransactionByHash(hash: string): Promise<any> {
    return this.rpc('eth_getTransactionByHash', [hash]);
  }

  /**
   * Returns the receipt of a transaction by its hash.
   * @param hash The hash of the transaction.
   */
  async getTransactionReceipt(hash: string): Promise<any> {
    return this.rpc('eth_getTransactionReceipt', [hash]);
  }

  /**
   * Returns an array of all logs matching a given filter object.
   * @param filter The filter object.
   */
  async getLogs(filter: any): Promise<any[]> {
    return this.rpc('eth_getLogs', [filter]);
  }
  
  // --- Mining ---
  /**
   * Used for submitting a proof-of-work solution.
   */
  async submitWork(nonce: string, powHash: string, mixDigest: string): Promise<any> {
    return this.rpc('eth_submitWork', [nonce, powHash, mixDigest]);
  }

  /**
   * Used for obtaining a proof-of-work problem.
   */
  async getWork(): Promise<any> { return this.rpc('eth_getWork'); }

  // --- personal ---
  /**
   * Creates a new account in the node's keystore.
   * @param password The password to protect the account with.
   */
  async newAccount(password: string): Promise<string> {
    return this.rpc('personal_newAccount', [password]);
  }

  /**
   * Imports an unencrypted private key into the node's keystore.
   * @param privateKey The raw private key.
   * @param password The password to encrypt the key with.
   */
  async importRawKey(privateKey: string, password: string): Promise<string> {
    return this.rpc('personal_importRawKey', [privateKey, password]);
  }

  /**
   * Signs data with a specific account.
   * The account must be unlocked on the node.
   * @param data The data to sign.
   * @param address The address to sign with.
   * @param password The password for the account.
   */
  async personalSign(data: string, address: string, password: string): Promise<string> {
    return this.rpc('personal_sign', [data, address, password]);
  }

  /**
   * Recovers the address that signed a piece of data.
   * @param data The original data.
   * @param signature The signature.
   */
  async ecRecover(data: string, signature: string): Promise<string> {
    return this.rpc('personal_ecRecover', [data, signature]);
  }

  /**
   * Unlocks a specified account for a given duration.
   * @param address The address to unlock.
   * @param password The account's password.
   * @param duration The duration in seconds to keep the account unlocked. Defaults to 300.
   */
  async unlockAccount(address: string, password: string, duration?: number): Promise<boolean> {
    return this.rpc('personal_unlockAccount', [address, password, duration]);
  }

  /**
   * Locks a specified account.
   * @param address The address to lock.
   */
  async lockAccount(address: string): Promise<boolean> {
    return this.rpc('personal_lockAccount', [address]);
  }

  /**
   * Sends a transaction from an account in the node's keystore.
   * @param tx The transaction object.
   * @param password The password for the `from` account.
   */
  async sendPersonalTransaction(tx: any, password: string): Promise<string> {
    return this.rpc('personal_sendTransaction', [tx, password]);
  }
}