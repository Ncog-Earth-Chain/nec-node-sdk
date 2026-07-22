# DDB Function Reference

This document is the complete reference for the **DDB (Decentralized DataBase)** module of the
`necjs` SDK — the client for NCOG Earth Chain's on-chain relational database (`ddb_*` JSON-RPC
namespace). It covers the write/read model, the full `Ddb` class surface, the typed
`ContractDefinition` authoring surface, and the point-op (row-lock) rules — with a fully worked
row-lock-eligible example.

Every symbol below is exported from `necjs`. Import them from the package root:

```typescript
import {
  Provider,
  Ddb,
  validateContractDefinition,
  isRowLockEligible,
  type ContractDefinition,
  type DdbProcedureDef,
  type DdbEndorsementStatus,
  type DdbRow,
} from 'necjs';
```

---

## 1. Model overview

### 1.1 Writes are client-signed (the production path)

A DDB **mutation** (create a schema, call a stored procedure, grant/revoke a role) is authorized by
the *caller*, who signs the operation client-side with their own **ML-DSA-87** private key. A
production node never signs on a caller's behalf.

Use the `*Signed` methods:

| Method | Purpose |
| --- | --- |
| `createSchemaSigned(privateKey, contractName, definition, opts?)` | Deploy a contract schema |
| `callProcedureSigned(privateKey, dbName, procedure, args?, opts?)` | Invoke a stored procedure |
| `grantRoleSigned(privateKey, dbName, role, account, opts?)` | Grant a role (admin-gated) |
| `revokeRoleSigned(privateKey, dbName, role, account, opts?)` | Revoke a role (admin-gated) |

Each returns a **`requestId`** — a `0x`-prefixed 32-byte hex string equal to
`keccak256(canonicalBytes ‖ requester)`. This is the endorsement request id, **not** a committed EVM
tx hash: DDB commit transactions are authored by the block leader, so a caller cannot know one
up-front. The `requestId` is the stable handle used to track the write.

The `from` address is **derived from the private key** (`address = keccak256(rawPubkey)[-20:]`), so
a signed operation always names its true signer — you never pass `from` yourself.

### 1.2 Write lifecycle

```
sign(op)  ──►  ddb_submitSignedOp  ──►  2f+1 endorsement quorum  ──►  block finality
                                                                          │
                                        async durable Postgres apply  ◄───┘
```

1. The SDK signs the operation's canonical hash with the caller's ML-DSA-87 key.
2. It submits the signed op via `ddb_submitSignedOp` and returns the `requestId`.
3. Validators endorse until a `2f+1` quorum is reached.
4. The write is committed in a finalized block.
5. The effect is applied to each node's Postgres shortly **after** commit and becomes queryable via
   the read methods.

Track the write with `getEndorsementStatus(requestId)` (single poll) or
`await waitForEndorsement(requestId)` (polls until endorsed/committed or times out).

### 1.3 Deprecated server-signed writes

The bare methods `createSchema` / `callProcedure` / `grantRole` / `revokeRole` are **DEPRECATED**.
They pass a bare `from` and rely on the node holding the caller's key, which requires the node to
run with `NEC_DDB_ALLOW_LOCAL_SIGN=1`. They **fail closed on a default (production) node** and emit a
one-time deprecation warning. Prefer the `*Signed` methods in all new code.

### 1.4 Reads need no consensus

`getSchema` / `select` / `query` hit the node's **own local Postgres** directly. They require no
consensus and return in ~milliseconds. They read what *this* node has durably applied.

### 1.5 Schema naming — contract name vs. derived db_name

This is the single most common source of confusion:

- **`createSchemaSigned` takes the raw CONTRACT NAME** (e.g. `'balances'`). The node derives the
  underlying `db_name` from the definition's `contract_name` + `contract_address`.
- **Every other schema-scoped method takes the DERIVED `db_name`** — compute it with
  `Ddb.deriveDbName(contractName, contractAddress)`.

```typescript
Ddb.deriveDbName('balances', '0x0000000000000000000000000000000000abcdef');
// => 'balances_abcdef'   (lowercase(contractName + '_' + last 6 chars of address))
```

Methods that take the derived `db_name`: `callProcedureSigned`, `grantRoleSigned`,
`revokeRoleSigned`, `getSchema`, `select`, `query`, `getStateAcc`.

---

## 2. `Ddb` class

```typescript
const provider = new Provider('https://rpc.ncog.earth');
const ddb = new Ddb(provider);
```

### Constructor

`new Ddb(provider: Provider)` — wraps a `Provider` and exposes the `ddb_*` namespace.

### `static deriveDbName(contractName, contractAddress)`

- **Signature:** `Ddb.deriveDbName(contractName: string, contractAddress: string): string`
- **Returns:** `lowercase(contractName + '_' + contractAddress.slice(-6))`.
- **Use:** the `db_name` argument for every schema-scoped method except `createSchemaSigned`.

### Writes — client-signed (production path)

#### `createSchemaSigned(privateKey, contractName, definition, opts?)`

- **Signature:** `createSchemaSigned(privateKey: string, schemaName: string, definition: string | ContractDefinition, opts?: DdbSignOptions): Promise<string>`
- **Params:**
  - `privateKey` — the caller's `0x`-hex ML-DSA-87 private key.
  - `schemaName` — the raw **contract name**.
  - `definition` — a raw JSON string **or** a typed `ContractDefinition`.
  - `opts?` — `DdbSignOptions` (`timestamp`, `gasLimit`).
- **Returns:** the endorsement `requestId` (`0x`-hex string).
- **Notes:** when `definition` is a typed object, `validateContractDefinition` runs client-side first
  and this method **throws** if `errors` is non-empty (a malformed `point_write` the node would
  reject at endorsement). A raw JSON string is submitted as-is (not pre-validated).

#### `callProcedureSigned(privateKey, dbName, procedure, args?, opts?)`

- **Signature:** `callProcedureSigned(privateKey: string, schemaName: string, procedure: string, args?: string[], opts?: DdbSignOptions): Promise<string>`
- **Params:** `dbName` is the derived `db_name`; `procedure` is the procedure name; `args` is an
  array of **string** arguments (defaults to `[]`).
- **Returns:** the endorsement `requestId`.

#### `grantRoleSigned(privateKey, dbName, role, account, opts?)` / `revokeRoleSigned(...)`

- **Signature:** `grantRoleSigned(privateKey: string, schemaName: string, role: string, account: string, opts?: DdbSignOptions): Promise<string>`
- **Params:** `dbName` is the derived `db_name`; `role` is the role name; `account` is the target
  address. Admin-gated on the node.
- **Returns:** the endorsement `requestId`.

#### `waitForEndorsement(requestId, opts?)`

- **Signature:** `waitForEndorsement(requestId: string, opts?: { intervalMs?: number; timeoutMs?: number }): Promise<DdbEndorsementStatus>`
- **Behavior:** polls `getEndorsementStatus(requestId)` every `intervalMs` (default `1000`) until the
  status is committed/finalized/applied, then resolves with the final `DdbEndorsementStatus`.
- **Defaults:** `intervalMs = 1000`, `timeoutMs = 60000`. **Rejects** on timeout.

### Writes — legacy server-signed (DEPRECATED)

| Method | Signature |
| --- | --- |
| `createSchema` | `createSchema(from: string, schemaName: string, definition: string \| ContractDefinition): Promise<string>` |
| `callProcedure` | `callProcedure(from: string, schemaName: string, procedure: string, args?: string[]): Promise<string>` |
| `grantRole` | `grantRole(from: string, schemaName: string, role: string, account: string): Promise<string>` |
| `revokeRole` | `revokeRole(from: string, schemaName: string, role: string, account: string): Promise<string>` |

Each takes a bare `from`, requires the node to run `NEC_DDB_ALLOW_LOCAL_SIGN=1`, fails closed on a
default node, and warns once per process. Use the `*Signed` equivalents instead.

### Reads (this node's Postgres; no consensus)

#### `getSchema(dbName)`

- **Signature:** `getSchema(schemaName: string): Promise<DdbSchemaInfo>`
- **Returns:** the contract-schema descriptor(s) for the `db_name` (all contracts when name is `''`).

#### `select(dbName, tableName, opts?)`

- **Signature:** `select(schemaName: string, tableName: string, opts?: DdbQueryOptions): Promise<DdbRow[]>`
- **Params:** `opts` supports `filters`, `orderBy`, `orderDir`, `limit`, `offset`.
- **Returns:** an array of rows (`DdbRow = Record<string, unknown>`).

#### `query(dbName, tableName, limit?)`

- **Signature:** `query(schemaName: string, tableName: string, limit?: number): Promise<DdbRow[]>`
- **Params:** `limit` defaults to `100`. A simple unfiltered fetch of up to `limit` rows.

### Status / introspection

| Method | Signature | Returns |
| --- | --- | --- |
| `getValidators` | `getValidators(): Promise<DdbValidatorSet>` | The DDB committee + BFT threshold |
| `getEndorsementStatus` | `getEndorsementStatus(requestId: string): Promise<DdbEndorsementStatus>` | Endorsement status for a `requestId` |
| `getConsensusStats` | `getConsensusStats(): Promise<DdbConsensusStats>` | Dual-consensus counters |
| `getStats` | `getStats(): Promise<DdbStorageStats>` | This node's DDB storage counters |
| `getStateAcc` | `getStateAcc(schemaName: string): Promise<{ acc: string; sum: string; ops: string }>` | Node-local per-contract state accumulator (row-lock diagnostic); `schemaName` = derived `db_name`. Errors under the `linear` state-hash mode |
| `shadowStatus` | `shadowStatus(): Promise<{ mode: string; checks: string; mismatches: string }>` | Node-local state-hash mode + shadow-soak counters (`mode` is `'linear' \| 'shadow' \| 'lt'`) |

---

## 3. Typed shapes (read/status responses)

```typescript
type DdbFilterOp = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'like' | 'ilike' | 'in' | (string & {});

interface DdbFilter {
  column: string;
  op: DdbFilterOp;
  value: string;
}

interface DdbQueryOptions {
  filters?: DdbFilter[];
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

interface DdbSignOptions {
  timestamp?: number; // unix seconds; defaults to now
  gasLimit?: number;  // defaults to 100000
}

type DdbRow = Record<string, unknown>;

interface DdbSchemaInfo {
  contracts?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

interface DdbEndorsementStatus {
  requestId: string;
  status: string; // e.g. "pending" | "endorsed" | "committed" | "failed" (node-defined)
  request?: { operation: number; schemaName: string; requester: string; timestamp: number };
  endorsement?: { operationHash: string; dataHash: string; signatures: number; validators: number; timestamp: number };
  error?: string;
  [k: string]: unknown;
}

interface DdbConsensusStats {
  pendingRequests: number;
  completedEndorsements: number;
  validatorCount: number;
  threshold: number;
}

interface DdbValidatorSet {
  validators: string[];
  count: number;
  threshold: number;
}

interface DdbStorageStats {
  schemaCount: number;
  tableCount: number;
  operationCount: number;
}
```

> `DdbSignOptions.timestamp` and `.gasLimit` are both part of the signed canonical hash — the node
> uses exactly these values. Override them only for deterministic tests, not in normal use.

---

## 4. `ContractDefinition` authoring surface

Every field name is **snake_case** because a `ContractDefinition` serializes directly to the node's
wire JSON.

```typescript
interface ContractDefinition {
  contract_name: string;                                       // required — the contract name
  type?: string;                                               // classification, e.g. "ddbPool" (usually omitted)
  author?: string;
  description?: string;
  version?: string;
  contract_address?: string;                                   // used with contract_name to derive db_name
  schema: DdbSchemaDef;                                        // required — table definitions
  procedures?: DdbProcedureDef[];
  roles?: string[];
  role_assignments?: Record<string, string[]>;                // role -> account addresses
  procedure_access?: { procedure: string; allowed_roles: string[] }[];
  gas_policy?: DdbGasPolicy;                                   // omit to inherit the network default
  block_info?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface DdbSchemaDef {
  tables: DdbTableDef[];
}

interface DdbTableDef {
  name: string;
  columns: DdbColumnDef[];
  indexes?: DdbIndexDef[];
}

interface DdbColumnDef {
  name: string;
  type: string;
  constraints?: string[]; // e.g. ["primary key", "not null"] — case-insensitive
}

interface DdbIndexDef {
  name: string;
  columns: string[];
}

interface DdbProcedureDef {
  name: string;
  params: DdbParameterDef[];
  returns?: string;
  body: string;                 // the SQL body; parameters referenced as $paramName
  role_required?: string;
  point_write?: DdbPointWrite;  // present => POINT op (per-row parallelism); absent => predicate op (table lane)
}

interface DdbParameterDef {
  name: string;
  type: string;
}

interface DdbPointWrite {
  table: string;
  op: 'insert' | 'update' | 'delete' | 'upsert';
  pk: DdbPKBinding[];           // one binding per PK column of `table`, in the table's PK column order
}

interface DdbPKBinding {
  column: string;               // a PRIMARY KEY column of the point_write table
  param: string;                // a declared parameter of the procedure supplying that column's value
}

interface DdbGasPolicy {
  base_cost?: number;
  per_row_read?: number;
  per_row_written?: number;
  per_index_used?: number;
  max_gas_per_tx?: number;
}
```

> **Default gas policy.** Omitting `gas_policy` makes the node apply its default:
> `{ base_cost: 100, per_row_read: 1, per_row_written: 5, per_index_used: 2, max_gas_per_tx: 100000 }`.

---

## 5. Point ops & row-lock eligibility

A `DdbProcedureDef` can carry a **`point_write`** declaration, making it a **POINT op**: the node
derives the exact written row from the call arguments **without executing the body**, which enables
per-row parallelism. Point ops to *different* rows of the same contract apply in parallel; writes to
the *same* row serialize.

A contract is **row-lock-eligible** — and gets that parallelism — **iff every mutating procedure is a
valid point op**. A single mutating procedure without a valid `point_write` drops the whole contract
back to the classic per-contract lane. (Read-only, non-mutating procedures do not affect
eligibility.)

### 5.1 Point-op rules

For a `point_write` to be valid (all enforced by `validatePointWrite`, mirrored from the node):

1. `op` ∈ `insert | update | delete | upsert`.
2. `pk` has exactly one binding **per primary-key column** of `table`, in the **table's PK column
   order**; each binding's `column` must match the PK column at that position and each `param` must
   be a declared parameter of the procedure.
3. The PK is **natural** — a `serial` primary-key column is rejected (node-non-deterministic).
4. The body's leading verb must match the op: `insert`/`upsert` → body begins with `INSERT`;
   `update` → `UPDATE`; `delete` → `DELETE`.
5. **Every** bound PK param must be referenced (`$param`) in the body.
6. The body may use **exact primary-key equality only** — no `OR`, `LIKE`, `ILIKE`, `BETWEEN`,
   `IN (...)`, `<`, `>`, `!=`, or `<>` predicates (any of these implies more than one row).

### 5.2 Build-time validation helpers

```typescript
// Full report:
validateContractDefinition(def): { eligible: boolean; errors: string[] };

// Boolean shortcut (eligible only):
isRowLockEligible(def): boolean;

// Lower-level building blocks (also exported):
validatePointWrite(proc, tablesByName): string[];  // [] = valid or no declaration
tablePKColumns(table): string[];                    // PK column names, in declared order
isMutatingBody(body): boolean;                      // does a body mutate? (fails toward "mutating")
maskSQLLiterals(body): string | null;               // masks quoted spans; null = unterminated quote
```

- `errors` lists every malformed `point_write` (which the node would reject at endorsement).
- `eligible` is `true` only when every mutating procedure is a valid point op.
- A **non-eligible** contract with an **empty** `errors` array still deploys — it just runs on the
  classic lane. A contract whose `errors` array is **non-empty** is rejected: `createSchemaSigned`
  runs this check on a typed object and **throws** before submitting.

### 5.3 Row-lock-eligible example (`balances`)

A `balances` table keyed by a natural PK (`account`), with an `update` point op and an `upsert`
point op:

```typescript
import { validateContractDefinition, type ContractDefinition } from 'necjs';

const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000abcdef';

const balances: ContractDefinition = {
  contract_name: 'balances',
  contract_address: CONTRACT_ADDRESS,
  version: '1.0.0',
  description: 'Per-account NEC balances with per-row parallel writes.',
  schema: {
    tables: [
      {
        name: 'balances',
        columns: [
          // Natural (non-serial) primary key — required for a point op.
          { name: 'account', type: 'text', constraints: ['primary key', 'not null'] },
          { name: 'balance', type: 'numeric', constraints: ['not null'] },
        ],
      },
    ],
  },
  procedures: [
    {
      name: 'setBalance',
      params: [
        { name: 'account', type: 'text' },
        { name: 'amount', type: 'numeric' },
      ],
      // Leads with UPDATE; exact-PK equality only; references every bound param.
      body: 'UPDATE balances SET balance = $amount WHERE account = $account',
      point_write: {
        table: 'balances',
        op: 'update',
        pk: [{ column: 'account', param: 'account' }],
      },
    },
    {
      name: 'upsertBalance',
      params: [
        { name: 'account', type: 'text' },
        { name: 'amount', type: 'numeric' },
      ],
      // upsert => body must begin with INSERT.
      body: 'INSERT INTO balances (account, balance) VALUES ($account, $amount) ' +
            'ON CONFLICT (account) DO UPDATE SET balance = $amount',
      point_write: {
        table: 'balances',
        op: 'upsert',
        pk: [{ column: 'account', param: 'account' }],
      },
    },
  ],
  roles: ['admin'],
  role_assignments: { admin: [CONTRACT_ADDRESS] },
};

const { eligible, errors } = validateContractDefinition(balances);
// eligible === true
// errors   === []
```

### 5.4 Contrasting NOT-eligible example (and why)

Add one mutating procedure **without** a `point_write` — a range-predicate bulk update — and the
whole contract loses eligibility, though it still deploys:

```typescript
const notEligible: ContractDefinition = {
  ...balances,
  procedures: [
    ...(balances.procedures ?? []),
    {
      name: 'zeroSmallBalances',
      params: [{ name: 'threshold', type: 'numeric' }],
      // A predicate mutator (matches many rows) with NO point_write.
      body: 'UPDATE balances SET balance = 0 WHERE balance < $threshold',
    },
  ],
};

const report = validateContractDefinition(notEligible);
// report.eligible === false   (a mutating procedure is not a point op)
// report.errors   === []      (nothing malformed — it just falls back to the classic lane)
```

A different failure mode is a **broken** `point_write` — e.g. a body that uses a range predicate
instead of PK equality:

```typescript
const broken: ContractDefinition = {
  ...balances,
  procedures: [
    {
      name: 'setBalance',
      params: [
        { name: 'account', type: 'text' },
        { name: 'amount', type: 'numeric' },
      ],
      // References $account, but the '> 0' is a non-point predicate.
      body: 'UPDATE balances SET balance = $amount WHERE account = $account AND balance > 0',
      point_write: {
        table: 'balances',
        op: 'update',
        pk: [{ column: 'account', param: 'account' }],
      },
    },
  ],
};

const brokenReport = validateContractDefinition(broken);
// brokenReport.eligible === false
// brokenReport.errors   === [
//   'procedure "setBalance" point_write body uses a non-point predicate — a point op must match exactly one row by primary-key equality'
// ]
// => createSchemaSigned(privateKey, 'balances', broken) THROWS before submitting.
```

---

## 6. Advanced: manual canonical hashing

For callers that sign an operation manually (the `*Signed` methods do this for you), the SDK exports
the exact canonical encoders the chain recomputes:

```typescript
import { canonicalDdbOperationHash, canonicalDdbRequestId } from 'necjs';

// keccak256("NEC-DDB-OP\x01" ‖ typeByte ‖ len(schemaName) ‖ len(data) ‖ from(20B) ‖ u64(ts) ‖ u64(gasLimit))
canonicalDdbOperationHash(
  typeByte: number,        // op-type tag: createschema=0, callprocedure=7, grantrole=8, revokerole=9
  schemaName: string,
  data: Uint8Array,        // the EXACT compact-JSON payload bytes
  fromAddr: string,        // 20-byte hex
  timestamp: number | bigint,
  gasLimit: number | bigint,
): Uint8Array;

// keccak256(canonicalOperationBytes ‖ requester) — the requestId the *Signed methods return.
canonicalDdbRequestId(
  typeByte: number,
  schemaName: string,
  data: Uint8Array,
  fromAddr: string,
  timestamp: number | bigint,
  gasLimit: number | bigint,
  requester: string,       // 20-byte hex
): Uint8Array;
```

Both are consensus-critical and pinned by a golden vector against the node's canonical encoding.

---

## 7. End-to-end: deploy, track, read

```typescript
import { Provider, Ddb, type ContractDefinition } from 'necjs';

const provider = new Provider('https://rpc.ncog.earth');
const ddb = new Ddb(provider);

const PRIVATE_KEY = '0x...';                                        // caller's ML-DSA-87 private key
const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000abcdef';

// 1. Deploy the schema (takes the raw CONTRACT NAME). Throws if the typed def has errors.
const deployReq = await ddb.createSchemaSigned(PRIVATE_KEY, 'balances', balances /* : ContractDefinition */);
await ddb.waitForEndorsement(deployReq);

// 2. Every later call uses the DERIVED db_name.
const dbName = Ddb.deriveDbName('balances', CONTRACT_ADDRESS);      // 'balances_abcdef'

// 3. Call a point-op procedure (args are strings).
const callReq = await ddb.callProcedureSigned(PRIVATE_KEY, dbName, 'upsertBalance', ['alice', '100']);
await ddb.waitForEndorsement(callReq);

// 4. Read back (local Postgres; no consensus).
const rows = await ddb.select(dbName, 'balances', {
  filters: [{ column: 'account', op: '=', value: 'alice' }],
  limit: 1,
});
console.log(rows); // [{ account: 'alice', balance: '100' }]
```

See the runnable examples in `examples/ddb-deploy-pointwrite.ts` and `examples/ddb-procedure.ts`.
