# API Reference

This document provides an overview of the main modules, classes, and features of the NECJS SDK. For full source code and the latest updates, see:

[https://github.com/Ncog-Earth-Chain/nec-node-sdk](https://github.com/Ncog-Earth-Chain/nec-node-sdk)

---

## Modules & Classes

### Provider
- Low-level JSON-RPC client for NCOG/Ethereum-compatible nodes.
- Methods: `getBalance`, `getGasPrice`, `getTransactionCount`, `callRpc`, etc.

### Wallet & Signer
- Wallet: Private key management, address derivation, post-quantum MLKEM cryptography, transaction signing (MLDSA87).
- Signer: Sends and decodes transactions.
- Methods: `Wallet.create`, `Wallet.connect`, `Signer.sendTransaction`, `Signer.decode`.

### ExtensionSigner
- Integrates with browser extension wallets (e.g., `window.ncogWallet`).
- Methods: `getAddress`, `sendTransaction`.

### Contract
- Interact with smart contracts (web3.js-style dynamic methods).
- Methods: `call`, `send`, `estimateGas`, `methods.myMethod(...args)`.

### ContractFactory
- Deploy new contracts and attach to existing ones.
- Methods: `deploy`, `attach`.
- Handles gas estimation and constructor arguments.

### Subscription (Event)
- WebSocket-based real-time event subscriptions (Node.js & browser).
- Methods: `connect`, `subscribe`, `unsubscribe`, `on`, `off`, `disconnect`.
- Supports Ethereum-compatible event types (e.g., `newHeads`, `logs`).
- See usage in integration docs and examples.

### MLKEM (Post-Quantum Cryptography)
- Key generation, encryption/decryption (asymmetric & symmetric), address derivation, transaction signing.
- Methods: `keyGen`, `encrypt`, `decrypt`, `symEncrypt`, `symDecrypt`, `privateKeyToAddress`, `signTransactionMLDSA87`, `decodeRLPTransaction`.

### Utilities
- Hex/decimal conversion, Ether/Wei conversion, address validation, JSON-RPC normalization.
- Methods: `hexToDecimalString`, `decimalToHex`, `etherToWeiHex`, `valueToNineDecimalHex`, `formatUnits`, `isValidAddress`, `serializeForRpc`, `normalizeResponse`.

---

## Usage References

- **Framework Integration & Examples:**
  - [Framework Integration](FRAMEWORK_INTEGRATION.md)
  - [Node.js Integration](NODEJS_INTEGRATION.md)
  - [NestJS Integration](NESTJS_INTEGRATION.md)
  - [Extension Wallet Integration](EXTENSION_WALLET.md)

- **Entry Point:**
  - [src/index.ts](../src/index.ts)

- **For full API and advanced usage, see the GitHub repository.** 