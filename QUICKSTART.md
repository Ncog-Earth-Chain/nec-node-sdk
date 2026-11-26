# Quickstart — your first transaction and your first database read

Fifteen minutes, no wallet install, no local node. You will create a post-quantum account, get testnet
funds, send a transaction, and run a **relational JOIN** against the chain's decentralized database.

Every command and every output below came from one clean run against the live testnet on **2026-11-26**,
with `@ncog/necjs@3.0.1` installed from npm. Nothing here is illustrative.

> **This is a disposable testnet.** Chain id **2570**. It can be reset without notice, and its NEC has no
> value. Do not put anything you care about on it.

---

## 1. Install

```bash
mkdir ncog-quickstart && cd ncog-quickstart
npm init -y
npm install @ncog/necjs
```

Node 18 or newer (the examples use the built-in `fetch`).

Set the endpoint once:

```bash
export NCOG_RPC=https://<your-testnet-host>/rpc
```

Ask whoever runs the testnet for the host. The examples below assume `NCOG_RPC` is set.

---

## 2. Create a post-quantum account

NCOG signs with **ML-DSA-87** (FIPS 204), not secp256k1. That is the whole point of the chain, and it is
the first thing you will notice: **there is no `Wallet.createRandom()`.** Generate the key pair, then
build a wallet from it.

```js
const { Wallet, generateMLDSAKeyPair } = require('@ncog/necjs');

const kp = await generateMLDSAKeyPair();
const w  = await Wallet.create(kp.privateKey);

console.log(w.address);
console.log(w.privateKey.replace(/^0x/, '').length, 'hex chars');
```

```
0xed3b9e45f1572bc8386f0f8f366778f44747dbbc
9792 hex chars
```

**9,792 hex characters**, against 64 for an Ethereum key. Plan for that: it is why signatures cost what
they cost later in this guide, and why you should never paste one into a form field expecting 32 bytes.

---

## 3. Check you are on the chain you think you are

```js
const { Provider } = require('@ncog/necjs');
const provider = new Provider(process.env.NCOG_RPC);

console.log(await provider.rpc('eth_chainId', []));
```

```
2570
```

Note it returns `2570`, not `"0x0a0a"` — `provider.rpc` decodes hex quantities for you. That convenience
has two sharp edges, and you need both before you write anything that moves money. See
**[Two things to know about `provider.rpc`](#two-things-to-know-about-providerrpc)** below; the short
version is that for a **balance** or any other exact quantity you should call the node directly:

```js
async function rawRpc(method, params = []) {
  const r = await fetch(process.env.NCOG_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

console.log(await rawRpc('web3_clientVersion'));
```

```
ncogearthchain/v1.0.2-rc.5-96ac5d71-2026-11-25/linux-amd64/go1.26.8
```

Keep `rawRpc` around. You will use it for every exact number in this guide.

---

## 4. Get testnet funds

```js
const res = await fetch('https://<your-testnet-host>/faucet', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ address: w.address }),
});
console.log(res.status, await res.json());
```

```
200 {"ok":true,"txHash":"0x0cb2ad12...f68941","amountNec":"5"}
```

Then wait for it, reading the **raw hex** so the number is exact:

```js
let balHex = '0x0';
for (let i = 0; i < 24; i++) {
  balHex = await rawRpc('eth_getBalance', [w.address, 'latest']);
  if (BigInt(balHex) > 0n) break;
  await new Promise(r => setTimeout(r, 5000));
}
console.log(balHex, '=', BigInt(balHex) / 10n ** 18n, 'NEC');
```

```
arrived after 5s
0x4563918244f40000 = 5 NEC
```

---

## 5. Send a transaction — and estimate the gas

**Do not hardcode 21000.** A post-quantum signature is charged per byte, so a plain transfer on NCOG costs
roughly **six times** an Ethereum transfer:

```js
const to    = '0x' + '11'.repeat(20);
const value = '0x' + (10n ** 16n).toString(16);          // 0.01 NEC

const estHex = await rawRpc('eth_estimateGas', [{ from: w.address, to, value }]);
console.log(estHex, '=', BigInt(estHex), 'gas');
```

```
0x21128 = 135464 gas
```

Now sign and send. `w.connect(provider)` gives you a signer:

```js
const signer = w.connect(provider);

const hash = await signer.sendTransaction({
  from:     w.address,
  nonce:    await rawRpc('eth_getTransactionCount', [w.address, 'pending']),
  gasPrice: await rawRpc('eth_gasPrice', []),
  gasLimit: '0x' + ((BigInt(estHex) * 12n) / 10n).toString(16),   // estimate + 20%
  to, value,
});
console.log(hash);
```

```
0xbcfcc738c95ef55b53ac6c429551cf8c43187a87b386c8a46d79c22ddb45fedb
```

And the receipt:

```js
let rcpt = null;
for (let i = 0; i < 24 && !rcpt; i++) {
  rcpt = await rawRpc('eth_getTransactionReceipt', [hash]);
  if (!rcpt) await new Promise(r => setTimeout(r, 5000));
}
console.log(rcpt.blockNumber, rcpt.gasUsed, rcpt.status);
```

```
0xc1d  0x21bbd  0x1
```

**Look at those two numbers together.** The estimate was **135,464**; the transaction actually used
**138,173**. The estimate came in **2,709 gas low**, which is why the `* 12 / 10` buffer above is not
decoration — send it at exactly the estimate and you risk `out of gas`. Always pad.

---

## 6. Read the decentralized database

This is the part no other chain does. NCOG stores **relational tables** with real SQL semantics, and a
read needs no key, no gas and no signature.

```js
const { Ddb } = require('@ncog/necjs');
const ddb = new Ddb(provider);

const rows = await ddb.select('c_dec0de0000000000000000000000000000002570', 'customers', { limit: 3 });
rows.forEach(r => console.log(r));
```

```
{ id: 1, name: 'Northwind Logistics', region: 'EMEA' }
{ id: 2, name: 'Pacific Freight',     region: 'APAC' }
{ id: 3, name: 'Atlas Components',    region: 'EMEA' }
```

Now the thing worth the install — a **stored procedure doing a JOIN and an aggregate**, executed by the
chain:

```js
const byRegion = await ddb.callReadProcedure(
  'c_dec0de0000000000000000000000000000002570', 'revenue_by_region', ['0']);

byRegion.forEach(r => console.log(r.region_name, r.order_count, r.revenue));
```

```
AMER  101  1382154.00
APAC  203  2747650.75
EMEA  203  2698600.75
```

That is a `JOIN` across `customers`, `orders` and `regions` with a `SUM` and a `GROUP BY`, run on chain.
The revenue figures are **exact decimals**, not floats — the database keeps `NUMERIC` precision, so money
adds up to the cent.

---

## Two things to know about `provider.rpc`

Both are real defects in the published **3.0.1**, both have simple workarounds, and both are worth
knowing before you ship anything.

**It throws on any method whose result is text.** `web3_clientVersion` and `net_version` both return a
string, and `provider.rpc` tries to parse every string result as a hex quantity. Use `rawRpc` for those.
*Fixed in source; reaches you in the next release.*

**It rounds every quantity above 2⁵³.** `provider.rpc` decodes hex into a JavaScript `number`, and
1 NEC is 10¹⁸ wei — so essentially every real balance is affected:

| value | exact | what `provider.rpc` returns |
|---|---|---|
| 1 NEC | `1000000000000000000` | correct, by luck |
| 1 NEC + 1 wei | `1000000000000000001` | `1000000000000000000` — the wei is gone |
| 80,000,000 NEC | `80000000000000000000000000` | `8e+25` — not a value any RPC accepts back |

It cannot create money: the node is authoritative and refuses an overspend. But a wallet deciding "can
the user afford this" from `provider.rpc` is deciding with a rounded number, and anything that writes the
result into a transaction value writes `8e+25`.

**So: read the raw hex and use `BigInt` for anything you compare, display as a balance, or send.** That is
what `rawRpc` is for throughout this guide, and what the faucet and the testnet deploy scripts do.

---

## What you just proved

- A post-quantum account, created client-side, with an ML-DSA-87 key.
- A signed transaction accepted by a live chain, with its real gas cost measured rather than assumed.
- A relational JOIN with exact decimal arithmetic, read from chain state without a key.

## Where to go next

- **[docs/API_REFERENCE.md](docs/API_REFERENCE.md)** — the full client surface.
- **[docs/DDB_FUNCTION_REFERENCE.md](docs/DDB_FUNCTION_REFERENCE.md)** — writing to the database:
  schemas, data contracts, procedures and permissions.
- **[docs/CONTRACT_FUNCTION_REFERENCE.md](docs/CONTRACT_FUNCTION_REFERENCE.md)** — EVM contracts, which
  work as you expect, with post-quantum signatures underneath.

**One limit to plan around before you design a write path:** a single DDB commit transaction currently
carries at most **4 operations**. That ceiling is derived, not chosen — the 128 KiB transaction limit
divided by what a committee quorum's ML-DSA-87 signatures cost — so batch accordingly.
