import { createHash } from 'crypto';
import { Agent, request as httpsRequest } from 'https';
import { isIP } from 'net';
import { connect as tlsConnect } from 'tls';
import { TextDecoder } from 'util';
import type { DdbNodePrivateReadTransportOptions } from './ddb-private-read-node';

function bound(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0 || n > maximum) throw new Error(`invalid private transport ${name}`);
  return n;
}

/** @internal One verified socket. Public wrappers own their fixed method allowlists and identity checks. */
export async function openPrivateNodeChannel(trustedURL: string, trustedPin: string, methods: readonly string[], options: DdbNodePrivateReadTransportOptions = {}) {
  if (!/^0x[0-9a-f]{64}$/.test(trustedPin) || /^0x0+$/.test(trustedPin)) throw new Error('invalid private channel pin');
  const allowed = Object.freeze(Array.from(methods));
  const endpoint = new URL(trustedURL);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('trusted private read endpoint must be an HTTPS directory origin');
  }
  const timeoutMs = bound(options.timeoutMs, 10000, 300000, 'deadline');
  const requestLimit = bound(options.maxRequestBytes, 1024 * 1024, 64 * 1024 * 1024, 'request limit');
  const responseLimit = bound(options.maxResponseBytes, 4 * 1024 * 1024, 64 * 1024 * 1024, 'response limit');
  const host = endpoint.hostname.replace(/^\[|\]$/g, '');
  const ca = Array.isArray(options.ca) ? options.ca.map(c => typeof c === 'string' ? c : Buffer.from(c)) :
    typeof options.ca === 'string' || options.ca === undefined ? options.ca : Buffer.from(options.ca as Buffer);
  const socket = tlsConnect({
    host, port: Number(endpoint.port || 443), servername: isIP(host) ? undefined : host,
    ca, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
    // A classical-only server is identified and refused before any private HTTP bytes.
    ecdhCurve: 'X25519MLKEM768:X25519', ciphers: 'TLS_AES_256_GCM_SHA384',
    ALPNProtocols: ['http/1.1'],
  });
  let failure: Error | undefined;
  let agent: Agent | undefined;
  socket.on('error', error => { failure = failure ?? error; });
  socket.on('close', () => { failure = failure ?? new Error('private read channel closed'); });
  const deadline = setTimeout(() => {
    failure = new Error('private read transport deadline exceeded');
    socket.destroy(failure);
  }, timeoutMs);
  deadline.unref();
  const close = () => {
    clearTimeout(deadline);
    socket.destroy();
    agent?.destroy();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        socket.removeListener('secureConnect', ready);
        socket.removeListener('error', failed);
        socket.removeListener('close', ended);
        error ? reject(error) : resolve();
      };
      const failed = (error: Error) => finish(error);
      const ended = () => finish(failure ?? new Error('private read TLS handshake closed'));
      const ready = () => {
        try {
          if (!socket.authorized || socket.getProtocol() !== 'TLSv1.3' || socket.isSessionReused()) {
            throw new Error('private read TLS identity or fresh handshake unavailable');
          }
          const group = socket.getEphemeralKeyInfo() as { type?: string; name?: string } | null;
          if (group?.type !== 'TLSGroup' || group.name !== 'X25519MLKEM768') {
            throw new Error('private read transport did not negotiate the required post-quantum group');
          }
          if (socket.getCipher().standardName !== 'TLS_AES_256_GCM_SHA384' ||
              (socket.alpnProtocol && socket.alpnProtocol !== 'http/1.1')) {
            throw new Error('private read transport negotiated an unsupported TLS profile');
          }
          const certificate = socket.getPeerX509Certificate();
          const actualPin = certificate && '0x' + createHash('sha256')
            .update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
          if (actualPin !== trustedPin) throw new Error('private read endpoint public-key pin differs');
          finish();
        } catch (error) { finish(error as Error); }
      };
      socket.once('secureConnect', ready);
      socket.once('error', failed);
      socket.once('close', ended);
    });
  } catch (error) {
    close();
    throw error;
  }
  // HTTPS must consume this exact verified socket; it has no permission to open a replacement.
  agent = new Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0 });
  let attached = false;
  agent.createConnection = () => {
    if (attached || failure || socket.destroyed) throw failure ?? new Error('private read verified socket unavailable');
    attached = true;
    return socket;
  };
  let consumed = false;
  return Object.freeze({
    endpointAuthenticated: true as const, confidentiality: 'post-quantum' as const,
    negotiatedGroup: 'X25519MLKEM768' as const, close,
    send: async (method: string, params: any[]): Promise<any> => {
      if (consumed) throw new Error('private read transport already consumed');
      consumed = true;
      try {
        if (failure || socket.destroyed) throw failure ?? new Error('private read channel closed');
        if (!allowed.includes(method) || !Array.isArray(params)) {
          throw new Error('private transport accepts only a signed read or private transaction');
        }
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), 'utf8');
        if (body.length > requestLimit) throw new Error('private read request exceeds byte limit');
        return await new Promise<any>((resolve, reject) => {
          const request = httpsRequest(endpoint, {
            method: 'POST', agent, maxHeaderSize: 16384,
            headers: { 'content-type': 'application/json', accept: 'application/json', 'content-length': body.length, connection: 'close' },
          }, response => {
            if (response.statusCode !== 200) {
              response.destroy();
              reject(new Error(`private read HTTP status ${response.statusCode}`));
              return;
            }
            if ((response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
                !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '')) {
              response.destroy();
              reject(new Error('private read response is not uncompressed JSON'));
              return;
            }
            let bytes = 0;
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > responseLimit) {
                reject(new Error('private read response exceeds byte limit'));
                response.destroy();
                return;
              }
              chunks.push(chunk);
            });
            response.once('error', reject);
            response.once('aborted', () => reject(new Error('private read response interrupted')));
            response.once('end', () => {
              try {
                const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
                const hasResult = value && Object.prototype.hasOwnProperty.call(value, 'result');
                const hasError = value && Object.prototype.hasOwnProperty.call(value, 'error');
                if (!value || Array.isArray(value) || value.jsonrpc !== '2.0' || value.id !== 1 || hasResult === hasError) {
                  throw new Error('private read response has an invalid JSON-RPC outcome');
                }
                if (hasError) {
                  if (!value.error || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== 'string') {
                    throw new Error('private read response has an invalid JSON-RPC error');
                  }
                  reject(Object.assign(new Error(value.error.message), { code: value.error.code, data: value.error.data }));
                } else resolve(value.result);
              } catch (error) { reject(error); }
            });
          });
          request.once('socket', assigned => {
            if (assigned !== socket) request.destroy(new Error('private read request lost its verified socket'));
          });
          request.once('error', reject);
          request.end(body);
        });
      } finally { close(); }
    },
  });
}
