import { readFileSync } from 'fs';
import { join } from 'path';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { Ddb, buildDdbTransaction, type DdbSigner } from '../src/ddb';
import { decodePrivateTxnMemberV1, encodePrivateTxnMemberV1 } from '../src/ddb-private-txn';
import { decodeDdbCommitmentEnvelope } from '../src/ddb-commitment';
import { collectDdbPrivateTransactionOutcome } from '../src/ddb-private-txn-outcome';
import { parseDdbCurrentReadRoute } from '../src/ddb-private-read';
import { PLACEMENT_MANAGER_RUNTIME_CODE_HASH } from '../src/ddb-proof';
import {
  prepareDdbPrivateTransaction, storeDdbPrivateTransactionPayloads, submitDdbPrivateTransaction,
  type DdbPrivateTransactionPrepareInput,
} from '../src/ddb-private-txn-online';

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
const hash = (b: string) => '0x' + b.repeat(32);
const caller = '0x' + '22'.repeat(20);
const contract = '0x' + '11'.repeat(20);
const database = 'c_' + contract.slice(2);
const chain = '0x' + BigInt(2570).toString(16).padStart(64, '0');
const pub = new Uint8Array(2592).fill(1);
const sig = new Uint8Array(4627).fill(2);
const digestKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const vector = new Uint8Array(readFileSync(join(__dirname, 'vectors/private-txn-member-v1.json')));
const tag = 'EBCtfNMVnBzfD2oOXnstz7BVQ6zaH9OEHns4ETdg5BQ=';
const commit = hash('88');

function fixture(count = 2) {
  const placement = parseDdbCurrentReadRoute(contract, { contract, database, enabled: true, private: true,
    block: '0x1b', blockHash: hash('44'), stateRoot: hash('55'), epoch: '0x3', manager: '0x' + '66'.repeat(20),
    runtimeHash: PLACEMENT_MANAGER_RUNTIME_CODE_HASH, version: '0x2',
    groupHash: hex(keccak_256(Buffer.from([2, 7, 9].map(id => id.toString(16).padStart(64, '0')).join(''), 'hex'))),
    members: [2, 7, 9].map(validatorId => ({ validatorId, address: '0x' + validatorId.toString(16).padStart(40, '0') })) });
  const base = decodePrivateTxnMemberV1(vector, 4).base;
  Object.assign(base, { chain, database, contract, caller, block: BigInt(27), block_hash: placement.blockHash,
    state_root: placement.stateRoot, epoch: BigInt(3), manager: placement.manager, manager_runtime: placement.runtimeHash,
    placement_version: BigInt(2), group_hash: placement.groupHash, digest_version: BigInt(1),
    digest_fingerprint: hex(sha256(digestKey)), initial_anchor: hash('77') });
  base.context.definition.contract_address = contract;
  let preview: any[] = [];
  const alterPreview = jest.fn((p: any[]) => p);
  const send = jest.fn(async (method: string, params: any[]): Promise<any> => {
    if (method === 'ddb_previewPrivateBatch') {
      preview = params[0].map((e: any, i: number) => {
        const m = decodePrivateTxnMemberV1(vector, 4);
        m.index = BigInt(i); m.count = BigInt(params[0].length); m.base = base;
        m.intent = { type: BigInt(7), data: Uint8Array.from(Buffer.from(e.data.slice(2), 'hex')),
          timestamp: BigInt(e.timestamp), gas_limit: BigInt(e.gasLimit), nonce: BigInt(e.nonce), expiry: BigInt(e.expiry), key_version: BigInt(e.keyVersion) };
        return { payload: hex(encodePrivateTxnMemberV1(m, 4)), placementVersion: '0x2', digestKeyVersion: '0x1',
          stateDelta: { added: [tag, tag] }, prior: i ? hash('81') : base.initial_anchor, post: hash(i ? '82' : '81') };
      });
      return alterPreview(preview);
    }
    if (method === 'ddb_putPayloadBatch') return params[0].map((e: any) => decodeDdbCommitmentEnvelope(Buffer.from(e.data.slice(2), 'hex').toString()).commitment);
    if (method === 'ddb_submitSignedTransaction') return commit;
    throw new Error('unexpected method');
  });
  const resolveCurrent = jest.fn(async () => placement);
  const hostEndpoints = jest.fn(async (ids?: number[]): Promise<any[]> => (ids ?? []).map(validatorId => ({ validatorId, live: true,
    endpoints: [{ scheme: 'https', url: `https://host${validatorId}.example`, tlsKeyHash: hash('bb') }] })));
  const close = jest.fn();
  const verifyAssignment = jest.fn(async () => true);
  const connect = jest.fn(async (r: any): Promise<any> => ({ binding: { route: r.route, validatorId: r.member.validatorId,
    address: r.member.address, url: r.endpoints[0].url, tlsKeyHash: r.endpoints[0].tlsKeyHash }, endpointAuthenticated: true,
    confidentiality: 'post-quantum', send, close }));
  const signDdbHash = jest.fn(async (_hash: Uint8Array) => sig.slice());
  const signer: DdbSigner = { getAddress: () => caller, getPublicKey: () => pub.slice(), signDdbHash };
  const acceptPreparedSnapshot = jest.fn(async (_request: any) => ({ expectedBase: base, completePlacement: placement }));
  const input: DdbPrivateTransactionPrepareInput = { signer, resolver: { resolveCurrent, hostEndpoints }, policy: { verifyAssignment, connect },
    chain, caller, database, validatorId: 7, maxMembers: 4, digestKey: digestKey.slice(), keyVersion: BigInt(1),
    timestamp: 1800000000, expiry: BigInt(1800000300),
    members: Array.from({ length: count }, (_, i) => ({ data: '{"procedure":"transfer","args":[9007199254740993]}', gasLimit: 1000, nonce: BigInt(100 + i) })),
    acceptPreparedSnapshot };
  return { input, base, placement, send, alterPreview, resolveCurrent, hostEndpoints, close, verifyAssignment, connect, signDdbHash, acceptPreparedSnapshot };
}

test.each([1, 2])('prepares %i-member exact op7 array and returns final signed retry record before mutations', async count => {
  const f = fixture(count); const record = await prepareDdbPrivateTransaction(f.input);
  expect(f.send.mock.calls.map(c => c[0])).toEqual(['ddb_previewPrivateBatch']);
  expect(record.kind).toBe('private-transaction-retry-v1'); expect(record.retained.members).toHaveLength(count);
  const preparation = buildDdbTransaction(f.input.members.map(m => ({ ...m, typeName: 'callprocedure', schemaName: database })), caller, pub,
    { chainId: chain, timestamp: f.input.timestamp, expiry: f.input.expiry, keyVersion: f.input.keyVersion, readVersion: 0, reads: [] });
  expect(f.send.mock.calls[0][1]).toEqual([preparation.members.map(m => ({ ...m.envelope, callerSig: hex(sig) }))]);
  expect(record.retained.id).not.toBe(preparation.id);
  expect(f.signDdbHash.mock.calls.map(c => hex(c[0]))).toEqual([...preparation.members, ...record.retained.members].map(m => hex(m.hash)));
  expect(record.retained.members[0].envelope.txn).toMatchObject({ read_version: 27, reads: [{}] });
  record.signedMembers.forEach((m, i) => expect(m).toEqual({ ...record.retained.members[i].envelope, callerSig: hex(sig) }));
  expect(record.retained.members[0].envelope.stateDelta).toEqual({ added: [tag, tag] });
  expect(record).not.toHaveProperty('digestKey'); expect(record).not.toHaveProperty('signer');
  expect(f.input.digestKey).toEqual(digestKey); expect(f.close).toHaveBeenCalledTimes(1);
});

test('independently accepted BASE context cannot be replaced with canonical host preview context', async () => {
  const f = fixture();
  f.acceptPreparedSnapshot.mockImplementation(async () => ({ expectedBase: { ...f.base, context: { ...f.base.context, owner: '0x' + 'ee'.repeat(20) } }, completePlacement: f.placement }));
  await expect(prepareDdbPrivateTransaction(f.input)).rejects.toThrow();
  expect(f.signDdbHash).toHaveBeenCalledTimes(2); // Preparation only, never sign host-substituted final payloads.
  expect(f.send.mock.calls.map(c => c[0])).toEqual(['ddb_previewPrivateBatch']);
});

test('preview intent, canonical bytes, keyed tags and root links refuse substitutions', async () => {
  for (const change of [
    (p: any[]) => { p[0].stateDelta.added[0] = 'A'.repeat(43) + '='; },
    (p: any[]) => { p[0].stateDelta.added.pop(); },
    (p: any[]) => { p[0].prior = hash('ee'); },
    (p: any[]) => { p[1].prior = hash('ee'); },
    (p: any[]) => { p[0].post = '0x01'; },
    (p: any[]) => { p[0].placementVersion = '0x3'; },
    (p: any[]) => { const m = decodePrivateTxnMemberV1(Buffer.from(p[0].payload.slice(2), 'hex'), 4); m.intent.nonce++; p[0].payload = hex(encodePrivateTxnMemberV1(m, 4)); },
  ]) {
    const f = fixture(); f.alterPreview.mockImplementation(p => { change(p); return p; });
    await expect(prepareDdbPrivateTransaction(f.input)).rejects.toThrow();
    expect(f.signDdbHash).toHaveBeenCalledTimes(2);
  }
});

test('wrong digest key and untrusted route/recipient refuse without mutation or key disclosure', async () => {
  const f = fixture(); f.input.digestKey.fill(9);
  await expect(prepareDdbPrivateTransaction(f.input)).rejects.toThrow();
  expect(JSON.stringify(f.send.mock.calls)).not.toContain(hex(f.input.digestKey));
  const other = fixture(); other.verifyAssignment.mockResolvedValue(false);
  await expect(prepareDdbPrivateTransaction(other.input)).rejects.toThrow();
  expect(other.signDdbHash).not.toHaveBeenCalled(); expect(other.send).not.toHaveBeenCalled();
  const missing = fixture(); missing.input.validatorId = 99;
  await expect(prepareDdbPrivateTransaction(missing.input)).rejects.toThrow();
  expect(missing.send).not.toHaveBeenCalled();
});

test('snapshot acceptance receives no digest key through arguments or callback receiver', async () => {
  const f = fixture(1); let receiver: unknown; let request: any;
  f.input.acceptPreparedSnapshot = async function (this: unknown, value) {
    receiver = this; request = value; return { expectedBase: f.base, completePlacement: f.placement };
  };
  await prepareDdbPrivateTransaction(f.input);
  expect(receiver).toBeUndefined(); expect(request).not.toHaveProperty('digestKey');
  expect(JSON.stringify(request, (_k, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(hex(digestKey));
});

test('empty no-op effects accept absent preview delta and produce explicit empty final delta', async () => {
  const f = fixture(1); f.alterPreview.mockImplementation(p => {
    const m = decodePrivateTxnMemberV1(Buffer.from(p[0].payload.slice(2), 'hex'), 4);
    m.effect = { added: [], removed: [] }; p[0].payload = hex(encodePrivateTxnMemberV1(m, 4));
    delete p[0].stateDelta; p[0].post = p[0].prior; return p;
  });
  const record = await prepareDdbPrivateTransaction(f.input);
  expect(record.signedMembers[0].stateDelta).toEqual({});
});

test('explicit custody and submission preserve one exact signed unit and remain pending', async () => {
  const f = fixture(); const record = await prepareDdbPrivateTransaction(f.input); f.send.mockClear();
  const common = { record, resolver: f.input.resolver, policy: f.input.policy, validatorId: 2 };
  const custody = await storeDdbPrivateTransactionPayloads(common);
  expect(custody).toMatchObject({ state: 'custody_stored', committed: false, validatorId: 2 });
  expect(f.send.mock.calls[0]).toEqual(['ddb_putPayloadBatch', [record.signedMembers, record.retained.sidecars]]);
  const submitted = await submitDdbPrivateTransaction({ ...common, validatorId: 7 });
  expect(submitted).toMatchObject({ state: 'pending', committed: false, commitTxHash: commit, txnId: record.retained.id });
  expect(f.send.mock.calls[1]).toEqual(['ddb_submitSignedTransaction', [record.signedMembers]]);
  expect(f.connect).toHaveBeenCalledTimes(3); expect(f.signDdbHash).toHaveBeenCalledTimes(4);
});

test('custody mismatch and lost submit reply are bounded unknown without automatic reprepare or resend', async () => {
  const f = fixture(); const record = await prepareDdbPrivateTransaction(f.input); f.send.mockClear();
  const input = { record, resolver: f.input.resolver, policy: f.input.policy, validatorId: 7 };
  f.send.mockResolvedValue([hash('ee')]);
  expect(await storeDdbPrivateTransactionPayloads(input)).toMatchObject({ state: 'custody_unknown', committed: false });
  f.send.mockRejectedValue(new Error('secret SQL after submit'));
  const unknown = await submitDdbPrivateTransaction(input);
  expect(unknown).toMatchObject({ state: 'pending', committed: false, commitTxHash: null, txnId: record.retained.id });
  expect(JSON.stringify(unknown)).not.toContain('secret'); expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.signDdbHash).toHaveBeenCalledTimes(4);
});

test('changed record, signed-member pairing and placement refuse before private send', async () => {
  for (const change of [
    (r: any) => { r.retained.sidecars[0].salt = hash('ee'); },
    (r: any) => { r.signedMembers[0].nonce = '0xee'; },
    (r: any) => { r.signedMembers[0].callerSig = '0x00'; },
    (r: any) => { r.signedMembers[0].stateDelta.added.pop(); },
  ]) {
    const f = fixture(); const record = await prepareDdbPrivateTransaction(f.input); change(record); f.send.mockClear(); f.connect.mockClear();
    await expect(submitDdbPrivateTransaction({ record, resolver: f.input.resolver, policy: f.input.policy, validatorId: 7 })).rejects.toThrow();
    expect(f.connect).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  }
  const f = fixture(); const record = await prepareDdbPrivateTransaction(f.input); f.send.mockClear();
  f.resolveCurrent.mockResolvedValue({ ...f.placement, version: '0x3' });
  expect(await submitDdbPrivateTransaction({ record, resolver: f.input.resolver, policy: f.input.policy, validatorId: 7 })).toMatchObject({ commitTxHash: null });
  expect(f.send).not.toHaveBeenCalled();
});

test('async caller and callback mutations cannot retarget prepare or exact retry bytes', async () => {
  const f = fixture(); let release!: () => void;
  f.acceptPreparedSnapshot.mockImplementation(async request => {
    request.previewMembers[0].intent.data.fill(0); request.localIntents[0].data.fill(0);
    await new Promise<void>(resolve => { release = resolve; }); return { expectedBase: f.base, completePlacement: f.placement };
  });
  const pending = prepareDdbPrivateTransaction(f.input);
  while (!release) await Promise.resolve();
  f.input.digestKey.fill(0); f.input.members[0].data = '{}'; f.input.validatorId = 2; release();
  const record = await pending;
  expect(record.retained.members[0].envelope.from).toBe(caller);
  const original = JSON.stringify(record.signedMembers);
  let unblock!: () => void; f.verifyAssignment.mockImplementation(async () => { await new Promise<void>(resolve => { unblock = resolve; }); return true; });
  const submit = submitDdbPrivateTransaction({ record, resolver: f.input.resolver, policy: f.input.policy, validatorId: 7 });
  while (!unblock) await Promise.resolve();
  record.signedMembers[0].nonce = '0xee'; record.retained.sidecars[0].payload = '0x00'; unblock();
  expect((await submit).commitTxHash).toBe(commit);
  expect(JSON.stringify(f.send.mock.calls[f.send.mock.calls.length - 1][1][0])).toBe(original);
});

test('returned retained record composes with explicit durability and independent finality collector', async () => {
  const f = fixture(); const record = await prepareDdbPrivateTransaction(f.input);
  f.send.mockImplementation(async (_method, params) => ({ state: 'local_durable', validatorId: Number(params[0].args[2]), chain, database, caller,
    txnId: record.retained.id, commitTx: commit, block: '0x20', blockHash: hash('99'), placementVersion: '0x2',
    groupHash: f.placement.groupHash, groupJournalHash: hash('aa'), digestVersion: '0x1', digestFingerprint: f.base.digest_fingerprint,
    initialAnchor: f.base.initial_anchor, finalAnchor: hash('82'), memberCount: '0x2', payloads: record.retained.sidecars.map(s => s.payload) }));
  const result = await collectDdbPrivateTransactionOutcome({ signer: f.input.signer, resolver: f.input.resolver, policy: f.input.policy,
    chain, database, caller, txnId: record.retained.id, expectedCommitTx: commit, maxMembers: record.maxMembers,
    retained: record.retained, completePlacement: record.completePlacement, requiredHosts: [2, 7],
    verifyHistoricalPlacement: async () => true, verifyFinality: async () => true });
  expect(result.committed).toBe(true);
});

test('generic auto-provider paths refuse private routing, final units and extracted transaction members', async () => {
  const f = fixture(); const record = await prepareDdbPrivateTransaction(f.input);
  const send = jest.fn(async () => commit); const ddb = new Ddb({ send } as any);
  await expect(ddb.submitSignedTransaction(record.retained, record.signedMembers.map(m => m.callerSig))).rejects.toThrow(/private/);
  await expect(ddb.submitSignedOpDetailed({ ...record.retained.members[0], requestId: hash('ee') }, sig)).rejects.toThrow(/transaction/);
  const privateDdb = new Ddb({ send } as any, { privateRouting: { policy: f.input.policy } });
  const attempt = jest.fn(async () => ({ members: [] }));
  await expect(privateDdb.runTransaction(f.input.signer, attempt)).rejects.toThrow(/private/);
  await expect(privateDdb.submitOperationSigned(f.input.signer, 'callprocedure', database, {})).rejects.toThrow(/private/);
  await expect(privateDdb.waitForCommitted(commit)).rejects.toThrow(/private/);
  expect(attempt).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});

test('generic committed wait rejects authenticated-outcome success bait while public waits stay unchanged', async () => {
  const send = jest.fn(async () => ({ status: 'applied', blockNumber: '32', durable: true, readToken: '32', requiresAuthenticatedOutcome: true }));
  const ddb = new Ddb({ send } as any);
  await expect(ddb.waitForCommitted(commit)).rejects.toThrow(/authenticated.*outcome/);
  send.mockResolvedValue({ status: 'applied', blockNumber: '32', durable: true, readToken: '32' } as any);
  expect(await ddb.waitForCommitted(commit)).toMatchObject({ committed: true, readToken: '32' });
});

test.each([true, false])('generic retry loop never reruns SQL after an authenticated-outcome refusal with retryable skip bait: %s', async markedAgain => {
  const f = fixture();
  const ddb = new Ddb({ send: jest.fn() } as any);
  jest.spyOn(ddb, 'submitTransactionSigned').mockResolvedValue({ id: hash('99'), commitTxHash: commit, operationHashes: [] });
  jest.spyOn(ddb, 'getCommitStatus').mockResolvedValue({ txHash: commit, status: 'skipped',
    requiresAuthenticatedOutcome: markedAgain, reason: 'txn_read_conflict' }).mockResolvedValueOnce({ txHash: commit,
    status: 'skipped', requiresAuthenticatedOutcome: true, reason: 'txn_read_conflict' });
  const attempt = jest.fn(async () => ({ members: [] }));
  await expect(ddb.runTransaction(f.input.signer, attempt)).rejects.toThrow(/authenticated.*outcome/);
  expect(attempt).toHaveBeenCalledTimes(1);
});

test('generic endorsement waits refuse explicit private status before interpreting completion', async () => {
  const ddb = new Ddb({ send: jest.fn(async () => ({ status: 'completed', committed: true, requiresAuthenticatedOutcome: true })) } as any);
  await expect(ddb.waitForEndorsement(hash('99'))).rejects.toThrow(/authenticated.*outcome/);
});

test('legacy mutation helpers refuse explicit private routing before serialization or provider while public wire stays unchanged', async () => {
  const f = fixture(); const send = jest.fn(async () => commit);
  const privateDdb = new Ddb({ send } as any, { privateRouting: { policy: f.input.policy } });
  const publicDdb = new Ddb({ send } as any); const serialize = jest.fn(() => ({ contract_address: contract }));
  const definition = { toJSON: serialize } as any;
  const calls = [
    (ddb: Ddb) => ddb.createSchema(caller, 'contract_name', definition),
    (ddb: Ddb) => ddb.callProcedure(caller, database, 'transfer', ['private-argument']),
    (ddb: Ddb) => ddb.grantRole(caller, database, 'writer', caller),
    (ddb: Ddb) => ddb.revokeRole(caller, database, 'writer', caller),
  ];
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    for (const call of calls) expect(() => call(privateDdb)).toThrow(/private/);
    expect(serialize).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    for (const call of calls) await expect(call(publicDdb)).resolves.toBe(commit);
    expect(send.mock.calls).toEqual([
      ['ddb_createSchema', [caller, 'contract_name', JSON.stringify({ contract_address: contract })]],
      ['ddb_callProcedure', [caller, database, 'transfer', ['private-argument']]],
      ['ddb_grantRole', [caller, database, 'writer', caller]],
      ['ddb_revokeRole', [caller, database, 'writer', caller]],
    ]);
  } finally { warning.mockRestore(); }
});
