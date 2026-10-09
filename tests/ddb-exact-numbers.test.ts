// DB-02 (NEC-78), owner ruling 17: exact int8 reads are OPT-IN. With `exactNumbers` the SDK asks the node for
// the {columns, rows} form (int8 as decimal strings) and returns `bigint` for exactly the int8 columns; without
// it every call sends and returns what it always did. The node half is pinned in ncogearthchain
// (gossip/ddb/exact_numbers_pg_test.go on real Postgres, ethapi/ddb_exact_numbers_test.go on every read RPC);
// the wire bodies below are the node's own exact-mode bytes from those tests. No live node -- provider.send is
// mocked, and every response goes through JSON.parse exactly as the HTTP transport's does.
//
// MUTANT (red here): drop the flag on the SDK path (select sends opts without exactNumbers, or ddbExactRows
// leaves int8 strings alone) -> the bigint cases fail.
import { Ddb, ddbExactRows, DDB_EXACT_NUMBERS_UNSUPPORTED } from '../src/ddb';

// BigInt(...) rather than 123n literals: the SDK targets below ES2020.
const TWO53_PLUS_1 = BigInt('9007199254740993');
const INT64_MIN = BigInt('-9223372036854775808');
const INT64_MAX = BigInt('9223372036854775807');

// What the node sends for `SELECT * FROM nums ORDER BY id` with and without exactNumbers.
const DEFAULT_WIRE =
  '[{"amt":"123456789012345678901234567890.5","big":9007199254740993,"id":1,"label":"9007199254740993","small":7},' +
  '{"amt":"-0.000001","big":-9223372036854775808,"id":2,"label":"min","small":-1},' +
  '{"amt":"18446744073709551616","big":9223372036854775807,"id":3,"label":"max","small":0},' +
  '{"amt":null,"big":null,"id":4,"label":null,"small":null}]';
const EXACT_WIRE =
  '{"columns":[{"name":"id","type":"int8"},{"name":"big","type":"int8"},{"name":"small","type":"int4"},' +
  '{"name":"amt","type":"numeric"},{"name":"label","type":"text"}],"rows":' +
  '[{"amt":"123456789012345678901234567890.5","big":"9007199254740993","id":"1","label":"9007199254740993","small":7},' +
  '{"amt":"-0.000001","big":"-9223372036854775808","id":"2","label":"min","small":-1},' +
  '{"amt":"18446744073709551616","big":"9223372036854775807","id":"3","label":"max","small":0},' +
  '{"amt":null,"big":null,"id":"4","label":null,"small":null}]}';

function mock(responses: Record<string, string>) {
  const sent: { method: string; params: any[] }[] = [];
  const provider: any = {
    send: (method: string, params: any[]) => {
      sent.push({ method, params });
      return Promise.resolve(JSON.parse(responses[method]));
    },
  };
  return { ddb: new Ddb(provider), sent };
}

describe('DB-02 exactNumbers (opt-in exact int8)', () => {
  it('why: a plain read of an int8 beyond 2^53 is a rounded number', async () => {
    const { ddb, sent } = mock({ ddb_select: DEFAULT_WIRE });
    const rows = await ddb.select('c_num', 'nums', { limit: 10 });
    expect(sent[0].params).toEqual(['c_num', 'nums', { limit: 10 }]); // no flag on the wire
    expect(rows[0].big).toBe(9007199254740992); // 2^53 + 1 rounded
    expect(String(rows[0].big)).not.toBe(TWO53_PLUS_1.toString());
    expect(typeof rows[0].id).toBe('number');
  });

  it('select with exactNumbers returns bigint for 2^53+1, -2^63, 2^63-1, and keeps NULL, numeric and text', async () => {
    const { ddb, sent } = mock({ ddb_select: EXACT_WIRE });
    const rows = await ddb.select('c_num', 'nums', { exactNumbers: true });
    expect(sent[0].params).toEqual(['c_num', 'nums', { exactNumbers: true }]);
    expect(rows.map((r) => r.big)).toEqual([TWO53_PLUS_1, INT64_MIN, INT64_MAX, null]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4].map(BigInt));
    expect(rows[0].amt).toBe('123456789012345678901234567890.5'); // numeric: its decimal string, as always
    expect(rows[0].label).toBe('9007199254740993'); // a TEXT column holding digits stays a string
    expect(rows[0].small).toBe(7); // int4 is exact as a number and stays one
    expect(rows[3].amt).toBeNull();
  });

  it('query and callReadProcedure send the flag as a trailing parameter only when asked', async () => {
    const { ddb, sent } = mock({ ddb_query: EXACT_WIRE, ddb_callReadProcedure: EXACT_WIRE });
    const q = await ddb.query('c_num', 'nums', 10, undefined, { exactNumbers: true });
    expect(sent[0].params).toEqual(['c_num', 'nums', 10, null, { exactNumbers: true }]);
    expect(q[2].big).toBe(INT64_MAX);
    const p = await ddb.callReadProcedure('c_num', 'stats', ['1'], { minVersion: 6 }, { exactNumbers: true });
    expect(sent[1].params).toEqual(['c_num', 'stats', ['1'], { minVersion: '0x6' }, { exactNumbers: true }]);
    expect(p[1].big).toBe(INT64_MIN);
  });

  it('the default path sends exactly what it always did', async () => {
    const { ddb, sent } = mock({ ddb_query: DEFAULT_WIRE, ddb_callReadProcedure: DEFAULT_WIRE, ddb_select: DEFAULT_WIRE });
    await ddb.query('s', 't');
    await ddb.query('s', 't', 10, undefined, { exactNumbers: false });
    await ddb.callReadProcedure('s', 'p', ['1']);
    await ddb.select('s', 't');
    expect(sent.map((s) => s.params)).toEqual([['s', 't', 100], ['s', 't', 10], ['s', 'p', ['1']], ['s', 't', {}]]);
  });

  it('selectVersioned keeps its object and gains the columns', async () => {
    const exact = JSON.parse(EXACT_WIRE);
    const { ddb } = mock({ ddb_selectVersioned: JSON.stringify({ rows: exact.rows, dataVersion: '0x64', columns: exact.columns }) });
    const v = await ddb.selectVersioned('c_num', 'nums', { exactNumbers: true });
    expect(v.dataVersion).toBe('0x64');
    expect(v.rows[1].big).toBe(INT64_MIN);
    expect(v.columns?.find((c) => c.name === 'big')?.type).toBe('int8');
  });

  it('a node that ignored the flag is refused, never returned as exact', async () => {
    const { ddb } = mock({ ddb_select: DEFAULT_WIRE, ddb_selectVersioned: '{"rows":[{"big":1}],"dataVersion":"0x1"}' });
    await expect(ddb.select('c_num', 'nums', { exactNumbers: true })).rejects.toMatchObject({ code: DDB_EXACT_NUMBERS_UNSUPPORTED });
    await expect(ddb.selectVersioned('c_num', 'nums', { exactNumbers: true })).rejects.toMatchObject({ code: DDB_EXACT_NUMBERS_UNSUPPORTED });
  });

  it('ddbExactRows refuses an int8 value that is not a decimal string', () => {
    expect(() => ddbExactRows('ddb_select', { columns: [{ name: 'n', type: 'int8' }], rows: [{ n: 9007199254740992 }] }))
      .toThrow(/not a decimal string/);
    expect(() => ddbExactRows('ddb_select', { columns: [{ name: 'n', type: 'int8' }], rows: [{ n: '1e3' }] }))
      .toThrow(/not a decimal string/);
  });
});
