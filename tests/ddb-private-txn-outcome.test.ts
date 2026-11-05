import { readFileSync } from 'fs';
import { join } from 'path';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { buildDdbSignedReadProcedure, type DdbSigner } from '../src/ddb';
import { buildDdbPrivateTransaction, decodePrivateTxnMemberV1, encodePrivateTxnMemberV1 } from '../src/ddb-private-txn';
import { PLACEMENT_MANAGER_RUNTIME_CODE_HASH } from '../src/ddb-proof';
import { parseDdbCurrentReadRoute } from '../src/ddb-private-read';
import {
  readDdbPrivateTransactionOutcome, collectDdbPrivateTransactionOutcome,
  type DdbPrivateTxnOutcomeReadInput, type DdbPrivateTxnCollectionInput,
} from '../src/ddb-private-txn-outcome';

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
const hash = (byte: string) => '0x' + byte.repeat(32);
const address = (byte: string) => '0x' + byte.repeat(20);
const chain = '0x' + BigInt(2570).toString(16).padStart(64, '0');
const contract = address('11');
const caller = address('22');
const database = 'c_' + contract.slice(2);
const commit = hash('33');
const zero = hash('00');
const pub = new Uint8Array(2592).fill(1);
const signature = new Uint8Array(4627).fill(2);
const template = new Uint8Array(readFileSync(join(__dirname, 'vectors/private-txn-member-v1.json')));

function route(ids = [2, 7, 9], version = '0x2') {
  return parseDdbCurrentReadRoute(contract, {
    contract, database, enabled: true, private: true, block: '0x1b', blockHash: hash('44'), stateRoot: hash('55'),
    epoch: '0x3', manager: address('66'), runtimeHash: PLACEMENT_MANAGER_RUNTIME_CODE_HASH, version,
    groupHash: hex(keccak_256(Buffer.from(ids.map(id => id.toString(16).padStart(64, '0')).join(''), 'hex'))),
    members: ids.map(validatorId => ({ validatorId, address: '0x' + validatorId.toString(16).padStart(40, '0') })),
  });
}

function fixture() {
  const placement = route();
  const digestKey = new Uint8Array(32).fill(3);
  const payloads = [0, 1].map(i => {
    const m = decodePrivateTxnMemberV1(template, 4);
    m.index = BigInt(i); m.count = BigInt(2);
    m.base = { ...m.base, chain, database, contract, caller, block: BigInt(placement.block),
      block_hash: placement.blockHash, state_root: placement.stateRoot, epoch: BigInt(placement.epoch),
      manager: placement.manager, manager_runtime: placement.runtimeHash, placement_version: BigInt(placement.version),
      group_hash: placement.groupHash, digest_version: BigInt(1), digest_fingerprint: hex(sha256(digestKey)), initial_anchor: hash('77') };
    m.base.context.definition.contract_address = contract;
    m.intent = { ...m.intent, type: BigInt(7), nonce: BigInt(100 + i), timestamp: BigInt(1800000000), expiry: BigInt(1800000300) };
    m.result = { columns: [{ name: 'raw', type: 'pg_catalog.bytea' }], affected: BigInt('9007199254740993'),
      rows: [[{ null: true, value: new Uint8Array() }], [{ null: false, value: new Uint8Array() }], [{ null: false, value: Uint8Array.of(0, 255) }]] };
    return encodePrivateTxnMemberV1(m, 4);
  });
  const decoded = payloads.map(p => decodePrivateTxnMemberV1(p, 4));
  const retained = buildDdbPrivateTransaction({ expectedBase: decoded[0].base, expectedIntents: decoded.map(m => m.intent),
    payloads, salts: [new Uint8Array(32).fill(4), new Uint8Array(32).fill(5)], digestKey, callerPubKey: pub,
    maxMembers: 4, readVersion: decoded[0].base.block, reads: [{}] });
  const pending = (validatorId: number): any => ({ state: 'pending', validatorId, chain, database, txnId: retained.id, caller,
    commitTx: zero, block: '0x0', blockHash: zero, placementVersion: '0x0', groupHash: zero, groupJournalHash: zero,
    digestVersion: '0x0', digestFingerprint: zero, initialAnchor: zero, finalAnchor: zero, memberCount: '0x0' });
  const durable = (validatorId: number, withResults = true): any => ({ ...pending(validatorId), state: 'local_durable', commitTx: commit,
    block: '0x20', blockHash: hash('88'), placementVersion: placement.version, groupHash: placement.groupHash,
    groupJournalHash: hash('99'), digestVersion: '0x1', digestFingerprint: decoded[0].base.digest_fingerprint,
    initialAnchor: decoded[0].base.initial_anchor, finalAnchor: hash('aa'), memberCount: '0x2',
    ...(withResults ? { payloads: payloads.map(hex) } : {}) });
  const responses = new Map<number, any>([[2, durable(2)], [7, durable(7)], [9, durable(9)]]);
  const resolveCurrent = jest.fn(async () => route());
  const hostEndpoints = jest.fn(async (ids?: number[]): Promise<any[]> => (ids ?? []).map(validatorId => ({
    validatorId, live: true, endpoints: [{ scheme: 'https', url: `https://host${validatorId}.example`, tlsKeyHash: hash('bb') }],
  })));
  const sends: Array<{ validatorId: number; method: string; params: any[] }> = [];
  const send = jest.fn(async (validatorId: number, method: string, params: any[]) => {
    sends.push({ validatorId, method, params });
    const response = responses.get(validatorId);
    if (response instanceof Error) throw response;
    return response;
  });
  const close = jest.fn();
  const verifyAssignment = jest.fn(async () => true);
  const connect = jest.fn(async (request: any): Promise<any> => ({
    binding: { route: request.route, validatorId: request.member.validatorId, address: request.member.address,
      url: request.endpoints[0].url, tlsKeyHash: request.endpoints[0].tlsKeyHash },
    endpointAuthenticated: true, confidentiality: 'post-quantum', close,
    send: (method: string, params: any[]) => send(request.member.validatorId, method, params),
  }));
  const signDdbHash = jest.fn(async (_hash: Uint8Array) => signature.slice());
  const signer: DdbSigner = { getAddress: () => caller, getPublicKey: () => pub.slice(), signDdbHash };
  const read: DdbPrivateTxnOutcomeReadInput = { signer, resolver: { resolveCurrent, hostEndpoints },
    policy: { verifyAssignment, connect }, chain, database, txnId: retained.id, caller, validatorId: 7,
    expectedCommitTx: commit, mode: 'result', maxMembers: 4 };
  const verifyHistoricalPlacement = jest.fn(async (_placement: any, _expected: any) => true);
  const verifyFinality = jest.fn(async (_expected: any, _candidate: any) => true);
  const collect: DdbPrivateTxnCollectionInput = { ...read, retained, completePlacement: placement,
    requiredHosts: [2, 7], verifyHistoricalPlacement, verifyFinality };
  return { read, collect, placement, retained, pending, durable, payloads, responses, sends, send, close,
    resolveCurrent, hostEndpoints, verifyAssignment, connect, signDdbHash, verifyHistoricalPlacement, verifyFinality };
}

describe('addressed private transaction outcome reads', () => {
  test('signs exact unchanged READPROC for one recipient and preserves canonical results', async () => {
    const f = fixture();
    const got = await readDdbPrivateTransactionOutcome(f.read);
    expect(got.state).toBe('local_durable');
    expect(f.sends).toHaveLength(1);
    const { method, params, validatorId } = f.sends[0];
    expect(method).toBe('ddb_getPrivateTransactionOutcome'); expect(validatorId).toBe(7);
    expect(params).toHaveLength(1);
    const envelope = params[0];
    expect(envelope.args).toEqual([f.retained.id, commit, '7', 'result']);
    expect(envelope.procedure).toBe('@ddb/private-txn-outcome/v1');
    const expected = buildDdbSignedReadProcedure(chain, database, envelope.procedure, envelope.args, caller, pub,
      { timestamp: Number(BigInt(envelope.timestamp)), nonce: BigInt(envelope.nonce) });
    expect(f.signDdbHash.mock.calls[0][0]).toEqual(expected.hash);
    expect(envelope).toEqual({ ...expected.envelope, callerSig: hex(signature) });
    expect(f.hostEndpoints).toHaveBeenCalledWith([7]);
    expect(JSON.stringify(f.sends)).not.toContain(f.retained.sidecars[0].salt);
    if (got.state !== 'local_durable') throw new Error('expected durable');
    expect(got.block).toBe(BigInt(32));
    expect(got.payloads).toEqual(f.payloads);
    expect(got.members![0].result.affected).toBe(BigInt('9007199254740993'));
    expect(got.members![0].result.rows).toEqual([
      [{ null: true, value: new Uint8Array() }], [{ null: false, value: new Uint8Array() }],
      [{ null: false, value: Uint8Array.of(0, 255) }],
    ]);
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  test('pending and status reads never manufacture payloads or committed claims', async () => {
    const f = fixture(); f.responses.set(7, f.pending(7));
    expect(await readDdbPrivateTransactionOutcome(f.read)).toEqual({ state: 'pending', validatorId: 7, chain, database, txnId: f.retained.id, caller });
    f.read.mode = 'status'; f.responses.set(7, f.durable(7, false));
    const status = await readDdbPrivateTransactionOutcome(f.read);
    expect(status).not.toHaveProperty('payloads'); expect(status).not.toHaveProperty('committed');
    expect(f.sends[1].params[0].args[3]).toBe('status');
    expect(f.sends[0].params[0].nonce).not.toBe(f.sends[1].params[0].nonce);
  });

  test('invalid identity, recipient, mode and bounds refuse before signing or discovery', async () => {
    const changes: any[] = [{ chain: '0xa0a' }, { database: 'wallet_alias' }, { txnId: zero }, { caller: address('00') },
      { validatorId: 0 }, { validatorId: 4294967296 }, { expectedCommitTx: undefined }, { expectedCommitTx: zero },
      { mode: 'committed' }, { maxMembers: 0 }, { maxMembers: 5 }];
    for (const change of changes) {
      const f = fixture();
      await expect(readDdbPrivateTransactionOutcome({ ...f.read, ...change })).rejects.toThrow();
      expect(f.resolveCurrent).not.toHaveBeenCalled(); expect(f.signDdbHash).not.toHaveBeenCalled();
    }
  });

  test('untrusted assignment and unavailable exact recipient never choose another host', async () => {
    const f = fixture(); f.verifyAssignment.mockResolvedValue(false);
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow(/assignment/);
    expect(f.connect).not.toHaveBeenCalled();
    f.verifyAssignment.mockResolvedValue(true); f.resolveCurrent.mockResolvedValue(route([2, 9]));
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow(/recipient/);
    expect(f.hostEndpoints).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });

  test('wrong channel identity and ordinary TLS assertions refuse before signing or sending', async () => {
    for (const field of ['validatorId', 'address', 'url', 'tlsKeyHash', 'route', 'confidentiality', 'endpointAuthenticated']) {
      const f = fixture(); const connect = f.connect.getMockImplementation()!;
      f.connect.mockImplementation(async req => {
        const transport = await connect(req);
        if (field === 'confidentiality') transport.confidentiality = 'tls';
        else if (field === 'endpointAuthenticated') transport.endpointAuthenticated = false;
        else transport.binding[field] = field === 'validatorId' ? 2 : field === 'route' ? route([2, 9]) : 'wrong';
        return transport;
      });
      await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow(/transport/);
      expect(f.signDdbHash).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
    }
  });

  test('wrong signer and failed signing close the bound unused channel', async () => {
    const f = fixture(); f.read.signer = { ...f.read.signer, getAddress: () => address('ee') };
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow(/caller/);
    expect(f.send).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
    const other = fixture(); other.signDdbHash.mockRejectedValue(new Error('secret signing detail'));
    await expect(readDdbPrivateTransactionOutcome(other.read)).rejects.toThrow(/unavailable/);
    expect(other.send).not.toHaveBeenCalled(); expect(other.close).toHaveBeenCalledTimes(1);
  });

  test('malformed or substituted local outcome fields and canonical members refuse', async () => {
    const changes: any[] = [{ validatorId: 2 }, { chain: hash('ee') }, { database: 'c_' + address('ee').slice(2) },
      { caller: address('ee') }, { txnId: hash('ee') }, { commitTx: hash('ee') }, { state: 'committed' },
      { block: 32 }, { block: '0x020' }, { block: '0x10000000000000000' }, { memberCount: '0x3' },
      { groupHash: hash('ee') }, { digestFingerprint: hash('ee') }, { initialAnchor: hash('ee') }, { committed: true }];
    for (const change of changes) {
      const f = fixture(); f.responses.set(7, { ...f.durable(7), ...change });
      await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow();
    }
    const f = fixture(); const d = f.durable(7); d.payloads.reverse(); f.responses.set(7, d);
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow();
    d.payloads = [hex(Buffer.from(' ' + Buffer.from(f.payloads[0]).toString())), hex(f.payloads[1])];
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow();
    f.responses.set(7, { ...f.pending(7), block: '0x1' });
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow();
    f.read.mode = 'status'; f.responses.set(7, f.durable(7));
    await expect(readDdbPrivateTransactionOutcome(f.read)).rejects.toThrow();
  });
});

describe('private transaction finality and explicit durability collection', () => {
  test('commits only after exact required hosts and independent canonical finality', async () => {
    const f = fixture(); const got = await collectDdbPrivateTransactionOutcome(f.collect);
    expect(got.committed).toBe(true); expect(got.state).toBe('committed');
    expect(f.sends.map(s => s.validatorId)).toEqual([2, 7]);
    expect(f.sends[0].params[0].nonce).not.toBe(f.sends[1].params[0].nonce);
    expect(f.verifyHistoricalPlacement).toHaveBeenCalledTimes(1); expect(f.verifyFinality).toHaveBeenCalledTimes(1);
    expect(f.verifyFinality.mock.calls[0][0].operationHashes).toEqual(f.retained.members.map(m => hex(m.hash)));
    expect(f.verifyFinality.mock.calls[0][1]).toMatchObject({ commitTx: commit, block: BigInt(32), groupJournalHash: hash('99') });
    if (!got.committed) throw new Error('expected committed');
    expect(got.requiredHosts).toEqual([2, 7]); expect(got.durableHosts).toEqual([2, 7]);
    expect(got.finality).toEqual({ finalized: true, blockNumber: '0x20', blockHash: hash('88') });
    expect(got.readToken).toBe('0x20'); expect(got.payloads).toEqual(f.payloads);
  });

  test('all required local durability cannot substitute for independently verified finality', async () => {
    const f = fixture(); f.verifyFinality.mockResolvedValue(false);
    expect(await collectDdbPrivateTransactionOutcome(f.collect)).toMatchObject({ state: 'pending', committed: false, reason: 'finality_unverified' });
    f.verifyFinality.mockRejectedValue(new Error('private finality details'));
    const got = await collectDdbPrivateTransactionOutcome(f.collect);
    expect(got.committed).toBe(false); expect(JSON.stringify(got)).not.toContain('private finality details');
  });

  test('missing explicit durability policy and invalid full placement refuse before disclosure', async () => {
    for (const requiredHosts of [undefined, [], [2, 2], [7, 2], [2, 99]]) {
      const f = fixture();
      await expect(collectDdbPrivateTransactionOutcome({ ...f.collect, requiredHosts } as any)).rejects.toThrow();
      expect(f.resolveCurrent).not.toHaveBeenCalled(); expect(f.signDdbHash).not.toHaveBeenCalled();
    }
    const f = fixture();
    await expect(collectDdbPrivateTransactionOutcome({ ...f.collect, completePlacement: route([2, 7]) })).rejects.toThrow(/placement/);
    expect(f.resolveCurrent).not.toHaveBeenCalled();
    f.verifyHistoricalPlacement.mockResolvedValue(false);
    expect(await collectDdbPrivateTransactionOutcome(f.collect)).toMatchObject({ committed: false, reason: 'historical_placement_unverified' });
    expect(f.resolveCurrent).not.toHaveBeenCalled();
  });

  test('one missing host, unavailable host, or duplicate returned identity cannot commit', async () => {
    for (const response of ['pending', 'unavailable', 'duplicate']) {
      const f = fixture(); f.responses.set(7, response === 'pending' ? f.pending(7) : response === 'duplicate' ? f.durable(2) : new Error('private endpoint error'));
      const got = await collectDdbPrivateTransactionOutcome(f.collect);
      expect(got).toMatchObject({ committed: false, reason: 'awaiting_hosts' });
      expect(f.verifyFinality).not.toHaveBeenCalled(); expect(JSON.stringify(got)).not.toContain('private endpoint error');
    }
  });

  test('unknown commit is explicit and candidate disagreement never selects a plurality', async () => {
    const f = fixture(); f.collect.expectedCommitTx = null;
    expect((await collectDdbPrivateTransactionOutcome(f.collect)).committed).toBe(true);
    expect(f.sends.every(s => s.params[0].args[1] === zero)).toBe(true);
    f.responses.set(7, { ...f.durable(7), commitTx: hash('ee') }); f.verifyFinality.mockClear();
    expect(await collectDdbPrivateTransactionOutcome(f.collect)).toMatchObject({ committed: false, reason: 'disagreement' });
    expect(f.verifyFinality).not.toHaveBeenCalled();
  });

  test('matching transaction IDs still require identical roots and exact retained result bytes', async () => {
    const f = fixture(); f.responses.set(7, { ...f.durable(7), finalAnchor: hash('ee') });
    expect(await collectDdbPrivateTransactionOutcome(f.collect)).toMatchObject({ committed: false, reason: 'disagreement' });
    const other = fixture(); const m = decodePrivateTxnMemberV1(other.payloads[0], 4); m.result.affected += BigInt(1);
    other.responses.set(7, { ...other.durable(7), payloads: [hex(encodePrivateTxnMemberV1(m, 4)), hex(other.payloads[1])] });
    expect((await collectDdbPrivateTransactionOutcome(other.collect)).committed).toBe(false);
    expect(other.verifyFinality).not.toHaveBeenCalled();
  });

  test('changed retained salts, member hashes, intent or read header refuse before callbacks', async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.retained.sidecars[0].salt = hash('ee'); },
      (f: ReturnType<typeof fixture>) => { f.retained.members[0].hash[0] ^= 1; },
      (f: ReturnType<typeof fixture>) => { f.retained.members[0].envelope.nonce = '0x555'; },
      (f: ReturnType<typeof fixture>) => { f.retained.members[0].envelope.txn.reads = [{ table: 'accounts' }]; },
    ]) {
      const f = fixture(); change(f);
      await expect(collectDdbPrivateTransactionOutcome(f.collect)).rejects.toThrow();
      expect(f.verifyHistoricalPlacement).not.toHaveBeenCalled(); expect(f.resolveCurrent).not.toHaveBeenCalled();
    }
  });

  test('historical required set survives current-route changes without substituting hosts', async () => {
    const f = fixture(); f.resolveCurrent.mockResolvedValue(route([2, 7, 11], '0x3'));
    expect((await collectDdbPrivateTransactionOutcome(f.collect)).committed).toBe(true);
    const moved = fixture(); moved.resolveCurrent.mockResolvedValue(route([2, 9, 11], '0x3'));
    expect((await collectDdbPrivateTransactionOutcome(moved.collect)).committed).toBe(false);
    expect(moved.sends.map(s => s.validatorId)).toEqual([2]);
  });

  test('owns required hosts, retained bytes, request fields and callback arguments across awaits', async () => {
    const f = fixture(); let release!: () => void;
    f.verifyHistoricalPlacement.mockImplementation(async (_placement, expected) => {
      expected.base.context.owner = address('ee'); expected.operationHashes[0] = hash('ee');
      await new Promise<void>(resolve => { release = resolve; }); return true;
    });
    f.verifyFinality.mockImplementation(async (expected, candidate) => {
      expect(expected.base.context.owner).not.toBe(address('ee'));
      candidate.commitTx = hash('ee'); expected.operationHashes[0] = hash('ee'); return true;
    });
    const pending = collectDdbPrivateTransactionOutcome(f.collect);
    (f.collect.requiredHosts as number[]).splice(1, 1);
    f.retained.sidecars[0].payload = '0x00'; f.retained.members[0].hash.fill(0);
    f.collect.expectedCommitTx = hash('ee'); f.collect.caller = address('ee');
    release();
    const got = await pending;
    expect(got.committed).toBe(true);
    if (!got.committed) throw new Error('expected committed');
    expect(got.commitTx).toBe(commit); expect(got.requiredHosts).toEqual([2, 7]); expect(got.payloads).toEqual(f.payloads);
    expect(f.sends.every(s => s.params[0].from === caller && s.params[0].args[1] === commit)).toBe(true);
  });
});
