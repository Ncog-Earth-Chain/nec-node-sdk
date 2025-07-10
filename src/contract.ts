import { Provider } from './provider';
import { ExtensionSigner, TxParams } from './extension'; // Using ExtensionSigner for now
import { Interface } from 'ethers';

// A more generic Signer interface would be ideal for long-term flexibility
// export interface ISigner {
//   getAddress(): Promise<string>;
//   sendTransaction(tx: TxParams): Promise<string>;
// }

/**
 * Represents a smart contract on the blockchain, providing methods to call and send transactions.
 */
export class Contract {
  private provider: Provider;
  public readonly address: string;
  public readonly abiInterface: Interface;

  /**
   * @param address The address of the smart contract.
   * @param abi The Application Binary Interface (ABI) of the contract.
   * @param provider A Provider instance to interact with the blockchain.
   */
  constructor(address: string, abi: any[], provider: Provider) {
    this.address = address;
    this.abiInterface = new Interface(abi);
    this.provider = provider;
  }

  /**
   * Executes a read-only (`view` or `pure`) function of the contract.
   * @param method The name of the contract method to call.
   * @param params An array of arguments for the method.
   * @returns A promise that resolves to the decoded result of the function call.
   */
  async call(method: string, params: any[] = []): Promise<any> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    const result = await this.provider.call({ to: this.address, data }, 'latest');
    // The result from a `call` might be empty or '0x', handle it gracefully.
    if (!result || result === '0x') {
      try {
        // Attempt to decode, may throw if there are no outputs
        return this.abiInterface.decodeFunctionResult(method, result);
      } catch (e) {
        // If decoding fails on an empty result, it likely means a function with no return value was called.
        // Returning an empty array is a safe default.
        return [];
      }
    }
    const decodedResult = this.abiInterface.decodeFunctionResult(method, result);
    // If the result has a single value, return it directly for convenience.
    return decodedResult.length === 1 ? decodedResult[0] : decodedResult;
  }

  /**
   * Sends a transaction to execute a state-changing function of the contract.
   * @param method The name of the contract method to send a transaction to.
   * @param params An array of arguments for the method.
   * @param signer An ExtensionSigner instance to sign and send the transaction.
   * @param overrides Transaction parameters to override (e.g., value, gasLimit, gasPrice).
   * @returns A promise that resolves to the transaction hash.
   */
  async send(method: string, params: any[], signer: ExtensionSigner, overrides: Partial<TxParams>): Promise<string> {
    const data = this.abiInterface.encodeFunctionData(method, params);
    
    const baseTx = {
      to: this.address,
      data,
      value: '0x0', // Default value to 0
    };

    // Combine base transaction with overrides
    const tx = { ...baseTx, ...overrides } as TxParams;

    // Ensure required fields are present
    if (!tx.gasLimit || !tx.gasPrice || !tx.chainId) {
        throw new Error("Missing required transaction fields: gasLimit, gasPrice, and chainId must be provided in overrides.");
    }
    
    return signer.sendTransaction(tx);
  }
}