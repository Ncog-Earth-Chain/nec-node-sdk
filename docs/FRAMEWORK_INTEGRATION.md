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