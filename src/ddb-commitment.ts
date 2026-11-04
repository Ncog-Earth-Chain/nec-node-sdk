import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { buildDdbOp, canonicalDdbOperationHashV2, canonicalDdbRequestIdV2, type DdbCanonicalOpV2, type DdbPreparedOp, type DdbSignOptions } from './ddb';

// PLACE-03: offline builder only. Supply the exact operation returned by a private
// host preview BEFORE signing. Adding a preview after signing changes the opening.
// Sidecars and digest secrets belong only to the selected group; this module sends nothing.
const enc = new TextEncoder();
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
export const DDB_COMMITMENT_PAYLOAD_MAX_BYTES = 128 * 1024;
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const hex = (b: Uint8Array) => '0x' + bytesToHex(b);
const addr = (a: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a) || /^0x0{40}$/i.test(a)) throw new Error('invalid commitment address');
  return a.toLowerCase();
};
const u64 = (n: number | bigint, nonzero = false) => {
  if (typeof n === 'number' && !Number.isSafeInteger(n)) throw new Error('unsafe uint64: use bigint');
  const value = BigInt(n);
  if (value < BigInt(nonzero ? 1 : 0) || value > U64_MAX) throw new Error('commitment version outside uint64 bounds');
  return value;
};
const checkedKey = (key: Uint8Array) => {
  if (key.length !== 32 || !key.some((b) => b !== 0)) throw new Error('digest key must be 32 nonzero bytes');
  return key;
};

export interface DdbCommitmentEnvelope {
  commitment: string;
  placementVersion: number | bigint;
  digestKeyVersion: number | bigint;
}

/** Preserve every uint64 bit; JSON.parse/stringify would round versions above 2^53. */
export function encodeDdbCommitmentEnvelope(e: DdbCommitmentEnvelope): string {
  if (!/^0x[0-9a-f]{64}$/.test(e.commitment) || /^0x0{64}$/.test(e.commitment)) throw new Error('invalid commitment hash');
  return `{"commitment":"${e.commitment}","placement_version":${u64(e.placementVersion)},"digest_key_version":${u64(e.digestKeyVersion, true)}}`;
}

export function decodeDdbCommitmentEnvelope(raw: string): DdbCommitmentEnvelope {
  const m = /^\{"commitment":"(0x[0-9a-f]{64})","placement_version":(0|[1-9][0-9]*),"digest_key_version":([1-9][0-9]*)\}$/.exec(raw);
  if (!m) throw new Error('noncanonical commitment envelope');
  const out = { commitment: m[1], placementVersion: BigInt(m[2]), digestKeyVersion: BigInt(m[3]) };
  if (encodeDdbCommitmentEnvelope(out) !== raw) throw new Error('noncanonical commitment envelope');
  return out;
}

/** Derivation does not select or rotate the active digest version; the admitted migration pins that choice. */
export function deriveDdbDigestKey(masterKey: Uint8Array, contract: string): Uint8Array {
  if (masterKey.length < 32) throw new Error('database master key must contain at least 32 bytes');
  return checkedKey(hkdf(sha256, masterKey, undefined, concat(enc.encode('NEC-DDB-DIGEST-KEY\x01'), hexToBytes(addr(contract).slice(2))), 32));
}

export function ddbPayloadCommitment(salt: Uint8Array, payload: Uint8Array): string {
  if (salt.length !== 32) throw new Error('payload salt must be 32 bytes');
  if (payload.length === 0 || payload.length > DDB_COMMITMENT_PAYLOAD_MAX_BYTES) throw new Error('commitment payload outside byte bound');
  return hex(keccak_256(concat(enc.encode('NEC-DDB-PAYLOAD\x01'), salt, payload)));
}

// Go []byte JSON uses standard padded base64. Keep this independent of Buffer
// and browser global atob, so Node, browser and React Native share the codec.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[n >>> 18] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}
function unbase64(text: unknown): Uint8Array {
  if (typeof text !== 'string' || text.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error('invalid row base64');
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const n = (B64.indexOf(text[i]) << 18) | (B64.indexOf(text[i + 1]) << 12) | ((B64.indexOf(text[i + 2]) & 63) << 6) | (B64.indexOf(text[i + 3]) & 63);
    out.push((n >>> 16) & 255);
    if (text[i + 2] !== '=') out.push((n >>> 8) & 255);
    if (text[i + 3] !== '=') out.push(n & 255);
  }
  const bytes = Uint8Array.from(out);
  if (base64(bytes) !== text) throw new Error('noncanonical row base64');
  return bytes;
}
function rowElement(element: Uint8Array, table?: string): Uint8Array {
  let offset = 0;
  const take = (n: number) => {
    if (n > element.length - offset) throw new Error('truncated row element');
    const value = element.slice(offset, offset + n); offset += n; return value;
  };
  const uint32 = () => { const b = take(4); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0); };
  const prefix = new TextDecoder().decode(take(uint32()));
  if (!prefix.startsWith('R:') || prefix.length <= 2 || (table !== undefined && prefix !== 'R:' + table)) throw new Error('private payload contains a non-business-row element');
  const count = uint32();
  if (count > element.length - offset) throw new Error('truncated row fields');
  for (let i = 0; i < count; i++) {
    const marker = take(1)[0];
    if (marker === 1) take(uint32());
    else if (marker !== 0) throw new Error('invalid row presence marker');
  }
  if (offset !== element.length) throw new Error('trailing row element bytes');
  return element;
}
const compare = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

export interface DdbTagDelta { removed?: string[]; added?: string[] }
export interface DdbPayloadSidecar { salt: string; payload: string }
/** Keep this from the locally requested mutation; never copy it from the host's preview response. */
export interface DdbPrivateIntent { type: number | 'insertdata' | 'updatedata' | 'deletedata' | 'callprocedure'; data: unknown }

const privateType = (type: DdbPrivateIntent['type']): number => {
  if (typeof type === 'number' && [4, 5, 6, 7].includes(type)) return type;
  switch (type) {
    case 'insertdata': return 4;
    case 'updatedata': return 5;
    case 'deletedata': return 6;
    case 'callprocedure': return 7;
    default: throw new Error('private intent must name a data operation');
  }
};

// Compare JSON meaning without allowing the host to exploit floating-point
// rounding. Exact decimal/bigint SQL arguments must be supplied as strings.
function intentJSON(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('private intent JSON number must be a safe integer; use an exact string');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(intentJSON).join(',') + ']';
  if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + intentJSON(record[key])).join(',') + '}';
  }
  throw new Error('private intent must contain only JSON values');
}

// Go struct decoding accepts case-insensitive field aliases and may merge
// duplicate object members. Validate the exact JSON spelling before using the
// JavaScript interpretation, while retaining the original bytes for signing.
const operationFields = new Set([
  'type', 'schema_name', 'data', 'gas_limit', 'gas_price', 'from', 'nonce', 'timestamp', 'expiry', 'key_version',
  'name', 'creator', 'version', 'tables', 'contract_name', 'author', 'description', 'schema', 'procedures',
  'roles', 'role_assignments', 'procedure_access', 'metadata', 'contractAddress', 'caller_pubkey', 'caller_sig',
  'write_set', 'state_delta', 'attested_delta', 'originator', 'txn',
]);
const rowFields = new Set(['Table', 'PK', 'Old', 'New']);
const primaryKeyFields = new Set(['String', 'Valid']);
const deltaFields = new Set(['removed', 'added']);

function exactFields(value: unknown, fields: ReadonlySet<string>, name: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid private ' + name + ' object');
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new Error('invalid private ' + name + ' field ' + field);
  }
}

function parsePrivatePayload(payload: Uint8Array) {
  // Preserve a BOM so JSON.parse rejects it, rather than silently removing bytes
  // that Go's JSON decoder would reject. Invalid UTF-8 must never be replaced.
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
  const parsed = JSON.parse(raw); // Native parser first validates the JSON grammar.
  let offset = 0;
  const space = () => { while (/[ \t\r\n]/.test(raw[offset] ?? '')) offset++; };
  const string = (): string => {
    const start = offset++;
    while (raw[offset] !== '"') offset += raw[offset] === '\\' ? 2 : 1;
    const value: string = JSON.parse(raw.slice(start, ++offset));
    // Go replaces unpaired UTF-16 escapes, whereas JavaScript retains them.
    // Reject that ambiguity in both member names and string values.
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('invalid private JSON Unicode string');
      } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error('invalid private JSON Unicode string');
    }
    return value;
  };
  const visit = (depth: number): void => {
    if (depth > 128) throw new Error('private JSON depth exceeds bound');
    space();
    if (raw[offset] === '{') {
      offset++; space();
      const seen = new Set<string>();
      if (raw[offset] !== '}') {
        do {
          space();
          const key = string();
          if (seen.has(key)) throw new Error('duplicate private JSON member');
          seen.add(key); space(); offset++; // Colon; native parsing checked it.
          visit(depth + 1); space();
          if (raw[offset] !== ',') break;
          offset++;
        } while (true);
      }
      offset++;
    } else if (raw[offset] === '[') {
      offset++; space();
      if (raw[offset] !== ']') {
        do {
          visit(depth + 1); space();
          if (raw[offset] !== ',') break;
          offset++;
        } while (true);
      }
      offset++;
    } else if (raw[offset] === '"') string();
    else while (offset < raw.length && !/[ \t\r\n,\]}]/.test(raw[offset])) offset++;
  };
  visit(0);
  exactFields(parsed, operationFields, 'payload');
  return parsed;
}

export interface BuildDdbCommitmentInput {
  /** Exact host-preview JSON, including canonical row deltas, carried only in the private sidecar. */
  payload: Uint8Array;
  /** Original local mutation, used to refuse an altered host preview before signing the commitment. */
  intent: DdbPrivateIntent;
  digestKey: Uint8Array;
  contract: string;
  from: string;
  callerPubKey: Uint8Array;
  placementVersion: number | bigint;
  digestKeyVersion: number | bigint;
  /** Omit for a cryptographically random fresh salt. Explicit salts are for vectors or managed replay only. */
  salt?: Uint8Array;
}
export interface BuiltDdbCommitment { prepared: DdbPreparedOp; sidecar: DdbPayloadSidecar; stateDelta: DdbTagDelta }

export function buildDdbCommitment(input: BuildDdbCommitmentInput, options: DdbSignOptions): BuiltDdbCommitment {
  if (options.preimageVersion !== undefined && options.preimageVersion !== 2) throw new Error('commitment builder requires operation preimage v2');
  const contract = addr(input.contract), from = addr(input.from), database = 'c_' + contract.slice(2);
  const key = checkedKey(input.digestKey), payload = new Uint8Array(input.payload), salt = input.salt ? new Uint8Array(input.salt) : randomBytes(32);
  const commitment = ddbPayloadCommitment(salt, payload);
  const inner = parsePrivatePayload(payload);
  if (!inner || ![4, 5, 6, 7, 'insertdata', 'updatedata', 'deletedata', 'callprocedure'].includes(inner.type)) throw new Error('private payload must be a data operation');
  if (inner.schema_name !== database || addr(inner.contractAddress) !== contract || addr(inner.from) !== from) throw new Error('private payload database, contract or caller differs');
  if (!input.intent || privateType(inner.type) !== privateType(input.intent.type) || intentJSON(inner.data) !== intentJSON(input.intent.data)) {
    throw new Error('private preview differs from the locally requested intent');
  }
  for (const name of ['tables', 'schema', 'procedures', 'roles', 'role_assignments', 'procedure_access', 'metadata', 'name', 'contract_name', 'version', 'description']) {
    const value = inner[name];
    if (value != null && value !== '' && (!Array.isArray(value) || value.length !== 0)) throw new Error('private payload contains definition field ' + name);
  }
  if (inner.txn != null) throw new Error('private payload cannot contain a DB-01 transaction');
  if (inner.write_set != null && !Array.isArray(inner.write_set)) throw new Error('invalid private write_set array');
  if (inner.state_delta != null) exactFields(inner.state_delta, deltaFields, 'state_delta');
  if ((!Array.isArray(inner.write_set) || inner.write_set.length === 0) && inner.state_delta == null) throw new Error('private preview carries no write-set');
  const removed: Uint8Array[] = [], added: Uint8Array[] = [];
  for (const row of inner.write_set ?? []) {
    exactFields(row, rowFields, 'point delta');
    if (!row || typeof row.Table !== 'string' || !row.Table || !Array.isArray(row.PK) || !row.PK.length || (row.Old == null && row.New == null)) throw new Error('invalid private point delta');
    for (const pk of row.PK) {
      exactFields(pk, primaryKeyFields, 'primary key');
      if (typeof pk.String !== 'string' || typeof pk.Valid !== 'boolean') throw new Error('invalid private primary key value');
    }
    if (row.Old != null) removed.push(rowElement(unbase64(row.Old), row.Table));
    if (row.New != null) added.push(rowElement(unbase64(row.New), row.Table));
  }
  for (const [name, out] of [['removed', removed], ['added', added]] as const) {
    const side = inner.state_delta?.[name] ?? [];
    if (!Array.isArray(side)) throw new Error('invalid private general delta');
    let prior: Uint8Array | undefined;
    for (const encoded of side) {
      const element = rowElement(unbase64(encoded));
      if (prior && compare(prior, element) > 0) throw new Error('private general delta is not sorted');
      out.push(element); prior = element;
    }
  }
  const removedSet = new Set(removed.map(hex));
  if (added.some((e) => removedSet.has(hex(e)))) throw new Error('row element appears on both sides of private delta');
  const tags = (side: Uint8Array[]) => side.map((element) => hmac(sha256, key, concat(enc.encode('NEC-DDB-KELEM\x01'), element))).sort(compare).map(base64);
  const stateDelta: DdbTagDelta = {};
  if (removed.length) stateDelta.removed = tags(removed);
  if (added.length) stateDelta.added = tags(added);
  const data = enc.encode(encodeDdbCommitmentEnvelope({ commitment, placementVersion: input.placementVersion, digestKeyVersion: input.digestKeyVersion }));
  // Reuse validation/defaults for nonce, timestamps, expiry, key version and chain.
  // Hash the exact envelope bytes separately; never round its uint64 JSON integers.
  const base = buildDdbOp('callprocedure', database, {}, from, input.callerPubKey, { ...options, preimageVersion: 2 });
  const e = base.envelope;
  const op: DdbCanonicalOpV2 = { type: 15, chainId: options.chainId!, schemaName: database, data, from,
    timestamp: BigInt(e.timestamp), gasLimit: BigInt(e.gasLimit), nonce: BigInt(e.nonce), expiry: BigInt(e.expiry!), keyVersion: BigInt(e.keyVersion!) };
  return { prepared: { hash: canonicalDdbOperationHashV2(op), requestId: hex(canonicalDdbRequestIdV2(op, from)),
    envelope: { ...e, type: 15, data: hex(data), stateDelta } }, sidecar: { salt: hex(salt), payload: hex(payload) }, stateDelta };
}
