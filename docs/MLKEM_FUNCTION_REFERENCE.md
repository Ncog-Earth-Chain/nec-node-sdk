# MLKEM Function Reference

This document provides detailed information about all functions available in the NEC Node SDK MLKEM WebAssembly module for quantum-resistant cryptography.

## Classes

### WasmError Class

**Structure:**
```typescript
class WasmError extends Error {
  public readonly context?: any;
  constructor(message: string, context?: any);
}
```

**Description:** Custom error class for WebAssembly-related errors.

**Properties:**
- `context` (any, optional): Additional error context information
- `message` (string): Error message
- `name` (string): Error name ('WasmError')

**Example:**
```typescript
throw new WasmError('Failed to load WASM module', { module: 'mlkem' });
```

## Interfaces

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

**Description:** Interface defining all MLKEM cryptographic operations.

**Methods:**
- `keyGen()`: Generate cryptographic key pair
- `encrypt()`: Asymmetric encryption
- `decrypt()`: Asymmetric decryption
- `symEncrypt()`: Symmetric encryption
- `symDecrypt()`: Symmetric decryption
- `privateKeyToAddress()`: Derive address from private key
- `signTransactionMLDSA87()`: Sign transactions with ML-DSA-87
- `decodeRLPTransaction()`: Decode RLP-encoded transactions

## Functions

### loadWasm

**Function:** `async loadWasm(): Promise<MlKem>`

**Description:** Load and initialize the MLKEM Go WebAssembly module. Automatically detects environment and uses appropriate loader.

**Input Parameters:** None

**Response:** Promise<MlKem> - Initialized MLKEM interface

**Error Handling:**
- Throws WasmError if environment is unsupported
- Throws WasmError if WASM module fails to load

**Environment Support:**
- **Node.js**: Uses Node.js-specific loader
- **Browser**: Uses browser-specific loader

**Example:**
```typescript
import { loadWasm } from 'necjs';

try {
  const mlkem = await loadWasm();
  console.log('MLKEM WASM module loaded successfully');
  
  // Generate key pair
  const keyPair = await mlkem.keyGen();
  console.log('Public key:', keyPair.pubKey);
  console.log('Private key:', keyPair.privKey);
} catch (error) {
  console.error('Failed to load MLKEM:', error.message);
}
```

### loadWasmFromBuffer

**Function:** `async loadWasmFromBuffer(wasmBuffer: ArrayBuffer): Promise<MlKem>`

**Description:** Load WASM from buffer (useful for bundlers that inline WASM).

**Input Parameters:**
- `wasmBuffer` (ArrayBuffer): WebAssembly binary buffer

**Response:** Promise<MlKem> - Initialized MLKEM interface

**Error Handling:**
- Throws WasmError if used in Node.js environment
- Throws WasmError if environment is unsupported
- Throws WasmError if WASM module fails to load

**Environment Support:**
- **Browser**: Supported
- **Node.js**: Not supported (throws error)

**Example:**
```typescript
import { loadWasmFromBuffer } from 'necjs';

// Load WASM from buffer (e.g., from a bundler)
const wasmBuffer = await fetch('/path/to/mlkem.wasm').then(r => r.arrayBuffer());
const mlkem = await loadWasmFromBuffer(wasmBuffer);

// Use MLKEM functions
const keyPair = await mlkem.keyGen();
```

## Environment Detection

The module automatically detects the runtime environment:

- **Node.js**: `typeof process !== 'undefined' && process.versions && process.versions.node`
- **Browser**: `typeof window !== 'undefined' && typeof document !== 'undefined'`

## MlKem Interface Methods

### keyGen

**Function:** `keyGen(): Promise<{ pubKey: string; privKey: string }>`

**Description:** Generate a new cryptographic key pair.

**Input Parameters:** None

**Response:** Promise<{ pubKey: string; privKey: string }> - Generated key pair

**Example:**
```typescript
const keyPair = await mlkem.keyGen();
console.log('Public key:', keyPair.pubKey);
console.log('Private key:', keyPair.privKey);
```

### encrypt

**Function:** `encrypt(pubKey: string, message: string): Promise<{ encryptedData: string; version: string }>`

**Description:** Asymmetric encrypt with the given public key.

**Input Parameters:**
- `pubKey` (string): Public key for encryption
- `message` (string): Message to encrypt

**Response:** Promise<{ encryptedData: string; version: string }> - Encrypted data and version

**Example:**
```typescript
const encrypted = await mlkem.encrypt(publicKey, 'Hello, World!');
console.log('Encrypted data:', encrypted.encryptedData);
console.log('Version:', encrypted.version);
```

### decrypt

**Function:** `decrypt(privKey: string, encryptedData: string, version: string): Promise<string>`

**Description:** Asymmetric decrypt with the given private key.

**Input Parameters:**
- `privKey` (string): Private key for decryption
- `encryptedData` (string): Encrypted data to decrypt
- `version` (string): Version of the encryption

**Response:** Promise<string> - Decrypted message

**Example:**
```typescript
const decrypted = await mlkem.decrypt(privateKey, encryptedData, version);
console.log('Decrypted message:', decrypted);
```

### symEncrypt

**Function:** `symEncrypt(ssKey: string, message: string): Promise<{ encryptedData: string; version: string }>`

**Description:** Symmetric encrypt with the shared-secret key.

**Input Parameters:**
- `ssKey` (string): Shared secret key
- `message` (string): Message to encrypt

**Response:** Promise<{ encryptedData: string; version: string }> - Encrypted data and version

**Example:**
```typescript
const encrypted = await mlkem.symEncrypt(sharedSecretKey, 'Secret message');
console.log('Symmetric encrypted data:', encrypted.encryptedData);
```

### symDecrypt

**Function:** `symDecrypt(ssKey: string, encryptedData: string, version: string): Promise<string>`

**Description:** Symmetric decrypt with the shared-secret key.

**Input Parameters:**
- `ssKey` (string): Shared secret key
- `encryptedData` (string): Encrypted data to decrypt
- `version` (string): Version of the encryption

**Response:** Promise<string> - Decrypted message

**Example:**
```typescript
const decrypted = await mlkem.symDecrypt(sharedSecretKey, encryptedData, version);
console.log('Symmetric decrypted message:', decrypted);
```

### privateKeyToAddressMLDSA87

**Function:** `privateKeyToAddress(privateKey: string): string`

**Description:** Derive an EVM-style address (hex) from a raw MLDSA87 private-key string.

**Input Parameters:**
- `privateKey` (string): Private key string

**Response:** string - EVM-style address in hex format

**Example:**
```typescript
const address = mlkem.privateKeyToAddress(privateKey);
console.log('Derived address:', address);
```

### signTransactionMLDSA87

**Function:** `signTransactionMLDSA87(TxObject: any, privateKeyHex: string): any`

**Description:** Sign transactions using ML-DSA-87 algorithm.

**Input Parameters:**
- `TxObject` (any): Transaction object to sign
- `privateKeyHex` (string): Private key in hex format

**Response:** any - Signed transaction object

**Example:**
```typescript
const signedTx = mlkem.signTransactionMLDSA87(txObject, privateKeyHex);
console.log('Signed transaction:', signedTx);
```

### decodeRLPTransaction

**Function:** `decodeRLPTransaction(txHex: string): any`

**Description:** Decode RLP-encoded transaction.

**Input Parameters:**
- `txHex` (string): RLP-encoded transaction in hex format

**Response:** any - Decoded transaction object

**Example:**
```typescript
const decodedTx = mlkem.decodeRLPTransaction(txHex);
console.log('Decoded transaction:', decodedTx);
```

## Usage Examples

### Basic MLKEM Setup

```typescript
import { loadWasm } from 'necjs';

async function setupMLKEM() {
  try {
    const mlkem = await loadWasm();
    console.log('MLKEM initialized successfully');
    return mlkem;
  } catch (error) {
    console.error('Failed to initialize MLKEM:', error.message);
    throw error;
  }
}

const mlkem = await setupMLKEM();
```

### Key Generation and Encryption

```typescript
// Generate key pair
const keyPair = await mlkem.keyGen();
console.log('Generated key pair:', {
  publicKey: keyPair.pubKey,
  privateKey: keyPair.privKey
});

// Encrypt a message
const message = 'Hello, Quantum World!';
const encrypted = await mlkem.encrypt(keyPair.pubKey, message);
console.log('Encrypted:', encrypted);

// Decrypt the message
const decrypted = await mlkem.decrypt(keyPair.privKey, encrypted.encryptedData, encrypted.version);
console.log('Decrypted:', decrypted);
console.log('Message matches:', message === decrypted);
```

### Symmetric Encryption

```typescript
// Generate a shared secret key (in practice, this would be derived from key exchange)
const sharedSecretKey = 'your-shared-secret-key';

// Symmetric encryption
const message = 'Secret message for symmetric encryption';
const symEncrypted = await mlkem.symEncrypt(sharedSecretKey, message);
console.log('Symmetric encrypted:', symEncrypted);

// Symmetric decryption
const symDecrypted = await mlkem.symDecrypt(sharedSecretKey, symEncrypted.encryptedData, symEncrypted.version);
console.log('Symmetric decrypted:', symDecrypted);
```

### Address Derivation

```typescript
// Derive address from private key
const privateKey = 'your-private-key-string';
const address = mlkem.privateKeyToAddress(privateKey);
console.log('Derived address:', address);
```

### Transaction Signing

```typescript
// Sign a transaction with ML-DSA-87
const txObject = {
  to: '0x1234567890123456789012345678901234567890',
  value: '0x1000000000000000000',
  gasPrice: '0x09184e72a000',
  nonce: 0
};

const privateKeyHex = '0x1234567890123456789012345678901234567890123456789012345678901234';
const signedTx = mlkem.signTransactionMLDSA87(txObject, privateKeyHex);
console.log('Signed transaction:', signedTx);
```

### Transaction Decoding

```typescript
// Decode an RLP-encoded transaction
const txHex = '0xf86c8085174876e800830186a094095e7baea6a6c7c4c2dfeb977efac326af552d8780de0b6b3a7640000801ba048b55bfa915ac795c431978d8a6a992b628d557da5ff759b307d495a36649353a0efffd310ac743f371de3b9f7f9cb56c0b28ad43601b4ab949f53faa07bd2c804';
const decodedTx = mlkem.decodeRLPTransaction(txHex);
console.log('Decoded transaction:', decodedTx);
```

### Error Handling

```typescript
async function safeMLKEMOperation() {
  try {
    const mlkem = await loadWasm();
    
    // Perform MLKEM operations
    const keyPair = await mlkem.keyGen();
    const encrypted = await mlkem.encrypt(keyPair.pubKey, 'Test message');
    const decrypted = await mlkem.decrypt(keyPair.privKey, encrypted.encryptedData, encrypted.version);
    
    console.log('Operation successful:', decrypted);
    return decrypted;
    
  } catch (error) {
    if (error instanceof WasmError) {
      console.error('WASM Error:', error.message);
      console.error('Context:', error.context);
    } else {
      console.error('Unexpected error:', error.message);
    }
    throw error;
  }
}
```

### Environment-Specific Loading

```typescript
// Browser environment with buffer loading
async function loadMLKEMInBrowser() {
  try {
    // Try loading from buffer first (for bundled WASM)
    const wasmBuffer = await fetch('/mlkem.wasm').then(r => r.arrayBuffer());
    return await loadWasmFromBuffer(wasmBuffer);
  } catch (error) {
    // Fallback to standard loading
    return await loadWasm();
  }
}

// Node.js environment
async function loadMLKEMInNode() {
  // Node.js only supports standard loading
  return await loadWasm();
}
``` 