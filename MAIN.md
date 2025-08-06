# NECJS SDK - Complete Reference Documentation

<div align="center">
  <img src="https://raw.githubusercontent.com/Ncog-Earth-Chain/nec-node-sdk/main/assets/companyLogo.png" alt="NCOG Earth Chain Logo" width="400" />
</div>

## Table of Contents

1. [Project Overview](#project-overview)
2. [Documentation Index](#documentation-index)
3. [Setup & Installation](#setup--installation)
4. [Architecture & Process](#architecture--process)
5. [Publishing Process](#publishing-process)
6. [Use Cases & Examples](#use-cases--examples)
7. [API Reference](#api-reference)
8. [Development Guide](#development-guide)
9. [Troubleshooting](#troubleshooting)

---

## Project Overview

**NECJS** is the official JavaScript/TypeScript SDK for the NCOG Earth Chain blockchain. It provides a comprehensive toolkit for building decentralized applications (dApps) with post-quantum cryptography support.

### Key Features

- **Multi-Platform Support**: Node.js, Browser, React Native, React, Next.js, Vite
- **Post-Quantum Cryptography**: MLKEM and MLDSA87 algorithms via WebAssembly
- **Smart Contract Integration**: Deploy, interact, and manage smart contracts
- **Wallet Management**: Private key wallets and browser extension integration
- **Real-time Subscriptions**: WebSocket-based blockchain event monitoring
- **Ethereum Compatibility**: JSON-RPC protocol support
- **TypeScript Support**: Full type definitions and IntelliSense

### Package Information

- **Name**: `necjs`
- **Version**: 1.3.0
- **License**: MIT
- **Repository**: https://github.com/Ncog-Earth-Chain/nec-node-sdk
- **Author**: developer@ncog.earth
- **Node.js Requirement**: >=16.0.0

---

## Documentation Index

### Core Documentation
- [API Reference](docs/API_REFERENCE.md) - Complete API documentation
- [SDK Entry Point](docs/SDK_ENTRYPOINT.md) - Main exports and entry points

### Platform-Specific Guides
- [iOS Configuration Guide](docs/IOS_CONFIGURATION_GUIDE.md) - iOS app integration
- [AAR Integration Guide](docs/AAR_INTEGRATION_GUIDE.md) - Android AAR integration
- [React Native Setup Guide](docs/REACT_NATIVE_SETUP_GUIDE.md) - React Native integration
- [Framework Integration](docs/FRAMEWORK_INTEGRATION.md) - React, Next.js, Vite setup
- [Node.js Integration](docs/NODEJS_INTEGRATION.md) - Node.js specific setup
- [NestJS Integration](docs/NESTJS_INTEGRATION.md) - NestJS framework integration

### Function Reference Documentation
- [Provider Function Reference](docs/PROVIDER_FUNCTION_REFERENCE.md) - JSON-RPC client functions
- [Wallet Function Reference](docs/WALLET_FUNCTION_REFERENCE.md) - Wallet and signing functions
- [Contract Function Reference](docs/CONTRACT_FUNCTION_REFERENCE.md) - Smart contract interaction
- [Contract Factory Function Reference](docs/CONTRACT_FACTORY_FUNCTION_REFERENCE.md) - Contract deployment
- [Extension Function Reference](docs/EXTENSION_FUNCTION_REFERENCE.md) - Browser extension integration
- [Subscription Function Reference](docs/SUBSCRIPTION_FUNCTION_REFERENCE.md) - WebSocket subscriptions
- [MLKEM Function Reference](docs/MLKEM_FUNCTION_REFERENCE.md) - Post-quantum cryptography
- [Utils Function Reference](docs/UTILS_FUNCTION_REFERENCE.md) - Utility functions
- [GraphQL Function Reference](docs/GRAPHQL_FUNCTION_REFERENCE.md) - GraphQL operations

### Specialized Documentation
- [Extension Wallet](docs/EXTENSION_WALLET.md) - Browser extension wallet integration
- [React Native](docs/REACT_NATIVE.md) - React Native specific features

---

## Setup & Installation

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn package manager
- Git (for development)

### Installation

#### For End Users

```bash
# Install the package
npm install necjs

# Or using yarn
yarn add necjs
```

#### For Developers

```bash
# Clone the repository
git clone https://github.com/Ncog-Earth-Chain/nec-node-sdk.git
cd nec-node-sdk

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Environment Setup

1. **Node.js Environment**
   ```bash
   # Verify Node.js version
   node --version  # Should be >= 16.0.0
   
   # Install dependencies
   npm install
   ```

2. **Browser Environment**
   - No additional setup required
   - WebAssembly support is automatically handled

3. **React Native Environment**
   - Follow the [React Native Setup Guide](docs/REACT_NATIVE_SETUP_GUIDE.md)
   - Requires additional polyfills and Metro configuration

### Build Configuration

The project uses Rollup for bundling with multiple output formats:

- **CommonJS** (`dist/index.cjs.js`) - Node.js compatibility
- **ES Modules** (`dist/index.esm.js`) - Modern JavaScript
- **UMD** (`dist/index.umd.js`) - Universal module definition
- **Browser-specific** (`dist/index.browser.esm.js`) - Browser optimization
- **React Native** (`dist/index.react-native.esm.js`) - React Native optimization

---

## Architecture & Process

### Project Structure

```
nec-node-sdk/
├── src/                          # Source code
│   ├── index.ts                  # Main entry point
│   ├── index.browser.ts          # Browser-specific entry
│   ├── index.react-native.ts     # React Native entry
│   ├── provider.ts               # JSON-RPC client
│   ├── wallet.ts                 # Wallet management
│   ├── contract.ts               # Smart contract interaction
│   ├── contract-factory.ts       # Contract deployment
│   ├── extension.ts              # Browser extension integration
│   ├── subscription.ts           # WebSocket subscriptions
│   ├── graphql.ts                # GraphQL operations
│   ├── utils.ts                  # Utility functions
│   └── webassembly/              # WebAssembly modules
├── docs/                         # Documentation
├── tests/                        # Test files
├── dist/                         # Build output
├── scripts/                      # Build scripts
├── assets/                       # Static assets
└── MobileApps.xcframework/       # iOS framework
```

### Core Modules

#### 1. Provider Module
- **Purpose**: Low-level JSON-RPC client for blockchain communication
- **Key Features**: HTTP/HTTPS requests, WebSocket connections, response normalization
- **Use Cases**: Direct blockchain node communication, transaction submission

#### 2. Wallet Module
- **Purpose**: Private key management and transaction signing
- **Key Features**: MLKEM cryptography, address derivation, transaction creation
- **Use Cases**: User wallet creation, transaction signing, post-quantum security

#### 3. Contract Module
- **Purpose**: Smart contract interaction and method calling
- **Key Features**: Dynamic method generation, ABI handling, gas estimation
- **Use Cases**: Contract function calls, event listening, state reading

#### 4. ContractFactory Module
- **Purpose**: Smart contract deployment and instantiation
- **Key Features**: Constructor parameter handling, deployment transactions
- **Use Cases**: New contract deployment, contract instance creation

#### 5. Extension Module
- **Purpose**: Browser extension wallet integration
- **Key Features**: Injected provider detection, extension signer
- **Use Cases**: MetaMask-like wallet integration, extension-based transactions

#### 6. Subscription Module
- **Purpose**: Real-time blockchain event monitoring
- **Key Features**: WebSocket connections, event filtering, subscription management
- **Use Cases**: Real-time updates, event monitoring, notification systems

#### 7. MLKEM Module
- **Purpose**: Post-quantum cryptography operations
- **Key Features**: Key generation, encryption/decryption, digital signatures
- **Use Cases**: Quantum-resistant security, advanced cryptography

### Build Process

1. **TypeScript Compilation**: Source files are compiled to JavaScript
2. **WebAssembly Processing**: WASM files are converted to base64 strings
3. **Rollup Bundling**: Multiple output formats are generated
4. **Type Definitions**: TypeScript declaration files are generated
5. **Testing**: Jest tests are executed
6. **Linting**: ESLint checks code quality

### Development Workflow

1. **Feature Development**: Create feature branches from main
2. **Testing**: Write tests for new functionality
3. **Code Review**: Submit pull requests for review
4. **Integration**: Merge approved changes to main
5. **Release**: Tag versions and publish to npm

---

## Publishing Process

### Pre-Publishing Checklist

- [ ] All tests pass (`npm test`)
- [ ] Code linting passes (`npm run lint`)
- [ ] Build completes successfully (`npm run build`)
- [ ] Version number is updated in `package.json`
- [ ] CHANGELOG is updated (if applicable)
- [ ] Documentation is current
- [ ] LICENSE file is present
- [ ] `.npmignore` is properly configured

### Publishing Steps

1. **Prepare the Release**
   ```bash
   # Install dependencies
   npm install
   
   # Run tests
   npm test
   
   # Build the package
   npm run build
   ```

2. **Update Version**
   ```bash
   # Patch version (bug fixes)
   npm version patch
   
   # Minor version (new features)
   npm version minor
   
   # Major version (breaking changes)
   npm version major
   ```

3. **Publish to npm**
   ```bash
   # Login to npm (if needed)
   npm login
   
   # Publish the package
   npm publish
   ```

### Post-Publishing

- [ ] Verify package is available on npm
- [ ] Update GitHub releases
- [ ] Notify community of new release
- [ ] Update documentation if needed

### Troubleshooting Publishing Issues

- **Permission Errors**: Ensure you're logged in with correct npm account
- **Missing Files**: Verify build output exists in `dist/` directory
- **Version Conflicts**: Check if version already exists on npm
- **Build Failures**: Check TypeScript compilation and Rollup configuration

---

## Use Cases & Examples

### 1. Basic Wallet Operations

```javascript
import { loadWasm, Provider, Wallet } from 'necjs';

async function basicWalletExample() {
  // Initialize WebAssembly
  await loadWasm();
  
  // Create wallet from private key
  const wallet = await Wallet.create('0x1234567890abcdef...');
  console.log('Wallet address:', wallet.address);
  
  // Connect to blockchain
  const provider = new Provider('https://rpc.ncog.earth');
  
  // Get balance
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', balance);
}
```

### 2. Smart Contract Interaction

```javascript
import { Provider, Contract } from 'necjs';

async function contractExample() {
  const provider = new Provider('https://rpc.ncog.earth');
  
  // Contract ABI and address
  const contractABI = [...];
  const contractAddress = '0x...';
  
  // Create contract instance
  const contract = new Contract(contractAddress, contractABI, provider);
  
  // Call contract function
  const result = await contract.methods.getBalance().call();
  console.log('Contract balance:', result);
}
```

### 3. Contract Deployment

```javascript
import { Provider, ContractFactory, Wallet } from 'necjs';

async function deployContract() {
  await loadWasm();
  
  const wallet = await Wallet.create('0x...');
  const provider = new Provider('https://rpc.ncog.earth');
  
  // Contract bytecode and ABI
  const contractBytecode = '0x...';
  const contractABI = [...];
  
  // Deploy contract
  const factory = new ContractFactory(contractABI, contractBytecode, wallet);
  const contract = await factory.deploy('Constructor Parameter');
  
  console.log('Deployed contract address:', contract.address);
}
```

### 4. Browser Extension Integration

```javascript
import { Provider, ExtensionSigner } from 'necjs';

async function extensionExample() {
  if (window.ncogWallet) {
    const provider = new Provider('https://rpc.ncog.earth');
    const signer = new ExtensionSigner(window.ncogWallet, provider);
    
    const address = await signer.getAddress();
    console.log('Extension wallet address:', address);
    
    // Send transaction
    const tx = await signer.sendTransaction({
      to: '0x...',
      value: '1000000000000000000' // 1 ETH
    });
  }
}
```

### 5. Real-time Subscriptions

```javascript
import { Provider, Subscription } from 'necjs';

async function subscriptionExample() {
  const provider = new Provider('wss://rpc.ncog.earth');
  
  // Subscribe to new blocks
  const subscription = new Subscription(provider);
  const blockSub = await subscription.subscribe('newHeads', (block) => {
    console.log('New block:', block);
  });
  
  // Subscribe to contract events
  const eventSub = await subscription.subscribe('logs', {
    address: '0x...',
    topics: ['0x...']
  }, (log) => {
    console.log('Contract event:', log);
  });
}
```

### 6. Post-Quantum Cryptography

```javascript
import { loadWasm, MlKem } from 'necjs';

async function mlkemExample() {
  await loadWasm();
  
  // Generate key pair
  const keyPair = await MlKem.keygen();
  
  // Encrypt message
  const ciphertext = await MlKem.encaps(keyPair.publicKey);
  
  // Decrypt message
  const plaintext = await MlKem.decaps(ciphertext, keyPair.secretKey);
  
  console.log('Decrypted message:', plaintext);
}
```

### 7. React Integration

```javascript
import React, { useEffect, useState } from 'react';
import { loadWasm, Provider, Wallet } from 'necjs';

function WalletComponent() {
  const [balance, setBalance] = useState(null);
  const [address, setAddress] = useState(null);
  
  useEffect(() => {
    async function initWallet() {
      await loadWasm();
      const wallet = await Wallet.create('0x...');
      const provider = new Provider('https://rpc.ncog.earth');
      
      setAddress(wallet.address);
      const bal = await provider.getBalance(wallet.address);
      setBalance(bal);
    }
    
    initWallet();
  }, []);
  
  return (
    <div>
      <p>Address: {address}</p>
      <p>Balance: {balance}</p>
    </div>
  );
}
```

---

## API Reference

### Core Classes

#### Provider
- **Constructor**: `new Provider(url, options?)`
- **Methods**: `getBalance()`, `getBlockNumber()`, `sendTransaction()`, etc.
- **Events**: WebSocket connection events

#### Wallet
- **Static Methods**: `create(privateKey)`, `fromMnemonic(mnemonic)`
- **Instance Methods**: `signTransaction(tx)`, `getAddress()`
- **Properties**: `address`, `privateKey`

#### Contract
- **Constructor**: `new Contract(address, abi, provider)`
- **Methods**: Dynamic methods based on ABI
- **Events**: `events.EventName()`

#### ContractFactory
- **Constructor**: `new ContractFactory(abi, bytecode, signer)`
- **Methods**: `deploy(...args)`, `attach(address)`

#### ExtensionSigner
- **Constructor**: `new ExtensionSigner(extension, provider)`
- **Methods**: `getAddress()`, `sendTransaction(tx)`, `signMessage(message)`

#### Subscription
- **Constructor**: `new Subscription(provider)`
- **Methods**: `subscribe(type, params?, callback)`, `unsubscribe(id)`

### Utility Functions

- `hexToDecimalString(hex)`: Convert hex to decimal
- `decimalToHex(value)`: Convert decimal to hex
- `etherToWeiHex(value)`: Convert Ether to Wei
- `formatUnits(value, decimals)`: Format with decimals
- `isValidAddress(address)`: Validate address format
- `serializeForRpc(payload)`: Prepare RPC payload
- `normalizeResponse(resp)`: Normalize RPC response

### MLKEM Functions

- `loadWasm()`: Initialize WebAssembly
- `MlKem.keygen()`: Generate key pair
- `MlKem.encaps(publicKey)`: Encrypt message
- `MlKem.decaps(ciphertext, secretKey)`: Decrypt message
- `MlKem.sign(message, secretKey)`: Sign message
- `MlKem.verify(message, signature, publicKey)`: Verify signature

---

## Development Guide

### Setting Up Development Environment

1. **Clone Repository**
   ```bash
   git clone https://github.com/Ncog-Earth-Chain/nec-node-sdk.git
   cd nec-node-sdk
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build Project**
   ```bash
   npm run build
   ```

4. **Run Tests**
   ```bash
   npm test
   ```

5. **Lint Code**
   ```bash
   npm run lint
   ```

### Development Scripts

- `npm run build`: Build the project with Rollup
- `npm test`: Run Jest tests with coverage
- `npm run lint`: Run ESLint on source files
- `npm run script`: Convert WASM to base64
- `npm run prepublishOnly`: Build and test before publishing

### Testing

The project uses Jest for testing with the following configuration:

- **Test Environment**: Node.js
- **Coverage**: Istanbul coverage reports
- **Test Files**: `tests/` directory
- **Mocking**: WebAssembly modules are mocked for testing

### Code Style

- **Linter**: ESLint with TypeScript support
- **Formatter**: Prettier (recommended)
- **TypeScript**: Strict mode enabled
- **Naming**: camelCase for variables, PascalCase for classes

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Release Process

1. **Version Bumping**
   ```bash
   npm version patch  # Bug fixes
   npm version minor  # New features
   npm version major  # Breaking changes
   ```

2. **Pre-release Testing**
   ```bash
   npm test
   npm run build
   npm run lint
   ```

3. **Publishing**
   ```bash
   npm publish
   ```

---

## Troubleshooting

### Common Issues

#### 1. WebAssembly Loading Errors
**Problem**: `loadWasm()` fails to initialize
**Solution**: 
- Ensure WebAssembly is supported in the environment
- Check if WASM files are properly bundled
- Verify browser compatibility

#### 2. React Native Compatibility
**Problem**: SDK doesn't work in React Native
**Solution**:
- Use React Native specific imports
- Follow [React Native Setup Guide](docs/REACT_NATIVE_SETUP_GUIDE.md)
- Add necessary polyfills

#### 3. Build Failures
**Problem**: Rollup build fails
**Solution**:
- Check TypeScript compilation errors
- Verify all dependencies are installed
- Ensure WASM conversion script runs successfully

#### 4. Network Connection Issues
**Problem**: Provider can't connect to RPC endpoint
**Solution**:
- Verify RPC URL is correct and accessible
- Check network connectivity
- Ensure CORS is properly configured for browser usage

#### 5. Contract Interaction Errors
**Problem**: Contract method calls fail
**Solution**:
- Verify contract ABI is correct
- Check contract address is valid
- Ensure provider is connected to correct network

### Debug Mode

Enable debug logging by setting environment variables:

```bash
# Enable debug logging
DEBUG=necjs:* npm start

# Or in browser
localStorage.setItem('debug', 'necjs:*');
```

### Performance Optimization

1. **WebAssembly Loading**: Load WASM once and reuse
2. **Provider Connections**: Reuse provider instances
3. **Contract Instances**: Cache contract instances
4. **Subscription Management**: Properly unsubscribe from events

### Security Considerations

1. **Private Key Management**: Never expose private keys in client-side code
2. **RPC Endpoint Security**: Use HTTPS/WSS for production
3. **Input Validation**: Validate all user inputs
4. **Error Handling**: Don't expose sensitive information in errors

---

## Support & Community

### Getting Help

- **GitHub Issues**: [Report bugs and request features](https://github.com/Ncog-Earth-Chain/nec-node-sdk/issues)
- **Documentation**: Check the [docs/](docs/) directory for detailed guides
- **Examples**: See use cases above for common patterns

### Resources

- **NCOG Earth Chain Website**: [https://ncog.earth](https://ncog.earth)
- **GitHub Repository**: [https://github.com/Ncog-Earth-Chain/nec-node-sdk](https://github.com/Ncog-Earth-Chain/nec-node-sdk)
- **npm Package**: [https://www.npmjs.com/package/necjs](https://www.npmjs.com/package/necjs)

### Contributing

We welcome contributions! Please see the development guide above for details on how to contribute to the project.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**NECJS SDK** - Building the future of decentralized applications with post-quantum security. 