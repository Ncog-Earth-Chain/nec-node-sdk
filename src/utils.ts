// src/utils.ts

// Generic base for decimal handling
const TEN = BigInt(10);
// Default number of decimals (e.g., for Ether or NEC token)
export const DEFAULT_DECIMALS = 18;
// NEC token decimals (replace if different)
export const NEC_DECIMALS = 18;
// BigInt factor for converting whole units ↔ base units
export const WEI_FACTOR = TEN ** BigInt(DEFAULT_DECIMALS);

/**
 * Convert a hex string to a decimal (string or number).
 * Assumes input is already in base units.
 */
export function hexToDecimalString(hex: string): string | number {
  if (typeof hex !== 'string') {
    throw new TypeError(`hexToDecimalString: expected a string, got ${typeof hex}`);
  }
  const raw = hex.trim().toLowerCase();
  if (raw === '0x') return 0;
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error(`hexToDecimalString: invalid hex string "${hex}"`);
  }
  const asDec = BigInt(normalized).toString(10);
  return isNaN(Number(asDec)) ? asDec : Number(asDec);
}

/**
 * Convert a hex string to a decimal-string (no extra multiplication).
 * Use for normalizing RPC response fields already in base units.
 */
export function normalizeHexField(key: string, hex: string): string {
  if (hex === '0x') return '0';
  return BigInt(hex).toString(10);
}

/**
 * Serialize a decimal (number, numeric-string, or bigint) to hex-with-0x.
 * Assumes input is already in base units.
 */
export function decimalToHex(value: number | string | bigint): string {
  return '0x' + BigInt(value).toString(16);
}

/**
 * Generic: parse whole- or fractional-unit amount into base-unit hex.
 * Accepts number|string|bigint, handles fractional up to `decimals`.
 */
export function parseUnits(
  value: number | string | bigint,
  decimals: number = DEFAULT_DECIMALS
): string {
  let str: string;
  if (typeof value === 'number') {
    str = value.toFixed(decimals);
  } else {
    str = value.toString();
  }

  const [wholePart, fracPart = ''] = str.split('.');
  if (!/^\d+$/.test(wholePart) || !/^\d*$/.test(fracPart)) {
    throw new Error(`parseUnits: invalid numeric value "${value}"`);
  }
  if (fracPart.length > decimals) {
    throw new Error(
      `parseUnits: too many decimal places (max ${decimals}) in "${value}"`
    );
  }

  const factor = decimals === DEFAULT_DECIMALS ? WEI_FACTOR : TEN ** BigInt(decimals);
  const whole = BigInt(wholePart) * factor;
  const frac = BigInt(fracPart.padEnd(decimals, '0'));
  const combined = whole + frac;

  return '0x' + combined.toString(16);
}

/**
 * Convert an Ether value (number|string|bigint), including fractional,
 * → Wei → hex-with-0x.
 */
export function etherToWeiHex(value: number | string | bigint): string {
  return parseUnits(value, DEFAULT_DECIMALS);
}

/**
 * Convert a Wei-hex (or bigint or numeric string) into an Ether decimal string.
 */
export function hexToEther(
  value: string | number | bigint
): string {
  return formatUnits(value, DEFAULT_DECIMALS);
}

/**
 * Generic: format a base-unit amount (hex, number, or bigint)
 * into a human-readable decimal string.
 */
export function formatUnits(
  value: string | number | bigint,
  decimals: number = DEFAULT_DECIMALS
): string {
  const big =
    typeof value === 'string' && value.startsWith('0x')
      ? BigInt(value)
      : BigInt(value);
  const factor = decimals === DEFAULT_DECIMALS ? WEI_FACTOR : TEN ** BigInt(decimals);
  const integer = big / factor;
  const fraction = big % factor;

  let fracStr = fraction
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');

  return fracStr ? `${integer.toString()}.${fracStr}` : integer.toString();
}

/**
 * Convert a NEC base-unit amount (hex, number, or bigint) into a NEC decimal string.
 */
export function hexToNec(
  value: string | number | bigint
): string {
  return formatUnits(value, NEC_DECIMALS);
}

/**
 * Convert a whole-NEC amount (number|string|bigint) into base-unit hex.
 */
export function necToHex(
  value: number | string | bigint
): string {
  return parseUnits(value, NEC_DECIMALS);
}

/**
 * Convert a Wei (number, bigint, or hex string) directly into a NEC decimal string.
 * Useful when NEC is pegged 1:1 with Ether base units.
 */
export function weiToNec(
  value: string | number | bigint
): string {
  return formatUnits(value, NEC_DECIMALS);
}

/**
 * Walk and serialize all fields in TxParams for JSON-RPC.
 */
export function serializeForRpc(
  payload: Record<string, any>
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'number' || (/^[0-9]+$/.test(val as string))) {
      if (key === 'value') {
        out[key] = etherToWeiHex(val);
      } else if (
        key.toLowerCase().includes('amount') ||
        key.toLowerCase().includes('balance')
      ) {
        out[key] = parseUnits(val);
      } else {
        out[key] = decimalToHex(val);
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Walk and normalize JSON-RPC response (hex → decimal string or number).
 */
export function normalizeResponse(
  resp: Record<string, any> | any
): Record<string, any> | any {
  if (resp === null) return {};
  if (typeof resp === 'boolean') return resp;
  if (typeof resp === 'string') {
    if (/^0x[a-fA-F0-9]{40,}$/.test(resp)) return resp;
    return hexToDecimalString(resp);
  }
  if (Array.isArray(resp)) {
    return resp.map((v) =>
      typeof v === 'object' ? normalizeResponse(v) : v
    );
  }

  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(resp)) {
    if (typeof val === 'string' && val.startsWith('0x')) {
      if (
        ['address','hash','from','to','transactionHash','blockHash','contractAddress']
        .includes(key)
      ) {
        out[key] = val;
      } else {
        out[key] = normalizeHexField(key, val);
      }
    } else if (Array.isArray(val)) {
      out[key] = val.map((v) =>
        typeof v === 'object' ? normalizeResponse(v) : v
      );
    } else if (val && typeof val === 'object') {
      out[key] = normalizeResponse(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Checks if a string is a valid Ethereum/EVM address.
 */
export function isValidAddress(address: string): boolean {
  return (
    typeof address === 'string' &&
    address.startsWith('0x') &&
    address.length === 42 &&
    /^[0-9a-fA-F]{40}$/.test(address.slice(2))
  );
}
