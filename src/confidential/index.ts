// PRIV-02 (NEC-84): client-side envelope for CONFIDENTIAL columns -- the necjs side of the node's
// ddb/confidential package. Normative spec: ncogearthchain docs/design/priv-02-confidential-envelope.md.
// Every byte this module produces is pinned to the Go implementation by tests/vectors/priv02_vectors.json
// (a copy of the node's ddb/confidential/testdata/priv02_vectors.json); a format change is a new
// envelope version, never an edit.
//
// Nothing here talks to a node: an envelope is an opaque procedure argument (hex/base64 it as the
// procedure expects), and the grant is bytes the key-group owner stores in the data contract.
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { randomBytes } from '@noble/hashes/utils';
import { concat, decapsulate, encapsulate, keyFromSeed, CT_LEN, EK_LEN, SEED_LEN } from './mlkem1024';

export { EK_LEN, CT_LEN, SEED_LEN } from './mlkem1024';

export const VERSION = 0x01;
export const SUITE_V1 = 0x01;
export const HEADER_LEN = 14;
export const NONCE_LEN = 12;
export const TAG_LEN = 16;
export const OVERHEAD = HEADER_LEN + NONCE_LEN + TAG_LEN; // 42
export const KEY_LEN = 32;
export const KEY_ID_LEN = 16;
export const SLOT_LEN = 1 + KEY_ID_LEN + CT_LEN + KEY_LEN + TAG_LEN; // 1633
export const MAX_SEALS_PER_EPOCH = BigInt(2) ** BigInt(32);
export const PURPOSE_READER = 1;
export const PURPOSE_RECOVERY = 2;

const enc = new TextEncoder();
const WRAP = enc.encode('NEC-PRIV02-WRAP\x01');
const SLOT = enc.encode('NEC-PRIV02-SLOT\x01');
const KC = enc.encode('NEC-PRIV02-KC\x01');
const COL = enc.encode('NEC-PRIV02-COL\x01');
const CELL = enc.encode('NEC-PRIV02-CELL\x01');
const ID = enc.encode('NEC-PRIV02-ID\x01');
const BACKUP = enc.encode('NEC-PRIV02-BACKUP\x01');
const KEMDIR = enc.encode('NEC-KEMDIR\x01');
const KEMDIR_EPOCH = enc.encode('NEC-KEMDIR-EPOCH\x01');
const KEMDIR_LAST = enc.encode('NEC-KEMDIR-LASTRESORT\x01');
const GRANTREF = enc.encode('NEC-PRIV02-GRANTREF\x01');

/** Error codes match the vector file's names (and the Go errors). */
export type ConfidentialErrorCode =
  | 'format' | 'unsupported' | 'auth' | 'stale' | 'unknownEpoch' | 'nonceBudget'
  | 'cellVersion' | 'cellClear' | 'unwrap' | 'notForThisKey' | 'keyCommitment' | 'notAGrantMember' | 'backup';

export class ConfidentialError extends Error {
  constructor(public readonly code: ConfidentialErrorCode, message?: string) {
    super(message ?? `confidential: ${code}`);
    this.name = 'ConfidentialError';
  }
}

/** One value's place: every envelope is bound to it. */
export interface Cell {
  chainId: bigint;
  contract: Uint8Array; // 20-byte data contract address
  table: string;
  column: string;
  pk: string[]; // primary-key values in declared order, canonical text
}

/** A key-group epoch as a holder keeps it. `seals` is the nonce-budget counter. */
export interface Epoch {
  n: number;
  key: Uint8Array;
  seals: bigint;
}

// ---- encoding helpers -------------------------------------------------------------------------

const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return b; };
const u16 = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; };
const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v); return b; };
const lp = (b: Uint8Array) => concat(u32(b.length), b);
const lps = (s: string) => lp(enc.encode(s));

export function chainWord(chainId: bigint): Uint8Array {
  const w = new Uint8Array(32);
  new DataView(w.buffer).setBigUint64(24, chainId);
  return w;
}

function addr20(a: Uint8Array): Uint8Array {
  if (a.length !== 20) throw new ConfidentialError('format', 'confidential: address must be 20 bytes');
  return a;
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ---- AES-256-GCM through WebCrypto (browser and Node >= 16) ------------------------------------

async function subtle(): Promise<SubtleCrypto> {
  const g = (globalThis as any).crypto;
  if (g && g.subtle) return g.subtle;
  // Node without a global WebCrypto (jest's node environment, older Node).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (await import('crypto')).webcrypto.subtle as unknown as SubtleCrypto;
}

// TS >= 5.7 types Uint8Array over ArrayBufferLike; WebCrypto takes any BufferSource at run time.
const bs = (b: Uint8Array) => b as unknown as BufferSource;

async function gcmSeal(key: Uint8Array, nonce: Uint8Array, pt: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const s = await subtle();
  const k = await s.importKey('raw', bs(key), 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv: bs(nonce), additionalData: bs(aad), tagLength: 128 }, k, bs(pt)));
}

async function gcmOpen(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null> {
  const s = await subtle();
  const k = await s.importKey('raw', bs(key), 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv: bs(nonce), additionalData: bs(aad), tagLength: 128 }, k, bs(ct)));
  } catch {
    return null;
  }
}

// ---- recipient keys and slots -----------------------------------------------------------------

/** An ML-KEM-1024 key pair kept as its 64-byte FIPS 203 seed. */
export interface RecipientKey {
  seed: Uint8Array;
  ek: Uint8Array;
  dk: Uint8Array;
}

export function recipientKeyFromSeed(seed: Uint8Array): RecipientKey {
  const { ek, dk } = keyFromSeed(seed);
  return { seed: Uint8Array.from(seed), ek, dk };
}

/** A fresh per-epoch key from the CSPRNG (design rule 1: never derived from the seed). */
export function newRecipientKey(): RecipientKey {
  return recipientKeyFromSeed(randomBytes(SEED_LEN));
}

export const keyId = (ek: Uint8Array) => sha256(ek).slice(0, KEY_ID_LEN);

function kekAndAad(ss: Uint8Array, id: Uint8Array, ctx: Uint8Array) {
  return {
    kek: hkdf(sha256, ss, id, concat(WRAP, lp(ctx)), KEY_LEN),
    aad: concat(WRAP, Uint8Array.of(0x01), id, lp(ctx)),
  };
}

/** Wraps a 32-byte key to ek under ctx. `m` derandomizes the KEM for the golden vectors only. */
export async function wrap(ek: Uint8Array, key: Uint8Array, ctx: Uint8Array, m?: Uint8Array): Promise<Uint8Array> {
  if (key.length !== KEY_LEN) throw new ConfidentialError('format', 'confidential: wrapped key must be 32 bytes');
  if (ek.length !== EK_LEN) throw new ConfidentialError('format', 'confidential: bad encapsulation key');
  const { sharedKey, ciphertext } = encapsulate(ek, m);
  const id = keyId(ek);
  const { kek, aad } = kekAndAad(sharedKey, id, ctx);
  return concat(Uint8Array.of(0x01), id, ciphertext, await gcmSeal(kek, new Uint8Array(12), key, aad));
}

export async function unwrap(k: RecipientKey, slot: Uint8Array, ctx: Uint8Array): Promise<Uint8Array> {
  if (slot.length !== SLOT_LEN || slot[0] !== 0x01) throw new ConfidentialError('unwrap');
  const id = slot.subarray(1, 1 + KEY_ID_LEN);
  if (!eq(id, keyId(k.ek))) throw new ConfidentialError('notForThisKey');
  const ss = decapsulate(k.dk, slot.subarray(1 + KEY_ID_LEN, 1 + KEY_ID_LEN + CT_LEN));
  const { kek, aad } = kekAndAad(ss, id, ctx);
  const key = await gcmOpen(kek, new Uint8Array(12), slot.subarray(1 + KEY_ID_LEN + CT_LEN), aad);
  if (!key) throw new ConfidentialError('unwrap');
  return key;
}

export function slotContext(chainId: bigint, contract: Uint8Array, group: string, epoch: number, purpose: number): Uint8Array {
  return concat(SLOT, chainWord(chainId), addr20(contract), lps(group), u32(epoch), Uint8Array.of(purpose));
}

export const commitment = (dmk: Uint8Array) => hmac(sha256, dmk, KC);

// ---- the value envelope -----------------------------------------------------------------------

export function columnKey(dmk: Uint8Array, c: Cell): Uint8Array {
  return hkdf(sha256, dmk, addr20(c.contract), concat(COL, chainWord(c.chainId), lps(c.table), lps(c.column)), KEY_LEN);
}

export function cellAad(c: Cell, header: Uint8Array): Uint8Array {
  return concat(CELL, chainWord(c.chainId), addr20(c.contract), lps(c.table), lps(c.column), u32(c.pk.length), ...c.pk.map(lps), header);
}

export interface Header {
  version: number;
  suite: number;
  epoch: number;
  cellVersion: bigint;
}

export function parseHeader(env: Uint8Array): Header {
  if (env.length < OVERHEAD) throw new ConfidentialError('format');
  const dv = new DataView(env.buffer, env.byteOffset, env.byteLength);
  const h = { version: env[0], suite: env[1], epoch: dv.getUint32(2), cellVersion: dv.getBigUint64(6) };
  if (h.version !== VERSION || h.suite !== SUITE_V1) throw new ConfidentialError('unsupported');
  if (h.cellVersion === BigInt(0)) throw new ConfidentialError('format');
  return h;
}

/** The cellVersion to replace `current` (undefined for a new cell): current + 1, starting at 1. */
export function nextCellVersion(current?: Uint8Array): bigint {
  return current === undefined ? BigInt(1) : parseHeader(current).cellVersion + BigInt(1);
}

/** The keyless write-side rule a procedure applies. Throws on violation. */
export function checkSuccessor(current: Uint8Array | undefined, next: Uint8Array): void {
  if (parseHeader(next).cellVersion !== nextCellVersion(current)) throw new ConfidentialError('cellVersion');
}

/**
 * The node's guard on a procedure write to a CONFIDENTIAL cell (PRIV-02b, NEC-162), on the cell's current and
 * next stored values (null/undefined = SQL NULL): an unchanged cell passes; clearing an envelope throws
 * 'cellClear' (the next write would restart at cellVersion 1); anything else must be checkSuccessor's exact
 * successor. Run it on the value you read before submitting, to learn whether the write will be endorsed.
 */
export function checkCellWrite(current: Uint8Array | null | undefined, next: Uint8Array | null | undefined): void {
  const cur = current ?? undefined;
  if (cur !== undefined && next != null && cur.length === next.length && cur.every((b, i) => b === next[i])) return;
  if (next == null) {
    if (cur === undefined) return;
    throw new ConfidentialError('cellClear');
  }
  checkSuccessor(cur, next);
}

/** Contract-metadata key under which a data contract declares its CONFIDENTIAL columns (PRIV-02b). */
export const CONFIDENTIAL_COLUMNS_METADATA_KEY = 'confidential_columns';

/**
 * Returns a copy of a contract's metadata with its CONFIDENTIAL columns declared ({ table: [columns] }).
 * The node then refuses, at deploy, a declared column that is not BYTEA, is keyed, constrained or indexed, or
 * a contract with a mutating procedure that has no point_write; and at every call, a write whose envelope is
 * not the cell's next cellVersion (checkCellWrite).
 */
export function declareConfidentialColumns(
  metadata: Record<string, unknown> | undefined, columns: Record<string, string[]>,
): Record<string, unknown> {
  for (const [t, cols] of Object.entries(columns)) {
    if (cols.length === 0 || new Set(cols).size !== cols.length) {
      throw new Error(`confidential: table ${t} must list distinct columns`);
    }
  }
  return { ...(metadata ?? {}), [CONFIDENTIAL_COLUMNS_METADATA_KEY]: columns };
}

/** Seals value for cell at cellVersion under epoch e. `nonce` is for the golden vectors only. */
export async function seal(e: Epoch, c: Cell, cellVersion: bigint, value: Uint8Array, nonce?: Uint8Array): Promise<Uint8Array> {
  if (cellVersion <= BigInt(0)) throw new ConfidentialError('cellVersion');
  if (e.seals >= MAX_SEALS_PER_EPOCH) throw new ConfidentialError('nonceBudget');
  const n = nonce ?? randomBytes(NONCE_LEN);
  if (n.length !== NONCE_LEN) throw new ConfidentialError('format');
  const header = concat(Uint8Array.of(VERSION, SUITE_V1), u32(e.n), u64(cellVersion));
  const ct = await gcmSeal(columnKey(e.key, c), n, value, cellAad(c, header));
  e.seals += BigInt(1);
  return concat(header, n, ct);
}

/** Opens env for cell with the holder's epochs (by number). minVersion > 0 refuses an older value. */
export async function open(epochs: Map<number, Epoch>, c: Cell, env: Uint8Array, minVersion = BigInt(0)): Promise<{ value: Uint8Array; cellVersion: bigint }> {
  const h = parseHeader(env);
  const e = epochs.get(h.epoch);
  if (!e) throw new ConfidentialError('unknownEpoch', `confidential: no key for epoch ${h.epoch}`);
  const p = await gcmOpen(columnKey(e.key, c), env.subarray(HEADER_LEN, HEADER_LEN + NONCE_LEN), env.subarray(HEADER_LEN + NONCE_LEN), cellAad(c, env.subarray(0, HEADER_LEN)));
  if (!p) throw new ConfidentialError('auth');
  if (minVersion > BigInt(0) && h.cellVersion < minVersion) throw new ConfidentialError('stale');
  return { value: p, cellVersion: h.cellVersion };
}

// ---- grants -----------------------------------------------------------------------------------

export interface GrantSlot { purpose: number; slot: Uint8Array }
export interface Grant { epoch: number; commitment: Uint8Array; slots: GrantSlot[] }

export function encodeGrant(g: Grant): Uint8Array {
  return concat(Uint8Array.of(0x01), u32(g.epoch), g.commitment, u16(g.slots.length), ...g.slots.map((s) => concat(Uint8Array.of(s.purpose), s.slot)));
}

export function decodeGrant(b: Uint8Array): Grant {
  const fixed = 1 + 4 + 32 + 2;
  if (b.length < fixed || b[0] !== 0x01) throw new ConfidentialError('format');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint16(37);
  if (b.length !== fixed + n * (1 + SLOT_LEN)) throw new ConfidentialError('format');
  const slots: GrantSlot[] = [];
  for (let i = 0, off = fixed; i < n; i++, off += 1 + SLOT_LEN) {
    if (b[off] !== PURPOSE_READER && b[off] !== PURPOSE_RECOVERY) throw new ConfidentialError('format');
    slots.push({ purpose: b[off], slot: b.slice(off + 1, off + 1 + SLOT_LEN) });
  }
  return { epoch: dv.getUint32(1), commitment: b.slice(5, 37), slots };
}

/** Opens epoch n: a fresh DMK wrapped to each reader's per-epoch key and each recovery key. */
export async function newGrant(
  chainId: bigint, contract: Uint8Array, group: string, n: number, readers: Uint8Array[], recovery: Uint8Array[] = [],
  det?: { dmk: Uint8Array; m: Uint8Array[] },
): Promise<{ grant: Grant; epoch: Epoch }> {
  const dmk = det?.dmk ?? randomBytes(KEY_LEN);
  const ms = det ? [...det.m] : [];
  const slots: GrantSlot[] = [];
  for (const [purpose, eks] of [[PURPOSE_READER, readers], [PURPOSE_RECOVERY, recovery]] as [number, Uint8Array[]][]) {
    const ctx = slotContext(chainId, contract, group, n, purpose);
    for (const ek of eks) slots.push({ purpose, slot: await wrap(ek, dmk, ctx, det ? ms.shift() : undefined) });
  }
  return { grant: { epoch: n, commitment: commitment(dmk), slots }, epoch: { n, key: dmk, seals: BigInt(0) } };
}

/** A holder's side of a grant: find its slot, unwrap, check the key commitment. */
export async function acceptGrant(k: RecipientKey, g: Grant, chainId: bigint, contract: Uint8Array, group: string): Promise<Epoch> {
  const id = keyId(k.ek);
  for (const s of g.slots) {
    if (s.slot.length !== SLOT_LEN || !eq(s.slot.subarray(1, 1 + KEY_ID_LEN), id)) continue;
    const dmk = await unwrap(k, s.slot, slotContext(chainId, contract, group, g.epoch, s.purpose));
    if (!eq(commitment(dmk), g.commitment)) throw new ConfidentialError('keyCommitment');
    return { n: g.epoch, key: dmk, seals: BigInt(0) };
  }
  throw new ConfidentialError('notAGrantMember');
}

// ---- the grant record (PRIV-02d, NEC-171; spec §3.1) --------------------------------------------
//
// Where a key-group owner publishes its grants so a reader finds its wrapped key without being handed it out
// of band: the contract metadata key `confidential_grants`, in exactly this canonical JSON (keys in byte
// order, no whitespace, entries sorted by group then epoch):
//   {"grants":[{"epoch":<uint32>,"grant":"0x<hex of encodeGrant>","group":"<name>"},...],"version":1}
// The node checks the SHAPE and that an upgrade only appends (ddb/confidential/grantrecord.go); these mirror
// it verdict for verdict (tests/vectors/priv02_grant_record_vectors.json).

/** Contract-metadata key under which a data contract publishes its grants (PRIV-02d). */
export const CONFIDENTIAL_GRANTS_METADATA_KEY = 'confidential_grants';
/** The record layout this code reads and writes; any other version is refused. */
export const GRANT_RECORD_VERSION = 1;

/** The record's size bounds. Policy, not format: the node reads them through one accessor (GrantRecordLimitsInForce). */
export interface GrantRecordLimits { maxGrants: number; maxSlotsPerGrant: number; maxRecordBytes: number; maxGroupBytes: number }
export const DEFAULT_GRANT_RECORD_LIMITS: GrantRecordLimits = { maxGrants: 16, maxSlotsPerGrant: 16, maxRecordBytes: 40 << 10, maxGroupBytes: 64 };

export type GrantRecordErrorCode =
  | 'format' | 'version' | 'order' | 'duplicate' | 'group' | 'epochMismatch' | 'grant' | 'slots' | 'count' | 'size'
  | 'changed' | 'latestDropped' | 'epochNotNewer';

/** A refused record; code is the vector file's (and the node's) error name. */
export class GrantRecordError extends Error {
  constructor(public readonly code: GrantRecordErrorCode, message: string) {
    super(`confidential grant record: ${message}`);
  }
}

export interface GrantRecordEntry { epoch: number; grant: string; group: string }
export interface GrantRecord { grants: GrantRecordEntry[]; version: number }

const MAX_U32 = 0xffffffff;
const GRANT_FIXED = 1 + 4 + 32 + 2;
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)); // h is checked even-length lower-case hex

// Go's encoding/json (with HTML escaping off) differs from JSON.stringify in escaping U+2028/U+2029 and in
// printing a negative zero as -0 (goJSON below); its float formatting is otherwise ES6's.
const goString = (s: string) => JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Encodes a decoded JSON value the way Go re-encodes a generic one: object keys in byte (UTF-16 code unit,
// equal for the record's ASCII keys) order, no whitespace.
function goJSON(v: unknown): string {
  if (v === null || typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : JSON.stringify(v);
  if (typeof v === 'string') return goString(v);
  if (Array.isArray(v)) return `[${v.map(goJSON).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${goString(k)}:${goJSON(o[k])}`).join(',')}}`;
}

// Go decodes a lone surrogate escape to U+FFFD; mirror it so both sides see one string.
function wellFormed(v: unknown): unknown {
  if (typeof v === 'string') {
    // a plain loop, not a lookbehind regex: the mobile wallet's engine (Hermes) is a target too
    let out = '';
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < v.length && v.charCodeAt(i + 1) >= 0xdc00 && v.charCodeAt(i + 1) <= 0xdfff) {
        out += v[i] + v[++i];
      } else {
        out += c >= 0xd800 && c <= 0xdfff ? '\ufffd' : v[i];
      }
    }
    return out;
  }
  if (Array.isArray(v)) return v.map(wellFormed);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [wellFormed(k) as string, wellFormed(x)]));
  }
  return v;
}

// Strict struct decode as encoding/json does it with DisallowUnknownFields: field names match
// case-insensitively (the canonical-form check below then refuses the other spelling), null leaves the zero value.
function fields(o: unknown, names: string[], what: string): Record<string, unknown> {
  if (o === null) return {};
  if (typeof o !== 'object' || Array.isArray(o)) throw new GrantRecordError('format', `${what} must be an object`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const name = names.find((n) => n.toLowerCase() === k.toLowerCase());
    if (!name) throw new GrantRecordError('format', `${what}: unknown field ${JSON.stringify(k)}`);
    out[name] = v;
  }
  return out;
}

function asUint(v: unknown, max: number, what: string): number {
  if (v === undefined || v === null) return 0;
  // Object.is(-0): Go re-encodes a negative zero as -0, which no unsigned field decodes
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || Object.is(v, -0) || v > max) throw new GrantRecordError('format', `${what} must be an integer in [0, ${max}]`);
  return v;
}

function asString(v: unknown, what: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new GrantRecordError('format', `${what} must be a string`);
  return v;
}

const entryLess = (a: GrantRecordEntry, b: GrantRecordEntry) =>
  a.group !== b.group ? cmp(enc.encode(a.group), enc.encode(b.group)) < 0 : a.epoch < b.epoch;

/** The record's canonical JSON (the bytes the vectors pin). Entries are sorted here, so a writer can append and call it. */
export function canonicalGrantRecord(r: GrantRecord): string {
  const grants = [...r.grants].sort((a, b) => (entryLess(a, b) ? -1 : entryLess(b, a) ? 1 : 0));
  return goJSON({ grants: grants.map((e) => ({ epoch: e.epoch, grant: e.grant, group: e.group })), version: r.version });
}

/**
 * Reads a `confidential_grants` value (the decoded metadata value, or its JSON text) and checks its shape
 * against lim exactly as the node does: version, canonical entry order with no duplicate (group, epoch), a
 * valid group name, canonical hex, a grant that decodes with the entry's epoch, version-1 slots, the bounds.
 */
export function parseGrantRecord(value: unknown, lim: GrantRecordLimits = DEFAULT_GRANT_RECORD_LIMITS): GrantRecord {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch (e) {
      throw new GrantRecordError('format', `not JSON: ${String(e)}`);
    }
  }
  v = wellFormed(v);
  const raw = goJSON(v);
  const top = fields(v, ['grants', 'version'], 'the record');
  if (top.version !== undefined && top.version !== null && (typeof top.version !== 'number' || !Number.isInteger(top.version))) {
    throw new GrantRecordError('format', 'version must be an integer');
  }
  if (top.grants !== undefined && top.grants !== null && !Array.isArray(top.grants)) throw new GrantRecordError('format', '"grants" must be an array');
  const entries = ((top.grants as unknown[] | undefined) ?? []).map((x, i) => {
    const f = fields(x, ['epoch', 'grant', 'group'], `entry ${i}`);
    return { epoch: asUint(f.epoch, MAX_U32, `entry ${i}: epoch`), grant: asString(f.grant, `entry ${i}: grant`), group: asString(f.group, `entry ${i}: group`) };
  });
  const version = (top.version as number | undefined) ?? 0;
  if (version !== GRANT_RECORD_VERSION) {
    throw new GrantRecordError('version', `version ${version} is not supported (this client reads version ${GRANT_RECORD_VERSION})`);
  }
  if (top.grants === undefined || top.grants === null) throw new GrantRecordError('format', '"grants" must be an array');
  if (entries.length > lim.maxGrants) throw new GrantRecordError('count', `${entries.length} grants exceed the bound of ${lim.maxGrants} (prune old epochs)`);
  let total = 0;
  entries.forEach((e, i) => {
    const gb = enc.encode(e.group).length;
    if (gb === 0 || gb > lim.maxGroupBytes) throw new GrantRecordError('group', `entry ${i}: the key group must be 1..${lim.maxGroupBytes} bytes of UTF-8`);
    if (i > 0) {
      const p = entries[i - 1];
      if (p.group === e.group && p.epoch === e.epoch) throw new GrantRecordError('duplicate', `entry ${i}: group ${JSON.stringify(e.group)} epoch ${e.epoch} is granted twice`);
      if (!entryLess(p, e)) throw new GrantRecordError('order', `entry ${i}: entries must be sorted by group then epoch`);
    }
    const h = e.grant.startsWith('0x') ? e.grant.slice(2) : null;
    if (h === null || h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) throw new GrantRecordError('format', `entry ${i}: the grant must be 0x-prefixed lower-case hex`);
    const b = hexBytes(h);
    if (b.length >= GRANT_FIXED) {
      const n = (b[GRANT_FIXED - 2] << 8) | b[GRANT_FIXED - 1];
      if (n > lim.maxSlotsPerGrant) throw new GrantRecordError('slots', `entry ${i}: ${n} slots exceed the bound of ${lim.maxSlotsPerGrant}`);
    }
    let g: Grant;
    try {
      g = decodeGrant(b);
    } catch (err) {
      throw new GrantRecordError('grant', `entry ${i}: the grant does not decode: ${String(err)}`);
    }
    if (g.slots.length === 0) throw new GrantRecordError('slots', `entry ${i}: a grant with no slot opens nothing`);
    g.slots.forEach((s, j) => {
      if (s.slot[0] !== 0x01) throw new GrantRecordError('grant', `entry ${i}: slot ${j} is not a version-1 slot`);
    });
    if (g.epoch !== e.epoch) throw new GrantRecordError('epochMismatch', `entry ${i}: the entry says epoch ${e.epoch} but its grant opens epoch ${g.epoch}`);
    if ((total += b.length) > lim.maxRecordBytes) throw new GrantRecordError('size', `the grants total more than ${lim.maxRecordBytes} bytes (prune old epochs)`);
  });
  const r: GrantRecord = { grants: entries, version };
  if (raw !== canonicalGrantRecord(r)) throw new GrantRecordError('format', 'the record is not in canonical form');
  return r;
}

/** The grant for (group, epoch), or null when the record has none. */
export function findGrant(r: GrantRecord, group: string, epoch: number): Grant | null {
  const e = r.grants.find((x) => x.group === group && x.epoch === epoch);
  return e ? decodeGrant(hexBytes(e.grant.slice(2))) : null;
}

/**
 * The rule for an upgrade that carries next over a deployed stored record (null: none): a published grant
 * is never changed, a group's latest epoch is never pruned, and a new entry opens a newer epoch.
 */
export function checkGrantRecordUpgrade(stored: GrantRecord | null, next: GrantRecord | null): void {
  if (!stored) return;
  const latest = new Map<string, number>();
  const have = new Map<string, Map<number, string>>();
  for (const e of stored.grants) {
    if (!have.has(e.group)) have.set(e.group, new Map());
    have.get(e.group)!.set(e.epoch, e.grant);
    if (e.epoch >= (latest.get(e.group) ?? 0)) latest.set(e.group, e.epoch);
  }
  const kept = new Set<string>();
  for (const e of next?.grants ?? []) {
    const was = have.get(e.group)?.get(e.epoch);
    if (was !== undefined) {
      if (was !== e.grant) {
        throw new GrantRecordError('changed', `group ${JSON.stringify(e.group)} epoch ${e.epoch} is already published with other bytes; open a new epoch instead`);
      }
      kept.add(`${e.epoch}\u0000${e.group}`);
      continue;
    }
    const l = latest.get(e.group);
    if (l !== undefined && e.epoch <= l) {
      throw new GrantRecordError('epochNotNewer', `group ${JSON.stringify(e.group)} epoch ${e.epoch} is not newer than its latest published epoch ${l}`);
    }
  }
  for (const g of [...latest.keys()].sort()) {
    if (!kept.has(`${latest.get(g)}\u0000${g}`)) throw new GrantRecordError('latestDropped', `group ${JSON.stringify(g)}: its latest epoch ${latest.get(g)} may not be pruned`);
  }
}

/**
 * Returns a copy of a contract's metadata with grant g of group appended to its grant record (the owner's
 * "open epoch" write, carried by the next upgrade). The result passes the node's shape and append checks.
 */
export function publishGrant(metadata: Record<string, unknown> | undefined, group: string, g: Grant): Record<string, unknown> {
  const cur = metadata?.[CONFIDENTIAL_GRANTS_METADATA_KEY];
  const stored = cur === undefined || cur === null ? null : parseGrantRecord(cur);
  const entry = { epoch: g.epoch, grant: `0x${hexOf(encodeGrant(g))}`, group };
  const next: GrantRecord = { version: GRANT_RECORD_VERSION, grants: [...(stored?.grants ?? []), entry] };
  checkGrantRecordUpgrade(stored, next);
  const text = canonicalGrantRecord(next);
  parseGrantRecord(text); // the bounds and the slot checks, exactly as the node will apply them
  return { ...(metadata ?? {}), [CONFIDENTIAL_GRANTS_METADATA_KEY]: JSON.parse(text) };
}

/**
 * The ACTIVE version's metadata from a ddb_getSchema(contractAddress) result: contracts[].versions[] with
 * status "active", whose spec_json is the contract definition. undefined when no version is active.
 */
export function activeMetadataFromSchema(info: unknown): Record<string, unknown> | undefined {
  const contracts = (info as { contracts?: unknown })?.contracts;
  for (const c of Array.isArray(contracts) ? contracts : []) {
    const versions = (c as { versions?: unknown })?.versions;
    for (const v of Array.isArray(versions) ? versions : []) {
      const ver = v as { status?: unknown; spec_json?: unknown };
      if (ver.status !== 'active' || typeof ver.spec_json !== 'string') continue;
      const m = (JSON.parse(ver.spec_json) as { metadata?: unknown }).metadata;
      return m !== null && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : undefined;
    }
  }
  return undefined;
}

/** The grant for (group, epoch) in a contract's metadata (e.g. ddb_getSchema's spec), or null. */
export function grantFromMetadata(metadata: Record<string, unknown> | undefined, group: string, epoch: number): Grant | null {
  const v = metadata?.[CONFIDENTIAL_GRANTS_METADATA_KEY];
  return v === undefined || v === null ? null : findGrant(parseGrantRecord(v), group, epoch);
}

/** A reader's side: find the published grant in the contract's metadata, then acceptGrant (key commitment). */
export async function acceptGrantFromMetadata(
  k: RecipientKey, metadata: Record<string, unknown> | undefined, chainId: bigint, contract: Uint8Array, group: string, epoch: number,
): Promise<Epoch> {
  const g = grantFromMetadata(metadata, group, epoch);
  if (!g) throw new ConfidentialError('notAGrantMember', `confidential: no grant published for group ${group} epoch ${epoch}`);
  return acceptGrant(k, g, chainId, contract, group);
}

// ---- identity and keystore backup (key restore) -----------------------------------------------

/** The directory identity key, derived from the account seed (restored with it). Never opens a slot. */
export function identityFromAccountSeed(accountSeed: Uint8Array, chainId: bigint, account: Uint8Array, keyVersion: number): RecipientKey {
  if (accountSeed.length < 32) throw new ConfidentialError('format', 'confidential: account seed must be at least 32 bytes');
  return recipientKeyFromSeed(hkdf(sha256, accountSeed, ID, concat(chainWord(chainId), addr20(account), u32(keyVersion)), SEED_LEN));
}

export interface EpochEntry { chainId: bigint; contract: Uint8Array; group: string; epoch: Epoch; opener?: Uint8Array }
export interface Keystore { identity: RecipientKey; pool: RecipientKey[]; epochs: EpochEntry[] }

function refKey(e: EpochEntry): Uint8Array {
  // The canonical order both clients sort backup entries by: chainID ‖ contract ‖ LP(group) ‖ epoch.
  return concat(u64(e.chainId), addr20(e.contract), lps(e.group), u32(e.epoch.n));
}

/** Seals the keystore to the identity key (the Go backup format). det is for the golden vectors only. */
export async function backupKeystore(ks: Keystore, det?: { bk: Uint8Array; nonce: Uint8Array; m: Uint8Array }): Promise<Uint8Array> {
  const pool = [...ks.pool].sort((a, b) => cmp(keyId(a.ek), keyId(b.ek)));
  const epochs = [...ks.epochs].sort((a, b) => cmp(refKey(a), refKey(b)));
  const parts: Uint8Array[] = [u32(pool.length), ...pool.map((k) => k.seed), u32(epochs.length)];
  for (const e of epochs) {
    parts.push(u64(e.chainId), addr20(e.contract), lps(e.group), u32(e.epoch.n), e.epoch.key, u64(e.epoch.seals));
    parts.push(e.opener ? concat(Uint8Array.of(1), e.opener) : Uint8Array.of(0));
  }
  const bk = det?.bk ?? randomBytes(KEY_LEN);
  const slot = await wrap(ks.identity.ek, bk, BACKUP, det?.m);
  const nonce = det?.nonce ?? randomBytes(NONCE_LEN);
  return concat(Uint8Array.of(0x01), slot, nonce, await gcmSeal(bk, nonce, concat(...parts), BACKUP));
}

/** Opens a backup with the identity key (itself restored from the account seed). */
export async function restoreKeystore(identity: RecipientKey, blob: Uint8Array): Promise<Keystore> {
  if (blob.length < 1 + SLOT_LEN + NONCE_LEN + TAG_LEN || blob[0] !== 0x01) throw new ConfidentialError('backup');
  let bk: Uint8Array;
  try {
    bk = await unwrap(identity, blob.subarray(1, 1 + SLOT_LEN), BACKUP);
  } catch {
    throw new ConfidentialError('backup');
  }
  const body = await gcmOpen(bk, blob.subarray(1 + SLOT_LEN, 1 + SLOT_LEN + NONCE_LEN), blob.subarray(1 + SLOT_LEN + NONCE_LEN), BACKUP);
  if (!body) throw new ConfidentialError('backup');
  let off = 0;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const take = (n: number) => {
    if (off + n > body.length) throw new ConfidentialError('backup');
    const v = body.slice(off, off + n);
    off += n;
    return v;
  };
  const r32 = () => { take(4); return dv.getUint32(off - 4); };
  const r64 = () => { take(8); return dv.getBigUint64(off - 8); };
  const ks: Keystore = { identity, pool: [], epochs: [] };
  for (let i = 0, n = r32(); i < n; i++) ks.pool.push(recipientKeyFromSeed(take(SEED_LEN)));
  for (let i = 0, n = r32(); i < n; i++) {
    const chainId = r64();
    const contract = take(20);
    const group = new TextDecoder().decode(take(r32()));
    const num = r32();
    const key = take(KEY_LEN);
    const seals = r64();
    const opener = take(1)[0] === 1 ? take(KEY_ID_LEN) : undefined;
    ks.epochs.push({ chainId, contract, group, epoch: { n: num, key, seals }, opener });
  }
  if (off !== body.length) throw new ConfidentialError('backup');
  return ks;
}

function cmp(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// ---- recipient-key directory (contracts/KemDirectory.sol) digests -----------------------------

function dirHead(domain: Uint8Array, chainId: bigint, directory: Uint8Array, account: Uint8Array, keyVersion: number) {
  return concat(domain, chainWord(chainId), addr20(directory), addr20(account), u32(keyVersion));
}

/** What the account's ML-DSA-87 key signs to bind its identity key in the directory. */
export const identityDigest = (chainId: bigint, directory: Uint8Array, account: Uint8Array, keyVersion: number, ek: Uint8Array) =>
  keccak_256(concat(dirHead(KEMDIR, chainId, directory, account, keyVersion), keccak_256(ek)));

export const lastResortDigest = (chainId: bigint, directory: Uint8Array, account: Uint8Array, keyVersion: number, ek: Uint8Array) =>
  keccak_256(concat(dirHead(KEMDIR_LAST, chainId, directory, account, keyVersion), keccak_256(ek)));

export const poolDigest = (chainId: bigint, directory: Uint8Array, account: Uint8Array, keyVersion: number, firstIndex: number, eks: Uint8Array[]) =>
  keccak_256(concat(dirHead(KEMDIR_EPOCH, chainId, directory, account, keyVersion), u32(firstIndex), ...eks.map((ek) => keccak_256(ek))));

/** The grant reference a reader's pool key must be consumed for before the reader accepts the slot. */
export const grantRef = (chainId: bigint, contract: Uint8Array, group: string, epoch: number) =>
  keccak_256(concat(GRANTREF, chainWord(chainId), addr20(contract), lps(group), u32(epoch)));
