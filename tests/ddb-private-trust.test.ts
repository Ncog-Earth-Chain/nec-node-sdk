import { keccak_256 } from '@noble/hashes/sha3';
import { createDdbTrustedNodePrivatePolicy } from '../src/ddb-private-trust-node';
import { openPrivateNodeChannel } from '../src/ddb-private-channel-node';
import { encodePrivateTxnBaseV1, decodePrivateTxnBaseV1, encodePrivateTxnIntentV1 } from '../src/ddb-private-txn';
import { ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH } from '../src/ddb-private-evidence';
import { prepareDdbPrivateTransaction } from '../src/ddb-private-txn-online';
import { collectDdbPrivateTransactionOutcome } from '../src/ddb-private-txn-outcome';
import { decodeDdbCommitmentEnvelope } from '../src/ddb-commitment';
import { buildDdbSignedReadProcedure } from '../src/ddb';
import { privateClientFixture, hex, hash, caller, database, chain, pub, sig } from './fixtures/private-client';
import { createDdbPrivateReferenceClient } from '../src/ddb-private-client-node';
import { createDdbNodePrivateRetryStore } from '../src/ddb-private-retry-node';
import { createSecretKey, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import runtimeVector from './vectors/private-evidence-endpoint-runtime.json';

jest.mock('../src/ddb-private-channel-node', () => ({ openPrivateNodeChannel: jest.fn() }));
const open = openPrivateNodeChannel as jest.Mock;

export function trustFixture() {
  const f = privateClientFixture();
  const source = { validatorId: 9, address: f.placement.members[2].address, url: 'https://authority.example', tlsKeyHash: hash('cc') };
  const assignment = { chain, placement: f.placement, maxMembers: '0x4', endpointDirectory: '0x' + 'ab'.repeat(20),
    endpointRuntime: ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH, blockTime: '0x1', hosts: f.placement.members.map(m => ({ ...m,
      publicKey: hex(pub), auth: '0x' + 'ad'.repeat(20), expiry: '0xffffffffffffffff', live: true,
      endpoints: [{ scheme: 'https', url: `https://host${m.validatorId}.example`, tlsKeyHash: hash('bb') }] })) };
  const sourceSend = jest.fn(async (method: string, params: any[]): Promise<any> => {
    if (method === 'ddb_getPrivateAssignmentEvidence') return assignment;
    if (method === 'ddb_getPrivateTransactionSnapshotEvidence') return { base: hex(encodePrivateTxnBaseV1(f.base)), placement: f.placement, maxMembers: '0x4' };
    throw new Error('source has no canonical finality');
  });
  open.mockImplementation(async (url: string) => ({ send: url === source.url ? sourceSend : f.send, close: jest.fn(),
    endpointAuthenticated: true, confidentiality: 'post-quantum', negotiatedGroup: 'X25519MLKEM768' }));
  const config = { trust: 'trusted-validating-node' as const, chain, database, caller, source, signer: f.input.signer };
  const trust = createDdbTrustedNodePrivatePolicy(config);
  return { ...f, source, assignment, sourceSend, config, trust };
}

beforeEach(() => open.mockReset());

test('endpoint runtime pin is the hash of the reviewed node bytecode vector', () => {
  expect(hex(keccak_256(Buffer.from(runtimeVector.runtimeHex.slice(2), 'hex')))).toBe(ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH);
  expect(runtimeVector.runtimeCodeHash).toBe(ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH);
});

test('explicit authority signs exact unchanged READPROC after authenticated bootstrap without resolver recursion', async () => {
  const f = trustFixture(); const a = await f.trust.readCurrentAssignment();
  expect(a.placement).toEqual(f.placement); expect(a.maxMembers).toBe(4); expect(f.trust.trust).toBe('trusted-validating-node');
  const [method, params] = f.sourceSend.mock.calls[0]; const e = params[0];
  expect(method).toBe('ddb_getPrivateAssignmentEvidence'); expect(e.args).toEqual(['9', 'current']);
  const expected = buildDdbSignedReadProcedure(chain, database, '@ddb/private-assignment-evidence/v1', e.args, caller, pub,
    { timestamp: Number(e.timestamp), nonce: BigInt(e.nonce) });
  expect(e).toEqual({ ...expected.envelope, callerSig: hex(sig) });
  expect(f.signDdbHash.mock.calls[0][0]).toEqual(expected.hash); expect(f.resolveCurrent).not.toHaveBeenCalled();
  expect(open.mock.calls[0][0]).toBe(f.source.url); expect(open.mock.calls[0][1]).toBe(f.source.tlsKeyHash);
  expect(() => createDdbTrustedNodePrivatePolicy({ ...f.config, trust: undefined } as any)).toThrow();
});

test('source assignment binds full current route and independently observed endpoint pin', async () => {
  const f = trustFixture(); expect(await f.trust.policy.verifyAssignment(f.placement)).toBe(true);
  expect(await f.trust.policy.verifyAssignment({ ...f.placement, blockHash: hash('ee') })).toBe(false);
  const member = f.placement.members[1]; const endpoints = f.assignment.hosts[1].endpoints;
  await f.trust.policy.connect({ route: f.placement, member, endpoints });
  expect(open.mock.calls[open.mock.calls.length - 1].slice(0, 2)).toEqual([endpoints[0].url, endpoints[0].tlsKeyHash]);
  await expect(f.trust.policy.connect({ route: f.placement, member, endpoints: [{ ...endpoints[0], tlsKeyHash: hash('ee') }] })).rejects.toThrow();
  f.assignment.hosts[1].live = false; f.assignment.hosts[1].endpoints = [];
  await expect(f.trust.policy.connect({ route: f.placement, member, endpoints })).rejects.toThrow();
});

test('source BASE independently accepts exact preparation without effects results salts or keys in evidence args', async () => {
  const f = trustFixture();
  const record = await prepareDdbPrivateTransaction({ ...f.input, policy: f.trust.policy, acceptPreparedSnapshot: f.trust.acceptPreparedSnapshot });
  const [, params] = f.sourceSend.mock.calls.find(c => c[0] === 'ddb_getPrivateTransactionSnapshotEvidence')!;
  expect(params[0].args[0]).toBe('9');
  expect(decodePrivateTxnBaseV1(Buffer.from(params[0].args[1].slice(2), 'hex'))).toEqual(f.base);
  expect(params[0].args).toHaveLength(4);
  expect(JSON.stringify(params)).not.toContain('stateDelta'); expect(JSON.stringify(params)).not.toContain(hex(f.input.digestKey));
  expect(record.retained.members).toHaveLength(2);
});

test('independent SOURCE BASE context cannot be replaced by preview context in the adapter', async () => {
  const f = trustFixture();
  f.sourceSend.mockImplementation(async method => method === 'ddb_getPrivateAssignmentEvidence' ? f.assignment : {
    base: hex(encodePrivateTxnBaseV1({ ...f.base, context: { ...f.base.context, owner: '0x' + 'ee'.repeat(20) } })),
    placement: f.placement, maxMembers: '0x4' });
  await expect(prepareDdbPrivateTransaction({ ...f.input, policy: f.trust.policy, acceptPreparedSnapshot: f.trust.acceptPreparedSnapshot })).rejects.toThrow();
  expect(f.send.mock.calls.map(c => c[0])).toEqual(['ddb_previewPrivateBatch']);
});

test('source missing evidence malformed coverage and captured bound mismatch refuse instead of echoing claims', async () => {
  const f = trustFixture(); f.assignment.hosts.pop();
  await expect(f.trust.readCurrentAssignment()).rejects.toThrow();
  const g = trustFixture(); g.sourceSend.mockImplementation(async method => method === 'ddb_getPrivateAssignmentEvidence' ? g.assignment : {
    base: hex(encodePrivateTxnBaseV1(g.base)), placement: g.placement, maxMembers: '0x1' });
  await expect(prepareDdbPrivateTransaction({ ...g.input, policy: g.trust.policy, acceptPreparedSnapshot: g.trust.acceptPreparedSnapshot })).rejects.toThrow();
});

test('historical assignment and canonical finality compare all ordered retained identities without an outcome source', async () => {
  const f = trustFixture(); const record = await prepareDdbPrivateTransaction(f.input);
  const transaction = '0x010203'; const commit = hex(keccak_256(Buffer.from(transaction.slice(2), 'hex')));
  const candidate = { chain, database, caller, txnId: record.retained.id, commitTx: commit, block: BigInt(32), blockHash: hash('99'),
    placementVersion: BigInt(2), groupHash: f.placement.groupHash, groupJournalHash: hash('aa'), digestVersion: BigInt(1),
    digestFingerprint: f.base.digest_fingerprint, initialAnchor: f.base.initial_anchor, finalAnchor: hash('82'), memberCount: BigInt(2) };
  const expected = { chain, database, caller, txnId: record.retained.id, base: f.base,
    operationHashes: record.retained.members.map(m => hex(m.hash)),
    payloadCommitments: record.retained.members.map(m => decodeDdbCommitmentEnvelope(Buffer.from(m.envelope.data.slice(2), 'hex').toString()).commitment) };
  const evidence = { ...candidate, block: '0x20', placementVersion: '0x2', digestVersion: '0x1', memberCount: '0x2', readVersion: '0x1b',
    operationHashes: [...expected.operationHashes], payloadCommitments: [...expected.payloadCommitments], transaction };
  f.sourceSend.mockImplementation(async method => method === 'ddb_getPrivateAssignmentEvidence' ? f.assignment : evidence);
  expect(await f.trust.verifyHistoricalPlacement(f.placement, expected)).toBe(true);
  f.assignment.placement = { ...f.placement, blockHash: hash('ee') };
  expect(await f.trust.verifyHistoricalPlacement(f.placement, expected)).toBe(false);
  f.assignment.placement = f.placement;
  expect(await f.trust.verifyFinality(expected, candidate)).toBe(true);
  evidence.operationHashes.reverse(); expect(await f.trust.verifyFinality(expected, candidate)).toBe(false);
  evidence.operationHashes.reverse(); evidence.payloadCommitments.reverse(); expect(await f.trust.verifyFinality(expected, candidate)).toBe(false);
  expect(f.sourceSend.mock.calls.every(c => c[0] !== 'ddb_getPrivateTransactionOutcome')).toBe(true);
});

test('all local durability with no independent canonical source inclusion stays finality_unverified', async () => {
  const f = trustFixture(); const record = await prepareDdbPrivateTransaction(f.input);
  f.send.mockImplementation(async (_method, params) => ({ state: 'local_durable', validatorId: Number(params[0].args[2]), chain, database, caller,
    txnId: record.retained.id, commitTx: hash('88'), block: '0x20', blockHash: hash('99'), placementVersion: '0x2', groupHash: f.placement.groupHash,
    groupJournalHash: hash('aa'), digestVersion: '0x1', digestFingerprint: f.base.digest_fingerprint, initialAnchor: f.base.initial_anchor,
    finalAnchor: hash('82'), memberCount: '0x2', payloads: record.retained.sidecars.map(s => s.payload) }));
  const outcome = await collectDdbPrivateTransactionOutcome({ ...f.input, policy: f.trust.policy, txnId: record.retained.id,
    retained: record.retained, completePlacement: f.placement, requiredHosts: [2, 7], expectedCommitTx: null,
    verifyHistoricalPlacement: f.trust.verifyHistoricalPlacement, verifyFinality: f.trust.verifyFinality });
  expect(outcome).toMatchObject({ committed: false, reason: 'finality_unverified' });
});

test('reference client persists before custody and submission attempts and resumes without replay or digest retrieval', async () => {
  const f = trustFixture(); const directory = await fs.mkdtemp(join(tmpdir(), 'nec-private-client-'));
  try {
    const key = createSecretKey(randomBytes(32)); const store = createDdbNodePrivateRetryStore({ directory, key: async () => key, sync: 'file' });
    const digest = jest.fn(async () => f.input.digestKey.slice());
    const client = createDdbPrivateReferenceClient({ authority: f.config, resolver: f.input.resolver, store, loadDigestKey: digest });
    const options = { members: f.input.members, keyVersion: BigInt(1), timestamp: f.input.timestamp, expiry: f.input.expiry,
      prepareRecipient: 7, custodyHosts: [2, 7], requiredHosts: [2, 7], submitRecipient: 7 };
    const id = await client.prepare(options); expect((await store.load(id)).phase).toBe('prepared');
    await client.custody(id);
    const checkpoint = jest.spyOn(store, 'beginSubmission').mockRejectedValueOnce(new Error('required flush failed'));
    const blocked = createDdbPrivateReferenceClient({ authority: f.config, resolver: f.input.resolver, store, loadDigestKey: digest });
    await expect(blocked.submit(id)).rejects.toThrow(); checkpoint.mockRestore();
    expect(f.send.mock.calls.filter(c => c[0] === 'ddb_submitSignedTransaction')).toHaveLength(0);
    const oldSend = f.send.getMockImplementation()!;
    f.send.mockImplementation(async (method, params) => {
      if (method === 'ddb_submitSignedTransaction') {
        expect((await store.load(id)).phase).toBe('submission_attempted'); throw new Error('lost private reply');
      }
      return oldSend(method, params);
    });
    expect(await client.submit(id)).toMatchObject({ committed: false, commitTxHash: null });
    await expect(client.submit(id)).rejects.toThrow();
    const before = f.send.mock.calls.filter(c => c[0] === 'ddb_submitSignedTransaction').length;
    expect((await client.collect(id)).outcome.committed).toBe(false);
    expect(f.send.mock.calls.filter(c => c[0] === 'ddb_submitSignedTransaction')).toHaveLength(before);
    expect(digest).toHaveBeenCalledTimes(1);
    const save = jest.spyOn(store, 'create').mockRejectedValueOnce(new Error('disk full private sentinel'));
    const failingClient = createDdbPrivateReferenceClient({ authority: f.config, resolver: f.input.resolver, store, loadDigestKey: digest });
    const mutations = f.send.mock.calls.filter(c => c[0] !== 'ddb_previewPrivateBatch').length;
    await expect(failingClient.prepare(options)).rejects.toThrow();
    expect(f.send.mock.calls.filter(c => c[0] !== 'ddb_previewPrivateBatch')).toHaveLength(mutations); save.mockRestore();
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('authority configuration and source observations are owned across caller mutation', async () => {
  const f = trustFixture(), originalURL = f.source.url;
  f.config.source = { ...f.source, url: 'https://untrusted.example' }; f.config.chain = hash('ee');
  const observed = await f.trust.readCurrentAssignment();
  expect(open.mock.calls[0][0]).toBe(originalURL); expect(observed.chain).toBe(chain);
  f.assignment.hosts[0].endpoints[0].tlsKeyHash = hash('ee');
  expect(observed.hosts[0].endpoints[0].tlsKeyHash).toBe(hash('bb'));
});

test('persisted reference workflow commits only through the independent source and explicit required hosts', async () => {
  const f = trustFixture(), directory = await fs.mkdtemp(join(tmpdir(), 'nec-private-complete-'));
  try {
    const key = createSecretKey(randomBytes(32));
    const store = createDdbNodePrivateRetryStore({ directory, key: async () => key, sync: 'file' });
    const options = { authority: f.config, resolver: f.input.resolver, store, loadDigestKey: async () => f.input.digestKey.slice() };
    const client = createDdbPrivateReferenceClient(options);
    const id = await client.prepare({ members: f.input.members, keyVersion: BigInt(1), timestamp: f.input.timestamp, expiry: f.input.expiry,
      prepareRecipient: 7, custodyHosts: [2, 7], requiredHosts: [2, 7], submitRecipient: 7 });
    const { record } = await store.load(id), transaction = '0x010203';
    const commitTx = hex(keccak_256(Buffer.from(transaction.slice(2), 'hex')));
    const observed = { chain, database, caller, txnId: id, commitTx, block: '0x20', blockHash: hash('99'), placementVersion: '0x2',
      groupHash: f.placement.groupHash, groupJournalHash: hash('aa'), digestVersion: '0x1', digestFingerprint: f.base.digest_fingerprint,
      initialAnchor: f.base.initial_anchor, finalAnchor: hash('82'), memberCount: '0x2' };
    const evidence = { ...observed, readVersion: '0x1b', operationHashes: record.retained.members.map(m => hex(m.hash)),
      payloadCommitments: record.retained.members.map(m => decodeDdbCommitmentEnvelope(Buffer.from(m.envelope.data.slice(2), 'hex').toString()).commitment), transaction };
    f.sourceSend.mockImplementation(async method => method === 'ddb_getPrivateAssignmentEvidence' ? f.assignment : evidence);
    const oldSend = f.send.getMockImplementation()!;
    f.send.mockImplementation(async (method, params) => method === 'ddb_getPrivateTransactionOutcome'
      ? { ...observed, state: 'local_durable', validatorId: Number(params[0].args[2]), payloads: record.retained.sidecars.map(s => s.payload) }
      : method === 'ddb_submitSignedTransaction' ? commitTx : oldSend(method, params));
    expect((await client.custody(id)).every(r => r.state === 'custody_stored')).toBe(true);
    expect(await client.submit(id)).toMatchObject({ committed: false, commitTxHash: commitTx, receiptStored: true });
    expect((await store.load(id)).commitTxHash).toBe(commitTx);
    const resumed = await createDdbPrivateReferenceClient(options).collect(id);
    expect(resumed).toMatchObject({ trust: 'trusted-validating-node', outcome: { committed: true, requiredHosts: [2, 7], durableHosts: [2, 7] } });
    const before = open.mock.calls.length;
    const differentAuthority = createDdbPrivateReferenceClient({ ...options, authority: { ...f.config, source: { ...f.source, url: 'https://different-authority.example' } } });
    await expect(differentAuthority.collect(id)).rejects.toThrow(); expect(open).toHaveBeenCalledTimes(before);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
