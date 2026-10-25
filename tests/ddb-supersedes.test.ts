import { Ddb } from '../src/ddb';
import {
  type ContractDefinition, type DdbProcedureDef,
  deriveSupersedes, validateSupersedes, validateContractDefinition, withSupersedes,
} from '../src/ddb-schema';

// DB-02i (NEC-189): the caller-signed "supersedes" list of a retyping upgrade. Under the node's
// ddb-signature-supersede (Upgrades3 slot 7, gated) every endorser requires the list to EQUAL the change set
// against the deployed definition (ddbschema.SupersededSignatures / CheckSupersedes) and the upgrade then DROPs
// exactly those signatures; with the flag off a node refuses an upgrade carrying a non-empty list. These tests pin
// the SDK's derivation to the node's rule (the same rows as gossip/ddb TestDB02iEndorserVerdicts) and what
// updateSchemaSigned / createSchemaSigned put in the signed op.Data.

async function deterministicKey(): Promise<{ skHex: string }> {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;
  const kp = mldsa.keygen(new Uint8Array(32).fill(11));
  return { skHex: Buffer.from(kp.secretKey).toString('hex') };
}

const ADDR = '0x00000000000000000000000000000000000000e1';
const DB = 'c_00000000000000000000000000000000000000e1';

function setV(edit?: (p: DdbProcedureDef) => void): DdbProcedureDef {
  const p: DdbProcedureDef = { name: 'set_v', params: [{ name: 'v', type: 'bigint' }], body: 'UPDATE vals SET v = $v WHERE id = 1' };
  if (edit) edit(p);
  return p;
}

function contract(version: string, procs: DdbProcedureDef[]): ContractDefinition {
  return {
    contract_name: 'vals',
    contract_address: ADDR,
    version,
    schema: { tables: [{ name: 'vals', columns: [{ name: 'id', type: 'bigint', constraints: ['primary key'] }, { name: 'v', type: 'bigint' }] }] },
    procedures: procs,
  };
}

const deployed = contract('1', [setV()]);

describe('deriveSupersedes mirrors ddbschema.SupersededSignatures', () => {
  const rows: Array<[string, ContractDefinition, Array<{ name: string; params: string[] }>]> = [
    ['a body change supersedes nothing', contract('2', [setV((p) => { p.body = 'UPDATE vals SET v = $v WHERE id = 2'; })]), []],
    ['a type change in another case supersedes nothing', contract('2', [setV((p) => { p.params[0].type = 'BIGINT'; })]), []],
    ['a retype supersedes the old signature', contract('2', [setV((p) => { p.params[0].type = 'numeric'; })]), [{ name: 'set_v', params: ['bigint'] }]],
    ['a renamed parameter supersedes it (42P13 without the DROP)', contract('2', [setV((p) => { p.params[0].name = 'w'; p.body = 'UPDATE vals SET v = $w WHERE id = 1'; })]), [{ name: 'set_v', params: ['bigint'] }]],
    ['a name-case change supersedes it', contract('2', [setV((p) => { p.name = 'Set_V'; })]), [{ name: 'set_v', params: ['bigint'] }]],
    ['an added parameter supersedes the old arity', contract('2', [setV((p) => { p.params.push({ name: 'x', type: 'text' }); })]), [{ name: 'set_v', params: ['bigint'] }]],
    ['a new overload at another arity, the old one kept, supersedes nothing',
      contract('2', [setV(), setV((p) => { p.params.push({ name: 'x', type: 'text' }); })]), []],
  ];
  it.each(rows)('%s', (_name, next, want) => {
    expect(deriveSupersedes(deployed, next)).toEqual(want);
  });

  it('lists every stored declaration at a superseded (name, arity), each once, in stored order', () => {
    // Two declarations at one arity exist only on a contract deployed before the duplicate-overload refusal.
    const old = contract('1', [setV(), setV((p) => { p.params[0].type = 'text'; }), setV()]);
    const next = contract('2', [setV((p) => { p.params[0].type = 'numeric'; })]);
    expect(deriveSupersedes(old, next)).toEqual([{ name: 'set_v', params: ['bigint'] }, { name: 'set_v', params: ['text'] }]);
    // Keeping ONE of them unchanged supersedes nothing at that arity (the node leaves the other one live).
    expect(deriveSupersedes(old, contract('2', [setV((p) => { p.params[0].type = 'text'; })]))).toEqual([]);
  });

  it('tolerates definitions without procedures', () => {
    expect(deriveSupersedes(contract('1', []), contract('2', []))).toEqual([]);
    expect(deriveSupersedes({ ...deployed, procedures: undefined }, contract('2', [setV()]))).toEqual([]);
  });
});

describe('validateSupersedes (the node parses the list strictly: ddbschema.ParseSupersedes)', () => {
  it('accepts absent, null, [] and well-formed entries', () => {
    expect(validateSupersedes(undefined)).toEqual([]);
    expect(validateSupersedes(null)).toEqual([]);
    expect(validateSupersedes([])).toEqual([]);
    expect(validateSupersedes([{ name: 'set_v', params: ['bigint'] }, { name: 'noargs', params: [] }])).toEqual([]);
  });
  it.each([
    ['not an array', 'set_v(bigint)', /must be an array/],
    ['an entry that is not an object', ['set_v'], /entry 1/],
    ['an unknown key', [{ name: 'set_v', params: ['bigint'], cascade: true }], /unknown key "cascade"/],
    ['a missing params', [{ name: 'set_v' }], /"params" is required/],
    ['a non-string type', [{ name: 'set_v', params: [1] }], /params/],
    ['an invalid identifier', [{ name: 'x; DROP', params: [] }], /invalid procedure identifier/],
    ['a signature listed twice (types compared without case)', [{ name: 'set_v', params: ['bigint'] }, { name: 'set_v', params: ['BIGINT'] }], /twice/],
  ])('refuses %s', (_name, list, re) => {
    const errs = validateSupersedes(list as any);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join('\n')).toMatch(re);
  });
  it('validateContractDefinition reports a malformed list', () => {
    const d: any = { ...contract('2', [setV()]), supersedes: [{ name: 'set_v' }] };
    expect(validateContractDefinition(d).errors.join('\n')).toMatch(/supersedes entry 1/);
  });
});

describe('withSupersedes', () => {
  const retyped = contract('2', [setV((p) => { p.params[0].type = 'numeric'; })]);
  it('derives the list from the deployed definition', () => {
    expect(withSupersedes(retyped, { deployed }).supersedes).toEqual([{ name: 'set_v', params: ['bigint'] }]);
  });
  it('leaves the key ABSENT when nothing is superseded (byte-identical to an earlier SDK, valid with the flag off)', () => {
    const body = contract('2', [setV((p) => { p.body = 'UPDATE vals SET v = 0 WHERE id = $v'; })]);
    expect('supersedes' in withSupersedes(body, { deployed })).toBe(false);
    expect('supersedes' in withSupersedes(body, { supersedes: [] })).toBe(false);
  });
  it('takes an explicit list, and refuses one that does not match the deployed definition', () => {
    const list = [{ name: 'set_v', params: ['bigint'] }];
    expect(withSupersedes(retyped, { supersedes: list }).supersedes).toEqual(list);
    expect(withSupersedes(retyped, { supersedes: list, deployed }).supersedes).toEqual(list);
    expect(() => withSupersedes(retyped, { supersedes: [], deployed })).toThrow(/does not match/);
    expect(() => withSupersedes(retyped, { supersedes: [{ name: 'set_v', params: ['numeric'] }], deployed })).toThrow(/does not match/);
  });
  it('refuses a definition that already carries a list when an option is given, and a malformed list', () => {
    expect(() => withSupersedes({ ...retyped, supersedes: [{ name: 'set_v', params: ['bigint'] }] }, { deployed })).toThrow(/already carries/);
    expect(() => withSupersedes(retyped, { supersedes: [{ name: 'set_v' } as any] })).toThrow(/"params" is required/);
  });
  it('never mutates its inputs', () => {
    const copy = JSON.parse(JSON.stringify(retyped));
    withSupersedes(retyped, { deployed });
    expect(retyped).toEqual(copy);
  });
});

describe('the signed op.Data', () => {
  function capture(): { ddb: Ddb; sent: any[] } {
    const sent: any[] = [];
    const provider: any = { send: (m: string, params: any[]) => { if (m !== 'nec_rules') sent.push(params[0]); return Promise.resolve('0x'); } };
    return { ddb: new Ddb(provider), sent };
  }
  const payload = (op: any) => JSON.parse(Buffer.from(op.data.slice(2), 'hex').toString('utf8'));
  const retyped = contract('2', [setV((p) => { p.params[0].type = 'numeric'; })]);

  it('updateSchemaSigned with { deployed } carries the derived list inside the signed definition', async () => {
    const { skHex } = await deterministicKey();
    const { ddb, sent } = capture();
    await ddb.updateSchemaSigned(skHex, DB, retyped, { deployed, timestamp: 1000, nonce: 7 });
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('updateschema');
    expect(payload(sent[0])).toEqual({ ...retyped, supersedes: [{ name: 'set_v', params: ['bigint'] }] });
  });

  it('updateSchemaSigned takes an explicit list for a JSON-string definition too', async () => {
    const { skHex } = await deterministicKey();
    const { ddb, sent } = capture();
    await ddb.updateSchemaSigned(skHex, DB, JSON.stringify(retyped), { supersedes: [{ name: 'set_v', params: ['bigint'] }], timestamp: 1000, nonce: 7 });
    expect(payload(sent[0]).supersedes).toEqual([{ name: 'set_v', params: ['bigint'] }]);
  });

  it('without the options the payload is exactly what an earlier SDK signs (no key)', async () => {
    const { skHex } = await deterministicKey();
    const { ddb, sent } = capture();
    await ddb.updateSchemaSigned(skHex, DB, retyped, { timestamp: 1000, nonce: 7 });
    expect(payload(sent[0])).toEqual(retyped);
    expect('supersedes' in payload(sent[0])).toBe(false);
  });

  it('a mismatched explicit list throws synchronously, before any node call', async () => {
    const { skHex } = await deterministicKey();
    const { ddb, sent } = capture();
    expect(() => ddb.updateSchemaSigned(skHex, DB, retyped, { supersedes: [], deployed })).toThrow(/does not match/);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
  });

  it('createSchemaSigned refuses a definition carrying a non-empty list (a deploy supersedes nothing)', async () => {
    const { skHex } = await deterministicKey();
    const { ddb, sent } = capture();
    const d = { ...contract('1', [setV()]), supersedes: [{ name: 'set_v', params: ['bigint'] }] };
    expect(() => ddb.createSchemaSigned(skHex, 'vals', d)).toThrow(/a deploy supersedes nothing/);
    expect(() => ddb.createSchemaSigned(skHex, 'vals', JSON.stringify(d))).toThrow(/a deploy supersedes nothing/);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(0);
  });
});
