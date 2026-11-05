import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { buildDdbTransaction, DDB_TXN_MAX_OPS, type DdbSigner, type DdbSignedOpEnvelope, type DdbTxnHeaderEnvelope } from './ddb';
import { buildDdbPrivateTransaction, decodePrivateTxnMemberV1, encodePrivateTxnMemberV1,
  type BuiltDdbPrivateTransaction, type PrivateTxnBaseV1, type PrivateTxnIntentV1, type PrivateTxnMemberV1 } from './ddb-private-txn';
import { DDB_COMMITMENT_PAYLOAD_MAX_BYTES, type DdbTagDelta } from './ddb-commitment';
import { parseDdbCurrentReadRoute, type DdbCurrentReadRoute, type DdbCurrentReadMember, type DdbPrivateReadPolicy, type DdbAuthenticatedReadTransport } from './ddb-private-read';
import { validatePrivateTransactionRecord, type DdbPrivateTxnOutcomeResolver } from './ddb-private-txn-outcome';
import { MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES } from './key-registry';

type SignedMember = DdbSignedOpEnvelope & { txn: DdbTxnHeaderEnvelope };
type MutationMethod = 'ddb_previewPrivateBatch' | 'ddb_putPayloadBatch' | 'ddb_submitSignedTransaction';
const hex = (value: Uint8Array) => '0x' + bytesToHex(value);
class PrivateTxnError extends Error {}
const fail = (message: string): never => { throw new PrivateTxnError('private transaction: ' + message); };

export interface DdbPrivateTransactionCall {
  data: string | object;
  gasLimit?: number;
  nonce?: number | bigint;
}
export interface DdbPrivateTransactionRoot { prior: string; post: string }
export interface DdbPrivatePreparedSnapshotRequest {
  connectedRoute: DdbCurrentReadRoute;
  recipient: DdbCurrentReadMember;
  localIntents: readonly PrivateTxnIntentV1[];
  previewMembers: readonly PrivateTxnMemberV1[];
  roots: readonly DdbPrivateTransactionRoot[];
}
export interface DdbPrivateTransactionPrepareInput {
  signer: DdbSigner;
  resolver: DdbPrivateTxnOutcomeResolver;
  policy: DdbPrivateReadPolicy;
  chain: string;
  database: string;
  caller: string;
  validatorId: number;
  maxMembers: number;
  /** Locally held digest key. Copied only for preparation; never sent, passed to callbacks or retained. */
  digestKey: Uint8Array;
  members: DdbPrivateTransactionCall[];
  keyVersion: number | bigint;
  timestamp?: number;
  expiry?: number | bigint;
  /**
   * Authenticate BASE/header/rules/full placement and SQL context using independent trusted evidence.
   * Echoing preview BASE is not independent validation. Output is owned before further signing awaits.
   */
  acceptPreparedSnapshot(request: DdbPrivatePreparedSnapshotRequest): Promise<{ expectedBase: PrivateTxnBaseV1; completePlacement: DdbCurrentReadRoute }>;
}
export interface DdbPrivateTransactionRetryRecord {
  kind: 'private-transaction-retry-v1';
  retained: BuiltDdbPrivateTransaction;
  signedMembers: SignedMember[];
  completePlacement: DdbCurrentReadRoute;
  maxMembers: number;
  /** Execution observations: shape/initial anchor/continuity checked, not independently derived LtHash post roots. */
  roots: DdbPrivateTransactionRoot[];
}
export interface DdbPrivateTransactionSendInput {
  record: DdbPrivateTransactionRetryRecord;
  resolver: DdbPrivateTxnOutcomeResolver;
  policy: DdbPrivateReadPolicy;
  validatorId: number;
}
export interface DdbPrivateTransactionCustodyResult {
  state: 'custody_stored' | 'custody_unknown';
  committed: false;
  validatorId: number;
  txnId: string;
  /** Only a successful exact local custody response carries these hashes. Not post-apply durability. */
  commitments?: readonly string[];
}
export interface DdbPrivateTransactionSubmission {
  state: 'pending';
  committed: false;
  validatorId: number;
  txnId: string;
  operationHashes: readonly string[];
  /** Null after unavailable/ambiguous service. Never evidence that the transaction was not submitted. */
  commitTxHash: string | null;
}

function fixed(value: unknown, size: number, nonzero = false): string {
  if (typeof value !== 'string' || value.length !== 2 + size * 2 || !/^0x[0-9a-f]+$/.test(value) || (nonzero && /^0x0+$/.test(value))) return fail('invalid canonical identity');
  return value;
}
function raw(value: unknown, max = DDB_COMMITMENT_PAYLOAD_MAX_BYTES): Uint8Array {
  if (typeof value !== 'string' || value.length < 4 || value.length > 2 + max * 2 || value.length % 2 || !/^0x[0-9a-f]+$/.test(value)) return fail('invalid bounded canonical bytes');
  return hexToBytes(value.slice(2));
}
function limit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > DDB_TXN_MAX_OPS) return fail('invalid captured member bound');
  return value;
}
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 0xffffffff) return fail('invalid recipient');
  return value;
}
function obj(value: unknown, fields: string[], required = fields): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k)) || required.some(k => !Object.prototype.hasOwnProperty.call(value, k))) return fail('invalid object shape');
  return value as Record<string, any>;
}
function tags(value: unknown): DdbTagDelta {
  const r = value === undefined ? {} : obj(value, ['added', 'removed'], []);
  const out: DdbTagDelta = {};
  for (const side of ['removed', 'added'] as const) {
    if (r[side] === undefined) continue;
    if (!Array.isArray(r[side]) || r[side].length > DDB_COMMITMENT_PAYLOAD_MAX_BYTES / 32) return fail('tag count outside bound');
    out[side] = Array.from(r[side], (tag: unknown) => {
      if (typeof tag !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(tag)) return fail('invalid keyed tag');
      return tag;
    });
  }
  return out;
}
function sameTags(a: DdbTagDelta, b: DdbTagDelta): boolean {
  return JSON.stringify(a.added ?? []) === JSON.stringify(b.added ?? []) && JSON.stringify(a.removed ?? []) === JSON.stringify(b.removed ?? []);
}
function roots(values: readonly DdbPrivateTransactionRoot[], count: number, initial: string): DdbPrivateTransactionRoot[] {
  if (!Array.isArray(values) || values.length !== count) return fail('root count differs');
  let prior = initial;
  return Array.from(values, value => {
    const r = obj(value, ['prior', 'post']);
    const next = { prior: fixed(r.prior, 32), post: fixed(r.post, 32) };
    if (next.prior !== prior) return fail('root initial anchor or continuity differs');
    prior = next.post; return next;
  });
}
function placementFor(base: PrivateTxnBaseV1, value: unknown): DdbCurrentReadRoute {
  const p = parseDdbCurrentReadRoute(base.contract, value);
  if (!p.enabled || !p.private || p.members.length === 0 || p.block !== '0x' + base.block.toString(16) || p.blockHash !== base.block_hash ||
      p.stateRoot !== base.state_root || p.epoch !== '0x' + base.epoch.toString(16) || p.manager !== base.manager || p.runtimeHash !== base.manager_runtime ||
      p.version !== '0x' + base.placement_version.toString(16) || p.groupHash !== base.group_hash) return fail('accepted placement differs from BASE');
  return p;
}
function context(input: { resolver: DdbPrivateTxnOutcomeResolver; policy: DdbPrivateReadPolicy; validatorId: number }, database: string) {
  if (!/^c_[0-9a-f]{40}$/.test(database) || /^c_0+$/.test(database)) return fail('canonical contract database required');
  const validatorId = id(input.validatorId), { resolver, policy } = input;
  if (!resolver || typeof resolver.resolveCurrent !== 'function' || typeof resolver.hostEndpoints !== 'function' ||
      !policy || typeof policy.verifyAssignment !== 'function' || typeof policy.connect !== 'function') return fail('trusted channel policy and discovery required');
  return { database, validatorId,
    resolver: { resolveCurrent: resolver.resolveCurrent.bind(resolver), hostEndpoints: resolver.hostEndpoints.bind(resolver) },
    policy: { verifyAssignment: policy.verifyAssignment.bind(policy), connect: policy.connect.bind(policy) } };
}
function close(transport?: DdbAuthenticatedReadTransport) {
  try { const f = (transport as { close?: () => void } | undefined)?.close; if (typeof f === 'function') f.call(transport); } catch { /* Release must not disclose adapter errors. */ }
}
async function open(c: ReturnType<typeof context>, expected?: DdbCurrentReadRoute) {
  let transport: DdbAuthenticatedReadTransport | undefined;
  try {
    const contract = '0x' + c.database.slice(2);
    const route = parseDdbCurrentReadRoute(contract, await c.resolver.resolveCurrent(contract));
    if (!route.enabled || !route.private || route.members.length === 0 || /^0x0+$/.test(route.manager) || /^0x0+$/.test(route.runtimeHash) ||
        /^0x0+$/.test(route.blockHash) || /^0x0+$/.test(route.stateRoot) || route.version === '0x0') return fail('current assignment unavailable');
    if (expected && (route.version !== expected.version || route.groupHash !== expected.groupHash || route.manager !== expected.manager ||
        route.runtimeHash !== expected.runtimeHash || JSON.stringify(route.members) !== JSON.stringify(expected.members))) return fail('current assignment differs from retained placement');
    if (await c.policy.verifyAssignment(route) !== true) return fail('current assignment is not trusted');
    const member = route.members.find(m => m.validatorId === c.validatorId);
    if (!member) return fail('recipient is not assigned');
    const hosts = await c.resolver.hostEndpoints([c.validatorId]);
    if (!Array.isArray(hosts) || hosts.length > 64) return fail('invalid endpoint discovery');
    const matching = hosts.filter(h => h?.validatorId === c.validatorId && h.live === true);
    if (matching.length !== 1 || !Array.isArray(matching[0].endpoints) || matching[0].endpoints.length < 1 || matching[0].endpoints.length > 4) return fail('recipient endpoint unavailable');
    const endpoints = Object.freeze(Array.from(matching[0].endpoints, e => {
      if (!e || typeof e.url !== 'string' || !e.url || typeof e.scheme !== 'string' || !e.scheme) return fail('invalid endpoint');
      return Object.freeze({ scheme: e.scheme, url: e.url, tlsKeyHash: fixed(e.tlsKeyHash, 32, true) });
    }));
    transport = await c.policy.connect(Object.freeze({ route, member, endpoints }));
    const b = transport?.binding;
    if (!b || transport.endpointAuthenticated !== true || transport.confidentiality !== 'post-quantum' || typeof transport.send !== 'function' ||
        b.validatorId !== member.validatorId || b.address !== member.address || !endpoints.some(e => e.url === b.url && e.tlsKeyHash === b.tlsKeyHash) ||
        JSON.stringify(parseDdbCurrentReadRoute(contract, b.route)) !== JSON.stringify(route)) return fail('transport is not bound to the addressed assignment/endpoint');
    const sender = transport.send.bind(transport), owned = transport;
    return { route, member, send: (method: MutationMethod, params: any[]) => sender(method, params), close: () => close(owned) };
  } catch { close(transport); return fail('authenticated private channel unavailable'); }
}

/** Prepare once and return the full record BEFORE any keeper custody or transaction submission. */
export async function prepareDdbPrivateTransaction(input: DdbPrivateTransactionPrepareInput): Promise<DdbPrivateTransactionRetryRecord> {
  const chain = fixed(input.chain, 32, true), caller = fixed(input.caller, 20, true), maxMembers = limit(input.maxMembers);
  const c = context(input, input.database);
  if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > maxMembers || input.keyVersion === undefined ||
      !(input.digestKey instanceof Uint8Array) || input.digestKey.length !== 32 || !input.digestKey.some(b => b !== 0) ||
      typeof input.acceptPreparedSnapshot !== 'function' || !input.signer || typeof input.signer.getAddress !== 'function' ||
      typeof input.signer.getPublicKey !== 'function' || typeof input.signer.signDdbHash !== 'function') return fail('invalid preparation inputs');
  // Do not bind the key-bearing input as the policy callback's receiver.
  const accept = input.acceptPreparedSnapshot, getAddress = input.signer.getAddress.bind(input.signer),
    getPublicKey = input.signer.getPublicKey.bind(input.signer), sign = input.signer.signDdbHash.bind(input.signer);
  const digestKey = input.digestKey.slice();
  let channel: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Capture exact compact intent/nonces synchronously. Public key is not part of the operation hash;
    // fill its envelope field only after the actual signer and authenticated channel are available.
    const preparation = buildDdbTransaction(Array.from(input.members, m => {
      const v = obj(m, ['data', 'gasLimit', 'nonce'], ['data']);
      return { typeName: 'callprocedure' as const, schemaName: c.database, data: v.data, gasLimit: v.gasLimit, nonce: v.nonce };
    }), caller, new Uint8Array(), { chainId: chain, timestamp: input.timestamp, expiry: input.expiry, keyVersion: input.keyVersion, readVersion: 0, reads: [] });
    const intents: PrivateTxnIntentV1[] = preparation.members.map(({ envelope: e }) => ({ type: BigInt(7), data: raw(e.data),
      timestamp: BigInt(e.timestamp), gas_limit: BigInt(e.gasLimit), nonce: BigInt(e.nonce), expiry: BigInt(e.expiry!), key_version: BigInt(e.keyVersion!) }));
    channel = await open(c);
    const address = await getAddress(), key = await getPublicKey();
    if (typeof address !== 'string' || address.toLowerCase() !== caller || !(key instanceof Uint8Array) || key.length !== MLDSA87_PUBKEY_BYTES) return fail('signer identity differs');
    const publicKey = key.slice();
    const signedPreparation: SignedMember[] = [];
    for (const m of preparation.members) {
      const signature = await sign(m.hash.slice());
      if (!(signature instanceof Uint8Array) || signature.length !== MLDSA87_SIG_BYTES) return fail('invalid preparation signature');
      signedPreparation.push({ ...m.envelope, callerPubKey: hex(publicKey), callerSig: hex(signature) });
    }
    const preview = await channel.send('ddb_previewPrivateBatch', [signedPreparation]);
    if (!Array.isArray(preview) || preview.length !== intents.length) return fail('preview count differs');
    const replies = Array.from(preview, p => obj(p, ['payload', 'placementVersion', 'digestKeyVersion', 'stateDelta', 'prior', 'post'], ['payload', 'placementVersion', 'digestKeyVersion', 'prior', 'post']));
    const payloads = replies.map(p => raw(p.payload));
    const decoded = payloads.map(p => decodePrivateTxnMemberV1(p, maxMembers));
    decoded.forEach((m, i) => {
      if (m.index !== BigInt(i) || m.count !== BigInt(intents.length) || m.base.chain !== chain || m.base.database !== c.database || m.base.caller !== caller ||
          replies[i].placementVersion !== '0x' + m.base.placement_version.toString(16) || replies[i].digestKeyVersion !== '0x' + m.base.digest_version.toString(16) ||
          hex(encodePrivateTxnMemberV1({ ...m, intent: intents[i], base: decoded[0].base }, maxMembers)) !== hex(payloads[i])) return fail('preview BASE or retained intent differs');
    });
    const previewRoots = roots(replies.map(p => ({ prior: p.prior, post: p.post })), decoded.length, decoded[0].base.initial_anchor);
    const accepted = await accept({ connectedRoute: channel.route, recipient: channel.member,
      localIntents: intents.map(i => ({ ...i, data: i.data.slice() })), previewMembers: payloads.map(p => decodePrivateTxnMemberV1(p, maxMembers)), roots: previewRoots.map(r => ({ ...r })) });
    if (!accepted) return fail('independent snapshot acceptance unavailable');
    const acceptedBase = decodePrivateTxnMemberV1(encodePrivateTxnMemberV1({ ...decoded[0], base: accepted.expectedBase }, maxMembers), maxMembers).base;
    const placement = placementFor(acceptedBase, accepted.completePlacement);
    if (!placement.members.some(m => m.validatorId === c.validatorId && m.address === channel!.member.address)) return fail('preview recipient differs from accepted placement');
    const retained = buildDdbPrivateTransaction({ expectedBase: acceptedBase, expectedIntents: intents, payloads, digestKey,
      callerPubKey: publicKey, maxMembers, readVersion: acceptedBase.block, reads: [{}] });
    for (let i = 0; i < replies.length; i++) if (!sameTags(tags(replies[i].stateDelta), retained.members[i].envelope.stateDelta!)) return fail('preview keyed tags differ from local digest key');
    const signedMembers: SignedMember[] = [];
    for (const m of retained.members) {
      const signature = await sign(m.hash.slice());
      if (!(signature instanceof Uint8Array) || signature.length !== MLDSA87_SIG_BYTES) return fail('invalid final signature');
      signedMembers.push({ ...JSON.parse(JSON.stringify(m.envelope)), callerSig: hex(signature) });
    }
    return { kind: 'private-transaction-retry-v1', retained, signedMembers, completePlacement: placement, maxMembers, roots: previewRoots };
  } catch (error) {
    if (error instanceof PrivateTxnError) throw error;
    return fail('preparation unavailable');
  } finally { digestKey.fill(0); channel?.close(); }
}

function stable(value: any): string {
  return JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
function ownedRecord(record: DdbPrivateTransactionRetryRecord) {
  if (!record || record.kind !== 'private-transaction-retry-v1') return fail('invalid retry record');
  const maxMembers = limit(record.maxMembers), source = record.retained;
  if (!source || !Array.isArray(source.members) || source.members.length < 1 || source.members.length > maxMembers || !Array.isArray(source.sidecars) ||
      source.sidecars.length !== source.members.length || !Array.isArray(record.signedMembers) || record.signedMembers.length !== source.members.length) return fail('invalid retry member count');
  const envelopeFields = ['type', 'schemaName', 'data', 'from', 'timestamp', 'gasLimit', 'nonce', 'expiry', 'keyVersion', 'callerPubKey', 'stateDelta', 'txn'];
  const retained: BuiltDdbPrivateTransaction = { id: fixed(source.id, 32, true), sidecars: Array.from(source.sidecars, s => {
    obj(s, ['salt', 'payload']); fixed(s.salt, 32); raw(s.payload); return { salt: s.salt, payload: s.payload };
  }), members: Array.from(source.members, m => {
    if (!m || !(m.hash instanceof Uint8Array) || m.hash.length !== 32) return fail('invalid member hash');
    const e = obj(m.envelope, envelopeFields); fixed(e.callerPubKey, MLDSA87_PUBKEY_BYTES); tags(e.stateDelta);
    return { hash: m.hash.slice(), envelope: JSON.parse(JSON.stringify(e)) };
  }) };
  const base = decodePrivateTxnMemberV1(raw(retained.sidecars[0].payload), maxMembers).base;
  const checked = validatePrivateTransactionRecord({ chain: base.chain, database: base.database, caller: base.caller, txnId: retained.id, maxMembers }, retained);
  const signedMembers = Array.from(record.signedMembers, (m, i) => {
    const signed = obj(m, [...envelopeFields, 'callerSig']); fixed(signed.callerSig, MLDSA87_SIG_BYTES);
    const { callerSig, ...unsigned } = signed;
    if (stable(unsigned) !== stable(retained.members[i].envelope)) return fail('signed member differs from retained unit');
    return JSON.parse(JSON.stringify({ ...unsigned, callerSig })) as SignedMember;
  });
  const placement = placementFor(base, record.completePlacement);
  roots(record.roots, retained.members.length, base.initial_anchor);
  return { retained, signedMembers, placement, base, checked };
}

/** One explicitly addressed host's encrypted keeper custody. No host set/default or post-apply durability claim. */
export async function storeDdbPrivateTransactionPayloads(input: DdbPrivateTransactionSendInput): Promise<DdbPrivateTransactionCustodyResult> {
  const record = ownedRecord(input.record), c = context(input, record.base.database);
  const result: DdbPrivateTransactionCustodyResult = { state: 'custody_unknown', committed: false, validatorId: c.validatorId, txnId: record.retained.id };
  let channel: Awaited<ReturnType<typeof open>> | undefined;
  try {
    channel = await open(c, record.placement);
    const reply = await channel.send('ddb_putPayloadBatch', [record.signedMembers, record.retained.sidecars]);
    if (!Array.isArray(reply) || reply.length !== record.checked.payloadCommitments.length ||
        Array.from(reply).some((h, i) => fixed(h, 32, true) !== record.checked.payloadCommitments[i])) return result;
    return { ...result, state: 'custody_stored', commitments: [...record.checked.payloadCommitments] };
  } catch { return result; } finally { channel?.close(); }
}

/** Submit the SAME signed unit once. A lost/failed reply stays unknown; this never reprepares, stores or resubmits. */
export async function submitDdbPrivateTransaction(input: DdbPrivateTransactionSendInput): Promise<DdbPrivateTransactionSubmission> {
  const record = ownedRecord(input.record), c = context(input, record.base.database);
  const result: DdbPrivateTransactionSubmission = { state: 'pending', committed: false, validatorId: c.validatorId,
    txnId: record.retained.id, operationHashes: [...record.checked.operationHashes], commitTxHash: null };
  let channel: Awaited<ReturnType<typeof open>> | undefined;
  try {
    channel = await open(c, record.placement);
    const commitTxHash = fixed(await channel.send('ddb_submitSignedTransaction', [record.signedMembers]), 32, true);
    return { ...result, commitTxHash };
  } catch { return result; } finally { channel?.close(); }
}
