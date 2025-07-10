# NCOG SDK Browser Usage

The NCOG SDK now supports browser environments! This guide will help you integrate the SDK into your web applications.

## Quick Start

### 1. Include the Go WebAssembly Runtime

First, include the Go WebAssembly runtime in your HTML:

```html
<script src="wasm_exec.js"></script>
```

### 2. Import the SDK

Import the SDK using ES modules:

```javascript
import { loadWasm, Provider, Wallet } from 'ncog';
```

### 3. Initialize MLKEM

Initialize the MLKEM WebAssembly module:

```javascript
const mlkem = await loadWasm();
```

## Browser Builds

The package provides several browser-compatible builds:

- **ES Module**: `dist/index.browser.esm.js` - For modern bundlers and ES modules
- **UMD**: `dist/index.umd.js` - For direct browser usage and CDN

### Using with CDN

```html
<!-- Include the Go WASM runtime -->
<script src="https://unpkg.com/ncog@latest/dist/wasm_exec.js"></script>

<!-- Include the SDK -->
<script src="https://unpkg.com/ncog@latest/dist/index.umd.js"></script>

<script>
  // Access via global variable
  const { loadWasm, Provider, Wallet } = Ncog;
  
  // Initialize
  loadWasm().then(mlkem => {
    console.log('MLKEM ready!');
  });
</script>
```

### Using with ES Modules

```html
<script type="module">
  import { loadWasm, Provider, Wallet } from 'https://unpkg.com/ncog@latest/dist/index.browser.esm.js';
  
  const mlkem = await loadWasm();
  console.log('MLKEM ready!');
</script>
```

## MLKEM Operations

### Key Generation

```javascript
const keypair = await mlkem.keyGen();
console.log('Public Key:', keypair.pubKey);
console.log('Private Key:', keypair.privKey);
```

### Encryption/Decryption

```javascript
// Asymmetric encryption
const message = "Hello, NCOG!";
const encrypted = await mlkem.encrypt(keypair.pubKey, message);
console.log('Encrypted:', encrypted.encryptedData);

// Asymmetric decryption
const decrypted = await mlkem.decrypt(keypair.privKey, encrypted.encryptedData, encrypted.version);
console.log('Decrypted:', decrypted);
```

### Symmetric Encryption

```javascript
const ssKey = "shared-secret-key-32-bytes-long";
const message = "Symmetric test";

// Encrypt
const encrypted = await mlkem.symEncrypt(ssKey, message);

// Decrypt
const decrypted = await mlkem.symDecrypt(ssKey, encrypted.encryptedData, encrypted.version);
```

### Address Derivation

```javascript
const privateKey = "your-private-key-32-bytes";
const address = mlkem.privateKeyToAddress(privateKey);
console.log('Address:', address);
```

## Provider and Wallet Usage

### Connect to RPC

```javascript
const provider = new Provider('https://your-rpc-endpoint.com');
```

### Create Wallet

```javascript
const wallet = new Wallet();
console.log('Wallet address:', wallet.address);
```

### Get Balance

```javascript
const balance = await provider.getBalance(wallet.address);
console.log('Balance:', balance);
```

## Webpack/Vite Configuration

### Webpack

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer")
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ]
};
```

### Vite

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer'
    }
  },
  define: {
    global: 'globalThis',
  }
});
```

## Browser Compatibility

The SDK supports all modern browsers with WebAssembly support:

- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

## Error Handling

```javascript
try {
  const mlkem = await loadWasm();
  // Use mlkem...
} catch (error) {
  if (error.message.includes('Go WebAssembly runtime not loaded')) {
    console.error('Make sure to include wasm_exec.js before loading the SDK');
  } else {
    console.error('MLKEM initialization failed:', error);
  }
}
```

## Performance Considerations

1. **WASM Loading**: The WebAssembly module is loaded asynchronously. Consider preloading it for better UX.

2. **Memory Usage**: MLKEM operations are memory-intensive. Consider implementing cleanup for long-running applications.

3. **Bundle Size**: The WASM file adds to your bundle size. Consider lazy loading for better initial page load.

## Example Implementation

See `examples/browser-usage.html` for a complete working example with all features.

## Troubleshooting

### Common Issues

1. **"Go WebAssembly runtime not loaded"**
   - Ensure `wasm_exec.js` is loaded before the SDK
   - Check that the script tag is in the correct order

2. **CORS errors when loading WASM**
   - Ensure your server serves WASM files with correct MIME type: `application/wasm`
   - Add CORS headers if loading from different domain

3. **"Web Crypto API is required"**
   - Ensure you're using HTTPS (required for Web Crypto API)
   - Check browser compatibility

### Debug Mode

Enable debug logging:

```javascript
// Before loading WASM
window.DEBUG = true;
const mlkem = await loadWasm();
```

## Security Considerations

1. **Private Keys**: Never expose private keys in client-side code
2. **HTTPS**: Always use HTTPS in production for Web Crypto API
3. **Input Validation**: Validate all inputs before passing to MLKEM functions
4. **Memory Cleanup**: Consider clearing sensitive data from memory when possible 