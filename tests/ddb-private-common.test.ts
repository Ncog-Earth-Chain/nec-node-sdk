import { createDdbTrustedPrivatePolicy, type DdbTrustedPrivateOptions } from '../src/ddb-private-trust';
import { createDdbPrivateClient } from '../src/ddb-private-client';
import { ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH } from '../src/ddb-private-evidence';
import { encodePrivateTxnBaseV1 } from '../src/ddb-private-txn';
import { decodeDdbPrivateRetryState, encodeDdbPrivateRetryState, type DdbPrivateRetryState } from '../src/ddb-private-retry';
import { privateClientFixture, hex, hash, caller, database, chain, pub } from './fixtures/private-client';

// Synthetic chain/channel observations exercise composition, not TLS or portable proof verification.
function fixture() {
  const f = privateClientFixture();
  const source = { validatorId: 9, address: f.placement.members[2].address, url: 'https://authority.example', tlsKeyHash: hash('cc') };
  const assignment = { chain, placement: f.placement, maxMembers: '0x4', endpointDirectory: '0x' + 'ab'.repeat(20),
    endpointRuntime: ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH, blockTime: '0x1', hosts: f.placement.members.map(m => ({ ...m,
      publicKey: hex(pub), auth: '0x' + 'ad'.repeat(20), expiry: '0xffffffffffffffff', live: true,
      endpoints: [{ scheme: 'https', url: `https://host${m.validatorId}.example`, tlsKeyHash: hash('bb') }] })) };
  const closeEvidence = jest.fn();
  const sourceSend = jest.fn(async (method: string, _params: readonly unknown[]): Promise<unknown> => {
    if (method === 'ddb_getPrivateAssignmentEvidence') return assignment;
    if (method === 'ddb_getPrivateTransactionSnapshotEvidence') return { base: hex(encodePrivateTxnBaseV1(f.base)), placement: f.placement, maxMembers: '0x4' };
    throw new Error('no independent finality');
  });
  const connectEvidence = jest.fn(async (binding: typeof source) => ({ binding: { ...binding }, send: sourceSend, close: closeEvidence }));
  const connectHost = jest.fn(async (_connection: Parameters<DdbTrustedPrivateOptions['connectHost']>[0], binding: Parameters<DdbTrustedPrivateOptions['connectHost']>[1]) => ({
    binding, endpointAuthenticated: true as const, confidentiality: 'post-quantum' as const, send: f.send, close: f.close }));
  const options: DdbTrustedPrivateOptions = { trust: 'trusted-validating-node', chain, database, caller, source,
    signer: f.input.signer, connectEvidence, connectHost };
  const trust = createDdbTrustedPrivatePolicy(options);
  const states = new Map<string, Uint8Array>();
  const store = {
    create: jest.fn(async (s: DdbPrivateRetryState) => { if (states.has(s.record.retained.id)) throw new Error('exists'); states.set(s.record.retained.id, encodeDdbPrivateRetryState(s)); }),
    load: jest.fn(async (id: string) => decodeDdbPrivateRetryState(states.get(id)!)),
    beginSubmission: jest.fn(async (id: string) => {
      const s = decodeDdbPrivateRetryState(states.get(id)!);
      if (s.phase !== 'prepared') throw new Error('attempted');
      s.phase = 'submission_attempted'; states.set(id, encodeDdbPrivateRetryState(s)); return s;
    }),
    recordSubmission: jest.fn(async (id: string, commit: string) => {
      const s = decodeDdbPrivateRetryState(states.get(id)!); s.commitTxHash = commit; states.set(id, encodeDdbPrivateRetryState(s));
    }),
  };
  const digest = f.input.digestKey.slice(), loadDigestKey = jest.fn(async () => digest);
  const clientOptions = { authority: options, resolver: f.input.resolver, store, loadDigestKey };
  const prepare = { members: f.input.members, keyVersion: BigInt(1), timestamp: f.input.timestamp, expiry: f.input.expiry,
    prepareRecipient: 7, custodyHosts: [2, 7], requiredHosts: [2, 7], submitRecipient: 7 };
  return { ...f, source, assignment, sourceSend, closeEvidence, connectEvidence, connectHost, options, trust, store, clientOptions, prepare, digest, loadDigestKey };
}

test('common policy requires concrete connectors and captures exact source and callback ownership', async () => {
  const f = fixture();
  (f.options as any).source = { ...f.source, tlsKeyHash: hash('ee') };
  f.options.connectEvidence = jest.fn(async () => { throw new Error('replaced'); });
  expect((await f.trust.readCurrentAssignment()).placement).toEqual(f.placement);
  expect(f.connectEvidence).toHaveBeenCalledWith(f.source);
  expect(f.sourceSend.mock.calls[0][0]).toBe('ddb_getPrivateAssignmentEvidence');
  expect((f.sourceSend.mock.calls[0][1][0] as any).args).toEqual(['9', 'current']);
  expect(f.closeEvidence).toHaveBeenCalledTimes(1);
  expect(() => createDdbTrustedPrivatePolicy({ ...f.options, connectHost: undefined } as any)).toThrow();
  expect(() => createDdbTrustedPrivatePolicy({ ...f.options, connectEvidence: undefined } as any)).toThrow();
});

test('common source channel mismatch refuses before signing or sending and closes the channel', async () => {
  const f = fixture();
  f.connectEvidence.mockImplementation(async binding => ({ binding: { ...binding, tlsKeyHash: hash('ee') }, send: f.sourceSend, close: f.closeEvidence }));
  await expect(f.trust.readCurrentAssignment()).rejects.toThrow('private evidence unavailable');
  expect(f.signDdbHash).not.toHaveBeenCalled(); expect(f.sourceSend).not.toHaveBeenCalled();
  expect(f.closeEvidence).toHaveBeenCalledTimes(1);
});

test('common host connector receives independently trusted full binding and rejects a substituted channel', async () => {
  const f = fixture(), member = f.placement.members[1], endpoints = f.assignment.hosts[1].endpoints;
  const request = { route: f.placement, member, endpoints };
  await f.trust.policy.connect(request);
  expect(f.connectHost).toHaveBeenCalledWith(request, { route: f.placement, ...member, url: endpoints[0].url, tlsKeyHash: endpoints[0].tlsKeyHash });
  f.connectHost.mockImplementation(async (_request, binding) => ({ binding: { ...binding, tlsKeyHash: hash('ee') },
    endpointAuthenticated: true, confidentiality: 'post-quantum', send: f.send, close: f.close }));
  await expect(f.trust.policy.connect(request)).rejects.toThrow(); expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.send).not.toHaveBeenCalled();
  await expect(f.trust.policy.connect({ ...request, route: { ...f.placement, blockHash: hash('ee') } })).rejects.toThrow();
  expect(f.connectHost).toHaveBeenCalledTimes(2);
});

test('common client uses exact retry codec and persists attempt before submit then resumes collection without reprepare', async () => {
  const f = fixture(), client = createDdbPrivateClient(f.clientOptions);
  const id = await client.prepare(f.prepare);
  expect((await f.store.load(id)).phase).toBe('prepared'); expect(f.digest.every(b => b === 0)).toBe(true);
  await client.custody(id);
  const oldSend = f.send.getMockImplementation()!;
  f.send.mockImplementation(async (method, params) => {
    if (method === 'ddb_submitSignedTransaction') {
      expect((await f.store.load(id)).phase).toBe('submission_attempted'); throw new Error('lost reply');
    }
    return oldSend(method, params);
  });
  expect(await client.submit(id)).toMatchObject({ committed: false, commitTxHash: null });
  await expect(createDdbPrivateClient(f.clientOptions).submit(id)).rejects.toThrow();
  expect((await createDdbPrivateClient(f.clientOptions).collect(id)).outcome.committed).toBe(false);
  expect(f.loadDigestKey).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls.filter(c => c[0] === 'ddb_submitSignedTransaction')).toHaveLength(1);
});

test('common client storage and authority refusal prevents custody or submit and preserves explicit host policy', async () => {
  const f = fixture(), client = createDdbPrivateClient(f.clientOptions);
  const id = await client.prepare(f.prepare);
  f.store.beginSubmission.mockRejectedValueOnce(new Error('checkpoint unavailable'));
  // Bind the overridden store method at construction, as the reviewed reference client does.
  await expect(createDdbPrivateClient(f.clientOptions).submit(id)).rejects.toThrow();
  expect(f.send.mock.calls.filter(c => c[0] === 'ddb_submitSignedTransaction')).toHaveLength(0);
  const changed = createDdbPrivateClient({ ...f.clientOptions, authority: { ...f.options, source: { ...f.source, url: 'https://other.example' } } });
  const sends = f.send.mock.calls.length;
  await expect(changed.custody(id)).rejects.toThrow(); expect(f.send).toHaveBeenCalledTimes(sends);
  expect((await f.store.load(id)).policy).toEqual({ custodyHosts: [2, 7], requiredHosts: [2, 7], submitRecipient: 7 });
  f.store.create.mockRejectedValueOnce(new Error('disk full'));
  await expect(createDdbPrivateClient({ ...f.clientOptions, loadDigestKey: async () => f.input.digestKey.slice() }).prepare(f.prepare)).rejects.toThrow();
  expect(f.send.mock.calls.filter(c => c[0] !== 'ddb_previewPrivateBatch')).toHaveLength(0);
});
