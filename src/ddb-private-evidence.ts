import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';
import { parseDdbCurrentReadRoute, type DdbCurrentReadRoute } from './ddb-private-read';
import { isSupportedPlacementManagerRuntime } from './ddb-proof';
import { DDB_COMMITMENT_PAYLOAD_MAX_BYTES } from './ddb-commitment';
import { MLDSA87_PUBKEY_BYTES } from './key-registry';
import type { DdbPrivateTxnFinalityCandidate } from './ddb-private-txn-outcome';

/** Existing reviewed node ddb/endpointdir/bin.go runtime, not an authority or a deployment address. */
export const ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH = '0x333c197b999995b13b16b18f7508918e0f89b4f57cd4777a6afabd5d30d73eb6';
export interface DdbPrivateEvidenceSource { readonly validatorId: number; readonly address: string; readonly url: string; readonly tlsKeyHash: string }
export interface DdbPrivateAuthority {
  readonly trust: 'trusted-validating-node'; readonly chain: string; readonly database: string; readonly caller: string;
  readonly source: DdbPrivateEvidenceSource;
}
export interface DdbPrivateAssignmentEvidence {
  readonly chain: string; readonly placement: DdbCurrentReadRoute; readonly maxMembers: number;
  readonly endpointDirectory: string; readonly endpointRuntime: string; readonly blockTime: bigint;
  readonly hosts: readonly {
    readonly validatorId: number; readonly address: string; readonly publicKey: string; readonly auth: string;
    readonly expiry: bigint; readonly live: boolean;
    readonly endpoints: readonly { readonly scheme: string; readonly url: string; readonly tlsKeyHash: string }[];
  }[];
}

/** @internal Closed bounded parsers shared by the Node adapter and local retry codec. */
export const evidenceHex = (bytes: Uint8Array): string => '0x' + bytesToHex(bytes);
export function evidenceFail(): never { throw new Error('private evidence unavailable'); }
export function evidenceObject(value: unknown, fields: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
    Object.keys(value).some(k => !fields.includes(k)) || fields.some(k => !Object.prototype.hasOwnProperty.call(value, k))) return evidenceFail();
  return value as Record<string, any>;
}
export function evidenceFixed(value: unknown, size: number, nonzero = true): string {
  if (typeof value !== 'string' || value.length !== size * 2 + 2 || !/^0x[0-9a-f]+$/.test(value) || nonzero && /^0x0+$/.test(value)) return evidenceFail();
  return value;
}
export function evidenceBytes(value: unknown, max = DDB_COMMITMENT_PAYLOAD_MAX_BYTES): Uint8Array {
  if (typeof value !== 'string' || value.length < 4 || value.length > 2 + max * 2 || value.length % 2 || !/^0x[0-9a-f]+$/.test(value)) return evidenceFail();
  return hexToBytes(value.slice(2));
}
export function evidenceQuantity(value: unknown, positive = false): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(value)) return evidenceFail();
  const n = BigInt(value); if (positive && n === BigInt(0)) return evidenceFail(); return n;
}
export function evidenceBlock(value: unknown): bigint {
  const n = evidenceQuantity(value, true); if (n > BigInt('9223372036854775807')) return evidenceFail(); return n;
}
export function evidenceMemberBound(value: unknown): number {
  const n = evidenceQuantity(value, true); if (n > BigInt(4)) return evidenceFail(); return Number(n);
}
export function evidenceRecipient(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 0xffffffff) return evidenceFail(); return value;
}
export function evidenceOrigin(value: unknown, schemes = ['https']): string {
  if (typeof value !== 'string' || value.length > 263) return evidenceFail();
  const u = new URL(value);
  if (!schemes.includes(u.protocol.slice(0, -1)) || !u.hostname || u.username || u.password || u.search || u.hash || u.pathname !== '/' || value.trim() !== value) return evidenceFail();
  return value;
}
export function ownPrivateAuthority(value: DdbPrivateAuthority): DdbPrivateAuthority {
  if (!value || value.trust !== 'trusted-validating-node') return evidenceFail();
  const chain = evidenceFixed(value.chain, 32), caller = evidenceFixed(value.caller, 20);
  if (typeof value.database !== 'string' || !/^c_[0-9a-f]{40}$/.test(value.database) || /^c_0+$/.test(value.database)) return evidenceFail();
  const s = evidenceObject(value.source, ['validatorId', 'address', 'url', 'tlsKeyHash']);
  const source = Object.freeze({ validatorId: evidenceRecipient(s.validatorId), address: evidenceFixed(s.address, 20),
    url: evidenceOrigin(s.url), tlsKeyHash: evidenceFixed(s.tlsKeyHash, 32) });
  return Object.freeze({ trust: 'trusted-validating-node', chain, database: value.database, caller, source });
}
export function evidenceRoute(database: string, value: unknown): DdbCurrentReadRoute {
  const r = evidenceObject(value, ['database', 'contract', 'enabled', 'private', 'block', 'blockHash', 'stateRoot', 'epoch', 'manager', 'runtimeHash', 'version', 'groupHash', 'members']);
  evidenceBlock(r.block); for (const k of ['epoch', 'version']) evidenceQuantity(r[k], true);
  for (const k of ['blockHash', 'stateRoot', 'runtimeHash', 'groupHash']) evidenceFixed(r[k], 32);
  evidenceFixed(r.manager, 20); evidenceFixed(r.contract, 20);
  if (!Array.isArray(r.members) || r.members.length < 1 || r.members.length > 64) return evidenceFail();
  Array.from(r.members, m => { const member = evidenceObject(m, ['validatorId', 'address']); evidenceRecipient(member.validatorId); evidenceFixed(member.address, 20); });
  const route = parseDdbCurrentReadRoute('0x' + database.slice(2), value);
  if (!route.private || !route.enabled || route.database !== database || !isSupportedPlacementManagerRuntime(route.runtimeHash)) return evidenceFail();
  return route;
}
export function samePrivateRoute(a: DdbCurrentReadRoute, b: DdbCurrentReadRoute): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export function parsePrivateAssignment(value: unknown, scope: DdbPrivateAuthority, at: 'current' | string): DdbPrivateAssignmentEvidence {
  const r = evidenceObject(value, ['chain', 'placement', 'maxMembers', 'endpointDirectory', 'endpointRuntime', 'blockTime', 'hosts']);
  if (evidenceFixed(r.chain, 32) !== scope.chain || r.endpointRuntime !== ENDPOINT_DIRECTORY_RUNTIME_CODE_HASH) return evidenceFail();
  const placement = evidenceRoute(scope.database, r.placement), maxMembers = evidenceMemberBound(r.maxMembers);
  if (at !== 'current' && placement.block !== at) return evidenceFail();
  const blockTime = evidenceQuantity(r.blockTime, true);
  if (!Array.isArray(r.hosts) || r.hosts.length !== placement.members.length) return evidenceFail();
  const hosts = Array.from(r.hosts, (v, i) => {
    const h = evidenceObject(v, ['validatorId', 'address', 'publicKey', 'auth', 'expiry', 'live', 'endpoints']);
    if (h.validatorId !== placement.members[i].validatorId || h.address !== placement.members[i].address || typeof h.live !== 'boolean' ||
      !Array.isArray(h.endpoints) || h.endpoints.length > 4) return evidenceFail();
    const expiry = evidenceQuantity(h.expiry), auth = evidenceFixed(h.auth, 20, h.live);
    const publicKey = evidenceFixed(h.publicKey, MLDSA87_PUBKEY_BYTES);
    if (h.live ? expiry <= blockTime || h.endpoints.length === 0 : h.endpoints.length !== 0) return evidenceFail();
    const endpoints = Object.freeze(Array.from(h.endpoints, ep => {
      const e = evidenceObject(ep, ['scheme', 'url', 'tlsKeyHash']);
      if (!['https', 'wss', 'http'].includes(e.scheme)) return evidenceFail();
      return Object.freeze({ scheme: e.scheme as string, url: evidenceOrigin(e.url, [e.scheme]), tlsKeyHash: evidenceFixed(e.tlsKeyHash, 32, e.scheme !== 'http') });
    }));
    return Object.freeze({ validatorId: h.validatorId as number, address: h.address as string, publicKey, auth, expiry, live: h.live as boolean, endpoints });
  });
  return Object.freeze({ chain: scope.chain, placement, maxMembers, endpointDirectory: evidenceFixed(r.endpointDirectory, 20),
    endpointRuntime: r.endpointRuntime as string, blockTime, hosts: Object.freeze(hosts) });
}

export function parsePrivateFinality(value: unknown): DdbPrivateTxnFinalityCandidate & { readVersion: bigint; operationHashes: string[]; payloadCommitments: string[] } {
  const r = evidenceObject(value, ['chain', 'database', 'caller', 'txnId', 'commitTx', 'block', 'blockHash', 'placementVersion', 'groupHash', 'groupJournalHash',
    'digestVersion', 'digestFingerprint', 'initialAnchor', 'finalAnchor', 'memberCount', 'readVersion', 'operationHashes', 'payloadCommitments', 'transaction']);
  const memberCount = evidenceQuantity(r.memberCount, true);
  if (memberCount > BigInt(4) || typeof r.database !== 'string' || !/^c_[0-9a-f]{40}$/.test(r.database)) return evidenceFail();
  const hashes = (v: unknown): string[] => {
    if (!Array.isArray(v) || BigInt(v.length) !== memberCount) return evidenceFail();
    return Array.from(v, h => evidenceFixed(h, 32));
  };
  const commitTx = evidenceFixed(r.commitTx, 32);
  if (evidenceHex(keccak_256(evidenceBytes(r.transaction, 4 * DDB_COMMITMENT_PAYLOAD_MAX_BYTES))) !== commitTx) return evidenceFail();
  return { chain: evidenceFixed(r.chain, 32), database: r.database, caller: evidenceFixed(r.caller, 20), txnId: evidenceFixed(r.txnId, 32), commitTx,
    block: evidenceBlock(r.block), blockHash: evidenceFixed(r.blockHash, 32), placementVersion: evidenceQuantity(r.placementVersion, true),
    groupHash: evidenceFixed(r.groupHash, 32), groupJournalHash: evidenceFixed(r.groupJournalHash, 32), digestVersion: evidenceQuantity(r.digestVersion, true),
    digestFingerprint: evidenceFixed(r.digestFingerprint, 32), initialAnchor: evidenceFixed(r.initialAnchor, 32, false), finalAnchor: evidenceFixed(r.finalAnchor, 32, false),
    memberCount, readVersion: evidenceBlock(r.readVersion), operationHashes: hashes(r.operationHashes), payloadCommitments: hashes(r.payloadCommitments) };
}
