# NECJS SDK – React Native Support Guide

This guide explains how to use the NECJS SDK in a React Native project. React Native is not natively supported by Node.js or browser-only JavaScript packages, so some extra steps are required to make everything work smoothly.

---

## 1. Installation

Install the SDK and required polyfills:

```sh
npm install necjs
npm install node-libs-react-native react-native-crypto react-native-randombytes stream-browserify
```

If you are using React Native < 0.60, link native modules:

```sh
react-native link react-native-randombytes
```

---

## 2. Configure Polyfills

Add this at the very top of your `index.js` (or your main entry file):

```js
import 'node-libs-react-native/globals';
```

---

## 3. Update Metro Bundler Configuration

Create or update `metro.config.js` in your project root:

```js
const { getDefaultConfig } = require('metro-config');

module.exports = (async () => {
  const {
    resolver: { sourceExts, assetExts }
  } = await getDefaultConfig();
  return {
    resolver: {
      assetExts: assetExts.filter(ext => ext !== 'wasm'),
      sourceExts: [...sourceExts, 'wasm'],
      extraNodeModules: require('node-libs-react-native'),
    }
  };
})();
```

---

## 4. Usage Example

Here is a minimal example of using NECJS in a React Native component:

```js
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Provider, Wallet } from 'necjs';

export default function App() {
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const wallet = await Wallet.create('your-private-key-hex');
        const provider = new Provider('https://rpc.ncog.earth');
        const bal = await provider.getBalance(wallet.address);
        setBalance(bal);
      } catch (e) {
        console.error('NECJS error:', e);
      }
    })();
  }, []);

  return (
    <View>
      <Text>Balance: {balance}</Text>
    </View>
  );
}
```

---

## 5. Troubleshooting

- **Missing module errors:**
  - Ensure all polyfills are installed and imported as above.
  - Check your `metro.config.js` for correct configuration.
- **WASM errors:**
  - If you see errors about loading WASM, you may need to use a WASM polyfill or patch the loader. See [react-native-webassembly](https://github.com/kripod/react-native-webassembly) for help.
- **WebSocket issues:**
  - NECJS should use React Native’s built-in WebSocket. If not, patch the SDK or use a compatible WebSocket library.
- **Direct import errors (e.g., noble/hashes):**
  - Only use documented exports from dependencies. Do not import internal files.

---

## 6. Caveats & Limitations

- **Not all Node.js or browser APIs are available in React Native.**
- **You must use polyfills for Node.js core modules.**
- **WASM support in React Native is not as robust as in browsers/Node.js.**
- **Some advanced features may require additional patching or configuration.**
- **If you encounter issues, check the [NECJS GitHub Issues](https://github.com/Ncog-Earth-Chain/nec-node-sdk/issues) or open a new issue for help.**

---

## 7. Resources

- [node-libs-react-native](https://github.com/parshap/node-libs-react-native)
- [react-native-crypto](https://github.com/mvayngrib/react-native-crypto)
- [react-native-webassembly](https://github.com/kripod/react-native-webassembly)
- [Metro Bundler Docs](https://facebook.github.io/metro/)
- [NECJS GitHub](https://github.com/Ncog-Earth-Chain/nec-node-sdk)

---

**If you encounter a specific error, copy the error message and search the above resources or open an issue for help!** 