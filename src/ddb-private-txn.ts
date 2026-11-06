import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import {
  buildDdbOp, canonicalDdbTxnId, canonicalDdbTxnMemberHash, DDB_TXN_MAX_OPS,
  type DdbCanonicalOpV2, type DdbPreparedTxn, type DdbTxnRead, type DdbTxnHeaderEnvelope,
} from './ddb';
import { ddbPayloadCommitment, encodeDdbCommitmentEnvelope, DDB_COMMITMENT_PAYLOAD_MAX_BYTES, type DdbPayloadSidecar, type DdbTagDelta } from './ddb-commitment';
import { isSupportedPlacementManagerRuntime } from './ddb-proof';

// Canonical grammar shared by private DB-01 preparation and authenticated evidence.
// This closed grammar does not replace the existing single-operation payload.
// Effects/results are assertions; encoding them does not prove SQL execution.
const utf8 = new TextEncoder();
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const BOUND = DDB_COMMITMENT_PAYLOAD_MAX_BYTES;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const fail = (message: string): never => { throw new Error('private transaction: ' + message); };
const compare = (a: Uint8Array, b: Uint8Array): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const compareText = (a: string, b: string) => compare(utf8.encode(a), utf8.encode(b));
const hex = (b: Uint8Array): string => '0x' + bytesToHex(b);
const zero = (s: string): boolean => /^0x0+$/.test(s);
function checkedString(value: unknown): string {
  if (typeof value !== 'string') return fail('expected string');
  if (value.length > BOUND) return fail('string exceeds byte bound');
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail('invalid Unicode scalar string');
    } else if (c >= 0xdc00 && c <= 0xdfff) return fail('invalid Unicode scalar string');
  }
  return value;
}
function checkedU64(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > U64_MAX) return fail('expected bigint uint64');
  return value;
}
function readU64(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20) return fail('invalid decimal uint64');
  return checkedU64(BigInt(value));
}
function checkedHex(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || value.length !== bytes * 2 + 2 || !/^0x[0-9a-f]+$/.test(value)) return fail('invalid lowercase hex identity');
  return value;
}
function checkedBool(value: unknown): boolean {
  if (typeof value !== 'boolean') return fail('expected boolean');
  return value;
}
function checkedBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) return fail('expected bytes');
  if (value.length > BOUND) return fail('component exceeds byte bound');
  return value;
}
function base64(value: Uint8Array): string {
  checkedBytes(value);
  if (4 * Math.ceil(value.length / 3) > BOUND) return fail('base64 exceeds byte bound');
  let out = '';
  for (let i = 0; i < value.length; i += 3) {
    const n = (value[i] << 16) | ((value[i + 1] ?? 0) << 8) | (value[i + 2] ?? 0);
    out += B64[n >>> 18] + B64[(n >>> 12) & 63] + (i + 1 < value.length ? B64[(n >>> 6) & 63] : '=') + (i + 2 < value.length ? B64[n & 63] : '=');
  }
  return out;
}
function readBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > BOUND || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return fail('invalid canonical base64');
  const size = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  const out = new Uint8Array(size);
  let pos = 0;
  for (let i = 0; i < value.length; i += 4) {
    const n = (B64.indexOf(value[i]) << 18) | (B64.indexOf(value[i + 1]) << 12) | ((B64.indexOf(value[i + 2]) & 63) << 6) | (B64.indexOf(value[i + 3]) & 63);
    out[pos++] = (n >>> 16) & 255;
    if (value[i + 2] !== '=') out[pos++] = (n >>> 8) & 255;
    if (value[i + 3] !== '=') out[pos++] = n & 255;
  }
  if (base64(out) !== value) return fail('noncanonical base64 padding bits');
  return out;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return fail('expected plain wire object');
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) return fail('missing or unknown wire field');
  if (keys.some((key) => { const d = Object.getOwnPropertyDescriptor(value, key)!; return !('value' in d) || !d.enumerable; })) return fail('wire fields must be plain data properties');
  return value as Record<string, unknown>;
}
function array<T>(value: unknown, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > BOUND) return fail('invalid array or byte bound');
  return value.map(read);
}
class Writer {
  private readonly parts: string[] = [];
  private size = 0;
  raw(value: string): void {
    this.size += utf8.encode(value).length;
    if (this.size > BOUND) fail('payload exceeds existing byte bound');
    this.parts.push(value);
  }
  string(value: string): void {
    checkedString(value);
    this.raw('"');
    // Do not use JSON.stringify: controls use \u00xx, and U+2028/29 must be escaped.
    let start = 0;
    for (let i = 0; i < value.length; i++) {
      const c = value[i], cp = value.charCodeAt(i);
      let escaped: string | undefined;
      if (c === '"' || c === '\\') escaped = '\\' + c;
      else if (cp < 32) escaped = '\\u00' + cp.toString(16).padStart(2, '0');
      else if (cp === 0x2028 || cp === 0x2029) escaped = '\\u' + cp.toString(16);
      if (escaped !== undefined) { this.raw(value.slice(start, i)); this.raw(escaped); start = i + 1; }
    }
    this.raw(value.slice(start));
    this.raw('"');
  }
  u64(value: bigint): void { this.string(checkedU64(value).toString()); }
  hex(value: string, bytes: number): void { this.string(checkedHex(value, bytes)); }
  bool(value: boolean): void { this.raw(checkedBool(value) ? 'true' : 'false'); }
  bytes(value: Uint8Array): void { this.string(base64(value)); }
  array<T>(values: T[], emit: (item: T) => void): void {
    if (!Array.isArray(values) || values.length > BOUND) fail('invalid array or byte bound');
    this.raw('[');
    for (let i = 0; i < values.length; i++) { if (i) this.raw(','); emit(values[i]); }
    this.raw(']');
  }
  finish(): Uint8Array { return utf8.encode(this.parts.join('')); }
}

export interface PrivateTxnMemberV1 {
  kind: string;
  version: bigint;
  base: PrivateTxnBaseV1;
  index: bigint;
  count: bigint;
  intent: PrivateTxnIntentV1;
  effect: PrivateTxnEffectV1;
  result: PrivateTxnResultV1;
}

export interface PrivateTxnBaseV1 {
  chain: string;
  database: string;
  contract: string;
  caller: string;
  block: bigint;
  block_hash: string;
  state_root: string;
  epoch: bigint;
  initial_anchor: string;
  manager: string;
  manager_runtime: string;
  placement_version: bigint;
  group_hash: string;
  digest_version: bigint;
  digest_fingerprint: string;
  context: PrivateTxnContextV1;
}

export interface PrivateTxnIntentV1 {
  type: bigint;
  data: Uint8Array;
  timestamp: bigint;
  gas_limit: bigint;
  nonce: bigint;
  expiry: bigint;
  key_version: bigint;
}

export interface PrivateTxnEffectV1 {
  removed: Array<Uint8Array>;
  added: Array<Uint8Array>;
}

export interface PrivateTxnResultV1 {
  columns: Array<PrivateTxnResultColumnV1>;
  rows: Array<Array<PrivateTxnCellV1>>;
  affected: bigint;
}

export interface PrivateTxnResultColumnV1 {
  name: string;
  type: string;
}

export interface PrivateTxnCellV1 {
  null: boolean;
  value: Uint8Array;
}

export interface PrivateTxnContextV1 {
  definition: PrivateTxnDefinitionV1;
  owner: string;
  tombstoned: boolean;
  caller_roles: Array<string>;
  gas_declared: boolean;
  declared_gas: PrivateTxnGasV1;
  network_gas: PrivateTxnGasV1;
  schema_features: PrivateTxnSchemaFeaturesV1;
  statement_check: PrivateTxnStatementCheckV1;
  overloads: Array<PrivateTxnOverloadV1>;
  confidential_columns: Array<PrivateTxnConfidentialColumnsV1>;
  confidential_grants: Uint8Array;
}

export interface PrivateTxnDefinitionV1 {
  contract_address: string;
  contract_name: string;
  version: string;
  type: string;
  schema: PrivateTxnSchemaV1;
  procedures: Array<PrivateTxnProcedureV1>;
  roles: Array<string>;
  role_assignments: Array<PrivateTxnRoleAssignmentV1>;
  procedure_access: Array<PrivateTxnProcedureAccessV1>;
}

export interface PrivateTxnSchemaV1 {
  tables: Array<PrivateTxnTableV1>;
}

export interface PrivateTxnTableV1 {
  name: string;
  columns: Array<PrivateTxnColumnV1>;
  indexes: Array<PrivateTxnIndexV1>;
}

export interface PrivateTxnColumnV1 {
  name: string;
  type: string;
  constraints: Array<string>;
}

export interface PrivateTxnIndexV1 {
  name: string;
  columns: Array<string>;
}

export interface PrivateTxnProcedureV1 {
  name: string;
  params: Array<PrivateTxnParameterV1>;
  returns: string;
  body: string;
  role_required: string;
  read_only: boolean;
  point_write: PrivateTxnPointWriteV1 | null;
}

export interface PrivateTxnParameterV1 {
  name: string;
  type: string;
}

export interface PrivateTxnPointWriteV1 {
  table: string;
  op: string;
  pk: Array<PrivateTxnPKBindingV1>;
}

export interface PrivateTxnPKBindingV1 {
  column: string;
  param: string;
}

export interface PrivateTxnRoleAssignmentV1 {
  role: string;
  accounts: Array<string>;
}

export interface PrivateTxnProcedureAccessV1 {
  procedure: string;
  allowed_roles: Array<string>;
}

export interface PrivateTxnGasV1 {
  base_cost: bigint;
  per_row_read: bigint;
  per_row_written: bigint;
  per_index_used: bigint;
  max_gas_per_tx: bigint;
}

export interface PrivateTxnSchemaFeaturesV1 {
  check_constraints: boolean;
  apply_refusal: boolean;
  binding_refusal: boolean;
  signature_supersede: boolean;
}

export interface PrivateTxnStatementCheckV1 {
  literal_aware: boolean;
  drop_superseded_function: boolean;
}

export interface PrivateTxnOverloadV1 {
  procedure: string;
  arity: bigint;
  candidates: Array<Array<PrivateTxnParamTypeV1>>;
}

export interface PrivateTxnParamTypeV1 {
  category: string;
  preferred: boolean;
}

export interface PrivateTxnConfidentialColumnsV1 {
  table: string;
  columns: Array<string>;
}

function emitPrivateTxnMemberV1(w: Writer, v: PrivateTxnMemberV1): void {
  object(v, ['kind', 'version', 'base', 'index', 'count', 'intent', 'effect', 'result']);
  w.raw('{"kind":'); w.string(v.kind);
  w.raw(',"version":'); w.u64(v.version);
  w.raw(',"base":'); emitPrivateTxnBaseV1(w, v.base);
  w.raw(',"index":'); w.u64(v.index);
  w.raw(',"count":'); w.u64(v.count);
  w.raw(',"intent":'); emitPrivateTxnIntentV1(w, v.intent);
  w.raw(',"effect":'); emitPrivateTxnEffectV1(w, v.effect);
  w.raw(',"result":'); emitPrivateTxnResultV1(w, v.result);
  w.raw('}');
}

function readPrivateTxnMemberV1(value: unknown): PrivateTxnMemberV1 {
  const v = object(value, ['kind', 'version', 'base', 'index', 'count', 'intent', 'effect', 'result']);
  return {
    kind: checkedString(v.kind),
    version: readU64(v.version),
    base: readPrivateTxnBaseV1(v.base),
    index: readU64(v.index),
    count: readU64(v.count),
    intent: readPrivateTxnIntentV1(v.intent),
    effect: readPrivateTxnEffectV1(v.effect),
    result: readPrivateTxnResultV1(v.result),
  };
}

function emitPrivateTxnBaseV1(w: Writer, v: PrivateTxnBaseV1): void {
  object(v, ['chain', 'database', 'contract', 'caller', 'block', 'block_hash', 'state_root', 'epoch', 'initial_anchor', 'manager', 'manager_runtime', 'placement_version', 'group_hash', 'digest_version', 'digest_fingerprint', 'context']);
  w.raw('{"chain":'); w.hex(v.chain, 32);
  w.raw(',"database":'); w.string(v.database);
  w.raw(',"contract":'); w.hex(v.contract, 20);
  w.raw(',"caller":'); w.hex(v.caller, 20);
  w.raw(',"block":'); w.u64(v.block);
  w.raw(',"block_hash":'); w.hex(v.block_hash, 32);
  w.raw(',"state_root":'); w.hex(v.state_root, 32);
  w.raw(',"epoch":'); w.u64(v.epoch);
  w.raw(',"initial_anchor":'); w.hex(v.initial_anchor, 32);
  w.raw(',"manager":'); w.hex(v.manager, 20);
  w.raw(',"manager_runtime":'); w.hex(v.manager_runtime, 32);
  w.raw(',"placement_version":'); w.u64(v.placement_version);
  w.raw(',"group_hash":'); w.hex(v.group_hash, 32);
  w.raw(',"digest_version":'); w.u64(v.digest_version);
  w.raw(',"digest_fingerprint":'); w.hex(v.digest_fingerprint, 32);
  w.raw(',"context":'); emitPrivateTxnContextV1(w, v.context);
  w.raw('}');
}

function readPrivateTxnBaseV1(value: unknown): PrivateTxnBaseV1 {
  const v = object(value, ['chain', 'database', 'contract', 'caller', 'block', 'block_hash', 'state_root', 'epoch', 'initial_anchor', 'manager', 'manager_runtime', 'placement_version', 'group_hash', 'digest_version', 'digest_fingerprint', 'context']);
  return {
    chain: checkedHex(v.chain, 32),
    database: checkedString(v.database),
    contract: checkedHex(v.contract, 20),
    caller: checkedHex(v.caller, 20),
    block: readU64(v.block),
    block_hash: checkedHex(v.block_hash, 32),
    state_root: checkedHex(v.state_root, 32),
    epoch: readU64(v.epoch),
    initial_anchor: checkedHex(v.initial_anchor, 32),
    manager: checkedHex(v.manager, 20),
    manager_runtime: checkedHex(v.manager_runtime, 32),
    placement_version: readU64(v.placement_version),
    group_hash: checkedHex(v.group_hash, 32),
    digest_version: readU64(v.digest_version),
    digest_fingerprint: checkedHex(v.digest_fingerprint, 32),
    context: readPrivateTxnContextV1(v.context),
  };
}

function emitPrivateTxnIntentV1(w: Writer, v: PrivateTxnIntentV1): void {
  object(v, ['type', 'data', 'timestamp', 'gas_limit', 'nonce', 'expiry', 'key_version']);
  w.raw('{"type":'); w.u64(v.type);
  w.raw(',"data":'); w.bytes(v.data);
  w.raw(',"timestamp":'); w.u64(v.timestamp);
  w.raw(',"gas_limit":'); w.u64(v.gas_limit);
  w.raw(',"nonce":'); w.u64(v.nonce);
  w.raw(',"expiry":'); w.u64(v.expiry);
  w.raw(',"key_version":'); w.u64(v.key_version);
  w.raw('}');
}

function readPrivateTxnIntentV1(value: unknown): PrivateTxnIntentV1 {
  const v = object(value, ['type', 'data', 'timestamp', 'gas_limit', 'nonce', 'expiry', 'key_version']);
  return {
    type: readU64(v.type),
    data: readBytes(v.data),
    timestamp: readU64(v.timestamp),
    gas_limit: readU64(v.gas_limit),
    nonce: readU64(v.nonce),
    expiry: readU64(v.expiry),
    key_version: readU64(v.key_version),
  };
}

function emitPrivateTxnEffectV1(w: Writer, v: PrivateTxnEffectV1): void {
  object(v, ['removed', 'added']);
  w.raw('{"removed":'); w.array(v.removed, (item0) => { w.bytes(item0); });
  w.raw(',"added":'); w.array(v.added, (item0) => { w.bytes(item0); });
  w.raw('}');
}

function readPrivateTxnEffectV1(value: unknown): PrivateTxnEffectV1 {
  const v = object(value, ['removed', 'added']);
  return {
    removed: array(v.removed, (item0) => readBytes(item0)),
    added: array(v.added, (item0) => readBytes(item0)),
  };
}

function emitPrivateTxnResultV1(w: Writer, v: PrivateTxnResultV1): void {
  object(v, ['columns', 'rows', 'affected']);
  w.raw('{"columns":'); w.array(v.columns, (item0) => { emitPrivateTxnResultColumnV1(w, item0); });
  w.raw(',"rows":'); w.array(v.rows, (item0) => { w.array(item0, (item1) => { emitPrivateTxnCellV1(w, item1); }); });
  w.raw(',"affected":'); w.u64(v.affected);
  w.raw('}');
}

function readPrivateTxnResultV1(value: unknown): PrivateTxnResultV1 {
  const v = object(value, ['columns', 'rows', 'affected']);
  return {
    columns: array(v.columns, (item0) => readPrivateTxnResultColumnV1(item0)),
    rows: array(v.rows, (item0) => array(item0, (item1) => readPrivateTxnCellV1(item1))),
    affected: readU64(v.affected),
  };
}

function emitPrivateTxnResultColumnV1(w: Writer, v: PrivateTxnResultColumnV1): void {
  object(v, ['name', 'type']);
  w.raw('{"name":'); w.string(v.name);
  w.raw(',"type":'); w.string(v.type);
  w.raw('}');
}

function readPrivateTxnResultColumnV1(value: unknown): PrivateTxnResultColumnV1 {
  const v = object(value, ['name', 'type']);
  return {
    name: checkedString(v.name),
    type: checkedString(v.type),
  };
}

function emitPrivateTxnCellV1(w: Writer, v: PrivateTxnCellV1): void {
  object(v, ['null', 'value']);
  w.raw('{"null":'); w.bool(v.null);
  w.raw(',"value":'); w.bytes(v.value);
  w.raw('}');
}

function readPrivateTxnCellV1(value: unknown): PrivateTxnCellV1 {
  const v = object(value, ['null', 'value']);
  return {
    null: checkedBool(v.null),
    value: readBytes(v.value),
  };
}

function emitPrivateTxnContextV1(w: Writer, v: PrivateTxnContextV1): void {
  object(v, ['definition', 'owner', 'tombstoned', 'caller_roles', 'gas_declared', 'declared_gas', 'network_gas', 'schema_features', 'statement_check', 'overloads', 'confidential_columns', 'confidential_grants']);
  w.raw('{"definition":'); emitPrivateTxnDefinitionV1(w, v.definition);
  w.raw(',"owner":'); w.hex(v.owner, 20);
  w.raw(',"tombstoned":'); w.bool(v.tombstoned);
  w.raw(',"caller_roles":'); w.array(v.caller_roles, (item0) => { w.string(item0); });
  w.raw(',"gas_declared":'); w.bool(v.gas_declared);
  w.raw(',"declared_gas":'); emitPrivateTxnGasV1(w, v.declared_gas);
  w.raw(',"network_gas":'); emitPrivateTxnGasV1(w, v.network_gas);
  w.raw(',"schema_features":'); emitPrivateTxnSchemaFeaturesV1(w, v.schema_features);
  w.raw(',"statement_check":'); emitPrivateTxnStatementCheckV1(w, v.statement_check);
  w.raw(',"overloads":'); w.array(v.overloads, (item0) => { emitPrivateTxnOverloadV1(w, item0); });
  w.raw(',"confidential_columns":'); w.array(v.confidential_columns, (item0) => { emitPrivateTxnConfidentialColumnsV1(w, item0); });
  w.raw(',"confidential_grants":'); w.bytes(v.confidential_grants);
  w.raw('}');
}

function readPrivateTxnContextV1(value: unknown): PrivateTxnContextV1 {
  const v = object(value, ['definition', 'owner', 'tombstoned', 'caller_roles', 'gas_declared', 'declared_gas', 'network_gas', 'schema_features', 'statement_check', 'overloads', 'confidential_columns', 'confidential_grants']);
  return {
    definition: readPrivateTxnDefinitionV1(v.definition),
    owner: checkedHex(v.owner, 20),
    tombstoned: checkedBool(v.tombstoned),
    caller_roles: array(v.caller_roles, (item0) => checkedString(item0)),
    gas_declared: checkedBool(v.gas_declared),
    declared_gas: readPrivateTxnGasV1(v.declared_gas),
    network_gas: readPrivateTxnGasV1(v.network_gas),
    schema_features: readPrivateTxnSchemaFeaturesV1(v.schema_features),
    statement_check: readPrivateTxnStatementCheckV1(v.statement_check),
    overloads: array(v.overloads, (item0) => readPrivateTxnOverloadV1(item0)),
    confidential_columns: array(v.confidential_columns, (item0) => readPrivateTxnConfidentialColumnsV1(item0)),
    confidential_grants: readBytes(v.confidential_grants),
  };
}

function emitPrivateTxnDefinitionV1(w: Writer, v: PrivateTxnDefinitionV1): void {
  object(v, ['contract_address', 'contract_name', 'version', 'type', 'schema', 'procedures', 'roles', 'role_assignments', 'procedure_access']);
  w.raw('{"contract_address":'); w.string(v.contract_address);
  w.raw(',"contract_name":'); w.string(v.contract_name);
  w.raw(',"version":'); w.string(v.version);
  w.raw(',"type":'); w.string(v.type);
  w.raw(',"schema":'); emitPrivateTxnSchemaV1(w, v.schema);
  w.raw(',"procedures":'); w.array(v.procedures, (item0) => { emitPrivateTxnProcedureV1(w, item0); });
  w.raw(',"roles":'); w.array(v.roles, (item0) => { w.string(item0); });
  w.raw(',"role_assignments":'); w.array(v.role_assignments, (item0) => { emitPrivateTxnRoleAssignmentV1(w, item0); });
  w.raw(',"procedure_access":'); w.array(v.procedure_access, (item0) => { emitPrivateTxnProcedureAccessV1(w, item0); });
  w.raw('}');
}

function readPrivateTxnDefinitionV1(value: unknown): PrivateTxnDefinitionV1 {
  const v = object(value, ['contract_address', 'contract_name', 'version', 'type', 'schema', 'procedures', 'roles', 'role_assignments', 'procedure_access']);
  return {
    contract_address: checkedString(v.contract_address),
    contract_name: checkedString(v.contract_name),
    version: checkedString(v.version),
    type: checkedString(v.type),
    schema: readPrivateTxnSchemaV1(v.schema),
    procedures: array(v.procedures, (item0) => readPrivateTxnProcedureV1(item0)),
    roles: array(v.roles, (item0) => checkedString(item0)),
    role_assignments: array(v.role_assignments, (item0) => readPrivateTxnRoleAssignmentV1(item0)),
    procedure_access: array(v.procedure_access, (item0) => readPrivateTxnProcedureAccessV1(item0)),
  };
}

function emitPrivateTxnSchemaV1(w: Writer, v: PrivateTxnSchemaV1): void {
  object(v, ['tables']);
  w.raw('{"tables":'); w.array(v.tables, (item0) => { emitPrivateTxnTableV1(w, item0); });
  w.raw('}');
}

function readPrivateTxnSchemaV1(value: unknown): PrivateTxnSchemaV1 {
  const v = object(value, ['tables']);
  return {
    tables: array(v.tables, (item0) => readPrivateTxnTableV1(item0)),
  };
}

function emitPrivateTxnTableV1(w: Writer, v: PrivateTxnTableV1): void {
  object(v, ['name', 'columns', 'indexes']);
  w.raw('{"name":'); w.string(v.name);
  w.raw(',"columns":'); w.array(v.columns, (item0) => { emitPrivateTxnColumnV1(w, item0); });
  w.raw(',"indexes":'); w.array(v.indexes, (item0) => { emitPrivateTxnIndexV1(w, item0); });
  w.raw('}');
}

function readPrivateTxnTableV1(value: unknown): PrivateTxnTableV1 {
  const v = object(value, ['name', 'columns', 'indexes']);
  return {
    name: checkedString(v.name),
    columns: array(v.columns, (item0) => readPrivateTxnColumnV1(item0)),
    indexes: array(v.indexes, (item0) => readPrivateTxnIndexV1(item0)),
  };
}

function emitPrivateTxnColumnV1(w: Writer, v: PrivateTxnColumnV1): void {
  object(v, ['name', 'type', 'constraints']);
  w.raw('{"name":'); w.string(v.name);
  w.raw(',"type":'); w.string(v.type);
  w.raw(',"constraints":'); w.array(v.constraints, (item0) => { w.string(item0); });
  w.raw('}');
}

function readPrivateTxnColumnV1(value: unknown): PrivateTxnColumnV1 {
  const v = object(value, ['name', 'type', 'constraints']);
  return {
    name: checkedString(v.name),
    type: checkedString(v.type),
    constraints: array(v.constraints, (item0) => checkedString(item0)),
  };
}

function emitPrivateTxnIndexV1(w: Writer, v: PrivateTxnIndexV1): void {
  object(v, ['name', 'columns']);
  w.raw('{"name":'); w.string(v.name);
  w.raw(',"columns":'); w.array(v.columns, (item0) => { w.string(item0); });
  w.raw('}');
}

function readPrivateTxnIndexV1(value: unknown): PrivateTxnIndexV1 {
  const v = object(value, ['name', 'columns']);
  return {
    name: checkedString(v.name),
    columns: array(v.columns, (item0) => checkedString(item0)),
  };
}

function emitPrivateTxnProcedureV1(w: Writer, v: PrivateTxnProcedureV1): void {
  object(v, ['name', 'params', 'returns', 'body', 'role_required', 'read_only', 'point_write']);
  w.raw('{"name":'); w.string(v.name);
  w.raw(',"params":'); w.array(v.params, (item0) => { emitPrivateTxnParameterV1(w, item0); });
  w.raw(',"returns":'); w.string(v.returns);
  w.raw(',"body":'); w.string(v.body);
  w.raw(',"role_required":'); w.string(v.role_required);
  w.raw(',"read_only":'); w.bool(v.read_only);
  w.raw(',"point_write":'); if (v.point_write === null) w.raw("null"); else { emitPrivateTxnPointWriteV1(w, v.point_write); }
  w.raw('}');
}

function readPrivateTxnProcedureV1(value: unknown): PrivateTxnProcedureV1 {
  const v = object(value, ['name', 'params', 'returns', 'body', 'role_required', 'read_only', 'point_write']);
  return {
    name: checkedString(v.name),
    params: array(v.params, (item0) => readPrivateTxnParameterV1(item0)),
    returns: checkedString(v.returns),
    body: checkedString(v.body),
    role_required: checkedString(v.role_required),
    read_only: checkedBool(v.read_only),
    point_write: v.point_write === null ? null : readPrivateTxnPointWriteV1(v.point_write),
  };
}

function emitPrivateTxnParameterV1(w: Writer, v: PrivateTxnParameterV1): void {
  object(v, ['name', 'type']);
  w.raw('{"name":'); w.string(v.name);
  w.raw(',"type":'); w.string(v.type);
  w.raw('}');
}

function readPrivateTxnParameterV1(value: unknown): PrivateTxnParameterV1 {
  const v = object(value, ['name', 'type']);
  return {
    name: checkedString(v.name),
    type: checkedString(v.type),
  };
}

function emitPrivateTxnPointWriteV1(w: Writer, v: PrivateTxnPointWriteV1): void {
  object(v, ['table', 'op', 'pk']);
  w.raw('{"table":'); w.string(v.table);
  w.raw(',"op":'); w.string(v.op);
  w.raw(',"pk":'); w.array(v.pk, (item0) => { emitPrivateTxnPKBindingV1(w, item0); });
  w.raw('}');
}

function readPrivateTxnPointWriteV1(value: unknown): PrivateTxnPointWriteV1 {
  const v = object(value, ['table', 'op', 'pk']);
  return {
    table: checkedString(v.table),
    op: checkedString(v.op),
    pk: array(v.pk, (item0) => readPrivateTxnPKBindingV1(item0)),
  };
}

function emitPrivateTxnPKBindingV1(w: Writer, v: PrivateTxnPKBindingV1): void {
  object(v, ['column', 'param']);
  w.raw('{"column":'); w.string(v.column);
  w.raw(',"param":'); w.string(v.param);
  w.raw('}');
}

function readPrivateTxnPKBindingV1(value: unknown): PrivateTxnPKBindingV1 {
  const v = object(value, ['column', 'param']);
  return {
    column: checkedString(v.column),
    param: checkedString(v.param),
  };
}

function emitPrivateTxnRoleAssignmentV1(w: Writer, v: PrivateTxnRoleAssignmentV1): void {
  object(v, ['role', 'accounts']);
  w.raw('{"role":'); w.string(v.role);
  w.raw(',"accounts":'); w.array(v.accounts, (item0) => { w.string(item0); });
  w.raw('}');
}

function readPrivateTxnRoleAssignmentV1(value: unknown): PrivateTxnRoleAssignmentV1 {
  const v = object(value, ['role', 'accounts']);
  return {
    role: checkedString(v.role),
    accounts: array(v.accounts, (item0) => checkedString(item0)),
  };
}

function emitPrivateTxnProcedureAccessV1(w: Writer, v: PrivateTxnProcedureAccessV1): void {
  object(v, ['procedure', 'allowed_roles']);
  w.raw('{"procedure":'); w.string(v.procedure);
  w.raw(',"allowed_roles":'); w.array(v.allowed_roles, (item0) => { w.string(item0); });
  w.raw('}');
}

function readPrivateTxnProcedureAccessV1(value: unknown): PrivateTxnProcedureAccessV1 {
  const v = object(value, ['procedure', 'allowed_roles']);
  return {
    procedure: checkedString(v.procedure),
    allowed_roles: array(v.allowed_roles, (item0) => checkedString(item0)),
  };
}

function emitPrivateTxnGasV1(w: Writer, v: PrivateTxnGasV1): void {
  object(v, ['base_cost', 'per_row_read', 'per_row_written', 'per_index_used', 'max_gas_per_tx']);
  w.raw('{"base_cost":'); w.u64(v.base_cost);
  w.raw(',"per_row_read":'); w.u64(v.per_row_read);
  w.raw(',"per_row_written":'); w.u64(v.per_row_written);
  w.raw(',"per_index_used":'); w.u64(v.per_index_used);
  w.raw(',"max_gas_per_tx":'); w.u64(v.max_gas_per_tx);
  w.raw('}');
}

function readPrivateTxnGasV1(value: unknown): PrivateTxnGasV1 {
  const v = object(value, ['base_cost', 'per_row_read', 'per_row_written', 'per_index_used', 'max_gas_per_tx']);
  return {
    base_cost: readU64(v.base_cost),
    per_row_read: readU64(v.per_row_read),
    per_row_written: readU64(v.per_row_written),
    per_index_used: readU64(v.per_index_used),
    max_gas_per_tx: readU64(v.max_gas_per_tx),
  };
}

function emitPrivateTxnSchemaFeaturesV1(w: Writer, v: PrivateTxnSchemaFeaturesV1): void {
  object(v, ['check_constraints', 'apply_refusal', 'binding_refusal', 'signature_supersede']);
  w.raw('{"check_constraints":'); w.bool(v.check_constraints);
  w.raw(',"apply_refusal":'); w.bool(v.apply_refusal);
  w.raw(',"binding_refusal":'); w.bool(v.binding_refusal);
  w.raw(',"signature_supersede":'); w.bool(v.signature_supersede);
  w.raw('}');
}

function readPrivateTxnSchemaFeaturesV1(value: unknown): PrivateTxnSchemaFeaturesV1 {
  const v = object(value, ['check_constraints', 'apply_refusal', 'binding_refusal', 'signature_supersede']);
  return {
    check_constraints: checkedBool(v.check_constraints),
    apply_refusal: checkedBool(v.apply_refusal),
    binding_refusal: checkedBool(v.binding_refusal),
    signature_supersede: checkedBool(v.signature_supersede),
  };
}

function emitPrivateTxnStatementCheckV1(w: Writer, v: PrivateTxnStatementCheckV1): void {
  object(v, ['literal_aware', 'drop_superseded_function']);
  w.raw('{"literal_aware":'); w.bool(v.literal_aware);
  w.raw(',"drop_superseded_function":'); w.bool(v.drop_superseded_function);
  w.raw('}');
}

function readPrivateTxnStatementCheckV1(value: unknown): PrivateTxnStatementCheckV1 {
  const v = object(value, ['literal_aware', 'drop_superseded_function']);
  return {
    literal_aware: checkedBool(v.literal_aware),
    drop_superseded_function: checkedBool(v.drop_superseded_function),
  };
}

function emitPrivateTxnOverloadV1(w: Writer, v: PrivateTxnOverloadV1): void {
  object(v, ['procedure', 'arity', 'candidates']);
  w.raw('{"procedure":'); w.string(v.procedure);
  w.raw(',"arity":'); w.u64(v.arity);
  w.raw(',"candidates":'); w.array(v.candidates, (item0) => { w.array(item0, (item1) => { emitPrivateTxnParamTypeV1(w, item1); }); });
  w.raw('}');
}

function readPrivateTxnOverloadV1(value: unknown): PrivateTxnOverloadV1 {
  const v = object(value, ['procedure', 'arity', 'candidates']);
  return {
    procedure: checkedString(v.procedure),
    arity: readU64(v.arity),
    candidates: array(v.candidates, (item0) => array(item0, (item1) => readPrivateTxnParamTypeV1(item1))),
  };
}

function emitPrivateTxnParamTypeV1(w: Writer, v: PrivateTxnParamTypeV1): void {
  object(v, ['category', 'preferred']);
  w.raw('{"category":'); w.string(v.category);
  w.raw(',"preferred":'); w.bool(v.preferred);
  w.raw('}');
}

function readPrivateTxnParamTypeV1(value: unknown): PrivateTxnParamTypeV1 {
  const v = object(value, ['category', 'preferred']);
  return {
    category: checkedString(v.category),
    preferred: checkedBool(v.preferred),
  };
}

function emitPrivateTxnConfidentialColumnsV1(w: Writer, v: PrivateTxnConfidentialColumnsV1): void {
  object(v, ['table', 'columns']);
  w.raw('{"table":'); w.string(v.table);
  w.raw(',"columns":'); w.array(v.columns, (item0) => { w.string(item0); });
  w.raw('}');
}

function readPrivateTxnConfidentialColumnsV1(value: unknown): PrivateTxnConfidentialColumnsV1 {
  const v = object(value, ['table', 'columns']);
  return {
    table: checkedString(v.table),
    columns: array(v.columns, (item0) => checkedString(item0)),
  };
}

function businessRow(value: Uint8Array): void {
  let offset = 0;
  const take = (count: number): Uint8Array => {
    if (count > value.length - offset) return fail('truncated business row');
    const result = value.subarray(offset, offset + count); offset += count; return result;
  };
  const u32 = (): number => { const b = take(4); return new DataView(b.buffer, b.byteOffset, 4).getUint32(0); };
  const prefix = take(u32());
  // Match the node's IsRowElement/DecodeElement, including opaque field bytes.
  if (prefix.length < 2 || prefix[0] !== 82 || prefix[1] !== 58) fail('effect is not a business row');
  const count = u32();
  if (count > value.length - offset) fail('truncated business row fields');
  for (let i = 0; i < count; i++) {
    const marker = take(1)[0];
    if (marker === 1) take(u32()); else if (marker !== 0) fail('invalid business row presence marker');
  }
  if (offset !== value.length) fail('trailing business row bytes');
}
function encoded<T>(emit: (w: Writer, value: T) => void, value: T): Uint8Array {
  const w = new Writer(); emit(w, value); return w.finish();
}
function validateContext(c: PrivateTxnContextV1): void {
  if (zero(c.owner) || c.tombstoned) fail('unavailable owner or tombstoned context');
  for (let i = 1; i < c.caller_roles.length; i++) if (compareText(c.caller_roles[i - 1], c.caller_roles[i]) > 0) fail('caller roles are not sorted');
  const assignments = c.definition.role_assignments;
  for (let i = 1; i < assignments.length; i++) if (compareText(assignments[i - 1].role, assignments[i].role) >= 0) fail('role assignment keys are not strictly sorted');
  const g = c.declared_gas;
  if (c.gas_declared !== [g.base_cost, g.per_row_read, g.per_row_written, g.per_index_used, g.max_gas_per_tx].some((n) => n !== BigInt(0))) fail('declared gas presence differs from literal policy');
  c.overloads.forEach((o, i) => {
    const prior = c.overloads[i - 1];
    if (prior && (compareText(prior.procedure, o.procedure) > 0 || (prior.procedure === o.procedure && prior.arity >= o.arity))) fail('overload keys are not strictly sorted');
    if (o.arity === BigInt(0) && o.candidates.length) fail('zero arity has no overload candidates');
    let previous: Uint8Array | undefined;
    for (const candidate of o.candidates) {
      if (BigInt(candidate.length) !== o.arity) fail('overload candidate arity differs');
      if (candidate.some((p) => !/^[\x21-\x7e]$/.test(p.category))) fail('overload category is not one printable ASCII byte');
      const w = new Writer(); w.array(candidate, (p) => emitPrivateTxnParamTypeV1(w, p));
      const bytes = w.finish();
      if (previous && compare(previous, bytes) > 0) fail('overload candidates are not sorted');
      previous = bytes;
    }
  });
  for (let i = 1; i < c.confidential_columns.length; i++) if (compareText(c.confidential_columns[i - 1].table, c.confidential_columns[i].table) >= 0) fail('confidential table keys are not strictly sorted');
}
const qualifiedType = /^(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")+")\.(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")+")$/;
function validateMember(m: PrivateTxnMemberV1, maxMembers: number): void {
  if (m.kind !== 'private-txn-member' || m.version !== BigInt(1)) fail('unsupported kind or version');
  if (!Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > DDB_TXN_MAX_OPS || m.count === BigInt(0) || m.count > BigInt(maxMembers) || m.index >= m.count) fail('member index/count outside governed bound');
  const b = m.base;
  if (zero(b.contract) || zero(b.caller) || b.database !== 'c_' + b.contract.slice(2)) fail('invalid database identity');
  if (zero(b.chain) || zero(b.block_hash) || zero(b.state_root)) fail('incomplete completed-block identity');
  if (zero(b.manager) || !isSupportedPlacementManagerRuntime(b.manager_runtime) || b.placement_version === BigInt(0) || zero(b.group_hash) || b.digest_version === BigInt(0) || zero(b.digest_fingerprint)) fail('incomplete placement or digest identity');
  if (![BigInt(4), BigInt(5), BigInt(6), BigInt(7)].includes(m.intent.type)) fail('intent is not a data operation');
  validateContext(b.context);
  for (const side of [m.effect.removed, m.effect.added]) {
    side.forEach((row, i) => { businessRow(row); if (i && compare(side[i - 1], row) > 0) fail('effect rows are not sorted'); });
  }
  let r = 0, a = 0;
  while (r < m.effect.removed.length && a < m.effect.added.length) {
    const c = compare(m.effect.removed[r], m.effect.added[a]);
    if (c === 0) fail('row element appears on both effect sides');
    if (c < 0) r++; else a++;
  }
  for (const c of m.result.columns) if (c.type.includes('\0') || !qualifiedType.test(c.type)) fail('result type must be a qualified PostgreSQL name');
  for (const row of m.result.rows) {
    if (row.length !== m.result.columns.length) fail('result row width differs from columns');
    for (const cell of row) if (cell.null && cell.value.length) fail('SQL NULL result carries bytes');
  }
}

/** Existing member-v1 BASE fragment, used unchanged by authenticated evidence RPCs. */
export function encodePrivateTxnBaseV1(base: PrivateTxnBaseV1): Uint8Array {
  const bytes = encoded(emitPrivateTxnBaseV1, base);
  // Reuse the existing member's BASE/context validation without effects or results.
  validateMember({ kind: 'private-txn-member', version: BigInt(1), base, index: BigInt(0), count: BigInt(1),
    intent: { type: BigInt(7), data: new Uint8Array(), timestamp: BigInt(0), gas_limit: BigInt(0), nonce: BigInt(0), expiry: BigInt(0), key_version: BigInt(0) },
    effect: { added: [], removed: [] }, result: { affected: BigInt(0), columns: [], rows: [] } }, 1);
  return bytes;
}

export function decodePrivateTxnBaseV1(bytes: Uint8Array): PrivateTxnBaseV1 {
  checkedBytes(bytes);
  const base = readPrivateTxnBaseV1(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)));
  if (compare(bytes, encodePrivateTxnBaseV1(base)) !== 0) return fail('not the canonical BASE encoding');
  return base;
}

/** Existing canonical procedure-intent fragment; no new transaction grammar or domain. */
export function encodePrivateTxnIntentV1(intent: PrivateTxnIntentV1): Uint8Array {
  const bytes = encoded(emitPrivateTxnIntentV1, intent);
  if (intent.type !== BigInt(7)) return fail('evidence intent is not a procedure');
  return bytes;
}

export function decodePrivateTxnIntentV1(bytes: Uint8Array): PrivateTxnIntentV1 {
  checkedBytes(bytes);
  const intent = readPrivateTxnIntentV1(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)));
  if (compare(bytes, encodePrivateTxnIntentV1(intent)) !== 0) return fail('not the canonical intent encoding');
  return intent;
}

/** Exact private V1 bytes; maxMembers comes from the captured rules, not a process default. */
export function encodePrivateTxnMemberV1(member: PrivateTxnMemberV1, maxMembers: number): Uint8Array {
  const bytes = encoded(emitPrivateTxnMemberV1, member);
  validateMember(member, maxMembers);
  return bytes;
}

/** Rejects alternate JSON spellings, duplicate/unknown/missing fields and lossy scalars. */
export function decodePrivateTxnMemberV1(bytes: Uint8Array, maxMembers: number): PrivateTxnMemberV1 {
  checkedBytes(bytes);
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const member = readPrivateTxnMemberV1(JSON.parse(raw));
  const canonical = encodePrivateTxnMemberV1(member, maxMembers);
  if (compare(bytes, canonical) !== 0) return fail('not the canonical encoding');
  return member;
}

/** Keep these expected values from the locally authenticated request/snapshot, never copy them from the host response. */
export interface BuildDdbPrivateTransactionInput {
  expectedBase: PrivateTxnBaseV1;
  expectedIntents: PrivateTxnIntentV1[];
  payloads: Uint8Array[];
  /** Optional deterministic openings for test/offline custody; otherwise fresh randomness per member. */
  salts?: Uint8Array[];
  digestKey: Uint8Array;
  callerPubKey: Uint8Array;
  maxMembers: number;
  readVersion: bigint;
  reads: DdbTxnRead[];
}
export interface BuiltDdbPrivateTransaction extends DdbPreparedTxn {
  sidecars: DdbPayloadSidecar[];
}
function safeNumber(value: bigint, field: string): number {
  checkedU64(value);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return fail(field + ' exceeds the existing SDK JSON number representation');
  return Number(value);
}

/**
 * Offline preparation only. There is no submit call here and no private DB-01 admission promise.
 * Compare the host's bytes to local intent and snapshot BEFORE constructing any signing hash.
 * Reuse existing op-v2/TXN domains; no signature or transaction ID enters the committed payload.
 * Existing TXN JSON read_version is a number, so unsafe values refuse rather than round.
 */
export function buildDdbPrivateTransaction(input: BuildDdbPrivateTransactionInput): BuiltDdbPrivateTransaction {
  const { expectedBase: base, expectedIntents: intents, payloads, maxMembers } = input;
  if (!Array.isArray(payloads) || !Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > DDB_TXN_MAX_OPS || payloads.length < 1 || payloads.length > maxMembers) return fail('member count outside governed bound');
  if (!Array.isArray(intents) || intents.length !== payloads.length) return fail('local intent count differs');
  if (input.salts !== undefined && (!Array.isArray(input.salts) || input.salts.length !== payloads.length)) return fail('salt count differs');
  checkedU64(input.readVersion);
  if (!Array.isArray(input.reads) || input.reads.length !== 1) return fail('exactly one whole-database read is required');
  const read = input.reads[0];
  if (read === null || typeof read !== 'object' || Object.keys(read).some((k) => k !== 'table' && k !== 'pk') ||
      (read.table !== undefined && read.table !== '') || (read.pk !== undefined && (!Array.isArray(read.pk) || read.pk.length !== 0))) return fail('whole-database read required');
  if (input.readVersion !== base.block) return fail('read version differs from captured base');
  const readVersion = safeNumber(input.readVersion, 'read version');
  const expectedBase = encoded(emitPrivateTxnBaseV1, base);
  checkedBytes(input.digestKey);
  if (input.digestKey.length !== 32 || !input.digestKey.some((b) => b !== 0) || hex(sha256(input.digestKey)) !== base.digest_fingerprint) return fail('digest key differs from captured fingerprint');
  checkedBytes(input.callerPubKey);
  if (!input.callerPubKey.length) return fail('missing caller public key');
  const sidecars: DdbPayloadSidecar[] = [];
  const built = payloads.map((payload, i) => {
    const member = decodePrivateTxnMemberV1(payload, maxMembers);
    if (member.index !== BigInt(i) || member.count !== BigInt(payloads.length)) return fail('member position/count differs');
    if (compare(encoded(emitPrivateTxnBaseV1, member.base), expectedBase) !== 0) return fail('host base differs from locally retained snapshot');
    if (compare(encoded(emitPrivateTxnIntentV1, member.intent), encoded(emitPrivateTxnIntentV1, intents[i])) !== 0) return fail('host intent differs from locally retained intent');
    if (member.intent.type !== BigInt(7)) return fail('only currently authorized procedure intent can be prepared');
    const intent = member.intent;
    const salt = input.salts === undefined ? randomBytes(32) : input.salts[i];
    checkedBytes(salt);
    const commitment = ddbPayloadCommitment(salt, payload);
    const data = utf8.encode(encodeDdbCommitmentEnvelope({ commitment, placementVersion: base.placement_version, digestKeyVersion: base.digest_version }));
    // Existing validation supplies expiry/time rules and the remaining envelope.
    // Its numeric gas option cannot represent all uint64 values. The placeholder
    // data and gas never enter our actual envelope or commitment/TXN preimage.
    const prepared = buildDdbOp('callprocedure', base.database, {}, base.caller, input.callerPubKey, {
      preimageVersion: 2, chainId: base.chain, timestamp: safeNumber(intent.timestamp, 'timestamp'),
      gasLimit: 0, nonce: intent.nonce, expiry: intent.expiry, keyVersion: intent.key_version,
    });
    const op: DdbCanonicalOpV2 = { type: 15, chainId: base.chain, schemaName: base.database, data, from: base.caller,
      timestamp: intent.timestamp, gasLimit: intent.gas_limit, nonce: intent.nonce, expiry: intent.expiry, keyVersion: intent.key_version };
    const tags = (side: Uint8Array[]) => side.map((row) => {
      const domain = utf8.encode('NEC-DDB-KELEM\x01');
      const message = new Uint8Array(domain.length + row.length); message.set(domain); message.set(row, domain.length);
      return hmac(sha256, input.digestKey, message);
    }).sort(compare).map(base64);
    const stateDelta: DdbTagDelta = {};
    if (member.effect.removed.length) stateDelta.removed = tags(member.effect.removed);
    if (member.effect.added.length) stateDelta.added = tags(member.effect.added);
    sidecars.push({ salt: hex(salt), payload: hex(payload) });
    return { op, envelope: { ...prepared.envelope, type: 15, data: hex(data), gasLimit: '0x' + intent.gas_limit.toString(16), stateDelta } };
  });
  const id = canonicalDdbTxnId(built.map((m) => m.op), input.readVersion, [{}]);
  const idHex = hex(id);
  return {
    id: idHex, sidecars,
    members: built.map((m, i) => {
      const txn: DdbTxnHeaderEnvelope = { id: idHex, index: i, count: built.length };
      if (i === 0) { txn.read_version = readVersion; txn.reads = [{}]; }
      return { hash: canonicalDdbTxnMemberHash(m.op, id, i, built.length), envelope: { ...m.envelope, txn } };
    }),
  };
}
