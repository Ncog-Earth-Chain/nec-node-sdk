# iOS Function Reference Guide

## Overview

This document provides a comprehensive reference for all available functions in the iOS WalletModule. Each function is designed to interface with the Go-generated `MobileApps.xcframework` to provide cryptographic and blockchain functionality.

## Function Categories

1. **Cryptographic Operations**
   - Key Generation
   - Asymmetric Encryption/Decryption
   - Symmetric Encryption/Decryption

2. **Blockchain Operations**
   - Wallet Address Generation
   - Transaction Signing
   - RLP Transaction Decoding

## Function Reference

### 1. Key Generation

#### `keyGenMobile()`
**Purpose**: Generate a new cryptographic key pair for asymmetric encryption

**Swift Implementation**:
```swift
@objc
func keyGenMobile(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  if let keyPair = Mobile_appsKeyGenMobile(&error) {
    let result: [String: Any] = [
      "pubKey": keyPair.pubKey,
      "privKey": keyPair.privKey
    ]
    resolve(result)
  } else if let error = error {
    reject("KEY_GEN_ERROR", error.localizedDescription, error)
  } else {
    reject("KEY_GEN_ERROR", "Unknown error", nil)
  }
}
```

**Objective-C Bridge**:
```objc
RCT_EXTERN_METHOD(keyGenMobile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
```

**React Native Usage**:
```typescript
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

const generateKeys = async () => {
  try {
    const result = await WalletModule.keyGenMobile();
    console.log('Public Key:', result.pubKey);
    console.log('Private Key:', result.privKey);
    return result;
  } catch (error) {
    console.error('Key generation failed:', error);
    throw error;
  }
};
```

**Return Value**:
```typescript
{
  pubKey: string;    // Public key in hex format
  privKey: string;   // Private key in hex format
}
```

**Error Codes**:
- `KEY_GEN_ERROR`: General key generation error

---

### 2. Asymmetric Encryption

#### `encryptMobile(pubKeyHex: string, message: string)`
**Purpose**: Encrypt a message using a public key

**Parameters**:
- `pubKeyHex`: Public key in hexadecimal format
- `message`: Plain text message to encrypt

**Swift Implementation**:
```swift
@objc
func encryptMobile(_ pubKeyHex: String, message: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  if let encryptedResult = Mobile_appsEncryptMobile(pubKeyHex, message, &error) {
    let result: [String: Any] = [
      "encrypted": encryptedResult.encrypted,
      "version": encryptedResult.version
    ]
    resolve(result)
  } else if let error = error {
    reject("ENCRYPT_ERROR", error.localizedDescription, error)
  } else {
    reject("ENCRYPT_ERROR", "Unknown error", nil)
  }
}
```

**React Native Usage**:
```typescript
const encryptMessage = async (publicKey: string, message: string) => {
  try {
    const result = await WalletModule.encryptMobile(publicKey, message);
    console.log('Encrypted Data:', result.encrypted);
    console.log('Encryption Version:', result.version);
    return result;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw error;
  }
};

// Example usage
const publicKey = "04a1b2c3d4e5f6..."; // Your public key
const message = "Hello, this is a secret message";
const encrypted = await encryptMessage(publicKey, message);
```

**Return Value**:
```typescript
{
  encrypted: string;  // Encrypted data in hex format
  version: string;    // Encryption version identifier
}
```

**Error Codes**:
- `ENCRYPT_ERROR`: Encryption operation failed

---

### 3. Asymmetric Decryption

#### `decryptMobile(privKeyHex: string, encryptedData: string, version: string)`
**Purpose**: Decrypt a message using a private key

**Parameters**:
- `privKeyHex`: Private key in hexadecimal format
- `encryptedData`: Encrypted data in hex format
- `version`: Encryption version (must match the version used for encryption)

**Swift Implementation**:
```swift
@objc
func decryptMobile(_ privKeyHex: String, encryptedData: String, version: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  let decryptedText = Mobile_appsDecryptMobile(privKeyHex, encryptedData, version, &error)
  if error == nil {
    resolve(decryptedText)
  } else if let error = error {
    reject("DECRYPT_ERROR", error.localizedDescription, error)
  } else {
    reject("DECRYPT_ERROR", "Unknown error", nil)
  }
}
```

**React Native Usage**:
```typescript
const decryptMessage = async (privateKey: string, encryptedData: string, version: string) => {
  try {
    const decrypted = await WalletModule.decryptMobile(privateKey, encryptedData, version);
    console.log('Decrypted Message:', decrypted);
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw error;
  }
};

// Example usage
const privateKey = "a1b2c3d4e5f6..."; // Your private key
const encrypted = "encrypted_hex_data...";
const version = "v1.0";
const decrypted = await decryptMessage(privateKey, encrypted, version);
```

**Return Value**:
```typescript
string  // Decrypted plain text message
```

**Error Codes**:
- `DECRYPT_ERROR`: Decryption operation failed

---

### 4. Symmetric Encryption

#### `symEncryptMobile(ssKeyHex: string, message: string)`
**Purpose**: Encrypt a message using a symmetric key

**Parameters**:
- `ssKeyHex`: Symmetric key in hexadecimal format
- `message`: Plain text message to encrypt

**Swift Implementation**:
```swift
@objc
func symEncryptMobile(_ ssKeyHex: String, message: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  if let encryptedResult = Mobile_appsSymEncryptMobile(ssKeyHex, message, &error) {
    let result: [String: Any] = [
      "encrypted": encryptedResult.encrypted,
      "version": encryptedResult.version
    ]
    resolve(result)
  } else if let error = error {
    reject("SYM_ENCRYPT_ERROR", error.localizedDescription, error)
  } else {
    reject("SYM_ENCRYPT_ERROR", "Unknown error", nil)
  }
}
```

**React Native Usage**:
```typescript
const symEncryptMessage = async (symmetricKey: string, message: string) => {
  try {
    const result = await WalletModule.symEncryptMobile(symmetricKey, message);
    console.log('Symmetrically Encrypted:', result.encrypted);
    console.log('Version:', result.version);
    return result;
  } catch (error) {
    console.error('Symmetric encryption failed:', error);
    throw error;
  }
};

// Example usage
const symmetricKey = "a1b2c3d4e5f6..."; // 32-byte symmetric key
const message = "Sensitive data to encrypt";
const encrypted = await symEncryptMessage(symmetricKey, message);
```

**Return Value**:
```typescript
{
  encrypted: string;  // Encrypted data in hex format
  version: string;    // Encryption version identifier
}
```

**Error Codes**:
- `SYM_ENCRYPT_ERROR`: Symmetric encryption operation failed

---

### 5. Symmetric Decryption

#### `symDecryptMobile(ssKeyHex: string, encryptedData: string, version: string)`
**Purpose**: Decrypt a message using a symmetric key

**Parameters**:
- `ssKeyHex`: Symmetric key in hexadecimal format
- `encryptedData`: Encrypted data in hex format
- `version`: Encryption version (must match the version used for encryption)

**Swift Implementation**:
```swift
@objc
func symDecryptMobile(_ ssKeyHex: String, encryptedData: String, version: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  let decryptedText = Mobile_appsSymDecryptMobile(ssKeyHex, encryptedData, version, &error)
  if error == nil {
    resolve(decryptedText)
  } else if let error = error {
    reject("SYM_DECRYPT_ERROR", error.localizedDescription, error)
  } else {
    reject("SYM_DECRYPT_ERROR", "Unknown error", nil)
  }
}
```

**React Native Usage**:
```typescript
const symDecryptMessage = async (symmetricKey: string, encryptedData: string, version: string) => {
  try {
    const decrypted = await WalletModule.symDecryptMobile(symmetricKey, encryptedData, version);
    console.log('Symmetrically Decrypted:', decrypted);
    return decrypted;
  } catch (error) {
    console.error('Symmetric decryption failed:', error);
    throw error;
  }
};
```

**Return Value**:
```typescript
string  // Decrypted plain text message
```

**Error Codes**:
- `SYM_DECRYPT_ERROR`: Symmetric decryption operation failed

---

### 6. Wallet Address Generation

#### `privateKeyToWalletAddressMobile(privateKeyHex: string)`
**Purpose**: Derive a wallet address from a private key

**Parameters**:
- `privateKeyHex`: Private key in hexadecimal format

**Swift Implementation**:
```swift
@objc
func privateKeyToWalletAddressMobile(_ privateKeyHex: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  let address = Mobile_appsPrivateKeyToWalletAddressMobile(privateKeyHex, &error)
  if error == nil {
    resolve(address)
  } else if let error = error {
    reject("ADDRESS_ERROR", error.localizedDescription, error)
  } else {
    reject("ADDRESS_ERROR", "Unknown error", nil)
  }
}
```

**React Native Usage**:
```typescript
const getWalletAddress = async (privateKey: string) => {
  try {
    const address = await WalletModule.privateKeyToWalletAddressMobile(privateKey);
    console.log('Wallet Address:', address);
    return address;
  } catch (error) {
    console.error('Address generation failed:', error);
    throw error;
  }
};

// Example usage
const privateKey = "a1b2c3d4e5f6..."; // Your private key
const walletAddress = await getWalletAddress(privateKey);
console.log('Generated Address:', walletAddress);
```

**Return Value**:
```typescript
string  // Wallet address (e.g., "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6")
```

**Error Codes**:
- `ADDRESS_ERROR`: Address generation failed

---

### 7. Transaction Signing

#### `signTransactionMobile(txArgs: object, privKeyHex: string)`
**Purpose**: Sign a blockchain transaction

**Parameters**:
- `txArgs`: Transaction arguments object containing transaction details
- `privKeyHex`: Private key in hexadecimal format

**Transaction Arguments Structure**:
```typescript
interface TransactionArgs {
  nonce?: string;           // Transaction nonce
  gasPrice?: string;        // Gas price in wei
  gasLimit?: string;        // Gas limit
  to?: string;              // Recipient address
  value?: string;           // Amount to send in wei
  data?: string;            // Transaction data (for smart contracts)
  chainId: number;          // NCOG Earth Chain testnet (0x9af); REQUIRED, bound into the ML-DSA-87 SigningHash
}
```

**Swift Implementation**:
```swift
@objc
func signTransactionMobile(_ txArgs: [String: Any], privKeyHex: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  do {
    let txArgsJson = try JSONSerialization.data(withJSONObject: txArgs)
    let txArgsString = String(data: txArgsJson, encoding: .utf8) ?? "{}"
    var error: NSError?
    if let signedResult = Mobile_appsSignTransactionMobile(txArgsString, privKeyHex, &error) {
      let result: [String: Any] = [
        "rawTransaction": signedResult.rawTransaction,
        "hash": signedResult.hash
      ]
      resolve(result)
    } else if let error = error {
      reject("SIGN_TX_ERROR", error.localizedDescription, error)
    } else {
      reject("SIGN_TX_ERROR", "Unknown error", nil)
    }
  } catch {
    reject("SIGN_TX_ERROR", error.localizedDescription, error)
  }
}
```

**React Native Usage**:
```typescript
const signTransaction = async (txArgs: any, privateKey: string) => {
  try {
    const result = await WalletModule.signTransactionMobile(txArgs, privateKey);
    console.log('Raw Transaction:', result.rawTransaction);
    console.log('Transaction Hash:', result.hash);
    return result;
  } catch (error) {
    console.error('Transaction signing failed:', error);
    throw error;
  }
};

// Example usage
const transactionArgs = {
  nonce: "0x0",
  gasPrice: "0x09184e72a000", // 20 Gwei
  gasLimit: "0x27100",        // 100,000 gas
  to: "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
  value: "0x00",              // 0 (no value)
  data: "0x",                 // No data
  chainId: 2479               // NCOG Earth Chain testnet (0x9af); REQUIRED, bound into the ML-DSA-87 SigningHash
};

const privateKey = "a1b2c3d4e5f6..."; // Your private key
const signedTx = await signTransaction(transactionArgs, privateKey);
```

**Return Value**:
```typescript
{
  rawTransaction: string;  // Signed transaction in hex format
  hash: string;           // Transaction hash
}
```

**Error Codes**:
- `SIGN_TX_ERROR`: Transaction signing failed

---

### 8. RLP Transaction Decoding

#### `decodeRLPTransactionMobile(rlpHex: string)`
**Purpose**: Decode RLP-encoded transaction data

**Parameters**:
- `rlpHex`: RLP-encoded transaction in hexadecimal format

**Swift Implementation**:
```swift
@objc
func decodeRLPTransactionMobile(_ rlpHex: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
  var error: NSError?
  if let decodedResult = Mobile_appsDecodeRLPTransactionMobile(rlpHex, &error) {
    let result: [String: Any] = [
      "count": decodedResult.count
    ]
    resolve(result)
  } else if let error = error {
    reject("DECODE_RLP_ERROR", error.localizedDescription, error)
  } else {
    reject("DECODE_RLP_ERROR", "Unknown error", nil)
  }
}
```

**React Native Usage**:
```typescript
const decodeRLPTransaction = async (rlpHex: string) => {
  try {
    const result = await WalletModule.decodeRLPTransactionMobile(rlpHex);
    console.log('RLP Decoded Count:', result.count);
    return result;
  } catch (error) {
    console.error('RLP decoding failed:', error);
    throw error;
  }
};

// Example usage
const rlpData = "0xf86c8085174876e800830186a094095e7baea6a6c7c4c2dfeb977efac326af552d87830186a0801ba048b55bfa915ac795c431978d8a6a992b628d557da5ff759b307d495a36649353a0efffd310ac743f371de3b9f7f9cb56c0b28ad43601b4ab949f53faa07bd2c804";
const decoded = await decodeRLPTransaction(rlpData);
```

**Return Value**:
```typescript
{
  count: number;  // Number of decoded fields
}
```

**Error Codes**:
- `DECODE_RLP_ERROR`: RLP decoding failed

---

## Complete Example: End-to-End Workflow

```typescript
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

class WalletService {
  // Generate a new wallet
  async createWallet() {
    try {
      const keyPair = await WalletModule.keyGenMobile();
      const address = await WalletModule.privateKeyToWalletAddressMobile(keyPair.privKey);
      
      return {
        publicKey: keyPair.pubKey,
        privateKey: keyPair.privKey,
        address: address
      };
    } catch (error) {
      console.error('Wallet creation failed:', error);
      throw error;
    }
  }

  // Encrypt sensitive data
  async encryptData(publicKey: string, data: string) {
    try {
      const result = await WalletModule.encryptMobile(publicKey, data);
      return {
        encrypted: result.encrypted,
        version: result.version
      };
    } catch (error) {
      console.error('Data encryption failed:', error);
      throw error;
    }
  }

  // Decrypt sensitive data
  async decryptData(privateKey: string, encryptedData: string, version: string) {
    try {
      const decrypted = await WalletModule.decryptMobile(privateKey, encryptedData, version);
      return decrypted;
    } catch (error) {
      console.error('Data decryption failed:', error);
      throw error;
    }
  }

  // Send a transaction
  async sendTransaction(privateKey: string, toAddress: string, amount: string, gasPrice: string = "0x09184e72a000") {
    try {
      const txArgs = {
        nonce: "0x0", // You should get the actual nonce from the network
        gasPrice: gasPrice,
        gasLimit: "0x27100",
        to: toAddress,
        value: amount,
        data: "0x",
        chainId: 2479 // NCOG Earth Chain testnet (0x9af); REQUIRED, bound into the ML-DSA-87 SigningHash
      };

      const signedTx = await WalletModule.signTransactionMobile(txArgs, privateKey);
      return signedTx;
    } catch (error) {
      console.error('Transaction signing failed:', error);
      throw error;
    }
  }
}

// Usage example
const walletService = new WalletService();

// Create a new wallet
const wallet = await walletService.createWallet();
console.log('New wallet created:', wallet);

// Encrypt some data
const encrypted = await walletService.encryptData(wallet.publicKey, "Secret message");
console.log('Encrypted data:', encrypted);

// Decrypt the data
const decrypted = await walletService.decryptData(wallet.privateKey, encrypted.encrypted, encrypted.version);
console.log('Decrypted data:', decrypted);

// Send a transaction
const tx = await walletService.sendTransaction(
  wallet.privateKey,
  "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
  "0x2386f26fc10000" // 0.01 (1e16 wei)
);
console.log('Signed transaction:', tx);
```

## Error Handling Best Practices

1. **Always use try-catch blocks** around native module calls
2. **Check error codes** to handle specific error types
3. **Provide user-friendly error messages** based on error codes
4. **Log errors** for debugging purposes
5. **Implement retry logic** for transient failures

## Performance Considerations

1. **All functions are asynchronous** and don't block the main thread
2. **Functions run on background threads** for better performance
3. **Memory is managed automatically** by the native module
4. **Large data should be processed in chunks** if needed

## Security Notes

1. **Never log private keys** or sensitive data
2. **Validate all inputs** before passing to native functions
3. **Use secure storage** for private keys and sensitive data
4. **Implement proper key management** practices
5. **Consider using hardware security modules** for production apps 