/**
 * Example: call a DDB stored procedure and read the resulting rows.
 *
 * Assumes the `balances` contract from `ddb-deploy-pointwrite.ts` is already deployed.
 * Demonstrates:
 *   1. deriving the db_name for an already-deployed contract (Ddb.deriveDbName)
 *   2. invoking a point-op procedure with callProcedureSigned (client-signed)
 *   3. waiting for the write to commit
 *   4. reading the resulting rows with select (filtered) and query (simple fetch)
 *
 * Currency on NCOG Earth Chain is NEC.
 */

import { Provider, Ddb, type DdbRow } from 'necjs';

// --- Placeholders — replace with real values -------------------------------
const RPC_URL = 'https://rpc.ncog.earth';
// A clearly-fake ML-DSA-87 private key placeholder. NEVER commit a real key.
const PRIVATE_KEY = '0xREPLACE_WITH_YOUR_ML_DSA_87_PRIVATE_KEY';
// The address the `balances` contract was deployed at.
const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000abcdef';
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const provider = new Provider(RPC_URL);
  const ddb = new Ddb(provider);

  // 1. Every schema-scoped call takes the DERIVED db_name, not the raw contract name.
  const dbName = Ddb.deriveDbName(CONTRACT_ADDRESS); // 'c_' + the 40-hex address

  // 2. Call the point-op procedure. Procedure args are always STRINGS. callProcedureSigned
  //    signs with the caller's ML-DSA-87 key and returns the endorsement requestId.
  const requestId = await ddb.callProcedureSigned(
    PRIVATE_KEY,
    dbName,
    'upsertBalance',
    ['alice', '100'], // account, amount
  );
  console.log('call requestId:', requestId);

  // 3. Wait for the mutation to be endorsed + committed + applied to Postgres.
  const status = await ddb.waitForEndorsement(requestId);
  console.log('call status:', status.status);

  // 4a. Read back with a filter (reads hit this node's local Postgres — no consensus, ~ms).
  const filtered: DdbRow[] = await ddb.select(dbName, 'balances', {
    filters: [{ column: 'account', op: '=', value: 'alice' }],
    orderBy: 'account',
    orderDir: 'asc',
    limit: 10,
  });
  console.log('alice row:', filtered);

  // 4b. Or a simple unfiltered fetch of up to `limit` rows.
  const firstRows: DdbRow[] = await ddb.query(dbName, 'balances', 50);
  console.log('first 50 rows:', firstRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
