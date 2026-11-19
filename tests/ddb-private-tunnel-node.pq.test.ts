// Real inner TLS across a WSS ciphertext carrier. The production Go ingress is
// separately qualified from gossip/ddb/privatetunnel; this fixture has no state authority.
import { createServer, Server } from 'https';
import { connect, Socket, AddressInfo } from 'net';
import { TLSSocket } from 'tls';
import { createHash, X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { keccak_256 } from '@noble/hashes/sha3';
import { connectDdbNodePrivateRead } from '../src/ddb-private-read-node';
import { connectDdbNodePrivateCustody } from '../src/ddb-private-custody-node';

const cert = readFileSync(join(__dirname, 'fixtures/pq-node-cert.pem')), key = readFileSync(join(__dirname, 'fixtures/pq-node-key.pem'));
const pin = '0x' + createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const hash = '0x' + '12'.repeat(32), address = '0x' + '34'.repeat(20), word = new Uint8Array(32); word[31] = 1;
const groupHash = '0x' + Buffer.from(keccak_256(word)).toString('hex');
const servers: Server[] = [], sockets = new Set<Socket>(), websockets = new Set<WebSocket>();
afterEach(async () => { for (const ws of websockets) ws.terminate(); websockets.clear(); for (const socket of sockets) socket.destroy(); sockets.clear();
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve())))); });
async function fixture(curve = 'X25519MLKEM768') {
  const plaintext: string[] = [], ciphertext: Buffer[] = [], routes: any[] = [], inner: TLSSocket[] = [], sessionReused: boolean[] = [];
  const host = createServer({ cert, key, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', ecdhCurve: curve, ciphers: 'TLS_AES_256_GCM_SHA384' }, (req, res) => {
    let body = ''; req.on('data', b => { body += b; }); req.on('end', () => { plaintext.push(body); res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'private-result-sentinel' })); });
  });
  host.on('tlsClientError', () => {}); host.on('secureConnection', socket => { inner.push(socket); sessionReused.push(socket.isSessionReused()); });
  const ingress = createServer({ cert, key, minVersion: 'TLSv1.3' });
  for (const server of [host, ingress]) { servers.push(server); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); }
  let dials = 0;
  const wss = new WebSocketServer({ server: ingress, path: '/ddb/private-tunnel/v1', perMessageDeflate: false, maxPayload: 65536 });
  wss.on('connection', ws => { websockets.add(ws); ws.on('error', () => {}); ws.once('message', (data, binary) => {
    if (binary) return ws.terminate(); routes.push(JSON.parse(data.toString())); dials++;
    const upstream = connect({ host: '127.0.0.1', port: (host.address() as AddressInfo).port }); sockets.add(upstream);
    upstream.once('connect', () => ws.send(Buffer.alloc(0), { binary: true }));
    ws.on('message', (bytes, isBinary) => { if (!isBinary) return ws.terminate(); const b = Buffer.from(bytes as Buffer); ciphertext.push(b); upstream.write(b); });
    upstream.on('data', bytes => { ciphertext.push(Buffer.from(bytes)); ws.send(bytes, { binary: true }); });
    upstream.on('error', () => ws.terminate()); upstream.on('end', () => ws.close()); ws.on('close', () => upstream.destroy());
  }); });
  const url = `https://127.0.0.1:${(host.address() as AddressInfo).port}`;
  const route = { contract: address, database: 'c_' + address.slice(2), manager: address, runtimeHash: hash, version: '0x1', groupHash,
    blockHash: hash, block: '0x1', stateRoot: hash, epoch: '0x1', enabled: true, private: true, members: [{ validatorId: 1, address }] };
  const connection = { route, member: route.members[0], endpoints: [{ scheme: 'https', url, tlsKeyHash: pin }] };
  const trusted = { route, validatorId: 1, address, url, tlsKeyHash: pin };
  const options = { ca: cert, timeoutMs: 2000, tunnel: { chainId: '0x1', ca: cert, ingressURL: `https://127.0.0.1:${(ingress.address() as AddressInfo).port}/ddb/private-tunnel/v1` } };
  return { connection, trusted, options, plaintext, ciphertext, routes, inner, sessionReused, dials: () => dials };
}

test.each(['ddb_tokenSelect', 'ddb_tokenCallReadProcedure'])('actual bound %s hides private query/token/sidecar/result and consumes one socket', async method => {
  const f = await fixture();
  const channel = await connectDdbNodePrivateRead(f.connection, f.trusted, f.options);
  expect(f.plaintext).toHaveLength(0); expect(channel.negotiatedGroup).toBe('X25519MLKEM768');
  expect(await channel.send(method, [{ query: 'private-query-sentinel', token: 'private-token-sentinel', sidecar: 'private-sidecar-sentinel' }])).toBe('private-result-sentinel');
  expect(JSON.parse(f.plaintext[0]).method).toBe(method);
  const observed = Buffer.concat(f.ciphertext).toString('latin1') + JSON.stringify(f.routes);
  for (const secret of ['private-query-sentinel', 'private-token-sentinel', 'private-sidecar-sentinel', 'private-result-sentinel']) expect(observed).not.toContain(secret);
  expect(f.dials()).toBe(1); expect(f.inner).toHaveLength(1); expect(f.sessionReused).toEqual([false]);
  await expect(channel.send('ddb_signedSelect', [])).rejects.toThrow('already consumed');
});

test.each(['pin', 'classical', 'name', 'ca'])('wrong INNER %s refuses before any private HTTP through valid ingress TLS', async fault => {
  const f = await fixture(fault === 'classical' ? 'X25519' : 'X25519MLKEM768');
  const url = fault === 'name' ? f.trusted.url.replace('127.0.0.1', 'localhost') : f.trusted.url;
  const trusted = { ...f.trusted, url, tlsKeyHash: fault === 'pin' ? hash : pin };
  const connection = { ...f.connection, endpoints: [{ ...f.connection.endpoints[0], url, tlsKeyHash: trusted.tlsKeyHash }] };
  await expect(connectDdbNodePrivateRead(connection, trusted, { ...f.options, ca: fault === 'ca' ? undefined : cert })).rejects.toThrow();
  expect(f.plaintext).toHaveLength(0); expect(f.dials()).toBe(1);
});

test('retained tunnel requires original transaction context and retains original assignment projection', async () => {
  const f = await fixture(), binding = { chain: '0x' + '00'.repeat(31) + '01', validatorId: 1, auth: address, directory: address,
    block: 1, blockTime: 1800000000, expiry: 4102444800, source: { validatorId: 1, address, url: f.trusted.url, tlsKeyHash: pin }, url: f.trusted.url, tlsKeyHash: pin };
  await expect(connectDdbNodePrivateCustody(binding, f.options)).rejects.toThrow('original transaction context'); expect(f.dials()).toBe(0);
  const channel = await connectDdbNodePrivateCustody(binding, f.options, { txnId: hash, originalPlacement: f.connection.route });
  expect(f.routes[0]).toMatchObject({ audience: 'retained-original', placementVersion: '0x1', assignmentBlockHash: hash });
  expect(await channel.send('ddb_getPrivateTransactionOutcome', [{ txnId: hash }])).toBe('private-result-sentinel'); expect(f.dials()).toBe(1);
});

test('actual bound tunneled socket refuses a method outside the closed private allowlist before HTTP', async () => {
  const f = await fixture(), channel = await connectDdbNodePrivateRead(f.connection, f.trusted, f.options);
  await expect(channel.send('ddb_submitSignedOp', ['private-request-sentinel'])).rejects.toThrow('private transport');
  expect(f.plaintext).toHaveLength(0); expect(f.dials()).toBe(1);
});
