import axios, { AxiosError } from 'axios';
import { keccak_256 } from '@noble/hashes/sha3';
import { normalizeResponse, serializeForRpc, weiToNec } from './utils';

// ENS namehash (EIP-137), computed locally with @noble/hashes (a real dependency) — no ethers needed.
// node = keccak256(node ‖ keccak256(label)) folded right-to-left over the dot-separated labels, from 32 zero bytes.
function ensNamehash(name: string): string {
  let node: Uint8Array = new Uint8Array(32);
  if (name) {
    const labels = name.split('.');
    for (let i = labels.length - 1; i >= 0; i--) {
      const labelHash = keccak_256(new TextEncoder().encode(labels[i]));
      const combined = new Uint8Array(64);
      combined.set(node, 0);
      combined.set(labelHash, 32);
      node = keccak_256(combined);
    }
  }
  let hex = '';
  for (let i = 0; i < node.length; i++) hex += node[i].toString(16).padStart(2, '0');
  return '0x' + hex;
}

/**
 * Represents a structured error returned from a JSON-RPC call.
 */
export class RpcError extends Error {
  public readonly code: number;
  public readonly data?: any;

  constructor(message: string, code: number, data?: any) {
    super(`RPC Error: ${message} (code: ${code})`);
    this.name = message;
    this.code = code;
    this.data = data;
  }
}

export type ProviderRequestMiddleware = (payload: any) => Promise<any> | any;
export type ProviderResponseMiddleware = (response: any, payload: any) => Promise<any> | any;

// ---------------------------------------------------------------------------
// Typed shapes of the common eth_* getter responses (hex-quantity strings, as the node returns them).
// All carry an index signature so forward-compatible node fields are preserved without a type break.
// ---------------------------------------------------------------------------

/** An event log (eth_getLogs / eth_getFilterChanges / receipt.logs). */
export interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
  [k: string]: unknown;
}

/** A transaction as returned by eth_getTransactionByHash / block.transactions (full=true). */
export interface TransactionResponse {
  hash: string;
  nonce: string;
  blockHash: string | null;
  blockNumber: string | null;
  transactionIndex: string | null;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gas: string;
  input: string;
  [k: string]: unknown;
}

/** A transaction receipt (eth_getTransactionReceipt). `status` is "0x1" (success) or "0x0" (revert). */
export interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: Log[];
  logsBloom: string;
  status: string;
  [k: string]: unknown;
}

/** A block header + body (eth_getBlockByNumber / eth_getBlockByHash). */
export interface Block {
  number: string | null;
  hash: string | null;
  parentHash: string;
  nonce: string;
  timestamp: string;
  miner: string;
  gasLimit: string;
  gasUsed: string;
  /** tx hashes when full=false, full TransactionResponse objects when full=true */
  transactions: string[] | TransactionResponse[];
  [k: string]: unknown;
}

/** A log filter for eth_getLogs / eth_newFilter. */
export interface LogFilter {
  fromBlock?: string;
  toBlock?: string;
  address?: string | string[];
  /** topic matchers: a topic hash, an array (OR), or null (wildcard), positionally */
  topics?: (string | string[] | null)[];
  blockHash?: string;
}

/**
 * The Provider class is a low-level wrapper for making JSON-RPC requests to an NCOG chain node.
 * It handles request creation, error parsing, and provides convenience methods for all standard RPC calls.
 */
export class Provider {
  private url: string;
  private idCounter = 1;
  private requestMiddleware: ProviderRequestMiddleware[] = [];
  private responseMiddleware: ProviderResponseMiddleware[] = [];

  /**
   * Register a request middleware function. Called before sending each request.
   */
  useRequest(middleware: ProviderRequestMiddleware) {
    this.requestMiddleware.push(middleware);
  }

  /**
   * Register a response middleware function. Called after receiving each response.
   */
  useResponse(middleware: ProviderResponseMiddleware) {
    this.responseMiddleware.push(middleware);
  }

  /**
   * @param url The URL of the JSON-RPC endpoint (e.g., "http://localhost:8545").
   */
  constructor(url: string) {
    if (url.includes('http')) {
      const leftPart = url.split('//')[1];
      // guard: a malformed URL (no "//") leaves leftPart undefined — don't throw in the constructor.
      if (leftPart && leftPart.startsWith('wsapi')) {
        url = url + '/api';
      }
    }
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
    let payload = { jsonrpc: '2.0', id: this.idCounter++, method, params };
    // Apply request middleware
    for (const mw of this.requestMiddleware) {
      payload = await mw(payload);
    }
    try {
      const { data } = await axios.post(this.url, payload);
      let response = data;
      // Apply response middleware
      for (const mw of this.responseMiddleware) {
        response = await mw(response, payload);
      }
      if (response?.error) {
        throw new RpcError(response?.error?.message, response?.error?.code, response?.error?.data);
      }
      // Use the `result` field when present — even when it is a legitimate falsy value (false from
      // eth_syncing / net_listening, 0, "", null). `result || response` wrongly returned the whole envelope
      // for those.
      return normalizeResponse(response && 'result' in response ? response.result : response);
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new Error(`RPC request failed for method "${method}": ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Performs a batch of JSON-RPC requests. Returns an array of results/errors in the same order.
   * @param calls Array of { method, params } objects.
   * @returns Array of results or errors (in order).
   */
  async batchRpc(calls: { method: string; params?: any[] }[]): Promise<any[]> {
    if (!this.url) {
      throw new Error('Provider URL is not set');
    }
    let payloads = calls.map((call, i) => ({
      jsonrpc: '2.0',
      id: this.idCounter + i,
      method: call.method,
      params: call.params || []
    }));
    // Apply request middleware to each payload
    for (const mw of this.requestMiddleware) {
      payloads = await Promise.all(payloads.map(p => mw(p)));
    }
    try {
      const { data } = await axios.post(this.url, payloads);
      let results = Array.isArray(data) ? data : [data];
      // Apply response middleware to each result
      for (const mw of this.responseMiddleware) {
        results = await Promise.all(results.map((r, i) => mw(r, payloads[i])));
      }
      results.sort((a, b) => a.id - b.id);
      return results.map(res => {
        if (res.error) {
          return { error: res.error };
        }
        // Preserve legitimate falsy results (false/0/""/null) — see rpc() above.
        return normalizeResponse(res && 'result' in res ? res.result : res);
      });
    } catch (error) {
      return calls.map(() => ({ error: (error as any).message || error }));
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

  /**
   * Raw JSON-RPC call — sends `params` VERBATIM with no tx-oriented serialization. Use this for methods
   * whose params are plain JSON values (strings, arrays, structured objects with numeric fields), e.g. the
   * `ddb_*` namespace, where callRpc's serializeForRpc would mangle arrays and hex-encode numeric fields.
   */
  async send(method: string, params: any[] = []): Promise<any> {
    return this.rpc(method, params);
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
   * @deprecated Not implemented by NCOG nodes (there is no legacy eth protocol-version concept). Throws.
   */
  async protocolVersion(): Promise<string> {
    throw new Error('eth_protocolVersion is not supported on NCOG nodes');
  }

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
  async getBalance(address: string, tag = 'latest'): Promise<number> {
    const balance = await this.rpc('eth_getBalance', [address, tag]);
    const convertedBalance = weiToNec(balance);
    return isNaN(Number(convertedBalance)) ?  0 : Number(convertedBalance);
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
  async getBlockByNumber(tag: string, full = false): Promise<Block | null> {
    return this.rpc('eth_getBlockByNumber', [tag, full]);
  }

  /**
   * Returns a block matching the given block hash.
   * @param hash The hash of the block.
   * @param full If true, returns full transaction objects; otherwise, only transaction hashes.
   */
  async getBlockByHash(hash: string, full = false): Promise<Block | null> {
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
  async getTransactionByHash(hash: string): Promise<TransactionResponse | null> {
    return this.rpc('eth_getTransactionByHash', [hash]);
  }

  /**
   * Returns the receipt of a transaction by its hash (null until the tx is mined).
   * @param hash The hash of the transaction.
   */
  async getTransactionReceipt(hash: string): Promise<TransactionReceipt | null> {
    return this.rpc('eth_getTransactionReceipt', [hash]);
  }

  /**
   * Returns an array of all logs matching a given filter object (one-shot).
   * @param filter The filter object.
   */
  async getLogs(filter: LogFilter): Promise<Log[]> {
    return this.rpc('eth_getLogs', [serializeForRpc(filter)]);
  }

  // --- filters (HTTP poll-based event/log watching; WebSocket clients use Subscription) ---
  /** Install a log filter; returns the filter id. Poll it with getFilterChanges / getFilterLogs. */
  async newFilter(filter: LogFilter): Promise<string> {
    return this.rpc('eth_newFilter', [serializeForRpc(filter)]);
  }

  /** Install a filter that reports new block hashes; returns the filter id. */
  async newBlockFilter(): Promise<string> {
    return this.rpc('eth_newBlockFilter');
  }

  /** Install a filter that reports new pending-transaction hashes; returns the filter id. */
  async newPendingTransactionFilter(): Promise<string> {
    return this.rpc('eth_newPendingTransactionFilter');
  }

  /**
   * Poll a filter for what changed since the last poll. For a log filter this returns Log[]; for a block /
   * pending-tx filter it returns an array of 0x-hex hashes.
   */
  async getFilterChanges(filterId: string): Promise<Log[] | string[]> {
    return this.rpc('eth_getFilterChanges', [filterId]);
  }

  /** Return ALL logs matching a (log) filter id — the full set, not just the delta. */
  async getFilterLogs(filterId: string): Promise<Log[]> {
    return this.rpc('eth_getFilterLogs', [filterId]);
  }

  /** Tear down a filter. Returns true if it existed. */
  async uninstallFilter(filterId: string): Promise<boolean> {
    return this.rpc('eth_uninstallFilter', [filterId]);
  }

  /**
   * Poll-based log watcher for HTTP transports (WebSocket clients should use Subscription instead). Installs
   * an eth_newFilter, polls eth_getFilterChanges every `intervalMs` (default 4000), and invokes `onLogs` with
   * each non-empty batch. Resolves to an async `stop()` that uninstalls the filter and halts polling.
   */
  async watchLogs(
    filter: LogFilter,
    onLogs: (logs: Log[]) => void,
    opts: { intervalMs?: number; onError?: (e: unknown) => void } = {},
  ): Promise<() => Promise<void>> {
    const filterId = await this.newFilter(filter);
    const interval = opts.intervalMs ?? 4000;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const changes = await this.getFilterChanges(filterId);
        if (Array.isArray(changes) && changes.length) onLogs(changes as Log[]);
      } catch (e) {
        if (opts.onError) opts.onError(e);
      }
    }, interval);
    return async () => {
      stopped = true;
      clearInterval(timer);
      try { await this.uninstallFilter(filterId); } catch { /* best-effort */ }
    };
  }

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
   * @deprecated ML-DSA-87 has NO key recovery — the upgraded node removed personal_ecRecover entirely.
   * Use verifyMessage(data, signature, publicKey) instead, which requires the signer's public key.
   */
  async ecRecover(_data: string, _signature: string): Promise<string> {
    throw new Error(
      'ecRecover is not supported: ML-DSA-87 has no key recovery. Use verifyMessage(data, signature, publicKey) (personal_verifyMessage) with the signer public key.'
    );
  }

  /**
   * Verifies an ML-DSA-87 personal-message signature and returns the signer's address.
   * The public key MUST be supplied (there is no key recovery). Mirrors the node's
   * personal_verifyMessage(data, sig, pubkey).
   * @param data      The original message (utf-8 string or 0x-hex).
   * @param signature 0x-hex ML-DSA-87 signature.
   * @param publicKey 0x-hex raw ML-DSA-87 public key of the claimed signer.
   * @returns the recovered/verified signer address, or throws if the signature does not verify.
   */
  async verifyMessage(data: string, signature: string, publicKey: string): Promise<string> {
    return this.rpc('personal_verifyMessage', [data, signature, publicKey]);
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

  /**
   * Resolves an ENS-style name to an address via an ENS-compatible registry contract. NOTE: NCOG does not
   * ship a canonical ENS registry — you MUST pass the `registryAddress` of a deployed ENS-compatible
   * registry on your target chain. namehash is computed locally (no ethers dependency).
   * @param ensName The name to resolve (e.g., 'alice.nec').
   * @param registryAddress The ENS-compatible registry contract address (required on NCOG).
   * @returns The resolved address, or null if not found.
   */
  async resolveEnsName(ensName: string, registryAddress: string): Promise<string | null> {
    try {
      if (!registryAddress) return null;
      const node = ensNamehash(ensName);
      // ENS registry ABI: function resolver(bytes32 node) external view returns (address)
      const data = '0x0178b8bf' + node.replace(/^0x/, ''); // resolver(bytes32) selector + node
      const callObj = { to: registryAddress, data };
      const resolverAddr = await this.call(callObj);
      if (!resolverAddr || resolverAddr === '0x' || /^0x0+$/.test(resolverAddr)) return null;
      // ENS resolver ABI: function addr(bytes32 node) external view returns (address)
      const addrSelector = '0x3b3b57de';
      const data2 = addrSelector + node.replace(/^0x/, '');
      const callObj2 = { to: resolverAddr, data: data2 };
      const address = await this.call(callObj2);
      if (!address || address === '0x' || /^0x0+$/.test(address)) return null;
      return address;
    } catch (err) {
      return null;
    }
  }
}