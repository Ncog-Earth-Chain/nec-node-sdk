# Wallet Function Reference

The `Wallet` and `Signer` classes provide local, WASM-free ML-DSA-87 transaction
signing. A `Wallet` holds a private key + its derived address; connecting it to a
`Provider` yields a `Signer` that fills in the missing transaction fields and
broadcasts the signed transaction.

> Currency note: values are denominated in **NEC** (18 decimals), never ETH.
>
> Signing note: transactions are signed with **ML-DSA-87** (post-quantum). ML-KEM
> (`loadWasm` / `MlKem`) is a **separate, KEM-only** encryption module and has
> nothing to do with `Wallet` or transaction signing — see
> [MLKEM_FUNCTION_REFERENCE.md](MLKEM_FUNCTION_REFERENCE.md) and
> [TX_SIGNER_FUNCTION_REFERENCE.md](TX_SIGNER_FUNCTION_REFERENCE.md).

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
  value: string;
  data?: string;
  chainId?: number;
}
```

**Description:** Defines the structure for transaction parameters used in blockchain transactions.

**Parameters:**
- `from` (string): The sender's address
- `nonce` (any): Transaction nonce for ordering
- `gasPrice` (string): Gas price in wei
- `gasLimit` (string, optional): Maximum gas limit for the transaction
- `gas` (string, optional): Gas amount for the transaction (alias of `gasLimit`)
- `to` (string): Recipient address
- `value` (string): Transaction value in **NEC** (the `Signer` converts it to wei; see `sendTransaction`)
- `data` (string, optional): Transaction data payload
- `chainId` (number, optional): Blockchain network ID (auto-filled by the `Signer` when omitted)

## Wallet Class

### Constructor

**Function:** `private constructor(privateKey: string, address: string)`

**Description:** The constructor is **private** — you cannot call `new Wallet(...)`.
Create a wallet asynchronously with the static factory `Wallet.create(...)` (which
derives the address from the private key) or the unified `Wallet.connect(...)`.

**Input Parameters:**
- `privateKey` (string): ML-DSA-87 private key in hexadecimal format
- `address` (string): The derived account address (supplied internally by `create`)

### Static Methods

#### create

**Function:** `static async create(hexPrivateKey: string): Promise<Wallet>`

**Description:** Creates a new Wallet instance, deriving the address from the private key
(`address = keccak256(rawMLDSApubkeyBytes)[12:]`).

**Input Parameters:**
- `hexPrivateKey` (string): Private key in hexadecimal format

**Response:** Promise<Wallet> - A new Wallet instance

**Example:**
```typescript
const wallet = await Wallet.create('0x1234567890abcdef...');
console.log(wallet.address);
```

#### connect (Static)

**Function:** `static async connect(hexPrivateKey: string, providerUrl?: string): Promise<{ signer: Signer, provider: Provider, address: string }>`

**Description:** Unified connect method that creates a Wallet, Provider, and Signer in one call.

**Input Parameters:**
- `hexPrivateKey` (string): Private key in hexadecimal format
- `providerUrl` (string, optional): RPC URL (defaults to `'http://localhost:8545'`)

**Response:** Promise<{ signer: Signer, provider: Provider, address: string }> - Object containing signer, provider, and wallet address

**Example:**
```typescript
const { signer, provider, address } = await Wallet.connect(
  '0x1234567890abcdef...',
  'https://rpc.ncog.earth'
);
```

### Instance Methods

#### connect

**Function:** `connect(provider: Provider): Signer`

**Description:** Connects the wallet to a provider and returns a Signer instance.

**Input Parameters:**
- `provider` (Provider): Provider instance for blockchain interaction

**Response:** Signer - A new Signer instance connected to the wallet and provider

**Example:**
```typescript
const signer = wallet.connect(provider);
```

### Properties

- `privateKey` (string): Wallet's ML-DSA-87 private key
- `address` (string, readonly): Wallet's account address derived from the private key

## Signer Class

### Constructor

**Function:** `constructor(provider: Provider, wallet: Wallet)`

**Description:** Creates a new Signer instance for transaction signing and sending.
Usually obtained via `wallet.connect(provider)` rather than constructed directly.

**Input Parameters:**
- `provider` (Provider): Provider instance for blockchain interaction
- `wallet` (Wallet): Wallet instance for cryptographic operations

**Response:** Creates a new Signer instance

### Properties

#### address

**Function:** `get address(): string`

**Description:** Getter for the wallet's address.

**Response:** string - The wallet's account address

### Methods

#### getAddress

**Function:** `async getAddress(): Promise<string>`

**Description:** Asynchronously retrieves the wallet's address.

**Response:** Promise<string> - The wallet's account address

**Example:**
```typescript
const address = await signer.getAddress();
```

#### sendTransaction

**Function:** `async sendTransaction(txParams: TxParams): Promise<string>`

**Description:** Signs a transaction with ML-DSA-87 and broadcasts it via
`eth_sendRawTransaction`.

**Auto-filled fields** — the `Signer` fills these in for you when they are missing/falsy:
- `chainId` ← `provider.getChainId()` (`eth_chainId`)
- `nonce` ← `provider.getTransactionCount(from)`
- `gasPrice` ← `provider.getGasPrice()`

**Value conversion:** when `value` is set (and not `'0x'`), it is converted from NEC to
wei-hex via `etherToWeiHex(value)`. Pass a NEC amount (e.g. `'1'` for 1 NEC).

**Not auto-filled:** you must supply `gas` **or** `gasLimit` — `sendTransaction` throws
`Missing required transaction parameters: gasLimit, gasPrice, nonce` otherwise.

**Input Parameters:**
- `txParams` (TxParams): Transaction parameters object

**Response:** Promise<string> - Transaction hash

**Error Handling:**
- Throws if neither `gas` nor `gasLimit` is provided
- Throws if signing fails
- Throws if the `eth_sendRawTransaction` RPC call returns an error

**Example:**
```typescript
const txHash = await signer.sendTransaction({
  from: wallet.address,
  to: '0x5678901234567890abcdef0123456789abcdef01',
  value: '1',            // 1 NEC — converted to wei-hex by the Signer
  gasLimit: '21000',
  gasPrice: '100000900', // optional — auto-filled from eth_gasPrice if omitted
  nonce: 0,              // optional — auto-filled from eth_getTransactionCount if omitted
  chainId: 2479          // optional — auto-filled from eth_chainId if omitted
});
```

#### decode

**Function:** `async decode(rawSigned: string): Promise<any>`

**Description:** Decodes a raw signed transaction back into its fields (via
`decodeRLPTransaction`). See
[TX_SIGNER_FUNCTION_REFERENCE.md](TX_SIGNER_FUNCTION_REFERENCE.md) for the field layout.

**Input Parameters:**
- `rawSigned` (string): Raw signed transaction in hexadecimal format

**Response:** Promise<any> - Decoded transaction object

**Example:**
```typescript
const decodedTx = await signer.decode('0x...');
```

## Usage Examples

### Basic Wallet Creation and Connection

```typescript
import { Provider, Wallet } from 'necjs';

// Create wallet from private key (address derived automatically)
const wallet = await Wallet.create('0x1234567890abcdef...');

// Connect to a provider to get a Signer
const provider = new Provider('https://rpc.ncog.earth');
const signer = wallet.connect(provider);

// Get wallet address
const address = await signer.getAddress();
```

### Sending a Transaction

```typescript
// chainId, nonce and gasPrice are auto-filled when omitted; value is a NEC amount.
const txHash = await signer.sendTransaction({
  from: wallet.address,
  to: '0x0987654321098765432109876543210987654321',
  value: '1',
  gasLimit: '21000',
  gasPrice: '100000900',
  nonce: 0,
  chainId: 2479
});
```

### Unified Connection

```typescript
// Create wallet, provider, and signer in one call
const { signer, provider, address } = await Wallet.connect(
  '0x1234567890abcdef...',
  'https://rpc.ncog.earth'
);
```
