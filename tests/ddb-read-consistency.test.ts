// DB-03 (NEC-79) read consistency in the SDK: the write outcome reports `committed` at durable (DECIDE-04)
// with finality as a separate signal and hands back the read token; the read methods pass the token
// through to the node unchanged, and an old call that passes none sends exactly what it always did.
// No live node -- provider.send is mocked.
import { Ddb, DDB_READ_DEADLINE_CODE, DDB_READ_UNAVAILABLE_CODE } from '../src/ddb';

function mock(responses: Record<string, any[]>) {
  const sent: { method: string; params: any[] }[] = [];
  const provider: any = {
    send: (method: string, params: any[]) => {
      sent.push({ method, params });
      const q = responses[method];
      return Promise.resolve(q && q.length > 1 ? q.shift() : q?.[0]);
    },
  };
  return { ddb: new Ddb(provider), sent };
}

describe('DB-03 write outcome and read token', () => {
  it('waitForCommitted resolves only at durable, with finality and the read token separate', async () => {
    const { ddb, sent } = mock({
      ddb_getCommitStatus: [
        { txHash: '0x01', status: 'unknown' },
        { txHash: '0x01', status: 'applied', blockNumber: '0xa', readToken: '0xa', durable: false },
        { txHash: '0x01', status: 'applied', blockNumber: '0xa', readToken: '0xa', durable: true, durableBlockNumber: '0xa' },
      ],
    });
    const out = await ddb.waitForCommitted('0x01', { intervalMs: 1, timeoutMs: 5000 });
    expect(sent.filter((s) => s.method === 'ddb_getCommitStatus')).toHaveLength(3);
    expect(out.committed).toBe(true);
    expect(out.readToken).toBe('0xa');
    expect(out.finality).toEqual({ finalized: true, blockNumber: '0xa' });
  });

  it('waitForCommitted refuses a skipped write and never reports it committed', async () => {
    const { ddb } = mock({ ddb_getCommitStatus: [{ txHash: '0x02', status: 'skipped', reason: 'replay' }] });
    await expect(ddb.waitForCommitted('0x02', { intervalMs: 1, timeoutMs: 100 })).rejects.toThrow(/SKIPPED/);
  });

  it('select / signedSelect-shaped options carry minVersion and waitMs to the node unchanged', async () => {
    const { ddb, sent } = mock({ ddb_select: [[{ id: 1 }]], ddb_selectVersioned: [{ rows: [{ id: 1 }], dataVersion: '0xb' }] });
    await ddb.select('s', 't', { limit: 5, minVersion: '0xa', waitMs: 2000 });
    expect(sent[0]).toEqual({ method: 'ddb_select', params: ['s', 't', { limit: 5, minVersion: '0xa', waitMs: 2000 }] });
    const v = await ddb.selectVersioned('s', 't', { minVersion: '0xa' });
    expect(sent[1]).toEqual({ method: 'ddb_selectVersioned', params: ['s', 't', { minVersion: '0xa' }] });
    expect(v.dataVersion).toBe('0xb');
  });

  it('callReadProcedure sends the token as a fourth parameter only when given', async () => {
    const { ddb, sent } = mock({ ddb_callReadProcedure: [[]] });
    await ddb.callReadProcedure('s', 'p', ['1']);
    await ddb.callReadProcedure('s', 'p', ['1'], { minVersion: '0xa', waitMs: 100 });
    expect(sent[0].params).toEqual(['s', 'p', ['1']]);
    expect(sent[1].params).toEqual(['s', 'p', ['1'], { minVersion: '0xa', waitMs: 100 }]);
  });

  it('exports the node refusal codes', () => {
    expect(DDB_READ_DEADLINE_CODE).toBe(-32061);
    expect(DDB_READ_UNAVAILABLE_CODE).toBe(-32062);
  });
});
