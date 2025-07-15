# NCOG BLOCKCHAIN SDK

**The all-in-one JavaScript/TypeScript SDK for building apps on the NCOG Earth Chain.**  
Supports Node.js, browsers, React, Next.js, Vite, and more.  
Includes post-quantum cryptography, wallet management, contract interaction, extension wallet support, contract deployment, and real-time subscriptions.

---

## 🚀 Quick Start

### 1. Install

```bash
npm install ncog
```

### 2. Connect in Your App

**With a Private Key:**
```js
import { loadWasm, Provider, Wallet } from 'ncog';

(async () => {
  await loadWasm(); // Required for cryptography
  const wallet = await Wallet.create('your-private-key-hex');
  const provider = new Provider('https://rpc.ncog.earth');
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', balance);
})();
```

**With a Browser Extension Wallet:**
```js
import { Provider, ExtensionSigner } from 'ncog';

(async () => {
  if (window.ncogWallet) {
    const provider = new Provider('https://rpc.ncog.earth');
    const signer = new ExtensionSigner(window.ncogWallet, provider);
    const address = await signer.getAddress();
    const balance = await provider.getBalance(address);
    console.log('Extension Wallet Address:', address);
    console.log('Balance:', balance);
  }
})();
```

---

## 🧩 Features

- **Ethereum-compatible JSON-RPC**: Connect to any NCOG or Ethereum-style node.
- **Wallets**: Use private keys or browser extension wallets.
- **Smart Contracts**: Deploy, call, and interact with contracts.
- **ContractFactory**: Deploy and attach to contracts with gas estimation and constructor args.
- **WebSocket Subscriptions**: Real-time blockchain event subscriptions (Node.js & browser).
- **Post-Quantum Security**: MLKEM cryptography and MLDSA87 transaction signing via WebAssembly.
- **Utilities**: Hex/decimal conversion, Ether/Wei conversion, address validation, and more.
- **Framework Ready**: Works out-of-the-box with React, Next.js, Vite, and more.

---

## 🏗️ Modules Overview

- **Provider**: Low-level JSON-RPC client for blockchain nodes.
- **Wallet & Signer**: Private key management, address derivation, MLKEM crypto, and transaction signing.
- **ExtensionSigner**: Integrates with browser extension wallets (e.g., window.ncogWallet).
- **Contract**: Interact with smart contracts (web3.js-style dynamic methods).
- **ContractFactory**: Deploy new contracts and attach to existing ones.
- **Subscription**: WebSocket-based real-time event subscriptions.
- **MLKEM**: Post-quantum cryptography (keygen, encrypt/decrypt, sign, address derivation).

---

## 🛠️ Utilities

- `hexToDecimalString(hex)`: Convert hex to decimal string/number.
- `decimalToHex(value)`: Convert decimal to hex (0x-prefixed).
- `etherToWeiHex(value)`: Convert Ether to Wei (hex).
- `valueToNineDecimalHex(value)`: Convert value to hex with 9 decimals.
- `formatUnits(value, decimals)`: Format value with specified decimals.
- `isValidAddress(address)`: Validate EVM address format.
- `serializeForRpc(payload)`: Prepare transaction payload for JSON-RPC.
- `normalizeResponse(resp)`: Normalize JSON-RPC responses (hex to decimal, etc).

---

## 📦 Framework Integration

- **React, Next.js, Vite**: See [Framework Integration Examples](docs/FRAMEWORK_INTEGRATION.md)
- **Node.js**: See [Node.js Integration](docs/NODEJS_INTEGRATION.md)
- **NestJS**: See [NestJS Integration](docs/NESTJS_INTEGRATION.md)

---

## 📚 Documentation

- [API Reference](docs/API_REFERENCE.md)
- [Extension Wallet Integration](docs/EXTENSION_WALLET.md)

---

## 🛠️ Development

- **Build:** `npm run build`
- **Test:** `npm test`
- **Lint:** `npm run lint`

---

## 🤝 Community & Support

- [GitHub Issues](https://github.com/Ncog-Earth-Chain/ncog-node-sdk/issues)
- [NCOG Earth Chain Website](https://ncog.earth)

---

## 📝 License

MIT

---

**Ready to build the future? Start with NCOG SDK today!** 