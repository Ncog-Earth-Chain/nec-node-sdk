// Live smoke test for the necjs Ddb client against a running ddb-enabled node.
//   RPC=http://127.0.0.1:18545 npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/ddb-smoke.ts
import { Provider } from '../src/provider';
import { Ddb } from '../src/ddb';

async function main() {
  const url = process.env.RPC || 'http://127.0.0.1:18545';
  const provider = new Provider(url);
  const ddb = new Ddb(provider);

  console.log('== ddb.getValidators() ==');
  const vals = await ddb.getValidators();
  console.log(JSON.stringify(vals, null, 2).slice(0, 500));

  console.log('\n== ddb.getStats() ==');
  const stats = await ddb.getStats();
  console.log(JSON.stringify(stats, null, 2).slice(0, 500));

  console.log('\n== ddb.getConsensusStats() ==');
  const cs = await ddb.getConsensusStats();
  console.log(JSON.stringify(cs, null, 2).slice(0, 400));

  // Optional: if a schema name is passed, read it + select rows.
  const schema = process.env.DDB_SCHEMA;
  const table = process.env.DDB_TABLE;
  if (schema) {
    console.log(`\n== ddb.getSchema(${schema}) ==`);
    console.log(JSON.stringify(await ddb.getSchema(schema), null, 2).slice(0, 600));
    if (table) {
      console.log(`\n== ddb.select(${schema}, ${table}, {limit:5}) ==`);
      console.log(JSON.stringify(await ddb.select(schema, table, { limit: 5 }), null, 2).slice(0, 600));
    }
  }
  console.log('\nSMOKE OK');
}
main().catch((e) => { console.error('SMOKE FAIL:', e?.message || e); process.exit(1); });
