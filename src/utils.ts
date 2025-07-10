// src/utils.ts

// BigInt factor for converting Ether ↔ Wei
const WEI_FACTOR = BigInt("1000000000000000000");

/**
 * Convert a hex string to its decimal representation.
 *
 * @param hex  A hex string, with or without "0x" prefix (e.g. "0x19c" or "19C")
 * @returns    The decimal value as a string
 * @throws     Error if the input is not a valid hex string
 */
export function hexToDecimalString(hex: string): string | number {
  if (typeof hex !== 'string') {
    throw new TypeError(`hexToDecimalString: expected a string, got ${typeof hex}`);
  }

  // Trim whitespace and normalize case
  const raw = hex.trim().toLowerCase();

  // Ensure 0x prefix
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;

  // Validate that what's left is 0x followed by 1+ hex digits
  if (!/^0x[0-9a-f]+$/.test(normalized)) {
    throw new Error(`hexToDecimalString: invalid hex string "${hex}"`);
  }

  const finalValue = BigInt(normalized).toString(10)

  // BigInt will correctly parse the 0x-prefixed hex
  return isNaN(Number(finalValue)) ? finalValue : Number(finalValue);
}

/**
 * Convert a hex string to a decimal-string or Wei-string if key includes "amount".
 */
export function normalizeHexField(key: string, hex: string): string {
  const n = BigInt(hex);
  if (key.toLowerCase().includes("amount")) {
    return (n * WEI_FACTOR).toString(10);
  }
  return n.toString(10);
}

/**
 * Serialize a decimal (number, string of digits, or bigint) to hex-with-0x.
 */
export function decimalToHex(value: number | string | bigint): string {
  return "0x" + BigInt(value).toString(16);
}

/**
 * Convert an Ether value (number, string, bigint) → Wei → hex-with-0x.
 */
export function etherToWeiHex(value: number | string | bigint): string {
  const wei = BigInt(value) * WEI_FACTOR;
  return "0x" + wei.toString(16);
}



/**
 * Walk and serialize all fields in TxParams for JSON-RPC
 */
export function serializeForRpc(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'number' || (/^[0-9]+$/.test(val as string))) {
      if (key === 'value' || key.toLowerCase().includes('amount')) {
        out[key] = etherToWeiHex(val);
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
 * Walk and normalize JSON-RPC response (hex → decimal or Wei)
 */
export function normalizeResponse(resp: Record<string, any>): Record<string, any> | any {
  const out: Record<string, any> = {};
  if (resp === null) return out;

  if (typeof resp == 'boolean') return resp;

  if (typeof resp === 'string') {
      return hexToDecimalString(resp);
  }

  if (Array.isArray(resp)) {
    return resp.map(v => (typeof v === 'object' ? normalizeResponse(v) : v));
  }

  for (const [key, val] of Object.entries(resp)) {
    if (typeof val === 'string' && val.startsWith('0x')) {
      // Leave address-like fields untouched
      if ([ 'address', 'hash', 'from', 'to' ].includes(key)) {
        out[key] = val;
      } else {
        out[key] = normalizeHexField(key, val);
      }
    } else if (Array.isArray(val)) {
      out[key] = val.map(v => (typeof v === 'object' ? normalizeResponse(v) : v));
    } else if (val && typeof val === 'object') {
      out[key] = normalizeResponse(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}