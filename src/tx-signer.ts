// src/tx-signer.ts
//
// Native-JS (WASM-free) ML-DSA-87 transaction signer for NCOG Earth Chain.
// This replaces the Go WASM `signTransactionMLDSA87` / `privateKeyToAddress` /
// `decodeRLPTransaction` functions. It is a faithful port of the chain's Go
// reference implementation (ethapi.SignTransaction + types.SigningHash +
// types.LegacyTx), verified byte-for-byte against those sources.
//
// Authoritative SigVersion-v2 format (do not change without re-checking the chain code:
// types.SigningHash + types.LegacyTx + ethapi.SignTransaction):
//   from           = keccak256( rawPubkeyBytes )[12:]           // 20-byte sender address
//   sigVer         = 2                                          // ML-DSA-87, unrotated
//   signing digest = keccak256( RLP([ sigVer, from, nonce, gasPrice, gas, to, value, data, chainId ]) )
//                    (sigVer + from LEAD, chainId LAST; legacy Keccak-256)
//   signature      = ml_dsa87.sign(secretKey, digest)   // msg IS the 32-byte digest, empty context
//   raw tx         = RLP([ nonce, gasPrice, gas, to, value, data,
//                          sig(raw bytes), pubKey(RAW marshaled ~2592 B), chainId, from, sigVer ])
//                    (from + sigVer TRAIL, matching the LegacyTx struct wire order)
//   address        = keccak256( rawPubkeyBytes )[12:]

import { keccak_256 } from '@noble/hashes/sha3';

// ---------------------------------------------------------------------------
// bundled ML-DSA-87 (noble-post-quantum) loader
// ---------------------------------------------------------------------------
let _mldsa: any = null;
async function getMldsa(): Promise<any> {
  if (!_mldsa) {
    // @ts-ignore - noble-post-quantum.js is a bundled JS file without types
    const mod = await import('./noble-post-quantum.js');
    const algorithms = (mod as any).default || mod;
    _mldsa = algorithms.ml_dsa87;
    if (!_mldsa) throw new Error('ml_dsa87 not available in bundled noble-post-quantum');
  }
  return _mldsa;
}

// ---------------------------------------------------------------------------
// hex / byte helpers
// ---------------------------------------------------------------------------
function stripHex(hex: string): string {
  const s = (hex || '').trim();
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

function hexToBytes(hex: string): Uint8Array {
  let h = stripHex(hex).toLowerCase();
  if (h.length % 2 === 1) h = '0' + h;
  if (h.length > 0 && !/^[0-9a-f]+$/.test(h)) {
    throw new Error('invalid hex string');
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// Parse a tx field into a BigInt. Accepts number, bigint, decimal string, or
// 0x-hex string. Empty / '0x' / null => 0.
function toBig(v: any): bigint {
  if (v === undefined || v === null) return BigInt(0);
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s === '0x' || s === '0X') return BigInt(0);
    return BigInt(s); // BigInt() handles both '0x..' and decimal
  }
  return BigInt(v);
}

// Minimal big-endian byte encoding of a non-negative integer (RLP convention:
// no leading zero bytes; 0 encodes as the empty byte string).
function intToMinimalBytes(v: bigint): Uint8Array {
  if (v < BigInt(0)) throw new Error('negative integer not allowed in tx field');
  if (v === BigInt(0)) return new Uint8Array(0);
  let hex = v.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  return hexToBytes(hex);
}

// ---------------------------------------------------------------------------
// minimal RLP encoder (Ethereum Recursive Length Prefix)
// ---------------------------------------------------------------------------
type RlpInput = Uint8Array | RlpInput[];

function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) {
    return Uint8Array.of(offset + len);
  }
  let hex = len.toString(16);
  if (hex.length % 2 === 1) hex = '0' + hex;
  const lenBytes = hexToBytes(hex);
  return concatBytes(Uint8Array.of(offset + 55 + lenBytes.length), lenBytes);
}

function rlpEncode(input: RlpInput): Uint8Array {
  if (input instanceof Uint8Array) {
    // single byte in [0x00, 0x7f] is its own encoding
    if (input.length === 1 && input[0] < 0x80) return input;
    return concatBytes(encodeLength(input.length, 0x80), input);
  }
  // list
  const items = input.map(rlpEncode);
  const body = concatBytes(...items);
  return concatBytes(encodeLength(body.length, 0xc0), body);
}

// ---------------------------------------------------------------------------
// minimal RLP decoder (returns nested Uint8Array structure)
// ---------------------------------------------------------------------------
type RlpTree = Uint8Array | RlpTree[];

function rlpDecode(data: Uint8Array): RlpTree {
  const [item, rest] = decodeItem(data, 0);
  if (rest !== data.length) throw new Error('rlp: trailing bytes after top-level item');
  return item;
}

function decodeItem(data: Uint8Array, pos: number): [RlpTree, number] {
  if (pos >= data.length) throw new Error('rlp: unexpected end of input');
  const b = data[pos];
  if (b <= 0x7f) {
    return [data.slice(pos, pos + 1), pos + 1];
  }
  if (b <= 0xb7) {
    const len = b - 0x80;
    const start = pos + 1;
    return [data.slice(start, start + len), start + len];
  }
  if (b <= 0xbf) {
    const lenOfLen = b - 0xb7;
    const len = readLen(data, pos + 1, lenOfLen);
    const start = pos + 1 + lenOfLen;
    return [data.slice(start, start + len), start + len];
  }
  if (b <= 0xf7) {
    const len = b - 0xc0;
    const start = pos + 1;
    return decodeList(data, start, len);
  }
  const lenOfLen = b - 0xf7;
  const len = readLen(data, pos + 1, lenOfLen);
  const start = pos + 1 + lenOfLen;
  return decodeList(data, start, len);
}

function readLen(data: Uint8Array, pos: number, lenOfLen: number): number {
  let len = 0;
  for (let i = 0; i < lenOfLen; i++) len = len * 256 + data[pos + i];
  return len;
}

function decodeList(data: Uint8Array, start: number, len: number): [RlpTree, number] {
  const end = start + len;
  const items: RlpTree[] = [];
  let p = start;
  while (p < end) {
    const [item, next] = decodeItem(data, p);
    items.push(item);
    p = next;
  }
  if (p !== end) throw new Error('rlp: list length mismatch');
  return [items, end];
}

// ---------------------------------------------------------------------------
// field helpers
// ---------------------------------------------------------------------------
function toAddressBytes(to: any): Uint8Array {
  if (to === undefined || to === null || to === '' || to === '0x') {
    return new Uint8Array(0); // contract creation
  }
  const b = hexToBytes(to);
  if (b.length !== 20) throw new Error(`invalid "to" address length: ${b.length} (expected 20)`);
  return b;
}

function toDataBytes(data: any): Uint8Array {
  if (data === undefined || data === null || data === '' || data === '0x') {
    return new Uint8Array(0);
  }
  return hexToBytes(data);
}

// ---------------------------------------------------------------------------
// public API (mirrors the Go WASM functions)
// ---------------------------------------------------------------------------
export interface SignedTx {
  raw: string;              // 0x-prefixed raw signed tx (for eth_sendRawTransaction)
  rawTransaction: string;   // alias
  hash: string;             // 0x tx hash = keccak256(rawTxBytes)
  publicKey: string;        // 0x-prefixed ML-DSA public key hex
  signature: string;        // 0x-prefixed signature hex
}

// The scheme version emitted for a normal (unrotated) ML-DSA-87 signer. Matches types.SigVerMLDsaV2.
export const SIGVER_MLDSA_V2 = 2;
// The scheme version a ROTATED (or guardian-recovered) account must declare. Matches
// types.SigVerRotated. Its signing key no longer hashes to the account address, so attribution goes
// through the on-chain key registry: Sender() returns the claimed From, and execution's preCheck
// (vm.EnforceKeyHash) proves keccak(pubkey) is that account's REGISTERED current key.
export const SIGVER_ROTATED = 3;

export interface SignOptions {
  // Optional: supply the public key to skip re-deriving it from the secret key.
  publicKeyHex?: string;
  /**
   * Claimed sender. Defaults to keccak256(rawPubkey)[12:], which is correct ONLY while the account
   * has not rotated its key. After a rotation or a guardian recovery the account keeps its ORIGINAL
   * address and the key no longer derives it (Model B) -- pass that stable address here, or every
   * transaction is signed as a different, empty account.
   */
  from?: string;
  /**
   * Signature-scheme version. Defaults to 2, or to 3 when `from` is supplied and differs from the
   * derived address. Note that SigVer is NOT an authorization input on the node: declaring 3 on an
   * unrotated account still has to satisfy the legacy keccak binding, so this cannot be abused.
   */
  sigVer?: number;
}

/**
 * Sign an NCOG transaction with ML-DSA-87 in the SigVersion-v2 wire format,
 * byte-compatible with the chain's ethapi.SignTransaction + types.SigningHash.
 * `txParams.chainId` is mandatory and must match the target node's eth_chainId.
 */
export async function signTransactionMLDSA87(
  txParams: any,
  privateKeyHex: string,
  options: SignOptions = {}
): Promise<SignedTx> {
  const mldsa = await getMldsa();

  const nonce = intToMinimalBytes(toBig(txParams.nonce));
  const gasPrice = intToMinimalBytes(toBig(txParams.gasPrice));
  const gas = intToMinimalBytes(toBig(txParams.gas ?? txParams.gasLimit));
  const toBytes = toAddressBytes(txParams.to);
  const value = intToMinimalBytes(toBig(txParams.value));
  const dataBytes = toDataBytes(txParams.data);
  // chainId is mandatory in v2 (it is bound into the signing digest for replay protection). chainId 0
  // is never valid on NCOG; the SDK's Wallet/Signer flows auto-fetch eth_chainId, but a direct caller
  // must supply it.
  if (toBig(txParams.chainId) === BigInt(0)) {
    throw new Error('txParams.chainId is required — fetch it via eth_chainId (Provider.getChainId)');
  }
  const chainId = intToMinimalBytes(toBig(txParams.chainId));

  // public key (RAW marshaled bytes — the upgraded node rejects the legacy hex form). Needed BEFORE the
  // digest because v2 binds the sender address into the signing preimage.
  const sk = hexToBytes(privateKeyHex);
  const pubBytes: Uint8Array = options.publicKeyHex ? hexToBytes(options.publicKeyHex) : mldsa.derivePublicKey(sk);
  const pubKeyHex = bytesToHex(pubBytes);

  // v2 sender + scheme version. Default (unrotated): from = keccak256(rawPubkey)[12:], sigVer = 2.
  // Rotated account (Model B): the caller supplies the account's STABLE address, and the version
  // defaults to 3 because the key no longer derives that address.
  const derivedFrom: Uint8Array = keccak_256(pubBytes).slice(12);
  let from: Uint8Array = derivedFrom;
  if (options.from !== undefined && options.from !== null && options.from !== '') {
    from = hexToBytes(options.from);
    if (from.length !== 20) {
      throw new Error(`invalid "from" address length: ${from.length} (expected 20)`);
    }
  }
  const derivedMatches = bytesToHex(from) === bytesToHex(derivedFrom);
  const sigVerNum = options.sigVer ?? (derivedMatches ? SIGVER_MLDSA_V2 : SIGVER_ROTATED);
  if (!Number.isInteger(sigVerNum) || sigVerNum < SIGVER_MLDSA_V2 || sigVerNum > 255) {
    // The node's Sender() rejects anything below SigVerMLDsaV2 outright.
    throw new Error(`invalid sigVer ${sigVerNum}: must be an integer >= ${SIGVER_MLDSA_V2}`);
  }
  const sigVer = intToMinimalBytes(BigInt(sigVerNum)); // [0x02] or [0x03]

  // 1. signing digest = keccak256(RLP([sigVer, from, nonce, gasPrice, gas, to, value, data, chainId])).
  //    SigVer + from LEAD (bound by the signature); chainId last. MUST match types.SigningHash.
  const unsigned: Uint8Array[] = [sigVer, from, nonce, gasPrice, gas, toBytes, value, dataBytes, chainId];
  const digest = keccak_256(rlpEncode(unsigned));

  // 2. sign the 32-byte digest directly (empty context)
  const sig: Uint8Array = mldsa.sign(sk, digest);

  // 3. full signed tx = RLP([nonce, gasPrice, gas, to, value, data, sig, pubKey, chainId, from, sigVer]).
  //    From + SigVer trail (matching the LegacyTx struct wire order).
  const signed: Uint8Array[] = [nonce, gasPrice, gas, toBytes, value, dataBytes, sig, pubBytes, chainId, from, sigVer];
  const rawBytes = rlpEncode(signed);
  const rawHex = '0x' + bytesToHex(rawBytes);
  const txHash = '0x' + bytesToHex(keccak_256(rawBytes));

  return {
    raw: rawHex,
    rawTransaction: rawHex,
    hash: txHash,
    publicKey: '0x' + pubKeyHex,
    signature: '0x' + bytesToHex(sig),
  };
}

/**
 * Sign a transaction for a ROTATED (or guardian-recovered) account.
 *
 * Model B keeps the ADDRESS and replaces the KEY, so after a rotation the signing key derives a
 * DIFFERENT address than the account's. `accountAddress` must be the account's original, stable
 * address -- the one that holds the balance. Signing such an account with plain
 * `signTransactionMLDSA87` produces a transaction from an unrelated empty address, which is how a
 * client silently destroys an account it thought it had rotated.
 *
 * The node accepts this only if the registry says so: preCheck runs vm.EnforceKeyHash, which
 * requires keccak256(rawPubkey) === the account's registered currentKeyHash. Confirm the rotation
 * landed (readKeyRegistry) before relying on this path.
 */
export function signRotatedTransactionMLDSA87(
  txParams: any,
  privateKeyHex: string,
  accountAddress: string,
  options: SignOptions = {},
): Promise<SignedTx> {
  return signTransactionMLDSA87(txParams, privateKeyHex, {
    ...options,
    from: accountAddress,
    sigVer: options.sigVer ?? SIGVER_ROTATED,
  });
}

/**
 * Derive the EVM-style address from an ML-DSA-87 private key:
 * address = keccak256(rawPubkeyBytes)[12:].
 */
export async function privateKeyToAddress(privateKeyHex: string): Promise<string> {
  const mldsa = await getMldsa();
  const sk = hexToBytes(privateKeyHex);
  const pubBytes: Uint8Array = mldsa.derivePublicKey(sk);
  return publicKeyToAddress(pubBytes);
}

/** address = keccak256(rawPubkeyBytes)[12:] from a raw public key (bytes or hex). */
export function publicKeyToAddress(publicKey: Uint8Array | string): string {
  const pub = publicKey instanceof Uint8Array ? publicKey : hexToBytes(publicKey);
  const hash = keccak_256(pub);
  return '0x' + bytesToHex(hash.slice(12));
}

// An ML-DSA-87 public key marshals to exactly 2592 bytes — the discriminator between the upgraded
// raw-bytes pubkey field and the legacy 5184-byte hex-ASCII string.
const MLDSA87_PUBKEY_BYTES = 2592;

// decodePubKeyField normalizes the on-wire pubkey field to a lowercase hex string, accepting BOTH the
// upgraded raw-bytes encoding and the legacy hex-ASCII string.
function decodePubKeyField(field: Uint8Array): string {
  if (field.length === MLDSA87_PUBKEY_BYTES) return bytesToHex(field); // raw bytes (upgraded format)
  const s = new TextDecoder().decode(field);                           // legacy: ASCII hex string
  if (/^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0) return s.toLowerCase();
  return bytesToHex(field); // unexpected — treat as raw
}

/**
 * Decode a raw ML-DSA-87 SigVersion-v2 legacy transaction (0x-hex) back into its fields.
 * Mirrors the chain's 11-field LegacyTx wire layout:
 *   [ nonce, gasPrice, gas, to, value, data, signature, pubKey, chainId, from, sigVer ]
 */
export function decodeRLPTransaction(rawHex: string): any {
  const bytes = hexToBytes(rawHex);
  const tree = rlpDecode(bytes);
  if (!Array.isArray(tree)) throw new Error('decodeRLPTransaction: not a list');
  const f = tree as Uint8Array[];
  if (f.length !== 11) {
    throw new Error(`decodeRLPTransaction: expected 11 SigV2 fields, got ${f.length}`);
  }
  const toBytes = f[3];
  const toBig2 = (b: Uint8Array) => (b.length ? BigInt('0x' + bytesToHex(b)) : BigInt(0));
  const fromBytes = f[9];
  const out: any = {
    nonce: toBig2(f[0]).toString(),
    gasPrice: '0x' + bytesToHex(f[1]),
    gas: toBig2(f[2]).toString(),
    to: toBytes.length ? '0x' + bytesToHex(toBytes) : null,
    value: '0x' + bytesToHex(f[4]),
    data: '0x' + bytesToHex(f[5]),
    signature: '0x' + bytesToHex(f[6]),
    // pubKey is the RAW marshaled ML-DSA-87 bytes (exactly 2592). decodePubKeyField normalizes to hex.
    publicKey: '0x' + decodePubKeyField(f[7]),
    chainId: toBig2(f[8]).toString(),
    from: fromBytes.length ? '0x' + bytesToHex(fromBytes) : null,
    sigVer: toBig2(f[10]).toString(),
    hash: '0x' + bytesToHex(keccak_256(bytes)),
  };
  return out;
}

// Exposed for unit testing.
export const __test = { rlpEncode, rlpDecode, intToMinimalBytes, hexToBytes, bytesToHex, toBig };
