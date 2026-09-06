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
  [k: string]: unknown;
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

  return {
    hash: canonicalDdbOperationHash(typeByte, schemaName, dataBytes, from, timestamp, gasLimit, nonce),
    requestId: '0x' + ddbBytesToHex(
      canonicalDdbRequestId(typeByte, schemaName, dataBytes, from, timestamp, gasLimit, nonce, from),
    ),
    envelope: {
      type: typeName,
      schemaName,
      data: '0x' + ddbBytesToHex(dataBytes),
      from,
      timestamp: ddbU64Hex(timestamp),
      gasLimit: ddbU64Hex(gasLimit),
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
  constructor(private readonly provider: Provider) {}

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
    const prepared = buildDdbOp(typeName, schemaName, data, from, pub, opts);

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
    return this.call('ddb_select', [schemaName, tableName, opts]);
  }

  /** Simple row fetch (up to `limit` rows). `schemaName` is the derived db_name (Ddb.deriveDbName). */
  query(schemaName: string, tableName: string, limit = 100): Promise<DdbRow[]> {
    return this.call('ddb_query', [schemaName, tableName, limit]);
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
