// src/utils.ts

// BigInt factor for converting Ether ↔ Wei (18 decimals)
const WEI_FACTOR = BigInt("1000000000000000000");
// BigInt factor for 9 decimal places (like some tokens)
const NINE_DECIMAL_FACTOR = BigInt("1000000000");

/**
 * Convert a hex string to a decimal representation (as string or number).
 * No extra multiplication: assumes input is already in base units (Wei or token base units).
 */
export function hexToDecimalString(hex: string): string | number {
  if (typeof hex !== 'string') {
    throw new TypeError(`hexToDecimalString: expected a string, got ${typeof hex}`);
  }

  // Trim whitespace and normalize case
  const raw = hex.trim().toLowerCase();

  // Special case: treat '0x' as zero
  if (raw === '0x') return 0;

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
 * Convert a hex string to a decimal-string (no extra multiplication).
 * Use for normalizing RPC response fields that are already in base units.
 */
export function normalizeHexField(key: string, hex: string): string {
  // Treat '0x' as zero
  if (hex === '0x') return '0';
  const n = BigInt(hex);
  // Do NOT multiply by NINE_DECIMAL_FACTOR or WEI_FACTOR here!
  // RPC responses are already in base units.
  return n.toString(10);
}

/**
 * Serialize a decimal (number, string of digits, or bigint) to hex-with-0x.
 * Assumes input is in base units (Wei or token base units).
 */
export function decimalToHex(value: number | string | bigint): string {
  return "0x" + BigInt(value).toString(16);
}

/**
 * Convert an Ether value (number, string, bigint) → Wei → hex-with-0x.
 * Use when input is in whole Ether and you need to send as Wei.
 */
export function etherToWeiHex(value: number | string | bigint): string {
  const wei = BigInt(value) * WEI_FACTOR;
  return "0x" + wei.toString(16);
}

/**
 * Convert a value to hex with 9 decimal places (like some tokens).
 * Use when input is in whole tokens and you need to send as base units.
 */
export function valueToNineDecimalHex(value: number | string | bigint): string {
  const scaled = BigInt(value) * NINE_DECIMAL_FACTOR;
  return "0x" + scaled.toString(16);
}

/**
 * Format a value with 9 decimal places (similar to ethers.utils.formatUnits).
 */
export function formatUnits(value: string | number | bigint, decimals: number = 9): string {
  const bigValue = BigInt(value);
  const factor = decimals === 9 ? NINE_DECIMAL_FACTOR : WEI_FACTOR;
  const result = Number(bigValue) / Number(factor);
  return result.toString();
}

/**
 * Walk and serialize all fields in TxParams for JSON-RPC
 * Only multiply by NINE_DECIMAL_FACTOR or WEI_FACTOR if input is in whole tokens/Ether.
 * If input is already in base units, just convert to hex.
 *
 * For this SDK, assume that for keys like 'value', 'amount', or 'balance',
 * the input is in whole tokens (for 9-decimal tokens) or Ether (for Ether transfers),
 * and needs to be converted to base units for the RPC.
 */
export function serializeForRpc(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'number' || (/^[0-9]+$/.test(val as string))) {
      if (key === 'value') {
        // For Ether, convert to Wei hex
        out[key] = etherToWeiHex(val);
      } else if (key.toLowerCase().includes('amount') || key.toLowerCase().includes('balance')) {
        // For 9-decimal tokens, convert to base units hex
        out[key] = valueToNineDecimalHex(val);
      } else {
        // For other numbers, just convert to hex
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
export function normalizeResponse(resp: Record<string, any> | any ): Record<string, any> | any {
  const out: Record<string, any> = {};

  if (resp === null) return out;

  if (typeof resp == 'boolean') return resp;

  if (typeof resp === 'string') {
    // If it's a likely hash/address, return as is
    if (/^0x[a-fA-F0-9]{40,}$/.test(resp)) return resp;
    return hexToDecimalString(resp);
  }

  if (Array.isArray(resp)) {
    return resp.map(v => (typeof v === 'object' ? normalizeResponse(v) : v));
  }

  for (const [key, val] of Object.entries(resp)) {
    if (typeof val === 'string' && val.startsWith('0x')) {
      // Leave address-like and hash-like fields untouched
      if ([ 'address', 'hash', 'from', 'to', 'transactionHash', 'blockHash', 'contractAddress' ].includes(key)) {
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

/**
 * Checks if a string is a valid Ethereum/EVM address (basic format: 0x + 40 hex chars).
 * @param address The address string to validate.
 * @returns true if valid, false otherwise.
 */
export function isValidAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  // Must start with 0x and be exactly 42 chars
  if (!address.startsWith('0x') || address.length !== 42) return false;
  // Must be all hex digits after 0x
  return /^[0-9a-fA-F]{40}$/.test(address.slice(2));
}