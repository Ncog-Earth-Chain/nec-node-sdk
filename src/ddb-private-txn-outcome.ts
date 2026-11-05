import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  buildDdbSignedReadProcedure, canonicalDdbTxnId, canonicalDdbTxnMemberHash, DDB_TXN_MAX_OPS,
  type DdbCanonicalOpV2, type DdbSigner,
} from './ddb';
import { ddbPayloadCommitment, decodeDdbCommitmentEnvelope, DDB_COMMITMENT_PAYLOAD_MAX_BYTES } from './ddb-commitment';
import {
  decodePrivateTxnMemberV1, encodePrivateTxnMemberV1,
  type BuiltDdbPrivateTransaction, type PrivateTxnBaseV1, type PrivateTxnMemberV1,
} from './ddb-private-txn';
import {
  parseDdbCurrentReadRoute, type DdbCurrentReadRoute, type DdbPrivateReadPolicy,
  type DdbAuthenticatedReadTransport,
} from './ddb-private-read';
import type { HostEndpointsJSON } from './ddb-resolve';
import { MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES } from './key-registry';

const SELECTOR = '@ddb/private-txn-outcome/v1';
const ZERO_HASH = '0x' + '00'.repeat(32);
const ZERO_ADDRESS = '0x' + '00'.repeat(20);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const hex = (value: Uint8Array) => '0x' + bytesToHex(value);
class OutcomeError extends Error {}
const fail = (message: string): never => { throw new OutcomeError('private transaction outcome: ' + message); };

/** Discovery supplies claims only; it never receives signed reads or private transaction material. */
export interface DdbPrivateTxnOutcomeResolver {
  resolveCurrent(contract: string): Promise<DdbCurrentReadRoute>;
  hostEndpoints(validatorIds?: number[]): Promise<HostEndpointsJSON[]>;
}

export interface DdbPrivateTxnOutcomeReadInput {
  signer: DdbSigner;
  resolver: DdbPrivateTxnOutcomeResolver;
  policy: DdbPrivateReadPolicy;
  /** Exact 32-byte chain word from the locally trusted transaction context. Never inferred from discovery. */
  chain: string;
  database: string;
  caller: string;
  txnId: string;
  /** Explicit null recovers by TXN identity after a lost submit reply; omission is an error. */
  expectedCommitTx: string | null;
  validatorId: number;
  mode: 'status' | 'result';
  /** Captured/governed bound, within the existing four-member hard limit. */
  maxMembers: number;
}

interface LocalIdentity {
  readonly validatorId: number;
  readonly chain: string;
  readonly database: string;
  readonly caller: string;
  readonly txnId: string;
}

/** A candidate claim; only the application's independent verifier can authenticate its finality. */
export interface DdbPrivateTxnFinalityCandidate {
  readonly chain: string;
  readonly database: string;
  readonly caller: string;
  readonly txnId: string;
  readonly commitTx: string;
  readonly block: bigint;
  readonly blockHash: string;
  readonly placementVersion: bigint;
  readonly groupHash: string;
  readonly groupJournalHash: string;
  readonly digestVersion: bigint;
  readonly digestFingerprint: string;
  readonly initialAnchor: string;
  readonly finalAnchor: string;
  readonly memberCount: bigint;
}

export interface DdbPrivateTxnLocalDurable extends LocalIdentity, DdbPrivateTxnFinalityCandidate {
  readonly state: 'local_durable';
  /** Present only in result mode, owned by this return value. No lossy row conversion is performed. */
  readonly payloads?: readonly Uint8Array[];
  readonly members?: readonly PrivateTxnMemberV1[];
}

/** Neither variant is a portable certificate or a selected-host commitment policy. */
export type DdbPrivateTxnLocalOutcome = (LocalIdentity & { readonly state: 'pending' }) | DdbPrivateTxnLocalDurable;

/** Owned copies passed to trusted application code, derived from the retained unit rather than host JSON. */
export interface DdbPrivateTxnExpectation {
  readonly chain: string;
  readonly database: string;
  readonly caller: string;
  readonly txnId: string;
  readonly base: PrivateTxnBaseV1;
  readonly operationHashes: readonly string[];
  readonly payloadCommitments: readonly string[];
}

export interface DdbPrivateTxnCollectionInput extends Omit<DdbPrivateTxnOutcomeReadInput, 'validatorId' | 'mode'> {
  /** Exact offline builder output retained locally before submission. Salts/payloads never leave this client here. */
  retained: BuiltDdbPrivateTransaction;
  /** COMPLETE original placement, not the live/current reachable subset. Shape validation is not authentication. */
  completePlacement: DdbCurrentReadRoute;
  /** Mandatory sorted, unique, nonempty subset. There is deliberately no default or quorum inference. */
  requiredHosts: readonly number[];
  /** Authenticate historical completed header, rules, manager/runtime and full membership against BASE. */
  verifyHistoricalPlacement(placement: DdbCurrentReadRoute, expected: DdbPrivateTxnExpectation): Promise<boolean>;
  /**
   * Authenticate actual canonical completed, non-skipped inclusion of this exact commit and complete DB01
   * unit (TXN ID and ordered operation hashes), plus historical group/journal/digest and roots. A header,
   * ordinary RPC receipt or matching host claims is insufficient. This is caller trust, NOT an SDK light client.
   */
  verifyFinality(expected: DdbPrivateTxnExpectation, candidate: DdbPrivateTxnFinalityCandidate): Promise<boolean>;
}

export interface DdbPrivateTxnHostDisposition {
  readonly validatorId: number;
  readonly state: 'pending' | 'local_durable' | 'unavailable';
}

export type DdbPrivateTxnCollection = {
  readonly state: 'pending';
  readonly committed: false;
  readonly reason: 'historical_placement_unverified' | 'awaiting_hosts' | 'disagreement' | 'finality_unverified';
  readonly requiredHosts: readonly number[];
  readonly hosts: readonly DdbPrivateTxnHostDisposition[];
} | (DdbPrivateTxnFinalityCandidate & {
  readonly state: 'committed';
  readonly committed: true;
  readonly requiredHosts: readonly number[];
  readonly durableHosts: readonly number[];
  readonly finality: { readonly finalized: true; readonly blockNumber: string; readonly blockHash: string };
  readonly readToken: string;
  readonly payloads: readonly Uint8Array[];
  readonly members: readonly PrivateTxnMemberV1[];
});

function fixedHex(value: unknown, bytes: number, nonzero = false): string {
  if (typeof value !== 'string' || value.length !== 2 + bytes * 2 || !/^0x[0-9a-f]+$/.test(value) ||
      (nonzero && /^0x0+$/.test(value))) return fail('invalid canonical hex identity');
  return value;
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 18 || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
    return fail('invalid canonical uint64 quantity');
  }
  const n = BigInt(value);
  if (n > U64_MAX) return fail('quantity exceeds uint64');
  return n;
}

function bytes(value: unknown, max: number, exact?: number): Uint8Array {
  if (typeof value !== 'string' || value.length < 4 || value.length > 2 + 2 * max ||
      value.length % 2 !== 0 || !/^0x[0-9a-f]+$/.test(value) || (exact !== undefined && value.length !== 2 + 2 * exact)) {
    return fail('invalid bounded canonical bytes');
  }
  return hexToBytes(value.slice(2));
}

function object(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid object');
  const r = value as Record<string, any>;
  if (Object.keys(r).some(k => !allowed.includes(k)) || required.some(k => !Object.prototype.hasOwnProperty.call(r, k))) {
    return fail('unexpected or missing field');
  }
  return r;
}

function memberBound(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > DDB_TXN_MAX_OPS) return fail('invalid captured member bound');
  return value;
}

function recipient(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 0xffffffff) return fail('invalid recipient');
  return value;
}

// Capture functions as well as values before the first await. Later caller mutation must not change policy.
function snapshotRead(input: DdbPrivateTxnOutcomeReadInput): DdbPrivateTxnOutcomeReadInput {
  const chain = fixedHex(input.chain, 32, true);
  const caller = fixedHex(input.caller, 20, true);
  const txnId = fixedHex(input.txnId, 32, true);
  const expectedCommitTx = input.expectedCommitTx === null ? null : fixedHex(input.expectedCommitTx, 32, true);
  const database = input.database;
  if (typeof database !== 'string' || !/^c_[0-9a-f]{40}$/.test(database) || database === 'c_' + ZERO_ADDRESS.slice(2)) return fail('invalid canonical database');
  const validatorId = recipient(input.validatorId);
  const maxMembers = memberBound(input.maxMembers);
  const mode = input.mode;
  if (mode !== 'status' && mode !== 'result') return fail('invalid read mode');
  const { signer, resolver, policy } = input;
  if (!signer || typeof signer.getAddress !== 'function' || typeof signer.getPublicKey !== 'function' || typeof signer.signDdbHash !== 'function' ||
      !resolver || typeof resolver.resolveCurrent !== 'function' || typeof resolver.hostEndpoints !== 'function' ||
      !policy || typeof policy.verifyAssignment !== 'function' || typeof policy.connect !== 'function') return fail('signer, discovery and trusted policy required');
  return { chain, caller, txnId, database, expectedCommitTx, validatorId, maxMembers, mode,
    signer: { getAddress: signer.getAddress.bind(signer), getPublicKey: signer.getPublicKey.bind(signer), signDdbHash: signer.signDdbHash.bind(signer) },
    resolver: { resolveCurrent: resolver.resolveCurrent.bind(resolver), hostEndpoints: resolver.hostEndpoints.bind(resolver) },
    policy: { verifyAssignment: policy.verifyAssignment.bind(policy), connect: policy.connect.bind(policy) } };
}

function activeRoute(contract: string, value: unknown): DdbCurrentReadRoute {
  const route = parseDdbCurrentReadRoute(contract, value);
  if (!route.enabled || !route.private || route.members.length === 0 || route.manager === ZERO_ADDRESS ||
      route.runtimeHash === ZERO_HASH || route.blockHash === ZERO_HASH || route.stateRoot === ZERO_HASH || route.version === '0x0') {
    return fail('private assignment unavailable');
  }
  return route;
}

function closeTransport(transport: DdbAuthenticatedReadTransport | undefined): void {
  const close = (transport as { close?: () => void } | undefined)?.close;
  if (typeof close === 'function') { try { close.call(transport); } catch { /* Best-effort release; never replace a safe result with endpoint text. */ } }
}

async function readCaptured(input: DdbPrivateTxnOutcomeReadInput, historicalAddress?: string): Promise<DdbPrivateTxnLocalOutcome> {
  let transport: DdbAuthenticatedReadTransport | undefined;
  try {
    const contract = '0x' + input.database.slice(2);
    const route = activeRoute(contract, await input.resolver.resolveCurrent(contract));
    if (await input.policy.verifyAssignment(route) !== true) return fail('current assignment is not trusted');
    const member = route.members.find(m => m.validatorId === input.validatorId);
    if (!member || (historicalAddress !== undefined && member.address !== historicalAddress)) return fail('required recipient is not currently assigned');
    const hosts = await input.resolver.hostEndpoints([member.validatorId]);
    if (!Array.isArray(hosts) || hosts.length > 64) return fail('invalid endpoint discovery');
    const matching = hosts.filter(h => h?.validatorId === member.validatorId && h.live === true);
    // EndpointDirectory's existing MAX_ENDPOINTS is four; this is not a new placement policy.
    if (matching.length !== 1 || !Array.isArray(matching[0].endpoints) || matching[0].endpoints.length < 1 || matching[0].endpoints.length > 4) {
      return fail('required recipient endpoint unavailable');
    }
    const endpoints = Object.freeze(matching[0].endpoints.map(e => {
      if (!e || typeof e.scheme !== 'string' || !e.scheme || typeof e.url !== 'string' || !e.url) return fail('invalid endpoint');
      return Object.freeze({ scheme: e.scheme, url: e.url, tlsKeyHash: fixedHex(e.tlsKeyHash, 32, true) });
    }));
    transport = await input.policy.connect(Object.freeze({ route, member, endpoints }));
    let bound = false;
    try {
      const b = transport?.binding;
      bound = !!b && transport.endpointAuthenticated === true && transport.confidentiality === 'post-quantum' &&
        typeof transport.send === 'function' && b.validatorId === member.validatorId && fixedHex(b.address, 20, true) === member.address &&
        endpoints.some(e => e.url === b.url && e.tlsKeyHash === fixedHex(b.tlsKeyHash, 32, true)) &&
        JSON.stringify(parseDdbCurrentReadRoute(contract, b.route)) === JSON.stringify(route);
    } catch { /* Unverifiable channel binding is a refusal, never a generic provider fallback. */ }
    if (!bound) return fail('transport is not authenticated and bound to the addressed assignment/endpoint');
    const send = transport.send.bind(transport);
    const address = await input.signer.getAddress();
    if (typeof address !== 'string' || address.toLowerCase() !== input.caller) return fail('signer differs from expected caller');
    const key = await input.signer.getPublicKey();
    if (!(key instanceof Uint8Array) || key.length !== MLDSA87_PUBKEY_BYTES) return fail('invalid read public key');
    const prepared = buildDdbSignedReadProcedure(input.chain, input.database, SELECTOR,
      [input.txnId, input.expectedCommitTx ?? ZERO_HASH, String(input.validatorId), input.mode], input.caller, key.slice());
    const signature = await input.signer.signDdbHash(prepared.hash.slice());
    if (!(signature instanceof Uint8Array) || signature.length !== MLDSA87_SIG_BYTES) return fail('invalid read signature');
    return parseObservation(await send('ddb_getPrivateTransactionOutcome', [{ ...prepared.envelope, callerSig: hex(signature) }]), input);
  } catch (error) {
    // Do not forward endpoint/signer errors, which may contain SQL, request or result material.
    if (error instanceof OutcomeError) throw error;
    return fail('authenticated read unavailable');
  } finally { closeTransport(transport); }
}

/** One fresh addressed read, never forwarding or replaying an envelope at another host. */
export async function readDdbPrivateTransactionOutcome(input: DdbPrivateTxnOutcomeReadInput): Promise<DdbPrivateTxnLocalOutcome> {
  return readCaptured(snapshotRead(input));
}

const wireFields = ['state', 'validatorId', 'chain', 'database', 'txnId', 'caller', 'commitTx', 'block', 'blockHash',
  'placementVersion', 'groupHash', 'groupJournalHash', 'digestVersion', 'digestFingerprint', 'initialAnchor', 'finalAnchor', 'memberCount'];

function parseObservation(value: unknown, input: DdbPrivateTxnOutcomeReadInput): DdbPrivateTxnLocalOutcome {
  const r = object(value, [...wireFields, 'payloads'], wireFields);
  const identity: LocalIdentity = { validatorId: recipient(r.validatorId), chain: fixedHex(r.chain, 32, true), database: r.database,
    txnId: fixedHex(r.txnId, 32, true), caller: fixedHex(r.caller, 20, true) };
  if (identity.validatorId !== input.validatorId || identity.chain !== input.chain || identity.database !== input.database ||
      identity.txnId !== input.txnId || identity.caller !== input.caller) return fail('local observation identity differs');
  const candidate: DdbPrivateTxnFinalityCandidate = { chain: identity.chain, database: identity.database, txnId: identity.txnId, caller: identity.caller,
    commitTx: fixedHex(r.commitTx, 32), block: quantity(r.block), blockHash: fixedHex(r.blockHash, 32), placementVersion: quantity(r.placementVersion),
    groupHash: fixedHex(r.groupHash, 32), groupJournalHash: fixedHex(r.groupJournalHash, 32), digestVersion: quantity(r.digestVersion),
    digestFingerprint: fixedHex(r.digestFingerprint, 32), initialAnchor: fixedHex(r.initialAnchor, 32), finalAnchor: fixedHex(r.finalAnchor, 32),
    memberCount: quantity(r.memberCount) };
  if (r.state === 'pending') {
    if (Object.prototype.hasOwnProperty.call(r, 'payloads') || candidate.commitTx !== ZERO_HASH || candidate.block !== BigInt(0) ||
        candidate.blockHash !== ZERO_HASH || candidate.placementVersion !== BigInt(0) || candidate.groupHash !== ZERO_HASH ||
        candidate.groupJournalHash !== ZERO_HASH || candidate.digestVersion !== BigInt(0) || candidate.digestFingerprint !== ZERO_HASH ||
        candidate.initialAnchor !== ZERO_HASH || candidate.finalAnchor !== ZERO_HASH || candidate.memberCount !== BigInt(0)) return fail('invalid pending observation');
    return { state: 'pending', ...identity };
  }
  if (r.state !== 'local_durable' || candidate.commitTx === ZERO_HASH || candidate.block === BigInt(0) || candidate.blockHash === ZERO_HASH ||
      candidate.placementVersion === BigInt(0) || candidate.groupHash === ZERO_HASH || candidate.groupJournalHash === ZERO_HASH ||
      candidate.digestVersion === BigInt(0) || candidate.digestFingerprint === ZERO_HASH || candidate.memberCount < BigInt(1) ||
      candidate.memberCount > BigInt(input.maxMembers) || (input.expectedCommitTx !== null && candidate.commitTx !== input.expectedCommitTx)) {
    return fail('invalid durable observation');
  }
  if (input.mode === 'status') {
    if (Object.prototype.hasOwnProperty.call(r, 'payloads')) return fail('status observation contains private payloads');
    return { state: 'local_durable', ...identity, ...candidate };
  }
  if (!Array.isArray(r.payloads) || r.payloads.length !== Number(candidate.memberCount)) return fail('result member count differs');
  const payloads = r.payloads.map((p: unknown) => bytes(p, DDB_COMMITMENT_PAYLOAD_MAX_BYTES));
  const members = payloads.map((p: Uint8Array, i: number) => {
    const m = decodePrivateTxnMemberV1(p, input.maxMembers);
    if (m.index !== BigInt(i) || m.count !== candidate.memberCount || m.intent.type !== BigInt(7) || m.base.chain !== candidate.chain ||
        m.base.database !== candidate.database || m.base.caller !== candidate.caller || m.base.group_hash !== candidate.groupHash ||
        m.base.placement_version !== candidate.placementVersion || m.base.digest_version !== candidate.digestVersion ||
        m.base.digest_fingerprint !== candidate.digestFingerprint || m.base.initial_anchor !== candidate.initialAnchor) return fail('canonical member identity differs');
    return m;
  });
  for (let i = 1; i < members.length; i++) {
    if (hex(encodePrivateTxnMemberV1({ ...members[i], base: members[0].base }, input.maxMembers)) !== hex(payloads[i])) return fail('canonical members have different bases');
  }
  return { state: 'local_durable', ...identity, ...candidate, payloads, members };
}

interface RetainedSnapshot {
  readonly payloads: readonly string[];
  readonly base: PrivateTxnBaseV1;
  readonly operationHashes: readonly string[];
  readonly payloadCommitments: readonly string[];
}

function snapshotRetained(input: DdbPrivateTxnOutcomeReadInput, retained: BuiltDdbPrivateTransaction): RetainedSnapshot {
  if (!retained || fixedHex(retained.id, 32, true) !== input.txnId || !Array.isArray(retained.members) || !Array.isArray(retained.sidecars) ||
      retained.members.length < 1 || retained.members.length > input.maxMembers || retained.sidecars.length !== retained.members.length) return fail('invalid retained transaction');
  const count = retained.members.length;
  const payloads: string[] = [];
  const operations: DdbCanonicalOpV2[] = [];
  const hashes: string[] = [];
  const commitments: string[] = [];
  let base: PrivateTxnBaseV1 | undefined;
  retained.members.forEach((entry, i) => {
    const sidecar = object(retained.sidecars[i], ['salt', 'payload']);
    const payload = bytes(sidecar.payload, DDB_COMMITMENT_PAYLOAD_MAX_BYTES);
    const salt = bytes(sidecar.salt, 32, 32);
    const m = decodePrivateTxnMemberV1(payload, input.maxMembers);
    base = base ?? m.base;
    if (m.index !== BigInt(i) || m.count !== BigInt(count) || m.intent.type !== BigInt(7) || m.base.chain !== input.chain ||
        m.base.database !== input.database || m.base.caller !== input.caller || hex(encodePrivateTxnMemberV1({ ...m, base }, input.maxMembers)) !== hex(payload)) {
      return fail('retained member identity or base differs');
    }
    const e = entry?.envelope;
    if (!e || e.type !== 15 || e.schemaName !== input.database || e.from !== input.caller || !(entry.hash instanceof Uint8Array) || entry.hash.length !== 32) return fail('invalid retained commitment member');
    const data = bytes(e.data, DDB_COMMITMENT_PAYLOAD_MAX_BYTES);
    const envelope = decodeDdbCommitmentEnvelope(new TextDecoder('utf-8', { fatal: true }).decode(data));
    const commitment = ddbPayloadCommitment(salt, payload);
    if (envelope.commitment !== commitment || BigInt(envelope.placementVersion) !== base.placement_version || BigInt(envelope.digestKeyVersion) !== base.digest_version) {
      return fail('retained payload commitment differs');
    }
    const op: DdbCanonicalOpV2 = { type: 15, chainId: input.chain, schemaName: input.database, data, from: input.caller,
      timestamp: quantity(e.timestamp), gasLimit: quantity(e.gasLimit), nonce: quantity(e.nonce), expiry: quantity(e.expiry), keyVersion: quantity(e.keyVersion) };
    if (op.timestamp !== m.intent.timestamp || op.gasLimit !== m.intent.gas_limit || op.nonce !== m.intent.nonce ||
        op.expiry !== m.intent.expiry || op.keyVersion !== m.intent.key_version) return fail('retained intent differs from commitment operation');
    const txn = object(e.txn, i === 0 ? ['id', 'index', 'count', 'read_version', 'reads'] : ['id', 'index', 'count']);
    if (txn.id !== input.txnId || txn.index !== i || txn.count !== count) return fail('retained transaction header differs');
    if (i === 0) {
      if (base.block > BigInt(Number.MAX_SAFE_INTEGER) || txn.read_version !== Number(base.block) || !Array.isArray(txn.reads) || txn.reads.length !== 1) return fail('retained whole-database read differs');
      const read = object(txn.reads[0], ['table', 'pk'], []);
      if ((read.table !== undefined && read.table !== '') || (read.pk !== undefined && (!Array.isArray(read.pk) || read.pk.length !== 0))) return fail('retained whole-database read differs');
    }
    payloads.push(hex(payload)); operations.push(op); hashes.push(hex(entry.hash)); commitments.push(commitment);
  });
  const id = canonicalDdbTxnId(operations, base!.block, [{}]);
  if (hex(id) !== input.txnId || operations.some((op, i) => hex(canonicalDdbTxnMemberHash(op, id, i, count)) !== hashes[i])) return fail('retained transaction or member hash differs');
  return { payloads, base: base!, operationHashes: hashes, payloadCommitments: commitments };
}

function expectation(input: DdbPrivateTxnOutcomeReadInput, retained: RetainedSnapshot): DdbPrivateTxnExpectation {
  // Decode a fresh bounded copy for each callback; neither byte arrays nor nested context are shared.
  return { chain: input.chain, database: input.database, caller: input.caller, txnId: input.txnId,
    base: decodePrivateTxnMemberV1(bytes(retained.payloads[0], DDB_COMMITMENT_PAYLOAD_MAX_BYTES), input.maxMembers).base,
    operationHashes: [...retained.operationHashes], payloadCommitments: [...retained.payloadCommitments] };
}

function candidateOf(o: DdbPrivateTxnLocalDurable): DdbPrivateTxnFinalityCandidate {
  return { chain: o.chain, database: o.database, caller: o.caller, txnId: o.txnId, commitTx: o.commitTx, block: o.block, blockHash: o.blockHash,
    placementVersion: o.placementVersion, groupHash: o.groupHash, groupJournalHash: o.groupJournalHash, digestVersion: o.digestVersion,
    digestFingerprint: o.digestFingerprint, initialAnchor: o.initialAnchor, finalAnchor: o.finalAnchor, memberCount: o.memberCount };
}

function candidateKey(o: DdbPrivateTxnFinalityCandidate): string {
  return JSON.stringify(o, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
}

/**
 * One bounded pass. Only read nonces change on another call; this never submits SQL or regenerates the
 * original transaction. Success is relative to the explicit required set and the application's trust.
 */
export async function collectDdbPrivateTransactionOutcome(input: DdbPrivateTxnCollectionInput): Promise<DdbPrivateTxnCollection> {
  if (!Array.isArray(input.requiredHosts) || input.requiredHosts.length === 0 || input.requiredHosts.length > 64) return fail('explicit required hosts are required');
  // Array.from visits holes too; sparse caller policy must refuse before any callback or private work.
  const requiredHosts = Array.from(input.requiredHosts, recipient);
  if (requiredHosts.some((id, i) => i > 0 && id <= requiredHosts[i - 1])) return fail('required hosts must be unique and sorted');
  const read = snapshotRead({ ...input, validatorId: requiredHosts[0], mode: 'result' });
  const retained = snapshotRetained(read, input.retained);
  const placement = activeRoute('0x' + read.database.slice(2), input.completePlacement);
  const b = retained.base;
  if (placement.block !== '0x' + b.block.toString(16) || placement.blockHash !== b.block_hash || placement.stateRoot !== b.state_root ||
      placement.epoch !== '0x' + b.epoch.toString(16) || placement.manager !== b.manager || placement.runtimeHash !== b.manager_runtime ||
      placement.version !== '0x' + b.placement_version.toString(16) || placement.groupHash !== b.group_hash ||
      requiredHosts.some(id => !placement.members.some(m => m.validatorId === id))) return fail('historical placement differs from retained base or required hosts');
  if (typeof input.verifyHistoricalPlacement !== 'function' || typeof input.verifyFinality !== 'function') return fail('independent historical placement and finality policies required');
  const verifyPlacement = input.verifyHistoricalPlacement.bind(input);
  const verifyFinality = input.verifyFinality.bind(input);
  const hosts: DdbPrivateTxnHostDisposition[] = [];
  const pending = (reason: Extract<DdbPrivateTxnCollection, { committed: false }>['reason']): DdbPrivateTxnCollection =>
    ({ state: 'pending', committed: false, reason, requiredHosts: [...requiredHosts], hosts: hosts.map(h => ({ ...h })) });
  let historical = false;
  try { historical = await verifyPlacement(placement, expectation(read, retained)); } catch { /* Unavailable trust never implies success. */ }
  if (historical !== true) return pending('historical_placement_unverified');
  const durable: DdbPrivateTxnLocalDurable[] = [];
  for (const validatorId of requiredHosts) {
    try {
      const local = await readCaptured({ ...read, validatorId }, placement.members.find(m => m.validatorId === validatorId)!.address);
      if (local.state === 'pending') { hosts.push({ validatorId, state: 'pending' }); continue; }
      if (!local.payloads || local.payloads.length !== retained.payloads.length || local.payloads.some((p, i) => hex(p) !== retained.payloads[i])) {
        hosts.push({ validatorId, state: 'unavailable' }); continue;
      }
      durable.push(local); hosts.push({ validatorId, state: 'local_durable' });
    } catch { hosts.push({ validatorId, state: 'unavailable' }); }
  }
  if (durable.length !== requiredHosts.length) return pending('awaiting_hosts');
  const candidate = candidateOf(durable[0]);
  if (durable.some(o => candidateKey(candidateOf(o)) !== candidateKey(candidate))) return pending('disagreement');
  let verified = false;
  try { verified = await verifyFinality(expectation(read, retained), { ...candidate }); } catch { /* Do not leak trusted-adapter error text. */ }
  if (verified !== true) return pending('finality_unverified');
  const payloads = retained.payloads.map(p => bytes(p, DDB_COMMITMENT_PAYLOAD_MAX_BYTES));
  const blockNumber = '0x' + candidate.block.toString(16);
  return { state: 'committed', committed: true, ...candidate, requiredHosts: [...requiredHosts], durableHosts: durable.map(o => o.validatorId),
    finality: { finalized: true, blockNumber, blockHash: candidate.blockHash }, readToken: blockNumber,
    payloads, members: payloads.map(p => decodePrivateTxnMemberV1(p, read.maxMembers)) };
}
