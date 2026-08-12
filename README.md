<div align="center">
  <img src="https://raw.githubusercontent.com/Ncog-Earth-Chain/nec-node-sdk/main/assets/companyLogo.png" alt="Company Logo" width="400" />
</div>

# NEC BLOCKCHAIN SDK

**The all-in-one JavaScript/TypeScript SDK for building apps on the NCOG Earth Chain.**  
Supports Node.js, browsers, React, Next.js, Vite, and React Native.  
Includes post-quantum cryptography, wallet management, contract interaction, extension wallet support, contract deployment, and real-time subscriptions.

### Key Features

- **Multi-Platform Support**: Node.js, Browser, React Native, React, Next.js, Vite
- **Post-Quantum Cryptography**: MLKEM and MLDSA87 algorithms via WebAssembly
- **Smart Contract Integration**: Deploy, interact, and manage smart contracts
- **Wallet Management**: Private key wallets and browser extension integration
- **Real-time Subscriptions**: WebSocket-based blockchain event monitoring
- **Ethereum Compatibility**: JSON-RPC protocol support
- **TypeScript Support**: Full type definitions and IntelliSense

### Package Information

- **Name**: `@ncog/necjs`
- **License**: MIT
- **Repository**: https://github.com/Ncog-Earth-Chain/nec-node-sdk
- **Author**: developer@ncog.earth
- **Node.js Requirement**: >=16.0.0

---

## Documentation Index

### Platform-Specific Guides
- [Framework Integration](docs/FRAMEWORK_INTEGRATION.md) - React, Next.js, Vite setup
- [Node.js Integration](docs/NODEJS_INTEGRATION.md) - Node.js specific setup
- [NestJS Integration](docs/NESTJS_INTEGRATION.md) - NestJS framework integration
- [React Native Setup Guide](docs/REACT_NATIVE_SETUP_GUIDE.md) - React Native integration

### Function Reference Documentation
- [Provider Function Reference](docs/PROVIDER_FUNCTION_REFERENCE.md) - JSON-RPC client functions
- [Wallet Function Reference](docs/WALLET_FUNCTION_REFERENCE.md) - Wallet and signing functions
- [Contract Function Reference](docs/CONTRACT_FUNCTION_REFERENCE.md) - Smart contract interaction
- [Contract Factory Function Reference](docs/CONTRACT_FACTORY_FUNCTION_REFERENCE.md) - Contract deployment
- [Extension Function Reference](docs/EXTENSION_FUNCTION_REFERENCE.md) - Browser extension integration
- [Subscription Function Reference](docs/SUBSCRIPTION_FUNCTION_REFERENCE.md) - WebSocket subscriptions
- [MLKEM Function Reference](docs/MLKEM_FUNCTION_REFERENCE.md) - Post-quantum cryptography
- [DDB Function Reference](docs/DDB_FUNCTION_REFERENCE.md) - Decentralized database (`ddb_*`) client
- [Utils Function Reference](docs/UTILS_FUNCTION_REFERENCE.md) - Utility functions
- [GraphQL Function Reference](docs/GRAPHQL_FUNCTION_REFERENCE.md) - GraphQL operations

### Specialized Documentation
- [React Native](docs/REACT_NATIVE.md) - React Native specific features
- [Extension Wallet](docs/EXTENSION_WALLET.md) - Browser extension wallet integration


---

## Setup & Installation

### Prerequisites

- Node.js >= 16.0.0
- npm or yarn package manager

### Installation

#### For End Users

```bash
# Install the package
npm install @ncog/necjs

# Or using yarn
yarn add @ncog/necjs
```

### Requirements

1. **Node.js Environment**
   ```bash
   # Verify Node.js version
   node --version  # Should be >= 16.0.0

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
## Use Cases & Examples

### 1. Basic Wallet Operations

```javascript
import { loadWasm, Provider, Wallet } from '@ncog/necjs';

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
import { Provider, Contract } from '@ncog/necjs';

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
import { Provider, ContractFactory, Wallet } from '@ncog/necjs';

async function deployContract() {
  const provider = new Provider('https://rpc.ncog.earth');
  const wallet = await Wallet.create('0x...');
  const signer = wallet.connect(provider); // ML-DSA-87 signer bound to the provider
  
  // Contract bytecode and ABI
  const contractBytecode = '0x...';
  const contractABI = [...];
  
  // Deploy contract. ContractFactory ctor is (abi, bytecode, provider, signer);
  // deploy() takes an ARRAY of constructor args and resolves to a Contract instance.
  const factory = new ContractFactory(contractABI, contractBytecode, provider, signer);
  const contract = await factory.deploy(['Constructor Parameter']);
  
  console.log('Deployed contract address:', contract.address);
}
```

### 4. Browser Extension Integration

```javascript
import { Provider, ExtensionSigner } from '@ncog/necjs';

async function extensionExample() {
  if (window.ncogWallet) {
    const provider = new Provider('https://rpc.ncog.earth');
    const signer = new ExtensionSigner(window.ncogWallet, provider);
    
    const address = await signer.getAddress();
    console.log('Extension wallet address:', address);
    
    // Send transaction (ExtensionSigner requires to, value, and gasPrice;
    // value is in wei — the extension does not auto-convert it)
    const tx = await signer.sendTransaction({
      to: '0x...',
      value: '1000000000000000000', // 1 NEC (in wei)
      gasPrice: await provider.getGasPrice()
    });
  }
}
```

### 5. Real-time Subscriptions

```javascript
import { Subscription } from '@ncog/necjs';

async function subscriptionExample() {
  // Subscription takes a WebSocket URL and must be connected before subscribing.
  const subscription = new Subscription('wss://rpc.ncog.earth');
  await subscription.connect();
  
  // subscribe(subType, params[], handler) -> resolves to a subscription id.
  // Subscribe to new blocks (no extra params).
  const blockSub = await subscription.subscribe('newHeads', [], (block) => {
    console.log('New block:', block);
  });
  
  // Subscribe to contract events (the log filter is the first param).
  const eventSub = await subscription.subscribe('logs', [{
    address: '0x...',
    topics: ['0x...']
  }], (log) => {
    console.log('Contract event:', log);
  });
  
  // Later: await subscription.unsubscribe(blockSub); subscription.disconnect();
}
```

### 6. Post-Quantum Cryptography

```javascript
import { loadWasm } from '@ncog/necjs';

async function mlkemExample() {
  // loadWasm() resolves to an MlKem INSTANCE (ML-KEM-1024, key-exchange + AEAD only).
  const mlkem = await loadWasm();
  
  // Generate a keypair -> { pubKey, privKey }
  const { pubKey, privKey } = await mlkem.keyGen();
  
  // Asymmetric encrypt -> { encryptedData, version }
  const { encryptedData, version } = await mlkem.encrypt(pubKey, 'hello, post-quantum world');
  
  // Asymmetric decrypt -> original plaintext string
  const plaintext = await mlkem.decrypt(privKey, encryptedData, version);
  
  console.log('Decrypted message:', plaintext);
}
```

> **ML-KEM is KEM-only** (key exchange + symmetric AEAD via `symEncrypt`/`symDecrypt`). Transaction **signing** is a separate scheme (ML-DSA-87) — use `signTransactionMLDSA87` from the tx-signer module, or the higher-level `Wallet`/`Signer` flow.

### 7. React Integration

```javascript
import React, { useEffect, useState } from 'react';
import { loadWasm, Provider, Wallet } from '@ncog/necjs';

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

### 8. Decentralized Database (DDB)

```javascript
import { Provider, Ddb } from '@ncog/necjs';

async function ddbExample(privateKeyHex, contractDefinition, contractAddress) {
  const provider = new Provider('https://rpc.ncog.earth');
  const ddb = new Ddb(provider);
  
  // Writes are signed CLIENT-SIDE with your ML-DSA-87 key and flow through the
  // endorsement quorum; each *Signed method returns an endorsement requestId.
  const requestId = await ddb.createSchemaSigned(privateKeyHex, 'users', contractDefinition);
  await ddb.waitForEndorsement(requestId);
  
  // Reads hit the node's Postgres directly (no consensus). Use the derived db_name.
  const dbName = Ddb.deriveDbName('users', contractAddress);
  const rows = await ddb.select(dbName, 'accounts', { limit: 50 });
  console.log(rows);
}
```

See the [DDB Function Reference](docs/DDB_FUNCTION_REFERENCE.md) for the full `Ddb` API (signed writes, role management, procedure calls, reads, and status/introspection).

---

## API Reference

### Core Classes

#### Provider
- **Constructor**: `new Provider(url)`
- **Methods**: `getBalance()`, `getBlockNumber()`, `sendRawTransaction()`, `getBlockByNumber()`, `getTransactionReceipt()`, `getLogs()`, `newFilter()`, `getFilterChanges()`, `watchLogs()`, etc.
- **Typed getters**: `Block`, `TransactionResponse`, `TransactionReceipt`, `Log` result shapes

#### Wallet & Signer
- **Wallet static methods**: `create(privateKey)` → `Wallet`, `connect(privateKey, providerUrl?)` → `{ signer, provider, address }`
- **Wallet instance**: `connect(provider)` → `Signer`; properties `address`, `privateKey`
- **Signer methods**: `sendTransaction(txParams)` → tx hash, `decode(rawSigned)`, `getAddress()`

#### Contract
- **Constructor**: `new Contract(address, abi, provider, signer?)`
- **Methods**: Dynamic methods based on ABI (`contract.methods.foo(...args).call()/.send(opts)`)
- **Static**: `Contract.deploy({ abi, bytecode, provider, deployer, constructorArgs?, options? })`
- **Events**: `events.EventName()`

#### ContractFactory
- **Constructor**: `new ContractFactory(abi, bytecode, provider, signer?)`
- **Methods**: `deploy(constructorArgs?, options?)` → `Contract`, `attach(address)` → `Contract`

#### ExtensionSigner
- **Constructor**: `new ExtensionSigner(injectedProvider, provider)`
- **Methods**: `getAddress()`, `sendTransaction(tx)`, `on(event, listener)`

#### Subscription
- **Constructor**: `new Subscription(wsUrl)`
- **Methods**: `connect()`, `subscribe(type, params, callback)`, `unsubscribe(id)`, `on(event, handler)`, `off(event, handler)`, `disconnect()`

### Utility Functions

- `hexToDecimalString(hex)`: Convert hex to decimal
- `decimalToHex(value)`: Convert decimal to hex
- `etherToWeiHex(value)`: Convert Ether to Wei
- `formatUnits(value, decimals)`: Format with decimals
- `isValidAddress(address)`: Validate address format
- `serializeForRpc(payload)`: Prepare RPC payload
- `normalizeResponse(resp)`: Normalize RPC response

### MLKEM Functions (KEM-only; call on the instance returned by `loadWasm()`)

- `loadWasm()`: Load the ML-KEM WebAssembly module; resolves to an `MlKem` instance (`m`).
- `m.keyGen()`: Generate an ML-KEM-1024 keypair `{ pubKey, privKey }`.
- `m.encrypt(pubKey, message)`: Asymmetric encrypt → `{ encryptedData, version }`.
- `m.decrypt(privKey, encryptedData, version)`: Asymmetric decrypt → plaintext string.
- `m.symEncrypt(ssKey, message)`: Symmetric (shared-secret) encrypt → `{ encryptedData, version }`.
- `m.symDecrypt(ssKey, encryptedData, version)`: Symmetric decrypt → plaintext string.

> There are **no** signing methods on `MlKem` (KEM-only). For transaction signing use the tx-signer module.

### Transaction Signing (ML-DSA-87, SigVersion-v2)

- `signTransactionMLDSA87(txParams, privateKeyHex, options?)`: Sign a tx (SigVersion-v2; `txParams.chainId` is mandatory) → `SignedTx`.
- `privateKeyToAddress(privateKeyHex)`: Derive the account address from an ML-DSA-87 private key.
- `publicKeyToAddress(publicKey)`: Derive the account address from a raw ML-DSA-87 public key.
- `decodeRLPTransaction(rawHex)`: Decode a raw signed v2 tx back into its fields.

---

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
- **npm Package**: [https://www.npmjs.com/package/@ncog/necjs](https://www.npmjs.com/package/@ncog/necjs)

### Contributing

We welcome contributions! Please see the development guide above for details on how to contribute to the project.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**NECJS SDK** - Building the future of decentralized applications with post-quantum security.