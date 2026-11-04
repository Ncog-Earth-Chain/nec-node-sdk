import { keccak_256 } from '@noble/hashes/sha3';
import { Ddb, buildDdbSignedRead, buildDdbSignedReadProcedure, type DdbSigner } from '../src/ddb';
import { DdbResolver } from '../src/ddb-resolve';

const CONTRACT = '0x' + '12'.repeat(20);
const DB = 'c_' + CONTRACT.slice(2);
const FROM = '0x' + '34'.repeat(20);
const HASH = '0x' + '56'.repeat(32);
const MANAGER = '0x' + '78'.repeat(20);
const baseOpts = { chainId: 2479, timestamp: 1800000000, nonce: 7 };
const signer: DdbSigner = {
  getAddress: () => FROM,
  getPublicKey: () => new Uint8Array([1, 2, 3]),
  signDdbHash: async () => new Uint8Array([4, 5, 6]),
};

function route(ids = [2, 7], version = '0x1', contract = CONTRACT): any {
  // PlacementManager ABI packed uint32[] elements occupy full 32-byte words.
  const encoded = ids.map(id => id.toString(16).padStart(64, '0')).join('');
  return {
    database: 'c_' + contract.slice(2), contract, enabled: true, private: true,
    block: '0x10', blockHash: HASH, stateRoot: HASH, epoch: '0x4', manager: MANAGER,
    runtimeHash: HASH, version,
    groupHash: '0x' + Buffer.from(keccak_256(Buffer.from(encoded, 'hex'))).toString('hex'),
    members: ids.map(validatorId => ({ validatorId, address: '0x' + validatorId.toString(16).padStart(40, '0') })),
  };
}

function endpoints(ids: number[]): any[] {
  return ids.map(validatorId => ({ validatorId, live: true, status: 'live', expiry: 0, auth: '0x',
    endpoints: [{ scheme: 'https', url: `https://host${validatorId}.example`, tlsKeyHash: HASH }] }));
}

function fixture(routes = [route()]) {
  let index = 0;
  const ingress = jest.fn(async (method: string, params: any[]) => {
    if (method === 'ddb_resolveDatabase') return { contract: params[0], currentRoute: routes[Math.min(index++, routes.length - 1)] };
    if (method === 'ddb_hostEndpoints') return { hosts: endpoints(params[0]) };
    if (method === 'eth_chainId') return '0x9af';
    return [{ ingress: true }];
  });
  const direct = jest.fn(async (_method: string, _params: any[]): Promise<any> => [{ value: 'private' }]);
  const verifyAssignment = jest.fn(async (_route: any) => true);
  const connect = jest.fn(async (request: any): Promise<any> => ({
    binding: { route: request.route, validatorId: request.member.validatorId, address: request.member.address,
      url: request.endpoints[0].url, tlsKeyHash: request.endpoints[0].tlsKeyHash },
    endpointAuthenticated: true, confidentiality: 'post-quantum', send: direct,
  }));
  const policy = { verifyAssignment, connect };
  const options = { ...baseOpts, privateRouting: { policy } };
  return { ingress, direct, verifyAssignment, connect, policy, options, ddb: new Ddb({ send: ingress } as any) };
}

describe('PLACE-02F current route and direct private signed reads', () => {
  test('current route resolves afresh within one epoch, freezes copies, and never uses the sealed cache', async () => {
    const a = route();
    const b = route([3, 9], '0x2');
    const f = fixture([a, b]);
    const resolver: any = new DdbResolver(f.ingress);
    const first = await resolver.resolveCurrent(CONTRACT);
    expect(first).toEqual(a);
    expect(first).not.toBe(a);
    expect(Object.isFrozen(first.members[0])).toBe(true);
    expect((await resolver.resolveCurrent(CONTRACT)).version).toBe('0x2');
    expect(f.ingress.mock.calls).toEqual([
      ['ddb_resolveDatabase', [CONTRACT, { currentRoute: true }]],
      ['ddb_resolveDatabase', [CONTRACT, { currentRoute: true }]],
    ]);
  });

  test('select dispatches to exact full-group home through verified transport and preserves exact numbers', async () => {
    const f = fixture();
    f.direct.mockResolvedValue({ columns: [{ name: 'n', type: 'int8' }], rows: [{ n: '9007199254740993' }] });
    const prepared = buildDdbSignedRead(2479, DB, 'items', FROM, new Uint8Array([1, 2, 3]), baseOpts);
    const home = [2, 7][Number(Buffer.from(prepared.hash).readBigUInt64BE() % BigInt(2))];
    const rows = await f.ddb.signedSelect(signer, DB, 'items', { exactNumbers: true, filters: [{ column: 'secret', op: '=', value: 'hidden' }] }, f.options);
    expect(rows).toEqual([{ n: BigInt('9007199254740993') }]);
    expect(f.connect.mock.calls[0][0].member.validatorId).toBe(home);
    expect(f.connect.mock.calls[0][0].endpoints).toEqual(endpoints([home])[0].endpoints);
    expect(Object.isFrozen(f.connect.mock.calls[0][0])).toBe(true);
    expect(Object.isFrozen(f.connect.mock.calls[0][0].route)).toBe(true);
    expect(Object.isFrozen(f.connect.mock.calls[0][0].endpoints[0])).toBe(true);
    expect(f.verifyAssignment).toHaveBeenCalledTimes(1);
    expect(f.direct).toHaveBeenCalledWith('ddb_signedSelect', [
      { ...prepared.envelope, callerSig: '0x040506' },
      { exactNumbers: true, filters: [{ column: 'secret', op: '=', value: 'hidden' }] },
    ]);
    expect(f.ingress.mock.calls.some(([m]) => m === 'ddb_signedSelect')).toBe(false);
    expect(JSON.stringify(f.ingress.mock.calls)).not.toContain('hidden');
    expect(JSON.stringify(f.connect.mock.calls)).not.toContain('hidden');
  });

  test('procedure dispatch preserves signed args and exact-number/consistency options on a disjoint group', async () => {
    const f = fixture([route([11, 13])]);
    f.direct.mockResolvedValue({ columns: [{ name: 'n', type: 'int8' }], rows: [{ n: '-9223372036854775808' }] });
    const prepared = buildDdbSignedReadProcedure(2479, DB, 'private_proc', ['secret arg'], FROM, new Uint8Array([1, 2, 3]), baseOpts);
    const home = [11, 13][Number(Buffer.from(prepared.hash).readBigUInt64BE() % BigInt(2))];
    expect(await f.ddb.signedCallReadProcedure(signer, DB, 'private_proc', ['secret arg'], f.options, { minVersion: 16 }, { exactNumbers: true }))
      .toEqual([{ n: BigInt('-9223372036854775808') }]);
    expect(f.connect.mock.calls[0][0].member.validatorId).toBe(home);
    expect(f.direct).toHaveBeenCalledWith('ddb_signedCallReadProcedure', [
      { ...prepared.envelope, callerSig: '0x040506' }, { minVersion: '0x10' }, { exactNumbers: true },
    ]);
    expect(JSON.stringify(f.ingress.mock.calls)).not.toContain('secret arg');
    expect(JSON.stringify(f.connect.mock.calls)).not.toContain('secret arg');
  });

  test('missing policy and unsupported proof modes refuse before private dispatch', async () => {
    const f = fixture();
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, { ...baseOpts, privateRouting: {} } as any)).rejects.toThrow(/policy/);
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, { ...f.options, privateRouting: { policy: f.policy, withProof: true } } as any))
      .rejects.toThrow(/unsupported.current.proof/);
    const resolver: any = new DdbResolver(f.ingress, { withProof: true });
    await expect(resolver.resolveCurrent(CONTRACT)).rejects.toThrow(/unsupported.current.proof/);
    expect(f.ingress).not.toHaveBeenCalled();
    expect(f.direct).not.toHaveBeenCalled();
  });

  test('old server missing currentRoute refuses without private fallback', async () => {
    const f = fixture();
    f.ingress.mockResolvedValue({ contract: CONTRACT } as any);
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toThrow(/current route/);
    expect(f.direct).not.toHaveBeenCalled();
    expect(f.ingress.mock.calls).toHaveLength(1);
  });

  test.each(['database', 'groupHash', 'members', 'private', 'enabled'])('invalid %s route refuses before policy or data dispatch', async field => {
    const r = route();
    if (field === 'database') r.database = 'c_' + 'ff'.repeat(20);
    if (field === 'groupHash') r.groupHash = HASH;
    if (field === 'members') r.members.reverse();
    if (field === 'private' || field === 'enabled') r[field] = false;
    const f = fixture([r]);
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toThrow();
    expect(f.verifyAssignment).not.toHaveBeenCalled();
    expect(f.direct).not.toHaveBeenCalled();
  });

  test('untrusted assignment and ordinary HTTPS transport claims refuse before private bytes', async () => {
    const f = fixture();
    f.verifyAssignment.mockResolvedValue(false);
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toThrow(/assignment/);
    expect(f.connect).not.toHaveBeenCalled();
    f.verifyAssignment.mockResolvedValue(true);
    f.connect.mockResolvedValue({ endpointAuthenticated: true, confidentiality: 'tls', send: f.direct });
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toThrow(/transport/);
    expect(f.direct).not.toHaveBeenCalled();
  });

  test.each(['validatorId', 'address', 'url', 'tlsKeyHash', 'database', 'version', 'blockHash', 'endpointAuthenticated'])
  ('wrong transport %s binding refuses', async field => {
    const f = fixture();
    const connect = f.connect.getMockImplementation()!;
    f.connect.mockImplementation(async req => {
      const channel = await connect(req);
      if (field === 'endpointAuthenticated') channel.endpointAuthenticated = false;
      else if (field in channel.binding) channel.binding[field] = field === 'validatorId' ? 99 : 'wrong';
      else channel.binding.route = { ...channel.binding.route, [field]: 'wrong' };
      return channel;
    });
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toThrow(/transport/);
    expect(f.direct).not.toHaveBeenCalled();
  });

  test('unavailable exact home never rehashes over live subset or picks another endpoint', async () => {
    const f = fixture();
    const original = f.ingress.getMockImplementation()!;
    f.ingress.mockImplementation(async (method, params) => method === 'ddb_hostEndpoints'
      ? { hosts: endpoints([99]) } as any : original(method, params));
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toThrow(/home.*endpoint/);
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.direct).not.toHaveBeenCalled();
  });

  test('a definite pre-service stale route refreshes once and revalidates assignment/transport', async () => {
    const f = fixture([route(), route([11, 13], '0x2')]);
    f.direct.mockImplementationOnce(async () => {
      throw { code: -32063, data: { reason: 'stale_route', preService: true, home: f.connect.mock.calls[0][0].member.validatorId } };
    });
    expect(await f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).toEqual([{ value: 'private' }]);
    expect(f.verifyAssignment).toHaveBeenCalledTimes(2);
    expect(f.connect).toHaveBeenCalledTimes(2);
    expect(f.direct).toHaveBeenCalledTimes(2);
    expect(f.direct.mock.calls[0][1]).toEqual(f.direct.mock.calls[1][1]);
    expect(f.connect.mock.calls[1][0].route.version).toBe('0x2');
  });

  test.each([new Error('connection lost'), { code: -32063, data: { reason: 'stale_route', preService: false } },
    { code: -32063, data: { reason: 'stale_route' } }])('uncertain service never retries at another member', async failure => {
    const f = fixture([route(), route([11, 13], '0x2')]);
    f.direct.mockRejectedValue(failure);
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toBe(failure);
    expect(f.direct).toHaveBeenCalledTimes(1);
    expect(f.connect).toHaveBeenCalledTimes(1);
  });

  test('second stale refusal propagates and does not loop', async () => {
    const f = fixture();
    f.direct.mockImplementation(async () => {
      throw { code: -32063, data: { reason: 'stale_route', preService: true, home: f.connect.mock.calls[0][0].member.validatorId } };
    });
    await expect(f.ddb.signedSelect(signer, DB, 'items', {}, f.options)).rejects.toMatchObject({ code: -32063 });
    expect(f.direct).toHaveBeenCalledTimes(2);
  });

  test('private client defaults route signed reads and refuse legacy CAP v1 even with explicit groupVersion', async () => {
    const f = fixture();
    const ddb = new Ddb({ send: f.ingress } as any, { privateRouting: { policy: f.policy } } as any);
    expect(await ddb.signedSelect(signer, DB, 'items', {}, baseOpts)).toEqual([{ value: 'private' }]);
    f.ingress.mockClear();
    await expect(ddb.issueCapabilityToken(signer, CONTRACT, 'reader', { chainId: 2479, groupVersion: 4 })).rejects.toThrow(/CAP v1/);
    await expect(ddb.requestCapabilityToken(signer, CONTRACT, 'reader')).rejects.toThrow(/CAP v1/);
    await expect(ddb.tokenSelect({} as any, 'items')).rejects.toThrow(/CAP v1/);
    await expect(ddb.tokenCallReadProcedure({} as any, 'p', ['secret'])).rejects.toThrow(/CAP v1/);
    expect(f.ingress).not.toHaveBeenCalled();
  });

  test('unconfigured public reads keep their RPC bytes and do not perform route lookup', async () => {
    const f = fixture();
    expect(await f.ddb.signedSelect(signer, DB, 'items', {}, baseOpts)).toEqual([{ ingress: true }]);
    expect(f.ingress.mock.calls.map(([m]) => m)).toEqual(['ddb_signedSelect']);
    expect(f.direct).not.toHaveBeenCalled();
  });

  test.each([
    ['select', (ddb: Ddb) => ddb.select(DB, 'items', { filters: [{ column: 'secret', op: '=', value: 'hidden' }] })],
    ['selectVersioned', (ddb: Ddb) => ddb.selectVersioned(DB, 'items')],
    ['query', (ddb: Ddb) => ddb.query(DB, 'items')],
    ['callReadProcedure', (ddb: Ddb) => ddb.callReadProcedure(DB, 'p', ['secret arg'])],
  ] as const)('private client refuses anonymous %s while public clients retain dispatch', async (_name, call) => {
    const f = fixture();
    const privateClient = new Ddb({ send: f.ingress } as any, { privateRouting: { policy: f.policy } });
    await expect(call(privateClient)).rejects.toThrow(/private.*signed/);
    expect(f.ingress).not.toHaveBeenCalled();
    await call(f.ddb);
    expect(f.ingress).toHaveBeenCalledTimes(1);
    expect(f.direct).not.toHaveBeenCalled();
  });
});
