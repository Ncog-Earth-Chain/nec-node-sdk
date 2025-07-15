import { Provider } from './provider';
import { TxParams } from './extension';
import { Interface, Fragment, FunctionFragment } from 'ethers';
import { serializeForRpc, normalizeResponse, hexToDecimalString } from './utils';
import axios from 'axios';
import { Subscription } from './subscription';

// Generic signer interface for extension and wallet based signers
export interface ISigner {
  sendTransaction(tx: TxParams): Promise<string>;
  getAddress?(): Promise<string>;
}

export function mergeArrayAndKeys(decoded: any, outputs: ReadonlyArray<any>): any {
  // If outputs are named, merge both index and key access
  if (outputs.length > 0 && outputs.every(o => o.name)) {
    const result: any = {};
    outputs.forEach((o, i) => {
      result[i] = decoded[i];
      if (o.name) result[o.name] = decoded[i];
    });
    // If decoded is a Proxy/Result, also copy any extra properties
    for (const key in decoded) {
      if (!result.hasOwnProperty(key)) {
        result[key] = decoded[key];
      }
    }
    return result;
  }
  // If only one output, return it directly
  if (decoded.length === 1) {
    return decoded[0];
  }
  // Otherwise, return as array
  return Array.from(decoded);
}

/**
 * Recursively convert ethers.js Result/Proxy (including nested arrays/structs) to plain objects using ABI outputs.
 * If outputs are provided, use them to map arrays/tuples to named objects.
 */
export function toPlainObject(result: any, outputs?: any): any {
  // If outputs is an array (for tuple[] or array of structs)
  if (Array.isArray(result) && outputs && outputs.baseType === 'array' && outputs.arrayChildren) {
    // Map each element using the tuple definition
    return result.map((item: any) => toPlainObject(item, outputs.arrayChildren));
  }

  // If outputs is a tuple (struct)
  if (Array.isArray(result) && outputs && outputs.baseType === 'tuple' && Array.isArray(outputs.components)) {
    const obj: any = {};
    outputs.components.forEach((comp: any, i: number) => {
      obj[comp.name] = toPlainObject(result[i], comp);
    });
    return obj;
  }
  // If result is an array but no ABI info, just map recursively
  if (Array.isArray(result)) {
    return result.map((item: any) => toPlainObject(item));
  }

  // If result is an object (ethers.js Result/Proxy)
  if (result && typeof result === 'object') {
    const obj: any = {};
    for (const key in result) {
      if (
        Object.prototype.hasOwnProperty.call(result, key) &&
        isNaN(Number(key)) &&
        typeof result[key] !== 'function'
      ) {
        obj[key] = toPlainObject(result[key]);
      }
    }
    return Object.keys(obj).length ? obj : result;
  }
  return result;
}

/**
 * Represents a smart contract on the blockchain, providing methods to call and send transactions.
 * Now supports web3.js-style dynamic method calls: contract.methods.myMethod(...args).call(), .send(), .estimateGas()
 */
export class Contract {
  public provider: Provider;
  private signer?: ISigner; // Add signer property
  public readonly address: string;
  public readonly abiInterface: Interface;
  public readonly methods: Record<string, (...args: any[]) => {
    call: (options?: Record<string, any>) => Promise<any>;
    send: (options: Record<string, any>) => Promise<string>;
    estimateGas: (options?: Record<string, any>) => Promise<number>;
  }> = {};
  public readonly events: Record<string, (options?: { fromBlock?: string | number; toBlock?: string | number; filter?: Record<string, any> }) => EventStream> = {};

  constructor(address: string, abi: any[], provider: Provider, signer?: ISigner) {
    this.address = address;
    this.abiInterface = new Interface(abi);
    this.provider = provider;
    this.signer = signer;

    for (const fragment of this.abiInterface.fragments) {
      if (fragment.type === 'function') {
        const methodName = (fragment as Fragment & { name: string }).name;
        this.methods[methodName] = (...args: any[]) => ({
          call: (options: Record<string, any> = {}) => this.call(methodName, args, options),
          send: (options: Record<string, any>) => this.send(methodName, args, options),
          estimateGas: (options: Record<string, any> = {}) => this.estimateGas(methodName, args, options)
        });
      }
      if (fragment.type === 'event') {
        const eventName = (fragment as Fragment & { name: string }).name;
        this.events[eventName] = (options = {}) => new EventStream(this, eventName, options);
      }
    }
  }

  async call(method: string, params: any[] = [], options: Record<string, any> = {}): Promise<any> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    const tx = { to: this.address, data, ...options };
    const result = await this.provider.call(tx, 'latest');

    // Patch: If result is 0 (from hexToDecimalString), convert back to '0x' for decodeFunctionResult
    let decodeInput = result;
    if (typeof decodeInput === 'number' && decodeInput === 0) {
      decodeInput = '0x';
    }

    // Always decode using ethers.js for all output types
    const fragment = this.abiInterface.getFunction(method) as FunctionFragment;
    const outputs = fragment.outputs || [];

    // If result is '0x' and outputs are expected, handle gracefully
    if ((decodeInput === '0x' || decodeInput === '0x0' || decodeInput === '') && outputs.length > 0) {
      return [];
    }

    const decoded = this.abiInterface.decodeFunctionResult(method, decodeInput);

    // Always return as deeply plain object or array (user-readable)
    // Use ABI outputs[0] for top-level output if present
    if (outputs.length === 1) {
      return toPlainObject(mergeArrayAndKeys(decoded, outputs), outputs[0]);
    }
    return toPlainObject(mergeArrayAndKeys(decoded, outputs));
  }

  async send(method: string, params: any[], options: Record<string, any>): Promise<string> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    const tx = { to: this.address, data, value: '0x0', ...options };
    // If signer is present, use it for MLDSA87 signing (wallet or extension)
    if (this.signer) {
      // The signer expects a TxParams object; ensure required fields are present
      // (ExtensionSigner and Wallet.Signer both expect similar fields)
      return this.signer.sendTransaction(tx as any);
    }
    // Fallback: Use provider's sendTransaction (from must be unlocked)
    const rpcTx = serializeForRpc(tx);
    return this.provider.sendTransaction(rpcTx as { from?: string; to: string; gas?: string; gasPrice?: string; value?: string; data?: string; });
  }

  async estimateGas(method: string, params: any[] = [], options: Record<string, any> = {}): Promise<number> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    const tx = { to: this.address, data, ...options };
    const rpcTx = serializeForRpc(tx);
    return this.provider.estimateGas(rpcTx as { from?: string; to: string; gas?: string; gasPrice?: string; value?: string; data?: string; });
  }

  /**
   * Deploy a new contract to the blockchain.
   * @param abi The contract ABI
   * @param bytecode The contract bytecode (0x...)
   * @param provider The Provider instance
   * @param deployer The address or signer sending the deployment
   * @param constructorArgs Arguments for the contract constructor
   * @param options Additional tx options (gas, gasPrice, value, nonce, etc.)
   * @returns The transaction hash of the deployment
   */
  static async deploy({
    abi,
    bytecode,
    provider,
    deployer,
    constructorArgs = [],
    options = {}
  }: {
    abi: any[];
    bytecode: string;
    provider: Provider;
    deployer: string | ISigner;
    constructorArgs?: any[];
    options?: Record<string, any>;
  }): Promise<{ contractAddress: string, txHash: string, receipt: any }> {
    const abiInterface = new Interface(abi);
    let data = bytecode;
    if (constructorArgs && constructorArgs.length > 0) {
      data += abiInterface.encodeDeploy(constructorArgs).slice(2); // remove 0x
    }
    const tx: Record<string, any> = {
      data,
      ...options,
    };
    let txHash: string;
    if (typeof deployer === 'string') {
      tx['from'] = deployer;
      // Use provider's sendTransaction (from must be unlocked)
      txHash = await provider.sendTransaction(tx);
    } else if (deployer && typeof deployer.sendTransaction === 'function') {
      // Use ISigner interface
      txHash = await deployer.sendTransaction(tx as any);
    } else {
      throw new Error('Invalid deployer: must be address string or ISigner');
    }
    // Wait for the transaction to be mined and get the receipt
    let receipt: any = null;
    for (let i = 0; i < 60; i++) { // up to ~60s
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt && receipt.contractAddress) break;
      await new Promise(res => setTimeout(res, 1000));
    }
    if (!receipt || !receipt.contractAddress) {
      throw new Error('Deployment transaction was not mined or contract address not found in receipt.');
    }
    return { contractAddress: receipt.contractAddress, txHash, receipt };
  }

  /**
   * Verify a contract on a block explorer (e.g., Etherscan-compatible API).
   * @param params Verification parameters (API URL, API key, contract address, source, etc.)
   * @returns The verification result from the explorer
   */
  static async verify(params: {
    apiUrl: string;
    apiKey: string;
    contractAddress: string;
    sourceCode: string;
    contractName: string;
    compilerVersion: string;
    constructorArguments?: string;
    optimizationUsed?: boolean;
    runs?: number;
    licenseType?: string;
    [key: string]: any;
  }): Promise<any> {
    const {
      apiUrl,
      apiKey,
      contractAddress,
      sourceCode,
      contractName,
      compilerVersion,
      constructorArguments = '',
      optimizationUsed = false,
      runs = 200,
      licenseType = 'None',
      ...rest
    } = params;
    const payload = {
      apikey: apiKey,
      module: 'contract',
      action: 'verifysourcecode',
      contractaddress: contractAddress,
      sourceCode,
      contractname: contractName,
      compilerversion: compilerVersion,
      constructorArguements: constructorArguments,
      optimizationUsed: optimizationUsed ? 1 : 0,
      runs,
      licenseType,
      ...rest
    };
    const response = await axios.post(apiUrl, payload);
    return response.data;
  }
}

/**
 * EventStream provides a web3.js-compatible event stream for contract events.
 * Usage: contract.events.MyEvent({ fromBlock, toBlock, filter }).on('data', handler)
 */
export class EventStream {
  private contract: Contract;
  private eventName: string;
  private options: { fromBlock?: string | number; toBlock?: string | number; filter?: Record<string, any> };
  private subscription?: Subscription;
  private listeners: { [event: string]: Function[] } = {};
  private active = false;

  constructor(contract: Contract, eventName: string, options: { fromBlock?: string | number; toBlock?: string | number; filter?: Record<string, any> }) {
    this.contract = contract;
    this.eventName = eventName;
    this.options = options;
  }

  on(event: 'data' | 'changed' | 'error', handler: Function): this {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
    if (event === 'data' && !this.active) this.start();
    return this;
  }

  off(event: 'data' | 'changed' | 'error', handler: Function): this {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(h => h !== handler);
    }
    return this;
  }

  private emit(event: 'data' | 'changed' | 'error', ...args: any[]) {
    if (this.listeners[event]) {
      for (const handler of this.listeners[event]) handler(...args);
    }
  }

  private async start() {
    this.active = true;
    const iface = this.contract.abiInterface;
    const eventFragment = iface.getEvent(this.eventName);
    if (!eventFragment) {
      this.emit('error', new Error('Event fragment not found for ' + this.eventName));
      return;
    }
    const { id: keccak256 } = require('ethers').utils;
    const topic = keccak256(`event ${eventFragment.format()}`);
    const filter = {
      address: this.contract.address,
      topics: [topic],
      ...this.options.filter,
      fromBlock: this.options.fromBlock || 'latest',
      toBlock: this.options.toBlock || 'latest',
    };
    this.subscription = new Subscription((this.contract.provider as any).url.replace(/^http/, 'ws'));
    await this.subscription.connect();
    const subId = await this.subscription.subscribe('logs', [filter], (log: any) => {
      try {
        const parsed = iface.parseLog(log);
        if (parsed) {
          this.emit('data', { ...log, event: this.eventName, returnValues: parsed.args });
        }
      } catch (err) {
        this.emit('error', err);
      }
    });
  }

  async stop() {
    this.active = false;
    if (this.subscription) {
      await this.subscription.disconnect();
      this.subscription = undefined;
    }
  }
}