# React Native Android AAR Integration Guide: Wallet with Transaction & Smart Contract Support

## Overview

This guide provides comprehensive instructions for integrating the Wallet AAR (Android Archive) library into your React Native Android application. The library supports cryptocurrency transactions, ERC-20 token operations, and smart contract interactions specifically optimized for React Native environments.

## Prerequisites

- React Native 0.80.2 or higher
- Android Studio 4.0 or higher
- Android SDK API level 21 or higher
- Gradle 7.0 or higher
- Java 8 or higher
- Node.js 16.0 or higher

## Installation

### 1. Install the NECJS SDK

```bash
npm install @ncog/necjs
```

### 2. Add AAR to your React Native project

Place the `mobile_apps.aar` file in your React Native project's `android/app/libs` directory:

```
android/
├── app/
│   ├── libs/
│   │   └── mobile_apps.aar
│   ├── src/
│   └── build.gradle
├── gradle/
└── build.gradle
```

### 3. Configure Android build.gradle

Update your `android/app/build.gradle`:

```gradle
android {
    // ... existing config
    
    repositories {
        flatDir {
            dirs 'libs'
        }
    }
}

dependencies {
    // ... existing dependencies
    
    implementation(name: 'wallet', ext: 'aar')
    
    // Required dependencies for React Native
    implementation 'org.web3j:core:4.9.8'
    implementation 'com.google.code.gson:gson:2.10.1'
    implementation 'org.bouncycastle:bcprov-jdk15on:1.70'
    
    // React Native specific dependencies
    implementation "com.facebook.react:react-native:+"
    implementation "org.jetbrains.kotlin:kotlin-stdlib:1.8.0"
}
```

### 4. Create Native Module Bridge

Create a new file `android/app/src/main/java/com/yourpackage/WalletModule.kt`:

```kotlin
package com.yourpackage

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import mobile_apps.Mobile_apps as NativeWalletModule

class WalletModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val nativeWalletModule = NativeWalletModule()
    
    override fun getName(): String {
        return "WalletModule"
    }
    
    @ReactMethod
    fun privateKeyToWalletAddressMobile(privateKey: String, promise: Promise) {
        try {
            val address = nativeWalletModule.privateKeyToWalletAddress(privateKey)
            promise.resolve(address)
        } catch (e: Exception) {
            promise.reject("WALLET_ERROR", e.message, e)
        }
    }
    
    @ReactMethod
    fun signTransactionMobile(txArgs: ReadableMap, privateKey: String, promise: Promise) {
        try {
            val txParams = txArgs.toHashMap()
            val signedResult = nativeWalletModule.signTransaction(txParams, privateKey)
            
            val result = Arguments.createMap().apply {
                putString("rawTransaction", signedResult.rawTransaction)
                putString("hash", signedResult.hash)
            }
            
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("SIGNATURE_ERROR", e.message, e)
        }
    }
}
```

### 5. Create Package Class

Create `android/app/src/main/java/com/yourpackage/WalletPackage.kt`:

```kotlin
package com.yourpackage

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

### 6. Register the Package

Update your `android/app/src/main/java/com/yourpackage/MainApplication.kt`:

```kotlin
// ... existing imports
import com.yourpackage.WalletPackage

class MainApplication : Application(), ReactApplication {
    private val mReactNativeHost = object : ReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> {
            return PackageList(this).packages.apply {
                // Add the wallet package
                add(WalletPackage())
            }
        }
        
        // ... rest of existing code
    }
}
```

### 7. Sync and Build

```bash
cd android
./gradlew clean
cd ..
npx react-native run-android
```

## React Native Integration

### Import the SDK

```typescript
import { Provider, Contract, ContractFactory } from '@ncog/necjs';
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;
```

### TypeScript Definitions

Create `src/types/wallet.d.ts`:

```typescript
declare module 'react-native' {
  interface NativeModulesStatic {
    WalletModule: {
      privateKeyToWalletAddressMobile(privateKey: string): Promise<string>;
      signTransactionMobile(txArgs: any, privateKey: string): Promise<{
        rawTransaction: string;
        hash: string;
      }>;
    };
  }
}
```

## Core Features

### 1. Address Derivation

```typescript
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

export const deriveAddress = async (privateKey: string): Promise<string> => {
  try {
    const address = await WalletModule.privateKeyToWalletAddressMobile(privateKey);
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
  },
  privateKey: string
): Promise<{
  rawTransaction: string;
  hash: string;
}> => {
  try {
    const signedResult = await WalletModule.signTransactionMobile(txParams, privateKey);
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
    privateKey: string
  ): Promise<string> {
    try {
      // Get sender address
      const sender = await WalletModule.privateKeyToWalletAddressMobile(privateKey);
      
      // Get transaction parameters
      const gasPrice = await this.provider.getGasPrice();
      const nonce = await this.provider.getTransactionCount(sender);
      const gasLimit = '21000'; // Standard transfer
      
      // Create transaction
      const txArgs = {
        to,
        value: amount,
        gas: gasLimit,
        gasPrice: gasPrice.toString(),
        nonce: nonce.toString()
      };
      
      // Sign transaction
      const signedResult = await WalletModule.signTransactionMobile(txArgs, privateKey);
      
      // Send transaction
      const txHash = await this.provider.sendRawTransaction(signedResult.rawTransaction);
      
      return txHash;
    } catch (error) {
      console.error('Error sending transaction:', error);
      throw error;
    }
  }
  
  async getBalance(privateKey: string): Promise<string> {
    try {
      const address = await WalletModule.privateKeyToWalletAddressMobile(privateKey);
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
    privateKey: string
  ): Promise<string> {
    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const sender = await WalletModule.privateKeyToWalletAddressMobile(privateKey);
      
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
          from: tokenAddress,
          gas: gasLimit,
          gasPrice: gasPrice,
          nonce
        });
      
      // Sign and send transaction
      const signedResult = await WalletModule.signTransactionMobile(result, privateKey);
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
        placeholder="Private Key"
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

## Security Considerations

### 1. Private Key Management

```typescript
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encrypt, decrypt } from 'react-native-crypto-js';

const { WalletModule } = NativeModules;

export class SecureWallet {
  private encryptionKey: string;
  
  constructor(encryptionKey: string) {
    this.encryptionKey = encryptionKey;
  }
  
  async storePrivateKey(privateKey: string): Promise<void> {
    try {
      const encrypted = encrypt(privateKey, this.encryptionKey).toString();
      await AsyncStorage.setItem('encrypted_private_key', encrypted);
    } catch (error) {
      console.error('Error storing private key:', error);
      throw error;
    }
  }
  
  async getPrivateKey(): Promise<string> {
    try {
      const encrypted = await AsyncStorage.getItem('encrypted_private_key');
      if (!encrypted) {
        throw new Error('No private key found');
      }
      
      const decrypted = decrypt(encrypted, this.encryptionKey);
      return decrypted.toString();
    } catch (error) {
      console.error('Error retrieving private key:', error);
      throw error;
    }
  }
  
  async clearPrivateKey(): Promise<void> {
    try {
      await AsyncStorage.removeItem('encrypted_private_key');
    } catch (error) {
      console.error('Error clearing private key:', error);
      throw error;
    }
  }
}
```

## Error Handling

### React Native Specific Error Handling

```typescript
export enum WalletError {
  NATIVE_MODULE_NOT_FOUND = 'NATIVE_MODULE_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  SIGNATURE_ERROR = 'SIGNATURE_ERROR',
  BIOMETRIC_ERROR = 'BIOMETRIC_ERROR'
}

export class ReactNativeWalletException extends Error {
  constructor(
    public type: WalletError,
    public message: string,
    public originalError?: any
  ) {
    super(message);
    this.name = 'ReactNativeWalletException';
  }
}

export const handleReactNativeWalletError = (error: any): ReactNativeWalletException => {
  if (error.code === 'NATIVE_MODULE_NOT_FOUND') {
    return new ReactNativeWalletException(
      WalletError.NATIVE_MODULE_NOT_FOUND,
      'Native wallet module not found. Please ensure AAR is properly integrated.'
    );
  }
  
  if (error.message?.includes('insufficient funds')) {
    return new ReactNativeWalletException(
      WalletError.INSUFFICIENT_BALANCE,
      'Insufficient balance for transaction'
    );
  }
  
  if (error.message?.includes('invalid address')) {
    return new ReactNativeWalletException(
      WalletError.INVALID_ADDRESS,
      'Invalid wallet address provided'
    );
  }
  
  return new ReactNativeWalletException(
    WalletError.TRANSACTION_FAILED,
    'Transaction failed',
    error
  );
};
```

## Troubleshooting

### Common React Native Issues

1. **Native module not found**
   ```bash
   # Clean and rebuild
   cd android
   ./gradlew clean
   cd ..
   npx react-native run-android
   ```

2. **AAR not found**
   - Ensure `mobile_apps.aar` is in `android/app/libs/`
   - Check `flatDir` repository configuration
   - Verify Gradle sync completed successfully

3. **Metro bundler issues**
   ```bash
   # Clear Metro cache
   npx react-native start --reset-cache
   ```

4. **Permission issues**
   - Add required permissions to `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
   ```

5. **ProGuard/R8 issues**
   - Add to `android/app/proguard-rules.pro`:
   ```proguard
   -keep class com.wallet.** { *; }
   -keep class com.yourpackage.WalletModule { *; }
   ```

### Debug Mode

```typescript
const DEBUG_MODE = __DEV__;

export const debugLog = (message: string, data?: any) => {
  if (DEBUG_MODE) {
    console.log(`[React Native Wallet Debug] ${message}`, data || '');
  }
};
```

## Performance Optimization

1. **Background processing** for heavy operations
2. **Caching** for frequently accessed data
3. **Connection pooling** for network requests
4. **Memory management** for large transactions

## Testing

### Unit Tests

```typescript
import { ReactNativeWallet } from './ReactNativeWallet';

describe('ReactNativeWallet', () => {
  let wallet: ReactNativeWallet;
  
  beforeEach(() => {
    wallet = new ReactNativeWallet();
  });
  
  test('should derive address from private key', async () => {
    const privateKey = '0x1234567890abcdef...';
    const address = await wallet.deriveAddress(privateKey);
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
```

### Integration Tests

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import WalletScreen from './WalletScreen';

describe('WalletScreen', () => {
  test('should send transaction successfully', async () => {
    const { getByPlaceholderText, getByText } = render(<WalletScreen />);
    
    fireEvent.changeText(getByPlaceholderText('Private Key'), 'test-key');
    fireEvent.changeText(getByPlaceholderText('Recipient Address'), '0x123...');
    fireEvent.changeText(getByPlaceholderText('Amount'), '1000000000000000000');
    
    fireEvent.press(getByText('Send Transaction'));
    
    await waitFor(() => {
      expect(getByText(/Transaction sent/)).toBeTruthy();
    });
  });
});
```

**Note**: This guide is specifically designed for React Native Android integration. For iOS integration, refer to the iOS-specific documentation. Always refer to the latest documentation and release notes for the most up-to-date information. 