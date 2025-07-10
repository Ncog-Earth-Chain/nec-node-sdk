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