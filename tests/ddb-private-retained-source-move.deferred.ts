// Deferred by owner instruction: deliberately not a .test.ts file. Typechecked
// only until the real compiled Go PostgreSQL export exists; no fixture or pass
// result is synthesized. The lane's qualify-source-move.py stages discovery only
// after validating and copying an explicit actual Go export.
import { readFileSync } from 'fs';
import * as fs from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { createSecretKey, randomBytes } from 'crypto';
import { buildDdbPrivateTransaction, decodePrivateTxnMemberV1 } from '../src/ddb-private-txn';
import { decodeDdbCommitmentEnvelope } from '../src/ddb-commitment';
import { createDdbPrivateReferenceClient } from '../src/ddb-private-client-node';
import { createDdbNodePrivateRetryStore } from '../src/ddb-private-retry-node';
import { openPrivateNodeChannel } from '../src/ddb-private-channel-node';
import type { DdbPrivateRetryState } from '../src/ddb-private-retry';

jest.mock('../src/ddb-private-channel-node', () => ({ openPrivateNodeChannel: jest.fn() }));
const open = openPrivateNodeChannel as jest.Mock;
const bytes = (value: string) => new Uint8Array(Buffer.from(value.slice(2), 'hex'));
const hex = (value: Uint8Array) => '0x' + Buffer.from(value).toString('hex');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * The vector is exported by the compiled Go native apply/custody/evidence tests.
 * It contains real PostgreSQL results, group proof, canonical payloads and RPC
 * evidence. Inclusion/current-source callbacks are synthetic in that Go fixture;
 * this replay also mocks transport and READPROC signatures. Actual Store and
 * hybrid TLS have separate suites. Never replace missing Go evidence with a
 * locally invented success response here.
 */
function recordedMove() {
  const file = process.env.NEC_RETAINED_CUSTODY_VECTOR || join(__dirname, 'vectors/private-retained-custody-move-v1.json');
  const vector = JSON.parse(readFileSync(file, 'utf8'));
  const { originalAssignment, currentPlacement, finality, outcomes, sidecars, roots, callerSignatures } = vector;
  expect(Array.isArray(outcomes) && outcomes.length > 0).toBe(true);
  expect(Number.isSafeInteger(vector.observationTime) && vector.observationTime > 0).toBe(true);
  const originalIDs = originalAssignment.placement.members.map((m: any) => m.validatorId);
  const currentIDs = currentPlacement.members.map((m: any) => m.validatorId);
  expect(originalIDs.length).toBeGreaterThan(0);
  expect(currentIDs.length).toBeGreaterThan(0);
  expect(originalIDs.every((id: number) => !currentIDs.includes(id))).toBe(true);
  expect(outcomes.map((o: any) => o.validatorId)).toEqual(originalIDs);
  const members = sidecars.map((s: any) => decodePrivateTxnMemberV1(bytes(s.payload), 4));
  const retained = buildDdbPrivateTransaction({ expectedBase: members[0].base,
    expectedIntents: members.map((m: any) => m.intent), payloads: sidecars.map((s: any) => bytes(s.payload)),
    salts: sidecars.map((s: any) => bytes(s.salt)), digestKey: bytes(vector.digestKey),
    callerPubKey: bytes(vector.callerPublicKey), maxMembers: 4, readVersion: members[0].base.block, reads: [{}] });
  expect(retained.id).toBe(finality.txnId);
  expect(retained.members.map(m => hex(m.hash))).toEqual(finality.operationHashes);
  expect(retained.members.map(m => decodeDdbCommitmentEnvelope(Buffer.from(m.envelope.data.slice(2), 'hex').toString()).commitment))
    .toEqual(finality.payloadCommitments);
  expect(outcomes.every((o: any) => o.txnId === retained.id && o.commitTx === finality.commitTx &&
    JSON.stringify(o.payloads) === JSON.stringify(sidecars.map((s: any) => s.payload)))).toBe(true);
  const sourceMember = originalAssignment.placement.members[0];
  const source = { ...sourceMember, url: 'https://retained-source.example', tlsKeyHash: '0x' + 'ab'.repeat(32) };
  expect(currentIDs).not.toContain(source.validatorId);
  const authority = { trust: 'trusted-validating-node' as const, chain: finality.chain, database: finality.database,
    caller: finality.caller, source };
  const state: DdbPrivateRetryState = { kind: 'private-client-retry-v1', authority, phase: 'submission_attempted',
    commitTxHash: finality.commitTx, policy: { custodyHosts: originalIDs, requiredHosts: originalIDs, submitRecipient: originalIDs[0] },
    record: { kind: 'private-transaction-retry-v1', retained, signedMembers: retained.members.map((m, i) =>
      ({ ...m.envelope, callerSig: callerSignatures[i] })), completePlacement: originalAssignment.placement, maxMembers: 4, roots } };
  return { vector, originalAssignment, currentPlacement, finality, outcomes, originalIDs, source, authority, state };
}

beforeEach(() => open.mockReset());

type MoveFixture = ReturnType<typeof recordedMove> & {
  sourceSend: jest.Mock; hostSend: jest.Mock; missingHosts: Set<number>;
  store: ReturnType<typeof createDdbNodePrivateRetryStore>;
  options: Parameters<typeof createDdbPrivateReferenceClient>[0];
  resolveCurrent: jest.Mock; hostEndpoints: jest.Mock; loadDigestKey: jest.Mock;
  client: ReturnType<typeof createDdbPrivateReferenceClient>;
};

async function persistedMove(run: (fixture: MoveFixture) => Promise<void>) {
  const f = recordedMove(), clock = jest.spyOn(Date, 'now').mockReturnValue(f.vector.observationTime * 1000);
  const root = resolve(tmpdir()), prefix = 'nec-custody-source-move-';
  const directory = await fs.mkdtemp(join(root, prefix));
  async function start() {
    const key = createSecretKey(randomBytes(32));
    const storeOptions = { directory, key: async () => key, sync: 'file' as const };
    const writer = createDdbNodePrivateRetryStore(storeOptions);
    await writer.create({ ...f.state, phase: 'prepared', commitTxHash: null });
    await writer.beginSubmission(f.state.record.retained.id);
    await writer.recordSubmission(f.state.record.retained.id, f.finality.commitTx);
    // Reopen the real encrypted retry store. The current source identity remains
    // the exact authority persisted before the group replacement.
    const store = createDdbNodePrivateRetryStore(storeOptions);
    expect(await store.load(f.state.record.retained.id)).toEqual(f.state);
    const missingHosts = new Set<number>();
    const sourceSend = jest.fn(async (method: string, params: any[]): Promise<any> => {
      if (method === 'eth_chainId') return '0x' + BigInt(f.authority.chain).toString(16);
      if (method === 'ddb_hostEndpoints') {
        expect(params).toHaveLength(1);
        return { directory: f.originalAssignment.endpointDirectory, block: Number(BigInt(f.currentPlacement.block)),
          blockTime: f.vector.observationTime, hosts: params[0].map((id: number) => ({ validatorId: id,
            auth: f.source.address, live: true, status: 'live', expiry: f.vector.observationTime + 60,
            endpoints: [{ scheme: 'https', url: `https://original${id}.example`, tlsKeyHash: '0x' + 'cd'.repeat(32) }] })) };
      }
      const request = params[0];
      expect(request.schemaName).toBe(f.authority.database);
      expect(request.from).toBe(f.authority.caller);
      expect(request.args[0]).toBe(String(f.source.validatorId));
      if (method === 'ddb_getPrivateAssignmentEvidence') {
        expect(request.args).toEqual([String(f.source.validatorId), f.originalAssignment.placement.block]);
        return copy(f.originalAssignment);
      }
      if (method === 'ddb_getPrivateTransactionFinalityEvidence') {
        expect(request.args).toEqual([String(f.source.validatorId), f.finality.block, f.finality.commitTx]);
        return copy(f.finality);
      }
      throw new Error('recorded nonmember source does not authorize snapshot preparation');
    });
    const hostSend = jest.fn(async (id: number, method: string, params: any[]): Promise<any> => {
      expect(method).toBe('ddb_getPrivateTransactionOutcome');
      expect(params[0].args).toEqual([f.state.record.retained.id, f.finality.commitTx, String(id), 'result']);
      if (missingHosts.has(id)) throw new Error('original native outcome unavailable');
      const outcome = f.outcomes.find((o: any) => o.validatorId === id);
      if (!outcome) throw new Error('no original native result');
      return copy(outcome);
    });
    open.mockImplementation(async (url: string, pin: string, methods: readonly string[]) => {
      const isSource = url === f.source.url;
      if (isSource) expect(pin).toBe(f.source.tlsKeyHash);
      const id = isSource ? 0 : Number(/^https:\/\/original([0-9]+)\.example$/.exec(url)?.[1]);
      if (!isSource) { expect(f.originalIDs).toContain(id); expect(pin).toBe('0x' + 'cd'.repeat(32)); }
      return { endpointAuthenticated: true, confidentiality: 'post-quantum', negotiatedGroup: 'X25519MLKEM768', close: jest.fn(),
        async send(method: string, params: any[]) {
          expect(methods).toContain(method);
          return isSource ? sourceSend(method, params) : hostSend(id, method, params);
        } };
    });
    const resolveCurrent = jest.fn(async () => copy(f.currentPlacement));
    const hostEndpoints = jest.fn(async () => { throw new Error('untrusted discovery is not authority'); });
    const loadDigestKey = jest.fn(async (): Promise<Uint8Array> => { throw new Error('collection cannot reprepare the transaction'); });
    const signer = { getAddress: () => f.authority.caller, getPublicKey: () => bytes(f.vector.callerPublicKey),
      signDdbHash: jest.fn(async () => new Uint8Array(4627).fill(0x5a)) };
    const options = { authority: { ...f.authority, signer }, store, resolver: { resolveCurrent, hostEndpoints }, loadDigestKey };
    return { ...f, sourceSend, hostSend, missingHosts, store, options, resolveCurrent, hostEndpoints, loadDigestKey,
      client: createDdbPrivateReferenceClient(options) };
  }
  try { await run(await start()); }
  finally {
    clock.mockRestore();
    const target = resolve(directory);
    if (dirname(target) !== root || !basename(target).startsWith(prefix)) throw new Error('unexpected test cleanup directory');
    await fs.rm(target, { recursive: true, force: true });
  }
}

test('Go-recorded complete group replacement collects through the unchanged persisted evidence source', async () => {
  await persistedMove(async f => {
    const result = await f.client.collect(f.state.record.retained.id);
    expect(result.outcome).toMatchObject({ committed: true, requiredHosts: f.originalIDs, durableHosts: f.originalIDs });
    expect(f.sourceSend.mock.calls.map(c => c[0])).toEqual(['ddb_getPrivateAssignmentEvidence', 'eth_chainId',
      'ddb_hostEndpoints', 'ddb_getPrivateTransactionFinalityEvidence']);
    expect(f.hostSend.mock.calls.map(c => c[0])).toEqual(f.originalIDs);
    expect(f.resolveCurrent).not.toHaveBeenCalled();
    expect(f.hostEndpoints).not.toHaveBeenCalled();
    expect(f.loadDigestKey).not.toHaveBeenCalled();
    expect((await f.store.load(f.state.record.retained.id)).authority.source).toEqual(f.source);
  });
});

test('Go-recorded full replacement cannot substitute a new host for an unavailable original native outcome', async () => {
  await persistedMove(async f => {
    f.missingHosts.add(f.originalIDs[0]);
    const result = await f.client.collect(f.state.record.retained.id);
    expect(result.outcome).toMatchObject({ committed: false, reason: 'awaiting_hosts', requiredHosts: f.originalIDs,
      hosts: [{ validatorId: f.originalIDs[0], state: 'unavailable' }] });
    expect(f.hostSend.mock.calls.map(c => c[0])).toEqual(f.originalIDs);
    expect(f.sourceSend.mock.calls.some(c => c[0] === 'ddb_getPrivateTransactionFinalityEvidence')).toBe(false);
  });
});

test('Go-recorded full replacement preserves exact persisted source authority before any network work', async () => {
  await persistedMove(async f => {
    const replacement = f.currentPlacement.members[0];
    const client = createDdbPrivateReferenceClient({ ...f.options, authority: { ...f.options.authority,
      source: { ...f.source, ...replacement, url: 'https://new-source.example' } } });
    await expect(client.collect(f.state.record.retained.id)).rejects.toThrow('private reference client unavailable');
    expect(open).not.toHaveBeenCalled();
    expect((await f.store.load(f.state.record.retained.id)).authority.source).toEqual(f.source);
  });
});
