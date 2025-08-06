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

### normalizeHexField

**Function:** `normalizeHexField(key: string, hex: string): string`

**Description:** Convert a hex string to a decimal-string (no extra multiplication). Use for normalizing RPC response fields already in base units.

**Input Parameters:**
- `key` (string): Field key (for context)
- `hex` (string): Hexadecimal string to normalize

**Response:** `string` - Normalized decimal string

**Example:**
```typescript
const normalized = normalizeHexField('balance', '0x1bc16d674ec80000'); // Returns '2000000000000000000'
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

## Usage Examples

### Basic Unit Conversions

```typescript
import { 
  etherToWeiHex, 
  hexToEther, 
  parseUnits, 
  formatUnits 
} from 'necjs';

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
import { hexToNec, necToHex, weiToNec } from 'necjs';

// Convert NEC hex to decimal
const necAmount = hexToNec('0x1bc16d674ec80000'); // '2.0'

// Convert NEC decimal to hex
const necHex = necToHex('2.0'); // '0x1bc16d674ec80000'

// Convert Wei to NEC (when pegged 1:1)
const necFromWei = weiToNec('0x1bc16d674ec80000'); // '2.0'
```

### RPC Operations

```typescript
import { serializeForRpc, normalizeResponse } from 'necjs';

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
import { isValidAddress } from 'necjs';

// Validate Ethereum addresses
const validAddress = '0x1234567890123456789012345678901234567890';
const invalidAddress = 'invalid-address';

console.log(isValidAddress(validAddress)); // true
console.log(isValidAddress(invalidAddress)); // false
```

### Hex Conversions

```typescript
import { hexToDecimalString, decimalToHex, normalizeHexField } from 'necjs';

// Convert hex to decimal
const decimal = hexToDecimalString('0x1bc16d674ec80000'); // 2000000000000000000

// Convert decimal to hex
const hex = decimalToHex(2000000000000000000); // '0x1bc16d674ec80000'

// Normalize hex field for RPC responses
const normalized = normalizeHexField('balance', '0x1bc16d674ec80000'); // '2000000000000000000'
``` 