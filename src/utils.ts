// src/utils.ts
import { sha3_512, keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';

// Ensure BigInt is available (polyfill check)
if (typeof BigInt === 'undefined') {
  throw new Error('BigInt is not supported in this environment. Please use a polyfill or upgrade your JavaScript engine.');
}

// Check for BigInt ** operator support
let BIGINT_EXPONENTIATION_SUPPORTED = true;
try {
  BigInt(2) ** BigInt(3);
} catch (error) {
  BIGINT_EXPONENTIATION_SUPPORTED = false;
}

// Generic base for decimal handling
const TEN = BigInt(10);
// Default number of decimals (e.g., for Ether or NEC token)
export const DEFAULT_DECIMALS = 18;
// NEC token decimals (replace if different)
export const NEC_DECIMALS = 18;

// Safe BigInt exponentiation function to handle browser compatibility issues
function safeBigIntPow(base: bigint, exponent: bigint): bigint {
  if (BIGINT_EXPONENTIATION_SUPPORTED) {
    try {
      return base ** exponent;
    } catch (error) {
      // Fall through to manual implementation
    }
  }

  // Manual implementation for browsers that don't support BigInt ** operator
  if (exponent === BigInt(0)) return BigInt(1);
  if (exponent === BigInt(1)) return base;
  if (exponent < BigInt(0)) {
    throw new Error('Negative exponents not supported for BigInt');
  }

  let result = BigInt(1);
  let currentBase = base;
  let currentExponent = exponent;

  while (currentExponent > BigInt(0)) {
    if (currentExponent % BigInt(2) === BigInt(1)) {
      result = result * currentBase;
    }
    currentBase = currentBase * currentBase;
    currentExponent = currentExponent / BigInt(2);
  }

  return result;
}

// BigInt factor for converting whole units ↔ base units
export const WEI_FACTOR = safeBigIntPow(TEN, BigInt(18));

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
  if (normalized === '0x0') return 0; // handle zero case
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

  if (!value) return '' as any; // handle null/undefined gracefully

  if (value?.toString()?.startsWith('0x')) {
    return value as string; // already hex  
  }
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

  if (str?.startsWith('0x')) {
    return str; // already hex
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

  const factor = decimals === DEFAULT_DECIMALS ? WEI_FACTOR : safeBigIntPow(TEN, BigInt(Number(decimals)));
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
  const factor = decimals === DEFAULT_DECIMALS ? WEI_FACTOR : safeBigIntPow(TEN, BigInt(Number(decimals)));
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
    if (typeof val === 'number' || (/^([0-9]*\.?[0-9]+)$/.test(val as string))) {
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
        /^0x[0-9a-fA-F]{64}$/.test(val) || // 32-byte hash
        /^0x[0-9a-fA-F]{40}$/.test(val)  // 20-byte address
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

/**
 * Convert a decimal Ether value (number|string|bigint) to a Wei value as a string (base 10, not hex).
 * E.g., 1.23 -> '1230000000000000000'
 */
export function decimalToWei(
  value: number | string | bigint,
  decimals: number = DEFAULT_DECIMALS
): string {
  // Use parseUnits to get the hex, then convert to BigInt and return as string
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
    const str = value.toString();
    const hex = parseUnits(str, decimals); // returns hex string
    return BigInt(hex).toString(10);
  }
  throw new Error('decimalToWei: invalid value');
}

/**
 * Extract a Kyber public key (ek) from a secret key (dk) hex string.
 * If input already appears to be a public key (800/1184/1568 bytes), it is returned as-is.
 * Returns a lowercase hex string without 0x prefix.
 */
export function kyberPrivateKeyToEncryptedPublicKeyAddress(skHex: string): string {
  if (!skHex || !skHex.trim()) {
    throw new Error('Kyber key is required');
  }

  const hex = skHex.startsWith('0x') ? skHex.slice(2) : skHex;
  const bytes = hexToUint8Array(hex);
  const len = bytes.length;

  // Already a public key? Return as hex
  if (len === 800 || len === 1184 || len === 1568) {
    return toHexString(bytes);
  }

  // Map secret key lengths to parameter k
  const kByLen: Record<number, number> = { 1632: 2, 2400: 3, 3168: 4 };
  const k = kByLen[len];
  if (!k) {
    throw new Error(`Unsupported Kyber secret key length: ${len}`);
  }

  const ekOffset = 384 * k;      // byte offset where ek starts
  const ekLen = 384 * k + 32;    // length of ek
  const ek = bytes.slice(ekOffset, ekOffset + ekLen);
  return toHexString(ek);
}

/**
 * @deprecated Removed from the public API in v2 and NOT interoperable with the node. This derives an
 * address from an ML-KEM (Kyber) ENCAPSULATION key via a scheme (sha3_512 of a hex string) the chain
 * never uses — the node's account address is keccak256(rawMLDSApubkeyBytes)[12:] (see
 * tx-signer.publicKeyToAddress / privateKeyToAddress). A Kyber key is an encryption key, not an account
 * key. Do not use for any on-chain identity.
 */
export function kyberPrivateKeyToPublicKeyAddress(skHex: string): string {
  const ek = kyberPrivateKeyToEncryptedPublicKeyAddress(skHex);
  return generateAccountAddress(ek);
}

function generateWalletAddress(publicKey: string): string {
  const uint8PublicKey = hexToUint8Array(publicKey);
  const hash = keccak_256(uint8PublicKey);
  const addrBuf = hash.slice(12);
  return '0x' + bytesToHex(addrBuf);
}

export function mldsaPublicKeyToAddress(publicKey: string): string {
  return generateWalletAddress(publicKey);
}

/**
 * @deprecated NOT interoperable with the node. This signs the RAW message bytes (no EIP-191 prefix, no
 * keccak), so the resulting signature will NOT verify via the node's personal_verifyMessage. Use
 * signPersonalMessageMLDSA (and verifyPersonalMessageMLDSA) when the signature must be checkable on-chain
 * or by the node. Dropped from the public index exports in v2; retained here only for backward source use.
 *
 * Sign a message using MLDSA with a private key.
 * @param message - The message to sign
 * @param privateKey - The private key to sign with (hex string)
 * @param algorithm - The MLDSA algorithm to use ('ml_dsa44', 'ml_dsa65', or 'ml_dsa87')
 * @returns Promise<string> - The signature as a hex string
 */
export async function signMessageMLDSA(
  message: string,
  privateKey: string,
  algorithm: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87' = 'ml_dsa87'
): Promise<string> {
  try {
    // Import the noble-post-quantum library
    // @ts-ignore - noble-post-quantum.js is a bundled JS file without TypeScript declarations
    const noblePQ = await import('./noble-post-quantum.js') as any;
    const algorithms = noblePQ.default || noblePQ;

    // Get the MLDSA algorithm
    const mldsa = algorithms[algorithm];
    if (!mldsa) {
      throw new Error(`Unsupported MLDSA algorithm: ${algorithm}`);
    }

    // Convert hex private key to Uint8Array
    const privateKeyBytes = hexToUint8Array(privateKey);

    // Convert message to Uint8Array
    const messageBytes = new TextEncoder().encode(message);

    // Sign the message
    const signature = mldsa.sign(privateKeyBytes, messageBytes);

    // Convert signature to hex string
    return toHexString(signature);
  } catch (error) {
    console.error('Error signing message with MLDSA:', error);
    throw error;
  }
}

/**
 * @deprecated Counterpart to the deprecated signMessageMLDSA — verifies a RAW-bytes signature (no
 * EIP-191 prefix) and is therefore NOT interoperable with node personal_sign output. Use
 * verifyPersonalMessageMLDSA instead. Dropped from the public index exports in v2.
 *
 * Verify an MLDSA signature against a message and public key.
 * @param message - The original message that was signed
 * @param signature - The MLDSA signature (hex string)
 * @param publicKey - The public key to verify against (hex string)
 * @param algorithm - The MLDSA algorithm to use ('ml_dsa44', 'ml_dsa65', or 'ml_dsa87')
 * @returns Promise<boolean> - True if signature is valid, false otherwise
 */
export async function verifyMLDSASignature(
  message: string,
  signature: string,
  publicKey: string,
  algorithm: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87' = 'ml_dsa87'
): Promise<boolean> {
  try {
    // Import the noble-post-quantum library
    // @ts-ignore - noble-post-quantum.js is a bundled JS file without TypeScript declarations
    const noblePQ = await import('./noble-post-quantum.js') as any;
    const algorithms = noblePQ.default || noblePQ;

    // Get the MLDSA algorithm
    const mldsa = algorithms[algorithm];
    if (!mldsa) {
      throw new Error(`Unsupported MLDSA algorithm: ${algorithm}`);
    }

    // Convert hex strings to Uint8Arrays
    const publicKeyBytes = hexToUint8Array(publicKey);
    const signatureBytes = hexToUint8Array(signature);
    const messageBytes = new TextEncoder().encode(message);

    // Verify the signature
    return mldsa.verify(publicKeyBytes, messageBytes, signatureBytes);
  } catch (error) {
    console.error('Error verifying MLDSA signature:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// EIP-191 personal-message signing — interoperable with the node's personal_sign /
// personal_verifyMessage. The node verifies over accounts.TextHash(data):
//   keccak256("\x19Ethereum Signed Message:\n" + len(dataBytes) + dataBytes)
// NOTE: signMessageMLDSA / verifyMLDSASignature above sign the RAW message bytes (no prefix, no keccak)
// and are therefore NOT interoperable with the node's personal_verifyMessage — use the *Personal*
// variants below when the signature must be verifiable on-chain / by the node.
// ---------------------------------------------------------------------------

// personalTextHash resolves `message` to bytes (Uint8Array as-is, 0x-hex decoded, else utf-8) and returns
// the EIP-191 TextHash — the exact 32-byte digest the node's personal_verifyMessage checks against.
export function personalTextHash(message: string | Uint8Array): Uint8Array {
  let msg: Uint8Array;
  if (message instanceof Uint8Array) {
    msg = message;
  } else if (typeof message === 'string' && /^0x[0-9a-fA-F]*$/.test(message)) {
    msg = hexToUint8Array(message);
  } else {
    msg = new TextEncoder().encode(message);
  }
  const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n' + msg.length);
  const buf = new Uint8Array(prefix.length + msg.length);
  buf.set(prefix, 0);
  buf.set(msg, prefix.length);
  return keccak_256(buf);
}

/**
 * Sign a personal message with ML-DSA-87 using the EIP-191 digest the node verifies against.
 * The resulting signature is verifiable via the node's personal_verifyMessage(data, sig, pubkey).
 * @param message - utf-8 string, 0x-hex, or raw bytes (matched to how the node received `data`).
 * @param privateKey - bare-hex ML-DSA private key (no 0x prefix).
 * @returns the signature as BARE hex (no 0x prefix) — pass it (and a bare-hex public key) straight to
 *   verifyPersonalMessageMLDSA. Note: this is not the 0x-prefixed convention used elsewhere in the SDK.
 */
export async function signPersonalMessageMLDSA(
  message: string | Uint8Array,
  privateKey: string,
  algorithm: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87' = 'ml_dsa87'
): Promise<string> {
  // @ts-ignore - bundled JS without types
  const noblePQ = await import('./noble-post-quantum.js') as any;
  const mldsa = (noblePQ.default || noblePQ)[algorithm];
  if (!mldsa) throw new Error(`Unsupported MLDSA algorithm: ${algorithm}`);
  const sig = mldsa.sign(hexToUint8Array(privateKey), personalTextHash(message));
  return toHexString(sig);
}

/**
 * Verify a personal-message ML-DSA-87 signature over the EIP-191 digest (node-compatible).
 * @param signature - BARE hex signature (no 0x prefix), as returned by signPersonalMessageMLDSA.
 * @param publicKey - BARE hex raw ML-DSA-87 public key (no 0x prefix).
 * @returns true iff the signature verifies against the message + public key.
 */
export async function verifyPersonalMessageMLDSA(
  message: string | Uint8Array,
  signature: string,
  publicKey: string,
  algorithm: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87' = 'ml_dsa87'
): Promise<boolean> {
  try {
    // @ts-ignore - bundled JS without types
    const noblePQ = await import('./noble-post-quantum.js') as any;
    const mldsa = (noblePQ.default || noblePQ)[algorithm];
    if (!mldsa) throw new Error(`Unsupported MLDSA algorithm: ${algorithm}`);
    return mldsa.verify(hexToUint8Array(publicKey), personalTextHash(message), hexToUint8Array(signature));
  } catch {
    return false;
  }
}

/**
 * Generate a new MLDSA key pair.
 * @param algorithm - The MLDSA algorithm to use ('ml_dsa44', 'ml_dsa65', or 'ml_dsa87')
 * @returns Promise<{publicKey: string, privateKey: string}> - The key pair as hex strings
 */
export async function generateMLDSAKeyPair(
  algorithm: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87' = 'ml_dsa87'
): Promise<{ publicKey: string, privateKey: string }> {
  try {
    // Import the noble-post-quantum library
    // @ts-ignore - noble-post-quantum.js is a bundled JS file without TypeScript declarations
    const noblePQ = await import('./noble-post-quantum.js') as any;
    const algorithms = noblePQ.default || noblePQ;

    // Get the MLDSA algorithm
    const mldsa = algorithms[algorithm];
    if (!mldsa) {
      throw new Error(`Unsupported MLDSA algorithm: ${algorithm}`);
    }

    // Generate key pair
    const keyPair = mldsa.keygen();

    // Convert to hex strings
    return {
      publicKey: toHexString(keyPair.publicKey),
      privateKey: toHexString(keyPair.secretKey)
    };
  } catch (error) {
    console.error('Error generating MLDSA key pair:', error);
    throw error;
  }
}

/**
 * Derive or validate an MLDSA public key from a provided key hex.
 * - If the provided hex already looks like a public key for the given algorithm, it is returned (lowercase, no 0x).
 * - If it looks like a secret key for the given algorithm, deriving the public key is not supported by the
 *   current bundled API. In this case, an error is thrown with guidance to persist the public key at keygen time.
 *
 * Note: MLDSA secret keys (Dilithium) in this bundle do not embed the public key; reconstructing requires internal
 * primitives that are not exported. Persist the `publicKey` from `generateMLDSAKeyPair` alongside the `privateKey`.
 */
export async function mldsaPrivateKeyToPublicKey(
  keyHex: string,
  algorithm: 'ml_dsa44' | 'ml_dsa65' | 'ml_dsa87' = 'ml_dsa87'
): Promise<string> {
  if (!keyHex || !keyHex.trim()) throw new Error('mldsaPrivateKeyToPublicKey: key is required');
  const hex = keyHex.startsWith('0x') ? keyHex.slice(2) : keyHex;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('mldsaPrivateKeyToPublicKey: invalid hex');
  }

  // Known MLDSA (Dilithium) key lengths (bytes) for common modes
  const PUBLIC_KEY_LENGTHS: Record<typeof algorithm, number> = {
    ml_dsa44: 1312, // Dilithium2
    ml_dsa65: 1952, // Dilithium3
    ml_dsa87: 2592  // Dilithium5
  } as const;
  const SECRET_KEY_LENGTHS: Record<typeof algorithm, number> = {
    // Lengths reflect this bundle's encoding (TR_BYTES = 64), which differ from some specs
    ml_dsa44: 2560, // Dilithium2
    ml_dsa65: 4032, // Dilithium3
    ml_dsa87: 4896  // Dilithium5
  } as const;

  const byteLen = hex.length / 2;
  if (byteLen === PUBLIC_KEY_LENGTHS[algorithm]) {
    return hex;
  }
  if (byteLen === SECRET_KEY_LENGTHS[algorithm]) {
    // Try deriving via non-standard helper exposed by bundled implementation
    // @ts-ignore - bundled JS without types
    const noblePQ = await import('./noble-post-quantum.js') as any;
    const algorithms = noblePQ.default || noblePQ;
    const mldsa = algorithms[algorithm];
    if (!mldsa || typeof mldsa.derivePublicKey !== 'function') {
      throw new Error('mldsaPrivateKeyToPublicKey: derivation not available in bundled implementation');
    }
    const sk = hexToUint8Array(hex);
    const pkBytes = mldsa.derivePublicKey(sk);
    const pkHex = toHexString(pkBytes);
    return pkHex;
  }

  throw new Error(
    `mldsaPrivateKeyToPublicKey: unexpected key length (${byteLen} bytes) for ${algorithm}. ` +
    'Provide a valid MLDSA public key or the original keypair output.'
  );
}

function generateAccountAddress(publicKey: string): string {
  try {
    const hash = sha3_512(new TextEncoder().encode(publicKey));
    const hashHex = bytesToHex(hash);
    const accountAddress = `0x${hashHex.slice(-40)}`;
    return accountAddress;
  } catch (error) {
    console.error('Error generating account address:', error);
    return '';
  }
}

// Local helpers for hex/bytes without Node Buffer dependency
function hexToUint8Array(hexString: string): Uint8Array {
  const normalized = hexString.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid hexadecimal string');
  }
  const result = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    result[i / 2] = parseInt(normalized.substr(i, 2), 16);
  }
  return result;
}

function toHexString(byteArray: Uint8Array): string {
  return Array.from(byteArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
