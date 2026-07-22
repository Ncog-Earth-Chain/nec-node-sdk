import {
  ContractDefinition, DdbTableDef, DdbProcedureDef,
  isRowLockEligible, validateContractDefinition, validatePointWrite, tablePKColumns, isMutatingBody,
} from '../src/ddb-schema';

// Mirrors the chain's ddbschema point_write / eligibility validation (ValidatePointWrite,
// ContractRowLockEligible). The node re-checks authoritatively at endorsement; these give build-time parity.

const usersTable: DdbTableDef = {
  name: 'users',
  columns: [
    { name: 'id', type: 'bigint', constraints: ['primary key'] },
    { name: 'email', type: 'text' },
  ],
};
const tables = new Map<string, DdbTableDef>([['users', usersTable]]);

const pointProc: DdbProcedureDef = {
  name: 'updateEmail',
  params: [{ name: 'user_id', type: 'bigint' }, { name: 'email', type: 'text' }],
  body: 'UPDATE users SET email = $email WHERE id = $user_id',
  point_write: { table: 'users', op: 'update', pk: [{ column: 'id', param: 'user_id' }] },
};

describe('DDB point-op validation + row-lock eligibility', () => {
  it('tablePKColumns returns the PK columns in declared order', () => {
    expect(tablePKColumns(usersTable)).toEqual(['id']);
  });

  it('accepts a valid exact-PK point_write', () => {
    expect(validatePointWrite(pointProc, tables)).toEqual([]);
  });

  it('rejects a serial PK', () => {
    const t: DdbTableDef = { name: 't', columns: [{ name: 'id', type: 'bigserial', constraints: ['primary key'] }, { name: 'v', type: 'text' }] };
    const p: DdbProcedureDef = { name: 'p', params: [{ name: 'i', type: 'bigint' }, { name: 'v', type: 'text' }], body: 'UPDATE t SET v = $v WHERE id = $i', point_write: { table: 't', op: 'update', pk: [{ column: 'id', param: 'i' }] } };
    expect(validatePointWrite(p, new Map([['t', t]])).length).toBeGreaterThan(0);
  });

  it('rejects a non-point predicate (range) and a verb mismatch', () => {
    expect(validatePointWrite({ ...pointProc, body: 'UPDATE users SET email = $email WHERE id > $user_id' }, tables).length).toBeGreaterThan(0);
    expect(validatePointWrite({ ...pointProc, point_write: { table: 'users', op: 'delete', pk: [{ column: 'id', param: 'user_id' }] } }, tables).length).toBeGreaterThan(0);
  });

  it('isMutatingBody detects mutations including a data-modifying CTE', () => {
    expect(isMutatingBody('SELECT * FROM users WHERE id = $i')).toBe(false);
    expect(isMutatingBody('UPDATE users SET x=1 WHERE id=$i')).toBe(true);
    expect(isMutatingBody('WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d')).toBe(true);
  });

  it('an all-point contract is row-lock-eligible', () => {
    const c: ContractDefinition = {
      contract_name: 'app',
      schema: { tables: [usersTable] },
      procedures: [pointProc, { name: 'getUser', params: [{ name: 'i', type: 'bigint' }], body: 'SELECT * FROM users WHERE id = $i' }],
    };
    const r = validateContractDefinition(c);
    expect(r.eligible).toBe(true);
    expect(r.errors).toEqual([]);
    expect(isRowLockEligible(c)).toBe(true);
  });

  it('a predicate mutator makes the contract ineligible (classic lane, still deploys)', () => {
    const c: ContractDefinition = {
      contract_name: 'app',
      schema: { tables: [usersTable] },
      procedures: [pointProc, { name: 'bulk', params: [{ name: 's', type: 'text' }], body: "UPDATE users SET email = '' WHERE email = $s" }],
    };
    expect(isRowLockEligible(c)).toBe(false);
  });
});
