import { keccak_256 } from '@noble/hashes/sha3';
import type { DdbSigner } from './ddb';

/**
 * PLACE-02 capability tokens (NEC-93; owner ruling 35 (3): Q5 (a) wallet-signed, short-lived, checked against the
 * role assignments at EVERY use; Q8 (a) the lifetime bound is the EndpointDirectory's Timelock setter, [60 s, 3600 s],
 * default 600 s).
 *
 * A token lets one caller READ one contract's database under one role at the hosts of one group for a few minutes
 * without signing every request (`ddb_tokenSelect`). It never authorises a write. The caller signs, with its ML-DSA-87
 * account key and through the raw-hash path (`DdbSigner.signDdbHash`, never EIP-191 / personal_sign), keccak256 of:
 *
 *   "NEC-DDB-CAP\x01"          12 bytes
 *   chainId                    32 bytes, big-endian
 *   contract                   20 bytes
 *   u32be(len(role)) || role   the canonical role: lower-case, trimmed (ddbschema.NormalizeRoleName)
 *   caller                     20 bytes: keccak256(rawMLDSAPublicKey)[12:]
 *   u64be(groupVersion)        the sealed epoch the caller resolved (ddb_resolveDatabase `epoch`)
 *   u64be(issuedAt), u64be(expiry), u64be(nonce)
 *
 * The node pins the same golden vector (ethapi TestCapabilityTokenGoldenVector; tests/ddb-capability.test.ts).
 * A wallet stamps issuedAt and expiry AT APPROVAL (buildDdbCapabilityToken does so when called), so an approval left
 * open does not yield a dead token.
 */

export const DDB_CAPABILITY_DOMAIN = 'NEC-DDB-CAP\x01';
/** The contract's bounds on the lifetime bound itself; a host enforces the CURRENT bound read at its sealed root. */
export const DDB_TOKEN_LIFETIME_MIN = 60;
export const DDB_TOKEN_LIFETIME_MAX = 3600;
export const DDB_TOKEN_LIFETIME_DEFAULT = 600;

type Uintish = number | bigint | string;

export interface DdbCapabilityFields {
  chainId: Uintish;
  contract: string;
  role: string;
  caller: string;
  groupVersion: Uintish;
  issuedAt: Uintish;
  expiry: Uintish;
  nonce: Uintish;
}

/** A token as ddb_tokenSelect takes it (ethapi DdbCapabilityToken): quantities hex, bytes 0x-hex. */
export interface DdbCapabilityToken {
  chainId: string;
  contract: string;
  role: string;
  caller: string;
  groupVersion: string;
  issuedAt: string;
  expiry: string;
  nonce: string;
  callerPubKey: string;
  signature: string;
}

const B0 = BigInt(0), B8 = BigInt(8), BFF = BigInt(0xff);

function toBig(v: Uintish): bigint {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  if (b < B0) throw new Error('negative quantity');
  return b;
}

function be(v: bigint, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = v;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = Number(x & BFF);
    x >>= B8;
  }
  if (x !== B0) throw new Error(`quantity does not fit ${n} bytes`);
  return out;
}

function addr(a: string): Uint8Array {
  const s = a.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(s)) throw new Error(`not an address: ${a}`);
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

const hex = (b: Uint8Array) => '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The canonical role: lower-cased and trimmed (ddbschema.NormalizeRoleName). */
export function normalizeRoleName(role: string): string {
  return role.trim().toLowerCase();
}

/** The token preimage, byte for byte the node's CapabilityTokenBytes. */
export function canonicalDdbCapabilityBytes(f: DdbCapabilityFields): Uint8Array {
  const role = new TextEncoder().encode(normalizeRoleName(f.role));
  const parts = [
    new TextEncoder().encode(DDB_CAPABILITY_DOMAIN), be(toBig(f.chainId), 32), addr(f.contract),
    be(BigInt(role.length), 4), role, addr(f.caller),
    be(toBig(f.groupVersion), 8), be(toBig(f.issuedAt), 8), be(toBig(f.expiry), 8), be(toBig(f.nonce), 8),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** keccak256 of the preimage: what the wallet signs, as given. */
export function canonicalDdbCapabilityHash(f: DdbCapabilityFields): Uint8Array {
  return keccak_256(canonicalDdbCapabilityBytes(f));
}

export interface BuildDdbCapabilityOptions {
  chainId: Uintish;
  contract: string;
  role: string;
  /** The sealed epoch the caller resolved (Ddb.resolve(...).epoch). */
  groupVersion: Uintish;
  /** Seconds; default 600, at most DDB_TOKEN_LIFETIME_MAX (the host enforces its current bound). */
  ttlSeconds?: number;
  /** Seconds since the epoch; default now -- stamp at approval. */
  issuedAt?: number;
  nonce?: Uintish;
}

/** Builds and signs a capability token with `signer` (the raw-hash path; never personal_sign). */
export async function buildDdbCapabilityToken(signer: DdbSigner, o: BuildDdbCapabilityOptions): Promise<DdbCapabilityToken> {
  const ttl = o.ttlSeconds ?? DDB_TOKEN_LIFETIME_DEFAULT;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > DDB_TOKEN_LIFETIME_MAX) {
    throw new Error(`ttlSeconds must be an integer in [1, ${DDB_TOKEN_LIFETIME_MAX}]`);
  }
  const issuedAt = o.issuedAt ?? Math.floor(Date.now() / 1000);
  const nonce = o.nonce ?? BigInt(Math.floor(Math.random() * 2 ** 48));
  const caller = (await signer.getAddress()).toLowerCase();
  const fields: DdbCapabilityFields = {
    chainId: o.chainId, contract: o.contract, role: normalizeRoleName(o.role), caller,
    groupVersion: o.groupVersion, issuedAt, expiry: issuedAt + ttl, nonce,
  };
  const sig = await signer.signDdbHash(canonicalDdbCapabilityHash(fields));
  const q = (v: Uintish) => '0x' + toBig(v).toString(16);
  return {
    chainId: q(fields.chainId), contract: fields.contract, role: fields.role, caller,
    groupVersion: q(fields.groupVersion), issuedAt: q(fields.issuedAt), expiry: q(fields.expiry), nonce: q(fields.nonce),
    callerPubKey: hex(await signer.getPublicKey()), signature: hex(sig),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// PLACE-02 wallet half (NEC-93): the bound read at request time, and the client-side token check
// ---------------------------------------------------------------------------------------------------------------------

type Send = (method: string, params: any[]) => Promise<any>;

/** EndpointDirectory storage slot of tokenLifetime (contracts/EndpointDirectory.sol; the node reads it raw). */
export const DDB_TOKEN_LIFETIME_SLOT = 2;
/** The host's clock allowance into the future for issuedAt (ethapi ddbSignedReadMaxSkew). */
export const DDB_TOKEN_MAX_SKEW = 15;

/**
 * The network's token-lifetime bound, read at request time: the EndpointDirectory `ddb_hostEndpoints` names, its
 * tokenLifetime at the sealed `rootBlock` (what hosts enforce) and at the head, the LOWER of the two (a Timelock change
 * since the seal must not make a token too long for the hosts). A value outside the contract's own bounds is not a
 * bound; none readable, or no directory, is an error: hosts accept no token then either.
 */
export async function readDdbTokenLifetimeBound(send: Send, rootBlock?: number): Promise<{ directory: string; seconds: number }> {
  const list = await send('ddb_hostEndpoints', []);
  const directory = String(list?.directory ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(directory) || /^0x0{40}$/.test(directory)) {
    throw new Error('the network has no EndpointDirectory configured, so no host accepts a capability token');
  }
  const at = async (block: string): Promise<number | undefined> => {
    try {
      const v = BigInt(await send('eth_getStorageAt', [directory, '0x' + DDB_TOKEN_LIFETIME_SLOT.toString(16), block]));
      return v >= BigInt(DDB_TOKEN_LIFETIME_MIN) && v <= BigInt(DDB_TOKEN_LIFETIME_MAX) ? Number(v) : undefined;
    } catch {
      return undefined; // a pruned node may not hold rootBlock's state
    }
  };
  const vals = [rootBlock ? await at('0x' + rootBlock.toString(16)) : undefined, await at('latest')]
    .filter((v): v is number => v !== undefined);
  if (vals.length === 0) {
    throw new Error(`the EndpointDirectory ${directory} has no readable token lifetime within [${DDB_TOKEN_LIFETIME_MIN}, ${DDB_TOKEN_LIFETIME_MAX}] s`);
  }
  return { directory, seconds: Math.min(...vals) };
}

let _mldsa87: any = null;
async function mldsa87(): Promise<any> {
  if (_mldsa87) return _mldsa87;
  // @ts-ignore - noble-post-quantum.js is a bundled JS file without TypeScript declarations
  const noblePQ = (await import('./noble-post-quantum.js')) as any;
  _mldsa87 = (noblePQ.default || noblePQ).ml_dsa87;
  if (!_mldsa87) throw new Error('ml_dsa87 not available in bundled noble-post-quantum');
  return _mldsa87;
}

const unhex = (h: string): Uint8Array => {
  const s = String(h).replace(/^0x/i, '');
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('not hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};

export interface VerifyDdbCapabilityOptions {
  /** The chain the token must name (the host's step 1). */
  chainId?: Uintish;
  /** The lifetime bound in seconds (default the contract maximum, 3600). */
  lifetimeBound?: number;
  /** Seconds since the epoch (default now). */
  now?: number;
}

/**
 * The checks a client can make on a token, in the host's order and with its reasons (ethapi verifyCapabilityToken
 * steps 1-4): the chain, the clock (issuedAt <= now + 15 s, now < expiry, expiry > issuedAt), the lifetime bound, the
 * caller is keccak256(callerPubKey)[12:], and the ML-DSA-87 signature over the canonical hash as given. The group
 * (step 5) and the role (step 6) are the host's alone: a token this accepts can still be refused by a host outside
 * its group or after a revoke. A wallet runs it on its own token before answering, so a signer that signed anything
 * but the token hash (an EIP-191 prefix) never reaches the dApp.
 */
export async function verifyDdbCapabilityToken(t: DdbCapabilityToken, o: VerifyDdbCapabilityOptions = {}): Promise<{ valid: boolean; reason?: string }> {
  try {
    if (o.chainId !== undefined && toBig(t.chainId) !== toBig(o.chainId)) {
      return { valid: false, reason: `the token is for chain ${toBig(t.chainId)}, not ${toBig(o.chainId)}` };
    }
    const issued = Number(toBig(t.issuedAt)), expiry = Number(toBig(t.expiry));
    const now = o.now ?? Math.floor(Date.now() / 1000);
    if (expiry <= issued) return { valid: false, reason: 'the token expires at or before it is issued' };
    if (issued > now + DDB_TOKEN_MAX_SKEW) return { valid: false, reason: 'the token is issued in the future' };
    if (now >= expiry) return { valid: false, reason: 'the token expired' };
    const bound = o.lifetimeBound ?? DDB_TOKEN_LIFETIME_MAX;
    if (expiry - issued > bound) return { valid: false, reason: `the token lives ${expiry - issued} s, above the lifetime bound of ${bound} s` };
    const pub = unhex(t.callerPubKey);
    if (hex(keccak_256(pub).slice(12)) !== String(t.caller).toLowerCase()) {
      return { valid: false, reason: "the token's public key does not match its caller address" };
    }
    const h = canonicalDdbCapabilityHash(t);
    if (!(await mldsa87()).verify(pub, h, unhex(t.signature))) return { valid: false, reason: "the token's signature verification failed" };
    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: `malformed token: ${e?.message ?? e}` };
  }
}
