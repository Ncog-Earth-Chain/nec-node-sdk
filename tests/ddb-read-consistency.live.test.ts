/**
 * DB-03 (NEC-79) against a LIVE 2-node testbed (opt-in): write through ingress A, read through ingress B
 * with the token A returned -> the read sees the write, or fails with the explicit deadline code. Never
 * B's older rows as success. Also measures what a token-less read on B sees right after the commit.
 *
 * Skipped unless NEC_LIVE_RPC (ingress A) and NEC_LIVE_RPC_B (ingress B) are set. The funded author is the
 * testbed's validator 1, server-signed (ncogearthchain scripts/run-local-testbed.sh up).
 *
 *   NEC_LIVE_RPC=http://127.0.0.1:19845 NEC_LIVE_RPC_B=http://127.0.0.1:19846 npx jest tests/ddb-read-consistency.live.test.ts
 */
import { Ddb, DDB_READ_DEADLINE_CODE } from '../src/ddb';
import { Provider } from '../src/provider';

const RPC_A = process.env.NEC_LIVE_RPC;
const RPC_B = process.env.NEC_LIVE_RPC_B;
const live = RPC_A && RPC_B ? describe : describe.skip;
const AUTHOR = process.env.NEC_LIVE_AUTHOR || '0xcDa334F5E7b18EDf312F3C6CFbd7b6c5Df6F637F';
const TRIALS = Number(process.env.DB03_TRIALS || 5);

function contractDef(addr: string) {
  const procedures = [];
  for (let i = 1; i <= TRIALS; i++) procedures.push({ name: `ins${i}`, body: `INSERT INTO t (id, n) VALUES (${i}, ${i})` });
  return {
    contract_address: addr, contract_name: 'db03rc', author: AUTHOR, version: '1', description: 'DB-03 live',
    schema: { tables: [{ name: 't', columns: [
      { name: 'id', type: 'bigint', constraints: ['primary key'] },
      { name: 'n', type: 'bigint', constraints: [] }], indexes: [] }] },
    procedures, roles: [], role_assignments: {}, procedure_access: [], metadata: {},
  };
}

live('DB-03 live: two-ingress read-your-write', () => {
  jest.setTimeout(600_000);

  it('a read via B with A\'s token sees the write or fails with the deadline code', async () => {
    const a = new Ddb(new Provider(RPC_A as string));
    const b = new Ddb(new Provider(RPC_B as string));
    const addr = '0x' + (0xdb030000 + (Date.now() % 1000000)).toString(16).padStart(40, '0');
    const db = 'c_' + addr.slice(2).toLowerCase();

    const deploy = await a.createSchema(AUTHOR, 'db03rc', JSON.stringify(contractDef(addr)));
    const dep = await a.waitForCommitted(deploy, { timeoutMs: 120_000, intervalMs: 200 });
    // the deploy must be on B before anonymous reads of the table can be authorized there
    await b.select(db, 't', { minVersion: dep.readToken, waitMs: 30_000 });

    const lines: string[] = [];
    let staleWithoutToken = 0;
    for (let i = 1; i <= TRIALS; i++) {
      const tx = await a.callProcedure(AUTHOR, db, `ins${i}`, []);
      const out = await a.waitForCommitted(tx, { timeoutMs: 120_000, intervalMs: 50 });
      expect(out.committed).toBe(true);
      expect(out.finality.finalized).toBe(true);

      // B with NO token, immediately: today's behaviour, may be stale -- measured, not asserted.
      const t0 = Date.now();
      const plain = await b.select(db, 't', {});
      const plainSaw = plain.some((r: any) => String(r.id) === String(i));
      if (!plainSaw) staleWithoutToken++;

      // B WITH the token: must see the write (or refuse with the deadline code -- then the test fails loudly).
      const t1 = Date.now();
      const v = await b.selectVersioned(db, 't', { minVersion: out.readToken, waitMs: 10_000 });
      const ms = Date.now() - t1;
      expect(v.rows.some((r: any) => String(r.id) === String(i))).toBe(true);
      expect(Number(v.dataVersion)).toBeGreaterThanOrEqual(Number(out.readToken));
      lines.push(`trial ${i}: commit ${tx} token ${out.readToken} | B no-token saw=${plainSaw} (${t1 - t0}ms) | B token saw=true dataVersion=${v.dataVersion} in ${ms}ms`);
    }

    // A token B cannot reach within waitMs: explicit refusal with the deadline code, never rows.
    const far = '0x' + (Number(await (new Provider(RPC_B as string)).send('eth_blockNumber', [])) + 100000).toString(16);
    const t2 = Date.now();
    let code: unknown;
    let rows: unknown;
    try {
      rows = await b.select(db, 't', { minVersion: far, waitMs: 500 });
    } catch (e: any) {
      code = e.code;
      lines.push(`deadline: minVersion ${far} refused after ${Date.now() - t2}ms: code ${e.code} "${e.message}"`);
    }
    expect(rows).toBeUndefined();
    expect(code).toBe(DDB_READ_DEADLINE_CODE);

    // eslint-disable-next-line no-console
    console.log(`DB-03 live (${TRIALS} trials, B stale without token ${staleWithoutToken}/${TRIALS}):\n` + lines.join('\n'));
  });
});
