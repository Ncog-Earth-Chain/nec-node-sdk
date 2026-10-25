import { verifyRegistryProof, type RegistryProofJSON, type ServedProvider } from './ddb-proof';

/**
 * PLACE-02 phase B/C client side (NEC-93; docs/design/place-02-provider-discovery.md §5, §6 "SDK and wallet
 * routing"; owner ruling 35: Q1 (a) proof check + two-node cross-check).
 *
 * `DdbResolver.resolve(contract)` answers which host group serves a contract's database:
 *
 *   1. `ddb_resolveDatabase` at the configured node (any node answers, DDB or not), cached per contract and keyed
 *      on the sealed EPOCH: a cached answer is served only while the chain's current epoch is the answer's, and the
 *      next seal (the epoch moving) is the whole invalidation (§5) -- never an answer across a seal;
 *   2. with `withProof`, every member's provider record is verified against the stateRoot of the header of
 *      `rootBlock` fetched from `headerSource` (the node the USER trusts for headers; ddb-proof.ts);
 *   3. with `crossCheck`, a second node's answer must agree on the epoch, the sealed root, the sealed consenting set
 *      and the host group (those are node-asserted, Q2 (a): agreement is the check);
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
}

export interface ResolveResult {
  /** True when the node has no resolver (-32601): use the configured node for everything. */
  fallback: boolean;
  resolved?: ResolvedDatabase;
  /** Whether the record proofs were verified (withProof). */
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

  /** The chain's current epoch (the epoch of the latest block). */
  async currentEpoch(): Promise<number> {
    const b = await this.send('eth_getBlockByNumber', ['latest', false]);
    if (!b || b.epoch === undefined) throw new Error('the node did not report the latest block epoch');
    return num(b.epoch);
  }

  /** Resolve the host group of a contract's database (cached per sealed epoch). */
  async resolve(contract: string): Promise<ResolveResult> {
    const key = contract.toLowerCase();
    const epoch = await this.currentEpoch();
    const hit = this.cache.get(key);
    if (hit?.resolved && hit.resolved.epoch === epoch) return hit;

    let answer: ResolvedDatabase;
    try {
      answer = await this.send('ddb_resolveDatabase', this.opts.withProof ? [contract, { withProof: true }] : [contract]);
    } catch (e) {
      if (isMethodNotFound(e)) return { fallback: true };
      throw e;
    }
    let proven = false;
    if (this.opts.withProof) {
      const hs = this.opts.headerSource ?? this.send;
      const header = await hs('eth_getBlockByNumber', ['0x' + answer.rootBlock.toString(16), false]);
      if (!header || String(header.stateRoot).toLowerCase() !== answer.stateRoot.toLowerCase()) {
        throw new Error(`the trusted header of rootBlock ${answer.rootBlock} does not carry the answer's stateRoot`);
      }
      const served = answer.hostGroup.members.filter((m) => m.provider).map((m) => m.provider as ServedProvider);
      const v = verifyRegistryProof(header.stateRoot, answer.registry, answer.proof, served);
      if (!v.valid) throw new Error(`the resolver's record proof does not verify: ${v.reason}`);
      proven = true;
    }
    if (this.opts.crossCheck) {
      const other: ResolvedDatabase = await this.opts.crossCheck('ddb_resolveDatabase', [contract]);
      const shape = (r: ResolvedDatabase) => JSON.stringify({
        epoch: r.epoch, stateRoot: r.stateRoot.toLowerCase(), sealed: r.sealedConsenting,
        members: r.hostGroup.members.map((m) => [m.address.toLowerCase(), m.validatorId]), minSigners: r.hostGroup.minSigners,
      });
      if (shape(other) !== shape(answer)) {
        throw new Error('the two nodes disagree on the sealed host group; refusing to route (Q1 (a) cross-check)');
      }
    }
    const res: ResolveResult = { fallback: false, resolved: answer, proven };
    // Cached only for the epoch it describes: if the chain already moved past it, it is not kept.
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
    const members = new Set(resolved.hostGroup.members.map((m) => m.validatorId));
    const live = endpoints
      .filter((h) => members.has(h.validatorId) && h.live && h.endpoints.length > 0)
      .sort((a, b) => a.validatorId - b.validatorId);
    const pick = live.find((h) => h.validatorId === preferValidatorId) ?? live[0];
    if (!pick) return null;
    const ep = pick.endpoints[0];
    return { validatorId: pick.validatorId, url: ep.url, tlsKeyHash: ep.tlsKeyHash };
  }
}
