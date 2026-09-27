/**
 * NEC-144 against a LIVE node (opt-in): a contract deployed through the SDK whose JSON carries '>', '<'
 * and '&' -- a procedure body with a comparison -- is endorsed, committed and applied, and its procedures run.
 *
 * JSON.stringify leaves those characters raw, and the SDK signs (and hashes into the requestId) exactly
 * the bytes it sends. Go's encoding/json escapes them as \u003e etc., and a node that re-encoded the
 * operation that way for its peers made every peer re-derive a different RequestID and drop the request
 * ("RequestID is not bound to its operation"), so the deploy timed out. The fix is node-side (the
 * operation is carried to peers byte-for-byte); the SDK is unchanged and this test is the end-to-end proof.
 *
 * Skipped unless NEC_LIVE_RPC names a node RPC. The signed case uses a key generated here (unfunded, so
 * its commit is skipped for gas AFTER the proof verifies); the funded case needs the node to server-sign
 * for NEC_LIVE_AUTHOR, which the docker-free testbed does (ncogearthchain scripts/run-local-testbed.sh up).
 *
 *   NEC_LIVE_RPC=http://127.0.0.1:18645 npx jest tests/ddb-json-escape.live.test.ts
 */
import { Ddb, privateKeyDdbSigner } from '../src/ddb';
import { Provider } from '../src/provider';

const RPC = process.env.NEC_LIVE_RPC;
const live = RPC ? describe : describe.skip;

async function freshKey(): Promise<string> {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const m = (noblePQ.default || noblePQ).ml_dsa87;
  const seed = new Uint8Array(32);
  require('crypto').randomFillSync(seed);
  return Buffer.from(m.keygen(seed).secretKey).toString('hex');
}

const AUTHOR = process.env.NEC_LIVE_AUTHOR || '0xcDa334F5E7b18EDf312F3C6CFbd7b6c5Df6F637F';

function contractDef(addr: string, author: string, name: string) {
  return {
    contract_address: addr, contract_name: name, author, version: '1',
    description: 'n > 0 && m < 9',
    schema: { tables: [{ name: 't', columns: [
      { name: 'id', type: 'bigint', constraints: ['primary key'] },
      { name: 'n', type: 'bigint', constraints: [] }], indexes: [] }] },
    procedures: [
      { name: 'insertRow', body: 'INSERT INTO t (id, n) VALUES (1, 5)' },
      { name: 'bumpPositive', body: 'UPDATE t SET n = n + 1 WHERE n > 0 AND id < 100 AND n <> 0' },
    ],
    roles: [], role_assignments: {}, procedure_access: [], metadata: {},
  };
}

function freshAddr(base: number): string {
  return '0x' + (base + (Date.now() % 1000000)).toString(16).padStart(40, '0');
}

live('NEC-144 live: a deploy whose JSON carries > < &', () => {
  jest.setTimeout(240_000);

  // The SIGNED path, from a key generated here. The SDK hashes and signs the raw bytes, so this is the
  // exact request that used to die at the first peer. The key holds no NEC, so the commit is expected to
  // be skipped for unpayable_gas -- a check block validity runs only AFTER VerifyCommitProof has
  // recomputed the operation hash over the commit tx's decoded Data. Reaching it proves the endorsement
  // round AND the commit-tx encoding both carried the bytes intact.
  it('signed: is endorsed by the peer and its commit proof verifies at block validity', async () => {
    const p = new Provider(RPC as string);
    const ddb = new Ddb(p);
    const key = await freshKey();
    const author = await privateKeyDdbSigner(key).getAddress();
    const def = contractDef(freshAddr(0xe5c00000), author, 'jsescsig');
    const raw = JSON.stringify(def);
    expect(raw).toContain(' > 0'); // the bytes signed really carry the raw characters
    expect(raw).toContain('&&');

    const deploy = await ddb.submitOperationSigned(key, 'createschema', 'jsescsig', def);
    expect(deploy.commitTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    let st: any;
    for (let i = 0; i < 60; i++) {
      st = await ddb.getCommitStatus(deploy.commitTxHash);
      if (st && (st.status === 'applied' || st.status === 'skipped')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    // eslint-disable-next-line no-console
    console.log(`NEC-144 live signed: requestId ${deploy.requestId} commit ${deploy.commitTxHash} status ${JSON.stringify(st)}`);
    if (st.status === 'skipped') expect(st.reason).toBe('unpayable_gas');
    else expect(st.status).toBe('applied');
  });

  // The FUNDED author (the testbed's validator 1, server-signed: NEC_DDB_ALLOW_LOCAL_SIGN=1). The SDK
  // sends JSON.stringify(def), whose '>' the node keeps raw in Data (json.Compact never escapes), so this
  // path had the same defect. Here the write lands and the comparison procedures run.
  it('funded: is endorsed, applied durably, and its comparison procedures run', async () => {
    const p = new Provider(RPC as string);
    const ddb = new Ddb(p);
    const addr = freshAddr(0xe5d00000);
    const def = contractDef(addr, AUTHOR, 'jsescfund');
    const waitDurable = (tx: string) => ddb.waitForCommit(tx, { requireDurable: true, timeoutMs: 90_000 });

    const deploy = await ddb.createSchema(AUTHOR, 'jsescfund', JSON.stringify(def));
    await waitDurable(deploy);
    const db = 'c_' + addr.slice(2).toLowerCase(); // ddbschema.DeriveDbName
    const ins = await ddb.callProcedure(AUTHOR, db, 'insertRow', []);
    await waitDurable(ins);
    const bump = await ddb.callProcedure(AUTHOR, db, 'bumpPositive', []);
    await waitDurable(bump);

    const rows = await ddb.select(db, 't');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].n)).toBe('6');
    // eslint-disable-next-line no-console
    console.log(`NEC-144 live funded: deploy ${deploy} insert ${ins} bump ${bump} rows ${JSON.stringify(rows)}`);
  });
});
