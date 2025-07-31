# React Native Integration

This SDK provides a React Native specific export that excludes wallet and MLKEM functionality for better compatibility with React Native environments.

## Installation

```bash
npm install necjs
```

### Import
```javascript
// React Native will automatically use the React Native specific export
import { Provider, Contract, ContractFactory } from 'necjs';
```

### Available Exports

The React Native version includes:

- **Provider** - RPC provider for connecting to NCOG Earth Chain
- **Contract** - Smart contract interaction
- **ContractFactory** - Contract deployment and factory patterns
- **Subscription** - WebSocket subscription handling
- **Utility functions** - All utility functions for address validation, unit conversion, etc.
- **GraphQL functions** - `getAllTransactions`, `getAllTokens`

### Example

```javascript
import { Provider, Contract } from 'necjs';

// Create a provider
const provider = new Provider('https://rpc.ncog.earth');

// Create a contract instance
const contract = new Contract(contractAddress, abi, provider);

// Call contract methods
const result = await contract.methods.someFunction().call();
```

## Differences from Full SDK

The React Native version excludes:
- `Wallet` class and wallet management
- `Signer` interface and implementations
- `loadWasm` and `loadWasmFromBuffer` functions
- `MlKem` type and MLKEM-related functionality

This makes the bundle smaller and avoids compatibility issues with React Native's JavaScript runtime.

## React Native Android Wallet Integration

For React Native Android applications that require wallet functionality (private key management, transaction signing, and smart contract interactions), you can integrate the native AAR library. This provides full wallet capabilities while maintaining React Native compatibility.

### AAR Integration Guide

For complete setup instructions, native module bridging, and implementation examples, see:

**[React Native Android AAR Integration Guide](AAR_INTEGRATION_GUIDE.md)**

The AAR integration guide includes:
- Step-by-step AAR library integration
- Native module bridge implementation (Kotlin)
- React Native component examples
- Security considerations and error handling
- Troubleshooting for React Native specific issues

### Quick Start for AAR Integration

1. **Install the SDK**: `npm install necjs`
2. **Get AAR file**: [mobile_apps.aar](https://github.com/Ncog-Earth-Chain/nec-node-sdk/) from the project root directory
3. **Add AAR file**: Place `mobile_apps.aar` in `android/app/libs/`
4. **Configure build.gradle**: Add dependencies and flatDir repository
5. **Create native bridge**: Implement Kotlin native module
6. **Use in React Native**: Import and use the native wallet module

For detailed implementation, refer to the [AAR Integration Guide](AAR_INTEGRATION_GUIDE.md). 