# Utils Function Reference
## Constants

### DEFAULT_DECIMALS
**Value:** `18`

**Description:** Default number of decimals for Ether or NEC token operations.

### NEC_DECIMALS
**Value:** `18`

**Description:** NEC token decimals (replace if different).

### WEI_FACTOR
**Value:** `BigInt(10) ** BigInt(18)`

**Description:** BigInt factor for converting whole units ↔ base units.

## Hex Conversion Functions

### hexToDecimalString

**Function:** `hexToDecimalString(hex: string): string | number`

**Description:** Convert a hex string to a decimal (string or number). Assumes input is already in base units.

**Input Parameters:**
- `hex` (string): Hexadecimal string to convert

**Response:** `string | number` - Converted decimal value

**Error Handling:**
- Throws TypeError if input is not a string
- Throws Error if hex string is invalid

**Example:**
```typescript
const decimal = hexToDecimalString('0x1bc16d674ec80000'); // Returns 2000000000000000000
```

### decimalToHex

**Function:** `decimalToHex(value: number | string | bigint): string`

**Description:** Serialize a decimal (number, numeric-string, or bigint) to hex-with-0x. Assumes input is already in base units.

**Input Parameters:**
- `value` (number | string | bigint): Decimal value to convert

**Response:** `string` - Hexadecimal string with 0x prefix

**Example:**
```typescript
const hex = decimalToHex(2000000000000000000); // Returns '0x1bc16d674ec80000'
```

## Unit Conversion Functions

### parseUnits

**Function:** `parseUnits(value: number | string | bigint, decimals: number = DEFAULT_DECIMALS): string`

**Description:** Generic: parse whole- or fractional-unit amount into base-unit hex. Accepts number|string|bigint, handles fractional up to `decimals`.

**Input Parameters:**
- `value` (number | string | bigint): Value to parse
- `decimals` (number, optional): Number of decimal places (defaults to 18)

**Response:** `string` - Hexadecimal string representing the value in base units

**Error Handling:**
- Throws Error if numeric value is invalid
- Throws Error if too many decimal places

**Example:**
```typescript
const hex = parseUnits('1.5', 18); // Returns '0x14d1120d7b1600000000'
```

### formatUnits

**Function:** `formatUnits(value: string | number | bigint, decimals: number = DEFAULT_DECIMALS): string`

**Description:** Generic: format a base-unit amount (hex, number, or bigint) into a human-readable decimal string.

**Input Parameters:**
- `value` (string | number | bigint): Base unit value to format
- `decimals` (number, optional): Number of decimal places (defaults to 18)

**Response:** `string` - Human-readable decimal string

**Example:**
```typescript
const formatted = formatUnits('0x14d1120d7b1600000000', 18); // Returns '1.5'
```

### decimalToWei

**Function:** `decimalToWei(value: number | string | bigint, decimals: number = DEFAULT_DECIMALS): string`

**Description:** Convert a decimal Ether value (number|string|bigint) to a Wei value as a string (base 10, not hex).

**Input Parameters:**
- `value` (number | string | bigint): Decimal value to convert
- `decimals` (number, optional): Number of decimal places (defaults to 18)

**Response:** `string` - Wei value as base 10 string

**Error Handling:**
- Throws Error if value is invalid

**Example:**
```typescript
const wei = decimalToWei('1.23'); // Returns '1230000000000000000'
```

## Currency-Specific Functions

### etherToWeiHex

**Function:** `etherToWeiHex(value: number | string | bigint): string`

**Description:** Convert an Ether value (number|string|bigint), including fractional, → Wei → hex-with-0x.

**Input Parameters:**
- `value` (number | string | bigint): Ether value to convert

**Response:** `string` - Wei value as hexadecimal string

**Example:**
```typescript
const weiHex = etherToWeiHex('1.5'); // Returns '0x14d1120d7b1600000000'
```

### hexToEther

**Function:** `hexToEther(value: string | number | bigint): string`

**Description:** Convert a Wei-hex (or bigint or numeric string) into an Ether decimal string.

**Input Parameters:**
- `value` (string | number | bigint): Wei value to convert

**Response:** `string` - Ether value as decimal string

**Example:**
```typescript
const ether = hexToEther('0x14d1120d7b1600000000'); // Returns '1.5'
```

### hexToNec

**Function:** `hexToNec(value: string | number | bigint): string`

**Description:** Convert a NEC base-unit amount (hex, number, or bigint) into a NEC decimal string.

**Input Parameters:**
- `value` (string | number | bigint): NEC base unit value to convert

**Response:** `string` - NEC value as decimal string

**Example:**
```typescript
const nec = hexToNec('0x14d1120d7b1600000000'); // Returns '1.5'
```

### necToHex

**Function:** `necToHex(value: number | string | bigint): string`

**Description:** Convert a whole-NEC amount (number|string|bigint) into base-unit hex.

**Input Parameters:**
- `value` (number | string | bigint): NEC value to convert

**Response:** `string` - NEC value as hexadecimal string

**Example:**
```typescript
const necHex = necToHex('1.5'); // Returns '0x14d1120d7b1600000000'
```

### weiToNec

**Function:** `weiToNec(value: string | number | bigint): string`

**Description:** Convert a Wei (number, bigint, or hex string) directly into a NEC decimal string. Useful when NEC is pegged 1:1 with Ether base units.

**Input Parameters:**
- `value` (string | number | bigint): Wei value to convert

**Response:** `string` - NEC value as decimal string

**Example:**
```typescript
const nec = weiToNec('0x14d1120d7b1600000000'); // Returns '1.5'
```

## RPC Serialization Functions

### serializeForRpc

**Function:** `serializeForRpc(payload: Record<string, any>): Record<string, any>`

**Description:** Walk and serialize all fields in TxParams for JSON-RPC.

**Input Parameters:**
- `payload` (Record<string, any>): Object containing transaction parameters

**Response:** `Record<string, any>` - Serialized object ready for RPC

**Example:**
```typescript
const serialized = serializeForRpc({
  from: '0x1234...',
  to: '0x5678...',
  value: '1.5',
  gasPrice: 20000000000
});
// Returns object with value converted to hex and gasPrice converted to hex
```

### normalizeResponse

**Function:** `normalizeResponse(resp: Record<string, any> | any): Record<string, any> | any`

**Description:** Walk and normalize JSON-RPC response (hex → decimal string or number).

**Input Parameters:**
- `resp` (Record<string, any> | any): RPC response to normalize

**Response:** `Record<string, any> | any` - Normalized response with hex values converted to decimals

**Example:**
```typescript
const normalized = normalizeResponse({
  balance: '0x1bc16d674ec80000',
  address: '0x1234567890123456789012345678901234567890'
});
// Returns { balance: '2000000000000000000', address: '0x1234567890123456789012345678901234567890' }
```

## Validation Functions

### isValidAddress

**Function:** `isValidAddress(address: string): boolean`

**Description:** Checks if a string is a valid Ethereum/EVM address.

**Input Parameters:**
- `address` (string): Address string to validate

**Response:** `boolean` - True if valid Ethereum address, false otherwise

**Example:**
```typescript
const isValid = isValidAddress('0x1234567890123456789012345678901234567890'); // Returns true
const isInvalid = isValidAddress('invalid-address'); // Returns false
```

## Cryptography helpers

Post-quantum key/address helpers and EIP-191 personal-message signing, all exported from
`necjs`. Transaction signing lives in [TX_SIGNER_FUNCTION_REFERENCE.md](TX_SIGNER_FUNCTION_REFERENCE.md);
these are the account-key and message-signing helpers.

> The `algorithm` argument defaults to `'ml_dsa87'` and also accepts `'ml_dsa44'` / `'ml_dsa65'`.
> NCOG accounts use ML-DSA-87.

### generateMLDSAKeyPair

**Function:** `generateMLDSAKeyPair(algorithm?: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87'): Promise<{ publicKey: string; privateKey: string }>`

**Description:** Generate a new ML-DSA key pair. Both keys are returned as hex strings (no `0x`
prefix). ML-DSA secret keys in this bundle do not embed the public key, so persist `publicKey`
alongside `privateKey` if you will need it later (e.g. for verification).

**Response:** `Promise<{ publicKey: string; privateKey: string }>`

**Example:**
```typescript
const { publicKey, privateKey } = await generateMLDSAKeyPair(); // ml_dsa87
```

### mldsaPublicKeyToAddress

**Function:** `mldsaPublicKeyToAddress(publicKey: string): string`

**Description:** Derive the account address from a raw ML-DSA public key hex, using the chain's
scheme `address = keccak256(rawPubkeyBytes)[12:]`. Returns a `0x`-prefixed 20-byte address.

**Input Parameters:**
- `publicKey` (string): Raw ML-DSA public key as a hex string

**Response:** `string` - `0x`-prefixed account address

**Example:**
```typescript
const address = mldsaPublicKeyToAddress(publicKey); // '0x....'
```

### mldsaPrivateKeyToPublicKey

**Function:** `mldsaPrivateKeyToPublicKey(keyHex: string, algorithm?: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87'): Promise<string>`

**Description:** Validate/derive an ML-DSA public key. If `keyHex` already looks like a public key
for the algorithm it is returned (lowercase, no `0x`). If it is a secret key, derivation depends on
the bundled implementation and may throw — persist the public key from `generateMLDSAKeyPair` instead.

**Response:** `Promise<string>` - public key hex

**Error Handling:**
- Throws if the hex is invalid or the length does not match a known key size

### signPersonalMessageMLDSA

**Function:** `signPersonalMessageMLDSA(message: string | Uint8Array, privateKey: string, algorithm?: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87'): Promise<string>`

**Description:** Sign a personal message with ML-DSA-87 over the EIP-191 digest the node verifies
against (`keccak256("\x19Ethereum Signed Message:\n" + len + msg)`). The resulting signature is
verifiable via the node's `personal_verifyMessage` (see `Provider.verifyMessage`).

**Input Parameters:**
- `message` (string | Uint8Array): utf-8 string, `0x`-hex string, or raw bytes
- `privateKey` (string): ML-DSA private key hex
- `algorithm` (optional): defaults to `'ml_dsa87'`

**Response:** `Promise<string>` - signature as a hex string (no `0x` prefix, matching the
`generateMLDSAKeyPair` hex convention; pass it straight back into `verifyPersonalMessageMLDSA`)

### verifyPersonalMessageMLDSA

**Function:** `verifyPersonalMessageMLDSA(message: string | Uint8Array, signature: string, publicKey: string, algorithm?: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87'): Promise<boolean>`

**Description:** Verify an ML-DSA personal-message signature over the EIP-191 digest. Returns `true`
iff the signature verifies against the message and public key.

**Response:** `Promise<boolean>`

**Round-trip example:**
```typescript
import {
  generateMLDSAKeyPair,
  signPersonalMessageMLDSA,
  verifyPersonalMessageMLDSA,
} from '@ncog/necjs';

const { publicKey, privateKey } = await generateMLDSAKeyPair();

const message = 'Hello, NCOG!';
const signature = await signPersonalMessageMLDSA(message, privateKey);

const ok = await verifyPersonalMessageMLDSA(message, signature, publicKey);
console.log('signature valid:', ok); // true
```

### personalTextHash

**Function:** `personalTextHash(message: string | Uint8Array): Uint8Array`

**Description:** Compute the EIP-191 TextHash for a message — the exact 32-byte Keccak-256 digest the
node's `personal_verifyMessage` checks against. `message` is resolved as: `Uint8Array` used as-is,
`0x`-hex decoded to bytes, otherwise utf-8 encoded.

**Response:** `Uint8Array` - 32-byte digest

**Example:**
```typescript
const digest = personalTextHash('Hello, NCOG!'); // Uint8Array(32)
```

### kyberPrivateKeyToEncryptedPublicKeyAddress

**Function:** `kyberPrivateKeyToEncryptedPublicKeyAddress(skHex: string): string`

**Description:** Extract the ML-KEM (Kyber) **encapsulation public key** (`ek`) from a Kyber secret
key hex. If the input already looks like a public key (800 / 1184 / 1568 bytes) it is returned as-is.
Returns a lowercase hex string **without** a `0x` prefix. This is an encryption (KEM) key — it is
**not** an account/signing key and must not be used for on-chain identity.

**Input Parameters:**
- `skHex` (string): Kyber secret key as a hex string

**Response:** `string` - encapsulation public key hex (lowercase, no `0x`)

**Error Handling:**
- Throws if the key is empty or has an unsupported length

## Usage Examples

### Basic Unit Conversions

```typescript
import { 
  etherToWeiHex, 
  hexToEther, 
  parseUnits, 
  formatUnits 
} from '@ncog/necjs';

// Convert Ether to Wei hex
const weiHex = etherToWeiHex('1.5'); // '0x14d1120d7b1600000000'

// Convert Wei hex to Ether
const ether = hexToEther('0x14d1120d7b1600000000'); // '1.5'

// Parse units with custom decimals
const customUnits = parseUnits('1.5', 6); // For tokens with 6 decimals

// Format units back to human readable
const formatted = formatUnits(customUnits, 6); // '1.5'
```

### NEC Token Operations

```typescript
import { hexToNec, necToHex, weiToNec } from '@ncog/necjs';

// Convert NEC hex to decimal
const necAmount = hexToNec('0x1bc16d674ec80000'); // '2.0'

// Convert NEC decimal to hex
const necHex = necToHex('2.0'); // '0x1bc16d674ec80000'

// Convert Wei to NEC (when pegged 1:1)
const necFromWei = weiToNec('0x1bc16d674ec80000'); // '2.0'
```

### RPC Operations

```typescript
import { serializeForRpc, normalizeResponse } from '@ncog/necjs';

// Serialize transaction for RPC
const txParams = {
  from: '0x1234...',
  to: '0x5678...',
  value: '1.5', // Will be converted to hex
  gasPrice: 20000000000 // Will be converted to hex
};

const serialized = serializeForRpc(txParams);

// Normalize RPC response
const rpcResponse = {
  balance: '0x1bc16d674ec80000',
  nonce: '0x5',
  address: '0x1234567890123456789012345678901234567890'
};

const normalized = normalizeResponse(rpcResponse);
// balance: '2000000000000000000', nonce: 5, address: '0x1234567890123456789012345678901234567890'
```

### Address Validation

```typescript
import { isValidAddress } from '@ncog/necjs';

// Validate Ethereum addresses
const validAddress = '0x1234567890123456789012345678901234567890';
const invalidAddress = 'invalid-address';

console.log(isValidAddress(validAddress)); // true
console.log(isValidAddress(invalidAddress)); // false
```

### Hex Conversions

```typescript
import { hexToDecimalString, decimalToHex } from '@ncog/necjs';

// Convert hex to decimal
const decimal = hexToDecimalString('0x1bc16d674ec80000'); // 2000000000000000000

// Convert decimal to hex
const hex = decimalToHex(2000000000000000000); // '0x1bc16d674ec80000'
``` 