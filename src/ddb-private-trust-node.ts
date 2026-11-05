import { buildDdbSignedReadProcedure, type DdbSigner } from './ddb';
import { openPrivateNodeChannel } from './ddb-private-channel-node';
import { connectDdbNodePrivateRead, type DdbNodePrivateReadTransportOptions } from './ddb-private-read-node';
import { parseDdbCurrentReadRoute, type DdbPrivateReadPolicy, type DdbCurrentReadRoute } from './ddb-private-read';
import { decodePrivateTxnBaseV1, encodePrivateTxnBaseV1, encodePrivateTxnIntentV1, type PrivateTxnBaseV1 } from './ddb-private-txn';
import type { DdbPrivatePreparedSnapshotRequest } from './ddb-private-txn-online';
import type { DdbPrivateTxnExpectation, DdbPrivateTxnFinalityCandidate } from './ddb-private-txn-outcome';
import { MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES } from './key-registry';
import { DDB_COMMITMENT_PAYLOAD_MAX_BYTES } from './ddb-commitment';
import { evidenceHex as hex, evidenceFail as fail, evidenceObject as obj, evidenceFixed as fixed, evidenceBytes as bytes,
  evidenceRecipient, evidenceOrigin, evidenceMemberBound, evidenceBlock, evidenceRoute, samePrivateRoute, ownPrivateAuthority,
  parsePrivateAssignment, parsePrivateFinality, type DdbPrivateAuthority, type DdbPrivateEvidenceSource } from './ddb-private-evidence';

const METHODS = Object.freeze(['ddb_getPrivateAssignmentEvidence', 'ddb_getPrivateTransactionSnapshotEvidence', 'ddb_getPrivateTransactionFinalityEvidence']);
const SELECTORS = Object.freeze(['@ddb/private-assignment-evidence/v1', '@ddb/private-txn-snapshot-evidence/v1', '@ddb/private-txn-finality-evidence/v1']);

/** Authenticate the explicitly configured source directly. No route discovery or policy recursion. */
export async function connectDdbNodePrivateEvidence(source: DdbPrivateEvidenceSource, options: DdbNodePrivateReadTransportOptions = {}) {
  const s = obj(source, ['validatorId', 'address', 'url', 'tlsKeyHash']);
  const binding = Object.freeze({ validatorId: evidenceRecipient(s.validatorId), address: fixed(s.address, 20),
    url: evidenceOrigin(s.url), tlsKeyHash: fixed(s.tlsKeyHash, 32) });
  const channel = await openPrivateNodeChannel(binding.url, binding.tlsKeyHash, METHODS, options);
  return Object.freeze({ ...channel, binding });
}

export interface DdbTrustedNodePrivateOptions extends DdbPrivateAuthority {
  signer: DdbSigner;
  sourceTls?: DdbNodePrivateReadTransportOptions;
  hostTls?: DdbNodePrivateReadTransportOptions;
}
function optionsCopy(options: DdbNodePrivateReadTransportOptions = {}): DdbNodePrivateReadTransportOptions {
  const ca = Array.isArray(options.ca) ? options.ca.map(v => typeof v === 'string' ? v : Buffer.from(v)) :
    typeof options.ca === 'string' || options.ca === undefined ? options.ca : Buffer.from(options.ca as Buffer);
  return Object.freeze({ ca, timeoutMs: options.timeoutMs, maxRequestBytes: options.maxRequestBytes, maxResponseBytes: options.maxResponseBytes });
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

/** Explicit full-node trust. This factory performs real authenticated evidence reads, not light-client verification. */
export function createDdbTrustedNodePrivatePolicy(input: DdbTrustedNodePrivateOptions) {
  const authority = ownPrivateAuthority(input), sourceTls = optionsCopy(input.sourceTls), hostTls = optionsCopy(input.hostTls);
  const signer = input.signer;
  if (!signer || typeof signer.getAddress !== 'function' || typeof signer.getPublicKey !== 'function' || typeof signer.signDdbHash !== 'function') return fail();
  const getAddress = signer.getAddress.bind(signer), getPublicKey = signer.getPublicKey.bind(signer), sign = signer.signDdbHash.bind(signer);
  async function read(index: number, args: readonly string[]): Promise<unknown> {
    const captured = Array.from(args); let channel: Awaited<ReturnType<typeof connectDdbNodePrivateEvidence>> | undefined;
    try {
      channel = await connectDdbNodePrivateEvidence(authority.source, sourceTls);
      const address = await getAddress(), pub = await getPublicKey();
      if (typeof address !== 'string' || address.toLowerCase() !== authority.caller || !(pub instanceof Uint8Array) || pub.length !== MLDSA87_PUBKEY_BYTES) return fail();
      const prepared = buildDdbSignedReadProcedure(authority.chain, authority.database, SELECTORS[index],
        [String(authority.source.validatorId), ...captured], authority.caller, pub.slice());
      const signature = await sign(prepared.hash.slice());
      if (!(signature instanceof Uint8Array) || signature.length !== MLDSA87_SIG_BYTES) return fail();
      const response = await channel.send(METHODS[index], [{ ...prepared.envelope, callerSig: hex(signature) }]);
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 4 * DDB_COMMITMENT_PAYLOAD_MAX_BYTES) return fail();
      return response;
    } catch { return fail(); } finally { try { channel?.close(); } catch { /* No adapter text disclosure. */ } }
  }
  const assignment = async (at: 'current' | string) => parsePrivateAssignment(await read(0, [at]), authority, at);
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
        const member = { validatorId: evidenceRecipient(request.member.validatorId), address: fixed(request.member.address, 20) };
        if (!Array.isArray(request.endpoints) || request.endpoints.length < 1 || request.endpoints.length > 4) return fail();
        const endpoints = Array.from(request.endpoints, e => ({ scheme: e.scheme,
          url: evidenceOrigin(e.url, ['https', 'wss', 'http']), tlsKeyHash: fixed(e.tlsKeyHash, 32, e.scheme !== 'http') }));
        const evidence = await assignment('current');
        if (!samePrivateRoute(route, evidence.placement)) return fail();
        const host = evidence.hosts.find(h => h.validatorId === member.validatorId && h.address === member.address);
        if (!host || !host.live || host.expiry <= BigInt(Math.floor(Date.now() / 1000))) return fail();
        const endpoint = endpoints.find(e => e.scheme === 'https' && host.endpoints.some(h => h.scheme === e.scheme && h.url === e.url && h.tlsKeyHash === e.tlsKeyHash));
        if (!endpoint) return fail();
        const channel = await connectDdbNodePrivateRead({ route, member, endpoints }, { route, ...member, url: endpoint.url, tlsKeyHash: endpoint.tlsKeyHash }, hostTls);
        if (host.expiry <= BigInt(Math.floor(Date.now() / 1000))) { channel.close(); return fail(); }
        return channel;
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
  return Object.freeze({ trust: 'trusted-validating-node' as const, authority, policy: Object.freeze(policy),
    readCurrentAssignment: () => assignment('current'), acceptPreparedSnapshot, verifyHistoricalPlacement, verifyFinality });
}
