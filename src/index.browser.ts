// Browser-specific entry point - no Node.js imports
export { Provider } from './provider';
export { Wallet, Signer, TxParams } from './wallet.browser';
export { Contract } from './contract';
export { InjectedProvider, ExtensionSigner } from './extension';
export { ContractFactory } from './contract-factory';
export { Subscription } from './subscription';
export { hexToDecimalString, decimalToHex, parseUnits, etherToWeiHex, hexToEther, formatUnits, hexToNec, necToHex, weiToNec, serializeForRpc, normalizeResponse, isValidAddress, decimalToWei } from './utils';
export { getAllTransactions, getAllTokens } from './graphql';

// Browser-specific MLKEM exports
export { loadWasm, loadWasmFromBuffer, type MlKemBrowser } from './webassembly/mlkem-browser';

// Re-export browser interface as the main MLKEM type
export type { MlKemBrowser as MlKem } from './webassembly/mlkem-browser'; 