import { keccak_256 } from '@noble/hashes/sha3';
import type { HostEndpointsJSON, RpcSend } from './ddb-resolve';

/** A current finalized route claim, NOT a proof, replica-readiness promise or authenticated endpoint. */
export interface DdbCurrentReadRoute {
  readonly database: string;
  readonly contract: string;
  readonly enabled: boolean;
  readonly private: boolean;
  /** Quantities are canonical hex strings, including when Provider normalized the RPC answer to decimal. */
  readonly block: string;
  readonly blockHash: string;
  readonly stateRoot: string;
  readonly epoch: string;
  readonly manager: string;
  readonly runtimeHash: string;
  readonly version: string;
  readonly groupHash: string;
  /** Complete assignment in ascending validator ID order; never a live-endpoint subset. */
  readonly members: readonly DdbCurrentReadMember[];
}

export interface DdbCurrentReadMember {
  readonly validatorId: number;
  readonly address: string;
}

export interface DdbPrivateReadEndpoint {
  readonly scheme: string;
  readonly url: string;
  readonly tlsKeyHash: string;
}

/** Only public routing information is passed to a policy before it establishes the private channel. */
export interface DdbPrivateReadConnection {
  readonly route: DdbCurrentReadRoute;
  readonly member: DdbCurrentReadMember;
  readonly endpoints: readonly DdbPrivateReadEndpoint[];
}

/**
 * The caller's result of actual endpoint/channel authentication. These assertions are a trust boundary,
 * not cryptographic evidence checked by the SDK. A callback returning these fields, an HTTPS URL, or a
 * tlsKeyHash echoed from JSON does NOT implement or qualify post-quantum transport. The policy must
 * verify the real authenticated handshake and its required PQ confidentiality before returning send.
 */
export interface DdbAuthenticatedReadTransport {
  readonly binding: {
    readonly route: DdbCurrentReadRoute;
    readonly validatorId: number;
    readonly address: string;
    readonly url: string;
    readonly tlsKeyHash: string;
  };
  readonly endpointAuthenticated: true;
  readonly confidentiality: 'post-quantum';
  /** Sends ONLY on the authenticated bound channel; must not redirect, retry or forward to another host. */
  readonly send: RpcSend;
}

/** Supplied by independently trusted application state, never resolver JSON alone. */
export type DdbTrustedReadEndpoint = DdbAuthenticatedReadTransport['binding'];

export interface DdbPrivateReadPolicy {
  /**
   * Authenticate finalized header, active rules, governed manager/runtime and the full assignment from
   * independently trusted state. Also authenticate the directory/member identity binding at that state.
   * Never implement this by trusting the resolver's JSON, a sealed proof, or two agreeing RPC answers.
   */
  verifyAssignment(route: DdbCurrentReadRoute): Promise<boolean>;
  /**
   * Authenticate the selected endpoint against the trusted directory and member identity, then bind a
   * confidential channel to it. No query, procedure args, envelope or signature is supplied here.
   */
  connect(request: DdbPrivateReadConnection): Promise<DdbAuthenticatedReadTransport>;
}

/** Explicit opt-in. There is deliberately no default trusted-state or transport implementation. */
export interface DdbPrivateReadOptions {
  policy?: DdbPrivateReadPolicy;
  /** Current assignment proofs are unsupported; true refuses, without falling back to sealed proofs. */
  withProof?: boolean;
}

const ZERO_ADDRESS = '0x' + '00'.repeat(20);
const ZERO_HASH = '0x' + '00'.repeat(32);

function hex(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw new Error('invalid current route identity');
  }
  return value.toLowerCase();
}

function quantity(value: unknown): string {
  // Provider.send normalizes object hex quantities to exact decimal strings. Do not accept numbers:
  // a JS number may already have rounded a block, epoch or placement version above 2^53.
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    throw new Error('invalid current route quantity');
  }
  const n = BigInt(value);
  if (n > BigInt('18446744073709551615')) throw new Error('current route quantity exceeds uint64');
  return '0x' + n.toString(16);
}

function validateMembers(members: readonly DdbCurrentReadMember[]): void {
  // Existing PlacementManager hard bound, not a new placement policy.
  if (members.length > 64) throw new Error('invalid current route member count');
  let previous = 0;
  for (const member of members) {
    if (!member || !Number.isInteger(member.validatorId) || member.validatorId <= previous || member.validatorId > 0xffffffff) {
      throw new Error('current route members must be strictly sorted nonzero uint32 IDs');
    }
    if (hex(member.address, 20) === ZERO_ADDRESS) throw new Error('invalid current route member address');
    previous = member.validatorId;
  }
}

/** Shape/hash validation only. The returned deep-frozen copy is still an UNTRUSTED claim. */
export function parseDdbCurrentReadRoute(contract: string, value: unknown): DdbCurrentReadRoute {
  const expected = hex(contract, 20);
  const r = value as DdbCurrentReadRoute | undefined;
  if (!r || !Array.isArray(r.members)) throw new Error('the node did not provide a current route');
  if (hex(r.contract, 20) !== expected || r.database !== 'c_' + expected.slice(2)) {
    throw new Error('the current route names another database');
  }
  if (typeof r.enabled !== 'boolean' || typeof r.private !== 'boolean') throw new Error('invalid current route activation');
  validateMembers(r.members);
  const members = Object.freeze(r.members.map(m => Object.freeze({ validatorId: m.validatorId, address: hex(m.address, 20) })));
  const groupHash = hex(r.groupHash, 32);
  if (members.length > 0) {
    const packed = new Uint8Array(members.length * 32);
    const view = new DataView(packed.buffer);
    members.forEach((m, i) => view.setUint32(i * 32 + 28, m.validatorId));
    if ('0x' + Buffer.from(keccak_256(packed)).toString('hex') !== groupHash) {
      throw new Error('current route members do not match group hash');
    }
  } else if (groupHash !== ZERO_HASH) {
    throw new Error('empty current route has a group hash');
  }
  return Object.freeze({
    contract: expected, database: r.database, enabled: r.enabled, private: r.private,
    block: quantity(r.block), blockHash: hex(r.blockHash, 32), stateRoot: hex(r.stateRoot, 32),
    epoch: quantity(r.epoch), manager: hex(r.manager, 20), runtimeHash: hex(r.runtimeHash, 32),
    version: quantity(r.version), groupHash, members,
  });
}

/** Node-compatible home: u64be(signedHash[0:8]) modulo the COMPLETE sorted assignment size. */
export function ddbSignedReadHome(signedHash: Uint8Array, members: readonly DdbCurrentReadMember[]): DdbCurrentReadMember {
  validateMembers(members);
  if (signedHash.length !== 32 || members.length === 0) throw new Error('signed read needs a hash and a nonempty current group');
  let n = BigInt(0);
  for (const byte of signedHash.slice(0, 8)) n = n * BigInt(256) + BigInt(byte);
  return members[Number(n % BigInt(members.length))];
}

/** Validate opt-in before even signing; the policy is trusted caller code, never supplied by the resolver. */
export function validateDdbPrivateReadOptions(options: DdbPrivateReadOptions): DdbPrivateReadPolicy {
  if (options.withProof) throw new Error('unsupported-current-proof: current assignment proofs are not available');
  if (!options.policy || typeof options.policy.verifyAssignment !== 'function' || typeof options.policy.connect !== 'function') {
    throw new Error('private reads require a trusted assignment and authenticated transport policy');
  }
  return options.policy;
}

interface CurrentResolver {
  resolveCurrent(contract: string): Promise<DdbCurrentReadRoute>;
  hostEndpoints(validatorIds?: number[]): Promise<HostEndpointsJSON[]>;
}

/** Actual dispatch used by both signed data methods; no legacy provider fallback exists in this path. */
export async function sendDdbPrivateRead(
  resolver: CurrentResolver, options: DdbPrivateReadOptions, database: string, signedHash: Uint8Array,
  method: 'ddb_signedSelect' | 'ddb_signedCallReadProcedure', params: any[],
): Promise<any> {
  const policy = validateDdbPrivateReadOptions(options);
  if (!/^c_[0-9a-f]{40}$/.test(database)) throw new Error('private reads require a canonical contract database');
  const contract = '0x' + database.slice(2);
  for (let attempt = 0; attempt < 2; attempt++) {
    const route = await resolver.resolveCurrent(contract);
    if (!route.enabled || !route.private || route.members.length === 0 || route.manager === ZERO_ADDRESS ||
        route.runtimeHash === ZERO_HASH || route.blockHash === ZERO_HASH || route.stateRoot === ZERO_HASH || route.version === '0x0') {
      throw new Error('private current route is inactive or unavailable');
    }
    if (await policy.verifyAssignment(route) !== true) throw new Error('private route assignment is not trusted');
    const member = ddbSignedReadHome(signedHash, route.members);
    const hosts = await resolver.hostEndpoints([member.validatorId]);
    const matching = Array.isArray(hosts) ? hosts.filter(h => h?.validatorId === member.validatorId && h.live === true) : [];
    if (matching.length !== 1 || !Array.isArray(matching[0].endpoints) || matching[0].endpoints.length === 0) {
      throw new Error('private read home has no live endpoint');
    }
    const endpoints = Object.freeze(matching[0].endpoints.map(e => {
      if (!e || typeof e.scheme !== 'string' || !e.scheme || typeof e.url !== 'string' || !e.url) {
        throw new Error('invalid private read home endpoint');
      }
      return Object.freeze({ scheme: e.scheme, url: e.url, tlsKeyHash: hex(e.tlsKeyHash, 32) });
    }));
    const transport = await policy.connect(Object.freeze({ route, member, endpoints }));
    let bound = false;
    try {
      const b = transport?.binding;
      bound = !!b && transport.endpointAuthenticated === true && transport.confidentiality === 'post-quantum' &&
        typeof transport.send === 'function' && b.validatorId === member.validatorId && hex(b.address, 20) === member.address &&
        endpoints.some(e => e.url === b.url && e.tlsKeyHash === hex(b.tlsKeyHash, 32)) &&
        JSON.stringify(parseDdbCurrentReadRoute(contract, b.route)) === JSON.stringify(route);
    } catch { /* Unverifiable binding is a refusal, never a default transport. */ }
    if (!bound) throw new Error('private read transport is not authenticated and bound to the selected assignment/endpoint');
    try {
      return await transport.send(method, params);
    } catch (e) {
      const error = e as { code?: number; data?: { reason?: string; preService?: boolean; home?: number } };
      // Only a structured refusal from the selected authenticated channel guarantees no service.
      // Network errors and post-service route changes never resend this envelope to another host.
      if (attempt === 0 && error?.code === -32063 && error.data?.reason === 'stale_route' && error.data.preService === true) continue;
      throw e;
    }
  }
  throw new Error('private route refresh exhausted');
}
