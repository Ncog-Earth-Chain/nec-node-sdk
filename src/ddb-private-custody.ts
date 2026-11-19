import type { DdbCurrentReadRoute } from './ddb-private-read';
import { evidenceObject as obj, evidenceFixed as fixed, evidenceRecipient, evidenceOrigin, evidenceFail as fail,
  type DdbPrivateEvidenceSource } from './ddb-private-evidence';

/** Current endpoint facts from an explicitly trusted source; not placement or durability evidence. */
export interface DdbPrivateCustodyBinding {
  readonly chain: string;
  readonly validatorId: number;
  readonly auth: string;
  readonly directory: string;
  readonly block: number;
  readonly blockTime: number;
  readonly expiry: number;
  readonly source: DdbPrivateEvidenceSource;
  readonly url: string;
  readonly tlsKeyHash: string;
}
export interface DdbAuthenticatedCustodyTransport {
  readonly binding: DdbPrivateCustodyBinding;
  readonly endpointAuthenticated: true;
  readonly confidentiality: 'post-quantum';
  send(method: string, params: any[]): Promise<any>;
  close(): void;
}
/** Local adapter context captured only after retained BASE and historical membership verification. */
export interface DdbPrivateCustodyContext {
  readonly txnId: string;
  readonly originalPlacement: DdbCurrentReadRoute;
}
export interface DdbPrivateCustodyPolicy {
  /** Authenticate current endpoint ownership for this stable ID, independently of resolver claims. */
  connect(validatorId: number, context?: DdbPrivateCustodyContext): Promise<DdbAuthenticatedCustodyTransport>;
}
function integer(value: unknown, positive = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) return fail();
  return value;
}
/** @internal Own bounded endpoint facts before signing or asynchronous transport work. */
export function ownPrivateCustodyBinding(value: DdbPrivateCustodyBinding): DdbPrivateCustodyBinding {
  const r = obj(value, ['chain', 'validatorId', 'auth', 'directory', 'block', 'blockTime', 'expiry', 'source', 'url', 'tlsKeyHash']);
  const s = obj(r.source, ['validatorId', 'address', 'url', 'tlsKeyHash']);
  const source = Object.freeze({ validatorId: evidenceRecipient(s.validatorId), address: fixed(s.address, 20),
    url: evidenceOrigin(s.url), tlsKeyHash: fixed(s.tlsKeyHash, 32) });
  const blockTime = integer(r.blockTime), expiry = integer(r.expiry);
  if (expiry <= blockTime || expiry <= Math.floor(Date.now() / 1000)) return fail();
  return Object.freeze({ chain: fixed(r.chain, 32), validatorId: evidenceRecipient(r.validatorId), auth: fixed(r.auth, 20),
    directory: fixed(r.directory, 20), block: integer(r.block), blockTime, expiry, source,
    url: evidenceOrigin(r.url), tlsKeyHash: fixed(r.tlsKeyHash, 32) });
}

/** @internal Parse the existing numeric ddb_hostEndpoints response. Unsafe JSON integers refuse. */
export function parsePrivateCustodyEndpoint(value: unknown, chain: string, validatorId: number, source: DdbPrivateEvidenceSource): DdbPrivateCustodyBinding {
  const r = obj(value, ['directory', 'block', 'blockTime', 'hosts']);
  if (!Array.isArray(r.hosts) || r.hosts.length !== 1) return fail();
  const h = obj(r.hosts[0], ['validatorId', 'live', 'status', 'expiry', 'auth', 'endpoints']);
  if (h.validatorId !== validatorId || h.live !== true || h.status !== 'live' || !Array.isArray(h.endpoints) ||
    h.endpoints.length < 1 || h.endpoints.length > 4) return fail();
  const endpoints = h.endpoints.map((raw: unknown) => {
    const e = obj(raw, ['scheme', 'url', 'tlsKeyHash']);
    if (e.scheme !== 'https') return fail();
    return { url: evidenceOrigin(e.url), tlsKeyHash: fixed(e.tlsKeyHash, 32) };
  });
  return ownPrivateCustodyBinding({ chain, validatorId, auth: h.auth, directory: r.directory, block: r.block,
    blockTime: r.blockTime, expiry: h.expiry, source, ...endpoints[0] });
}
