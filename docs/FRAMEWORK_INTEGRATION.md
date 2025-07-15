# Framework Integration Examples

This guide shows how to integrate the NCOG SDK in popular frontend frameworks, including both Wallet-based and Extension-based (browser extension wallet) connection methods.

---

## React

### Using Wallet
```jsx
import React, { useEffect, useState } from 'react';
import { loadWasm, Provider, Wallet } from 'ncog';

function App() {
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      await loadWasm();
      const wallet = await Wallet.create('your-private-key-hex');
      const provider = new Provider('https://rpc.ncog.earth');
      const bal = await provider.getBalance(wallet.address);
      setBalance(bal);
    })();
  }, []);

  return (
    <div>
      <h1>NCOG React Example (Wallet)</h1>
      <p>Balance: {balance}</p>
    </div>
  );
}

export default App;
```

### Using Extension Wallet
```jsx
import React, { useEffect, useState } from 'react';
import { Provider, ExtensionSigner } from 'ncog';

function App() {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      if (window.ncogWallet) {
        const provider = new Provider('https://rpc.ncog.earth');
        const signer = new ExtensionSigner(window.ncogWallet, provider);
        const addr = await signer.getAddress();
        setAddress(addr);
        const bal = await provider.getBalance(addr);
        setBalance(bal);
      }
    })();
  }, []);

  return (
    <div>
      <h1>NCOG React Example (Extension Wallet)</h1>
      <p>Address: {address}</p>
      <p>Balance: {balance}</p>
    </div>
  );
}

export default App;
```

---

## Next.js

### Using Wallet
```js
import { useEffect, useState } from 'react';
import { loadWasm, Provider, Wallet } from 'ncog';

export default function Home() {
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      await loadWasm();
      const wallet = await Wallet.create('your-private-key-hex');
      const provider = new Provider('https://rpc.ncog.earth');
      const bal = await provider.getBalance(wallet.address);
      setBalance(bal);
    })();
  }, []);

  return (
    <main>
      <h1>NCOG Next.js Example (Wallet)</h1>
      <p>Balance: {balance}</p>
    </main>
  );
}
```

### Using Extension Wallet
```js
import { useEffect, useState } from 'react';
import { Provider, ExtensionSigner } from 'ncog';

export default function Home() {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      if (typeof window !== 'undefined' && window.ncogWallet) {
        const provider = new Provider('https://rpc.ncog.earth');
        const signer = new ExtensionSigner(window.ncogWallet, provider);
        const addr = await signer.getAddress();
        setAddress(addr);
        const bal = await provider.getBalance(addr);
        setBalance(bal);
      }
    })();
  }, []);

  return (
    <main>
      <h1>NCOG Next.js Example (Extension Wallet)</h1>
      <p>Address: {address}</p>
      <p>Balance: {balance}</p>
    </main>
  );
}
```

---

## Vite.js

### Using Wallet
```jsx
import { useEffect, useState } from 'react';
import { loadWasm, Provider, Wallet } from 'ncog';

function App() {
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      await loadWasm();
      const wallet = await Wallet.create('your-private-key-hex');
      const provider = new Provider('https://rpc.ncog.earth');
      const bal = await provider.getBalance(wallet.address);
      setBalance(bal);
    })();
  }, []);

  return (
    <div>
      <h1>NCOG Vite.js Example (Wallet)</h1>
      <p>Balance: {balance}</p>
    </div>
  );
}

export default App;
```

### Using Extension Wallet
```jsx
import { useEffect, useState } from 'react';
import { Provider, ExtensionSigner } from 'ncog';

function App() {
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    (async () => {
      if (window.ncogWallet) {
        const provider = new Provider('https://rpc.ncog.earth');
        const signer = new ExtensionSigner(window.ncogWallet, provider);
        const addr = await signer.getAddress();
        setAddress(addr);
        const bal = await provider.getBalance(addr);
        setBalance(bal);
      }
    })();
  }, []);

  return (
    <div>
      <h1>NCOG Vite.js Example (Extension Wallet)</h1>
      <p>Address: {address}</p>
      <p>Balance: {balance}</p>
    </div>
  );
}

export default App;
```

---

## Contract Deployment & Interaction Example

```js
import { Provider, Wallet, ContractFactory } from 'ncog';

(async () => {
  await loadWasm();
  const wallet = await Wallet.create('your-private-key-hex');
  const provider = new Provider('https://rpc.ncog.earth');
  const signer = wallet.connect(provider);

  // Example ABI and bytecode
  const abi = [/* ... */];
  const bytecode = '0x...';

  // Deploy contract
  const factory = new ContractFactory(abi, bytecode, provider, signer);
  const contract = await factory.deploy([/* constructor args */]);
  console.log('Deployed contract at:', contract.address);

  // Attach to existing contract
  const existing = factory.attach('0x...');
  const result = await existing.methods.someMethod().call();
  console.log('Result:', result);
})();
```

---

## Real-Time Event Subscription Example

```js
import { Subscription } from 'ncog';

const wsUrl = 'wss://rpc.ncog.earth';
const sub = new Subscription(wsUrl);

await sub.connect();
sub.on('open', () => console.log('WebSocket connected!'));
sub.on('close', () => console.log('WebSocket disconnected!'));
sub.on('error', (err) => console.error('WebSocket error:', err));

const subId = await sub.subscribe('newHeads', [], (blockHeader) => {
  console.log('New block header:', blockHeader);
});

// Unsubscribe when done
// await sub.unsubscribe(subId);
// sub.disconnect();
```

---

## Utility Function Examples

```js
import { isValidAddress, hexToDecimalString, etherToWeiHex } from 'ncog';

console.log(isValidAddress('0x123...')); // true/false
console.log(hexToDecimalString('0x1a')); // '26'
console.log(etherToWeiHex(1)); // '0x...' (Wei value for 1 Ether)
``` 