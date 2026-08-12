# Contract Function Reference

This document provides detailed information about all functions available in the NEC Node SDK Contract module for smart contract interactions.

## Interfaces

### ISigner Interface

**Structure:**
```typescript
interface ISigner {
  sendTransaction(tx: TxParams): Promise<string>;
  getAddress?(): Promise<string>;
}
```

**Description:** Generic signer interface for extension and wallet based signers.

**Methods:**
- `sendTransaction(tx)`: Sends a transaction
- `getAddress()`: Gets the signer's address (optional)

## Utility Functions

### mergeArrayAndKeys

**Function:** `mergeArrayAndKeys(decoded: any, outputs: ReadonlyArray<any>): any`

**Description:** Merges decoded function results with ABI output definitions to provide both index and key access.

**Input Parameters:**
- `decoded` (any): Decoded function result
- `outputs` (ReadonlyArray<any>): ABI output definitions

**Response:** any - Merged result with both index and named access

**Example:**
```typescript
const result = mergeArrayAndKeys(decodedData, abiOutputs);
console.log(result[0]); // Index access
console.log(result.name); // Named access
```

### toPlainObject

**Function:** `toPlainObject(result: any, outputs?: any): any`

**Description:** Recursively converts ethers.js Result/Proxy objects to plain objects using ABI outputs.

**Input Parameters:**
- `result` (any): Result to convert
- `outputs` (any, optional): ABI output definitions

**Response:** any - Plain object representation

**Example:**
```typescript
const plainResult = toPlainObject(ethersResult, abiOutputs);
```

## Contract Class

### Constructor

**Function:** `constructor(address: string, abi: any[], provider: Provider, signer?: ISigner)`

**Description:** Creates a new Contract instance for smart contract interactions.

**Input Parameters:**
- `address` (string): Contract address
- `abi` (any[]): Contract ABI
- `provider` (Provider): Provider instance
- `signer` (ISigner, optional): Signer for transactions

**Response:** Creates a new Contract instance

**Example:**
```typescript
const contract = new Contract(address, abi, provider, signer);
```

### Properties

- `provider` (Provider): Provider instance
- `address` (string): Contract address
- `abiInterface` (Interface): Ethers.js interface
- `methods` (Record<string, Function>): Dynamic method objects
- `events` (Record<string, Function>): Dynamic event objects

### Instance Methods

#### call

**Function:** `async call(method: string, params: any[] = [], options: Record<string, any> = {}): Promise<any>`

**Description:** Calls a contract method (read-only).

**Input Parameters:**
- `method` (string): Method name
- `params` (any[], optional): Method parameters
- `options` (Record<string, any>, optional): Call options

**Response:** Promise<any> - Decoded method result

**Example:**
```typescript
const result = await contract.call('balanceOf', ['0x1234...']);
console.log('Balance:', result);
```

#### send

**Function:** `async send(method: string, params: any[], options: Record<string, any>): Promise<string>`

**Description:** Sends a transaction to a contract method.

**Input Parameters:**
- `method` (string): Method name
- `params` (any[]): Method parameters
- `options` (Record<string, any>): Transaction options

**Response:** Promise<string> - Transaction hash

**Example:**
```typescript
const txHash = await contract.send('transfer', ['0x1234...', '1000000000000000000'], {
  gasPrice: '0x09184e72a000'
});
console.log('Transaction hash:', txHash);
```

#### estimateGas

**Function:** `async estimateGas(method: string, params: any[] = [], options: Record<string, any> = {}): Promise<number>`

**Description:** Estimates gas for a contract method call.

**Input Parameters:**
- `method` (string): Method name
- `params` (any[], optional): Method parameters
- `options` (Record<string, any>, optional): Call options

**Response:** Promise<number> - Estimated gas amount

**Example:**
```typescript
const gasEstimate = await contract.estimateGas('transfer', ['0x1234...', '1000000000000000000']);
console.log('Gas estimate:', gasEstimate);
```

#### nativeSend

**Function:** `async nativeSend(method: string, params: any[], options: Record<string, any>): Promise<TxParams>`

**Description:** Creates transaction parameters without sending.

**Input Parameters:**
- `method` (string): Method name
- `params` (any[]): Method parameters
- `options` (Record<string, any>): Transaction options

**Response:** Promise<TxParams> - Transaction parameters

**Example:**
```typescript
const txParams = await contract.nativeSend('transfer', ['0x1234...', '1000000000000000000'], {});
console.log('Transaction params:', txParams);
```

### Static Methods

#### deploy

**Function:** `static async deploy({ abi, bytecode, provider, deployer, constructorArgs = [], options = {} }): Promise<{ contractAddress: string, txHash: string, receipt: any }>`

**Description:** Deploys a new contract to the blockchain.

**Input Parameters:**
- `abi` (any[]): Contract ABI
- `bytecode` (string): Contract bytecode
- `provider` (Provider): Provider instance
- `deployer` (string | ISigner): Deployer address or signer
- `constructorArgs` (any[], optional): Constructor arguments
- `options` (Record<string, any>, optional): Deployment options

**Response:** Promise<{ contractAddress: string, txHash: string, receipt: any }> - Deployment result

**Example:**
```typescript
const deployment = await Contract.deploy({
  abi: contractABI,
  bytecode: contractBytecode,
  provider: provider,
  deployer: signer,
  constructorArgs: ['Initial Value'],
  options: { gasPrice: '0x09184e72a000' }
});
console.log('Contract deployed at:', deployment.contractAddress);
```

## EventStream Class

### Constructor

**Function:** `constructor(contract: Contract, eventName: string, options: { fromBlock?: string | number; toBlock?: string | number; filter?: Record<string, any> })`

**Description:** Creates an event stream for contract events.

**Input Parameters:**
- `contract` (Contract): Contract instance
- `eventName` (string): Event name
- `options` (object): Event options

**Response:** Creates a new EventStream instance

### Methods

#### on

**Function:** `on(event: 'data' | 'changed' | 'error', handler: Function): this`

**Description:** Registers an event handler.

**Input Parameters:**
- `event` (string): Event type
- `handler` (Function): Event handler

**Response:** this - EventStream instance

**Example:**
```typescript
contract.events.Transfer({ fromBlock: 'latest' })
  .on('data', (event) => {
    console.log('Transfer event:', event);
  })
  .on('error', (error) => {
    console.error('Event error:', error);
  });
```

#### off

**Function:** `off(event: 'data' | 'changed' | 'error', handler: Function): this`

**Description:** Removes an event handler.

**Input Parameters:**
- `event` (string): Event type
- `handler` (Function): Event handler to remove

**Response:** this - EventStream instance

#### stop

**Function:** `async stop(): Promise<void>`

**Description:** Stops the event stream.

**Input Parameters:** None

**Response:** Promise<void>

## Usage Examples

### Basic Contract Interaction

```typescript
import { Contract, Provider } from '@ncog/necjs';

// Create provider and contract
const provider = new Provider('https://mainnet.infura.io/v3/YOUR_PROJECT_ID');
const contract = new Contract(address, abi, provider);

// Call a read-only method
const balance = await contract.call('balanceOf', ['0x1234567890123456789012345678901234567890']);
console.log('Balance:', balance);

// Use web3.js-style methods
const result = await contract.methods.balanceOf('0x1234567890123456789012345678901234567890').call();
console.log('Balance:', result);
```

### Contract Deployment

```typescript
import { Contract } from '@ncog/necjs';

// Deploy a contract
const deployment = await Contract.deploy({
  abi: contractABI,
  bytecode: contractBytecode,
  provider: provider,
  deployer: signer,
  constructorArgs: ['Initial Value'],
  options: { 
    gasPrice: '0x09184e72a000',
    gasLimit: '0x186a0'
  }
});

console.log('Contract deployed at:', deployment.contractAddress);
console.log('Transaction hash:', deployment.txHash);
```

### Event Listening

```typescript
// Listen to contract events
contract.events.Transfer({
  fromBlock: 'latest',
  filter: { to: '0x1234567890123456789012345678901234567890' }
})
.on('data', (event) => {
  console.log('Transfer event:', {
    from: event.returnValues.from,
    to: event.returnValues.to,
    value: event.returnValues.value
  });
})
.on('error', (error) => {
  console.error('Event error:', error);
});
```

### Transaction Sending

```typescript
// Send a transaction
const txHash = await contract.send('transfer', [
  '0x1234567890123456789012345678901234567890',
  '1000000000000000000' // 1 token
], {
  gasPrice: '0x09184e72a000',
  gasLimit: '0x5208'
});

console.log('Transaction sent:', txHash);

// Or use web3.js-style
const txHash2 = await contract.methods.transfer(
  '0x1234567890123456789012345678901234567890',
  '1000000000000000000'
).send({
  gasPrice: '0x09184e72a000'
});
```

### Gas Estimation

```typescript
// Estimate gas for a transaction
const gasEstimate = await contract.estimateGas('transfer', [
  '0x1234567890123456789012345678901234567890',
  '1000000000000000000'
]);

console.log('Gas estimate:', gasEstimate);

// Or use web3.js-style
const gasEstimate2 = await contract.methods.transfer(
  '0x1234567890123456789012345678901234567890',
  '1000000000000000000'
).estimateGas();
```

### Contract Verification

```typescript
// Verify a contract
const verification = await Contract.verify({
  apiUrl: 'https://api.etherscan.io/api',
  apiKey: 'YOUR_API_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  sourceCode: `
    pragma solidity ^0.8.0;
    contract MyContract {
      string public name;
      constructor(string memory _name) {
        name = _name;
      }
    }
  `,
  contractName: 'MyContract',
  compilerVersion: 'v0.8.0',
  constructorArguments: '0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d4d79436f6e747261637400000000000000000000000000000000000000000000'
});

console.log('Verification result:', verification);
``` 