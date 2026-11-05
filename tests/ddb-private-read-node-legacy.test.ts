import { createServer } from 'https';
import { createHash, X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AddressInfo, Socket } from 'net';
import { keccak_256 } from '@noble/hashes/sha3';
import { connectDdbNodePrivateRead } from '../src/ddb-private-read-node';

test('retained runtime imports the connector and refuses a classical endpoint without private HTTP', async () => {
  const cert = readFileSync(join(__dirname, 'fixtures/pq-node-cert.pem'));
  const key = readFileSync(join(__dirname, 'fixtures/pq-node-key.pem'));
  const pin = '0x' + createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  let requests = 0;
  const sockets = new Set<Socket>();
  // Every retained runtime can construct this classical fixture. An unsupported
  // client runtime may refuse configuration; a capable one must refuse the
  // negotiated classical group. Neither path is allowed to send private HTTP.
  const server = createServer({ cert, key, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', ecdhCurve: 'X25519', ciphers: 'TLS_AES_256_GCM_SHA384' }, (_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"jsonrpc":"2.0","id":1,"result":[]}');
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = '0x' + '34'.repeat(20);
    const hash = '0x' + '12'.repeat(32);
    const group = new Uint8Array(32); group[31] = 1;
    const route = { database: 'c_' + address.slice(2), contract: address, enabled: true, private: true, block: '0x1', blockHash: hash, stateRoot: hash, epoch: '0x1', manager: address, runtimeHash: hash, version: '0x1', groupHash: '0x' + Buffer.from(keccak_256(group)).toString('hex'), members: [{ validatorId: 1, address }] };
    const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const connection = { route, member: route.members[0], endpoints: [{ scheme: 'https', url, tlsKeyHash: pin }] };
    const trusted = { route, validatorId: 1, address, url, tlsKeyHash: pin };
    const operation = connectDdbNodePrivateRead(connection, trusted, { ca: cert }).then(channel =>
      channel.send('ddb_signedSelect', [{ private: 'must-not-leave-client' }]));
    await expect(operation).rejects.toThrow(/post-quantum|ECDH curve|unsupported.*group|unknown group/i);
    expect(requests).toBe(0);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
