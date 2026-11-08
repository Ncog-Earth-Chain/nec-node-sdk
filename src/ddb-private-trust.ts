import { buildDdbSignedReadProcedure, type DdbSigner } from './ddb';
import { parseDdbCurrentReadRoute, type DdbPrivateReadPolicy, type DdbCurrentReadRoute, type DdbPrivateReadConnection, type DdbTrustedReadEndpoint, type DdbAuthenticatedReadTransport } from './ddb-private-read';
import { decodePrivateTxnBaseV1, encodePrivateTxnBaseV1, encodePrivateTxnIntentV1, type PrivateTxnBaseV1 } from './ddb-private-txn';
import type { DdbPrivatePreparedSnapshotRequest } from './ddb-private-txn-online';
import type { DdbPrivateTxnExpectation, DdbPrivateTxnFinalityCandidate } from './ddb-private-txn-outcome';
import { parsePrivateCustodyEndpoint, ownPrivateCustodyBinding, type DdbPrivateCustodyBinding,
  type DdbPrivateCustodyPolicy, type DdbAuthenticatedCustodyTransport } from './ddb-private-custody';
import { MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES } from './key-registry';
import { DDB_COMMITMENT_PAYLOAD_MAX_BYTES } from './ddb-commitment';
import { evidenceHex as hex, evidenceFail as fail, evidenceObject as obj, evidenceFixed as fixed, evidenceBytes as bytes,
  evidenceRecipient, evidenceOrigin, evidenceMemberBound, evidenceBlock, evidenceRoute, samePrivateRoute, ownPrivateAuthority,
  parsePrivateAssignment, parsePrivateFinality, type DdbPrivateAuthority, type DdbPrivateEvidenceSource } from './ddb-private-evidence';

const METHODS = Object.freeze(['ddb_getPrivateAssignmentEvidence', 'ddb_getPrivateTransactionSnapshotEvidence', 'ddb_getPrivateTransactionFinalityEvidence']);
const SELECTORS = Object.freeze(['@ddb/private-assignment-evidence/v1', '@ddb/private-txn-snapshot-evidence/v1', '@ddb/private-txn-finality-evidence/v1']);

/** A concrete authenticated source channel. Binding fields are consistency checks, not TLS attestation. */
export interface DdbPrivateEvidenceChannel {
  readonly binding: DdbPrivateEvidenceSource;
  send(method: string, params: readonly unknown[]): Promise<unknown>;
  close(): void;
}
export interface DdbPrivateHostChannel extends DdbAuthenticatedReadTransport {
  close(): void;
}
export interface DdbTrustedPrivateOptions extends DdbPrivateAuthority {
  signer: DdbSigner;
  /** Authenticate this exact explicit source before returning; no default/discovered source. */
  connectEvidence(source: DdbPrivateEvidenceSource): Promise<DdbPrivateEvidenceChannel>;
  /** Authenticate the independently observed full binding on the channel used by send. */
  connectHost(connection: DdbPrivateReadConnection, independentlyTrustedBinding: DdbTrustedReadEndpoint): Promise<DdbPrivateHostChannel>;
  /** Optional concrete retained-outcome channel; generic browser/mobile callers must supply one explicitly. */
  connectCustodyHost?(independentlyTrustedBinding: DdbPrivateCustodyBinding): Promise<DdbAuthenticatedCustodyTransport>;
}
function matchesBase(route: DdbCurrentReadRoute, base: PrivateTxnBaseV1): boolean {
  return route.database === base.database && route.contract === base.contract && route.block === '0x' + base.block.toString(16) &&
    route.blockHash === base.block_hash && route.stateRoot === base.state_root && route.epoch === '0x' + base.epoch.toString(16) &&
    route.manager === base.manager && route.runtimeHash === base.manager_runtime && route.version === '0x' + base.placement_version.toString(16) && route.groupHash === base.group_hash;
}
function ownExpectation(input: DdbPrivateTxnExpectation, scope: DdbPrivateAuthority): DdbPrivateTxnExpectation {
  if (input.chain !== scope.chain || input.database !== scope.database || input.caller !== scope.caller) return fail();
  const txnId = fixed(input.txnId, 32), base = decodePrivateTxnBaseV1(encodePrivateTxnBaseV1(input.base));
  if (base.chain !== scope.chain || base.database !== scope.database || base.caller !== scope.caller || !Array.isArray(input.operationHashes) ||
    input.operationHashes.length < 1 || input.operationHashes.length > 4 || !Array.isArray(input.payloadCommitments) || input.payloadCommitments.length !== input.operationHashes.length) return fail();
  return { chain: scope.chain, database: scope.database, caller: scope.caller, txnId, base,
    operationHashes: Array.from(input.operationHashes, h => fixed(h, 32)), payloadCommitments: Array.from(input.payloadCommitments, h => fixed(h, 32)) };
}

/** Explicit full-node trust over concrete caller-supplied channels, not light-client verification.
 * Supplying callbacks alone does not implement browser/mobile transport or prove a TLS handshake.
 */
export function createDdbTrustedPrivatePolicy(input: DdbTrustedPrivateOptions) {
  const authority = ownPrivateAuthority(input);
  if (typeof input.connectEvidence !== 'function' || typeof input.connectHost !== 'function') return fail();
  const connectEvidence = input.connectEvidence.bind(input), connectHost = input.connectHost.bind(input);
  if (input.connectCustodyHost !== undefined && typeof input.connectCustodyHost !== 'function') return fail();
  const connectCustodyHost = input.connectCustodyHost?.bind(input);
  const signer = input.signer;
  if (!signer || typeof signer.getAddress !== 'function' || typeof signer.getPublicKey !== 'function' || typeof signer.signDdbHash !== 'function') return fail();
  const getAddress = signer.getAddress.bind(signer), getPublicKey = signer.getPublicKey.bind(signer), sign = signer.signDdbHash.bind(signer);
  async function read(index: number, args: readonly string[]): Promise<unknown> {
    const captured = Array.from(args); let close: (() => void) | undefined;
    try {
      const channel = await connectEvidence(authority.source);
      if (typeof channel?.close === 'function') close = channel.close.bind(channel);
      const binding = obj(channel?.binding, ['validatorId', 'address', 'url', 'tlsKeyHash']);
      if (binding.validatorId !== authority.source.validatorId || binding.address !== authority.source.address ||
        binding.url !== authority.source.url || binding.tlsKeyHash !== authority.source.tlsKeyHash) return fail();
      if (typeof channel.send !== 'function' || typeof channel.close !== 'function') return fail();
      const send = channel.send.bind(channel);
      const address = await getAddress(), pub = await getPublicKey();
      if (typeof address !== 'string' || address.toLowerCase() !== authority.caller || !(pub instanceof Uint8Array) || pub.length !== MLDSA87_PUBKEY_BYTES) return fail();
      const prepared = buildDdbSignedReadProcedure(authority.chain, authority.database, SELECTORS[index],
        [String(authority.source.validatorId), ...captured], authority.caller, pub.slice());
      const signature = await sign(prepared.hash.slice());
      if (!(signature instanceof Uint8Array) || signature.length !== MLDSA87_SIG_BYTES) return fail();
      const response = await send(METHODS[index], [{ ...prepared.envelope, callerSig: hex(signature) }]);
      const encoded = JSON.stringify(response);
      if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > 4 * DDB_COMMITMENT_PAYLOAD_MAX_BYTES) return fail();
      return response;
    } catch { return fail(); } finally { try { close?.(); } catch { /* No adapter text disclosure. */ } }
  }
  const assignment = async (at: 'current' | string) => parsePrivateAssignment(await read(0, [at]), authority, at);
  async function readPublic(method: 'eth_chainId' | 'ddb_hostEndpoints', params: readonly unknown[]): Promise<unknown> {
    let channel: DdbPrivateEvidenceChannel | undefined;
    try {
      channel = await connectEvidence(authority.source);
      const binding = obj(channel?.binding, ['validatorId', 'address', 'url', 'tlsKeyHash']);
      if (binding.validatorId !== authority.source.validatorId || binding.address !== authority.source.address ||
        binding.url !== authority.source.url || binding.tlsKeyHash !== authority.source.tlsKeyHash ||
        typeof channel.send !== 'function' || typeof channel.close !== 'function') return fail();
      const result = await channel.send(method, params);
      const encoded = JSON.stringify(result);
      if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > 65536) return fail();
      return result;
    } catch { return fail(); } finally { try { channel?.close(); } catch { /* No adapter text disclosure. */ } }
  }
  const custodyPolicy: DdbPrivateCustodyPolicy | undefined = connectCustodyHost ? Object.freeze({
    async connect(inputID: number): Promise<DdbAuthenticatedCustodyTransport> {
      let channel: DdbAuthenticatedCustodyTransport | undefined;
      try {
        const validatorId = evidenceRecipient(inputID);
        const chain = await readPublic('eth_chainId', []);
        if (typeof chain !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(chain) || BigInt(chain) !== BigInt(authority.chain)) return fail();
        const trusted = parsePrivateCustodyEndpoint(await readPublic('ddb_hostEndpoints', [[validatorId]]), authority.chain, validatorId, authority.source);
        channel = await connectCustodyHost(trusted);
        const binding = ownPrivateCustodyBinding(channel?.binding);
        if (JSON.stringify(binding) !== JSON.stringify(trusted) || channel.endpointAuthenticated !== true ||
          channel.confidentiality !== 'post-quantum' || typeof channel.send !== 'function' || typeof channel.close !== 'function') return fail();
        return Object.freeze({ ...channel, binding, send: channel.send.bind(channel), close: channel.close.bind(channel) });
      } catch { try { channel?.close(); } catch { /* No adapter text disclosure. */ } return fail(); }
    },
  }) : undefined;
  const policy: DdbPrivateReadPolicy = {
    async verifyAssignment(value) {
      try {
        const route = parseDdbCurrentReadRoute('0x' + authority.database.slice(2), value);
        return samePrivateRoute(route, (await assignment('current')).placement);
      } catch { return false; }
    },
    async connect(request) {
      try {
        const route = parseDdbCurrentReadRoute('0x' + authority.database.slice(2), request.route);
        const member = Object.freeze({ validatorId: evidenceRecipient(request.member.validatorId), address: fixed(request.member.address, 20) });
        if (!Array.isArray(request.endpoints) || request.endpoints.length < 1 || request.endpoints.length > 4) return fail();
        const endpoints = Object.freeze(Array.from(request.endpoints, e => Object.freeze({ scheme: e.scheme,
          url: evidenceOrigin(e.url, ['https', 'wss', 'http']), tlsKeyHash: fixed(e.tlsKeyHash, 32, e.scheme !== 'http') })));
        const evidence = await assignment('current');
        if (!samePrivateRoute(route, evidence.placement)) return fail();
        const host = evidence.hosts.find(h => h.validatorId === member.validatorId && h.address === member.address);
        if (!host || !host.live || host.expiry <= BigInt(Math.floor(Date.now() / 1000))) return fail();
        const endpoint = endpoints.find(e => e.scheme === 'https' && host.endpoints.some(h => h.scheme === e.scheme && h.url === e.url && h.tlsKeyHash === e.tlsKeyHash));
        if (!endpoint) return fail();
        const trusted = Object.freeze({ route, ...member, url: endpoint.url, tlsKeyHash: endpoint.tlsKeyHash });
        const channel = await connectHost(Object.freeze({ route, member, endpoints }), trusted);
        try {
          const bound = channel?.binding;
          if (!bound || channel.endpointAuthenticated !== true || channel.confidentiality !== 'post-quantum' ||
            typeof channel.send !== 'function' || typeof channel.close !== 'function' ||
            bound.validatorId !== trusted.validatorId || bound.address !== trusted.address || bound.url !== trusted.url ||
            bound.tlsKeyHash !== trusted.tlsKeyHash || !samePrivateRoute(parseDdbCurrentReadRoute(route.contract, bound.route), route) ||
            host.expiry <= BigInt(Math.floor(Date.now() / 1000))) return fail();
          return Object.freeze({ ...channel, binding: trusted, endpointAuthenticated: true as const, confidentiality: 'post-quantum' as const,
            send: channel.send.bind(channel), close: channel.close.bind(channel) });
        } catch { try { channel?.close(); } catch { /* No adapter text disclosure. */ } return fail(); }
      } catch { return fail(); }
    },
  };
  async function acceptPreparedSnapshot(request: DdbPrivatePreparedSnapshotRequest) {
    try {
      const maxMembers = request.maxMembers;
      if (!Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > 4 || !Array.isArray(request.previewMembers) ||
        request.previewMembers.length < 1 || request.previewMembers.length > maxMembers || !Array.isArray(request.localIntents) || request.localIntents.length !== request.previewMembers.length) return fail();
      const base = decodePrivateTxnBaseV1(encodePrivateTxnBaseV1(request.previewMembers[0].base));
      if (base.chain !== authority.chain || base.database !== authority.database || base.caller !== authority.caller) return fail();
      const baseHex = hex(encodePrivateTxnBaseV1(base)), intents = Array.from(request.localIntents, i => hex(encodePrivateTxnIntentV1(i)));
      Array.from(request.previewMembers, (m, i) => {
        if (hex(encodePrivateTxnBaseV1(m.base)) !== baseHex || hex(encodePrivateTxnIntentV1(m.intent)) !== intents[i]) return fail();
      });
      const recipient = { validatorId: evidenceRecipient(request.recipient.validatorId), address: fixed(request.recipient.address, 20) };
      const response = obj(await read(1, [baseHex, ...intents]), ['base', 'placement', 'maxMembers']);
      const sourceBase = decodePrivateTxnBaseV1(bytes(response.base));
      const placement = evidenceRoute(authority.database, response.placement);
      if (hex(encodePrivateTxnBaseV1(sourceBase)) !== baseHex || evidenceMemberBound(response.maxMembers) !== maxMembers ||
        !matchesBase(placement, sourceBase) || !placement.members.some(m => m.validatorId === recipient.validatorId && m.address === recipient.address)) return fail();
      return { expectedBase: sourceBase, completePlacement: placement };
    } catch { return fail(); }
  }
  async function verifyHistoricalPlacement(value: DdbCurrentReadRoute, inputExpected: DdbPrivateTxnExpectation): Promise<boolean> {
    try {
      const expected = ownExpectation(inputExpected, authority), placement = parseDdbCurrentReadRoute('0x' + authority.database.slice(2), value);
      const at = '0x' + expected.base.block.toString(16); evidenceBlock(at);
      return matchesBase(placement, expected.base) && samePrivateRoute(placement, (await assignment(at)).placement);
    } catch { return false; }
  }
  async function verifyFinality(inputExpected: DdbPrivateTxnExpectation, inputCandidate: DdbPrivateTxnFinalityCandidate): Promise<boolean> {
    try {
      const expected = ownExpectation(inputExpected, authority), candidate = { ...inputCandidate };
      if (typeof candidate.block !== 'bigint') return false;
      const block = '0x' + candidate.block.toString(16); evidenceBlock(block); const commit = fixed(candidate.commitTx, 32);
      const actual = parsePrivateFinality(await read(2, [block, commit]));
      const fields: (keyof DdbPrivateTxnFinalityCandidate)[] = ['chain', 'database', 'caller', 'txnId', 'commitTx', 'block', 'blockHash',
        'placementVersion', 'groupHash', 'groupJournalHash', 'digestVersion', 'digestFingerprint', 'initialAnchor', 'finalAnchor', 'memberCount'];
      if (fields.some(k => actual[k] !== candidate[k]) || actual.chain !== expected.chain || actual.database !== expected.database ||
        actual.caller !== expected.caller || actual.txnId !== expected.txnId || actual.readVersion !== expected.base.block ||
        actual.memberCount !== BigInt(expected.operationHashes.length) || actual.placementVersion !== expected.base.placement_version ||
        actual.groupHash !== expected.base.group_hash || actual.digestVersion !== expected.base.digest_version ||
        actual.digestFingerprint !== expected.base.digest_fingerprint || actual.initialAnchor !== expected.base.initial_anchor) return false;
      if (actual.operationHashes.some((h, i) => h !== expected.operationHashes[i])) return false;
      if (actual.payloadCommitments.some((h, i) => h !== expected.payloadCommitments[i])) return false;
      return true;
    } catch { return false; }
  }
  return Object.freeze({ trust: 'trusted-validating-node' as const, authority, policy: Object.freeze(policy), custodyPolicy,
    readCurrentAssignment: () => assignment('current'), acceptPreparedSnapshot, verifyHistoricalPlacement, verifyFinality });
}
