import { keccak_256 } from '@noble/hashes/sha3';
import { randomBytes } from '@noble/hashes/utils';
import { Provider } from './provider';
import { type ContractDefinition, validateContractDefinition } from './ddb-schema';

// The comparison operators Ddb.select understands (mirrors the chain's supported predicate set). The
// `(string & {})` arm keeps autocomplete on the known ops while still accepting any forward-compatible op.
export type DdbFilterOp = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'ilike' | 'in' | (string & {});

// A filter for Ddb.select — mirrors the chain's ddb.DdbFilter.
export interface DdbFilter {
  column: string;
  op: DdbFilterOp;
  value: string;
}

// Query options for Ddb.select — mirrors the chain's ddb.DdbQueryOptions.
export interface DdbQueryOptions {
  filters?: DdbFilter[];
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  /**
   * DB-03 read token: the minimum applied version (a block number, hex) the read must reflect -- pass
   * `readToken` from getCommitStatus / waitForCommitted. The node answers once it has applied through it,
   * or refuses with {@link DDB_READ_DEADLINE_CODE} after `waitMs`; it never returns older rows as success.
   * Omit it for today's behaviour (the ingress node's local state, no wait).
   */
  minVersion?: string | number;
  /** How long the node may wait for `minVersion` (ms). 0/omitted = node default (5 s); capped at 30 s. */
  waitMs?: number;
}

/**
 * DB-03 read token alone: ddb_query's and ddb_callReadProcedure's optional fourth parameter, and
 * ddb_signedCallReadProcedure's optional second one (beside the envelope, NOT signed -- NEC-152).
 */
export interface DdbReadConsistency {
  minVersion?: string | number;
  waitMs?: number;
}

/** JSON-RPC code of a read the node refused because it did not reach `minVersion` in time. Retry, or read elsewhere. */
export const DDB_READ_DEADLINE_CODE = -32061;
/** JSON-RPC code of a read the node refused because it cannot report its applied version at all. */
export const DDB_READ_UNAVAILABLE_CODE = -32062;

/**
 * The node parses `minVersion` as a 0x-hex quantity, but the Provider normalizes hex quantities in every
 * RESULT to decimal strings -- so the readToken a caller got back from getCommitStatus arrives as "6", not
 * "0x6". Accept either spelling (or a number / bigint) and send hex, so a token round-trips untouched.
 */
export function ddbReadTokenHex(v: string | number | bigint): string {
  const s = typeof v === 'string' ? v.trim() : v;
  if (typeof s === 'string' && /^0x[0-9a-f]+$/i.test(s)) return '0x' + BigInt(s).toString(16);
  if (typeof s === 'string' && !/^[0-9]+$/.test(s)) throw new Error(`DDB read token ${JSON.stringify(v)} is not a block number`);
  return '0x' + BigInt(s).toString(16);
}

function withReadToken<T extends { minVersion?: string | number | bigint }>(opts: T): T {
  if (opts == null || opts.minVersion === undefined || opts.minVersion === null) return opts;
  return { ...opts, minVersion: ddbReadTokenHex(opts.minVersion) };
}

/** ddb_selectVersioned result: the rows and the applied version they reflect at least. */
export interface DdbVersionedRows {
  rows: DdbRow[];
  dataVersion: string;
}

// Options for the client-signed DDB write methods. Both fields are part of the signed
// CanonicalOperationHash, so the node uses exactly these values — override only for determinism/tests.
export interface DdbSignOptions {
  /**
   * UNIX SECONDS, defaulting to now. Not milliseconds: the node refuses ts == 0 by name and
   * anything outside [now-900, now+300] (gossip/ddb/authz.go), so a millisecond value is not a
   * rounding error -- it is every operation refused, with no local symptom. buildDdbOp rejects one.
   */
  timestamp?: number;
  gasLimit?: number;  // defaults to 100000
  /**
   * Replay-protection nonce, part of the SIGNED preimage. Defaults to 8 cryptographically random
   * bytes, which is what you want: the node cannot fill this in (it is covered by your signature),
   * and without a fresh value two submissions you mean to be distinct are byte-identical, so a
   * replay of one is indistinguishable from the original. Pass an explicit value only when you need
   * a deterministic hash (tests, golden vectors).
   */
  nonce?: number | bigint;
  /**
   * Which operation preimage to sign: 1 ("NEC-DDB-OP\x01"), 2 ("NEC-DDB-OP\x02", SEC-03), or 'auto'.
   *
   * v2 binds the chain id, the database identity, `expiry` and `keyVersion`. It is valid ONLY on a
   * network where FeatureDdbOpPreimageV2 is active; a v1 network refuses a v2 signature and vice versa.
   *
   * 'auto' (the Ddb default, GOV-06) asks the node's nec_rules and signs v2 only when it reports
   * ddb-op-preimage-v2 ACTIVE in the current epoch -- a feature merely SCHEDULED is still v1. A node
   * without nec_rules, or any error reading it, gives v1, which is what the SDK signed before 'auto'
   * existed. 'auto' needs a node, so buildDdbOp (offline) refuses it; resolve it first with
   * Ddb.resolveOpPreimageVersion().
   */
  preimageVersion?: DdbOpPreimageMode;
  /** v2 only. The network the operation is bound to. Ddb asks the node (eth_chainId); buildDdbOp requires it. */
  chainId?: number | bigint | string;
  /**
   * v2 only. UNIX SECONDS after which the node refuses the operation. Defaults to timestamp + 300.
   * The node admits it only if it is non-zero, not before `timestamp`, and at most 900 s after it.
   */
  expiry?: number | bigint;
  /** v2 only. The signing key's version, signed as an assertion (the node does not enforce it yet). Defaults to 0. */
  keyVersion?: number | bigint;
}

/** The DDB operation preimage versions this SDK can sign. */
export type DdbOpPreimageVersion = 1 | 2;

/** A preimage version, or 'auto': ask the node (nec_rules) which one its current epoch verifies. */
export type DdbOpPreimageMode = DdbOpPreimageVersion | 'auto';

/** The FeatureID nec_rules reports the v2 preimage under (ncogearthchain.FeatureDdbOpPreimageV2). */
export const DDB_OP_PREIMAGE_V2_FEATURE = 'ddb-op-preimage-v2';

/** Client-wide defaults for a {@link Ddb}. */
export interface DdbOptions {
  /** The preimage every signed write uses unless the call says otherwise. Defaults to 'auto'. See DdbSignOptions. */
  opPreimageVersion?: DdbOpPreimageMode;
}

// ---------------------------------------------------------------------------
// Typed shapes of the ddb_* read/status responses (mirror ethapi/ddb_api.go result maps).
// ---------------------------------------------------------------------------

/** A single DDB table row — column name -> JSON-decoded value. */
export type DdbRow = Record<string, unknown>;

/** ddb_getSchema result — the contract-schema descriptor(s) for a CONTRACT ADDRESS (all contracts when it is ''). */
export interface DdbSchemaInfo {
  contracts?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** ddb_getEndorsementStatus / waitForEndorsement result (mirrors PublicDdbAPI.GetEndorsementStatus). */
export interface DdbEndorsementStatus {
  requestId: string;
  /**
   * Node-defined lifecycle: "pending" while endorsing, then "completed" on a successful 2f+1 quorum
   * (gossip/ddb dual-consensus). A request evicted after completion makes getEndorsementStatus error
   * "endorsement request not found" rather than returning a terminal status.
   */
  status: string;
  request?: { operation: number; schemaName: string; requester: string; timestamp: number };
  endorsement?: { operationHash: string; dataHash: string; signatures: number; validators: number; timestamp: number };
  error?: string;
  [k: string]: unknown;
}

/** ddb_getConsensusStats result. */
export interface DdbConsensusStats {
  pendingRequests: number;
  completedEndorsements: number;
  validatorCount: number;
  threshold: number;
}

/** ddb_getDdbValidators result — the DDB committee + BFT threshold. */
export interface DdbValidatorSet {
  validators: string[];
  count: number;
  threshold: number;
}

/** ddb_getStats result — this node's DDB storage counters. */
export interface DdbStorageStats {
  schemaCount: number;
  tableCount: number;
  operationCount: number;
}

// ---------------------------------------------------------------------------
// Client-side DDB operation signing (T2.1 caller-auth). A production node no longer signs DDB
// operations on a caller's behalf (that was a privilege-escalation foot-gun on any RPC-exposed
// node): the caller signs the operation's CanonicalOperationHash with their own ML-DSA-87 key and
// submits it via ddb_submitSignedOp. This block is a faithful TS port of the chain's canonical
// encoding (gossip/ddb/canonical.go) — it is CONSENSUS-CRITICAL and pinned by a golden vector in
// tests/ddb.test.ts that must match the node's TestCanonicalOperationHashGoldenVector byte-for-byte.
// ---------------------------------------------------------------------------

// Numeric op-type tags, matching inter.DdbOperationType (iota order). Only mutation ops are signable.
const DDB_OP_TYPE = {
  createschema: 0,
  // updateschema is inter.DdbUpdateSchema == 1. It was missing here, which left contract UPGRADES with
  // no client-signed path at all: the node has supported them on both RPCs since 5e9d431, but the only
  // way to reach DdbUpdateSchema from outside was hand-rolled ML-DSA signing or running the node with
  // NEC_DDB_ALLOW_LOCAL_SIGN=1. Schema evolution is strictly additive and a contract cannot be deleted,
  // so upgrade is the ONLY way a deployed data contract ever changes.
  updateschema: 1,
  // deleteschema is inter.DdbDeleteSchema == 2. It is NOT an unimplemented type: the node has a full
  // tombstone path for it -- an authorization rule (gossip/ddb/authz.go `case inter.DdbDeleteSchema`,
  // owner-or-admin), an endorsement branch (endorsement_consensus.go, "contract deletion approved"),
  // SQL (operation_sql.go -> ddbschema.GenerateTombstoneSQLByDbName) and a place in the block-validity
  // allow-list (main_chain_consensus.go verifyOperationValidity). What it does NOT have is a
  // convenience RPC: PublicDdbAPI has no DeleteSchema method at all, so ddb_submitSignedOp is the
  // ONLY way to reach it from anywhere. Omitting it here therefore made retiring a contract
  // unreachable from every client, exactly as omitting updateschema did for upgrades.
  deleteschema: 2,
  callprocedure: 7,
  grantrole: 8,
  revokerole: 9,
} as const;
type DdbOpTypeName = keyof typeof DDB_OP_TYPE;

// Domain-separation prefix + version byte (11 bytes): the ASCII "NEC-DDB-OP" then the 0x01 version.
const DDB_OP_DOMAIN = Uint8Array.of(0x4e, 0x45, 0x43, 0x2d, 0x44, 0x44, 0x42, 0x2d, 0x4f, 0x50, 0x01); // "NEC-DDB-OP" + 0x01 == Go canonicalOpDomain
// The v2 domain (SEC-03): the same ASCII, version byte 0x02 == Go canonicalOpDomainV2. A bump is a client break.
const DDB_OP_DOMAIN_V2 = Uint8Array.of(0x4e, 0x45, 0x43, 0x2d, 0x44, 0x44, 0x42, 0x2d, 0x4f, 0x50, 0x02);
// The node's v2 admission ceiling on Expiry - Timestamp, and the SDK's default lifetime (well inside it).
const DDB_MAX_EXPIRY_WINDOW_SECONDS = BigInt(900);
const DDB_DEFAULT_EXPIRY_SECONDS = BigInt(300);

function ddbStripHex(h: string): string {
  return h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
}
function ddbHexToBytes(h: string): Uint8Array {
  const s = ddbStripHex(h);
  const clean = s.length % 2 ? '0' + s : s;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function ddbBytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function ddbConcat(...arrs: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const DDB_U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

/**
 * The largest value buildDdbOp will accept as a unix-SECONDS timestamp: 1e11, the year 5138.
 *
 * A magnitude check, deliberately NOT the node's freshness window. buildDdbOp is also used to build
 * fixed vectors and capability probes — both wallets build one with `timestamp: 1` to ask whether the
 * bundled SDK encodes the deleteschema type at all, and that probe reads a THROW as "no" — so a
 * window check here would quietly turn an SDK upgrade into a wallet that refuses contract retirement
 * forever. This catches the one mistake that has no local symptom (milliseconds, ~1.7e12 today, which
 * every node refuses as ~53,000 years in the future) and leaves small deliberate values alone.
 */
const DDB_MAX_TIMESTAMP_SECONDS = BigInt(100000000000);

/**
 * Normalize one of the three numeric operation fields (timestamp, gasLimit, nonce) to the exact
 * uint64 the chain will read, or throw.
 *
 * Every caller of this -- the hash preimage AND the JSON envelope -- goes through it, which is the
 * point. The node reads the number twice: once as the 8 big-endian bytes inside the signed preimage,
 * and once as the `0x…` hexutil.Uint64 in the envelope it re-hashes to check the signature. If those
 * two ever describe different numbers, the wallet produces a perfectly valid ML-DSA-87 signature over
 * a preimage the node cannot reproduce, and the only symptom is "caller signature verification
 * failed" from a node that will not say which field disagreed. Deriving both from one validated
 * bigint makes that divergence unrepresentable rather than merely unlikely.
 *
 * A non-integer used to reach both sides differently: the preimage truncated it and the envelope
 * emitted `0x3e8.8`. A Number above 2^53 was silently rounded before it was ever encoded. Both are
 * refused here, at the call site, where the caller can still see which value was wrong.
 */
function ddbU64(field: string, v: number | bigint): bigint {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`DDB ${field} must be a finite integer, got ${v}`);
    if (!Number.isInteger(v)) throw new Error(`DDB ${field} must be a whole number, got ${v}`);
    if (!Number.isSafeInteger(v)) {
      throw new Error(
        `DDB ${field} ${v} exceeds Number.MAX_SAFE_INTEGER and has already lost precision; pass a bigint`,
      );
    }
  }
  const x = BigInt(v);
  if (x < BigInt(0)) throw new Error(`DDB ${field} must not be negative, got ${x}`);
  if (x > DDB_U64_MAX) throw new Error(`DDB ${field} does not fit in a uint64: ${x}`);
  return x;
}

/** The envelope form of a validated uint64: hexutil.Uint64, lowercase, no leading zeros. */
function ddbU64Hex(x: bigint): string {
  return '0x' + x.toString(16);
}

// big-endian uint64 (matches Go binary.BigEndian.PutUint64).
function ddbU64BE(v: number | bigint): Uint8Array {
  let x = typeof v === 'bigint' ? v : ddbU64('value', v);
  const b = new Uint8Array(8);
  const mask = BigInt(0xff);
  const eight = BigInt(8);
  for (let i = 7; i >= 0; i--) { b[i] = Number(x & mask); x = x >> eight; }
  return b;
}
// length-prefixed field (8-byte big-endian length, then data) — matches Go appendLenPrefixed.
function ddbLenPrefixed(data: Uint8Array): Uint8Array {
  return ddbConcat(ddbU64BE(data.length), data);
}

/**
 * A fresh 64-bit replay-protection nonce, from the platform CSPRNG.
 *
 * `randomBytes` THROWS when no CSPRNG is available rather than falling back to `Math.random()`. That
 * is deliberate: a predictable nonce silently removes the replay protection it exists to provide, and
 * a signer that fails loudly is far better than one that keeps working and is forgeable. (This wallet
 * family has been bitten by exactly that substitution before.)
 */
function ddbRandomNonce(): bigint {
  const b = randomBytes(8);
  let n = BigInt(0);
  for (let i = 0; i < 8; i++) n = (n << BigInt(8)) | BigInt(b[i]);
  return n;
}

/**
 * canonicalDdbOperationHash is the 32-byte Keccak-256 an off-node caller signs to authorize a DDB
 * operation — the exact value the chain recomputes in gossip/ddb.CanonicalOperationHash. Encoding:
 *   keccak256( "NEC-DDB-OP\x01" || typeByte || lenPrefix(schemaName) || lenPrefix(data) ||
 *              from(20B) || u64BE(timestamp) || u64BE(gasLimit) || u64BE(nonce) )
 * `data` are the EXACT operation payload bytes (must be compact JSON — the bytes you submit). Advanced
 * callers can use this to sign an operation manually; the Ddb.*Signed methods do it for you.
 */
function canonicalDdbOperationBytes(
  typeByte: number,
  schemaName: string,
  data: Uint8Array,
  fromAddr: string,
  timestamp: number | bigint,
  gasLimit: number | bigint,
  nonce: number | bigint,
): Uint8Array {
  const enc = new TextEncoder();
  const fromBytes = ddbHexToBytes(fromAddr);
  if (fromBytes.length !== 20) throw new Error(`invalid from address length: ${fromBytes.length} (expected 20)`);
  // Validated HERE as well as in buildDdbOp, because this function is exported: an advanced caller
  // signing an operation by hand reaches the preimage without going through the envelope builder.
  const ts = ddbU64('timestamp', timestamp);
  const gas = ddbU64('gasLimit', gasLimit);
  const nce = ddbU64('nonce', nonce);
  return ddbConcat(
    DDB_OP_DOMAIN, // already includes the 0x01 version byte
    Uint8Array.of(typeByte & 0xff),
    ddbLenPrefixed(enc.encode(schemaName)),
    ddbLenPrefixed(data),
    fromBytes,
    ddbU64BE(ts),
    ddbU64BE(gas),
    // The nonce is the LAST field, immediately after gasLimit. This position is not a style choice:
    // the node appends it in exactly this place (gossip/ddb/canonical.go, `b = appendU64(b, op.Nonce)`)
    // and hashes the result, so a signer that omits it or moves it produces a hash the chain will not
    // reproduce and the operation is rejected with "caller signature verification failed".
    ddbU64BE(nce),
  );
}

export function canonicalDdbOperationHash(
  typeByte: number,
  schemaName: string,
  data: Uint8Array,
  fromAddr: string,
  timestamp: number | bigint,
  gasLimit: number | bigint,
  nonce: number | bigint,
): Uint8Array {
  return keccak_256(canonicalDdbOperationBytes(typeByte, schemaName, data, fromAddr, timestamp, gasLimit, nonce));
}

/**
 * canonicalDdbRequestId is the endorsement REQUEST ID — keccak256(canonicalOperationBytes || requester) —
 * matching the chain's gossip/ddb.CanonicalRequestID. This is the key Ddb.getEndorsementStatus /
 * waitForEndorsement track (NOT the operation hash). The signed *Signed methods return this value.
 */
export function canonicalDdbRequestId(
  typeByte: number,
  schemaName: string,
  data: Uint8Array,
  fromAddr: string,
  timestamp: number | bigint,
  gasLimit: number | bigint,
  nonce: number | bigint,
  requester: string,
): Uint8Array {
  const reqBytes = ddbHexToBytes(requester);
  if (reqBytes.length !== 20) throw new Error(`invalid requester length: ${reqBytes.length} (expected 20)`);
  return keccak_256(ddbConcat(
    canonicalDdbOperationBytes(typeByte, schemaName, data, fromAddr, timestamp, gasLimit, nonce),
    reqBytes,
  ));
}

// ---------------------------------------------------------------------------
// Operation preimage v2 (SEC-03): gossip/ddb/op_preimage.go canonicalOperationBytesV2
// ---------------------------------------------------------------------------

/** Every field of a v2 operation preimage. `type` is the numeric inter.DdbOperationType (0..9). */
export interface DdbCanonicalOpV2 {
  type: number;
  chainId: number | bigint | string;
  schemaName: string;
  /** The EXACT compact-JSON payload bytes, as in v1. */
  data: Uint8Array;
  from: string;
  timestamp: number | bigint;
  gasLimit: number | bigint;
  nonce: number | bigint;
  expiry: number | bigint;
  keyVersion: number | bigint;
}

// Go's encoding/json matches a struct field by case-insensitive name (bytes.EqualFold / foldName). For
// the letters of "contract_address" the only non-ASCII runes that fold onto them are U+017F (long s ->
// s) and U+212A (Kelvin sign -> k).
function ddbGoJsonKeyIs(key: string, field: string): boolean {
  const k = key.replace(/\u017f/g, 's').replace(/\u212a/g, 'k');
  return /^[\x00-\x7f]*$/.test(k) && k.toLowerCase() === field;
}

// The top-level members of a JSON object text, IN ORDER and WITH duplicates -- JSON.parse keeps only the
// last of a duplicated key, and Go does not: it decodes every one in turn, and a null or a type error
// on an earlier one matters. `text` is known valid JSON (the caller parsed it first).
function ddbTopLevelMembers(text: string): Array<[string, unknown]> {
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const str = (): string => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = (): unknown => {
    const start = i;
    if (text[i] === '"') {
      str();
    } else if (text[i] === '{' || text[i] === '[') {
      let depth = 0;
      do {
        if (text[i] === '"') { str(); continue; }
        if (text[i] === '{' || text[i] === '[') depth++;
        else if (text[i] === '}' || text[i] === ']') depth--;
        i++;
      } while (depth > 0);
    } else {
      while (i < text.length && !',}] \t\n\r'.includes(text[i])) i++; // number, true, false, null
    }
    return JSON.parse(text.slice(start, i));
  };
  const out: Array<[string, unknown]> = [];
  ws();
  if (text[i] !== '{') return out;
  i++;
  for (;;) {
    ws();
    if (text[i] === '}') return out;
    const key = str();
    ws(); i++; // ':'
    ws();
    out.push([key, value()]);
    ws();
    if (text[i] === ',') i++;
  }
}

/**
 * The database identity a v2 preimage binds -- Go preimageDbIdentity. For CreateSchema (0) and
 * UpdateSchema (1) it is the db_name the node DERIVES from Data's top-level `contract_address`
 * (ddbschema.DeriveDbName: "c_" + lower-case hex, no 0x), not SchemaName, because for an upgrade the
 * two differ and the derived one is what the operation actually writes. It is "" when Data does not
 * decode as a contract definition or the address is not hex. Every other type binds SchemaName.
 *
 * Decoding follows encoding/json for this one field: case-insensitive key, every duplicate applied in
 * order (so the last wins), null leaves the value alone, and a non-string value is a decode error. It
 * does NOT reproduce a type error in some OTHER field of ContractDefinition (the node would then bind
 * ""); such a definition is not deployable, and the mismatch only fails the signature.
 */
export function ddbOpPreimageDbIdentity(typeByte: number, schemaName: string, data: Uint8Array): string {
  if (typeByte !== 0 && typeByte !== 1) return schemaName;
  const text = new TextDecoder().decode(data);
  let top: unknown;
  try {
    top = JSON.parse(text);
  } catch {
    return '';
  }
  if (top === null) return ''; // Go decodes null into the zero struct: no address, so ""
  if (typeof top !== 'object' || Array.isArray(top)) return '';
  let addr = '';
  for (const [k, v] of ddbTopLevelMembers(text)) {
    if (!ddbGoJsonKeyIs(k, 'contract_address')) continue;
    if (v === null) continue;
    if (typeof v !== 'string') return '';
    addr = v;
  }
  // DeriveDbName: TrimSpace, lower-case, strip one "0x", non-empty lower-case hex.
  const h = addr.trim().toLowerCase().replace(/^0x/, '');
  return h && /^[0-9a-f]+$/.test(h) ? 'c_' + h : '';
}

/**
 * The v2 operation preimage, byte for byte as the node builds it once FeatureDdbOpPreimageV2 is active:
 *   "NEC-DDB-OP\x02" || type(1B, offset 11 as in v1) || chainId(32B word) || lenPrefix(dbIdentity) ||
 *   lenPrefix(schemaName) || lenPrefix(data) || from(20B) || u64BE(timestamp) || u64BE(gasLimit) ||
 *   u64BE(nonce) || u64BE(expiry) || u64BE(keyVersion)
 * Pinned against the node's canonicalOpVectorsV2 in tests/ddb-preimage-v2.test.ts.
 */
export function canonicalDdbOperationBytesV2(op: DdbCanonicalOpV2): Uint8Array {
  // The node has ten types (0..9). A value outside that range is refused rather than masked to a byte:
  // `undefined & 0xff` is 0, which is how necjs 3.0.0 signed a delete as a CreateSchema.
  if (!Number.isInteger(op.type) || op.type < 0 || op.type > 9) {
    throw new Error(`unknown DDB operation type ${JSON.stringify(op.type)}`);
  }
  const fromBytes = ddbHexToBytes(op.from);
  if (fromBytes.length !== 20) throw new Error(`invalid from address length: ${fromBytes.length} (expected 20)`);
  const enc = new TextEncoder();
  return ddbConcat(
    DDB_OP_DOMAIN_V2,
    Uint8Array.of(op.type),
    ddbChainIdWord(op.chainId),
    ddbLenPrefixed(enc.encode(ddbOpPreimageDbIdentity(op.type, op.schemaName, op.data))),
    ddbLenPrefixed(enc.encode(op.schemaName)),
    ddbLenPrefixed(op.data),
    fromBytes,
    ddbU64BE(ddbU64('timestamp', op.timestamp)),
    ddbU64BE(ddbU64('gasLimit', op.gasLimit)),
    ddbU64BE(ddbU64('nonce', op.nonce)),
    ddbU64BE(ddbU64('expiry', op.expiry)),
    ddbU64BE(ddbU64('keyVersion', op.keyVersion)),
  );
}

/** keccak256(canonicalDdbOperationBytesV2(op)) -- the 32 bytes a v2 caller signs. */
export function canonicalDdbOperationHashV2(op: DdbCanonicalOpV2): Uint8Array {
  return keccak_256(canonicalDdbOperationBytesV2(op));
}

/** The v2 endorsement request id: keccak256(canonicalDdbOperationBytesV2(op) || requester). */
export function canonicalDdbRequestIdV2(op: DdbCanonicalOpV2, requester: string): Uint8Array {
  const reqBytes = ddbHexToBytes(requester);
  if (reqBytes.length !== 20) throw new Error(`invalid requester length: ${reqBytes.length} (expected 20)`);
  return keccak_256(ddbConcat(canonicalDdbOperationBytesV2(op), reqBytes));
}

// ---------------------------------------------------------------------------
// DB-01 transactions (NEC-77): gossip/ddb/txn.go, docs/design/ddb-transactions.md
// ---------------------------------------------------------------------------

// == Go txnDomain / txnMemberTag. A bump of either is a client break.
const DDB_TXN_DOMAIN = new TextEncoder().encode('NEC-DDB-TXN\x01');
const DDB_TXN_MEMBER_TAG = new TextEncoder().encode('NEC-DDB-TXN-MEMBER\x01');

/** The node's per-transaction ceilings (gossip/ddb MaxDdbOpsPerBatch, MaxDdbTxnReads). Governance may only lower them. */
export const DDB_TXN_MAX_OPS = 4;
export const DDB_TXN_MAX_READS = 16;

/**
 * One entry of a transaction's read set. No `table` (and no `pk`) reads the WHOLE database: any write to
 * it after the read version conflicts. Otherwise `table` plus the row's primary-key values, rendered as
 * the node renders them (null for a NULL key part), name one row.
 */
export interface DdbTxnRead {
  table?: string;
  pk?: Array<string | null>;
}

/** A member's transaction header on the wire (inter.DdbTxn); only member 0 carries the read set. */
export interface DdbTxnHeaderEnvelope {
  id: string;
  index: number;
  count: number;
  read_version?: number;
  reads?: Array<{ table?: string; pk?: Array<{ String: string; Valid: boolean }> }>;
}

function ddbU32BE(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`not a uint32: ${n}`);
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

// The node's static shape rules (checkTxnMembersStatic's count/read limits and checkTxnReads), so a client
// learns a refusal before it spends a round.
function ddbCheckTxnShape(nOps: number, reads: DdbTxnRead[]): void {
  if (nOps < 1 || nOps > DDB_TXN_MAX_OPS) throw new Error(`a transaction carries 1..${DDB_TXN_MAX_OPS} operations, not ${nOps}`);
  if (reads.length > DDB_TXN_MAX_READS) {
    throw new Error(`a transaction's read set carries at most ${DDB_TXN_MAX_READS} entries, not ${reads.length}`);
  }
  reads.forEach((r, i) => {
    const table = r.table ?? '';
    const pk = r.pk ?? [];
    if (table === '' && pk.length !== 0) throw new Error(`read ${i} names key values but no table`);
    if (table !== '' && pk.length === 0) {
      throw new Error(`read ${i} names table ${table} but no key values: read the whole database instead (no table)`);
    }
  });
}

/**
 * A transaction's id -- Go txnCommitment under the v2 preimage:
 *   keccak256( "NEC-DDB-TXN\x01" || u32BE(K) || u64BE(readVersion) || u32BE(len(reads)) ||
 *              each read: lenPrefix(table) || u32BE(len(pk)) || each key part: valid(1B) || lenPrefix(value) ||
 *              each member: keccak256(canonicalDdbOperationBytesV2(member)) )
 * The members are hashed WITHOUT their headers (the header carries this id). Pinned against the node's
 * TestTransactionVectors in tests/ddb-transaction.test.ts.
 */
export function canonicalDdbTxnId(members: DdbCanonicalOpV2[], readVersion: number | bigint, reads: DdbTxnRead[]): Uint8Array {
  ddbCheckTxnShape(members.length, reads);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [
    DDB_TXN_DOMAIN, ddbU32BE(members.length), ddbU64BE(ddbU64('readVersion', readVersion)), ddbU32BE(reads.length),
  ];
  for (const r of reads) {
    const pk = r.pk ?? [];
    parts.push(ddbLenPrefixed(enc.encode(r.table ?? '')), ddbU32BE(pk.length));
    for (const v of pk) parts.push(Uint8Array.of(v === null ? 0 : 1), ddbLenPrefixed(enc.encode(v ?? '')));
  }
  for (const m of members) parts.push(canonicalDdbOperationHashV2(m));
  return keccak_256(ddbConcat(...parts));
}

/**
 * The 32 bytes a transaction member signs: its v2 preimage with the member header appended --
 * canonicalDdbOperationBytesV2(op) || "NEC-DDB-TXN-MEMBER\x01" || id || u32BE(index) || u32BE(count)
 * (Go appendTxnMember). The read set is not repeated here; the id binds it.
 */
export function canonicalDdbTxnMemberHash(op: DdbCanonicalOpV2, id: Uint8Array, index: number, count: number): Uint8Array {
  if (id.length !== 32) throw new Error(`invalid transaction id length: ${id.length} (expected 32)`);
  if (!(index >= 0 && index < count)) throw new Error(`member index ${index} is outside 0..${count - 1}`);
  return keccak_256(ddbConcat(canonicalDdbOperationBytesV2(op), DDB_TXN_MEMBER_TAG, id, ddbU32BE(index), ddbU32BE(count)));
}

/**
 * The skip reasons a transaction resolves by re-reading and resubmitting (Go IsRetryableTxnSkip):
 * a read-set conflict, a read version older than the chain's recorded window, and the lost-update
 * refusals its writes can hit.
 */
export function isRetryableDdbTxnSkip(reason: string | undefined): boolean {
  return reason === 'txn_read_conflict' || reason === 'txn_read_too_old' ||
    reason === 'row_lock_lost' || reason === 'state_chain_break';
}

// ---------------------------------------------------------------------------
// Signed reads (ddb_signedSelect)
// ---------------------------------------------------------------------------

// Domain-separation prefix + version byte (13 bytes): the ASCII "NEC-DDB-READ" then the 0x02 version.
// == Go canonicalSignedReadDomain (ethapi/ddb_signed_read.go). Distinct from DDB_OP_DOMAIN on purpose:
// reads and writes are signed by the SAME account key, so a read signature must never be a valid
// operation signature. 0x02 (SEC-09) added the join table set; a bump here is a client break.
const DDB_READ_DOMAIN = Uint8Array.of(0x4e, 0x45, 0x43, 0x2d, 0x44, 0x44, 0x42, 0x2d, 0x52, 0x45, 0x41, 0x44, 0x02); // "NEC-DDB-READ" + 0x02

// The node refuses a signed read that names more join tables than this (ethapi maxSignedJoinTables).
const DDB_MAX_SIGNED_JOIN_TABLES = 32;

const DDB_U256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

/** A chain id as the 32-byte big-endian word the node hashes (common.BigToHash(chainID)). */
function ddbChainIdWord(chainId: number | bigint | string): Uint8Array {
  if (typeof chainId === 'number' && !Number.isSafeInteger(chainId)) {
    throw new Error(`DDB chainId must be a safe integer, got ${chainId}; pass a bigint or hex string`);
  }
  let x: bigint;
  try {
    x = BigInt(chainId);
  } catch {
    throw new Error(`DDB chainId is not an integer: ${JSON.stringify(chainId)}`);
  }
  if (x < BigInt(0) || x > DDB_U256_MAX) throw new Error(`DDB chainId does not fit in a uint256 word: ${x}`);
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { b[i] = Number(x & BigInt(0xff)); x >>= BigInt(8); }
  return b;
}

// Byte-wise UTF-8 order, which is Go's string order. JS's default sort compares UTF-16 code units and
// disagrees with it outside the BMP -- and the node refuses a join list that is not strictly ascending.
function ddbCompareUtf8(a: string, b: string): number {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  for (let i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/**
 * The join table set in the ONE form the node accepts (ethapi checkSignedJoinTables): every table the
 * query joins other than the base table, sorted ascending, no duplicates, no empties, at most 32.
 * Two orders of the same set would be two preimages for the same request, so the SDK picks the order.
 */
function canonicalDdbJoinTables(tableName: string, joinTables: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const t of [...joinTables].sort(ddbCompareUtf8)) {
    if (t === '') throw new Error('DDB joinTables contains an empty table name');
    if (t === tableName || out[out.length - 1] === t) continue;
    out.push(t);
  }
  if (out.length > DDB_MAX_SIGNED_JOIN_TABLES) {
    throw new Error(`DDB joinTables names ${out.length} tables; at most ${DDB_MAX_SIGNED_JOIN_TABLES} may be signed into one read`);
  }
  return out;
}

/**
 * canonicalDdbSignedReadBytes is the exact preimage of the node's ethapi.SignedReadHash -- what a
 * caller signs to read `schemaName`.`tableName` (plus `joinTables`) as `fromAddr` through
 * ddb_signedSelect. Pinned against the node's own golden vector (TestSignedReadHashGoldenVector):
 *
 *   "NEC-DDB-READ\x02" || chainId(32B word) || lenPrefix(schemaName) || lenPrefix(tableName) ||
 *   u64BE(count(joinTables)) || lenPrefix(joinTables[i])... || from(20B) || u64BE(timestamp) || u64BE(nonce)
 *
 * `joinTables` are hashed in the order given: pass them canonical (buildDdbSignedRead does that).
 * The QUERY itself -- filters, join conditions, ordering, limit -- is deliberately NOT in the preimage;
 * see the node's SignedReadHash for why.
 */
export function canonicalDdbSignedReadBytes(
  chainId: number | bigint | string,
  schemaName: string,
  tableName: string,
  joinTables: readonly string[],
  fromAddr: string,
  timestamp: number | bigint,
  nonce: number | bigint,
): Uint8Array {
  const enc = new TextEncoder();
  const fromBytes = ddbHexToBytes(fromAddr);
  if (fromBytes.length !== 20) throw new Error(`invalid from address length: ${fromBytes.length} (expected 20)`);
  const ts = ddbU64('timestamp', timestamp);
  const nce = ddbU64('nonce', nonce);
  return ddbConcat(
    DDB_READ_DOMAIN, // already includes the 0x02 version byte
    ddbChainIdWord(chainId),
    ddbLenPrefixed(enc.encode(schemaName)),
    ddbLenPrefixed(enc.encode(tableName)),
    ddbU64BE(joinTables.length),
    ...joinTables.map((t) => ddbLenPrefixed(enc.encode(t))),
    fromBytes,
    ddbU64BE(ts),
    ddbU64BE(nce),
  );
}

/** keccak256(canonicalDdbSignedReadBytes(...)) -- the 32 bytes the node verifies callerSig over. */
export function canonicalDdbSignedReadHash(
  chainId: number | bigint | string,
  schemaName: string,
  tableName: string,
  joinTables: readonly string[],
  fromAddr: string,
  timestamp: number | bigint,
  nonce: number | bigint,
): Uint8Array {
  return keccak_256(canonicalDdbSignedReadBytes(chainId, schemaName, tableName, joinTables, fromAddr, timestamp, nonce));
}

// ---------------------------------------------------------------------------
// Signed read procedures (ddb_signedCallReadProcedure, REL-02b)
// ---------------------------------------------------------------------------

// Domain-separation prefix + version byte (17 bytes): the ASCII "NEC-DDB-READPROC" then the 0x01 version.
// == Go canonicalSignedReadProcDomain (ethapi/ddb_signed_read_procedure.go). A SEPARATE domain from
// DDB_READ_DOMAIN: with no args the two preimages have the same layout, so the prefix is the only thing
// that stops a signed read of table T being a signed call of procedure T. A bump here is a client break.
const DDB_READPROC_DOMAIN = Uint8Array.of(
  0x4e, 0x45, 0x43, 0x2d, 0x44, 0x44, 0x42, 0x2d, 0x52, 0x45, 0x41, 0x44, 0x50, 0x52, 0x4f, 0x43, 0x01,
); // "NEC-DDB-READPROC" + 0x01

// The node refuses a signed call with more arguments than this (ethapi maxSignedReadProcArgs, which is
// Postgres' FUNC_MAX_ARGS).
const DDB_MAX_SIGNED_READPROC_ARGS = 100;

/**
 * canonicalDdbSignedReadProcedureBytes is the exact preimage of the node's
 * ethapi.SignedReadProcedureHash -- what a caller signs to call read procedure `procedure` of
 * `schemaName` with `args` as `fromAddr` through ddb_signedCallReadProcedure. Pinned against the node's
 * golden vector (TestSignedReadProcedureHashGoldenVector):
 *
 *   "NEC-DDB-READPROC\x01" || chainId(32B word) || lenPrefix(schemaName) || lenPrefix(procedure) ||
 *   u64BE(count(args)) || lenPrefix(args[i])... || from(20B) || u64BE(timestamp) || u64BE(nonce)
 *
 * Unlike a signed select, the whole call is signed: the procedure name and every argument, in order.
 */
export function canonicalDdbSignedReadProcedureBytes(
  chainId: number | bigint | string,
  schemaName: string,
  procedure: string,
  args: readonly string[],
  fromAddr: string,
  timestamp: number | bigint,
  nonce: number | bigint,
): Uint8Array {
  const enc = new TextEncoder();
  const fromBytes = ddbHexToBytes(fromAddr);
  if (fromBytes.length !== 20) throw new Error(`invalid from address length: ${fromBytes.length} (expected 20)`);
  const ts = ddbU64('timestamp', timestamp);
  const nce = ddbU64('nonce', nonce);
  return ddbConcat(
    DDB_READPROC_DOMAIN, // already includes the 0x01 version byte
    ddbChainIdWord(chainId),
    ddbLenPrefixed(enc.encode(schemaName)),
    ddbLenPrefixed(enc.encode(procedure)),
    ddbU64BE(args.length),
    ...args.map((a) => ddbLenPrefixed(enc.encode(a))),
    fromBytes,
    ddbU64BE(ts),
    ddbU64BE(nce),
  );
}

/** keccak256(canonicalDdbSignedReadProcedureBytes(...)) -- the 32 bytes the node verifies callerSig over. */
export function canonicalDdbSignedReadProcedureHash(
  chainId: number | bigint | string,
  schemaName: string,
  procedure: string,
  args: readonly string[],
  fromAddr: string,
  timestamp: number | bigint,
  nonce: number | bigint,
): Uint8Array {
  return keccak_256(canonicalDdbSignedReadProcedureBytes(chainId, schemaName, procedure, args, fromAddr, timestamp, nonce));
}

// One-time deprecation warning for the legacy server-signed DDB methods (fires once per method per process).
const _ddbWarned = new Set<string>();
function ddbWarnDeprecated(method: string, replacement: string): void {
  if (_ddbWarned.has(method)) return;
  _ddbWarned.add(method);
  // eslint-disable-next-line no-console
  console.warn(
    `[necjs] Ddb.${method} is DEPRECATED and server-signed — it requires the node to run with ` +
    `NEC_DDB_ALLOW_LOCAL_SIGN=1 and fails closed on a production node. Use Ddb.${replacement} instead.`,
  );
}

// Lazy ML-DSA-87 loader (mirrors tx-signer.getMldsa) — the bundled noble-post-quantum primitive.
let _ddbMldsa: any = null;
async function ddbGetMldsa(): Promise<any> {
  if (_ddbMldsa) return _ddbMldsa;
  // @ts-ignore - noble-post-quantum.js is a bundled JS file without TypeScript declarations
  const noblePQ = (await import('./noble-post-quantum.js')) as any;
  const algorithms = noblePQ.default || noblePQ;
  _ddbMldsa = algorithms.ml_dsa87;
  if (!_ddbMldsa) throw new Error('ml_dsa87 not available in bundled noble-post-quantum');
  return _ddbMldsa;
}


/**
 * What the SDK needs from whoever holds the key, so that "sign a DDB operation" does not have to mean
 * "hand the SDK a raw ML-DSA-87 private key".
 *
 * The raw-key form is fine for a script or CI, and it stays supported. It is not fine for a wallet:
 * a browser extension, a mobile wallet or a hardware device holds the key precisely so that nothing
 * else sees it, and an API whose only entry point is `(privateKey: string, ...)` locks all three out.
 * That is why no wallet can authorize a DDB write today.
 *
 * Three obligations, and each one is load-bearing:
 *
 * - `getAddress()` must return `keccak256(rawMLDSAPublicKey)[12:]`. The node checks `op.From` against
 *   the public key you send (gossip/ddb.VerifyCallerSignature), so an address derived any other way
 *   is rejected. In particular it is NOT the ML-KEM-derived data-wallet address.
 * - `getPublicKey()` returns the RAW ML-DSA-87 public key bytes, which travel on the wire as
 *   `callerPubKey` and are what the node verifies against.
 * - `signDdbHash()` signs the 32 bytes it is given, AS GIVEN. It is already the canonical operation
 *   hash. Do not apply the EIP-191 personal-message prefix to it -- reusing a `personal_sign` path
 *   here produces a signature over the wrong digest, and the operation is rejected.
 */
export interface DdbSigner {
  getAddress(): string | Promise<string>;
  getPublicKey(): Uint8Array | Promise<Uint8Array>;
  signDdbHash(hash: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/** Anything the write methods accept as the signing party: a raw private key, or a {@link DdbSigner}. */
export type DdbSignerLike = string | DdbSigner;

/**
 * Wrap a raw ML-DSA-87 private key as a {@link DdbSigner}. This is what the SDK does internally when
 * you pass a key string, so the raw-key path and the wallet path are the same code below the signer.
 */
export function privateKeyDdbSigner(privateKey: string): DdbSigner {
  let cached: { pub: Uint8Array; addr: string } | null = null;
  const load = async () => {
    if (cached) return cached;
    const mldsa = await ddbGetMldsa();
    const pub: Uint8Array = mldsa.derivePublicKey(ddbHexToBytes(privateKey));
    cached = { pub, addr: '0x' + ddbBytesToHex(keccak_256(pub).slice(-20)) };
    return cached;
  };
  return {
    async getAddress() { return (await load()).addr; },
    async getPublicKey() { return (await load()).pub; },
    async signDdbHash(hash: Uint8Array) {
      const mldsa = await ddbGetMldsa();
      return mldsa.sign(ddbHexToBytes(privateKey), hash) as Uint8Array;
    },
  };
}

function toDdbSigner(s: DdbSignerLike): DdbSigner {
  return typeof s === 'string' ? privateKeyDdbSigner(s) : s;
}

/** The `ddb_submitSignedOp` envelope, exactly as the node parses it. */
export interface DdbSignedOpEnvelope {
  type: string;
  schemaName: string;
  data: string;
  from: string;
  timestamp: string;
  gasLimit: string;
  nonce: string;
  /** Preimage v2 only (SEC-03): unix seconds, hexutil.Uint64. Absent under v1, as a pre-SEC-03 client sends. */
  expiry?: string;
  /** Preimage v2 only (SEC-03): hexutil.Uint64. */
  keyVersion?: string;
  callerPubKey: string;
  callerSig: string;
}

/**
 * What a submitted DDB operation gives you back.
 *
 * TWO handles, because they answer different questions and only one of them is terminal:
 *
 * - `requestId` tracks the ENDORSEMENT round (ddb_getEndorsementStatus). Its "completed" means a 2f+1
 *   quorum signed, which happens BEFORE block validity. It is not proof the write landed.
 * - `commitTxHash` is what ddb_submitSignedOp actually returns -- the leader's commit transaction --
 *   and it is the only input ddb_getCommitStatus accepts. That RPC is the one that can say `skipped`
 *   (state-chain break, lost row lock, unpayable gas) and why.
 *
 * The distinction is not academic. gossip/c_block_callbacks.go indexes tx positions only over the
 * NON-skipped set, so a skipped commit tx returns null from eth_getTransactionByHash and
 * eth_getTransactionReceipt forever -- identical to a tx that was never mined. Without the commit
 * hash, "skipped" and "still pending" are the same answer, and the node's own comment records that
 * this is how a revokeRole was once reported as succeeding while the account kept the role on every
 * node. The SDK used to discard the RPC's return value, so no caller could ever ask.
 */
export interface DdbSubmitReceipt {
  /** keccak256(canonicalOperationBytes || requester) — the endorsement handle. */
  requestId: string;
  /** The commit transaction hash the node returned. Feed it to getCommitStatus / waitForCommit. */
  commitTxHash: string;
}

/** ddb_getCommitStatus result (mirrors PublicDdbAPI.GetCommitStatus). */
export interface DdbCommitStatus {
  txHash: string;
  /**
   * "applied"  — included at block validity; the write is authoritative on chain.
   * "skipped"  — excluded on EVERY node; `reason` says why. The write did NOT happen.
   * "unknown"  — this node has no verdict yet (not finalized, out of the retention window, or the
   *              node restarted; the skip registry is in-memory and is not rebuilt at boot).
   *              Deliberately NOT success.
   */
  status: 'applied' | 'skipped' | 'unknown' | (string & {});
  blockNumber?: string;
  reason?: string;
  /** Whether THIS node's Postgres carries the ddb_applied_commits marker yet (apply is async). */
  durable?: boolean;
  durableBlockNumber?: string;
  /** DB-03: present when applied. Pass it as `minVersion` to read this write through any node. */
  readToken?: string;
  [k: string]: unknown;
}

/**
 * The write outcome per DECIDE-04: `committed` is reported at durable, and finality is a SEPARATE signal.
 * `readToken` is what a later read passes as `minVersion` to see this write on any ingress node.
 */
export interface DdbWriteOutcome {
  committed: true;
  readToken: string;
  finality: { finalized: boolean; blockNumber?: string };
  status: DdbCommitStatus;
}

/** What a submitted DB-01 transaction gives you back. */
export interface DdbTxnReceipt {
  /** The transaction id every member signed (0x-hex). */
  id: string;
  /** The ONE commit transaction carrying every member. Feed it to getCommitStatus / waitForCommitted. */
  commitTxHash: string;
  /** Each member's signed operation hash; ddb_getOperationStatus resolves any of them after a disconnect. */
  operationHashes: string[];
}

/** An operation prepared for signing: what to sign, and the envelope it becomes. */
export interface DdbPreparedOp {
  /** The 32 bytes to sign. Sign AS-IS -- no EIP-191 prefix. */
  hash: Uint8Array;
  /** The endorsement requestId this submission will be tracked by. */
  requestId: string;
  /** The envelope, complete except for `callerSig`. */
  envelope: Omit<DdbSignedOpEnvelope, 'callerSig'>;
}

/**
 * Build a DDB operation ready to sign, without signing it. Use this when the key lives somewhere the
 * SDK cannot reach -- an extension background page, a hardware wallet, a remote signer -- and you want
 * to hand a 32-byte digest across the boundary and get a signature back.
 *
 * `from` and `callerPubKey` must belong to the same key that produces the signature; the node checks
 * that they agree. `data` is compacted here to the exact bytes covered by the hash, so pass the object
 * or the JSON text, not pre-encoded bytes.
 */
export function buildDdbOp(
  typeName: DdbOpTypeName,
  schemaName: string,
  data: string | object,
  from: string,
  callerPubKey: Uint8Array,
  opts: DdbSignOptions = {},
): DdbPreparedOp {
  const compact = typeof data === 'string' ? JSON.stringify(JSON.parse(data)) : JSON.stringify(data);
  const dataBytes = new TextEncoder().encode(compact);
  // One validated bigint per field, used for BOTH the signed preimage and the envelope. See ddbU64:
  // a hash and an envelope that describe different numbers is the failure this shape removes.
  //
  // The timestamp is UNIX SECONDS. This function owns that decision for every caller that does not
  // pass one, and the unit is load-bearing rather than cosmetic: gossip/ddb/authz.go refuses ts == 0
  // by name and anything outside [now - maxOperationAge(900s), now + maxOperationSkew(300s)]. A
  // milliseconds value lands ~53,000 years past that ceiling, so EVERY operation is refused — with no
  // local symptom at all, because the signature is valid and the envelope is well formed. Hence
  // Date.now() / 1000, floored, and the magnitude check below.
  const timestamp = ddbU64('timestamp', opts.timestamp ?? Math.floor(Date.now() / 1000));
  if (timestamp > DDB_MAX_TIMESTAMP_SECONDS) {
    throw new Error(
      `DDB timestamp ${timestamp} is not unix seconds — it looks like milliseconds. The node refuses ` +
      `any operation more than 300s ahead of its own clock (gossip/ddb/authz.go maxOperationSkew).`,
    );
  }
  const gasLimit = ddbU64('gasLimit', opts.gasLimit ?? 100000);
  const nonce = ddbU64('nonce', opts.nonce ?? ddbRandomNonce());
  const typeByte = DDB_OP_TYPE[typeName];
  if (typeByte === undefined) {
    throw new Error(`unknown DDB operation type ${JSON.stringify(typeName)}`);
  }
  const envelope = {
    type: typeName,
    schemaName,
    data: '0x' + ddbBytesToHex(dataBytes),
    from,
    timestamp: ddbU64Hex(timestamp),
    gasLimit: ddbU64Hex(gasLimit),
    nonce: ddbU64Hex(nonce),
    callerPubKey: '0x' + ddbBytesToHex(callerPubKey),
  };

  const version = opts.preimageVersion ?? 1;
  if (version === 'auto') {
    throw new Error("buildDdbOp is offline and cannot resolve preimageVersion 'auto': pass 1 or 2 " +
      '(Ddb.resolveOpPreimageVersion() asks the node)');
  }
  if (version === 1) {
    // v1 signs neither field. Sending one anyway would put an UNSIGNED value on the envelope that a
    // v2 node reads as signed -- refuse it rather than drop it silently.
    if (opts.expiry !== undefined || opts.keyVersion !== undefined) {
      throw new Error('DDB expiry and keyVersion are signed only under operation preimage v2; pass preimageVersion: 2');
    }
    return {
      hash: canonicalDdbOperationHash(typeByte, schemaName, dataBytes, from, timestamp, gasLimit, nonce),
      requestId: '0x' + ddbBytesToHex(
        canonicalDdbRequestId(typeByte, schemaName, dataBytes, from, timestamp, gasLimit, nonce, from),
      ),
      envelope,
    };
  }
  if (version !== 2) throw new Error(`unknown DDB operation preimage version ${JSON.stringify(version)}`);

  // v2 (SEC-03). The chain id is signed, so it is never guessed: Ddb asks the node, a direct caller says.
  if (opts.chainId === undefined) {
    throw new Error('DDB operation preimage v2 binds the chain id: pass opts.chainId (Ddb fills it from eth_chainId)');
  }
  // The node's admission rule (gossip/ddb CheckOperationExpiry), checked here against `timestamp`
  // rather than the clock, so a fixed vector still builds. The "not in the past" half is the node's.
  const expiry = ddbU64('expiry', opts.expiry ?? timestamp + DDB_DEFAULT_EXPIRY_SECONDS);
  if (expiry === BigInt(0)) throw new Error('DDB expiry must be non-zero under preimage v2');
  if (expiry < timestamp) throw new Error(`DDB expiry ${expiry} is before the operation timestamp ${timestamp}`);
  if (expiry - timestamp > DDB_MAX_EXPIRY_WINDOW_SECONDS) {
    throw new Error(`DDB expiry ${expiry} is more than 900 s after the timestamp ${timestamp}; the node refuses it`);
  }
  const keyVersion = ddbU64('keyVersion', opts.keyVersion ?? 0);
  const op: DdbCanonicalOpV2 = {
    type: typeByte, chainId: opts.chainId, schemaName, data: dataBytes, from,
    timestamp, gasLimit, nonce, expiry, keyVersion,
  };
  return {
    hash: canonicalDdbOperationHashV2(op),
    requestId: '0x' + ddbBytesToHex(canonicalDdbRequestIdV2(op, from)),
    envelope: { ...envelope, expiry: ddbU64Hex(expiry), keyVersion: ddbU64Hex(keyVersion) },
  };
}

/** One member of a DB-01 transaction: an operation of the transaction's caller on its one database. */
export interface DdbTxnMemberSpec {
  typeName: DdbOpTypeName;
  schemaName: string;
  data: string | object;
  /** Defaults to 100000, as for a single operation. */
  gasLimit?: number;
  /** Defaults to a fresh random nonce per member. */
  nonce?: number | bigint;
}

/**
 * Options for a transaction. `timestamp`, `expiry` and `keyVersion` are shared by every member; the
 * chain id is required (Ddb fills it from eth_chainId). `readVersion` is the DB-03 read token the reads
 * were taken at (a readToken / dataVersion, hex or number); `reads` is the read set checked against it.
 */
export interface DdbTxnOptions {
  chainId?: number | bigint | string;
  timestamp?: number;
  expiry?: number | bigint;
  keyVersion?: number | bigint;
  readVersion?: number | bigint | string;
  reads?: DdbTxnRead[];
}

/** A transaction member ready to sign: the hash to sign AS-IS, and its envelope (without callerSig). */
export interface DdbPreparedTxnMember {
  hash: Uint8Array;
  envelope: Omit<DdbSignedOpEnvelope, 'callerSig'> & { txn: DdbTxnHeaderEnvelope };
}

/** A transaction ready to sign: its id and one prepared member per operation, in order. */
export interface DdbPreparedTxn {
  id: string;
  members: DdbPreparedTxnMember[];
}

/**
 * Build a DB-01 transaction ready to sign, without signing it (the StampTransaction the node runs for a
 * local client, reimplemented). Transactions are signed under operation preimage v2 only. Sign every
 * member's `hash`, then submit all members together with {@link Ddb.submitSignedTransaction}. The node
 * applies them all or none, and only if no row in `reads` was written after `readVersion`.
 */
export function buildDdbTransaction(
  members: DdbTxnMemberSpec[],
  from: string,
  callerPubKey: Uint8Array,
  opts: DdbTxnOptions = {},
): DdbPreparedTxn {
  const reads = opts.reads ?? [];
  ddbCheckTxnShape(members.length, reads);
  const rv = ddbU64('readVersion', typeof opts.readVersion === 'string' ? BigInt(opts.readVersion) : (opts.readVersion ?? 0));
  if (rv > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`DDB readVersion ${rv} does not fit the JSON number the node reads`);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const built = members.map((m) => {
    const p = buildDdbOp(m.typeName, m.schemaName, m.data, from, callerPubKey, {
      preimageVersion: 2, chainId: opts.chainId, timestamp, expiry: opts.expiry, keyVersion: opts.keyVersion,
      gasLimit: m.gasLimit, nonce: m.nonce,
    });
    const e = p.envelope;
    const op: DdbCanonicalOpV2 = {
      type: DDB_OP_TYPE[m.typeName], chainId: opts.chainId as number | bigint | string, schemaName: e.schemaName,
      data: ddbHexToBytes(e.data), from, timestamp: BigInt(e.timestamp), gasLimit: BigInt(e.gasLimit),
      nonce: BigInt(e.nonce), expiry: BigInt(e.expiry as string), keyVersion: BigInt(e.keyVersion as string),
    };
    return { op, envelope: e };
  });
  // The database each member writes, as the node resolves it (the derived db_name for a schema operation).
  const db = (b: (typeof built)[number]) => ddbOpPreimageDbIdentity(b.op.type, b.op.schemaName, b.op.data);
  built.forEach((b, i) => {
    if (db(b) !== db(built[0])) {
      throw new Error(`transaction member ${i} writes database ${db(b)}, member 0 writes ` +
        `${db(built[0])}: a transaction is ONE database's (nothing is atomic across two databases)`);
    }
  });
  const id = canonicalDdbTxnId(built.map((b) => b.op), rv, reads);
  const idHex = '0x' + ddbBytesToHex(id);
  return {
    id: idHex,
    members: built.map((b, i) => {
      const txn: DdbTxnHeaderEnvelope = { id: idHex, index: i, count: built.length };
      if (i === 0) {
        if (rv !== BigInt(0)) txn.read_version = Number(rv);
        if (reads.length) {
          txn.reads = reads.map((r) => {
            const w: { table?: string; pk?: Array<{ String: string; Valid: boolean }> } = {};
            if (r.table) w.table = r.table;
            if (r.pk && r.pk.length) w.pk = r.pk.map((v) => ({ String: v ?? '', Valid: v !== null }));
            return w;
          });
        }
      }
      return { hash: canonicalDdbTxnMemberHash(b.op, id, i, built.length), envelope: { ...b.envelope, txn } };
    }),
  };
}

/** The signed half of a `ddb_signedSelect` request, exactly as the node parses it (ethapi.SignedDdbRead). */
export interface DdbSignedReadEnvelope {
  schemaName: string;
  tableName: string;
  /** Omitted for a single-table read, as the node's `omitempty` does. */
  joinTables?: string[];
  from: string;
  timestamp: string;
  nonce: string;
  callerPubKey: string;
  callerSig: string;
}

/** Options for a signed read. Everything here except `chainId` is part of the signed preimage. */
export interface DdbSignedReadOptions {
  /**
   * The network the signature is bound to. Defaults to asking the node (eth_chainId) in
   * Ddb.signedSelect; buildDdbSignedRead requires it. A read signed for one network is refused on another.
   */
  chainId?: number | bigint | string;
  /**
   * Every OTHER table the query's `joins` touch. Signed: the node refuses a query that joins a table
   * outside {tableName} ∪ joinTables. Any order; the SDK canonicalizes it (sorted, unique, base removed).
   */
  joinTables?: string[];
  /** UNIX SECONDS, defaulting to now. The node refuses a read outside its freshness window. */
  timestamp?: number;
  /** Defaults to 8 random bytes. The node serves each signing hash once, so never reuse one. */
  nonce?: number | bigint;
}

/** A signed read prepared for signing: what to sign, and the envelope it becomes. */
export interface DdbPreparedRead {
  /** The 32 bytes to sign. Sign AS-IS -- no EIP-191 prefix. */
  hash: Uint8Array;
  /** The envelope, complete except for `callerSig`. */
  envelope: Omit<DdbSignedReadEnvelope, 'callerSig'>;
}

/**
 * Build a signed read ready to sign, without signing it -- the read counterpart of buildDdbOp, for a
 * key the SDK cannot reach. `from` and `callerPubKey` must belong to the key that signs.
 */
export function buildDdbSignedRead(
  chainId: number | bigint | string,
  schemaName: string,
  tableName: string,
  from: string,
  callerPubKey: Uint8Array,
  opts: Omit<DdbSignedReadOptions, 'chainId'> = {},
): DdbPreparedRead {
  if (!schemaName || !tableName) throw new Error('DDB signed read needs schemaName and tableName; both are signed');
  const joinTables = canonicalDdbJoinTables(tableName, opts.joinTables);
  // Same unit and the same milliseconds trap as buildDdbOp: see DDB_MAX_TIMESTAMP_SECONDS.
  const timestamp = ddbU64('timestamp', opts.timestamp ?? Math.floor(Date.now() / 1000));
  if (timestamp > DDB_MAX_TIMESTAMP_SECONDS) {
    throw new Error(`DDB timestamp ${timestamp} is not unix seconds — it looks like milliseconds.`);
  }
  const nonce = ddbU64('nonce', opts.nonce ?? ddbRandomNonce());
  return {
    hash: canonicalDdbSignedReadHash(chainId, schemaName, tableName, joinTables, from, timestamp, nonce),
    envelope: {
      schemaName,
      tableName,
      ...(joinTables.length ? { joinTables } : {}),
      from,
      timestamp: ddbU64Hex(timestamp),
      nonce: ddbU64Hex(nonce),
      callerPubKey: '0x' + ddbBytesToHex(callerPubKey),
    },
  };
}

/** A `ddb_signedCallReadProcedure` request, exactly as the node parses it (ethapi.SignedDdbReadProcedure). */
export interface DdbSignedReadProcedureEnvelope {
  schemaName: string;
  procedure: string;
  /** Omitted for a procedure with no parameters, as the node's `omitempty` does. */
  args?: string[];
  from: string;
  timestamp: string;
  nonce: string;
  callerPubKey: string;
  callerSig: string;
}

/** Options for a signed read-procedure call; everything except `chainId` is in the signed preimage. */
export type DdbSignedReadProcedureOptions = Omit<DdbSignedReadOptions, 'joinTables'>;

/** A signed read-procedure call prepared for signing: what to sign, and the envelope it becomes. */
export interface DdbPreparedReadProcedure {
  /** The 32 bytes to sign. Sign AS-IS -- no EIP-191 prefix. */
  hash: Uint8Array;
  /** The envelope, complete except for `callerSig`. */
  envelope: Omit<DdbSignedReadProcedureEnvelope, 'callerSig'>;
}

/**
 * Build a signed read-procedure call ready to sign, without signing it -- for a key the SDK cannot
 * reach (a wallet). `from` and `callerPubKey` must belong to the key that signs.
 */
export function buildDdbSignedReadProcedure(
  chainId: number | bigint | string,
  schemaName: string,
  procedure: string,
  args: readonly string[],
  from: string,
  callerPubKey: Uint8Array,
  opts: Omit<DdbSignedReadProcedureOptions, 'chainId'> = {},
): DdbPreparedReadProcedure {
  if (!schemaName || !procedure) throw new Error('DDB signed read-procedure call needs schemaName and procedure; both are signed');
  if (args.length > DDB_MAX_SIGNED_READPROC_ARGS) {
    throw new Error(`DDB read procedure call has ${args.length} args; a procedure takes at most ${DDB_MAX_SIGNED_READPROC_ARGS}`);
  }
  const timestamp = ddbU64('timestamp', opts.timestamp ?? Math.floor(Date.now() / 1000));
  if (timestamp > DDB_MAX_TIMESTAMP_SECONDS) {
    throw new Error(`DDB timestamp ${timestamp} is not unix seconds — it looks like milliseconds.`);
  }
  const nonce = ddbU64('nonce', opts.nonce ?? ddbRandomNonce());
  const argList = [...args];
  return {
    hash: canonicalDdbSignedReadProcedureHash(chainId, schemaName, procedure, argList, from, timestamp, nonce),
    envelope: {
      schemaName,
      procedure,
      ...(argList.length ? { args: argList } : {}),
      from,
      timestamp: ddbU64Hex(timestamp),
      nonce: ddbU64Hex(nonce),
      callerPubKey: '0x' + ddbBytesToHex(callerPubKey),
    },
  };
}

/**
 * DDB (Decentralized DataBase) client — wraps the node's `ddb_*` JSON-RPC namespace so apps can
 * create contract schemas, call stored procedures, manage roles, and read rows from NCOG's on-chain
 * relational database.
 *
 * WRITE semantics: the CALLER signs each mutation client-side with their ML-DSA-87 key and the node
 * verifies the signature — a production node never signs on a caller's behalf. Use the *Signed
 * methods (createSchemaSigned / callProcedureSigned / grantRoleSigned / revokeRoleSigned); each
 * returns the endorsement REQUEST ID (keccak256(canonicalBytes || requester) — NOT a committed EVM tx
 * hash, which the leader authors) and flows through the 2f+1 endorsement quorum -> block finality ->
 * durable Postgres apply. Track the write with getEndorsementStatus(requestId) or await
 * waitForEndorsement(requestId); the effect is queryable a short time AFTER it commits. The
 * legacy createSchema / callProcedure / grantRole / revokeRole methods (which pass a bare `from` and
 * rely on the node holding the caller's key) still exist but require the node to run with
 * NEC_DDB_ALLOW_LOCAL_SIGN=1 — they are DEPRECATED and fail closed on a default node.
 *
 * READ semantics: getSchema / select / query hit the node's own Postgres directly and require no consensus.
 *
 * SCHEMA NAMING, three cases — the node is not uniform here, so read this before wiring anything up:
 *   - createSchema* takes the CONTRACT NAME. The node derives db_name itself, from the
 *     contract_address inside the definition (ddbschema.DeriveDbName).
 *   - getSchema takes the CONTRACT ADDRESS. Its RPC parameter is *named* schemaName, but the query
 *     behind it is `WHERE contract_address = $1`, with no db_name branch.
 *   - EVERY OTHER schema-scoped method takes the contract's db_name. PREFER
 *     `await ddb.resolveDbName(contractAddress)`, which asks the chain and falls back to
 *     derivation: a node on an OLDER binary still uses the retired `contractName_last6` scheme,
 *     and against it every derived name is absent, so every call fails. Derivation alone:
 *     updateSchema*, callProcedure*, grantRole*, revokeRole*, select, query, getStateAcc.
 *
 * @example
 *   const provider = new Provider('https://rpc.ncog.earth');
 *   const ddb = new Ddb(provider);
 *   // Deploy: the caller signs with their ML-DSA private key; the node derives `from` from that key.
 *   const txHash = await ddb.createSchemaSigned(myPrivKeyHex, 'users', schemaJson);
 *   const schema = Ddb.deriveDbName(contractAddress); // 'c_<40 hex>' — for select/query/callProcedure
 *   // ...after the create tx finalizes...
 *   const rows = await ddb.select(schema, 'accounts', { limit: 50 });
 *   const callTx = await ddb.callProcedureSigned(myPrivKeyHex, schema, 'addUser', ['alice', '30']);
 */
export class Ddb {
  /**
   * `options.opPreimageVersion` picks the operation preimage every signed write uses (default 'auto':
   * v2 exactly when the node reports FeatureDdbOpPreimageV2 active); see DdbSignOptions.preimageVersion.
   */
  constructor(private readonly provider: Provider, private readonly options: DdbOptions = {}) {}

  // Set once nec_rules has reported v2 active. Activation is monotonic -- applyActivations only ever
  // turns a flag ON -- so v2 is remembered; v1 is not, so the first write after the activation epoch
  // switches without a restart.
  private v2Active = false;

  /**
   * Resolve 'auto' to the preimage version the node's current epoch verifies: 2 when nec_rules reports
   * ddb-op-preimage-v2 `active`, else 1. A node without nec_rules (an older node), a malformed answer, or
   * any error gives 1 -- the pre-'auto' behaviour -- so 'auto' never fails a write v1 would have sent.
   * An explicit 1 or 2 is returned as-is without a request. Exposed for a wallet that builds its own op.
   */
  async resolveOpPreimageVersion(mode: DdbOpPreimageMode = 'auto'): Promise<DdbOpPreimageVersion> {
    if (mode !== 'auto') return mode;
    if (this.v2Active) return 2;
    try {
      const rules = await this.call('nec_rules');
      // `active`, never `scheduled`: a scheduled activation whose epoch has not arrived is still v1 on
      // every node, and signing v2 early gets every operation refused.
      if (rules?.features?.[DDB_OP_PREIMAGE_V2_FEATURE]?.active === true) {
        this.v2Active = true;
        return 2;
      }
    } catch {
      // No nec_rules (method not found on an older node) or a transport error: v1, as before.
    }
    return 1;
  }

  /**
   * Derive the schema (db_name) a contract's tables / procedures / roles live under, mirroring the
   * node's ddbschema.DeriveDbName: `"c_" + the contract address, lowercased, without 0x`.
   *
   * It used to be `contractName + "_" + last-6-of-address`, and the node moved off that deliberately:
   * a 6-hex suffix is short enough to collide, and the contract NAME is caller-supplied, so two
   * contracts could be made to name the same Postgres schema. The full address is the registry's own
   * UNIQUE key and is not attacker-choosable, which removes the class of bug rather than narrowing it.
   * The name is display metadata now and never part of an identifier -- hence no `contractName`
   * parameter.
   *
   * Throws on an empty or non-hex address. The node returns "" there and lets validateIdentifier
   * reject it downstream; failing at the call site is more useful to a client, which would otherwise
   * go on to name a schema that cannot exist.
   *
   * Use this for every schema-scoped method EXCEPT createSchema* (which takes the raw contract name).
   * @example Ddb.deriveDbName('0x0000000000000000000000000000000000abcdef')
   *          // 'c_0000000000000000000000000000000000abcdef'
   */
  static deriveDbName(contractAddress: string): string {
    const hex = contractAddress.trim().toLowerCase().replace(/^0x/, '');
    if (!hex || !/^[0-9a-f]+$/.test(hex)) {
      throw new Error(`invalid contract address for deriveDbName: ${JSON.stringify(contractAddress)}`);
    }
    return 'c_' + hex;
  }

  // Raw pass-through (NOT callRpc): ddb params are plain JSON (strings, string[], structured opts with
  // numeric fields), which callRpc's tx-oriented serializer would mangle.
  private call(method: string, params: any[] = []): Promise<any> {
    return this.provider.send(method, params);
  }

  // ---------------------------------------------------------------------------
  // writes — client-signed (the production path; return the endorsement requestId)
  // ---------------------------------------------------------------------------

  /**
   * Sign an operation with the caller's ML-DSA-87 private key and submit it via ddb_submitSignedOp.
   * `from` is DERIVED from the key (address = keccak256(rawPubkey)[12:]), so the operation always names
   * its true signer. `data` is compacted to its canonical bytes before signing.
   */
  /**
   * Sign an operation with `signer` and submit it, returning BOTH handles: the endorsement requestId
   * and the node's commit tx hash. This is the general entry point -- the five named convenience
   * methods below are this function with a fixed type and payload shape, and they discard the commit
   * hash for backwards compatibility.
   *
   * Prefer this in a wallet: the commit hash is the only handle ddb_getCommitStatus accepts, and it is
   * the only way to distinguish "the write landed" from "the write was deterministically skipped on
   * every node". See {@link DdbSubmitReceipt}.
   */
  async submitOperationSigned(
    signer: DdbSignerLike,
    typeName: DdbOpTypeName,
    schemaName: string,
    data: string | object,
    opts: DdbSignOptions = {},
  ): Promise<DdbSubmitReceipt> {
    return this.signAndSubmit(signer, typeName, schemaName, data, opts);
  }

  private async signAndSubmit(
    signerLike: DdbSignerLike,
    typeName: DdbOpTypeName,
    schemaName: string,
    data: string | object,
    opts: DdbSignOptions = {},
  ): Promise<DdbSubmitReceipt> {
    const signer = toDdbSigner(signerLike);
    const from = await signer.getAddress();
    const pub = await signer.getPublicKey();

    // buildDdbOp does the compaction, the timestamp/gasLimit defaults and the fresh nonce, so the
    // raw-key path and the wallet path cannot drift: both submit bytes produced by the same function.
    // The preimage version: the call's, else this client's, else 'auto' (resolved against nec_rules).
    // Under v2 the chain id is signed, so it comes from the node (eth_chainId) unless the caller pinned one.
    const preimageVersion = await this.resolveOpPreimageVersion(
      opts.preimageVersion ?? this.options.opPreimageVersion ?? 'auto');
    const chainId = preimageVersion === 2 ? (opts.chainId ?? (await this.call('eth_chainId'))) : opts.chainId;
    const prepared = buildDdbOp(typeName, schemaName, data, from, pub, { ...opts, preimageVersion, chainId });

    // The signer receives the canonical operation hash AS-IS. It must not be re-hashed or wrapped in
    // the EIP-191 personal-message prefix on the way through a wallet.
    const sig = await signer.signDdbHash(prepared.hash);

    const commitTxHash = await this.call(
      'ddb_submitSignedOp', [{ ...prepared.envelope, callerSig: '0x' + ddbBytesToHex(sig) }],
    );

    // Both handles. ddb_submitSignedOp returns proof.CommitTxHash (ethapi/ddb_api.go); this used to be
    // awaited and thrown away, which left ddb_getCommitStatus -- the ONLY RPC that can report a
    // deterministic skip -- unreachable from any client, because its sole parameter is that hash.
    return { requestId: prepared.requestId, commitTxHash: typeof commitTxHash === 'string' ? commitTxHash : '' };
  }

  /**
   * Submit an operation you signed elsewhere. Pair with {@link buildDdbOp} when the key lives outside
   * the SDK: build, ship `hash` to the signer, come back with the signature, submit here. Returns the
   * endorsement requestId from the prepared op.
   */
  async submitSignedOp(prepared: DdbPreparedOp, signature: Uint8Array | string): Promise<string> {
    return (await this.submitSignedOpDetailed(prepared, signature)).requestId;
  }

  /**
   * As {@link submitSignedOp}, but returns the commit tx hash alongside the requestId. Use this one
   * unless you have a caller that depends on the bare-string return.
   */
  async submitSignedOpDetailed(prepared: DdbPreparedOp, signature: Uint8Array | string): Promise<DdbSubmitReceipt> {
    const sig = typeof signature === 'string' ? signature : '0x' + ddbBytesToHex(signature);
    const commitTxHash = await this.call('ddb_submitSignedOp', [{ ...prepared.envelope, callerSig: sig }]);
    return { requestId: prepared.requestId, commitTxHash: typeof commitTxHash === 'string' ? commitTxHash : '' };
  }

  /**
   * Sign a DB-01 transaction with `signer` and submit it via ddb_submitSignedTransaction: its members
   * apply together in one commit, or none do. Transactions are signed under operation preimage v2, so
   * this refuses on a network where ddb-op-preimage-v2 is not active yet. Returns the transaction id,
   * the commit tx hash (feed it to waitForCommitted / getCommitStatus), and each member's signed hash.
   * A skip whose reason passes {@link isRetryableDdbTxnSkip} means "re-read and try again"; use
   * {@link runTransaction} to do that in a loop.
   */
  async submitTransactionSigned(
    signerLike: DdbSignerLike,
    members: DdbTxnMemberSpec[],
    opts: DdbTxnOptions = {},
  ): Promise<DdbTxnReceipt> {
    const signer = toDdbSigner(signerLike);
    const from = await signer.getAddress();
    const pub = await signer.getPublicKey();
    const version = await this.resolveOpPreimageVersion(this.options.opPreimageVersion ?? 'auto');
    if (version !== 2) {
      throw new Error('DDB transactions are signed under operation preimage v2, and this network does not verify v2 yet ' +
        `(${DDB_OP_PREIMAGE_V2_FEATURE} is not active)`);
    }
    const chainId = opts.chainId ?? (await this.call('eth_chainId'));
    const prepared = buildDdbTransaction(members, from, pub, { ...opts, chainId });
    const sigs: Uint8Array[] = [];
    for (const m of prepared.members) sigs.push(await signer.signDdbHash(m.hash));
    return this.submitSignedTransaction(prepared, sigs);
  }

  /**
   * Submit a transaction you signed elsewhere: pair with {@link buildDdbTransaction}, one signature per
   * member, in member order.
   */
  async submitSignedTransaction(prepared: DdbPreparedTxn, signatures: Array<Uint8Array | string>): Promise<DdbTxnReceipt> {
    if (signatures.length !== prepared.members.length) {
      throw new Error(`${signatures.length} signatures for ${prepared.members.length} transaction members`);
    }
    const envelopes = prepared.members.map((m, i) => {
      const sig = signatures[i];
      return { ...m.envelope, callerSig: typeof sig === 'string' ? sig : '0x' + ddbBytesToHex(sig) };
    });
    const commitTxHash = await this.call('ddb_submitSignedTransaction', [envelopes]);
    return {
      id: prepared.id,
      commitTxHash: typeof commitTxHash === 'string' ? commitTxHash : '',
      operationHashes: prepared.members.map((m) => '0x' + ddbBytesToHex(m.hash)),
    };
  }

  /**
   * Run a transaction with retries (product contract C-02 / C-04). `attempt` is called once per try,
   * with the try number from 1; it should (re)read what the transaction depends on and return the
   * members plus the read version and read set. A commit skipped for a RETRYABLE reason
   * ({@link isRetryableDdbTxnSkip}: a conflicting write after the read version, a read version too old,
   * a lost row lock or a state-chain break) runs `attempt` again, up to `maxAttempts` (default 3). Any
   * other skip throws at once. Resolves with the committed outcome (durable on the answering node).
   */
  async runTransaction(
    signer: DdbSignerLike,
    attempt: (n: number) => Promise<{ members: DdbTxnMemberSpec[]; readVersion?: number | bigint | string; reads?: DdbTxnRead[] }>,
    opts: DdbTxnOptions & { maxAttempts?: number; intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<DdbWriteOutcome & { id: string; attempts: number }> {
    const max = opts.maxAttempts ?? 3;
    let lastReason = '';
    for (let n = 1; n <= max; n++) {
      const spec = await attempt(n);
      const receipt = await this.submitTransactionSigned(signer, spec.members, {
        ...opts, readVersion: spec.readVersion, reads: spec.reads,
      });
      try {
        const outcome = await this.waitForCommitted(receipt.commitTxHash, { intervalMs: opts.intervalMs, timeoutMs: opts.timeoutMs });
        return { ...outcome, id: receipt.id, attempts: n };
      } catch (err) {
        const status = await this.getCommitStatus(receipt.commitTxHash).catch(() => undefined);
        if (status?.status !== 'skipped' || !isRetryableDdbTxnSkip(status.reason)) throw err;
        lastReason = String(status.reason);
      }
    }
    throw new Error(`DDB transaction still conflicting after ${max} attempts (last skip: ${lastReason})`);
  }

  /**
   * Poll getEndorsementStatus for `requestId` until the write is endorsed/committed (or it times out). The
   * requestId is what the *Signed methods return. Resolves with the final status object; rejects on timeout.
   */
  async waitForEndorsement(requestId: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<DdbEndorsementStatus> {
    const interval = opts.intervalMs ?? 1000;
    const deadline = Date.now() + (opts.timeoutMs ?? 60000);
    for (;;) {
      const status = await this.getEndorsementStatus(requestId);
      const s = String(status?.status ?? status?.state ?? '').toLowerCase();
      // The node's ddb_getEndorsementStatus reports "pending" then "completed" on a successful quorum
      // (gossip/ddb dual_consensus_flow). "completed" is the real terminal success; the rest are tolerant
      // synonyms for forward-compat.
      if (status && (status.committed === true || status.finalized === true ||
                     s === 'completed' || s === 'committed' || s === 'finalized' || s === 'applied')) {
        return status;
      }
      // The node does not currently emit a terminal failure status, but reject defensively if one appears.
      if (s === 'failed' || s === 'rejected' || (typeof status?.error === 'string' && status.error)) {
        throw new Error(`DDB endorsement failed for ${requestId}: ${status?.error ?? s}`);
      }
      if (Date.now() >= deadline) throw new Error(`waitForEndorsement timed out for ${requestId} (last: ${JSON.stringify(status)})`);
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /**
   * Create a contract schema, signed by the caller's ML-DSA-87 key. `definition` is the contract definition —
   * either a raw JSON string or a typed {@link ContractDefinition}. A typed object is validated client-side
   * first: any MALFORMED point_write (which the node would reject at endorsement) throws before submission.
   * Returns the endorsement requestId (track with waitForEndorsement).
   */
  createSchemaSigned(signer: DdbSignerLike, schemaName: string, definition: string | ContractDefinition, opts?: DdbSignOptions): Promise<string> {
    if (typeof definition !== 'string') {
      const { errors } = validateContractDefinition(definition);
      if (errors.length) throw new Error(`invalid contract definition:\n  - ${errors.join('\n  - ')}`);
    }
    return this.signAndSubmit(signer, 'createschema', schemaName, definition, opts).then((r) => r.requestId);
  }

  /**
   * Upgrade a deployed contract, signed by the caller's ML-DSA-87 key. `schemaName` is the derived
   * db_name (Ddb.deriveDbName), NOT the contract name -- unlike createSchemaSigned, this names a
   * contract that already exists.
   *
   * The change must be ADDITIVE: the node accepts a new column, a new table, a new procedure and a new
   * role, and refuses dropping a column, changing a type or constraint, and dropping a table or
   * procedure (ddb/ddbschema/migration.go). Role assignments carry forward to the new version.
   *
   * `definition` is the FULL new contract definition, not a diff. A typed object is validated
   * client-side first, exactly as createSchemaSigned does. Returns the endorsement requestId.
   */
  updateSchemaSigned(signer: DdbSignerLike, schemaName: string, definition: string | ContractDefinition, opts?: DdbSignOptions): Promise<string> {
    if (typeof definition !== 'string') {
      const { errors } = validateContractDefinition(definition);
      if (errors.length) throw new Error(`invalid contract definition:\n  - ${errors.join('\n  - ')}`);
    }
    return this.signAndSubmit(signer, 'updateschema', schemaName, definition, opts).then((r) => r.requestId);
  }

  /** Call a stored procedure, signed by the caller. `schemaName` is the derived db_name (Ddb.deriveDbName). */
  callProcedureSigned(signer: DdbSignerLike, schemaName: string, procedure: string, args: string[] = [], opts?: DdbSignOptions): Promise<string> {
    return this.signAndSubmit(signer, 'callprocedure', schemaName, { procedure, args }, opts).then((r) => r.requestId);
  }

  /**
   * RETIRE a deployed contract, signed by the caller. `schemaName` is the derived db_name.
   *
   * A TOMBSTONE, not a drop: the node keeps the per-contract schema and every row, marks two columns
   * on the registry row, and from then on refuses reads and writes against it
   * (ddbschema.GenerateTombstoneSQLByDbName). The on-chain registry row and the anchored state hash
   * SURVIVE, which is what stops the address being re-claimed by someone else afterwards. Reversible
   * by design -- a hard drop that reclaims disk is deliberately not implemented.
   *
   * Authorized for the contract's OWNER or any holder of its `admin` role, and refused outright if the
   * contract is already retired. The node consults no payload for this operation, so `data` is a fixed
   * empty object; the operation is identified entirely by its schema, type and signer.
   *
   * There is no ddb_deleteSchema convenience RPC on the node, so this signed path is the only way to
   * reach the operation from outside a validator.
   */
  deleteSchemaSigned(signer: DdbSignerLike, schemaName: string, opts?: DdbSignOptions): Promise<string> {
    return this.signAndSubmit(signer, 'deleteschema', schemaName, {}, opts).then((r) => r.requestId);
  }

  /** Grant a role (admin-gated), signed by the caller. `schemaName` is the derived db_name. */
  grantRoleSigned(signer: DdbSignerLike, schemaName: string, role: string, account: string, opts?: DdbSignOptions): Promise<string> {
    return this.signAndSubmit(signer, 'grantrole', schemaName, { role, account }, opts).then((r) => r.requestId);
  }

  /** Revoke a role (admin-gated), signed by the caller. `schemaName` is the derived db_name. */
  revokeRoleSigned(signer: DdbSignerLike, schemaName: string, role: string, account: string, opts?: DdbSignOptions): Promise<string> {
    return this.signAndSubmit(signer, 'revokerole', schemaName, { role, account }, opts).then((r) => r.requestId);
  }

  // ---------------------------------------------------------------------------
  // writes — legacy server-signed (DEPRECATED; require node NEC_DDB_ALLOW_LOCAL_SIGN=1)
  // ---------------------------------------------------------------------------

  /** @deprecated Use createSchemaSigned. The node must run NEC_DDB_ALLOW_LOCAL_SIGN=1 to accept this. */
  createSchema(from: string, schemaName: string, definition: string | ContractDefinition): Promise<string> {
    ddbWarnDeprecated('createSchema', 'createSchemaSigned');
    const def = typeof definition === 'string' ? definition : JSON.stringify(definition);
    return this.call('ddb_createSchema', [from, schemaName, def]);
  }

  /** @deprecated Use callProcedureSigned. The node must run NEC_DDB_ALLOW_LOCAL_SIGN=1 to accept this. */
  callProcedure(from: string, schemaName: string, procedure: string, args: string[] = []): Promise<string> {
    ddbWarnDeprecated('callProcedure', 'callProcedureSigned');
    return this.call('ddb_callProcedure', [from, schemaName, procedure, args]);
  }

  /** @deprecated Use grantRoleSigned. The node must run NEC_DDB_ALLOW_LOCAL_SIGN=1 to accept this. */
  grantRole(from: string, schemaName: string, role: string, account: string): Promise<string> {
    ddbWarnDeprecated('grantRole', 'grantRoleSigned');
    return this.call('ddb_grantRole', [from, schemaName, role, account]);
  }

  /** @deprecated Use revokeRoleSigned. The node must run NEC_DDB_ALLOW_LOCAL_SIGN=1 to accept this. */
  revokeRole(from: string, schemaName: string, role: string, account: string): Promise<string> {
    ddbWarnDeprecated('revokeRole', 'revokeRoleSigned');
    return this.call('ddb_revokeRole', [from, schemaName, role, account]);
  }

  // ---------------------------------------------------------------------------
  // reads (this node's Postgres; no consensus)
  // ---------------------------------------------------------------------------

  /**
   * Fetch a contract's definition (tables, columns, indexes, procedures, roles).
   *
   * Takes the CONTRACT ADDRESS, not the derived db_name — the one read method that does. The node's
   * `ddb_getSchema` resolves through `SELECT ... FROM contracts WHERE contract_address = $1`
   * (gossip/ddb/postgres_storage.go QueryContractSchema); there is no db_name branch, so a derived
   * `c_<40 hex>` name matches zero rows and the node answers "schema not found for contract address:
   * c_...". Its parameter is *named* schemaName on the wire, which is what made this easy to get wrong.
   *
   * Pass the address here and `Ddb.deriveDbName(address)` to select / query / getStateAcc.
   */
  getSchema(contractAddress: string): Promise<DdbSchemaInfo> {
    return this.call('ddb_getSchema', [contractAddress]);
  }

  /**
   * Resolve the AUTHORITATIVE schema name for a contract by asking the chain, falling back to
   * `Ddb.deriveDbName` only when the node does not report one.
   *
   * PREFER THIS OVER `deriveDbName` for every schema-scoped call. Derivation is correct only for a
   * node built after the "derive the contract schema from the full address" change; a node running
   * an older binary still names its schemas with the retired `contractName_last6` scheme, and its
   * Postgres really does contain e.g. `userregistry_006a66`. Against such a node every derived
   * `c_<40 hex>` name is simply absent, so `select`/`query`/`callProcedure` fail on every call --
   * which is exactly how this SDK was source-correct and production-incompatible at the same time.
   *
   * The node reports the real name in `ddb_getSchema(...).contracts[].db_name`, so one round trip
   * removes the guess. On a current node the two agree, making this strictly safer, never worse.
   *
   * The fallback is deliberate and NOT a silent failure: if the lookup errors (contract absent, node
   * unreachable, an older RPC that omits the field) the derived name is the best available guess and
   * is what the caller would have used anyway.
   */
  async resolveDbName(contractAddress: string): Promise<string> {
    try {
      const info = await this.getSchema(contractAddress);
      const rows = Array.isArray(info?.contracts) ? info.contracts : [];
      for (const row of rows) {
        const rec = row as Record<string, unknown>;
        const reported = rec?.db_name ?? rec?.dbName;
        if (typeof reported === 'string' && reported.length > 0) {
          return reported;
        }
      }
    } catch {
      // fall through to derivation -- see the note above
    }
    return Ddb.deriveDbName(contractAddress);
  }

  /** Select rows with optional filters / ordering / pagination. `schemaName` = derived db_name (Ddb.deriveDbName). */
  select(schemaName: string, tableName: string, opts: DdbQueryOptions = {}): Promise<DdbRow[]> {
    return this.call('ddb_select', [schemaName, tableName, withReadToken(opts)]);
  }

  /**
   * ddb_select that also returns `dataVersion`, the applied version the rows reflect at least (DB-03).
   * Takes the same `minVersion`/`waitMs` token as select.
   */
  selectVersioned(schemaName: string, tableName: string, opts: DdbQueryOptions = {}): Promise<DdbVersionedRows> {
    return this.call('ddb_selectVersioned', [schemaName, tableName, withReadToken(opts)]);
  }

  /**
   * Simple row fetch (up to `limit` rows). `schemaName` is the derived db_name (Ddb.deriveDbName).
   * `consistency` is the DB-03 read token, as on callReadProcedure (NEC-152).
   */
  query(schemaName: string, tableName: string, limit = 100, consistency?: DdbReadConsistency): Promise<DdbRow[]> {
    // The token is a fourth parameter only when given, so an old node sees exactly the call it always did.
    const params: unknown[] = [schemaName, tableName, limit];
    if (consistency) params.push(withReadToken(consistency));
    return this.call('ddb_query', params);
  }

  /**
   * Read rows as a SIGNED caller (ddb_signedSelect) -- the only way to read a contract that declares a
   * reader role: select/query are anonymous and the node refuses them for such a contract. The node
   * verifies the signature, then checks that `from` holds a reader role, BEFORE any SQL runs.
   *
   * Signed: chain id, schema, table, `readOpts.joinTables`, from, timestamp, nonce. NOT signed: `query`
   * (filters, joins, ordering, limit), which travels beside the envelope. Each signed read is single use.
   */
  async signedSelect(
    signer: DdbSignerLike,
    schemaName: string,
    tableName: string,
    query: DdbQueryOptions | Record<string, unknown> = {},
    readOpts: DdbSignedReadOptions = {},
  ): Promise<DdbRow[]> {
    const s = toDdbSigner(signer);
    const chainId = readOpts.chainId ?? (await this.call('eth_chainId'));
    const prepared = buildDdbSignedRead(
      chainId, schemaName, tableName, await s.getAddress(), await s.getPublicKey(), readOpts,
    );
    const sig = await s.signDdbHash(prepared.hash);
    const envelope: DdbSignedReadEnvelope = { ...prepared.envelope, callerSig: '0x' + ddbBytesToHex(sig) };
    return this.call('ddb_signedSelect', [envelope, withReadToken(query as DdbQueryOptions)]);
  }

  /**
   * Run a READ-ONLY contract procedure node-locally and return its rows (ddb_callReadProcedure). Only a
   * procedure the active contract declares `"read_only": true` is accepted; `args` are bound, never
   * interpolated. Anonymous, so the node refuses it for a reader-role contract like select/query.
   */
  callReadProcedure(
    schemaName: string, procedure: string, args: string[] = [], consistency?: DdbReadConsistency,
  ): Promise<DdbRow[]> {
    // The token is a fourth parameter only when given, so an old node sees exactly the call it always did.
    const params: unknown[] = [schemaName, procedure, args];
    if (consistency) params.push(withReadToken(consistency));
    return this.call('ddb_callReadProcedure', params);
  }

  /**
   * Call a READ-ONLY contract procedure as a SIGNED caller (ddb_signedCallReadProcedure) -- the only way
   * to call one on a contract that declares a reader role: callReadProcedure is anonymous and the node
   * refuses it for such a contract. The node verifies the signature, then checks that `from` holds a
   * reader role, BEFORE the procedure runs.
   *
   * Signed: chain id, schema, procedure, every arg (in order), from, timestamp, nonce -- the whole call.
   * Each signed call is single use. NOT signed: `consistency`, the DB-03 read token (NEC-152), which
   * travels as a second parameter beside the envelope; it only makes the node wait for, or refuse, a read
   * the signature already authorizes, so the signed bytes are the same with or without it.
   */
  async signedCallReadProcedure(
    signer: DdbSignerLike,
    schemaName: string,
    procedure: string,
    args: string[] = [],
    opts: DdbSignedReadProcedureOptions = {},
    consistency?: DdbReadConsistency,
  ): Promise<DdbRow[]> {
    const s = toDdbSigner(signer);
    const chainId = opts.chainId ?? (await this.call('eth_chainId'));
    const prepared = buildDdbSignedReadProcedure(
      chainId, schemaName, procedure, args, await s.getAddress(), await s.getPublicKey(), opts,
    );
    const sig = await s.signDdbHash(prepared.hash);
    const envelope: DdbSignedReadProcedureEnvelope = { ...prepared.envelope, callerSig: '0x' + ddbBytesToHex(sig) };
    const params: unknown[] = [envelope];
    if (consistency) params.push(withReadToken(consistency));
    return this.call('ddb_signedCallReadProcedure', params);
  }

  // ---------------------------------------------------------------------------
  // status / introspection
  // ---------------------------------------------------------------------------

  /** The current DDB validator committee + BFT threshold. */
  getValidators(): Promise<DdbValidatorSet> {
    return this.call('ddb_getDdbValidators');
  }

  /** Endorsement status for a request id (the value returned by the *Signed write methods). */
  getEndorsementStatus(requestId: string): Promise<DdbEndorsementStatus> {
    return this.call('ddb_getEndorsementStatus', [requestId]);
  }

  /**
   * The TERMINAL answer for a DDB write: did commit tx `txHash` APPLY, or was it deterministically
   * SKIPPED at block validity, and why. Takes the `commitTxHash` from a {@link DdbSubmitReceipt}.
   *
   * Neither standard eth RPC can answer this. A skipped commit tx is never given a tx-position index,
   * so eth_getTransactionByHash and eth_getTransactionReceipt both return null for it forever --
   * exactly as they do for a tx that was never mined -- which makes "skipped" and "still pending"
   * indistinguishable everywhere else.
   *
   * `status: "unknown"` is NOT success: it means this node has no verdict yet.
   */
  getCommitStatus(txHash: string): Promise<DdbCommitStatus> {
    return this.call('ddb_getCommitStatus', [txHash]);
  }

  /**
   * Poll getCommitStatus until the write is known to have APPLIED, and throw if the node reports it
   * SKIPPED (with the node's own reason: state_chain_break, signed_prior_mismatch, row_lock_lost,
   * unpayable_gas, already_applied, replay).
   *
   * This is the check that separates "the quorum endorsed it" from "it landed". waitForEndorsement
   * answers the first question only, and resolving there is how a write that was skipped on every node
   * gets reported to a user as done.
   *
   * `requireDurable` additionally waits for THIS node's Postgres to carry the applied marker (the data
   * plane applies asynchronously, so applied-but-not-yet-durable is normal and transient).
   */
  async waitForCommit(
    txHash: string,
    opts: { intervalMs?: number; timeoutMs?: number; requireDurable?: boolean } = {},
  ): Promise<DdbCommitStatus> {
    const interval = opts.intervalMs ?? 1000;
    const deadline = Date.now() + (opts.timeoutMs ?? 60000);
    let last: DdbCommitStatus | undefined;
    for (;;) {
      last = await this.getCommitStatus(txHash);
      const status = String(last?.status ?? '').toLowerCase();
      if (status === 'skipped') {
        throw new Error(
          `DDB commit ${txHash} was SKIPPED on every node: ${last?.reason ?? 'no reason reported'} — the write did not happen`,
        );
      }
      if (status === 'applied' && (!opts.requireDurable || last?.durable === true)) return last;
      if (Date.now() >= deadline) {
        throw new Error(`waitForCommit timed out for ${txHash} (last: ${JSON.stringify(last)})`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /**
   * The DECIDE-04 write outcome (DB-03): resolves once the write is COMMITTED -- applied and durable in
   * the answering node's Postgres -- with finality reported separately and the read token to pass as
   * `minVersion`. Throws on SKIPPED (never ack-then-reject) and on timeout (not committed as far as
   * this node can say; resolve it later by the same hash).
   *
   * "Durable to policy" today is durable on the answering node: the node exposes no cross-replica
   * durability signal yet, and every node holds every database (R = N) until PLACE-01..03.
   */
  async waitForCommitted(
    txHash: string, opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<DdbWriteOutcome> {
    const status = await this.waitForCommit(txHash, { ...opts, requireDurable: true });
    const token = status.readToken ?? status.blockNumber;
    if (!token) {
      throw new Error(`DDB commit ${txHash} is durable but the node reported no read token (${JSON.stringify(status)})`);
    }
    return {
      committed: true,
      readToken: token,
      finality: { finalized: status.status === 'applied' && status.blockNumber !== undefined, blockNumber: status.blockNumber },
      status,
    };
  }

  /** Dual-consensus stats. */
  getConsensusStats(): Promise<DdbConsensusStats> {
    return this.call('ddb_getConsensusStats');
  }

  /** DDB storage stats. */
  getStats(): Promise<DdbStorageStats> {
    return this.call('ddb_getStats');
  }

  /**
   * This node's persisted per-contract state accumulator (incremental-hash / row-lock diagnostic): the raw
   * LtHash lanes, their digest, and how many ops were folded. Node-local (reports what THIS node believes;
   * comparing lanes across nodes localizes any divergence). `schemaName` = derived db_name. Errors under the
   * "linear" state-hash mode (there is no accumulator to report).
   */
  getStateAcc(schemaName: string): Promise<{ acc: string; sum: string; ops: string }> {
    return this.call('ddb_getStateAcc', [schemaName]);
  }

  /**
   * This node's DDB state-hash mode + shadow-soak counters: { mode: 'linear'|'shadow'|'lt', checks, mismatches }.
   * Operators watch mismatches == 0 under "shadow" before trusting "lt" (the incremental hash). Node-local.
   */
  shadowStatus(): Promise<{ mode: string; checks: string; mismatches: string }> {
    return this.call('ddb_shadowStatus');
  }
}
