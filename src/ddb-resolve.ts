import { verifyRegistryProof, verifyPlacementProof, type RegistryProofJSON, type ServedProvider, type PlacementRecordJSON } from './ddb-proof';
import { parseDdbCurrentReadRoute, type DdbCurrentReadRoute } from './ddb-private-read';
import { aliasChainId } from './ddb-aliases';

/**
 * PLACE-02 phase B/C client side (NEC-93; docs/design/place-02-provider-discovery.md §5, §6 "SDK and wallet
 * routing"; owner ruling 35: Q1 (a) proof check + two-node cross-check).
 *
 * `DdbResolver.resolve(contract)` answers which host group serves a contract's database:
 *
 *   1. `ddb_resolveDatabase` at the configured node (any node answers, DDB or not), cached per chain ID and contract
 *      for the sealed EPOCH: a cached answer is served only while the observed network and current epoch agree;
 *   2. with `withProof`, every member's provider record is verified against the stateRoot of the header of
 *      `rootBlock` fetched from `headerSource` (the node the USER trusts for headers; ddb-proof.ts);
 *   3. with `crossCheck`, a second node's answer must agree on the epoch, the sealed root, the sealed consenting set
 *      and the host group on the same chain ID (those are node-asserted, Q2 (a): agreement is the check);
 *   4. an older node answering -32601 (no resolver) yields `{ fallback: true }`: today's behaviour, the configured
 *      node for everything.
 *
 * `pickMember` chooses where to send a read: a member with a live endpoint (ddb_hostEndpoints), preferring the
 * configured node's validator when it is a member -- and never a node outside the resolved group.
 */

export type RpcSend = (method: string, params: any[]) => Promise<any>;

export interface HostMemberJSON {
  address: string;
  validatorId: number;
  weight: string | null;
  consenting: boolean;
  liveAtSeal: boolean;
  provider: ServedProvider | null;
}

/** ddb_resolveDatabase's answer (RPCDatabasePlacement). */
export interface ResolvedDatabase {
  contract: string;
  database: string;
  placement: string;
  databaseScoped: boolean;
  epoch: number;
  rootBlock: number;
  stateRoot: string;
  sealTime: number;
  registry: string;
  eligibilityActive: boolean;
  outcome: string;
  floorBps: number;
  sealedConsenting: number[];
  labels: string[];
  hostGroup: { members: HostMemberJSON[]; size: number; minSigners: number };
  proof?: RegistryProofJSON;
  placementRecord?: PlacementRecordJSON;
  /** Present only for the explicit currentRoute request; independent of the sealed answer/proof above. */
  currentRoute?: DdbCurrentReadRoute;
}

export interface ResolveResult {
  /** True when the node has no resolver (-32601): use the configured node for everything. */
  fallback: boolean;
  resolved?: ResolvedDatabase;
  /** Whether provider and attached booking storage proofs were verified; activation/key bindings remain node-asserted. */
  proven?: boolean;
}

export interface DdbResolverOptions {
  /** Ask for and verify record proofs at rootBlock (needs a node holding that state, e.g. an archive node). */
  withProof?: boolean;
  /** Where trusted headers come from (default: the resolving node itself). */
  headerSource?: RpcSend;
  /** A second node whose answer must agree (Q1 (a)). */
  crossCheck?: RpcSend;
}

/** ddb_hostEndpoints' entry (RPCHostEndpoints). */
export interface HostEndpointsJSON {
  validatorId: number;
  live: boolean;
  status: string;
  expiry: number;
  auth: string;
  endpoints: { scheme: string; url: string; tlsKeyHash: string }[];
}

function isMethodNotFound(e: any): boolean {
  return e?.code === -32601 || /method not found|does not exist\/is not available/i.test(String(e?.message ?? e));
}

const num = (v: any) => (typeof v === 'string' ? Number(BigInt(v)) : Number(v));

export class DdbResolver {
  private readonly cache = new Map<string, ResolveResult>();

  constructor(private readonly send: RpcSend, private readonly opts: DdbResolverOptions = {}) {}

  /**
   * Fresh current finalized route claim, separate from the sealed epoch cache. This validates shape and
   * member hash only, NOT authenticity or readiness. No old-server fallback and no sealed-proof downgrade.
   * A private caller must still authenticate the assignment and endpoint using its own trusted policy.
   */
  async resolveCurrent(contract: string): Promise<DdbCurrentReadRoute> {
    if (this.opts.withProof) throw new Error('unsupported-current-proof: sealed proofs do not authenticate current assignments');
    const answer = await this.send('ddb_resolveDatabase', [contract, { currentRoute: true }]);
    return parseDdbCurrentReadRoute(contract, answer?.currentRoute);
  }

  /** The chain's current epoch (the epoch of the latest block). */
  async currentEpoch(): Promise<number> {
    const b = await this.send('eth_getBlockByNumber', ['latest', false]);
    if (!b || b.epoch === undefined) throw new Error('the node did not report the latest block epoch');
    return num(b.epoch);
  }

  /** Canonical chain ID uses the same accepted encodings as selected aliases; it is still node-asserted. */
  private async networkIdentity(sources: RpcSend[]): Promise<string> {
    const identities = await Promise.all(sources.map(async (send) => {
      const value = await send('eth_chainId', []);
      try {
        return aliasChainId(value);
      } catch {
        throw new Error('the resolver source did not report a valid chain ID');
      }
    }));
    if (identities.some((id) => id !== identities[0])) {
      throw new Error('the resolver sources disagree on the network chain ID; refusing to route');
    }
    return identities[0];
  }

  private async assertNetworkIdentity(sources: RpcSend[], expected: string): Promise<void> {
    if (await this.networkIdentity(sources) !== expected) {
      throw new Error('the resolver network chain ID changed during resolution; refusing to route');
    }
  }

  /**
   * Resolve the host group of a contract's database, cached per chain ID/contract/sealed epoch.
   * Identity observations bracket the epoch (including cache hits), primary answer and optional header/secondary
   * awaits. Those freshness checks add RPC round trips; independent sources and header/secondary reads run in
   * parallel. No answer or fallback is published after an observed switch or unknown identity. Equal chain IDs
   * and switches away and back between observations cannot be distinguished by this existing RPC identity.
   */
  async resolve(contract: string): Promise<ResolveResult> {
    const contractKey = contract.toLowerCase();
    // Snapshot the selected sources before awaiting; caller mutation of options cannot retarget an in-flight use.
    const withProof = !!this.opts.withProof;
    const hs = this.opts.headerSource ?? this.send;
    const crossCheck = this.opts.crossCheck;
    const sources = [...new Set([this.send, ...(withProof ? [hs] : []), ...(crossCheck ? [crossCheck] : [])])];
    const network = await this.networkIdentity(sources);
    const key = network + ':' + contractKey;
    const epoch = await this.currentEpoch();
    await this.assertNetworkIdentity(sources, network);
    const hit = this.cache.get(key);
    if (hit?.resolved && hit.resolved.epoch === epoch) return hit;

    let answer: ResolvedDatabase;
    try {
      answer = await this.send('ddb_resolveDatabase', withProof ? [contract, { withProof: true }] : [contract]);
    } catch (e) {
      if (isMethodNotFound(e)) {
        await this.assertNetworkIdentity(sources, network);
        return { fallback: true };
      }
      throw e;
    }
    await this.assertNetworkIdentity(sources, network);
    let proven = false;
    if (answer.contract.toLowerCase() !== contractKey) throw new Error('the resolver answered for another contract');
    let header: any;
    let other: ResolvedDatabase | undefined;
    if (withProof || crossCheck) {
      [header, other] = await Promise.all([
        withProof ? hs('eth_getBlockByNumber', ['0x' + answer.rootBlock.toString(16), false]) : undefined,
        crossCheck ? crossCheck('ddb_resolveDatabase', [contract]) : undefined,
      ]);
      await this.assertNetworkIdentity(sources, network);
    }
    if (withProof) {
      if (!header || String(header.stateRoot).toLowerCase() !== answer.stateRoot.toLowerCase()) {
        throw new Error(`the trusted header of rootBlock ${answer.rootBlock} does not carry the answer's stateRoot`);
      }
      const served = answer.hostGroup.members.filter((m) => m.provider).map((m) => m.provider as ServedProvider);
      const v = verifyRegistryProof(header.stateRoot, answer.registry, answer.proof, served);
      if (!v.valid) throw new Error(`the resolver's record proof does not verify: ${v.reason}`);
      if (answer.placementRecord) {
        if (answer.placementRecord.proof?.block !== answer.rootBlock) throw new Error('placement proof is missing or names another sealed block');
        const p = verifyPlacementProof(header.stateRoot, answer.contract, answer.placementRecord);
        if (!p.valid) throw new Error(`the resolver's placement proof does not verify: ${p.reason}`);
      }
      proven = true;
    }
    if (crossCheck) {
      const shape = (r: ResolvedDatabase) => JSON.stringify({
        contract: r.contract.toLowerCase(), database: r.database, placement: r.placement, databaseScoped: r.databaseScoped,
        epoch: r.epoch, rootBlock: r.rootBlock, sealTime: r.sealTime, stateRoot: r.stateRoot.toLowerCase(), sealed: r.sealedConsenting,
        registry: r.registry.toLowerCase(), eligibilityActive: r.eligibilityActive, outcome: r.outcome, floorBps: r.floorBps, labels: r.labels,
        members: r.hostGroup.members.map((m) => [m.address.toLowerCase(), m.validatorId, m.weight == null ? null : BigInt(m.weight).toString(), m.consenting, m.liveAtSeal]),
        size: r.hostGroup.size, minSigners: r.hostGroup.minSigners,
        booking: r.placementRecord ? {
          manager: r.placementRecord.manager.toLowerCase(), version: BigInt(r.placementRecord.version).toString(),
          groupHash: r.placementRecord.groupHash.toLowerCase(), replicaBytes: BigInt(r.placementRecord.replicaBytes).toString(),
          members: r.placementRecord.members, enforced: r.placementRecord.enforced, unavailable: r.placementRecord.unavailableMembers ?? [],
        } : null,
      });
      if (shape(other!) !== shape(answer)) {
        throw new Error('the two nodes disagree on the sealed host group; refusing to route (Q1 (a) cross-check)');
      }
    }
    const res: ResolveResult = { fallback: false, resolved: answer, proven };
    // No awaits after the last identity check: publish/cache only under the observed network and sealed epoch.
    if (answer.epoch === epoch) this.cache.set(key, res);
    return res;
  }

  /** The live endpoints of the resolved group's members (ddb_hostEndpoints). */
  async hostEndpoints(validatorIds?: number[]): Promise<HostEndpointsJSON[]> {
    const r = await this.send('ddb_hostEndpoints', validatorIds ? [validatorIds] : []);
    return r.hosts as HostEndpointsJSON[];
  }

  /**
   * Picks the member a read goes to: the preferred validator when it is a member with a live endpoint, else the first
   * member (ascending validator ID) with one. Never a node outside the group: an endpoint whose validator is not a
   * member is ignored. Null when no member has a live endpoint (use the configured node).
   */
  static pickMember(resolved: ResolvedDatabase, endpoints: HostEndpointsJSON[], preferValidatorId?: number):
    { validatorId: number; url: string; tlsKeyHash: string } | null {
    const unavailable = new Set(resolved.placementRecord?.unavailableMembers ?? []);
    const members = new Set(resolved.hostGroup.members.filter((m) =>
      !unavailable.has(m.validatorId) && !/^0x0{40}$/i.test(m.address) && (m.weight == null || BigInt(m.weight) > BigInt(0)),
    ).map((m) => m.validatorId));
    const live = endpoints
      .filter((h) => members.has(h.validatorId) && h.live && h.endpoints.length > 0)
      .sort((a, b) => a.validatorId - b.validatorId);
    const pick = live.find((h) => h.validatorId === preferValidatorId) ?? live[0];
    if (!pick) return null;
    const ep = pick.endpoints[0];
    return { validatorId: pick.validatorId, url: ep.url, tlsKeyHash: ep.tlsKeyHash };
  }
}
