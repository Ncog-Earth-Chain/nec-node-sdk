# React Native Setup Guide: AAR & XCFramework Integration

This comprehensive guide provides step-by-step instructions for setting up React Native applications with both Android AAR and iOS XCFramework integration for the NEC Node SDK.

## Overview

The NEC Node SDK provides native mobile libraries for React Native applications:

- **Android**: `mobile_apps.aar` - Android Archive library
- **iOS**: `MobileApps.xcframework` - XCFramework for iOS

These libraries provide:
- Quantum-resistant cryptography (MLKEM)
- Wallet management and transaction signing
- Smart contract interactions
- Address generation and validation
- Cross-platform compatibility

## Prerequisites

### Development Environment
- **React Native**: 0.72.0 or higher
- **Node.js**: 18.0 or higher
- **npm/yarn**: Latest stable version

### Android Requirements
- **Android Studio**: 4.0 or higher
- **Android SDK**: API level 21 or higher
- **Gradle**: 7.0 or higher
- **Java**: 8 or higher
- **Kotlin**: 1.8.0 or higher

### iOS Requirements
- **Xcode**: 15.0 or higher
- **iOS Deployment Target**: 13.0 or higher
- **CocoaPods**: Latest stable version
- **Swift**: 5.0 or higher

## Project Structure

```
YourReactNativeApp/
├── android/
│   ├── app/
│   │   ├── libs/
│   │   │   └── mobile_apps.aar          # Android AAR library
│   │   ├── src/
│   │   │   └── main/
│   │   │       ├── java/
│   │   │       │   └── com/
│   │   │       │       └── yourapp/
│   │   │       │           └── WalletModule.kt  # Android bridge
|   |   |       |           └── WalletPackage.kt  # Android Module       
│   │   │       └── AndroidManifest.xml
│   │   └── build.gradle
│   ├── gradle/
│   └── build.gradle
├── ios/
│   ├── Frameworks/
│   │   └── MobileApps.xcframework/      # iOS XCFramework
│   ├── YourApp/
│   │   ├── WalletModule.swift           # iOS bridge
│   │   ├── WalletModule.m               # Objective-C bridge
│   │   └── Info.plist
│   ├── Podfile
│   └── YourApp.xcworkspace
├── src/
│   ├── components/
│   │   └── WalletComponent.tsx          # React Native component
│   └── utils/
│       └── walletUtils.ts               # Utility functions
├── package.json
└── metro.config.js
```

## Android AAR Integration

### Step 1: Install NECJS SDK

```bash
npm install @ncog/necjs
```

### Step 2: Add AAR Library

1. **Download AAR**: Get `mobile_apps.aar` from the project root
2. **Place AAR**: Copy to `android/app/libs/mobile_apps.aar`

```bash
# Copy AAR to your project
cp mobile_apps.aar android/app/libs/
```

### Step 3: Configure Android Build

Update `android/app/build.gradle`:

```gradle
android {
    // ... existing config
    
    repositories {
        flatDir {
            dirs 'libs'
        }
    }
    
    // Ensure Java 8 compatibility
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
    
    kotlinOptions {
        jvmTarget = '1.8'
    }
}

dependencies {
    // ... existing dependencies
    
    // NEC AAR library
    implementation(name: 'mobile_apps', ext: 'aar')
    
    // Required dependencies
    implementation 'org.web3j:core:4.9.8'
    implementation 'com.google.code.gson:gson:2.10.1'
    implementation 'org.bouncycastle:bcprov-jdk15on:1.70'
    
    // React Native dependencies
    implementation "com.facebook.react:react-native:+"
    implementation "org.jetbrains.kotlin:kotlin-stdlib:1.8.0"
}
```

### Step 4: Create Android Native Bridge

Create `android/app/src/main/java/com/yourapp/WalletModule.kt`:

```kotlin
package com.yourapp

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import mobile_apps.Mobile_apps as NativeWalletModule

class WalletModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val nativeWalletModule = NativeWalletModule()
    
    override fun getName(): String {
        return "WalletModule"
    }
    
    // MARK: - Key Generation
    
    @ReactMethod
    fun keyGenMobile(promise: Promise) {
        try {
            val keyPair = nativeWalletModule.keyGenMobile()
            val result = Arguments.createMap().apply {
                putString("pubKey", keyPair.pubKey)
                putString("privKey", keyPair.privKey)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("KEY_GEN_ERROR", e.message, e)
        }
    }
    
    // MARK: - Address Generation
    
    @ReactMethod
    fun privateKeyToWalletAddressMobile(privateKey: String, promise: Promise) {
        try {
            val address = nativeWalletModule.privateKeyToWalletAddressMobile(privateKey)
            promise.resolve(address)
        } catch (e: Exception) {
            promise.reject("ADDRESS_ERROR", e.message, e)
        }
    }
    
    // MARK: - Encryption
    
    @ReactMethod
    fun encryptMobile(pubKeyHex: String, message: String, promise: Promise) {
        try {
            val encrypted = nativeWalletModule.encryptMobile(pubKeyHex, message)
            val result = Arguments.createMap().apply {
                putString("encrypted", encrypted.encrypted)
                putString("version", encrypted.version)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ENCRYPT_ERROR", e.message, e)
        }
    }
    
    @ReactMethod
    fun decryptMobile(privKeyHex: String, encryptedData: String, version: String, promise: Promise) {
        try {
            val decrypted = nativeWalletModule.decryptMobile(privKeyHex, encryptedData, version)
            promise.resolve(decrypted)
        } catch (e: Exception) {
            promise.reject("DECRYPT_ERROR", e.message, e)
        }
    }
    
    // MARK: - Transaction Signing
    
    @ReactMethod
    fun signTransactionMobile(txArgs: ReadableMap, privateKey: String, promise: Promise) {
        try {
            val txObject = txArgs.toHashMap()
            val signedTx = nativeWalletModule.signTransactionMobile(txObject, privateKey)
            promise.resolve(signedTx)
        } catch (e: Exception) {
            promise.reject("SIGN_ERROR", e.message, e)
        }
    }
    
    @ReactMethod
    fun decodeRLPTransactionMobile(txHex: String, promise: Promise) {
        try {
            val decoded = nativeWalletModule.decodeRLPTransactionMobile(txHex)
            promise.resolve(decoded)
        } catch (e: Exception) {
            promise.reject("DECODE_ERROR", e.message, e)
        }
    }
    
    // MARK: - Symmetric Encryption
    
    @ReactMethod
    fun symEncryptMobile(ssKey: String, message: String, promise: Promise) {
        try {
            val encrypted = nativeWalletModule.symEncryptMobile(ssKey, message)
            val result = Arguments.createMap().apply {
                putString("encrypted", encrypted.encrypted)
                putString("version", encrypted.version)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("SYM_ENCRYPT_ERROR", e.message, e)
        }
    }
    
    @ReactMethod
    fun symDecryptMobile(ssKey: String, encryptedData: String, version: String, promise: Promise) {
        try {
            val decrypted = nativeWalletModule.symDecryptMobile(ssKey, encryptedData, version)
            promise.resolve(decrypted)
        } catch (e: Exception) {
            promise.reject("SYM_DECRYPT_ERROR", e.message, e)
        }
    }
}
```

### Step 5: Register Android Module

Create `android/app/src/main/java/com/yourapp/WalletPackage.kt`:

```kotlin
package com.yourapp

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class WalletPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(WalletModule(reactContext))
    }
    
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
```

Update `android/app/src/main/java/com/yourapp/MainApplication.kt`:

```kotlin
// ... existing imports
import com.yourapp.WalletPackage

class MainApplication : Application(), ReactApplication {
    private val mReactNativeHost = object : ReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> {
            return PackageList(this).packages.apply {
                add(WalletPackage())
            }
        }
        // ... rest of implementation
    }
}
```

## iOS XCFramework Integration

### Step 1: Install NECJS SDK

```bash
npm install @ncog/necjs
```

### Step 2: Add XCFramework

1. **Download XCFramework**: Get `MobileApps.xcframework` from the project root
2. **Place XCFramework**: Copy to `ios/Frameworks/MobileApps.xcframework`

```bash
# Copy XCFramework to your project
cp -r MobileApps.xcframework ios/Frameworks/
```

### Step 3: Configure iOS Project

1. **Open Xcode**: Open your `.xcworkspace` file
2. **Add Framework**: Right-click project → "Add Files to [ProjectName]"
3. **Select Framework**: Navigate to `ios/Frameworks/MobileApps.xcframework`
4. **Configure Target**: Ensure "Add to target" is checked
5. **Embed Framework**: Set "Embed & Sign" in target settings

### Step 4: Create iOS Native Bridge

Create `ios/YourApp/WalletModule.swift`:

```swift
import Foundation
import React
import MobileApps

@objc(WalletModule)
class WalletModule: NSObject {
    
    @objc
    static func requiresMainQueueSetup() -> Bool {
        return false
    }
    
    // MARK: - Key Generation
    
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
    
    // MARK: - Address Generation
    
    @objc
    func privateKeyToWalletAddressMobile(_ privateKey: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        var error: NSError?
        let address = Mobile_appsPrivateKeyToWalletAddressMobile(privateKey, &error)
        if error == nil {
            resolve(address)
        } else if let error = error {
            reject("ADDRESS_ERROR", error.localizedDescription, error)
        } else {
            reject("ADDRESS_ERROR", "Unknown error", nil)
        }
    }
    
    // MARK: - Encryption
    
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
    
    // MARK: - Transaction Signing
    
    @objc
    func signTransactionMobile(_ txArgs: [String: Any], privateKey: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        var error: NSError?
        if let signedTx = Mobile_appsSignTransactionMobile(txArgs, privateKey, &error) {
            resolve(signedTx)
        } else if let error = error {
            reject("SIGN_ERROR", error.localizedDescription, error)
        } else {
            reject("SIGN_ERROR", "Unknown error", nil)
        }
    }
    
    @objc
    func decodeRLPTransactionMobile(_ txHex: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        var error: NSError?
        if let decoded = Mobile_appsDecodeRLPTransactionMobile(txHex, &error) {
            resolve(decoded)
        } else if let error = error {
            reject("DECODE_ERROR", error.localizedDescription, error)
        } else {
            reject("DECODE_ERROR", "Unknown error", nil)
        }
    }
    
    // MARK: - Symmetric Encryption
    
    @objc
    func symEncryptMobile(_ ssKey: String, message: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        var error: NSError?
        if let encryptedResult = Mobile_appsSymEncryptMobile(ssKey, message, &error) {
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
    
    @objc
    func symDecryptMobile(_ ssKey: String, encryptedData: String, version: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        var error: NSError?
        let decryptedText = Mobile_appsSymDecryptMobile(ssKey, encryptedData, version, &error)
        if error == nil {
            resolve(decryptedText)
        } else if let error = error {
            reject("SYM_DECRYPT_ERROR", error.localizedDescription, error)
        } else {
            reject("SYM_DECRYPT_ERROR", "Unknown error", nil)
        }
    }
}
```

### Step 5: Create Objective-C Bridge

Create `ios/YourApp/WalletModule.m`:

```objc
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WalletModule, NSObject)

// Key Generation
RCT_EXTERN_METHOD(keyGenMobile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Address Generation
RCT_EXTERN_METHOD(privateKeyToWalletAddressMobile:(NSString *)privateKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Encryption
RCT_EXTERN_METHOD(encryptMobile:(NSString *)pubKeyHex
                  message:(NSString *)message
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decryptMobile:(NSString *)privKeyHex
                  encryptedData:(NSString *)encryptedData
                  version:(NSString *)version
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Transaction Signing
RCT_EXTERN_METHOD(signTransactionMobile:(NSDictionary *)txArgs
                  privateKey:(NSString *)privateKey
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decodeRLPTransactionMobile:(NSString *)txHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

// Symmetric Encryption
RCT_EXTERN_METHOD(symEncryptMobile:(NSString *)ssKey
                  message:(NSString *)message
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(symDecryptMobile:(NSString *)ssKey
                  encryptedData:(NSString *)encryptedData
                  version:(NSString *)version
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
```

## React Native Bridge Implementation

### TypeScript Definitions

Create `src/types/WalletModule.d.ts`:

```typescript
export interface WalletModule {
  // Key Generation
  keyGenMobile(): Promise<{ pubKey: string; privKey: string }>;
  
  // Address Generation
  privateKeyToWalletAddressMobile(privateKey: string): Promise<string>;
  
  // Encryption
  encryptMobile(pubKeyHex: string, message: string): Promise<{ encrypted: string; version: string }>;
  decryptMobile(privKeyHex: string, encryptedData: string, version: string): Promise<string>;
  
  // Transaction Signing
  signTransactionMobile(txArgs: any, privateKey: string): Promise<any>;
  decodeRLPTransactionMobile(txHex: string): Promise<any>;
  
  // Symmetric Encryption
  symEncryptMobile(ssKey: string, message: string): Promise<{ encrypted: string; version: string }>;
  symDecryptMobile(ssKey: string, encryptedData: string, version: string): Promise<string>;
}

declare global {
  interface NativeModulesStatic {
    WalletModule: WalletModule;
  }
}
```

### React Native Component

Create `src/components/WalletComponent.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert, StyleSheet } from 'react-native';
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

interface WalletState {
  publicKey: string;
  privateKey: string;
  address: string;
  isLoading: boolean;
}

export const WalletComponent: React.FC = () => {
  const [wallet, setWallet] = useState<WalletState>({
    publicKey: '',
    privateKey: '',
    address: '',
    isLoading: false
  });

  const generateWallet = async () => {
    try {
      setWallet(prev => ({ ...prev, isLoading: true }));
      
      const keyPair = await WalletModule.keyGenMobile();
      
      setWallet({
        publicKey: keyPair.pubKey,
        privateKey: keyPair.privKey,
        isLoading: false
      });
      
      Alert.alert('Success', 'Wallet generated successfully!');
    } catch (error) {
      setWallet(prev => ({ ...prev, isLoading: false }));
      Alert.alert('Error', `Failed to generate wallet: ${error.message}`);
    }
  };

  const testEncryption = async () => {
    if (!wallet.publicKey || !wallet.privateKey) {
      Alert.alert('Error', 'Please generate a wallet first');
      return;
    }

    try {
      const message = 'Hello, Quantum World!';
      const encrypted = await WalletModule.encryptMobile(wallet.publicKey, message);
      const decrypted = await WalletModule.decryptMobile(wallet.privateKey, encrypted.encrypted, encrypted.version);
      
      Alert.alert('Encryption Test', `Original: ${message}\nDecrypted: ${decrypted}`);
    } catch (error) {
      Alert.alert('Error', `Encryption test failed: ${error.message}`);
    }
  };

  const testTransactionSigning = async () => {
    if (!wallet.privateKey) {
      Alert.alert('Error', 'Please generate a wallet first');
      return;
    }

    try {
      const txObject = {
        to: '0x1234567890123456789012345678901234567890',
        value: '0x1000000000000000000',
        gasPrice: '0x09184e72a000',
        nonce: 0
      };

      const signedTx = await WalletModule.signTransactionMobile(txObject, wallet.privateKey);
      Alert.alert('Transaction Signed', `Signed TX: ${signedTx}`);
    } catch (error) {
      Alert.alert('Error', `Transaction signing failed: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>NEC Wallet</Text>
      
      <Button
        title={wallet.isLoading ? 'Generating...' : 'Generate Wallet'}
        onPress={generateWallet}
        disabled={wallet.isLoading}
      />
      
      {wallet.address && (
        <View style={styles.walletInfo}>
          <Text style={styles.label}>Address:</Text>
          <Text style={styles.value}>{wallet.address}</Text>
          
          <Text style={styles.label}>Public Key:</Text>
          <Text style={styles.value}>{wallet.publicKey.substring(0, 20)}...</Text>
          
          <Button title="Test Encryption" onPress={testEncryption} />
          <Button title="Test Transaction Signing" onPress={testTransactionSigning} />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20
  },
  walletInfo: {
    marginTop: 20,
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 8
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 10
  },
  value: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
    fontFamily: 'monospace'
  }
});
```

## Usage Examples

### Basic Wallet Operations

```typescript
import { NativeModules } from 'react-native';
const { WalletModule } = NativeModules;

// Generate wallet
const keyPair = await WalletModule.keyGenMobile();
const address = await WalletModule.privateKeyToWalletAddressMobile(keyPair.privKey);

console.log('Wallet generated:', { address, publicKey: keyPair.pubKey });
```

### Encryption Operations

```typescript
// Asymmetric encryption
const message = 'Secret message';
const encrypted = await WalletModule.encryptMobile(keyPair.pubKey, message);
const decrypted = await WalletModule.decryptMobile(keyPair.privKey, encrypted.encrypted, encrypted.version);

console.log('Encryption test:', message === decrypted);

// Symmetric encryption
const sharedSecret = 'shared-secret-key';
const symEncrypted = await WalletModule.symEncryptMobile(sharedSecret, message);
const symDecrypted = await WalletModule.symDecryptMobile(sharedSecret, symEncrypted.encrypted, symEncrypted.version);
```

### Transaction Operations

```typescript
// Sign transaction
// chainId is REQUIRED — it is folded into the ML-DSA-87 SigningHash for replay
// protection, so a tx without it (or with chainId 1) is rejected by the node.
const txObject = {
  to: '0x1234567890123456789012345678901234567890',
  value: '0x1000000000000000000',
  gasPrice: '0x09184e72a000',
  nonce: 0,
  chainId: 2479 // NCOG testnet (0x9af)
};

const signedTx = await WalletModule.signTransactionMobile(txObject, keyPair.privKey);
console.log('Signed transaction:', signedTx);

// Decode transaction
const decodedTx = await WalletModule.decodeRLPTransactionMobile(signedTx);
console.log('Decoded transaction:', decodedTx);
```

## Core Features

### 1. Address Derivation

```typescript
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

export const deriveAddress = async (mldsa87PrivateKey: string): Promise<string> => {
  try {
    const address = await WalletModule.privateKeyToWalletAddressMobile(mldsa87PrivateKey);
    return address;
  } catch (error) {
    console.error('Error deriving address:', error);
    throw error;
  }
};
```

### 2. Transaction Signing

```typescript
export const signTransaction = async (
  txParams: {
    to: string;
    value: string;
    gas: string;
    gasPrice: string;
    nonce: string;
    chainId: number; // REQUIRED — folded into the ML-DSA-87 SigningHash (NCOG testnet = 2479 / 0x9af)
  },
  mldsa87PrivateKey: string
): Promise<{
  rawTransaction: string;
  hash: string;
}> => {
  try {
    const signedResult = await WalletModule.signTransactionMobile(txParams, mldsa87PrivateKey);
    return signedResult;
  } catch (error) {
    console.error('Error signing transaction:', error);
    throw error;
  }
};
```

### 3. Complete Transaction Example

```typescript
import { Provider } from '@ncog/necjs';
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

export class ReactNativeWallet {
  private provider: Provider;
  
  constructor(rpcUrl: string = 'https://rpc-url') {
    this.provider = new Provider(rpcUrl);
  }
  
  async sendTransaction(
    to: string,
    amount: string,
    mldsa87PrivateKey: string
  ): Promise<string> {
    try {
      // Get sender address
      const sender = await WalletModule.privateKeyToWalletAddressMobile(mldsa87PrivateKey);
      
      // Get transaction parameters
      const gasPrice = await this.provider.getGasPrice();
      const nonce = await this.provider.getTransactionCount(sender);
      const gasLimit = '21000'; // Standard transfer
      // chainId is REQUIRED and folded into the ML-DSA-87 SigningHash for replay
      // protection — fetch it from the node (NCOG testnet returns 2479 / 0x9af).
      const chainId = await this.provider.getChainId();
      
      // Create transaction
      const txArgs = {
        to,
        value: amount,
        gas: gasLimit,
        gasPrice: gasPrice.toString(),
        nonce: nonce.toString(),
        chainId
      };
      
      // Sign transaction
      const signedResult = await WalletModule.signTransactionMobile(txArgs, mldsa87PrivateKey);
      
      // Send transaction
      const txHash = await this.provider.sendRawTransaction(signedResult.rawTransaction);
      
      return txHash;
    } catch (error) {
      console.error('Error sending transaction:', error);
      throw error;
    }
  }
  
  async getBalance(mldsa87PrivateKey: string): Promise<string> {
    try {
      const address = await WalletModule.privateKeyToWalletAddressMobile(mldsa87PrivateKey);
      const balance = await this.provider.getBalance(address);
      return balance.toString();
    } catch (error) {
      console.error('Error getting balance:', error);
      throw error;
    }
  }
}
```

## Smart Contract Integration

### ERC-20 Token Operations

```typescript
import { Provider, Contract, decimalToWei } from '@ncog/necjs';
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

const ERC20_ABI = [
  "function transfer(address to, uint256 value) public returns (bool)",
  "function balanceOf(address who) public view returns (uint256)",
  "function allowance(address owner, address spender) public view returns (uint256)",
  "function transferFrom(address from, address to, uint256 value) public returns (bool)",
  "function approve(address spender, uint256 value) public returns (bool)"
];

export class TokenManager {
  private provider: Provider;
  
  constructor(rpcUrl: string = 'https://rpc-url') {
    this.provider = new Provider(rpcUrl);
  }
  
  async sendToken(
    tokenAddress: string,
    to: string,
    amount: string,
    mldsa87PrivateKey: string
  ): Promise<string> {
    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const sender = await WalletModule.privateKeyToWalletAddressMobile(mldsa87PrivateKey);
      
      // Convert amount to Wei
      const amountInWei = decimalToWei(amount);
      
      // Estimate gas
      const estimatedGas = await contract.methods
        .transfer(to, amountInWei)
        .estimateGas({ from: sender });
      
      const gasLimit = Math.floor(Number(estimatedGas) * 1.2);
      const gasPrice = await this.provider.getGasPrice();
      const nonce = await this.provider.getTransactionCount(sender);
      
      // Create transaction
      const result = await contract.methods
        .transfer(to, amountInWei)
        .nativeSend({
          from: tokenAddress || sender,
          gas: gasLimit,
          gasPrice: gasPrice,
          nonce
        });
      
      // Sign and send transaction
      const signedResult = await WalletModule.signTransactionMobile(result, mldsa87PrivateKey);
      const txHash = await this.provider.sendRawTransaction(signedResult.rawTransaction);
      
      return txHash;
    } catch (error) {
      console.error('Error sending token:', error);
      throw error;
    }
  }
  
  async getTokenBalance(
    tokenAddress: string,
    walletAddress: string
  ): Promise<string> {
    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await contract.methods.balanceOf(walletAddress).call();
      return balance.toString();
    } catch (error) {
      console.error('Error getting token balance:', error);
      throw error;
    }
  }
}
```

## React Native Component Example

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { ReactNativeWallet } from './ReactNativeWallet';
import { TokenManager } from './TokenManager';

const WalletScreen: React.FC = () => {
  const [privateKey, setPrivateKey] = useState('');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  
  const wallet = new ReactNativeWallet();
  const tokenManager = new TokenManager();
  
  useEffect(() => {
    if (privateKey) {
      deriveAddress();
    }
  }, [privateKey]);
  
  const deriveAddress = async () => {
    try {
      const addr = await wallet.deriveAddress(privateKey);
      setAddress(addr);
      await getBalance();
    } catch (error) {
      Alert.alert('Error', 'Failed to derive address');
    }
  };
  
  const getBalance = async () => {
    try {
      const bal = await wallet.getBalance(privateKey);
      setBalance(bal);
    } catch (error) {
      Alert.alert('Error', 'Failed to get balance');
    }
  };
  
  const sendTransaction = async () => {
    try {
      const txHash = await wallet.sendTransaction(recipient, amount, privateKey);
      Alert.alert('Success', `Transaction sent: ${txHash}`);
      await getBalance();
    } catch (error) {
      Alert.alert('Error', 'Failed to send transaction');
    }
  };
  
  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>React Native Wallet</Text>
      
      <TextInput
        placeholder="Mldsa87 Private Key"
        value={privateKey}
        onChangeText={setPrivateKey}
        style={{ borderWidth: 1, padding: 10, marginBottom: 10 }}
      />
      
      {address && (
        <View>
          <Text>Address: {address}</Text>
          <Text>Balance: {balance}</Text>
        </View>
      )}
      
      <TextInput
        placeholder="Recipient Address"
        value={recipient}
        onChangeText={setRecipient}
        style={{ borderWidth: 1, padding: 10, marginBottom: 10 }}
      />
      
      <TextInput
        placeholder="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        style={{ borderWidth: 1, padding: 10, marginBottom: 10 }}
      />
      
      <TouchableOpacity
        onPress={sendTransaction}
        style={{ backgroundColor: 'blue', padding: 15, alignItems: 'center' }}
      >
        <Text style={{ color: 'white' }}>Send Transaction</Text>
      </TouchableOpacity>
    </View>
  );
};

export default WalletScreen;
```

## Troubleshooting

### Android Issues

**Build Errors:**
```bash
# Clean and rebuild
cd android && ./gradlew clean
cd .. && npx react-native run-android
```

**AAR Not Found:**
- Ensure `mobile_apps.aar` is in `android/app/libs/`
- Check `flatDir` repository configuration
- Verify file permissions

**Kotlin Version Conflicts:**
```gradle
// In android/build.gradle
buildscript {
    ext.kotlin_version = '1.8.0'
}
```

### iOS Issues

**Framework Not Found:**
- Ensure XCFramework is properly added to Xcode project
- Check "Embed & Sign" setting
- Verify framework path in Build Settings

**Swift Compilation Errors:**
- Check Swift version compatibility
- Ensure proper import statements
- Verify Objective-C bridge file

**Simulator Issues:**
- Use correct XCFramework variant (ios-arm64-simulator)
- Check deployment target compatibility

### General React Native Issues

**Metro Cache:**
```bash
npx react-native start --reset-cache
```

**Module Not Found:**
- Ensure native modules are properly registered
- Check import paths
- Verify TypeScript definitions

## Security Considerations

### Private Key Management
- Never store private keys in plain text
- Use secure storage (Keychain/Keystore)
- Implement proper key derivation
- Consider hardware security modules

### Encryption Best Practices
- Use strong random number generation
- Implement proper key rotation
- Validate all inputs
- Handle errors securely

### Transaction Security
- Validate transaction parameters
- Implement nonce management
- Use proper gas estimation
- Monitor for suspicious activity

### Platform-Specific Security
- **Android**: Use Android Keystore
- **iOS**: Use iOS Keychain
- **React Native**: Implement secure storage
- **Network**: Use HTTPS/TLS

### Code Security
- Obfuscate sensitive code
- Implement certificate pinning
- Use secure communication channels
- Regular security audits

This comprehensive setup guide provides everything needed to integrate the NEC Node SDK with React Native applications using both Android AAR and iOS XCFramework libraries. 