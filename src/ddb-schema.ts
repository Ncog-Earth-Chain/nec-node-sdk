// ddb-schema.ts — typed DDB contract-definition interfaces + the point-op (row-lock) declaration.
//
// These interfaces mirror the chain's contract JSON EXACTLY (snake_case field names, so an object typed with
// them serializes directly to what the node parses — inter/ddb_operation.go + ddb/ddbschema/sql_generator.go).
// Build a ContractDefinition, hand it to Ddb.createSchemaSigned, and the node applies it.
//
// POINT-OP / ROW-LOCK: a procedure may carry a `point_write` declaration to become a POINT op — one whose
// written row is identified by primary-key values in the call arguments, WITHOUT executing the body. On a
// node with the row-lock enabled (the default), point ops to DIFFERENT rows of the same contract apply in
// PARALLEL while writes to the SAME row serialize. A contract is "row-lock-eligible" (gets the parallelism)
// only if EVERY mutating procedure is a valid point op — see isRowLockEligible / validateContractDefinition
// below, and docs/design/ddb-pointop-pk-declaration.md. The node re-validates authoritatively at endorsement;
// these helpers give the same verdict at build time.

/** One primary-key column bound to the procedure parameter that supplies its value. */
export interface DdbPKBinding {
  /** a PRIMARY KEY column of the point_write table */
  column: string;
  /** a declared parameter of the procedure supplying that column's value */
  param: string;
}

/** Declares the single row a point-op procedure mutates. */
export interface DdbPointWrite {
  table: string;
  op: 'insert' | 'update' | 'delete' | 'upsert';
  /** one binding per PK column of `table`, in the table's PK column order */
  pk: DdbPKBinding[];
}

export interface DdbParameterDef {
  name: string;
  type: string;
}

export interface DdbProcedureDef {
  name: string;
  params: DdbParameterDef[];
  returns?: string;
  body: string;
  role_required?: string;
  /** present => POINT op (per-row parallelism eligible); absent => predicate op (coarse table lane) */
  point_write?: DdbPointWrite;
}

export interface DdbColumnDef {
  name: string;
  type: string;
  /** e.g. ["primary key", "not null"] — case-insensitive */
  constraints?: string[];
}

export interface DdbIndexDef {
  name: string;
  columns: string[];
}

export interface DdbTableDef {
  name: string;
  columns: DdbColumnDef[];
  indexes?: DdbIndexDef[];
}

export interface DdbSchemaDef {
  tables: DdbTableDef[];
}

/**
 * Per-contract gas metering policy (Data Contract spec, T2.3) — mirrors ddbschema.GasPolicy. All values are
 * gas units. Omitting gas_policy makes the node apply DefaultGasPolicy
 * ({ base_cost: 100, per_row_read: 1, per_row_written: 5, per_index_used: 2, max_gas_per_tx: 100000 }).
 */
export interface DdbGasPolicy {
  base_cost?: number;
  per_row_read?: number;
  per_row_written?: number;
  per_index_used?: number;
  max_gas_per_tx?: number;
}

/** A full DDB contract definition — the object handed to Ddb.createSchema*. Mirrors ddbschema.ContractDefinition. */
export interface ContractDefinition {
  contract_name: string;
  /** contract classification, e.g. "ddbPool"; usually omitted for ordinary user contracts */
  type?: string;
  author?: string;
  description?: string;
  version?: string;
  contract_address?: string;
  schema: DdbSchemaDef;
  procedures?: DdbProcedureDef[];
  roles?: string[];
  role_assignments?: Record<string, string[]>;
  procedure_access?: { procedure: string; allowed_roles: string[] }[];
  /** per-contract gas metering; omit to inherit the network default policy */
  gas_policy?: DdbGasPolicy;
  block_info?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /**
   * UPGRADE ONLY (DB-02i, NEC-189): the procedure signatures this upgrade retypes away -- see
   * {@link DdbSupersededSignature}, {@link deriveSupersedes} and {@link withSupersedes}. Honoured only on a network
   * running `ddb-signature-supersede` (Upgrades3 slot 7, gated); elsewhere a node refuses an upgrade carrying a
   * non-empty list, and a deploy carrying one is refused everywhere. The node reads it from the signed operation
   * data only: it is never stored in the contract's definition.
   */
  supersedes?: DdbSupersededSignature[];
}

/**
 * One entry of an upgrade's `supersedes` list (DB-02i, NEC-189; mirrors ddbschema.SupersededSignature): a procedure
 * signature the DEPLOYED version declares and the upgrade drops. `name` is the procedure's name exactly as deployed
 * (case included: the node quotes it); `params` are its OLD parameter TYPES in order (`[]` for none) -- parameter
 * names are not part of a Postgres signature.
 *
 * Under `ddb-signature-supersede` every endorser requires the list to EQUAL the change set against the deployed
 * definition (no entry missing, no extra entry, the deployed types), and the upgrade's DDL then runs
 * `DROP FUNCTION IF EXISTS "<db>"."<name>"(<old types>)` for each entry before the procedures' CREATE OR REPLACE, so
 * after the upgrade the declared function is the only one a call can reach.
 */
export interface DdbSupersededSignature {
  name: string;
  params: string[];
}

// ---------------------------------------------------------------------------
// Client-side validation (build-time convenience; the node is authoritative)
// ---------------------------------------------------------------------------

const POINT_OPS = new Set(['insert', 'update', 'delete', 'upsert']);
const MUTATING_RE = /\b(insert|update|delete|merge|truncate|copy)\b/i;
// A non-point predicate means the body could match more than one row (rejects the point_write).
const NON_POINT_PREDICATE_RE = /(\bor\b|\blike\b|\bilike\b|\bbetween\b|\bin\s*\(|[<>]|!=|<>)/i;

/**
 * Mask the CONTENTS of single/double-quoted spans (mirrors ddbschema.maskSQLLiterals) so the shape regexes
 * see SQL structure, not data — a write verb or predicate operator inside a string literal ('a > b') is not
 * flagged. Returns null when a quote is unterminated (the caller then fails toward "mutating"/"invalid").
 */
export function maskSQLLiterals(body: string): string | null {
  let out = '';
  let quote = ''; // '' outside a span, else "'" or '"'
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote === '' && (c === "'" || c === '"')) { quote = c; out += c; }
    else if (quote !== '' && c === quote) {
      if (body[i + 1] === quote) { out += 'xx'; i++; continue; } // doubled quote = escaped, not a terminator
      quote = ''; out += c;
    } else if (quote !== '') { out += 'x'; }
    else out += c;
  }
  return quote === '' ? out : null;
}

/** The primary-key column names of a table, in declared order (mirrors ddbschema.TablePKColumns). */
export function tablePKColumns(table: DdbTableDef): string[] {
  return table.columns
    .filter((c) => (c.constraints || []).some((k) => k.trim().toLowerCase() === 'primary key'))
    .map((c) => c.name);
}

/** Whether a procedure body performs a mutation (over the masked body; fails toward "mutating"). */
export function isMutatingBody(body: string): boolean {
  const masked = maskSQLLiterals(body || '');
  if (masked === null) return true; // un-maskable => conservatively mutating (matches the node)
  return MUTATING_RE.test(masked);
}

/**
 * Validate a procedure's point_write against its table + body (mirrors ddbschema.ValidatePointWrite). Returns
 * a list of problems ([] = valid, or no declaration). tablesByName is keyed by lower-cased table name.
 */
export function validatePointWrite(proc: DdbProcedureDef, tablesByName: Map<string, DdbTableDef>): string[] {
  const pw = proc.point_write;
  if (!pw) return [];
  const errs: string[] = [];
  const tbl = tablesByName.get(pw.table.toLowerCase());
  if (!tbl) return [`procedure "${proc.name}" point_write names unknown table "${pw.table}"`];
  if (!POINT_OPS.has((pw.op || '').toLowerCase()))
    errs.push(`procedure "${proc.name}" point_write op "${pw.op}" must be insert|update|delete|upsert`);

  const pkCols = tablePKColumns(tbl);
  if (pkCols.length === 0) errs.push(`procedure "${proc.name}" point_write table "${pw.table}" has no PRIMARY KEY`);
  else if ((pw.pk || []).length !== pkCols.length)
    errs.push(`procedure "${proc.name}" point_write binds ${(pw.pk || []).length} pk columns but table "${pw.table}" has ${pkCols.length} (${pkCols.join(', ')})`);
  else {
    const params = new Set(proc.params.map((p) => p.name));
    pw.pk.forEach((b, i) => {
      if (b.column.toLowerCase() !== pkCols[i].toLowerCase())
        errs.push(`procedure "${proc.name}" point_write pk[${i}] column "${b.column}" must be "${pkCols[i]}" (table PK order)`);
      if (!params.has(b.param))
        errs.push(`procedure "${proc.name}" point_write pk[${i}] param "${b.param}" is not a declared parameter`);
    });
  }

  // Serial PK is node-non-deterministic -> a point op needs a natural/business key.
  const colType = new Map(tbl.columns.map((c) => [c.name.toLowerCase(), (c.type || '').toLowerCase()]));
  for (const b of pw.pk || []) {
    if ((colType.get(b.column.toLowerCase()) || '').includes('serial'))
      errs.push(`procedure "${proc.name}" point_write pk column "${b.column}" is serial — use a natural/business primary key`);
  }

  // Body agreement: leading verb matches op; every bound PK param referenced; exact-PK predicate only.
  const masked = maskSQLLiterals(proc.body || '');
  if (masked === null) {
    errs.push(`procedure "${proc.name}" point_write body cannot be safely analyzed (unterminated quote)`);
    return errs;
  }
  const wantLead = ({ insert: 'insert', upsert: 'insert', update: 'update', delete: 'delete' } as Record<string, string>)[(pw.op || '').toLowerCase()];
  const lead = masked.match(/^\s*\(*\s*([a-z]+)/i)?.[1]?.toLowerCase();
  if (lead !== wantLead) errs.push(`procedure "${proc.name}" point_write op "${pw.op}" requires the body to begin with "${wantLead}", got "${lead}"`);
  // Every bound PK param must be referenced in the body (mirrors point_write.go check-4).
  for (const b of pw.pk || []) {
    if (!new RegExp('\\$' + b.param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(proc.body || ''))
      errs.push(`procedure "${proc.name}" point_write pk param "${b.param}" is never referenced in the body`);
  }
  if (NON_POINT_PREDICATE_RE.test(masked))
    errs.push(`procedure "${proc.name}" point_write body uses a non-point predicate — a point op must match exactly one row by primary-key equality`);
  return errs;
}

/**
 * Whether a contract is ROW-LOCK-ELIGIBLE: every mutating procedure is a valid point op (so its point ops get
 * per-row parallelism). A single mutating procedure without a valid point_write makes the whole contract fall
 * back to the classic per-contract lane. Mirrors ddbschema.ContractRowLockEligible + ValidatePointWrite.
 */
export function isRowLockEligible(contract: ContractDefinition): boolean {
  return validateContractDefinition(contract).eligible;
}

/**
 * Validate a contract definition's point-op declarations and report row-lock eligibility. `errors` lists any
 * malformed point_write (which the node would reject at endorsement); `eligible` is true when every mutating
 * procedure is a valid point op. A non-eligible contract still deploys — it just runs on the classic lane.
 */
export function validateContractDefinition(contract: ContractDefinition): { eligible: boolean; errors: string[] } {
  const tablesByName = new Map<string, DdbTableDef>();
  for (const t of contract.schema?.tables || []) tablesByName.set(t.name.toLowerCase(), t);

  const errors: string[] = [];
  let eligible = true;
  for (const proc of contract.procedures || []) {
    const e = validatePointWrite(proc, tablesByName);
    if (e.length) errors.push(...e);
    if (!proc.point_write && isMutatingBody(proc.body)) eligible = false; // a predicate mutator
    if (proc.point_write && e.length) eligible = false; // a broken point op
  }
  errors.push(...validateSupersedes(contract.supersedes)); // DB-02i: the node parses the list strictly
  return { eligible, errors };
}

// ---------------------------------------------------------------------------
// DB-02i (NEC-189): the `supersedes` list of a retyping upgrade (ddb/ddbschema/procedure_supersede.go)
// ---------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/; // ddbschema.identRe

function sameSignature(a: DdbSupersededSignature, b: DdbSupersededSignature): boolean {
  return a.name === b.name && a.params.length === b.params.length &&
    a.params.every((t, i) => t.toLowerCase() === b.params[i].toLowerCase());
}

function signatureString(s: DdbSupersededSignature): string {
  return `${JSON.stringify(s.name)}(${s.params.join(', ')})`;
}

/**
 * Validate a `supersedes` value the way the node parses it (ddbschema.ParseSupersedes): absent, `null` and `[]` are no
 * list; anything else must be an array of `{ name, params }` objects with no other key, a valid procedure identifier,
 * `params` an array of type strings (required: `[]` for none), and no signature listed twice (types compared without
 * regard to case). Returns the errors, empty when valid. The node re-validates authoritatively (including the
 * column-type allow-list) at endorsement.
 */
export function validateSupersedes(list: unknown): string[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return ['"supersedes" must be an array of {"name", "params"} entries'];
  const errors: string[] = [];
  const seen: DdbSupersededSignature[] = [];
  list.forEach((e, i) => {
    const at = `supersedes entry ${i + 1}`;
    if (e === null || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${at}: must be an object {"name", "params"}`); return; }
    for (const k of Object.keys(e)) if (k !== 'name' && k !== 'params') errors.push(`${at}: unknown key ${JSON.stringify(k)}`);
    const { name, params } = e as { name?: unknown; params?: unknown };
    if (typeof name !== 'string' || !IDENT_RE.test(name)) {
      errors.push(`${at}: invalid procedure identifier ${JSON.stringify(name)} (must match [A-Za-z_][A-Za-z0-9_]{0,62})`);
      return;
    }
    if (params === undefined || params === null) { errors.push(`${at} (${JSON.stringify(name)}): "params" is required (the old parameter types, [] for none)`); return; }
    if (!Array.isArray(params) || params.some((t) => typeof t !== 'string' || t.trim() === '')) {
      errors.push(`${at} (${JSON.stringify(name)}): "params" must be an array of parameter type strings`);
      return;
    }
    const sig: DdbSupersededSignature = { name, params: params as string[] };
    const j = seen.findIndex((s) => sameSignature(s, sig));
    if (j >= 0) errors.push(`supersedes lists ${signatureString(sig)} twice (entries ${j + 1} and ${i + 1})`);
    seen.push(sig);
  });
  return errors;
}

/**
 * The `supersedes` list an upgrade from `deployed` to `next` must carry (mirrors ddbschema.SupersededSignatures, the
 * change set every endorser compares the list with): every deployed procedure signature the new version leaves
 * undeclared. Per (name folded to lower case, parameter count): when `next` re-declares one of the deployed
 * declarations there UNCHANGED -- the same name exactly, the same parameter names exactly, the same types (case
 * aside) -- nothing there is superseded; otherwise every deployed declaration there is. So a changed type, a renamed
 * parameter, an added or removed parameter or a changed name case each supersede the old signature, while a body
 * change or a new overload at another parameter count supersedes nothing. In deployed declaration order, each
 * signature once. Pure: it reads the two definitions only.
 *
 * `deployed` must be the definition the network actually holds (the contract's current version), or the endorsers
 * refuse the list as a mismatch.
 */
export function deriveSupersedes(deployed: ContractDefinition, next: ContractDefinition): DdbSupersededSignature[] {
  const key = (name: string, arity: number) => `${name.toLowerCase()}\u0000${arity}`;
  const declared = new Map<string, DdbProcedureDef[]>();
  for (const p of next.procedures || []) {
    const k = key(p.name, (p.params || []).length);
    declared.set(k, [...(declared.get(k) || []), p]);
  }
  const stored = deployed.procedures || [];
  // keepsOne (procedure_signature.go): some deployed declaration at this key is re-declared unchanged.
  const keepsOne = (k: string): boolean => stored.some((op) =>
    key(op.name, (op.params || []).length) === k &&
    (declared.get(k) || []).some((np) => np.name === op.name && (np.params || []).length === (op.params || []).length &&
      (op.params || []).every((pa, i) => pa.name === np.params[i].name && pa.type.toLowerCase() === np.params[i].type.toLowerCase())));
  const kept = new Map<string, boolean>();
  const out: DdbSupersededSignature[] = [];
  for (const op of stored) {
    const k = key(op.name, (op.params || []).length);
    if (!kept.has(k)) kept.set(k, keepsOne(k));
    if (kept.get(k)) continue;
    const sig: DdbSupersededSignature = { name: op.name, params: (op.params || []).map((p) => p.type) };
    if (!out.some((o) => sameSignature(o, sig))) out.push(sig);
  }
  return out;
}

/** Options of {@link withSupersedes} (and of Ddb.updateSchemaSigned). */
export interface DdbSupersedesOptions {
  /** The list to sign, as is. With `deployed` too, it must equal the derived list. `[]` signs no list. */
  supersedes?: DdbSupersededSignature[];
  /** The definition the network holds now: the list is derived from it and the new definition (deriveSupersedes). */
  deployed?: ContractDefinition;
}

/**
 * `definition` (a typed object or its JSON string) with the `supersedes` key set from `opts`: the explicit list, or
 * the one derived from `opts.deployed`, or -- both given -- the explicit list after checking it equals the derived one
 * (the endorsers' rule, ddbschema.CheckSupersedes). An EMPTY result leaves the key absent, so an upgrade that retypes
 * nothing is byte-identical to what an earlier SDK signs and stays valid on a network without
 * `ddb-signature-supersede`. Throws on a malformed or mismatched list, or when `definition` already carries the key.
 * Returns a new object; the inputs are not modified.
 */
export function withSupersedes(definition: string | ContractDefinition, opts: DdbSupersedesOptions): ContractDefinition {
  const def: ContractDefinition = typeof definition === 'string' ? JSON.parse(definition) : { ...definition };
  if (def.supersedes !== undefined) {
    throw new Error('the definition already carries "supersedes": pass the list either inside the definition or as an option, not both');
  }
  let list = opts.supersedes;
  if (list !== undefined) {
    const errs = validateSupersedes(list);
    if (errs.length) throw new Error(`invalid supersedes list:\n  - ${errs.join('\n  - ')}`);
  }
  if (opts.deployed) {
    const derived = deriveSupersedes(opts.deployed, def);
    if (list === undefined) {
      list = derived;
    } else if (list.length !== derived.length || !list.every((l) => derived.some((d) => sameSignature(d, l)))) {
      throw new Error(`supersedes ${JSON.stringify(list)} does not match the signatures this upgrade leaves undeclared ` +
        `against the deployed definition: ${JSON.stringify(derived)} (every endorser refuses a mismatch)`);
    }
  }
  if (list && list.length) def.supersedes = list.map((s) => ({ name: s.name, params: [...s.params] }));
  return def;
}

/** Whether a definition (typed or JSON) carries a NON-EMPTY supersedes list -- which a deploy never may. */
export function carriesSupersedes(definition: string | ContractDefinition): boolean {
  let def: unknown = definition;
  if (typeof definition === 'string') {
    try { def = JSON.parse(definition); } catch { return false; } // malformed JSON fails later, as before
  }
  const s = (def as { supersedes?: unknown } | null)?.supersedes;
  return s !== undefined && s !== null && !(Array.isArray(s) && s.length === 0);
}
