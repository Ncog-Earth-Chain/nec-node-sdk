# Node.js Integration

You can use the NCOG SDK directly in any Node.js application. Example:

```js
const { loadWasm, Provider, Wallet } = require('ncog');

(async () => {
  await loadWasm(); // Required for cryptography
  const wallet = await Wallet.create('your-private-key-hex');
  const provider = new Provider('https://rpc.ncog.earth');
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', balance);
})();
```

---

## Contract Deployment Example

```js
const { Provider, Wallet, ContractFactory, loadWasm } = require('ncog');

(async () => {
  await loadWasm();
  const wallet = await Wallet.create('your-private-key-hex');
  const provider = new Provider('https://rpc.ncog.earth');
  const signer = wallet.connect(provider);

  const abi = [/* ... */];
  const bytecode = '0x...';
  const factory = new ContractFactory(abi, bytecode, provider, signer);
  const contract = await factory.deploy([/* constructor args */]);
  console.log('Deployed contract at:', contract.address);
})();
```

---

## Real-Time Event Subscription Example

```js
const { Subscription } = require('ncog');

const wsUrl = 'wss://rpc.ncog.earth';
const sub = new Subscription(wsUrl);

(async () => {
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
})();
``` 