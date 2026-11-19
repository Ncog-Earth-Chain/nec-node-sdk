import { Duplex } from 'stream';
import { WebSocket, createWebSocketStream } from 'ws';
import type { DdbCurrentReadRoute } from './ddb-private-read';

/** Raw ciphertext carrier only. TLS identity assertions are made by the inner channel. */
export type DdbPrivateNodeSocketDialer = (
  selected: Readonly<{ url: string; tlsKeyHash: string }>, signal: AbortSignal,
) => Promise<Duplex>;

export interface DdbPrivateTunnelRoute {
  readonly format: 'private-tunnel-route-v1';
  readonly audience: 'current' | 'retained-original';
  readonly chainId: string;
  readonly contract: string;
  readonly manager: string;
  readonly runtimeHash: string;
  readonly placementVersion: string;
  readonly groupHash: string;
  readonly validatorId: string;
  readonly assignmentBlockHash: string;
}

const KEYS = ['format', 'audience', 'chainId', 'contract', 'manager', 'runtimeHash', 'placementVersion', 'groupHash', 'validatorId', 'assignmentBlockHash'];
function fixed(v: unknown, bytes: number): string {
  if (typeof v !== 'string' || !new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(v) || /^0x0+$/.test(v)) throw new Error('invalid private tunnel identity');
  return v;
}
function quantity(v: unknown, bits: number): string {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v) || BigInt(v) === BigInt(0) || BigInt(v) >= (BigInt(1) << BigInt(bits))) {
    throw new Error('invalid private tunnel quantity');
  }
  return v;
}

/** Own the closed public projection. A transaction BASE/context never fits this key set. */
export function ownDdbPrivateTunnelRoute(value: DdbPrivateTunnelRoute): DdbPrivateTunnelRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Reflect.ownKeys(value).length !== KEYS.length ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || !KEYS.includes(k)) || KEYS.some(k => { const d = Object.getOwnPropertyDescriptor(value, k); return !d || !('value' in d) || !d.enumerable; }) ||
      value.format !== 'private-tunnel-route-v1' || !['current', 'retained-original'].includes(value.audience)) throw new Error('invalid closed private tunnel route');
  return Object.freeze({ format: value.format, audience: value.audience, chainId: quantity(value.chainId, 256), contract: fixed(value.contract, 20),
    manager: fixed(value.manager, 20), runtimeHash: fixed(value.runtimeHash, 32), placementVersion: quantity(value.placementVersion, 64),
    groupHash: fixed(value.groupHash, 32), validatorId: quantity(value.validatorId, 32), assignmentBlockHash: fixed(value.assignmentBlockHash, 32) });
}

/** Copy only public assignment scalars from already trusted current or original finalized state. */
export function projectDdbPrivateTunnelRoute(chainId: string, assignment: DdbCurrentReadRoute, validatorId: number,
  audience: DdbPrivateTunnelRoute['audience'] = 'current'): DdbPrivateTunnelRoute {
  if (!assignment?.enabled || !assignment.private || !Number.isInteger(validatorId) || validatorId < 1 || validatorId > 0xffffffff ||
      !assignment.members.some(m => m.validatorId === validatorId)) throw new Error('private tunnel selected member is absent');
  return ownDdbPrivateTunnelRoute({ format: 'private-tunnel-route-v1', audience, chainId, contract: assignment.contract,
    manager: assignment.manager, runtimeHash: assignment.runtimeHash, placementVersion: assignment.version, groupHash: assignment.groupHash,
    validatorId: '0x' + validatorId.toString(16), assignmentBlockHash: assignment.blockHash });
}

export interface DdbNodePrivateTunnelOptions {
  /** Explicit HTTPS ingress; fixed path only, no query, credentials or redirect. */
  ingressURL: string;
  route: DdbPrivateTunnelRoute;
  ca?: string | Buffer | readonly (string | Buffer)[];
  timeoutMs?: number;
  /** Ciphertext ceiling per direction, at most 128 MiB. */
  maxBytes?: number;
}

/**
 * One outer WSS stream, one public route, one selected-host inner TLS session.
 * Outer CA/name authentication never authenticates the selected host. No retry,
 * proxy agent, redirect, compression, session resumption or multiplexing is used.
 */
export function createDdbNodePrivateTunnelDialer(options: DdbNodePrivateTunnelOptions): DdbPrivateNodeSocketDialer {
  const route = ownDdbPrivateTunnelRoute(options.route), ingress = new URL(options.ingressURL);
  if (ingress.protocol !== 'https:' || !ingress.hostname || ingress.username || ingress.password || ingress.search || ingress.hash ||
      ingress.pathname !== '/ddb/private-tunnel/v1') throw new Error('invalid private tunnel ingress URL');
  ingress.protocol = 'wss:';
  const timeoutMs = options.timeoutMs ?? 10000, maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024) {
    throw new Error('invalid private tunnel local limit');
  }
  const ca = Array.isArray(options.ca) ? options.ca.map(c => typeof c === 'string' ? c : Buffer.from(c)) :
    typeof options.ca === 'string' || options.ca === undefined ? options.ca : Buffer.from(options.ca as Buffer);
  const routingBytes = JSON.stringify(route);
  return async (_selected, signal) => {
    if (signal.aborted) throw new Error('private tunnel aborted');
    const ws = new WebSocket(ingress, { ca, rejectUnauthorized: true, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3',
      followRedirects: false, perMessageDeflate: false, handshakeTimeout: timeoutMs, maxPayload: 65536,
      agent: false });
    // The caller's deadline covers route admission, inner TLS and the request.
    const abort = () => ws.terminate();
    signal.addEventListener('abort', abort, { once: true });
    let stream: Duplex | undefined;
    const timer = setTimeout(abort, timeoutMs); timer.unref();
    ws.once('close', () => { clearTimeout(timer); signal.removeEventListener('abort', abort); });
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { ws.removeListener('message', ready); ws.removeListener('error', fail); ws.removeListener('close', closed); };
        const fail = (e: Error) => { cleanup(); reject(e); };
        const closed = () => fail(new Error('private tunnel closed before selected-host dial'));
        const ready = (data: Buffer, binary: boolean) => {
          if (!binary || data.length !== 0) return fail(new Error('invalid private tunnel ready acknowledgement'));
          cleanup(); resolve();
        };
        ws.once('error', fail); ws.once('close', closed); ws.once('message', ready);
        ws.once('open', () => ws.send(routingBytes, { binary: false }, e => { if (e) fail(e); }));
      });
      clearTimeout(timer);
      let inbound = 0, outbound = 0;
      ws.on('message', (data: Buffer, binary: boolean) => {
        inbound += data.length;
        if (!binary || inbound > maxBytes) { stream?.destroy(new Error('private tunnel ciphertext limit or frame type')); ws.terminate(); }
      });
      stream = createWebSocketStream(ws, { highWaterMark: 32768, decodeStrings: true });
      const originalWrite = stream._write.bind(stream);
      stream._write = (chunk: Buffer, encoding, callback) => {
        outbound += chunk.length;
        if (outbound > maxBytes) return callback(new Error('private tunnel ciphertext limit'));
        let offset = 0;
        const next = (error?: Error | null): void => {
          if (error) return callback(error);
          if (offset === chunk.length) return callback();
          const end = Math.min(offset + 32768, chunk.length), piece = chunk.subarray(offset, end); offset = end;
          originalWrite(piece, encoding, next);
        };
        next();
      };
      stream.once('close', abort);
      return stream;
    } catch (error) { clearTimeout(timer); abort(); throw error; }
  };
}
