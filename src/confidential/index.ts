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
