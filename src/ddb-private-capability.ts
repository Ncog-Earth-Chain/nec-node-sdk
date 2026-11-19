import { keccak_256 } from '@noble/hashes/sha3';
import { randomBytes } from '@noble/hashes/utils';
import type { DdbSigner } from './ddb';
import { DDB_TOKEN_LIFETIME_DEFAULT, DDB_TOKEN_LIFETIME_MAX, DDB_TOKEN_LIFETIME_MIN, DDB_TOKEN_MAX_SKEW } from './ddb-capability';
import { ddbSignedReadHome, parseDdbCurrentReadRoute, validateDdbPrivateReadOptions,
  type DdbCurrentReadRoute, type DdbPrivateReadOptions } from './ddb-private-read';
import type { DdbResolver } from './ddb-resolve';

/** Owner-approved client read purpose. No epoch, write, preview or host-auth authority. */
export const DDB_PRIVATE_CAPABILITY_FORMAT = 'private-placement-read-cap-v1' as const;
export const DDB_PRIVATE_CAPABILITY_DOMAIN = 'NEC-DDB-PVT-CAP\x01';
type Uintish = string | number | bigint;
export interface DdbPrivateCapabilityAudience {
  chainId: string;
  contract: string;
  manager: string;
  runtimeHash: string;
  placementVersion: string;
  groupHash: string;
}
export interface DdbPrivateCapabilityFields {
  format: typeof DDB_PRIVATE_CAPABILITY_FORMAT;
  audience: DdbPrivateCapabilityAudience;
  role: string;
  caller: string;
  issuedAt: string;
  expiry: string;
  nonce: string;
}
export interface DdbPrivateCapabilityToken extends DdbPrivateCapabilityFields {
  callerPubKey: string;
  signature: string;
}

const hex = (b: Uint8Array): string => '0x' + Array.from(b, n => n.toString(16).padStart(2, '0')).join('');
function quantity(value: unknown, bytes: number): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) throw new Error('noncanonical private capability quantity');
  const n = BigInt(value);
  if (n >= (BigInt(1) << BigInt(bytes * 8))) throw new Error('private capability quantity overflow');
  return n;
}
function q(value: Uintish, bytes: number): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('unsafe private capability quantity');
  const result = '0x' + BigInt(value).toString(16);
  quantity(result, bytes);
  return result;
}
function bytes(value: unknown, length: number, nonzero = false): Uint8Array {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${length * 2}}$`).test(value) || (nonzero && /^0x0+$/.test(value))) {
    throw new Error('noncanonical private capability identity/bytes');
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}
function be(n: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) { out[i] = Number(n & BigInt(255)); n >>= BigInt(8); }
  if (n !== BigInt(0)) throw new Error('private capability quantity overflow');
  return out;
}
function validUnicode(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n >= 0xdc00 && n <= 0xdfff) return false;
    if (n >= 0xd800 && n <= 0xdbff) {
      const low = s.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    }
  }
  return true;
}

/** Go strings.TrimSpace + Unicode simple lowercase, rather than JS contextual
 * lowercase (Greek sigma) or its expanding dotted-I mapping. Wire is canonical. */
export function normalizeDdbPrivateCapabilityRole(role: string): string {
  if (typeof role !== 'string' || !validUnicode(role)) throw new Error('invalid private capability role Unicode');
  return Array.from(role.replace(/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, ''))
    .map(c => c === '\u0130' ? 'i' : c.toLowerCase()).join('');
}
function signingShape(t: DdbPrivateCapabilityFields): Uint8Array {
  if (!t || t.format !== DDB_PRIVATE_CAPABILITY_FORMAT) throw new Error('unsupported private capability format');
  const a = t.audience;
  if (!a || quantity(a.chainId, 32) === BigInt(0) || quantity(a.placementVersion, 8) === BigInt(0)) throw new Error('private capability identity absent');
  bytes(a.contract, 20, true); bytes(a.manager, 20, true); bytes(a.runtimeHash, 32, true); bytes(a.groupHash, 32, true); bytes(t.caller, 20, true);
  quantity(t.issuedAt, 8); quantity(t.expiry, 8); quantity(t.nonce, 8);
  if (typeof t.role !== 'string' || t.role !== normalizeDdbPrivateCapabilityRole(t.role)) throw new Error('noncanonical private capability role');
  const role = new TextEncoder().encode(t.role);
  if (!role.length || role.length > 64) throw new Error('private capability role must be 1..64 UTF-8 bytes');
  return role;
}
export function canonicalDdbPrivateCapabilityBytes(t: DdbPrivateCapabilityFields): Uint8Array {
  const role = signingShape(t), a = t.audience;
  const parts = [new TextEncoder().encode(DDB_PRIVATE_CAPABILITY_DOMAIN), be(quantity(a.chainId, 32), 32),
    bytes(a.contract, 20), bytes(a.manager, 20), bytes(a.runtimeHash, 32), be(quantity(a.placementVersion, 8), 8), bytes(a.groupHash, 32),
    be(BigInt(role.length), 4), role, bytes(t.caller, 20), be(quantity(t.issuedAt, 8), 8), be(quantity(t.expiry, 8), 8), be(quantity(t.nonce, 8), 8)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
export const canonicalDdbPrivateCapabilityHash = (t: DdbPrivateCapabilityFields): Uint8Array => keccak_256(canonicalDdbPrivateCapabilityBytes(t));

function exactKeys(value: any, keys: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(value, k))) {
    throw new Error('private capability requires exact fields');
  }
}
// This format contains only two object levels and strings. Parsing that closed
// grammar directly lets us reject duplicate keys before JSON.parse loses them.
function parseWire(raw: string): unknown {
  if (raw.length > 20000) throw new Error('private capability encoding too large');
  let at = 0;
  const ws = () => { while (/[\t\r\n ]/.test(raw[at] ?? '') && at < raw.length) at++; };
  const str = (): string => {
    ws();
    if (raw[at] !== '"') throw new Error('private capability value must be a string');
    const start = at++;
    while (at < raw.length) {
      const c = raw[at++];
      if (c === '\\') { at++; continue; }
      if (c === '"') {
        const s = JSON.parse(raw.slice(start, at));
        if (!validUnicode(s)) throw new Error('invalid private capability Unicode');
        return s;
      }
    }
    throw new Error('unterminated private capability string');
  };
  const obj = (depth: number): Record<string, unknown> => {
    ws();
    if (depth > 1 || raw[at++] !== '{') throw new Error('private capability object required');
    const out: Record<string, unknown> = Object.create(null);
    ws();
    if (raw[at] === '}') { at++; return out; }
    while (at < raw.length) {
      const key = str(); ws();
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new Error('duplicate private capability field');
      if (raw[at++] !== ':') throw new Error('private capability colon required');
      ws(); out[key] = raw[at] === '{' ? obj(depth + 1) : str(); ws();
      const end = raw[at++];
      if (end === '}') return out;
      if (end !== ',') throw new Error('invalid private capability object');
    }
    throw new Error('unterminated private capability object');
  };
  const result = obj(0); ws();
  if (at !== raw.length) throw new Error('trailing private capability JSON');
  return result;
}
/** Strict wire validation. Object inputs have already lost JSON duplicate-key
 * information; callers handling raw JSON should pass its string form here. */
export function parseDdbPrivateCapabilityToken(value: unknown): DdbPrivateCapabilityToken {
  const t = (typeof value === 'string' ? parseWire(value) : value) as DdbPrivateCapabilityToken;
  exactKeys(t, ['format', 'audience', 'role', 'caller', 'issuedAt', 'expiry', 'nonce', 'callerPubKey', 'signature']);
  exactKeys(t.audience, ['chainId', 'contract', 'manager', 'runtimeHash', 'placementVersion', 'groupHash']);
  signingShape(t); bytes(t.callerPubKey, 2592); bytes(t.signature, 4627);
  return Object.freeze({ ...t, audience: Object.freeze({ ...t.audience }) });
}

export interface BuildDdbPrivateCapabilityOptions {
  audience: DdbPrivateCapabilityAudience;
  role: string;
  ttlSeconds?: number;
  issuedAt?: Uintish;
  nonce?: Uintish;
}
export async function buildDdbPrivateCapabilityToken(signer: DdbSigner, o: BuildDdbPrivateCapabilityOptions): Promise<DdbPrivateCapabilityToken> {
  const ttl = o.ttlSeconds ?? DDB_TOKEN_LIFETIME_DEFAULT;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > DDB_TOKEN_LIFETIME_MAX) throw new Error('invalid private capability ttlSeconds');
  const issuedAt = q(o.issuedAt ?? Math.floor(Date.now() / 1000), 8);
  const t: DdbPrivateCapabilityFields = { format: DDB_PRIVATE_CAPABILITY_FORMAT, audience: { ...o.audience },
    role: normalizeDdbPrivateCapabilityRole(o.role), caller: (await signer.getAddress()).toLowerCase(), issuedAt,
    expiry: q(BigInt(issuedAt) + BigInt(ttl), 8), nonce: q(o.nonce ?? BigInt(hex(randomBytes(8))), 8) };
  const hash = canonicalDdbPrivateCapabilityHash(t);
  const publicKey = await signer.getPublicKey();
  if (publicKey.length !== 2592) throw new Error('invalid private capability public key length');
  const signature = await signer.signDdbHash(hash);
  return parseDdbPrivateCapabilityToken({ ...t, callerPubKey: hex(publicKey), signature: hex(signature) });
}

export interface VerifyDdbPrivateCapabilityOptions {
  chainId?: Uintish;
  now?: Uintish;
  lifetimeBound: number;
  /** Trusted current-key binding (for accounts with a rotated signing key). */
  verifySigningKey?: (caller: string, publicKey: Uint8Array) => boolean | Promise<boolean>;
}
/** Client checks do not replace the selected host's current-state/RBAC checks. */
export async function verifyDdbPrivateCapabilityToken(value: unknown, o: VerifyDdbPrivateCapabilityOptions): Promise<{ valid: boolean; reason?: string }> {
  try {
    const t = parseDdbPrivateCapabilityToken(value);
    if (o.chainId !== undefined && t.audience.chainId !== q(o.chainId, 32)) throw new Error('private capability chain differs');
    const issued = BigInt(t.issuedAt), expiry = BigInt(t.expiry), now = BigInt(q(o.now ?? Math.floor(Date.now() / 1000), 8));
    if (expiry <= issued || now >= expiry) throw new Error('private capability expired or invalid expiry');
    if (issued > now + BigInt(DDB_TOKEN_MAX_SKEW)) throw new Error('private capability issued in the future');
    if (!Number.isInteger(o.lifetimeBound) || o.lifetimeBound < DDB_TOKEN_LIFETIME_MIN || o.lifetimeBound > DDB_TOKEN_LIFETIME_MAX) throw new Error('private capability lifetime policy unavailable');
    if (expiry - issued > BigInt(o.lifetimeBound)) throw new Error('private capability exceeds lifetime bound');
    const pub = bytes(t.callerPubKey, 2592);
    const bound = o.verifySigningKey ? await o.verifySigningKey(t.caller, pub) : hex(keccak_256(pub).slice(12)) === t.caller;
    if (!bound) throw new Error('private capability key does not match caller');
    // @ts-ignore bundled module has no declarations
    const pq = await import('./noble-post-quantum.js');
    if (!(pq.default || pq).ml_dsa87.verify(pub, canonicalDdbPrivateCapabilityHash(t), bytes(t.signature, 4627))) throw new Error('private capability signature verification failed');
    return { valid: true };
  } catch (e: any) { return { valid: false, reason: String(e?.message ?? e) }; }
}

export function ddbPrivateCapabilityAudience(chainId: Uintish, route: DdbCurrentReadRoute): DdbPrivateCapabilityAudience {
  if (!route.enabled || !route.private) throw new Error('private capability requires an active private assignment');
  return { chainId: q(chainId, 32), contract: route.contract, manager: route.manager, runtimeHash: route.runtimeHash,
    placementVersion: route.version, groupHash: route.groupHash };
}
function sameAudience(a: DdbPrivateCapabilityAudience, b: DdbPrivateCapabilityAudience): boolean {
  return Object.keys(a).every(k => a[k as keyof DdbPrivateCapabilityAudience] === b[k as keyof DdbPrivateCapabilityAudience]);
}

/** A reusable token travels only inside one actual selected-host channel. A
 * stale audience never refreshes/re-signs/retries or falls back to public RPC. */
export async function sendDdbPrivateCapabilityRead(resolver: DdbResolver, options: DdbPrivateReadOptions,
  value: DdbPrivateCapabilityToken, method: 'ddb_tokenSelect' | 'ddb_tokenCallReadProcedure', params: any[], chainId: Uintish): Promise<any> {
  if (method !== 'ddb_tokenSelect' && method !== 'ddb_tokenCallReadProcedure') throw new Error('unsupported private capability RPC');
  const policy = validateDdbPrivateReadOptions(options);
  const token = parseDdbPrivateCapabilityToken(value);
  const route = await resolver.resolveCurrent(token.audience.contract);
  if (!route.enabled || !route.private || !route.members.length || /^0x0+$/.test(route.manager) || /^0x0+$/.test(route.runtimeHash) ||
      /^0x0+$/.test(route.blockHash) || /^0x0+$/.test(route.stateRoot) || route.version === '0x0' || !sameAudience(token.audience, ddbPrivateCapabilityAudience(chainId, route))) {
    throw new Error('private capability current placement audience differs');
  }
  if (await policy.verifyAssignment(route) !== true) throw new Error('private capability assignment is not trusted');
  const member = ddbSignedReadHome(canonicalDdbPrivateCapabilityHash(token), route.members);
  const hosts = await resolver.hostEndpoints([member.validatorId]);
  const matches = hosts.filter(h => h?.validatorId === member.validatorId && h.live === true);
  if (matches.length !== 1 || !Array.isArray(matches[0].endpoints) || !matches[0].endpoints.length) throw new Error('private capability selected host has no live endpoint');
  const endpoints = Object.freeze(matches[0].endpoints.map(e => {
    if (e.scheme !== 'https' || typeof e.url !== 'string' || !e.url) throw new Error('private capability requires HTTPS selected host');
    bytes(e.tlsKeyHash, 32, true);
    return Object.freeze({ scheme: e.scheme, url: e.url, tlsKeyHash: e.tlsKeyHash });
  }));
  const transport = await policy.connect(Object.freeze({ route, member, endpoints }));
  const b = transport?.binding;
  if (!b || transport.endpointAuthenticated !== true || transport.confidentiality !== 'post-quantum' || typeof transport.send !== 'function' ||
      b.validatorId !== member.validatorId || b.address !== member.address || !endpoints.some(e => e.url === b.url && e.tlsKeyHash === b.tlsKeyHash) ||
      JSON.stringify(parseDdbCurrentReadRoute(route.contract, b.route)) !== JSON.stringify(route)) {
    throw new Error('private capability transport is not authenticated and bound to selected host');
  }
  // Replace the caller's mutable input with the validated frozen token snapshot.
  return transport.send(method, [token, ...params.slice(1)]);
}
