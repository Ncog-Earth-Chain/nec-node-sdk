/**
 * REL-02 against a LIVE node (opt-in): the SDK's own Ddb.signedSelect reads a reader-role contract's
 * rows as an account holding the role, and the node refuses the same read from an account that does not,
 * and refuses an anonymous select.
 *
 * Skipped unless NEC_LIVE_RPC names a node RPC. The node must server-sign for NEC_LIVE_AUTHOR (the
 * docker-free testbed does: ncogearthchain scripts/run-local-testbed.sh up), which is only used to DEPLOY
 * the contract and insert its row -- the reads under test are signed here, by keys generated fresh.
 *
 *   NEC_LIVE_RPC=http://127.0.0.1:18645 npx jest tests/ddb-signed-read.live.test.ts
 */
import { Ddb, privateKeyDdbSigner } from '../src/ddb';
import { Provider } from '../src/provider';

const RPC = process.env.NEC_LIVE_RPC;
const AUTHOR = process.env.NEC_LIVE_AUTHOR || '0xcDa334F5E7b18EDf312F3C6CFbd7b6c5Df6F637F';
const live = RPC ? describe : describe.skip;

async function freshKey(): Promise<string> {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const m = (noblePQ.default || noblePQ).ml_dsa87;
  const seed = new Uint8Array(32);
  require('crypto').randomFillSync(seed);
  return Buffer.from(m.keygen(seed).secretKey).toString('hex');
}

async function waitDurable(p: Provider, commitTx: string) {
  for (let i = 0; i < 60; i++) {
    const st = await p.send('ddb_getCommitStatus', [commitTx]);
    if (st && st.status === 'applied' && st.durable === true) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`commit ${commitTx} was not applied durably within 60 s`);
}

live('REL-02 live: a reader-role contract through the SDK', () => {
  jest.setTimeout(180_000);

  it('serves the reader, refuses the non-reader and the anonymous caller', async () => {
    const p = new Provider(RPC as string);
    const ddb = new Ddb(p);
    const readerKey = await freshKey();
    const outsiderKey = await freshKey();
    const reader = await privateKeyDdbSigner(readerKey).getAddress();

    const addr = '0x' + (0xac000000 + (Date.now() % 1000000)).toString(16).padStart(40, '0');
    const def = {
      contract_address: addr, contract_name: 'rel02sdk', author: AUTHOR, version: '1',
      schema: { tables: [{ name: 't', columns: [
        { name: 'id', type: 'bigint', constraints: ['primary key'] },
        { name: 'v', type: 'text', constraints: [] }], indexes: [] }] },
      procedures: [{ name: 'insertRow', body: "INSERT INTO t (id, v) VALUES (1, 'sdk-reader')" }],
      roles: ['reader'], role_assignments: { reader: [reader] }, procedure_access: [], metadata: {},
    };
    await waitDurable(p, await p.send('ddb_createSchema', [AUTHOR, 'rel02sdk', JSON.stringify(def)]));
    const db = 'c_' + addr.slice(2).toLowerCase(); // ddbschema.DeriveDbName
    await waitDurable(p, await p.send('ddb_callProcedure', [AUTHOR, db, 'insertRow', []]));

    const rows = await ddb.signedSelect(readerKey, db, 't');
    expect(rows).toHaveLength(1);
    expect(rows[0].v).toBe('sdk-reader');

    await expect(ddb.signedSelect(outsiderKey, db, 't')).rejects.toThrow(/holds no role covering "reader"/);
    await expect(p.send('ddb_select', [db, 't', {}])).rejects.toThrow(/not world-readable/);
  });
});
