/**
 * PLACE-02 (NEC-93) client-side resolver over a mocked RPC: the per-epoch cache (never an answer across a seal --
 * design §6 mutant "the epoch dropped from the cache key"), the -32601 fallback, the proof check against a trusted
 * header (using the node's own proof vector), the two-node cross-check, and the member pick that never leaves the
 * resolved group (design §6 mutant "on a fallback the SDK sends a read to a node outside the resolved group").
 */
import * as fs from 'fs';
import * as path from 'path';
import { DdbResolver, type ResolvedDatabase, type HostEndpointsJSON } from '../src/ddb-resolve';

const vec = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'place02_registry_proof.json'), 'utf8'));
const CONTRACT = '0x00000000000000000000000000000000000000c7';

function answer(epoch: number, withProof = false): ResolvedDatabase {
  const s = vec.sealed;
  const members = s.providers.slice(0, 2).map((p: any, i: number) => ({
    address: '0x00000000000000000000000000000000000000d' + (i + 1), validatorId: p.validatorId, weight: '0x1',
    consenting: true, liveAtSeal: true, provider: { validatorId: p.validatorId, record: p.record },
  }));
  return {
    contract: CONTRACT, database: 'c_' + CONTRACT.slice(2), placement: 'full-replication', databaseScoped: false,
    epoch, rootBlock: s.rootBlock, stateRoot: s.stateRoot, sealTime: s.sealTime, registry: s.registry,
    eligibilityActive: true, outcome: s.outcome, floorBps: s.floorBps, sealedConsenting: s.sealedConsenting, labels: s.labels,
    hostGroup: { members, size: 2, minSigners: 2 }, ...(withProof ? { proof: s.proof } : {}),
  };
}

function mockNode(state: { epoch: number; calls: string[]; resolveErr?: any; answerFor?: (e: number) => ResolvedDatabase; root?: string }) {
  return async (method: string, params: any[]) => {
    state.calls.push(method);
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
