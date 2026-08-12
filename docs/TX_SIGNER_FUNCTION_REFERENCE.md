# Transaction Signer Function Reference

Native-JS (WASM-free) ML-DSA-87 transaction signer for NCOG Earth Chain. These functions are a
byte-for-byte port of the chain's Go reference (`ethapi.SignTransaction` + `types.SigningHash` +
`types.LegacyTx`), producing the authoritative **SigVersion-v2** wire format.

All symbols are exported from `necjs`:

```typescript
import {
  signTransactionMLDSA87,
  privateKeyToAddress,
  publicKeyToAddress,
  decodeRLPTransaction,
  type SignedTx,
  type SignOptions,
} from '@ncog/necjs';
```

> **Wire-format toggles were removed in v2.** `chainId` is **always** bound into the signing digest
> for replay protection. The old `setDefaultIncludeChainId` / `setDefaultRawPubkey` switches no
> longer exist — there is nothing to toggle.

## The SigVersion-v2 signing digest

The signed message is the Keccak-256 of the RLP-encoded unsigned field list, with `sigVer` and the
sender `from` leading and `chainId` last:

```
sigVer = 2                                    // ML-DSA-87, unrotated (types.SigVerMLDsaV2)
from   = keccak256(rawMLDSApubkeyBytes)[12:]  // 20-byte sender address

digest = keccak256( RLP([ sigVer, from, nonce, gasPrice, gas, to, value, data, chainId ]) )

signature = ml_dsa87.sign(secretKey, digest)  // the message IS the 32-byte digest, empty context
```

The full signed transaction is then RLP-encoded with `from` + `sigVer` trailing, matching the
`LegacyTx` struct wire order:

```
rawTx = RLP([ nonce, gasPrice, gas, to, value, data,
              signature, pubKey, chainId, from, sigVer ])
txHash = keccak256(rawTxBytes)
```

`pubKey` is the **RAW marshaled** ML-DSA-87 public key (exactly 2592 bytes) — the upgraded node
rejects the legacy hex-ASCII form.

## Types

### SignedTx

```typescript
interface SignedTx {
  raw: string;             // 0x-prefixed raw signed tx (for eth_sendRawTransaction)
  rawTransaction: string;  // alias of `raw`
  hash: string;            // 0x tx hash = keccak256(rawTxBytes)
  publicKey: string;       // 0x-prefixed raw ML-DSA-87 public key hex
  signature: string;       // 0x-prefixed signature hex
}
```

### SignOptions

```typescript
interface SignOptions {
  // Optional: supply the public key to skip re-deriving it from the secret key.
  publicKeyHex?: string;
}
```

## Functions

### signTransactionMLDSA87

**Function:** `signTransactionMLDSA87(txParams: any, privateKeyHex: string, options?: SignOptions): Promise<SignedTx>`

**Description:** Sign an NCOG transaction with ML-DSA-87 in the SigVersion-v2 wire format.

**Input Parameters:**
- `txParams` (object): `{ nonce, gasPrice, gas | gasLimit, to, value, data?, chainId }`. Each numeric
  field accepts a number, bigint, decimal string, or `0x`-hex string. `value` must already be in
  **base units (wei)** — this function does **not** convert NEC → wei (unlike `Signer.sendTransaction`).
  A missing/empty `to` means contract creation.
- `privateKeyHex` (string): ML-DSA-87 secret key hex.
- `options` (SignOptions, optional): pass `publicKeyHex` to skip deriving the public key.

**Response:** `Promise<SignedTx>`

**Error Handling:**
- **Throws if `chainId` is `0`/missing** — `txParams.chainId is required — fetch it via eth_chainId
  (Provider.getChainId)`. chainId `0` is never valid on NCOG. (The `Wallet`/`Signer` flow auto-fetches
  it; a direct caller of `signTransactionMLDSA87` must supply it.)

**Example:**
```typescript
import { Provider, signTransactionMLDSA87, etherToWeiHex } from '@ncog/necjs';

const provider = new Provider('https://rpc.ncog.earth');
const from = '0x1234567890123456789012345678901234567890';

const signed = await signTransactionMLDSA87(
  {
    nonce: await provider.getTransactionCount(from),
    gasPrice: await provider.getGasPrice(),
    gas: '21000',
    to: '0x0987654321098765432109876543210987654321',
    value: etherToWeiHex('0.5'), // value must already be in wei/base units
    data: '0x',
    chainId: await provider.getChainId(), // mandatory
  },
  'YOUR_PRIVATE_KEY_HEX'
);

const txHash = await provider.sendRawTransaction(signed.raw);
```

### privateKeyToAddress

**Function:** `privateKeyToAddress(privateKeyHex: string): Promise<string>`

**Description:** Derive the EVM-style account address from an ML-DSA-87 private key:
`address = keccak256(rawPubkeyBytes)[12:]`.

**Response:** `Promise<string>` - `0x`-prefixed 20-byte address.

### publicKeyToAddress

**Function:** `publicKeyToAddress(publicKey: Uint8Array | string): string`

**Description:** Derive the address from a raw ML-DSA-87 public key (bytes or hex):
`address = keccak256(rawPubkeyBytes)[12:]`.

**Response:** `string` - `0x`-prefixed 20-byte address.

### decodeRLPTransaction

**Function:** `decodeRLPTransaction(rawHex: string): any`

**Description:** Decode a raw ML-DSA-87 SigVersion-v2 transaction (`0x`-hex) back into its fields.
Mirrors the chain's **11-field** `LegacyTx` wire layout:

```
[ nonce, gasPrice, gas, to, value, data, signature, pubKey, chainId, from, sigVer ]
```

**Response:** an object with the decoded fields:
```typescript
{
  nonce: string;      // decimal string
  gasPrice: string;   // 0x-hex
  gas: string;        // decimal string
  to: string | null;  // 0x-hex, or null for contract creation
  value: string;      // 0x-hex
  data: string;       // 0x-hex
  signature: string;  // 0x-hex
  publicKey: string;  // 0x-hex (raw 2592-byte ML-DSA-87 key, normalized to hex)
  chainId: string;    // decimal string
  from: string | null;// 0x-hex sender address
  sigVer: string;     // decimal string (e.g. "2")
  hash: string;       // 0x-hex tx hash = keccak256(rawBytes)
}
```

**Error Handling:**
- Throws `decodeRLPTransaction: expected 11 SigV2 fields, got N` if the field count is not 11.

**Example:**
```typescript
const decoded = decodeRLPTransaction(signed.raw);
console.log(decoded.from, decoded.chainId, decoded.sigVer);
```
