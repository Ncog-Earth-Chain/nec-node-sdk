import { Ddb, buildDdbSignedRead } from '../src/ddb';
import { DdbResolver } from '../src/ddb-resolve';
import vectors from './vectors/ddb_aliases.json';

const { a, b, c, owner } = vectors;
const ref = (row = a): any => ({ chainId: '1', ownerAddress: row.owner_address,
  contractName: row.contract_name, contractAddress: row.contract_address,
  dbName: row.db_name, registryAddress: row.contract_address });

function fixture(initial: any = { contracts: [a] }) {
  let response = initial;
  let chain = '0x1';
  const send = jest.fn(async (method: string, params: any[]): Promise<any> => {
    if (method === 'eth_chainId') return chain;
    if (method === 'ddb_getSchema') {
      if (response instanceof Error) throw response;
      return response;
    }
    if (method === 'ddb_select') return [{ selected: params[0] }];
    if (method === 'eth_getBlockByNumber') return { epoch: 1 };
    if (method === 'ddb_resolveDatabase') throw Object.assign(new Error('method not found'), { code: -32601 });
    throw new Error(`unexpected RPC ${method}`);
  });
  return { ddb: new Ddb({ send } as any), send,
    setResponse: (v: any) => { response = v; }, setChain: (v: string) => { chain = v; } };
}

describe('wallet aliases use existing registry and canonical Ddb flows', () => {
  test('discovers visible wallet records in address order, retaining duplicate names', async () => {
    const f = fixture({ contracts: [b, c, a], withheldContracts: 2 });
    const result = await (f.ddb as any).listContractAliases('0X' + owner.slice(2).toUpperCase());
    expect(result).toEqual({ aliases: [ref(a), ref(b)], withheldContracts: 2 });
    expect(f.send.mock.calls.filter(([m]) => m === 'ddb_getSchema')).toEqual([['ddb_getSchema', ['']]]);
    expect(result.aliases[0].contractName).toBe(result.aliases[1].contractName);
    expect(result.aliases[0].contractAddress).not.toBe(result.aliases[1].contractAddress);
    expect(result).not.toHaveProperty('complete');
    expect(JSON.stringify(result)).not.toContain(c.contract_address);
  });

  test('empty visible registry preserves unknown withholding rather than claiming complete ownership', async () => {
    const f = fixture({ contracts: [] });
    await expect((f.ddb as any).listContractAliases(owner)).resolves.toEqual({ aliases: [] });
    f.setResponse({ contracts: [], withheldContracts: 3 });
    await expect((f.ddb as any).listContractAliases(owner)).resolves.toEqual({ aliases: [], withheldContracts: 3 });
  });

  test.each([
    null, {}, { contracts: null }, { contracts: [null] },
    { contracts: [{ ...a, owner_address: '0x1' }] },
    { contracts: [{ ...a, contract_address: '0x0' }] },
    { contracts: [{ ...a, db_name: b.db_name }] },
    { contracts: [{ ...a, contract_name: null }] },
    { contracts: [{ ...a, tombstoned: true }] },
    { contracts: [{ ...a, tombstoned: undefined }] },
    { contracts: [a, { ...a, contract_name: 'conflict' }] },
    { contracts: [a], withheldContracts: -1 },
    { contracts: [a], withheldContracts: '2' },
  ])('invalid/unsafe registry never becomes complete empty discovery: %j', async (response) => {
    const f = fixture(response);
    await expect((f.ddb as any).listContractAliases(owner)).rejects.toThrow(/alias/i);
  });

  test('discovery validates owner before any RPC, and propagates withholding/transport errors', async () => {
    const f = fixture();
    await expect((f.ddb as any).listContractAliases('wallet name')).rejects.toThrow(/alias/i);
    expect(f.send).not.toHaveBeenCalled();
    f.setResponse(new Error('restricted metadata'));
    await expect((f.ddb as any).listContractAliases(owner)).rejects.toThrow('restricted metadata');
  });

  test('selection feeds actual select and sealed resolver with the selected canonical identity', async () => {
    const f = fixture({ contracts: [b, a] });
    const selected = (await (f.ddb as any).listContractAliases(owner)).aliases[1];
    f.setResponse({ contracts: [b] });
    const schema = await f.ddb.resolveDbName(selected);
    expect(await f.ddb.select(schema, 'balances')).toEqual([{ selected: b.db_name }]);
    expect(await f.ddb.resolve(selected)).toEqual({ fallback: true });
    expect(f.send).toHaveBeenCalledWith('ddb_select', [b.db_name, 'balances', {}]);
    expect(f.send).toHaveBeenCalledWith('ddb_resolveDatabase', [b.contract_address]);
    expect(f.send.mock.calls.filter(([m]) => m === 'ddb_getSchema').slice(1))
      .toEqual([['ddb_getSchema', [b.contract_address]], ['ddb_getSchema', [b.contract_address]]]);
  });

  test('current route consumes the same selected address and preserves unsupported-proof refusal', async () => {
    const f = fixture();
    const selected = ref();
    const current = jest.spyOn(DdbResolver.prototype, 'resolveCurrent').mockResolvedValue({ contract: a.contract_address } as any);
    try {
      expect(await f.ddb.resolveCurrent(selected)).toEqual({ contract: a.contract_address });
      expect(current).toHaveBeenCalledWith(a.contract_address);
    } finally { current.mockRestore(); }
    await expect(f.ddb.resolveCurrent(selected, { withProof: true })).rejects.toThrow('unsupported-current-proof');
    expect(f.send.mock.calls.some(([m]) => m === 'ddb_resolveDatabase')).toBe(false);
  });

  test('an alias cannot reuse the legacy resolver cache from another equal-epoch chain', async () => {
    const f = fixture();
    let root = 'first chain';
    f.send.mockImplementation(async (m: string): Promise<any> => {
      if (m === 'eth_chainId') return root === 'first chain' ? '0x1' : '0x2';
      if (m === 'ddb_getSchema') return { contracts: [a] };
      if (m === 'eth_getBlockByNumber') return { epoch: 7 };
      if (m === 'ddb_resolveDatabase') return { contract: a.contract_address, epoch: 7, stateRoot: root };
      throw new Error(m);
    });
    expect((await f.ddb.resolve(a.contract_address)).resolved?.stateRoot).toBe('first chain');
    root = 'second chain';
    expect((await f.ddb.resolve({ ...ref(), chainId: '2' })).resolved?.stateRoot).toBe('second chain');
    expect(f.send.mock.calls.filter(([m]) => m === 'ddb_resolveDatabase')).toHaveLength(2);
  });

  test.each([
    { contracts: [b] },
    { contracts: [b, a] },
    { contracts: [a, { ...a, contract_name: 'conflict' }] },
    { contracts: [{ ...a, db_name: b.db_name }] },
    { contracts: [{ ...a, owner_address: c.owner_address }] },
    { contracts: [{ ...a, contract_name: 'renamed' }] },
    { contracts: [{ ...a, db_name: 'legacy_a1' }] },
    { contracts: [], withheldContracts: 1 },
    new Error('restricted metadata'),
  ])('alias reference refuses mismatched/hidden/stale point metadata before routes: %j', async (response) => {
    const f = fixture(response);
    for (const method of ['resolveDbName', 'resolve', 'resolveCurrent']) {
      await expect((f.ddb as any)[method](ref())).rejects.toThrow();
    }
    expect(f.send.mock.calls.every(([m]) => m === 'eth_chainId' || m === 'ddb_getSchema')).toBe(true);
  });

  test.each([
    {}, { ownerAddress: owner, contractName: a.contract_name },
    { ...ref(), chainId: '2' }, { ...ref(), dbName: b.db_name },
    { ...ref(), registryAddress: b.contract_address }, { ...ref(), contractAddress: '0x1' },
    { ...ref(), ownerAddress: '0x' + '0'.repeat(40) },
  ])('invalid identity/network cannot trigger metadata fallback: %j', async (selected) => {
    const f = fixture();
    await expect(f.ddb.resolveDbName(selected)).rejects.toThrow(/alias/i);
    expect(f.send.mock.calls.some(([m]) => m === 'ddb_getSchema')).toBe(false);
  });

  test('preserves original textual registry lookup but routes normalized full identity', async () => {
    const reported = { ...a, contract_address: a.contract_address.toUpperCase(), owner_address: owner.toUpperCase() };
    const f = fixture({ contracts: [reported] });
    const selected = (await (f.ddb as any).listContractAliases(owner)).aliases[0];
    expect(selected.contractAddress).toBe(a.contract_address);
    expect(selected.registryAddress).toBe(reported.contract_address);
    expect(await f.ddb.resolveDbName(selected)).toBe(a.db_name);
    expect(f.send).toHaveBeenLastCalledWith('eth_chainId', []);
    expect(f.send).toHaveBeenCalledWith('ddb_getSchema', [reported.contract_address]);
  });

  test('network changes across discovery or revalidation discard the response', async () => {
    for (const method of ['listContractAliases', 'resolveDbName']) {
      const f = fixture();
      f.send.mockImplementation(async (m: string): Promise<any> => {
        if (m === 'eth_chainId') return f.send.mock.calls.filter(([name]) => name === m).length === 1 ? '0x1' : '0x2';
        return { contracts: [a] };
      });
      await expect((f.ddb as any)[method](method === 'listContractAliases' ? owner : ref())).rejects.toThrow(/network|chain/i);
    }
  });

  test('snapshot of selected reference cannot be retargeted while metadata awaits', async () => {
    const f = fixture();
    const selected = ref();
    f.send.mockImplementation(async (m: string): Promise<any> => {
      if (m === 'eth_chainId') return '0x1';
      selected.contractAddress = b.contract_address;
      selected.dbName = b.db_name;
      return { contracts: [a] };
    });
    expect(await f.ddb.resolveDbName(selected)).toBe(a.db_name);
  });

  test('reported name changes do not change read signing bytes or canonical schema', async () => {
    const f = fixture();
    const first = await f.ddb.resolveDbName(ref());
    const renamed = { ...a, contract_name: 'New reported name' };
    f.setResponse({ contracts: [renamed] });
    const second = await f.ddb.resolveDbName(ref(renamed));
    const prepared = (schema: string) => buildDdbSignedRead(1, schema, 'balances', owner,
      new Uint8Array([1, 2]), { timestamp: 1800000000, nonce: 8 });
    expect(prepared(first)).toEqual(prepared(second));
    expect(prepared(first).envelope.schemaName).toBe(a.db_name);
  });

  test('legacy string-address lookup retains reported schemas and derivation fallback', async () => {
    const f = fixture({ contracts: [{ db_name: 'legacy_a1' }] });
    expect(await f.ddb.resolveDbName(a.contract_address)).toBe('legacy_a1');
    f.setResponse(new Error('old server unavailable'));
    expect(await f.ddb.resolveDbName(a.contract_address)).toBe(a.db_name);
    expect(f.send.mock.calls.some(([m]) => m === 'eth_chainId')).toBe(false);
  });
});
