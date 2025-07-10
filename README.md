# NCOG BLOCKCHAIN SDK

A lightweight and modern TypeScript SDK for interacting with the NCOG Earth Chain or any EVM-compatible blockchain. It provides a robust JSON-RPC Provider, a powerful Contract abstraction, and seamless integration with browser extension wallets.

This SDK also includes a WebAssembly (WASM) module for post-quantum cryptographic operations (ML-KEM), making it a forward-looking choice for dApp development.

## Features

-   **Type-Safe:** Fully written in TypeScript for a better development experience.
-   **Modern & Promise-based:** Built with `async/await` for clean and readable asynchronous code.
-   **Lightweight:** Minimal dependencies, keeping your application bundle size small.
-   **Provider:** A robust JSON-RPC wrapper for all standard Ethereum methods (`eth_*`, `net_*`, etc.).
-   **Contract Interaction:** An intuitive `Contract` class that uses a contract's ABI to easily call methods and send transactions.
-   **Browser Wallet Support:** The `ExtensionSigner` class makes it simple to connect with injected browser wallets like NCOG Wallet or MetaMask.
-   **Post-Quantum Utilities:** Includes a standalone WASM module for ML-KEM key generation, encryption, and decryption.

## Installation

```bash
npm install ncog
```

### Browser Support

The SDK now supports browser environments! For browser usage, see [BROWSER_USAGE.md](./BROWSER_USAGE.md) for detailed instructions.

**Quick browser setup:**
```html
<!-- Include the Go WASM runtime -->
<script src="https://unpkg.com/ncog@latest/dist/wasm_exec.js"></script>

<!-- Include the SDK -->
<script src="https://unpkg.com/ncog@latest/dist/index.umd.js"></script>

<script>
  const { loadWasm, Provider, Wallet } = Ncog;
  
  // Initialize MLKEM
  loadWasm().then(mlkem => {
    console.log('NCOG SDK ready!');
  });
</script>
```

## Core Concepts

1.  **`Provider`**: Your read-only connection to the blockchain. It wraps the JSON-RPC API, allowing you to query block data, account balances, transaction receipts, and more.
2.  **`ExtensionSigner`**: A signer that connects to a browser extension wallet (e.g., `window.ncogProvider`). It allows your dApp to request the user's address and ask them to sign and send transactions, without ever handling their private keys directly.
3.  **`Contract`**: A high-level abstraction that represents a specific smart contract on the chain. You instantiate it with the contract's address and ABI, and it provides methods to easily `call` (read) or `send` (write) to the contract's functions.

## Quickstart: A Complete dApp Example

This example demonstrates how to connect to the NCOG chain, get the user's account from a browser wallet, read data from a smart contract, and send a transaction to it.

```typescript
import { Provider, ExtensionSigner, Contract } from 'ncog';

// --- Sample Contract Details ---
const ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];
const
CONTRACT_ADDRESS = '0x...'; // Replace with your contract's address
const CHAIN_ID = 1; // Replace with your chain's ID

// 1. Set up a provider connected to an NCOG node
const provider = new Provider('http://localhost:8545');

// 2. Connect to the browser's injected wallet (e.g., window.ncogProvider)
const getSigner = () => {
  if (!window.ncogProvider) {
    alert('Wallet not found! Please install a browser extension like NCOG Wallet.');
    throw new Error("Wallet not found");
  }
  return new ExtensionSigner(window.ncogProvider, provider);
};

// 3. Main application logic
async function main() {
  try {
    const signer = getSigner();
    
    // Request to connect and get the user's address
    const address = await signer.getAddress();
    console.log('Connected address:', address);

    // Get the native token balance of the connected account
    const balance = await provider.getBalance(address);
    console.log('Native Balance (in Wei):', balance);

    // --- Interact with a Smart Contract ---
    
    // Create a contract instance
    const myTokenContract = new Contract(CONTRACT_ADDRESS, ABI, provider);

    // Call a read-only (view) function
    const tokenName = await myTokenContract.call('name');
    const tokenBalance = await myTokenContract.call('balanceOf', [address]);
    console.log(`Token Name: ${tokenName}`);
    console.log(`Your Token Balance: ${tokenBalance.toString()}`);

    // Send a transaction to a state-changing function
    console.log('Sending a transaction to transfer tokens...');
    const recipientAddress = '0x...'; // Replace with a valid recipient
    const amountToSend = '1000000000000000000'; // 1 token with 18 decimals

    const txHash = await myTokenContract.send(
      'transfer', 
      [recipientAddress, amountToSend], 
      signer,
      { // Transaction Overrides
        gasPrice: '0x4A817C800', // 20 Gwei
        gasLimit: '0x186A0',     // 100,000 gas
        chainId: CHAIN_ID
      }
    );

    console.log('Transaction sent! Hash:', txHash);
    console.log('Waiting for receipt...');

    const receipt = await provider.getTransactionReceipt(txHash);
    console.log('Transaction confirmed!', receipt);

  } catch (error) {
    console.error('An error occurred:', error);
  }
}

// Run the app
main();


## API Reference

### `Provider`

The `Provider` is your connection to the blockchain's JSON-RPC API.

```ts
import { Provider } from 'ncog';
const provider = new Provider('http://localhost:8545');

// Get the latest block number
const blockNumber = await provider.getBlockNumber();

// Get the balance of an address
const balance = await provider.getBalance('0xYourAddress...');

// Make a generic RPC call
const clientVersion = await provider.callRpc('web3_clientVersion');
```

### `ExtensionSigner`

The `ExtensionSigner` allows your dApp to request signatures and send transactions via a browser extension wallet.

```ts
import { ExtensionSigner, Provider } from 'ncog';

const provider = new Provider('http://localhost:8545');
const signer = new ExtensionSigner(window.ncogProvider, provider);

// Request connection and get the selected address
// This will trigger the wallet connection prompt for the user.
const address = await signer.getAddress();

// Send a native token transaction
const txHash = await signer.sendTransaction({
  to: '0xRecipientAddress...',
  value: '0xDE0B6B3A7640000', // 1 ETH in Wei
  gasPrice: '0x4A817C800',
  gasLimit: '0x5208',
  data: '0x',
  chainId: 1,
});

// Listen for events
signer.on('chainChanged', (chainId) => console.log('Network changed to:', chainId));
```

### `Contract`

The `Contract` class simplifies interaction with deployed smart contracts.

```ts
import { Contract, Provider, ExtensionSigner } from 'ncog';

const contractAbi = [ /* ... Your contract's ABI array or human-readable ABI ... */ ];
const contractAddress = '0xYourContractAddress...';
const provider = new Provider('http://localhost:8545');
const signer = new ExtensionSigner(window.ncogProvider, provider);

const myContract = new Contract(contractAddress, contractAbi, provider);

// Read-only call
const someValue = await myContract.call('getSomeValue', [/* args */]);

// Write transaction (state-changing)
const txHash = await myContract.send(
  'setSomeValue', 
  [/* args */], 
  signer, 
  { gasLimit: '100000', /* ... other overrides ... */ }
);
```

## Development

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Build the project: `npm run build`
4.  Run tests: `npm run test`