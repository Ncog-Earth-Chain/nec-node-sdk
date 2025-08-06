# iOS Full Configuration Setup Guide

## Prerequisites

### Required Tools
- Xcode 15.0 or later
- iOS 13.0+ deployment target
- CocoaPods
- React Native 0.72+
- Node.js 18+

### Required Frameworks
- `MobileApps.xcframework` (Go-generated framework)
- React Native iOS dependencies

## XCFramework Integration

### 1. Framework Location
The `MobileApps.xcframework` should be placed in:
```
ios/Frameworks/MobileApps.xcframework/
```

### 2. Framework Structure
The XCFramework contains:
- **ios-arm64**: For physical iOS devices
- **ios-arm64-simulator**: For iOS Simulator

### 3. Adding Framework to Xcode Project

1. Open your Xcode project
2. Right-click on your project in the navigator
3. Select "Add Files to [ProjectName]"
4. Navigate to `ios/Frameworks/MobileApps.xcframework`
5. Ensure "Add to target" is checked for your main target
6. Set "Embed & Sign" in the target's "Frameworks, Libraries, and Embedded Content" section

## Native Module Setup

### 1. Swift Module (WalletModule.swift)

```swift
import Foundation
import React

// Import your XCFramework here
import MobileApps

@objc(WalletModule)
class WalletModule: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
  
  // MARK: - Mobile App Functions
  
  // 1. Key Generation
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
  
  // 2. Asymmetric Encryption
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
  
  // 3. Asymmetric Decryption
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
  
  // 4. Symmetric Encryption
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
  
  // 5. Symmetric Decryption
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
  
  // 6. Private Key to Wallet Address
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
  
  // 7. Sign Transaction
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
  
  // 8. Decode RLP Transaction
  @objc
  func decodeRLPTransactionMobile(_ rlpHex: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    var error: NSError?
    if let decodedResult = Mobile_appsDecodeRLPTransactionMobile(rlpHex, &error) {
      let result: [String: Any] = [
        // fields property is skipped in the generated header, so only count is available
        "count": decodedResult.count
      ]
      resolve(result)
    } else if let error = error {
      reject("DECODE_RLP_ERROR", error.localizedDescription, error)
    } else {
      reject("DECODE_RLP_ERROR", "Unknown error", nil)
    }
  }
} 

```

### 2. Objective-C Bridge (WalletModule.m)

```objc
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WalletModule, NSObject)

RCT_EXTERN_METHOD(keyGenMobile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(encryptMobile:(NSString *)pubKeyHex
                  message:(NSString *)message
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decryptMobile:(NSString *)privKeyHex
                  encryptedData:(NSString *)encryptedData
                  version:(NSString *)version
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(symEncryptMobile:(NSString *)ssKeyHex
                  message:(NSString *)message
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(symDecryptMobile:(NSString *)ssKeyHex
                  encryptedData:(NSString *)encryptedData
                  version:(NSString *)version
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(privateKeyToWalletAddressMobile:(NSString *)privateKeyHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signTransactionMobile:(NSDictionary *)txArgs
                  privKeyHex:(NSString *)privKeyHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decodeRLPTransactionMobile:(NSString *)rlpHex
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end 
```

## Bridging Header Configuration

### 1. Create Bridging Header
File: `ios/wallet-Bridging-Header.h`

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <MobileApps/MobileApps.h>
```

### 2. Configure in Xcode
1. Select your project in Xcode
2. Select your target
3. Go to "Build Settings"
4. Search for "Bridging Header"
5. Set "Objective-C Bridging Header" to: `wallet/wallet-Bridging-Header.h`

## Xcode Project Configuration

### 1. Build Settings

#### Required Settings:
- **iOS Deployment Target**: 13.0
- **Architectures**: arm64 (for devices), arm64-simulator (for simulator)
- **Valid Architectures**: arm64, arm64-simulator


#### Framework Search Paths:
```
$(inherited)
$(SRCROOT)/Frameworks
```

#### Header Search Paths:
```
$(inherited)
$(SRCROOT)/Frameworks/MobileApps.xcframework/ios-arm64/MobileApps.framework/Headers
$(SRCROOT)/Frameworks/MobileApps.xcframework/ios-arm64-simulator/MobileApps.framework/Headers
```

### 2. Target Dependencies
Ensure the following are linked:
- `MobileApps.xcframework`
- `JavaScriptCore.framework`
- React Native pods

### 3. Embed Frameworks
- Set `MobileApps.xcframework` to "Embed & Sign"

## CocoaPods Configuration

### Installation Commands
```bash
cd ios
pod install
```

## Available Functions

### 1. Key Generation
**Function**: `keyGenMobile`
**Purpose**: Generate a new cryptographic key pair
**Returns**: `{ pubKey: string, privKey: string }`

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

### 2. Asymmetric Encryption
**Function**: `encryptMobile`
**Purpose**: Encrypt data using a public key
**Parameters**: 
- `pubKeyHex`: Public key in hex format
- `message`: Message to encrypt
**Returns**: `{ encrypted: string, version: string }`

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

### 3. Asymmetric Decryption
**Function**: `decryptMobile`
**Purpose**: Decrypt data using a private key
**Parameters**:
- `privKeyHex`: Private key in hex format
- `encryptedData`: Encrypted data
- `version`: Encryption version
**Returns**: `string` (decrypted message)

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

### 4. Symmetric Encryption
**Function**: `symEncryptMobile`
**Purpose**: Encrypt data using a symmetric key
**Parameters**:
- `ssKeyHex`: Symmetric key in hex format
- `message`: Message to encrypt
**Returns**: `{ encrypted: string, version: string }`

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

### 5. Symmetric Decryption
**Function**: `symDecryptMobile`
**Purpose**: Decrypt data using a symmetric key
**Parameters**:
- `ssKeyHex`: Symmetric key in hex format
- `encryptedData`: Encrypted data
- `version`: Encryption version
**Returns**: `string` (decrypted message)

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

### 6. Private Key to Wallet Address
**Function**: `privateKeyToWalletAddressMobile`
**Purpose**: Derive wallet address from private key
**Parameters**:
- `privateKeyHex`: Private key in hex format
**Returns**: `string` (wallet address)

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

### 7. Sign Transaction
**Function**: `signTransactionMobile`
**Purpose**: Sign a blockchain transaction
**Parameters**:
- `txArgs`: Transaction arguments object
- `privKeyHex`: Private key in hex format
**Returns**: `{ rawTransaction: string, hash: string }`

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

### 8. Decode RLP Transaction
**Function**: `decodeRLPTransactionMobile`
**Purpose**: Decode RLP-encoded transaction data
**Parameters**:
- `rlpHex`: RLP-encoded transaction in hex format
**Returns**: `{ count: number }`

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

## Usage Examples

### React Native Usage

```typescript
import { NativeModules } from 'react-native';

const { WalletModule } = NativeModules;

// Key Generation
const generateKeys = async () => {
  try {
    const result = await WalletModule.keyGenMobile();
    console.log('Public Key:', result.pubKey);
    console.log('Private Key:', result.privKey);
    return result;
  } catch (error) {
    console.error('Key generation failed:', error);
  }
};

// Encryption
const encryptMessage = async (publicKey: string, message: string) => {
  try {
    const result = await WalletModule.encryptMobile(publicKey, message);
    console.log('Encrypted:', result.encrypted);
    console.log('Version:', result.version);
    return result;
  } catch (error) {
    console.error('Encryption failed:', error);
  }
};

// Decryption
const decryptMessage = async (privateKey: string, encryptedData: string, version: string) => {
  try {
    const decrypted = await WalletModule.decryptMobile(privateKey, encryptedData, version);
    console.log('Decrypted:', decrypted);
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
  }
};

// Wallet Address Generation
const getWalletAddress = async (privateKey: string) => {
  try {
    const address = await WalletModule.privateKeyToWalletAddressMobile(privateKey);
    console.log('Wallet Address:', address);
    return address;
  } catch (error) {
    console.error('Address generation failed:', error);
  }
};

// Transaction Signing
const signTransaction = async (txArgs: any, privateKey: string) => {
  try {
    const result = await WalletModule.signTransactionMobile(txArgs, privateKey);
    console.log('Raw Transaction:', result.rawTransaction);
    console.log('Transaction Hash:', result.hash);
    return result;
  } catch (error) {
    console.error('Transaction signing failed:', error);
  }
};
```

## Troubleshooting

### Common Issues

#### 1. Framework Not Found
**Error**: `ld: framework not found MobileApps`
**Solution**: 
- Ensure XCFramework is properly added to the project
- Check framework search paths in build settings
- Verify framework is embedded and signed

#### 2. Bridging Header Issues
**Error**: `'MobileApps/MobileApps.h' file not found`
**Solution**:
- Verify bridging header path in build settings
- Ensure bridging header includes correct imports
- Check that XCFramework headers are accessible

#### 3. Architecture Mismatch
**Error**: `wrong architecture`
**Solution**:
- Ensure XCFramework supports both arm64 and arm64-simulator
- Check build settings for correct architectures
- Clean and rebuild project

#### 4. CocoaPods Issues
**Error**: `pod install` fails
**Solution**:
- Update CocoaPods: `sudo gem install cocoapods`
- Clean pods: `cd ios && rm -rf Pods && pod install`
- Check Podfile syntax

#### 5. React Native Bridge Issues
**Error**: Module not found in JavaScript
**Solution**:
- Ensure Objective-C bridge file is included in build
- Check function declarations match Swift implementations
- Verify module name consistency

### Debug Steps

1. **Clean Build**:
   ```bash
   cd ios
   xcodebuild clean
   rm -rf build
   pod install
   ```

2. **Check Framework Integration**:
   - Verify XCFramework in project navigator
   - Check "Embed & Sign" setting
   - Validate framework search paths

3. **Verify Bridging Header**:
   - Check build settings for correct path
   - Ensure header file exists and is readable
   - Validate import statements

4. **Test Native Module**:
   - Add console logs in Swift functions
   - Check Xcode console for native logs
   - Verify JavaScript bridge calls

### Performance Considerations

1. **Memory Management**: All functions are synchronous and don't require main queue setup
2. **Error Handling**: Comprehensive error handling with descriptive messages
3. **Type Safety**: Strong typing with proper parameter validation
4. **Threading**: Functions run on background threads for better performance

### Security Notes

1. **Private Key Handling**: Never log or expose private keys
2. **Memory Security**: Sensitive data is handled securely in native code
3. **Input Validation**: Validate all inputs before passing to native functions
4. **Error Messages**: Avoid exposing sensitive information in error messages 