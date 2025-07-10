# NCOG BLOCKCHAIN SDK

**The all-in-one JavaScript/TypeScript SDK for building apps on the NCOG Earth Chain.**  
Supports Node.js, browsers, React, Next.js, Vite, and more.  
Includes post-quantum cryptography, wallet management, contract interaction, and extension wallet support.

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
- **Post-Quantum Security**: MLKEM cryptography via WebAssembly.
- **Framework Ready**: Works out-of-the-box with React, Next.js, Vite, and more.

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