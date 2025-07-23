import { Provider } from './provider';
import { serializeForRpc, normalizeResponse } from './utils';

/**
 * Defines the parameters for a transaction to be sent via an extension.
 */
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

/**
 * Describes the interface for an injected NCOG wallet provider (e.g., from a browser extension).
 */
export interface InjectedProvider {
  /**
   * Sends a request to the wallet.
   * @param args The request arguments, including method and parameters.
   */
  request(args: { method: string; params?: any[] }): Promise<any>;
  /**
   * Subscribes to events emitted by the wallet.
   * @param event The event name (e.g., 'accountsChanged').
   * @param listener The callback function.
   */
  on?(event: string, listener: (...args: any[]) => void): void;
}

/**
 * A Signer implementation that wraps an injected browser extension wallet.
 */
export class ExtensionSigner {
  /**
   * @param injected The injected provider object from the browser (e.g., `window.ncogWallet`).
   * @param provider A read-only `Provider` instance for querying blockchain data.
   */
  constructor(private injected: InjectedProvider, private provider: Provider) {}

  /**
   * Retrieves the currently selected address from the extension wallet.
   * @returns A promise that resolves to the user's account address.
   * @throws {Error} if no account is selected or available.
   */
  async getAddress(): Promise<string> {
    // Note: The method 'ncog_accounts' is hypothetical. Adjust to the actual extension's API.

    const accounts = await this.injected.request({ method: 'ncog_accounts' });
    // The result of eth_requestAccounts is typically an array of addresses.
    if (!accounts || !accounts?.selectedAccount || !accounts?.selectedAccount?.accountAddress ) {
      throw new Error('No account found. Please connect your wallet.');
    }

    return accounts?.selectedAccount?.accountAddress;
  }

  /**
   * Registers a listener for an event from the wallet (e.g., 'accountsChanged', 'chainChanged').
   * @param event The name of the event.
   * @param listener The callback function to execute when the event fires.
   */
  on(event: string, listener: (...args: any[]) => void): void {
    if (this.injected.on) {
      this.injected.on(event, listener);
    } else {
      console.warn('The injected wallet provider does not support event listening via .on()');
    }
  }

  /**
 * Signs and sends a transaction through the extension wallet.
 * The wallet will prompt the user for confirmation.
 * @param tx The transaction parameters.
 * @returns A promise that resolves to the transaction hash.
 */
  async sendTransaction(tx: TxParams): Promise<string> {
    const from = await this.getAddress();
    if (!from) {
      throw new Error("Cannot send transaction: no address is selected in the wallet.");
    }

    // Required fields validation
    const requiredFields = ['to', 'value', 'gasPrice'];
    for (const field of requiredFields) {
      if (!tx[field as keyof TxParams] || (typeof tx[field as keyof TxParams] === 'string' && tx[field as keyof TxParams] === '')) {
        throw new Error(`Missing required transaction field: ${field}`);
      }
    }

    if (!tx.chainId) {
      tx.chainId = await this.provider.getChainId();
    }

    // Only include acceptable fields
    const txParams: Record<string, any> = {
      from,
      to: tx.to,
      value: tx.value,
    };
    if (tx.data !== undefined) txParams.data = tx.data;
    if (tx.gasLimit !== undefined) txParams.gas = tx.gasLimit;
    if (tx.gasPrice !== undefined) txParams.gasPrice = tx.gasPrice;
    if (tx.chainId !== undefined) txParams.chainId = tx.chainId;
    if (tx.nonce !== undefined) txParams.nonce = tx.nonce;
    if (tx.gas !== undefined) txParams.gas = tx.gas;

    // Try MLDSA87 signing if supported
    if (typeof this.injected.request === 'function') {
      try {
        const sendResponse = await this.injected.request({ method: 'ncog_sendTransaction', params: [txParams] });
        return normalizeResponse(sendResponse.result || sendResponse) as string;

      } catch (err) {
        throw new Error('Extension does not sendResponse failed: ' + err);
      }
    }
    throw new Error('Injected provider does sendResponse');
  }
}