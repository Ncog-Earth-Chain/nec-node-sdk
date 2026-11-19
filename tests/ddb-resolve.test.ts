/**
 * PLACE-02 (NEC-93) client-side resolver over a mocked RPC: the per-epoch cache (never an answer across a seal --
 * design §6 mutant "the epoch dropped from the cache key"), the -32601 fallback, the proof check against a trusted
 * header (using the node's own proof vector), the two-node cross-check, and the member pick that never leaves the
 * resolved group (design §6 mutant "on a fallback the SDK sends a read to a node outside the resolved group").
 */
import * as fs from 'fs';
import * as path from 'path';
import { Ddb } from '../src/ddb';
import { DdbResolver, type ResolvedDatabase, type HostEndpointsJSON } from '../src/ddb-resolve';

const vec = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'place02_registry_proof.json'), 'utf8'));
const CONTRACT = '0x00000000000000000000000000000000000000c7';

function answer(epoch: number, withProof = false): ResolvedDatabase {
  const s = vec.sealed;
  const members = s.providers.slice(0, 2).map((p: any, i: number) => ({
    address: '0x00000000000000000000000000000000000000d' + (i + 1), validatorId: p.validatorId, weight: '0x1',
    consenting: true, liveAtSeal: true, provider: { validatorId: p.validatorId, record: { ...p.record } },
  }));
  return {
    contract: CONTRACT, database: 'c_' + CONTRACT.slice(2), placement: 'full-replication', databaseScoped: false,
    epoch, rootBlock: s.rootBlock, stateRoot: s.stateRoot, sealTime: s.sealTime, registry: s.registry,
    eligibilityActive: true, outcome: s.outcome, floorBps: s.floorBps, sealedConsenting: s.sealedConsenting, labels: s.labels,
    hostGroup: { members, size: 2, minSigners: 2 }, ...(withProof ? { proof: s.proof } : {}),
  };
}

function mockNode(state: { epoch: number; calls: string[]; chainId?: any; chainErr?: Error; resolveErr?: any; answerFor?: (e: number) => ResolvedDatabase; root?: string }) {
  return async (method: string, params: any[]) => {
    state.calls.push(method);
    if (method === 'eth_chainId') {
      if (state.chainErr) throw state.chainErr;
      return Object.prototype.hasOwnProperty.call(state, 'chainId') ? state.chainId : '0x1';
    }
    if (method === 'eth_getBlockByNumber') {
      return params[0] === 'latest' ? { epoch: '0x' + state.epoch.toString(16) } : { stateRoot: state.root ?? vec.sealed.stateRoot };
    }
    if (method === 'ddb_resolveDatabase') {
      if (state.resolveErr) throw state.resolveErr;
      return (state.answerFor ?? ((e: number) => answer(e, params.length > 1)))(state.epoch);
    }
    throw new Error('unexpected ' + method);
  };
}

describe('PLACE-02 resolver client', () => {
  test('an answer is cached for its epoch and refetched after the seal', async () => {
    const st = { epoch: 7, calls: [] as string[] };
    const r = new DdbResolver(mockNode(st));
    const a = await r.resolve(CONTRACT);
    const b = await r.resolve(CONTRACT.toUpperCase().replace('0X', '0x'));
    expect(a.resolved?.epoch).toBe(7);
    expect(b).toBe(a);
    expect(st.calls.filter((c) => c === 'ddb_resolveDatabase')).toHaveLength(1);
    st.epoch = 8; // the next seal
    const c = await r.resolve(CONTRACT);
    expect(c.resolved?.epoch).toBe(8);
    expect(st.calls.filter((c2) => c2 === 'ddb_resolveDatabase')).toHaveLength(2);
  });

  test('an older node without the resolver falls back to the configured node', async () => {
    const st = { epoch: 7, calls: [] as string[], resolveErr: { code: -32601, message: 'the method ddb_resolveDatabase does not exist/is not available' } };
    expect(await new DdbResolver(mockNode(st)).resolve(CONTRACT)).toEqual({ fallback: true });
    const other = { epoch: 7, calls: [] as string[], resolveErr: new Error('connection refused') };
    await expect(new DdbResolver(mockNode(other)).resolve(CONTRACT)).rejects.toThrow(/connection refused/);
  });

  test('with proofs on, the records are checked against the trusted header of rootBlock', async () => {
    const st = { epoch: 7, calls: [] as string[] };
    const ok = await new DdbResolver(mockNode(st), { withProof: true }).resolve(CONTRACT);
    expect(ok.proven).toBe(true);
    // A header source whose rootBlock carries another root: refused.
    const lying = { epoch: 7, calls: [] as string[] };
    const hs = mockNode({ epoch: 7, calls: [], root: '0x' + '22'.repeat(32) });
    await expect(new DdbResolver(mockNode(lying), { withProof: true, headerSource: hs }).resolve(CONTRACT)).rejects.toThrow(/trusted header/);
    // A proof that does not cover the served record: refused.
    const tampered = { epoch: 7, calls: [] as string[], answerFor: (e: number) => {
      const a = answer(e, true);
      (a.hostGroup.members[0].provider as any).record.offered = '0x1';
      return a;
    } };
    await expect(new DdbResolver(mockNode(tampered), { withProof: true }).resolve(CONTRACT)).rejects.toThrow(/does not verify/);
  });

  test('two nodes that disagree on the host group are refused', async () => {
    const st = { epoch: 7, calls: [] as string[] };
    const other = mockNode({ epoch: 7, calls: [], answerFor: (e: number) => {
      const a = answer(e);
      a.hostGroup.members = a.hostGroup.members.slice(0, 1);
      return a;
    } });
    await expect(new DdbResolver(mockNode(st), { crossCheck: other }).resolve(CONTRACT)).rejects.toThrow(/disagree/);
    const agree = mockNode({ epoch: 7, calls: [] });
    expect((await new DdbResolver(mockNode(st), { crossCheck: agree }).resolve(CONTRACT)).fallback).toBe(false);
  });

  test('the member pick never leaves the resolved group', () => {
    const resolved = answer(7);
    const ep = (id: number, live: boolean): HostEndpointsJSON => ({ validatorId: id, live, status: live ? 'live' : 'lease expired',
      expiry: 0, auth: '0x', endpoints: live ? [{ scheme: 'https', url: `https://n${id}.example:443`, tlsKeyHash: '0x' }] : [] });
    // 9 is not a member; 1 is a member with an expired lease; 2 is a live member.
    expect(DdbResolver.pickMember(resolved, [ep(9, true), ep(1, false), ep(2, true)])?.validatorId).toBe(2);
    expect(DdbResolver.pickMember(resolved, [ep(9, true), ep(1, false), ep(2, true)], 1)?.validatorId).toBe(2);
    expect(DdbResolver.pickMember(resolved, [ep(9, true), ep(1, true), ep(2, true)], 2)?.validatorId).toBe(2);
    expect(DdbResolver.pickMember(resolved, [ep(9, true), ep(1, false)])).toBeNull();
  });
});

describe('NEC-93 resolver network identity', () => {
  test('equal-epoch network switches cannot reuse a cached placement from another network', async () => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1', answerFor: (epoch: number): ResolvedDatabase => {
      const a = answer(epoch);
      a.stateRoot = st.chainId === '0x1' ? 'network A root' : 'network B root';
      a.hostGroup.members[0].validatorId = st.chainId === '0x1' ? 1 : 9;
      return a;
    } };
    const resolver = new DdbResolver(mockNode(st));
    const a = await resolver.resolve(CONTRACT);
    st.chainId = '0x2';
    const b = await resolver.resolve(CONTRACT);
    expect(a.resolved?.stateRoot).toBe('network A root');
    expect(b.resolved?.stateRoot).toBe('network B root');
    expect(b.resolved?.hostGroup.members[0].validatorId).toBe(9);
    expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(2);
    expect(await resolver.resolve(CONTRACT)).toBe(b);
    st.chainId = '0x1';
    expect(await resolver.resolve(CONTRACT)).toBe(a);
  });

  test('ordinary Ddb string-address resolution also follows the freshly observed network', async () => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1', answerFor: (epoch: number): ResolvedDatabase => ({
      ...answer(epoch), stateRoot: st.chainId,
    }) };
    const ddb = new Ddb({ send: mockNode(st) } as any);
    expect((await ddb.resolve(CONTRACT)).resolved?.stateRoot).toBe('0x1');
    st.chainId = '0x2';
    expect((await ddb.resolve(CONTRACT)).resolved?.stateRoot).toBe('0x2');
    expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(2);
  });

  test('same-network cache hits retain canonical chain ID and contract spelling', async () => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x01' as any };
    const resolver = new DdbResolver(mockNode(st));
    const a = await resolver.resolve(CONTRACT);
    for (const chainId of ['1', 1, '0x1']) {
      st.chainId = chainId;
      expect(await resolver.resolve(CONTRACT.toUpperCase().replace('0X', '0x'))).toBe(a);
    }
    expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(1);
  });

  test.each([undefined, null, {}, [], false, '', 'not a chain', '0x', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'malformed chain identity cannot unlock a cached placement: %j', async (chainId) => {
      const st = { epoch: 7, calls: [] as string[], chainId: '0x1' as any };
      const resolver = new DdbResolver(mockNode(st));
      await resolver.resolve(CONTRACT);
      st.chainId = chainId;
      await expect(resolver.resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
      expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(1);
    },
  );

  test('failed identity RPC cannot unlock a cached placement or become old-server fallback', async () => {
    const st = { epoch: 7, calls: [] as string[], chainErr: undefined as Error | undefined };
    const resolver = new DdbResolver(mockNode(st));
    await resolver.resolve(CONTRACT);
    st.chainErr = new Error('identity unavailable');
    await expect(resolver.resolve(CONTRACT)).rejects.toThrow('identity unavailable');
    const old = async () => { throw Object.assign(new Error('chain identity unavailable'), { code: -32601 }); };
    await expect(new DdbResolver(old).resolve(CONTRACT)).rejects.toThrow('chain identity unavailable');
  });

  test('a switch while reading the epoch cannot return a cached placement', async () => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1' };
    const send = mockNode(st);
    let switchEpoch = false;
    const resolver = new DdbResolver(async (m, p) => {
      const value = await send(m, p);
      if (m === 'eth_getBlockByNumber' && p[0] === 'latest' && switchEpoch) st.chainId = '0x2';
      return value;
    });
    await resolver.resolve(CONTRACT);
    switchEpoch = true;
    await expect(resolver.resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
    expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(1);
  });

  test.each(['malformed', 'failed'])('a %s identity after the primary answer refuses without caching', async (failure) => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1' as any, chainErr: undefined as Error | undefined };
    const send = mockNode(st);
    let failOnce = true;
    const resolver = new DdbResolver(async (m, p) => {
      const value = await send(m, p);
      if (failOnce && m === 'ddb_resolveDatabase') {
        failOnce = false;
        if (failure === 'malformed') st.chainId = null;
        else st.chainErr = new Error('chain identity failed');
      }
      return value;
    });
    await expect(resolver.resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
    st.chainId = '0x1';
    st.chainErr = undefined;
    expect((await resolver.resolve(CONTRACT)).fallback).toBe(false);
    expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(2);
  });

  test.each(['primary', 'proof header', 'secondary'])('a primary network switch during %s refuses without caching', async (stage) => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1' };
    const send = mockNode(st);
    let switchOnce = true;
    const primary = async (m: string, p: any[]) => {
      const value = await send(m, p);
      if (switchOnce && ((stage === 'primary' && m === 'ddb_resolveDatabase') ||
          (stage === 'proof header' && m === 'eth_getBlockByNumber' && p[0] !== 'latest'))) {
        switchOnce = false;
        st.chainId = '0x2';
      }
      return value;
    };
    const secondarySend = mockNode({ epoch: 7, calls: [] });
    const resolver = new DdbResolver(primary, {
      withProof: stage === 'proof header',
      crossCheck: stage === 'secondary' ? async (m, p) => {
        const value = await secondarySend(m, p);
        if (switchOnce && m === 'ddb_resolveDatabase') {
          switchOnce = false;
          st.chainId = '0x2';
        }
        return value;
      } : undefined,
    });
    await expect(resolver.resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
    st.chainId = '0x1';
    expect((await resolver.resolve(CONTRACT)).fallback).toBe(false);
    expect(st.calls.filter((m) => m === 'ddb_resolveDatabase')).toHaveLength(2);
  });

  test.each(['header', 'secondary'])('a %s source switching networks refuses even when its data agrees', async (source) => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1' };
    const observed = { epoch: 7, calls: [] as string[], chainId: '0x1' };
    const send = mockNode(observed);
    const switching = async (m: string, p: any[]) => {
      const value = await send(m, p);
      if ((source === 'header' && m === 'eth_getBlockByNumber') ||
          (source === 'secondary' && m === 'ddb_resolveDatabase')) observed.chainId = '0x2';
      return value;
    };
    const opts = source === 'header' ? { withProof: true, headerSource: switching } : { crossCheck: switching };
    await expect(new DdbResolver(mockNode(st), opts).resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
  });

  test.each(['header', 'secondary'])('a %s on another chain refuses identical placement or proof data', async (source) => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1' };
    const foreign = mockNode({ epoch: 7, calls: [], chainId: '0x2' });
    const opts = source === 'header' ? { withProof: true, headerSource: foreign } : { crossCheck: foreign };
    await expect(new DdbResolver(mockNode(st), opts).resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
    expect(st.calls).not.toContain('ddb_resolveDatabase');
  });

  test('all independent source identities are captured in parallel before data RPCs', async () => {
    let captured = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const source = () => {
      const send = mockNode({ epoch: 7, calls: [] });
      return async (m: string, p: any[]) => {
        if (m === 'eth_chainId' && captured < 3) {
          captured++;
          if (captured === 3) release();
          await gate;
        }
        if (m !== 'eth_chainId') expect(captured).toBe(3);
        return send(m, p);
      };
    };
    expect((await new DdbResolver(source(), { withProof: true, headerSource: source(), crossCheck: source() })
      .resolve(CONTRACT)).proven).toBe(true);
  });

  test('proofs-off ignores an unused header source and never requests proofs', async () => {
    const st = { epoch: 7, calls: [] as string[] };
    const send = mockNode(st);
    const unused = jest.fn(async () => { throw new Error('unused header source'); });
    const primary = jest.fn(send);
    const result = await new DdbResolver(primary, { headerSource: unused }).resolve(CONTRACT);
    expect(result.proven).toBe(false);
    expect(primary).toHaveBeenCalledWith('ddb_resolveDatabase', [CONTRACT]);
    expect(primary.mock.calls.filter(([m]) => m === 'eth_getBlockByNumber').every(([, p]) => p[0] === 'latest')).toBe(true);
    expect(unused).not.toHaveBeenCalled();
  });

  test('old-server fallback is refused if the primary network changes during its missing-method reply', async () => {
    const st = { epoch: 7, calls: [] as string[], chainId: '0x1' };
    const send = mockNode(st);
    const resolver = new DdbResolver(async (m, p) => {
      if (m === 'ddb_resolveDatabase') {
        st.chainId = '0x2';
        throw Object.assign(new Error('method not found'), { code: -32601 });
      }
      return send(m, p);
    });
    await expect(resolver.resolve(CONTRACT)).rejects.toThrow(/chain|network/i);
  });
});

describe('sealed per-database placement metadata', () => {
  function placed(epoch: number): ResolvedDatabase {
    const a = answer(epoch);
    a.placement = 'host-group';
    a.databaseScoped = true;
    a.placementRecord = {
      manager: '0x' + '23'.repeat(20), version: '0x7', groupHash: '0x' + 'ab'.repeat(32), replicaBytes: '0x1000',
      members: a.hostGroup.members.map((m) => m.validatorId), enforced: true,
    };
    return a;
  }

  test.each(['manager', 'version', 'groupHash', 'replicaBytes', 'members', 'enforced', 'unavailableMembers', 'absent', 'placement', 'databaseScoped', 'rootBlock', 'contract', 'weight'])('%s disagreement refuses even with proofs off', async (field) => {
    const first = mockNode({ epoch: 7, calls: [], answerFor: placed });
    const second = mockNode({ epoch: 7, calls: [], answerFor: (epoch) => {
      const a = placed(epoch);
      const p = a.placementRecord!;
      switch (field) {
        case 'manager': p.manager = '0x' + '24'.repeat(20); break;
        case 'version': p.version = '0x8'; break;
        case 'groupHash': p.groupHash = '0x' + 'cd'.repeat(32); break;
        case 'replicaBytes': p.replicaBytes = '0x2000'; break;
        case 'members': p.members.reverse(); break;
        case 'enforced': p.enforced = false; break;
        case 'unavailableMembers': p.unavailableMembers = [p.members[0]]; break;
        case 'absent': delete a.placementRecord; break;
        case 'placement': a.placement = 'full-replication'; break;
        case 'databaseScoped': a.databaseScoped = false; break;
        case 'rootBlock': a.rootBlock++; break;
        case 'contract': a.contract = '0x' + 'ff'.repeat(20); break;
        case 'weight': a.hostGroup.members[0].weight = '0x0'; break;
      }
      return a;
    } });
    await expect(new DdbResolver(first, { crossCheck: second }).resolve(CONTRACT)).rejects.toThrow(/disagree/);
  });

  test('matching booking is accepted; unavailable or zero-key members cannot be picked', async () => {
    const send = mockNode({ epoch: 7, calls: [], answerFor: placed });
    const a = (await new DdbResolver(send, { crossCheck: send }).resolve(CONTRACT)).resolved!;
    a.placementRecord!.unavailableMembers = [a.hostGroup.members[0].validatorId];
    a.hostGroup.members[1].address = '0x' + '00'.repeat(20);
    const endpoints = a.hostGroup.members.map((m) => ({ validatorId: m.validatorId, live: true, status: 'live', expiry: 0, auth: '0x',
      endpoints: [{ scheme: 'https', url: `https://n${m.validatorId}.example`, tlsKeyHash: '0x' }] }));
    expect(DdbResolver.pickMember(a, endpoints)).toBeNull();
  });

  test('proof mode never marks an unproven booking as proven', async () => {
    const send = mockNode({ epoch: 7, calls: [], answerFor: (epoch) => ({ ...answer(epoch, true), placementRecord: placed(epoch).placementRecord }) });
    await expect(new DdbResolver(send, { withProof: true }).resolve(CONTRACT)).rejects.toThrow(/placement.*proof/i);
  });
});
