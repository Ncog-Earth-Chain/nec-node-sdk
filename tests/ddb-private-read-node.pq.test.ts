// Required modern-runtime suite: npm run test:pq. Never conditionally skip hybrid negotiation.
import { createServer, Server } from 'https';
import { createHash, X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AddressInfo, Socket } from 'net';
import { keccak_256 } from '@noble/hashes/sha3';
import { connectDdbNodePrivateRead } from '../src/ddb-private-read-node';
import { connectDdbNodePrivateCustody } from '../src/ddb-private-custody-node';
import { parseDdbCurrentReadRoute, type DdbPrivateReadConnection } from '../src/ddb-private-read';
import { Ddb, buildDdbSignedReadProcedure, type DdbSigner } from '../src/ddb';
import { encodePrivateTxnBaseV1, encodePrivateTxnIntentV1 } from '../src/ddb-private-txn';
import { connectDdbNodePrivateEvidence, createDdbTrustedNodePrivatePolicy } from '../src/ddb-private-trust-node';
import { ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH } from '../src/ddb-private-evidence';
import { privateClientFixture, hex as fixtureHex, pub as fixturePub, chain as fixtureChain, database as fixtureDatabase, caller as fixtureCaller } from './fixtures/private-client';

const cert = readFileSync(join(__dirname, 'fixtures/pq-node-cert.pem'));
const key = readFileSync(join(__dirname, 'fixtures/pq-node-key.pem'));
const pin = '0x' + createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const hash = '0x' + '12'.repeat(32);
const address = '0x' + '34'.repeat(20);
const group = new Uint8Array(32); group[31] = 1;
const groupHash = '0x' + Buffer.from(keccak_256(group)).toString('hex');
const servers = new Set<Server>();
const connections = new Set<Socket>();

afterEach(async () => {
  for (const socket of connections) socket.destroy();
  connections.clear();
  await Promise.all(Array.from(servers).map(s => new Promise<void>(resolve => {
    s.closeAllConnections(); s.close(() => resolve());
  })));
  servers.clear();
});

async function fixture(curve = 'X25519MLKEM768', response: any = { jsonrpc: '2.0', id: 1, result: [{ exact: '9007199254740993' }] }, status = 200) {
  const bodies: string[] = [];
  const sockets = new Set<unknown>();
  const server = createServer({ cert, key, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', ecdhCurve: curve, ciphers: 'TLS_AES_256_GCM_SHA384' }, (req, res) => {
    sockets.add(req.socket);
    let body = '';
    req.on('data', b => { body += b.toString(); });
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(status, { 'content-type': 'application/json', ...(status === 302 ? { location: 'https://localhost:1' } : {}) });
      res.end(typeof response === 'string' ? response : JSON.stringify(response));
    });
  });
  servers.add(server);
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const route = { database: 'c_' + address.slice(2), contract: address, enabled: true, private: true, block: '0x1', blockHash: hash, stateRoot: hash, epoch: '0x1', manager: address, runtimeHash: hash, version: '0x1', groupHash, members: [{ validatorId: 1, address }] };
  const connection: DdbPrivateReadConnection = { route, member: route.members[0], endpoints: [{ scheme: 'https', url, tlsKeyHash: pin }] };
  const trusted = { route, validatorId: 1, address, url, tlsKeyHash: pin };
  return { connection, trusted, bodies, sockets, server };
}

test('real hybrid connection authenticates before sending and uses one socket', async () => {
  const f = await fixture();
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  expect(channel.negotiatedGroup).toBe('X25519MLKEM768');
  expect(f.bodies).toEqual([]);
  await expect(channel.send('ddb_signedSelect', [{ secret: 'tenant-private-query' }])).resolves.toEqual([{ exact: '9007199254740993' }]);
  expect(JSON.parse(f.bodies[0])).toEqual({ jsonrpc: '2.0', id: 1, method: 'ddb_signedSelect', params: [{ secret: 'tenant-private-query' }] });
  expect(f.sockets.size).toBe(1);
  await expect(channel.send('ddb_signedSelect', [])).rejects.toThrow('already consumed');
});

function custodyBinding(url: string, tlsKeyHash = pin) {
  return { chain: fixtureChain, validatorId: 77, auth: address, directory: address, block: 40, blockTime: 1800000000,
    expiry: 4102444800, source: { validatorId: 9, address, url: 'https://source.example', tlsKeyHash: pin }, url, tlsKeyHash };
}
test('custody channel uses actual hybrid TLS and only one original-host outcome RPC', async () => {
  const f = await fixture();
  const channel = await connectDdbNodePrivateCustody(custodyBinding(f.trusted.url), { ca: cert });
  expect(channel.negotiatedGroup).toBe('X25519MLKEM768');
  expect(channel.binding.validatorId).toBe(77);
  expect(channel.binding).not.toHaveProperty('route');
  expect(f.bodies).toHaveLength(0);
  await channel.send('ddb_getPrivateTransactionOutcome', [{ procedure: '@ddb/private-txn-outcome/v1' }]);
  expect(f.bodies).toHaveLength(1); expect(f.sockets.size).toBe(1);
  await expect(channel.send('ddb_getPrivateTransactionOutcome', [])).rejects.toThrow('already consumed');
  const denied = await connectDdbNodePrivateCustody(custodyBinding(f.trusted.url), { ca: cert });
  await expect(denied.send('ddb_signedSelect', [])).rejects.toThrow('private transport');
  expect(f.bodies).toHaveLength(1);
});
test.each(['pin', 'classical', 'ca', 'hostname'])('custody channel refuses before plaintext: %s', async fault => {
  const f = await fixture(fault === 'classical' ? 'X25519' : 'X25519MLKEM768');
  const url = fault === 'hostname' ? f.trusted.url.replace('127.0.0.1', 'localhost') : f.trusted.url;
  await expect(connectDdbNodePrivateCustody(custodyBinding(url, fault === 'pin' ? hash : pin),
    { ca: fault === 'ca' ? undefined : cert, timeoutMs: 1000 })).rejects.toThrow();
  expect(f.bodies).toHaveLength(0);
});
test('custody lease expiration while waiting to sign prevents plaintext on the open socket', async () => {
  const f = await fixture();
  const channel = await connectDdbNodePrivateCustody(custodyBinding(f.trusted.url), { ca: cert });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(4102444800000);
  try {
    await expect(channel.send('ddb_getPrivateTransactionOutcome', [{ secret: 'private' }])).rejects.toThrow();
    expect(f.bodies).toHaveLength(0);
  } finally { clock.mockRestore(); channel.close(); }
});
test('custody channel refuses redirects and bounded response overflow', async () => {
  const redirect = await fixture('X25519MLKEM768', {}, 302);
  const a = await connectDdbNodePrivateCustody(custodyBinding(redirect.trusted.url), { ca: cert });
  await expect(a.send('ddb_getPrivateTransactionOutcome', [])).rejects.toThrow('HTTP status 302');
  expect(redirect.bodies).toHaveLength(1);
  const large = await fixture('X25519MLKEM768', { jsonrpc: '2.0', id: 1, result: 'x'.repeat(1024) });
  const b = await connectDdbNodePrivateCustody(custodyBinding(large.trusted.url), { ca: cert, maxResponseBytes: 100 });
  await expect(b.send('ddb_getPrivateTransactionOutcome', [])).rejects.toThrow('byte limit');
  expect(large.bodies).toHaveLength(1);
});

test.each(['ddb_getPrivateAssignmentEvidence', 'ddb_getPrivateTransactionSnapshotEvidence', 'ddb_getPrivateTransactionFinalityEvidence'])
('private evidence uses its authenticated one-use hybrid socket: %s', async method => {
  const f = await fixture('X25519MLKEM768', { jsonrpc: '2.0', id: 1, result: { observed: true } });
  const source = { validatorId: 1, address, url: f.trusted.url, tlsKeyHash: pin };
  const channel = await connectDdbNodePrivateEvidence(source, { ca: cert });
  const v = privateClientFixture();
  const intent = { type: BigInt(7), data: new TextEncoder().encode(String(v.input.members[0].data)), timestamp: BigInt(1800000000),
    gas_limit: BigInt(1000), nonce: BigInt(100), expiry: BigInt(1800000300), key_version: BigInt(1) };
  const selectors: Record<string, string> = { ddb_getPrivateAssignmentEvidence: '@ddb/private-assignment-evidence/v1',
    ddb_getPrivateTransactionSnapshotEvidence: '@ddb/private-txn-snapshot-evidence/v1', ddb_getPrivateTransactionFinalityEvidence: '@ddb/private-txn-finality-evidence/v1' };
  const args = method === 'ddb_getPrivateAssignmentEvidence' ? ['1', 'current'] : method === 'ddb_getPrivateTransactionSnapshotEvidence'
    ? ['1', fixtureHex(encodePrivateTxnBaseV1(v.base)), fixtureHex(encodePrivateTxnIntentV1(intent))] : ['1', '0x20', hash];
  const prepared = buildDdbSignedReadProcedure(fixtureChain, fixtureDatabase, selectors[method], args, fixtureCaller, fixturePub);
  const params = [{ ...prepared.envelope, callerSig: fixtureHex(await v.input.signer.signDdbHash(prepared.hash)) }];
  expect(f.bodies).toEqual([]);
  await expect(channel.send(method, params)).resolves.toEqual({ observed: true });
  expect(JSON.parse(f.bodies[0])).toEqual({ jsonrpc: '2.0', id: 1, method, params });
  expect(f.sockets.size).toBe(1);
  await expect(channel.send(method, params)).rejects.toThrow('already consumed');
  const denied = await connectDdbNodePrivateEvidence(source, { ca: cert });
  await expect(denied.send('ddb_submitSignedTransaction', [])).rejects.toThrow('private transport');
  expect(f.bodies).toHaveLength(1);
});

test('trusted validating-node factory authenticates bootstrap before signing evidence', async () => {
  const v = privateClientFixture();
  const result = { chain: fixtureChain, placement: v.placement, maxMembers: '0x4', endpointDirectory: address,
    endpointRuntime: ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH, blockTime: '0x1',
    hosts: v.placement.members.map(m => ({ ...m, publicKey: fixtureHex(fixturePub), auth: address,
      expiry: '0xffffffffffffffff', live: true, endpoints: [{ scheme: 'https', url: 'https://example.com', tlsKeyHash: pin }] })) };
  const f = await fixture('X25519MLKEM768', { jsonrpc: '2.0', id: 1, result });
  const trust = createDdbTrustedNodePrivatePolicy({ trust: 'trusted-validating-node', chain: fixtureChain, database: fixtureDatabase,
    caller: fixtureCaller, signer: v.input.signer, source: { validatorId: 9, address: v.placement.members[2].address, url: f.trusted.url, tlsKeyHash: pin }, sourceTls: { ca: cert } });
  expect((await trust.readCurrentAssignment()).placement).toEqual(v.placement);
  const request = JSON.parse(f.bodies[0]);
  expect(request.method).toBe('ddb_getPrivateAssignmentEvidence');
  expect(request.params[0].procedure).toBe('@ddb/private-assignment-evidence/v1');
  expect(request.params[0].args).toEqual(['9', 'current']);
  expect(v.signDdbHash).toHaveBeenCalledTimes(1); expect(f.sockets.size).toBe(1);
});

test.each(['pin', 'downgrade'])('trusted source bootstrap refuses before signing or private bytes: %s', async fault => {
  const v = privateClientFixture(), f = await fixture(fault === 'downgrade' ? 'X25519' : 'X25519MLKEM768');
  const trust = createDdbTrustedNodePrivatePolicy({ trust: 'trusted-validating-node', chain: fixtureChain, database: fixtureDatabase,
    caller: fixtureCaller, signer: v.input.signer, source: { validatorId: 9, address: v.placement.members[2].address, url: f.trusted.url,
      tlsKeyHash: fault === 'pin' ? hash : pin }, sourceTls: { ca: cert } });
  await expect(trust.readCurrentAssignment()).rejects.toThrow('private evidence unavailable');
  expect(v.signDdbHash).not.toHaveBeenCalled(); expect(f.bodies).toEqual([]);
});

test('private transaction outcome uses the exact authenticated hybrid socket without widening mutation access', async () => {
  const f = await fixture('X25519MLKEM768', { jsonrpc: '2.0', id: 1, result: { state: 'pending' } });
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  const params = [{ procedure: '@ddb/private-txn-outcome/v1', args: [hash, '0x' + '00'.repeat(32), '1', 'result'] }];
  await expect(channel.send('ddb_getPrivateTransactionOutcome', params)).resolves.toEqual({ state: 'pending' });
  expect(JSON.parse(f.bodies[0])).toEqual({ jsonrpc: '2.0', id: 1, method: 'ddb_getPrivateTransactionOutcome', params });
  expect(f.sockets.size).toBe(1);
  await expect(channel.send('ddb_getPrivateTransactionOutcome', params)).rejects.toThrow('already consumed');
  const denied = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  await expect(denied.send('ddb_submitSignedOp', params)).rejects.toThrow('private transport');
  expect(f.bodies).toHaveLength(1);
});

test.each(['ddb_previewPrivateBatch', 'ddb_putPayloadBatch', 'ddb_submitSignedTransaction'])
('private transaction mutation uses its authenticated one-use hybrid socket: %s', async method => {
  const f = await fixture('X25519MLKEM768', { jsonrpc: '2.0', id: 1, result: hash });
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  const params = method === 'ddb_putPayloadBatch' ? [[{ private: 'signed-unit' }], [{ payload: 'private-opening' }]] : [[{ private: 'signed-unit' }]];
  await expect(channel.send(method, params)).resolves.toBe(hash);
  expect(JSON.parse(f.bodies[0])).toEqual({ jsonrpc: '2.0', id: 1, method, params });
  expect(f.sockets.size).toBe(1);
  await expect(channel.send(method, params)).rejects.toThrow('already consumed');
});

test.each(['X25519MLKEM768', 'X25519'])('actual Ddb private-read callback uses connector and refuses downgrade: %s', async curve => {
  const f = await fixture(curve);
  const ingress = jest.fn(async (method: string) => {
    if (method === 'ddb_resolveDatabase') return { contract: address, currentRoute: f.connection.route };
    if (method === 'ddb_hostEndpoints') return { hosts: [{ validatorId: 1, live: true, status: 'live', expiry: 0, auth: address, endpoints: f.connection.endpoints }] };
    throw new Error('unexpected ingress RPC');
  });
  // Fixture-local trusted state and signer; this is transport/SDK integration,
  // not a claim that a real validator verified a signature or queried PostgreSQL.
  const signer: DdbSigner = { getAddress: () => address, getPublicKey: () => new Uint8Array([1, 2, 3]), signDdbHash: async () => new Uint8Array([4, 5, 6]) };
  const client = new Ddb({ send: ingress } as any, { privateRouting: { policy: {
    verifyAssignment: async route => JSON.stringify(route) === JSON.stringify(parseDdbCurrentReadRoute(address, f.connection.route)),
    connect: request => connectDdbNodePrivateRead(request, f.trusted, { ca: cert }),
  } } });
  const pending = client.signedSelect(signer, f.connection.route.database, 'items',
    { filters: [{ column: 'secret', op: '=', value: 'tenant-private-filter' }] },
    { chainId: 2570, timestamp: 1800000000, nonce: 7 });
  if (curve === 'X25519') {
    await expect(pending).rejects.toThrow('post-quantum');
    expect(f.bodies).toEqual([]);
  } else {
    await expect(pending).resolves.toEqual([{ exact: '9007199254740993' }]);
    expect(JSON.parse(f.bodies[0]).method).toBe('ddb_signedSelect');
    expect(f.bodies[0]).toContain('tenant-private-filter');
  }
  expect(JSON.stringify(ingress.mock.calls)).not.toContain('tenant-private-filter');
});

test('classical negotiated group refuses before request bytes', async () => {
  const f = await fixture('X25519');
  await expect(connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert })).rejects.toThrow('post-quantum');
  expect(f.bodies).toEqual([]);
});

test('wrong trusted pin refuses before request bytes', async () => {
  const f = await fixture();
  const bad = '0x' + '99'.repeat(32);
  const connection = { ...f.connection, endpoints: [{ ...f.connection.endpoints[0], tlsKeyHash: bad }] };
  await expect(connectDdbNodePrivateRead(connection, { ...f.trusted, tlsKeyHash: bad }, { ca: cert })).rejects.toThrow('public-key pin');
  expect(f.bodies).toEqual([]);
});

test('trusted binding is snapshotted before the asynchronous handshake', async () => {
  const f = await fixture();
  const bad = '0x' + '99'.repeat(32);
  const connection = { ...f.connection, endpoints: [{ ...f.connection.endpoints[0], tlsKeyHash: bad }] };
  const trusted = { ...f.trusted, tlsKeyHash: bad };
  const pending = connectDdbNodePrivateRead(connection, trusted, { ca: cert });
  trusted.tlsKeyHash = pin;
  await expect(pending).rejects.toThrow('public-key pin');
  expect(f.bodies).toEqual([]);
});

test('untrusted assignment and endpoint substitutions refuse before dial', async () => {
  const f = await fixture();
  for (const change of [
    { validatorId: 2 }, { address: '0x' + '88'.repeat(20) }, { url: 'https://localhost:1' },
    { route: { ...f.trusted.route, version: '0x2' } },
  ]) {
    await expect(connectDdbNodePrivateRead(f.connection, { ...f.trusted, ...change }, { ca: cert })).rejects.toThrow('trusted');
  }
  expect(f.bodies).toEqual([]);
});

test('untrusted CA and wrong hostname refuse before request bytes', async () => {
  const f = await fixture();
  await expect(connectDdbNodePrivateRead(f.connection, f.trusted)).rejects.toThrow();
  // Certificate contains only IP 127.0.0.1; localhost resolves to the same server
  // while hostname authentication must still refuse the other identity.
  const url = f.trusted.url.replace('127.0.0.1', 'localhost');
  const connection = { ...f.connection, endpoints: [{ ...f.connection.endpoints[0], url }] };
  await expect(connectDdbNodePrivateRead(connection, { ...f.trusted, url }, { ca: cert })).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  expect(f.bodies).toEqual([]);
});

test('redirect refuses without another request', async () => {
  const f = await fixture('X25519MLKEM768', {}, 302);
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  await expect(channel.send('ddb_signedSelect', [])).rejects.toThrow('HTTP status');
  expect(f.bodies).toHaveLength(1);
});

test.each([
  ['wrong id', { jsonrpc: '2.0', id: 2, result: [] }],
  ['both outcomes', { jsonrpc: '2.0', id: 1, result: [], error: { code: -1, message: 'bad' } }],
  ['malformed JSON', '{'],
])('invalid response %s refuses without retry', async (_name, response) => {
  const f = await fixture('X25519MLKEM768', response);
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  await expect(channel.send('ddb_signedSelect', [])).rejects.toThrow();
  expect(f.bodies).toHaveLength(1);
});

test('authenticated structured refusal retains retry classification fields', async () => {
  const error = { code: -32063, message: 'route moved', data: { reason: 'stale_route', preService: true } };
  const f = await fixture('X25519MLKEM768', { jsonrpc: '2.0', id: 1, error });
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  await expect(channel.send('ddb_signedCallReadProcedure', [])).rejects.toMatchObject(error);
  expect(f.bodies).toHaveLength(1);
});

test('request and response byte limits refuse with no retry', async () => {
  const f = await fixture();
  const smallRequest = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert, maxRequestBytes: 32 });
  await expect(smallRequest.send('ddb_signedSelect', ['private'])).rejects.toThrow('request exceeds');
  expect(f.bodies).toEqual([]);
  const smallResponse = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert, maxResponseBytes: 16 });
  await expect(smallResponse.send('ddb_signedSelect', [])).rejects.toThrow('response exceeds');
  expect(f.bodies).toHaveLength(1);
});

test('unsupported method and expired channel never send private bytes', async () => {
  const f = await fixture();
  const first = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert });
  await expect(first.send('ddb_submitSignedOp', [])).rejects.toThrow('signed read');
  const timed = await connectDdbNodePrivateRead(f.connection, f.trusted, { ca: cert, timeoutMs: 150 });
  await new Promise(resolve => setTimeout(resolve, 200));
  await expect(timed.send('ddb_signedSelect', [])).rejects.toThrow('deadline');
  expect(f.bodies).toEqual([]);
});
