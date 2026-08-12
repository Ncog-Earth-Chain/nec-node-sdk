# Extension Function Reference

This document provides detailed information about all functions available in the NEC Node SDK Extension module for browser extension wallet integration.

## Interfaces

### TxParams Interface

**Structure:**
```typescript
interface TxParams {
  from: string;
  nonce: any;
  gasPrice: string;
  gasLimit?: string;
  gas?: string;
  to: string;
  value?: string;
  data?: string;
  chainId?: number;
}
```

**Description:** Defines the parameters for a transaction to be sent via an extension.

**Properties:**
- `from` (string): Sender address
- `nonce` (any): Transaction nonce
- `gasPrice` (string): Gas price in wei
- `gasLimit` (string, optional): Gas limit
- `gas` (string, optional): Gas amount
- `to` (string): Recipient address
- `value` (string, optional): Transaction value
- `data` (string, optional): Transaction data
- `chainId` (number, optional): Chain ID

### InjectedProvider Interface

**Structure:**
```typescript
interface InjectedProvider {
  request(args: { method: string; params?: any[] }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): void;
}
```

**Description:** Describes the interface for an injected NCOG wallet provider (e.g., from a browser extension).

**Methods:**
- `request(args)`: Sends a request to the wallet
- `on(event, listener)`: Subscribes to wallet events (optional)

## ExtensionSigner Class

### Constructor

**Function:** `constructor(injected: InjectedProvider, provider: Provider)`

**Description:** Creates a new ExtensionSigner instance that wraps an injected browser extension wallet.

**Input Parameters:**
- `injected` (InjectedProvider): The injected provider object from the browser (e.g., `window.ncogWallet`)
- `provider` (Provider): A read-only Provider instance for querying blockchain data

**Response:** Creates a new ExtensionSigner instance

**Example:**
```typescript
const signer = new ExtensionSigner(window.ncogWallet, provider);
```

### Methods

#### getAddress

**Function:** `async getAddress(): Promise<string>`

**Description:** Retrieves the currently selected address from the extension wallet.

**Input Parameters:** None

**Response:** Promise<string> - The user's account address

**Error Handling:**
- Throws Error if no account is selected or available

**Example:**
```typescript
const address = await signer.getAddress();
console.log('Selected address:', address);
```

#### on

**Function:** `on(event: string, listener: (...args: any[]) => void): void`

**Description:** Registers a listener for an event from the wallet (e.g., 'accountsChanged', 'chainChanged').

**Input Parameters:**
- `event` (string): The name of the event
- `listener` (function): The callback function to execute when the event fires

**Response:** void

**Example:**
```typescript
signer.on('accountsChanged', (accounts) => {
  console.log('Accounts changed:', accounts);
});
```

#### sendTransaction

**Function:** `async sendTransaction(tx: TxParams): Promise<string>`

**Description:** Signs and sends a transaction through the extension wallet. The wallet will prompt the user for confirmation.

**Input Parameters:**
- `tx` (TxParams): The transaction parameters

**Response:** Promise<string> - Transaction hash

**Error Handling:**
- Throws Error if no address is selected
- Throws Error if required fields are missing
- Throws Error if extension request fails

**Example:**
```typescript
const txHash = await signer.sendTransaction({
  to: '0x1234567890123456789012345678901234567890',
  value: '0x1000000000000000000', // 1 ETH
  gasPrice: '0x09184e72a000'
});
console.log('Transaction hash:', txHash);
```

## Usage Examples

### Basic Extension Setup

```typescript
import { ExtensionSigner } from '@ncog/necjs';
import { Provider } from './provider';

// Create provider
const provider = new Provider('https://mainnet.infura.io/v3/YOUR_PROJECT_ID');

// Create extension signer
const signer = new ExtensionSigner(window.ncogWallet, provider);

// Get selected address
const address = await signer.getAddress();
console.log('Connected address:', address);
```

### Transaction Sending

```typescript
// Send a transaction
const txParams = {
  to: '0x1234567890123456789012345678901234567890',
  value: '0x1000000000000000000', // 1 ETH
  gasPrice: '0x09184e72a000',
  gasLimit: '0x5208'
};

try {
  const txHash = await signer.sendTransaction(txParams);
  console.log('Transaction sent:', txHash);
} catch (error) {
  console.error('Transaction failed:', error);
}
```

### Event Listening

```typescript
// Listen for account changes
signer.on('accountsChanged', (accounts) => {
  console.log('Account changed to:', accounts);
});

// Listen for chain changes
signer.on('chainChanged', (chainId) => {
  console.log('Chain changed to:', chainId);
});
```

### Error Handling

```typescript
async function sendTransactionSafely(txParams) {
  try {
    // Check if wallet is connected
    const address = await signer.getAddress();
    console.log('Using address:', address);
    
    // Send transaction
    const txHash = await signer.sendTransaction(txParams);
    return txHash;
  } catch (error) {
    if (error.message.includes('No account found')) {
      console.error('Please connect your wallet first');
    } else if (error.message.includes('Missing required')) {
      console.error('Transaction parameters are incomplete');
    } else {
      console.error('Transaction failed:', error.message);
    }
    throw error;
  }
}
``` 