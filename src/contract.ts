import { Provider } from './provider';
import { TxParams } from './extension';
import { Interface, Fragment, FunctionFragment } from 'ethers';
import { serializeForRpc, normalizeResponse, hexToDecimalString } from './utils';
import axios from 'axios';

// Generic signer interface for extension and wallet based signers
export interface ISigner {
  sendTransaction(tx: TxParams): Promise<string>;
  getAddress?(): Promise<string>;
}

/**
 * Represents a smart contract on the blockchain, providing methods to call and send transactions.
 * Now supports web3.js-style dynamic method calls: contract.methods.myMethod(...args).call(), .send(), .estimateGas()
 */
export class Contract {
  private provider: Provider;
  public readonly address: string;
  public readonly abiInterface: Interface;
  public readonly methods: Record<string, (...args: any[]) => {
    call: (options?: Record<string, any>) => Promise<any>;
    send: (options: Record<string, any>) => Promise<string>;
    estimateGas: (options?: Record<string, any>) => Promise<number>;
  }> = {};

  constructor(address: string, abi: any[], provider: Provider) {
    this.address = address;
    this.abiInterface = new Interface(abi);
    this.provider = provider;

    for (const fragment of this.abiInterface.fragments) {
      if (fragment.type === 'function') {
        const methodName = (fragment as Fragment & { name: string }).name;
        this.methods[methodName] = (...args: any[]) => ({
          call: (options: Record<string, any> = {}) => this.call(methodName, args, options),
          send: (options: Record<string, any>) => this.send(methodName, args, options),
          estimateGas: (options: Record<string, any> = {}) => this.estimateGas(methodName, args, options)
        });
      }
    }
  }

  async call(method: string, params: any[] = [], options: Record<string, any> = {}): Promise<any> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    const tx = { to: this.address, data, ...options };
    const result = await this.provider.call(tx, 'latest');

    // Always decode using ethers.js for all output types
    const decoded = this.abiInterface.decodeFunctionResult(method, result);
    const fragment = this.abiInterface.getFunction(method) as FunctionFragment;
    const outputs = fragment.outputs || [];

    // If outputs are named, return a plain object with named keys
    if (outputs.length > 0 && outputs.every(o => o.name)) {
      const obj: any = {};
      outputs.forEach((o, i) => {
        obj[o.name] = decoded[i];
      });
      return obj;
    }
    // If only one output, return it directly
    if (decoded.length === 1) {
      return decoded[0];
    }
    // Otherwise, return the array
    return decoded;
  }

  async send(method: string, params: any[], options: Record<string, any>): Promise<string> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    const tx = { to: this.address, data, value: '0x0', ...options };
    const rpcTx = serializeForRpc(tx);
    // Use provider's sendTransaction (web3js style: from must be unlocked)
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