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
  return { eligible, errors };
}
