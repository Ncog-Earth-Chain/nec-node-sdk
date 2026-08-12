# Provider Function Reference

## Classes

### RpcError Class

**Structure:**
```typescript
class RpcError extends Error {
  public readonly code: number;
  public readonly data?: any;
  
  constructor(message: string, code: number, data?: any);
}
```

**Description:** Represents a structured error returned from a JSON-RPC call.

**Properties:**
- `code` (number): RPC error code
- `data` (any, optional): Additional error data
- `message` (string): Error message

**Example:**
```typescript
throw new RpcError('Invalid parameters', -32602, { param: 'address' });
```

## Types

### ProviderRequestMiddleware

**Structure:**
```typescript
type ProviderRequestMiddleware = (payload: any) => Promise<any> | any;
```

**Description:** Type for request middleware functions that process RPC requests before sending.

### ProviderResponseMiddleware

**Structure:**
```typescript
type ProviderResponseMiddleware = (response: any, payload: any) => Promise<any> | any;
```

**Description:** Type for response middleware functions that process RPC responses after receiving.

## Provider Class

### Constructor

**Function:** `constructor(url: string)`

**Description:** Creates a new Provider instance for JSON-RPC communication.

**Input Parameters:**
- `url` (string): The URL of the JSON-RPC endpoint (e.g., "http://localhost:8545")

**Response:** Creates a new Provider instance

**Example:**
```typescript
const provider = new Provider('https://mainnet.infura.io/v3/YOUR_PROJECT_ID');
```

### Properties

- `url` (string): RPC endpoint URL (private)
- `idCounter` (number): Counter for RPC request IDs (private)
- `requestMiddleware` (ProviderRequestMiddleware[]): Array of request middleware functions (private)
- `responseMiddleware` (ProviderResponseMiddleware[]): Array of response middleware functions (private)

## Middleware Methods

### useRequest

**Function:** `useRequest(middleware: ProviderRequestMiddleware): void`

**Description:** Register a request middleware function. Called before sending each request.

**Input Parameters:**
- `middleware` (ProviderRequestMiddleware): Middleware function to register

**Response:** void

**Example:**
```typescript
provider.useRequest((payload) => {
  console.log('Sending request:', payload);
  return payload;
});
```

### useResponse

**Function:** `useResponse(middleware: ProviderResponseMiddleware): void`

**Description:** Register a response middleware function. Called after receiving each response.

**Input Parameters:**
- `middleware` (ProviderResponseMiddleware): Middleware function to register

**Response:** void

**Example:**
```typescript
provider.useResponse((response, payload) => {
  console.log('Received response:', response);
  return response;
});
```

## Core RPC Methods

### rpc (Private)

**Function:** `private async rpc(method: string, params: any[] = []): Promise<any>`

**Description:** Performs a raw JSON-RPC request. This is the core private method used by all others.

**Input Parameters:**
- `method` (string): The RPC method name
- `params` (any[], optional): An array of parameters for the RPC method (defaults to empty array)

**Response:** Promise<any> - The result from the RPC call

**Error Handling:**
- Throws RpcError if the RPC call returns a JSON-RPC error object
- Throws Error for network or other request-level errors

**Note:** This is a private method used internally by the class.

### batchRpc

**Function:** `async batchRpc(calls: { method: string; params?: any[] }[]): Promise<any[]>`

**Description:** Performs a batch of JSON-RPC requests. Returns an array of results/errors in the same order.

**Input Parameters:**
- `calls` ({ method: string; params?: any[] }[]): Array of method and params objects

**Response:** Promise<any[]> - Array of results or errors (in order)

**Example:**
```typescript
const results = await provider.batchRpc([
  { method: 'eth_blockNumber' },
  { method: 'eth_getBalance', params: ['0x1234...', 'latest'] }
]);
```

### callRpc vs send

The Provider exposes **two** generic escape hatches. They differ only in how `params` are serialized:

| Method | Param handling | Use for |
| --- | --- | --- |
| `callRpc(method, params)` | **tx-shaped serialization** — every object param is run through `serializeForRpc` (numeric fields → hex, `value` → wei-hex, etc.). | Transaction-style calls whose params are tx objects (e.g. `eth_sendRawTransaction`, custom eth methods). |
| `send(method, params)` | **verbatim** — params are passed through untouched. | Methods whose params are plain JSON — the `ddb_*` namespace, arrays, and structured objects with numeric fields that must not be hex-encoded. |

### callRpc

**Function:** `async callRpc(method: string, params: any[] = []): Promise<any>`

**Description:** Public escape hatch for any RPC method. Each object param is serialized for a
transaction-shaped payload via `serializeForRpc` (numeric fields become hex, `value` becomes
wei-hex). Do **not** use it for `ddb_*` or other structured-JSON methods — use `send` instead.

**Input Parameters:**
- `method` (string): The RPC method name
- `params` (any[], optional): An array of parameters for the RPC method (defaults to empty array)

**Response:** Promise<any> - RPC response result

**Example:**
```typescript
const result = await provider.callRpc('eth_sendRawTransaction', ['0x...']);
```

### send

**Function:** `async send(method: string, params: any[] = []): Promise<any>`

**Description:** Raw JSON-RPC call — sends `params` **verbatim** with no tx-oriented serialization.
Required for methods whose params are plain JSON values (strings, arrays, structured objects with
numeric fields), e.g. the `ddb_*` namespace, where `callRpc`'s serializer would mangle arrays and
hex-encode numeric fields. (The `Ddb` client uses `send` internally.)

**Input Parameters:**
- `method` (string): The RPC method name
- `params` (any[], optional): An array of parameters, passed through unchanged

**Response:** Promise<any> - RPC response result

**Example:**
```typescript
const schema = await provider.send('ddb_getSchema', ['users_abcdef']);
```

## Web3 Methods

### clientVersion

**Function:** `async clientVersion(): Promise<string>`

**Description:** Returns the client version of the node.

**Input Parameters:** None

**Response:** Promise<string> - Client version string

**Example:**
```typescript
const version = await provider.clientVersion();
console.log('Client version:', version);
```

## Net Methods

### netVersion

**Function:** `async netVersion(): Promise<string>`

**Description:** Returns the current network ID.

**Input Parameters:** None

**Response:** Promise<string> - Network ID string

**Example:**
```typescript
const networkId = await provider.netVersion();
console.log('Network ID:', networkId);
```

### listening

**Function:** `async listening(): Promise<boolean>`

**Description:** Returns true if the client is actively listening for network connections.

**Input Parameters:** None

**Response:** Promise<boolean> - Listening status

**Example:**
```typescript
const isListening = await provider.listening();
console.log('Node listening:', isListening);
```

### peerCount

**Function:** `async peerCount(): Promise<string>`

**Description:** Returns the number of peers currently connected to the client.

**Input Parameters:** None

**Response:** Promise<string> - Number of peers as hex string

**Example:**
```typescript
const peerCount = await provider.peerCount();
console.log('Peer count:', peerCount);
```

## Eth Methods

### protocolVersion (removed)

**Function:** `async protocolVersion(): Promise<string>`

**Description:** REMOVED — this method **throws**. NCOG nodes have no legacy eth protocol-version
concept, so `provider.protocolVersion()` rejects with `eth_protocolVersion is not supported on NCOG
nodes`. (There is also no `getWork` / `submitWork` — NCOG is not proof-of-work.)

### syncing

**Function:** `async syncing(): Promise<any>`

**Description:** Returns an object with data about the sync status or `false` if not syncing.

**Input Parameters:** None

**Response:** Promise<any> - Sync status object or false

**Example:**
```typescript
const syncStatus = await provider.syncing();
console.log('Sync status:', syncStatus);
```

### coinbase

**Function:** `async coinbase(): Promise<string>`

**Description:** Returns the coinbase address of the client.

**Input Parameters:** None

**Response:** Promise<string> - Coinbase address

**Example:**
```typescript
const coinbase = await provider.coinbase();
console.log('Coinbase:', coinbase);
```

### hashrate

**Function:** `async hashrate(): Promise<string>`

**Description:** Returns the number of hashes per second that the node is mining with.

**Input Parameters:** None

**Response:** Promise<string> - Hashrate as hex string

**Example:**
```typescript
const hashrate = await provider.hashrate();
console.log('Hashrate:', hashrate);
```

### getChainId

**Function:** `async getChainId(): Promise<number>`

**Description:** Returns the current chain ID.

**Input Parameters:** None

**Response:** Promise<number> - Chain ID

**Example:**
```typescript
const chainId = await provider.getChainId();
console.log('Chain ID:', chainId);
```

### getGasPrice

**Function:** `async getGasPrice(): Promise<string>`

**Description:** Returns the current price per gas in wei.

**Input Parameters:** None

**Response:** Promise<string> - Gas price as hex string

**Example:**
```typescript
const gasPrice = await provider.getGasPrice();
console.log('Gas price:', gasPrice);
```

### accounts

**Function:** `async accounts(): Promise<string[]>`

**Description:** Returns a list of accounts owned by the client.

**Input Parameters:** None

**Response:** Promise<string[]> - Array of account addresses

**Example:**
```typescript
const accounts = await provider.accounts();
console.log('Accounts:', accounts);
```

### getBlockNumber

**Function:** `async getBlockNumber(): Promise<number>`

**Description:** Returns the number of the most recent block.

**Input Parameters:** None

**Response:** Promise<number> - Current block number

**Example:**
```typescript
const blockNumber = await provider.getBlockNumber();
console.log('Current block:', blockNumber);
```

### getBalance

**Function:** `async getBalance(address: string, tag = 'latest'): Promise<number>`

**Description:** Returns the balance of an account in NEC (converted from wei).

**Input Parameters:**
- `address` (string): The address to get the balance of
- `tag` (string, optional): The block tag (defaults to "latest")

**Response:** Promise<number> - Account balance in NEC

**Example:**
```typescript
const balance = await provider.getBalance('0x1234...', 'latest');
console.log('Balance:', balance, 'NEC');
```

### getStorageAt

**Function:** `async getStorageAt(address: string, position: string, tag = 'latest'): Promise<string>`

**Description:** Returns the value from a storage position at a given address.

**Input Parameters:**
- `address` (string): Address of the storage
- `position` (string): Hex of the position in storage
- `tag` (string, optional): Block tag (defaults to "latest")

**Response:** Promise<string> - Storage value as hex string

**Example:**
```typescript
const storageValue = await provider.getStorageAt('0x1234...', '0x0', 'latest');
console.log('Storage value:', storageValue);
```

### getTransactionCount

**Function:** `async getTransactionCount(address: string, tag = 'latest'): Promise<number>`

**Description:** Returns the number of transactions sent from an address.

**Input Parameters:**
- `address` (string): The address
- `tag` (string, optional): The block tag (defaults to "latest")

**Response:** Promise<number> - Transaction count (nonce)

**Example:**
```typescript
const nonce = await provider.getTransactionCount('0x1234...', 'latest');
console.log('Nonce:', nonce);
```

### getBlockTransactionCountByNumber

**Function:** `async getBlockTransactionCountByNumber(tag: string): Promise<number>`

**Description:** Returns the number of transactions in a block from a block matching the given block number.

**Input Parameters:**
- `tag` (string): The block tag

**Response:** Promise<number> - Number of transactions in the block

**Example:**
```typescript
const txCount = await provider.getBlockTransactionCountByNumber('latest');
console.log('Block transaction count:', txCount);
```

### getCode

**Function:** `async getCode(address: string, tag = 'latest'): Promise<string>`

**Description:** Returns the code at a given address.

**Input Parameters:**
- `address` (string): The address
- `tag` (string, optional): The block tag (defaults to "latest")

**Response:** Promise<string> - Contract code as hex string

**Example:**
```typescript
const code = await provider.getCode('0x1234...', 'latest');
console.log('Contract code:', code);
```

### getBlockByNumber

**Function:** `async getBlockByNumber(tag: string, full = false): Promise<any>`

**Description:** Returns a block matching the given block number.

**Input Parameters:**
- `tag` (string): The block tag or number
- `full` (boolean, optional): If true, returns full transaction objects; otherwise, only transaction hashes (defaults to false)

**Response:** Promise<any> - Block object

**Example:**
```typescript
const block = await provider.getBlockByNumber('latest', false);
console.log('Block:', block);
```

### getBlockByHash

**Function:** `async getBlockByHash(hash: string, full = false): Promise<any>`

**Description:** Returns a block matching the given block hash.

**Input Parameters:**
- `hash` (string): The hash of the block
- `full` (boolean, optional): If true, returns full transaction objects; otherwise, only transaction hashes (defaults to false)

**Response:** Promise<any> - Block object

**Example:**
```typescript
const block = await provider.getBlockByHash('0x1234...', false);
console.log('Block:', block);
```

### sign

**Function:** `async sign(address: string, data: string): Promise<string>`

**Description:** Calculates a signature for data, using a specific account. The account must be unlocked on the node.

**Input Parameters:**
- `address` (string): The address to sign with
- `data` (string): The data to sign

**Response:** Promise<string> - Signature as hex string

**Example:**
```typescript
const signature = await provider.sign('0x1234...', '0x12345678');
console.log('Signature:', signature);
```

### signTransaction

**Function:** `async signTransaction(txObj: any): Promise<{ raw: string; tx: any }>`

**Description:** Asks the remote node to sign a transaction with an unlocked account.

**Input Parameters:**
- `txObj` (any): The transaction object to sign

**Response:** Promise<{ raw: string; tx: any }> - Object containing the raw signed transaction and the decoded transaction fields

**Example:**
```typescript
const signed = await provider.signTransaction({
  from: '0x1234...',
  to: '0x5678...',
  value: '0x1000000000000000000'
});
console.log('Signed transaction:', signed);
```

### sendTransaction

**Function:** `async sendTransaction(obj: any): Promise<string>`

**Description:** Submits a transaction to be signed and broadcasted by the remote node. The `from` account must be unlocked.

**Input Parameters:**
- `obj` (any): The transaction object

**Response:** Promise<string> - Transaction hash

**Example:**
```typescript
const txHash = await provider.sendTransaction({
  from: '0x1234...',
  to: '0x5678...',
  value: '0x1000000000000000000'
});
console.log('Transaction hash:', txHash);
```

### sendRawTransaction

**Function:** `async sendRawTransaction(signedTx: string): Promise<string>`

**Description:** Submits a pre-signed transaction to the network.

**Input Parameters:**
- `signedTx` (string): The hex-encoded signed transaction

**Response:** Promise<string> - Transaction hash

**Example:**
```typescript
const txHash = await provider.sendRawTransaction('0xf86c8085174876e800830186a094095e7baea6a6c7c4c2dfeb977efac326af552d8780de0b6b3a7640000801ba048b55bfa915ac795c431978d8a6a992b628d557da5ff759b307d495a36649353a0efffd310ac743f371de3b9f7f9cb56c0b28ad43601b4ab949f53faa07bd2c804');
console.log('Transaction hash:', txHash);
```

### call

**Function:** `async call(tx: { from?: string; to: string; gas?: string; gasPrice?: string; value?: string; data?: string; }, tag = 'latest'): Promise<string>`

**Description:** Executes a message call immediately without creating a transaction on the block-chain (read-only).

**Input Parameters:**
- `tx` (object): The transaction call object
- `tag` (string, optional): The block tag (defaults to "latest")

**Response:** Promise<string> - Call result as hex string

**Example:**
```typescript
const result = await provider.call({
  to: '0x1234...',
  data: '0x12345678'
}, 'latest');
console.log('Call result:', result);
```

### estimateGas

**Function:** `async estimateGas(obj: any): Promise<number>`

**Description:** Estimates the gas necessary to execute a specific transaction.

**Input Parameters:**
- `obj` (any): The transaction object

**Response:** Promise<number> - Estimated gas amount

**Example:**
```typescript
const gasEstimate = await provider.estimateGas({
  from: '0x1234...',
  to: '0x5678...',
  value: '0x1000000000000000000'
});
console.log('Gas estimate:', gasEstimate);
```

### getTransactionByHash

**Function:** `async getTransactionByHash(hash: string): Promise<any>`

**Description:** Returns a transaction by its hash.

**Input Parameters:**
- `hash` (string): The hash of the transaction

**Response:** Promise<any> - Transaction object

**Example:**
```typescript
const tx = await provider.getTransactionByHash('0x1234...');
console.log('Transaction:', tx);
```

### getTransactionReceipt

**Function:** `async getTransactionReceipt(hash: string): Promise<any>`

**Description:** Returns the receipt of a transaction by its hash.

**Input Parameters:**
- `hash` (string): The hash of the transaction

**Response:** Promise<any> - Transaction receipt object

**Example:**
```typescript
const receipt = await provider.getTransactionReceipt('0x1234...');
console.log('Transaction receipt:', receipt);
```

### getLogs

**Function:** `async getLogs(filter: any): Promise<any[]>`

**Description:** Returns an array of all logs matching a given filter object.

**Input Parameters:**
- `filter` (any): The filter object

**Response:** Promise<any[]> - Array of log objects

**Example:**
```typescript
const logs = await provider.getLogs({
  address: '0x1234...',
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
});
console.log('Logs:', logs);
```

## Filter Methods

HTTP poll-based event/log watching. (WebSocket clients should use `Subscription` instead.) Install a
filter, then poll it with `getFilterChanges` / `getFilterLogs`, and tear it down with
`uninstallFilter`.

### newFilter

**Function:** `async newFilter(filter: LogFilter): Promise<string>`

**Description:** Install a log filter. Returns the filter id.

**Response:** Promise<string> - filter id

**Example:**
```typescript
const filterId = await provider.newFilter({
  address: '0x1234...',
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
  fromBlock: 'latest',
});
```

### newBlockFilter

**Function:** `async newBlockFilter(): Promise<string>`

**Description:** Install a filter that reports new block hashes. Returns the filter id.

**Response:** Promise<string> - filter id

### newPendingTransactionFilter

**Function:** `async newPendingTransactionFilter(): Promise<string>`

**Description:** Install a filter that reports new pending-transaction hashes. Returns the filter id.

**Response:** Promise<string> - filter id

### getFilterChanges

**Function:** `async getFilterChanges(filterId: string): Promise<Log[] | string[]>`

**Description:** Poll a filter for what changed since the last poll. For a log filter this returns
`Log[]`; for a block / pending-tx filter it returns an array of `0x`-hex hashes.

**Input Parameters:**
- `filterId` (string): The filter id

**Response:** Promise<Log[] | string[]>

**Example:**
```typescript
const changes = await provider.getFilterChanges(filterId);
```

### getFilterLogs

**Function:** `async getFilterLogs(filterId: string): Promise<Log[]>`

**Description:** Return ALL logs matching a (log) filter id — the full set, not just the delta.

**Input Parameters:**
- `filterId` (string): The filter id

**Response:** Promise<Log[]>

### uninstallFilter

**Function:** `async uninstallFilter(filterId: string): Promise<boolean>`

**Description:** Tear down a filter. Returns `true` if it existed.

**Input Parameters:**
- `filterId` (string): The filter id

**Response:** Promise<boolean>

### watchLogs

**Function:** `async watchLogs(filter: LogFilter, onLogs: (logs: Log[]) => void, opts?: { intervalMs?: number; onError?: (e: unknown) => void }): Promise<() => Promise<void>>`

**Description:** Poll-based log watcher for HTTP transports. Installs a filter via `newFilter`, polls
`getFilterChanges` every `intervalMs` (default 4000), and invokes `onLogs` with each non-empty batch.
Resolves to an async `stop()` that uninstalls the filter and halts polling.

**Input Parameters:**
- `filter` (LogFilter): The log filter
- `onLogs` ((logs: Log[]) => void): Callback for each non-empty batch of logs
- `opts` (object, optional): `{ intervalMs?, onError? }`

**Response:** Promise<() => Promise<void>> - an async `stop()` function

**Example:**
```typescript
const stop = await provider.watchLogs(
  { address: '0x1234...', fromBlock: 'latest' },
  (logs) => console.log('new logs:', logs),
  { intervalMs: 4000 }
);
// later:
await stop();
```

## Personal Methods

### newAccount

**Function:** `async newAccount(password: string): Promise<string>`

**Description:** Creates a new account in the node's keystore.

**Input Parameters:**
- `password` (string): The password to protect the account with

**Response:** Promise<string> - New account address

**Example:**
```typescript
const address = await provider.newAccount('myPassword');
console.log('New account:', address);
```

### importRawKey

**Function:** `async importRawKey(privateKey: string, password: string): Promise<string>`

**Description:** Imports an unencrypted private key into the node's keystore.

**Input Parameters:**
- `privateKey` (string): The raw private key
- `password` (string): The password to encrypt the key with

**Response:** Promise<string> - Imported account address

**Example:**
```typescript
const address = await provider.importRawKey('0x1234...', 'myPassword');
console.log('Imported account:', address);
```

### personalSign

**Function:** `async personalSign(data: string, address: string, password: string): Promise<string>`

**Description:** Signs data with a specific account. The account must be unlocked on the node.

**Input Parameters:**
- `data` (string): The data to sign
- `address` (string): The address to sign with
- `password` (string): The password for the account

**Response:** Promise<string> - Signature as hex string

**Example:**
```typescript
const signature = await provider.personalSign('0x12345678', '0x1234...', 'myPassword');
console.log('Signature:', signature);
```

### ecRecover (REMOVED)

**Function:** `async ecRecover(data: string, signature: string): Promise<string>`

**Description:** REMOVED — this method now throws. ML-DSA-87 has NO key recovery, so the upgraded node removed `personal_ecRecover` entirely. Calling `provider.ecRecover(...)` throws immediately:

> `ecRecover is not supported: ML-DSA-87 has no key recovery. Use verifyMessage(data, signature, publicKey) (personal_verifyMessage) with the signer public key.`

Use [`verifyMessage`](#verifymessage) instead — it takes the signer's public key (there is nothing to recover it from) and returns the verified signer address.

### verifyMessage

**Function:** `async verifyMessage(data: string, signature: string, publicKey: string): Promise<string>`

**Description:** Verifies an ML-DSA-87 personal-message signature and returns the signer's address. This is the post-wire-break replacement for `ecRecover`: because ML-DSA-87 has no key recovery, the signer's public key MUST be supplied. Maps to the node's `personal_verifyMessage`.

**Input Parameters:**
- `data` (string): The original message (utf-8 string or 0x-hex)
- `signature` (string): The 0x-hex ML-DSA-87 signature
- `publicKey` (string): The RAW 2592-byte ML-DSA-87 public key of the claimed signer, as `0x` + 5184 hex chars

**Response:** Promise<string> - The verified signer address, computed as `keccak256(rawPubkeyBytes)[12:]`. Throws if the signature does not verify.

**Example:**
```typescript
// publicKey is the raw 2592-byte ML-DSA-87 key: '0x' + 5184 hex chars
const address = await provider.verifyMessage('0x12345678', '0xSIGNATURE...', '0xPUBLICKEY...');
console.log('Verified signer address:', address);
```

### unlockAccount

**Function:** `async unlockAccount(address: string, password: string, duration?: number): Promise<boolean>`

**Description:** Unlocks a specified account for a given duration.

**Input Parameters:**
- `address` (string): The address to unlock
- `password` (string): The account's password
- `duration` (number, optional): The duration in seconds to keep the account unlocked (defaults to 300)

**Response:** Promise<boolean> - True if account was unlocked successfully

**Example:**
```typescript
const unlocked = await provider.unlockAccount('0x1234...', 'myPassword', 600);
console.log('Account unlocked:', unlocked);
```

### lockAccount

**Function:** `async lockAccount(address: string): Promise<boolean>`

**Description:** Locks a specified account.

**Input Parameters:**
- `address` (string): The address to lock

**Response:** Promise<boolean> - True if account was locked successfully

**Example:**
```typescript
const locked = await provider.lockAccount('0x1234...');
console.log('Account locked:', locked);
```

### sendPersonalTransaction

**Function:** `async sendPersonalTransaction(tx: any, password: string): Promise<string>`

**Description:** Sends a transaction from an account in the node's keystore.

**Input Parameters:**
- `tx` (any): The transaction object
- `password` (string): The password for the `from` account

**Response:** Promise<string> - Transaction hash

**Example:**
```typescript
const txHash = await provider.sendPersonalTransaction({
  from: '0x1234...',
  to: '0x5678...',
  value: '0x1000000000000000000'
}, 'myPassword');
console.log('Transaction hash:', txHash);
```

## ENS Methods

### resolveEnsName

**Function:** `async resolveEnsName(ensName: string, registryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'): Promise<string | null>`

**Description:** Resolves an ENS name to an Ethereum address using the ENS registry contract.

**Input Parameters:**
- `ensName` (string): The ENS name to resolve (e.g., 'vitalik.eth')
- `registryAddress` (string, optional): The ENS registry contract address (defaults to mainnet address)

**Response:** Promise<string | null> - The resolved Ethereum address, or null if not found

**Example:**
```typescript
const address = await provider.resolveEnsName('vitalik.eth');
console.log('Resolved address:', address);
```

## Usage Examples

### Basic Provider Setup

```typescript
import { Provider } from '@ncog/necjs';

// Create provider instance
const provider = new Provider('https://mainnet.infura.io/v3/YOUR_PROJECT_ID');

// Add middleware for logging
provider.useRequest((payload) => {
  console.log('Sending request:', payload);
  return payload;
});

provider.useResponse((response, payload) => {
  console.log('Received response:', response);
  return response;
});
```

### Getting Blockchain Information

```typescript
// Get basic blockchain info
const [blockNumber, chainId, gasPrice] = await Promise.all([
  provider.getBlockNumber(),
  provider.getChainId(),
  provider.getGasPrice()
]);

console.log('Block number:', blockNumber);
console.log('Chain ID:', chainId);
console.log('Gas price:', gasPrice);
```

### Account Operations

```typescript
// Get account balance
const balance = await provider.getBalance('0x1234567890123456789012345678901234567890');
console.log('Balance:', balance, 'NEC');

// Get transaction count (nonce)
const nonce = await provider.getTransactionCount('0x1234567890123456789012345678901234567890');
console.log('Nonce:', nonce);

// Get account code (for contracts)
const code = await provider.getCode('0x1234567890123456789012345678901234567890');
console.log('Contract code:', code);
```

### Transaction Operations

```typescript
// Estimate gas for a transaction
const gasEstimate = await provider.estimateGas({
  from: '0x1234567890123456789012345678901234567890',
  to: '0x0987654321098765432109876543210987654321',
  value: '0x1000000000000000000' // 1 NEC
});
console.log('Gas estimate:', gasEstimate);

// Send a transaction (requires unlocked account)
const txHash = await provider.sendTransaction({
  from: '0x1234567890123456789012345678901234567890',
  to: '0x0987654321098765432109876543210987654321',
  value: '0x1000000000000000000',
  gas: '0x5208',
  gasPrice: '0x09184e72a000'
});
console.log('Transaction hash:', txHash);

// Get transaction details
const tx = await provider.getTransactionByHash(txHash);
console.log('Transaction:', tx);

// Get transaction receipt
const receipt = await provider.getTransactionReceipt(txHash);
console.log('Transaction receipt:', receipt);
```

### Contract Interactions

```typescript
// Call a contract method (read-only)
const result = await provider.call({
  to: '0x1234567890123456789012345678901234567890',
  data: '0x70a082310000000000000000000000001234567890123456789012345678901234567890'
});
console.log('Call result:', result);

// Get contract logs
const logs = await provider.getLogs({
  address: '0x1234567890123456789012345678901234567890',
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event
  ],
  fromBlock: '0x0',
  toBlock: 'latest'
});
console.log('Logs:', logs);
```

### Batch Operations

```typescript
// Perform multiple RPC calls in a single request
const results = await provider.batchRpc([
  { method: 'eth_blockNumber' },
  { method: 'eth_getBalance', params: ['0x1234567890123456789012345678901234567890', 'latest'] },
  { method: 'eth_getTransactionCount', params: ['0x1234567890123456789012345678901234567890', 'latest'] }
]);

console.log('Block number:', results[0]);
console.log('Balance:', results[1]);
console.log('Nonce:', results[2]);
```

### Personal Account Management

```typescript
// Create new account
const newAddress = await provider.newAccount('myPassword');
console.log('New account:', newAddress);

// Import private key
const importedAddress = await provider.importRawKey('0x1234...', 'myPassword');
console.log('Imported account:', importedAddress);

// Unlock account
const unlocked = await provider.unlockAccount(importedAddress, 'myPassword', 600);
console.log('Account unlocked:', unlocked);

// Send transaction from unlocked account
const txHash = await provider.sendPersonalTransaction({
  from: importedAddress,
  to: '0x0987654321098765432109876543210987654321',
  value: '0x1000000000000000000'
}, 'myPassword');
console.log('Transaction hash:', txHash);

// Lock account
const locked = await provider.lockAccount(importedAddress);
console.log('Account locked:', locked);
```

### ENS Resolution

```typescript
// Resolve ENS name to address
const address = await provider.resolveEnsName('vitalik.eth');
console.log('Vitalik\'s address:', address);

// Resolve with custom registry
const customAddress = await provider.resolveEnsName('example.eth', '0x1234567890123456789012345678901234567890');
console.log('Custom resolved address:', customAddress);
``` 