/**
 * Example: deploy a row-lock-eligible DDB contract with a point-op procedure.
 *
 * Demonstrates the DDB write path end-to-end:
 *   1. build a typed ContractDefinition with a `point_write` (POINT-op) procedure
 *   2. validate it client-side (validateContractDefinition) so a malformed point_write
 *      is caught BEFORE it hits the network
 *   3. deploy it with createSchemaSigned (the caller signs with their ML-DSA-87 key)
 *   4. wait for the write to be endorsed + committed
 *   5. read the applied schema back with getSchema
 *
 * Currency on NCOG Earth Chain is NEC.
 *
 * Run against a real node by replacing the placeholders below.
 */

import {
  Provider,
  Ddb,
  validateContractDefinition,
  isRowLockEligible,
  type ContractDefinition,
} from 'necjs';

// --- Placeholders — replace with real values -------------------------------
const RPC_URL = 'https://rpc.ncog.earth';
// A clearly-fake ML-DSA-87 private key placeholder. NEVER commit a real key.
const PRIVATE_KEY = '0xREPLACE_WITH_YOUR_ML_DSA_87_PRIVATE_KEY';
// The address this contract will live at (used to derive the db_name for later calls).
const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000abcdef';
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const provider = new Provider(RPC_URL);
  const ddb = new Ddb(provider);

  // 1. A row-lock-eligible contract: a `balances` table keyed by a NATURAL primary key
  //    (`account`), plus a point-op `update` procedure. Because the procedure declares a
  //    point_write, the node can derive the written row from the call args WITHOUT running
  //    the body — so writes to different accounts apply in parallel.
  const definition: ContractDefinition = {
    contract_name: 'balances',
    contract_address: CONTRACT_ADDRESS,
    version: '1.0.0',
    description: 'Per-account NEC balances with per-row parallel writes.',
    schema: {
      tables: [
        {
          name: 'balances',
          columns: [
            // Natural (non-serial) PK is required for a point op.
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
        // Point-op body rules: leads with UPDATE, references every bound PK param ($account),
        // and uses exact-PK equality only (no <, >, OR, IN, LIKE, ...).
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
        // An `upsert` point op must begin its body with INSERT.
        body:
          'INSERT INTO balances (account, balance) VALUES ($account, $amount) ' +
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

  // 2. Validate at build time. `eligible` tells you whether the contract gets per-row
  //    parallelism; `errors` lists any malformed point_write the node would reject.
  const { eligible, errors } = validateContractDefinition(definition);
  console.log('row-lock eligible:', eligible);        // true
  console.log('isRowLockEligible:', isRowLockEligible(definition)); // true (boolean shortcut)
  if (errors.length) {
    // createSchemaSigned would throw on these; bail early with a readable message.
    throw new Error(`invalid contract definition:\n  - ${errors.join('\n  - ')}`);
  }

  // 3. Deploy. createSchemaSigned takes the raw CONTRACT NAME ('balances'), signs the
  //    operation with the caller's ML-DSA-87 key, and returns the endorsement requestId
  //    (NOT a committed EVM tx hash).
  const requestId = await ddb.createSchemaSigned(PRIVATE_KEY, 'balances', definition);
  console.log('deploy requestId:', requestId);

  // 4. Wait for the write to flow through the 2f+1 quorum -> finality -> Postgres apply.
  const status = await ddb.waitForEndorsement(requestId, { timeoutMs: 90_000 });
  console.log('deploy status:', status.status);

  // 5. Read the applied schema back. Every schema-scoped read/call uses the DERIVED db_name,
  //    NOT the raw contract name.
  const dbName = Ddb.deriveDbName('balances', CONTRACT_ADDRESS); // 'balances_abcdef'
  const schema = await ddb.getSchema(dbName);
  console.log('applied schema for', dbName, ':', JSON.stringify(schema, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
