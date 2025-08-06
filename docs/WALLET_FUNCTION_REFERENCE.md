# Wallet Function Reference

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
- `gas` (string, optional): Gas amount for the transaction
- `to` (string): Recipient address
- `value` (string): Transaction value
- `data` (string, optional): Transaction data payload
- `chainId` (number, optional): Blockchain network ID

### MlKem Interface

**Structure:**
```typescript
interface MlKem {
  keyGen(): Promise<{ pubKey: string; privKey: string }>;
  encrypt(pubKey: string, message: string): Promise<{ encryptedData: string; version: string }>;
  decrypt(privKey: string, encryptedData: string, version: string): Promise<string>;
  symEncrypt(ssKey: string, message: string): Promise<{ encryptedData: string; version: string }>;
  symDecrypt(ssKey: string, encryptedData: string, version: string): Promise<string>;
  privateKeyToAddress(privateKey: string): string;
  signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => any;
  decodeRLPTransaction: (txHex: string) => any;
}
```

**Description:** Defines the interface for ML-KEM cryptographic operations and transaction signing.

## Wallet Class

### Constructor

**Function:** `private constructor(mlkem: MlKem, privateKey: string)`

**Description:** Private constructor for creating a Wallet instance.

**Input Parameters:**
- `mlkem` (MlKem): ML-KEM cryptographic interface instance
- `privateKey` (string): Private key in hexadecimal format

**Response:** Creates a new Wallet instance with the provided ML-KEM interface and private key.

### Static Methods

#### create

**Function:** `static async create(hexPrivateKey: string): Promise<Wallet>`

**Description:** Creates a new Wallet instance with the provided private key.

**Input Parameters:**
- `hexPrivateKey` (string): Private key in hexadecimal format

**Response:** Promise<Wallet> - A new Wallet instance

**Example:**
```typescript
const wallet = await Wallet.create('0x1234567890abcdef...');
```

#### connect (Static)

**Function:** `static async connect(hexPrivateKey: string, providerUrl?: string): Promise<{ signer: Signer, provider: Provider, address: string }>`

**Description:** Unified connect method that creates a Wallet, Provider, and Signer in one call.

**Input Parameters:**
- `hexPrivateKey` (string): Private key in hexadecimal format
- `providerUrl` (string, optional): RPC URL (defaults to 'http://localhost:8545')

**Response:** Promise<{ signer: Signer, provider: Provider, address: string }> - Object containing signer, provider, and wallet address

**Example:**
```typescript
const { signer, provider, address } = await Wallet.connect('0x1234567890abcdef...', 'https://rpc.example.com');
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

- `mlkem` (MlKem): ML-KEM cryptographic interface instance
- `privateKey` (string): Wallet's private key
- `address` (string, readonly): Wallet's public address derived from the private key

## Signer Class

### Constructor

**Function:** `constructor(private provider: Provider, private wallet: Wallet)`

**Description:** Creates a new Signer instance for transaction signing and sending.

**Input Parameters:**
- `provider` (Provider): Provider instance for blockchain interaction
- `wallet` (Wallet): Wallet instance for cryptographic operations

**Response:** Creates a new Signer instance

### Properties

#### address

**Function:** `get address(): string`

**Description:** Getter for the wallet's address.

**Input Parameters:** None

**Response:** string - The wallet's public address

### Methods

#### getAddress

**Function:** `async getAddress(): Promise<string>`

**Description:** Asynchronously retrieves the wallet's address.

**Input Parameters:** None

**Response:** Promise<string> - The wallet's public address

**Example:**
```typescript
const address = await signer.getAddress();
```

#### sendTransaction

**Function:** `async sendTransaction(txParams: TxParams): Promise<string>`

**Description:** Signs and sends a transaction to the blockchain.

**Input Parameters:**
- `txParams` (TxParams): Transaction parameters object

**Response:** Promise<string> - Transaction hash

**Error Handling:**
- Throws error if required transaction parameters are missing
- Throws error if transaction signing fails
- Throws error if RPC call fails

**Example:**
```typescript
const txHash = await signer.sendTransaction({
  from: '0x1234...',
  to: '0x5678...',
  value: 1,
  gasPrice: '100000900',
  gasLimit: '21000',
  nonce: 0
});
```

#### decode

**Function:** `async decode(rawSigned: string): Promise<any>`

**Description:** Decodes a raw signed transaction.

**Input Parameters:**
- `rawSigned` (string): Raw signed transaction in hexadecimal format

**Response:** Promise<any> - Decoded transaction object

**Error Handling:**
- Throws error if transaction decoding fails

**Example:**
```typescript
const decodedTx = await signer.decode('0xf86c8085174876e800830186a094095e7baea6a6c7c4c2dfeb977efac326af552d8780de0b6b3a7640000801ba048b55bfa915ac795c431978d8a6a992b628d557da5ff759b307d495a36649353a0efffd310ac743f371de3b9f7f9cb56c0b28ad43601b4ab949f53faa07bd2c804');
```

## MlKem Interface Methods

### keyGen

**Function:** `keyGen(): Promise<{ pubKey: string; privKey: string }>`

**Description:** Generates a new public/private key pair using ML-KEM.

**Input Parameters:** None

**Response:** Promise<{ pubKey: string; privKey: string }> - Generated key pair

### encrypt

**Function:** `encrypt(pubKey: string, message: string): Promise<{ encryptedData: string; version: string }>`

**Description:** Encrypts a message using the provided public key.

**Input Parameters:**
- `pubKey` (string): Public key for encryption
- `message` (string): Message to encrypt

**Response:** Promise<{ encryptedData: string; version: string }> - Encrypted data and version

### decrypt

**Function:** `decrypt(privKey: string, encryptedData: string, version: string): Promise<string>`

**Description:** Decrypts encrypted data using the provided private key.

**Input Parameters:**
- `privKey` (string): Private key for decryption
- `encryptedData` (string): Encrypted data to decrypt
- `version` (string): Version of the encryption

**Response:** Promise<string> - Decrypted message

### symEncrypt

**Function:** `symEncrypt(ssKey: string, message: string): Promise<{ encryptedData: string; version: string }>`

**Description:** Performs symmetric encryption using a shared secret key.

**Input Parameters:**
- `ssKey` (string): Shared secret key
- `message` (string): Message to encrypt

**Response:** Promise<{ encryptedData: string; version: string }> - Encrypted data and version

### symDecrypt

**Function:** `symDecrypt(ssKey: string, encryptedData: string, version: string): Promise<string>`

**Description:** Performs symmetric decryption using a shared secret key.

**Input Parameters:**
- `ssKey` (string): Shared secret key
- `encryptedData` (string): Encrypted data to decrypt
- `version` (string): Version of the encryption

**Response:** Promise<string> - Decrypted message

### privateKeyToAddress

**Function:** `privateKeyToAddress(privateKey: string): string`

**Description:** Derives a public address from a private key.

**Input Parameters:**
- `privateKey` (string): Private key in hexadecimal format

**Response:** string - Derived public address

### signTransactionMLDSA87

**Function:** `signTransactionMLDSA87(TxObject: any, privateKeyHex: string): any`

**Description:** Signs a transaction using ML-DSA-87 algorithm.

**Input Parameters:**
- `TxObject` (any): Transaction object to sign
- `privateKeyHex` (string): Private key in hexadecimal format

**Response:** any - Signed transaction object

### decodeRLPTransaction

**Function:** `decodeRLPTransaction(txHex: string): any`

**Description:** Decodes an RLP-encoded transaction.

**Input Parameters:**
- `txHex` (string): RLP-encoded transaction in hexadecimal format

**Response:** any - Decoded transaction object

## Usage Examples

### Basic Wallet Creation and Connection

```typescript
import { Wallet } from 'necjs';

// Create wallet from private key
const wallet = await Wallet.create('0x1234567890abcdef...');

// Connect to provider
const provider = new Provider('https://rpc.example.com');
const signer = wallet.connect(provider);

// Get wallet address
const address = await signer.getAddress();
```

### Sending a Transaction

```typescript
// Send transaction
const txHash = await signer.sendTransaction({
  from: wallet.address,
  to: '0x5678901234567890abcdef...',
  value: 1,
  gasPrice: '100000900',
  gasLimit: '21000',
  nonce: 0
  chainId: 2479
});
```

### Unified Connection

```typescript
// Create wallet, provider, and signer in one call
const { signer, provider, address } = await Wallet.connect(
  '0x1234567890abcdef...',
  'https://rpc.example.com'
);
``` 