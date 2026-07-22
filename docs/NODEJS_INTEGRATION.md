# Node.js Integration

You can use the NECJS SDK directly in any Node.js application. Example:

```js
const { loadWasm, Provider, Wallet } = require('necjs');

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
const { Provider, Wallet, ContractFactory, loadWasm } = require('necjs');

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
const { Subscription } = require('necjs');

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

---

## DDB (Decentralized Database) Example

The `Ddb` client wraps the node's `ddb_*` RPC namespace. Writes are **client-signed** with the
caller's ML-DSA-87 key (`createSchemaSigned` / `callProcedureSigned` / `grantRoleSigned` /
`revokeRoleSigned`) and return an endorsement `requestId` you can wait on; reads (`getSchema` /
`select` / `query`) query the node's Postgres directly with no consensus.

```js
const { loadWasm, Provider, Wallet, Ddb } = require('necjs');

(async () => {
  await loadWasm();
  const provider = new Provider('https://rpc.ncog.earth');
  const ddb = new Ddb(provider);
  const wallet = await Wallet.create('your-private-key-hex');

  // WRITE (client-signed): create a contract schema; returns the endorsement requestId.
  const definition = {
    contract_name: 'users',
    schema: {
      tables: [
        {
          name: 'accounts',
          columns: [
            { name: 'username', type: 'text', constraints: ['primary key'] },
            { name: 'age', type: 'int' },
          ],
        },
      ],
    },
  };
  const requestId = await ddb.createSchemaSigned(wallet.privateKey, 'users', definition);
  await ddb.waitForEndorsement(requestId); // wait until the write commits

  // READ (no consensus): derive the db_name for schema-scoped calls, then select rows.
  const dbName = Ddb.deriveDbName('users', contractAddress); // e.g. 'users_abcdef'
  const rows = await ddb.select(dbName, 'accounts', { limit: 50 });
  console.log('rows:', rows);
})();
``` 