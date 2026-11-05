import { hexToBytes } from '@noble/hashes/utils';
import { DDB_TXN_MAX_OPS } from './ddb';
import { DDB_COMMITMENT_PAYLOAD_MAX_BYTES as PAYLOAD } from './ddb-commitment';
import { MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES } from './key-registry';
import { ownedPrivateTransactionRecord, type DdbPrivateTransactionRetryRecord } from './ddb-private-txn-online';
import { evidenceObject as obj, evidenceFixed as fixed, evidenceRecipient as recipient, evidenceHex as hex, ownPrivateAuthority, type DdbPrivateAuthority } from './ddb-private-evidence';

/** Conservative valid representation bound: two envelopes + sidecar per member, plus route/policy metadata.
 * Each envelope allows the existing payload-sized hex data, both bounded tag sides (48 bytes/tag),
 * both key/signature widths (also overcounted for unsigned), and 8 KiB for its fixed scalar/header fields.
 * Metadata allowance 128 KiB exceeds full64-member route, explicit host policies and authority fields.
 */
export const DDB_PRIVATE_RETRY_WORST_CASE_BYTES = DDB_TXN_MAX_OPS *
  (2 * (2 + 2 * PAYLOAD + 2 * (PAYLOAD / 32) * 48 + 2 * MLDSA87_PUBKEY_BYTES + 2 * MLDSA87_SIG_BYTES + 8192) + 2 + 2 * PAYLOAD + 8192) + 131072;
export const DDB_PRIVATE_RETRY_MAX_BYTES = 8 * 1024 * 1024;

export interface DdbPrivateRetryPolicy {
  readonly custodyHosts: readonly number[];
  readonly requiredHosts: readonly number[];
  readonly submitRecipient: number;
}
export interface DdbPrivateRetryState {
  kind: 'private-client-retry-v1';
  record: DdbPrivateTransactionRetryRecord;
  authority: DdbPrivateAuthority;
  policy: DdbPrivateRetryPolicy;
  phase: 'prepared' | 'submission_attempted';
  commitTxHash: string | null;
}
export interface DdbPrivateRetryStore {
  create(state: DdbPrivateRetryState): Promise<void>;
  load(txnId: string): Promise<DdbPrivateRetryState>;
  /** Atomic prepared -> attempted transition; repeated attempts refuse before the network. */
  beginSubmission(txnId: string): Promise<DdbPrivateRetryState>;
  recordSubmission(txnId: string, commitTxHash: string): Promise<void>;
}
const fail = (): never => { throw new Error('private retry record unavailable'); };
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
/** @internal Takes owned validated copies. Excluded from package entrypoints. */
export function ownDdbPrivateRetryState(input: DdbPrivateRetryState): DdbPrivateRetryState {
  try {
    obj(input, ['kind', 'record', 'authority', 'policy', 'phase', 'commitTxHash']);
    if (input.kind !== 'private-client-retry-v1' || !['prepared', 'submission_attempted'].includes(input.phase) ||
      input.phase === 'prepared' && input.commitTxHash !== null) return fail();
    const commitTxHash = input.commitTxHash === null ? null : fixed(input.commitTxHash, 32);
    obj(input.authority, ['trust', 'chain', 'database', 'caller', 'source']);
    const authority = ownPrivateAuthority(input.authority);
    obj(input.record, ['kind', 'retained', 'signedMembers', 'completePlacement', 'maxMembers', 'roots']);
    obj(input.record.retained, ['id', 'members', 'sidecars']);
    if (!Array.isArray(input.record.retained.members)) return fail();
    Array.from(input.record.retained.members, m => obj(m, ['hash', 'envelope']));
    const owned = ownedPrivateTransactionRecord(input.record);
    if (owned.base.chain !== authority.chain || owned.base.database !== authority.database || owned.base.caller !== authority.caller) return fail();
    const p = obj(input.policy, ['custodyHosts', 'requiredHosts', 'submitRecipient']);
    function hosts(values: unknown, required: boolean): number[] {
      if (!Array.isArray(values) || values.length > 64 || required && values.length === 0) return fail();
      const ids = Array.from(values, recipient);
      if (new Set(ids).size !== ids.length || required && ids.some((id, i) => i > 0 && id <= ids[i - 1]) ||
        ids.some(id => !owned.placement.members.some(m => m.validatorId === id))) return fail();
      return ids;
    }
    const policy = { custodyHosts: hosts(p.custodyHosts, false), requiredHosts: hosts(p.requiredHosts, true), submitRecipient: recipient(p.submitRecipient) };
    if (!owned.placement.members.some(m => m.validatorId === policy.submitRecipient)) return fail();
    const record: DdbPrivateTransactionRetryRecord = { kind: 'private-transaction-retry-v1', retained: owned.retained, signedMembers: owned.signedMembers,
      completePlacement: owned.placement, maxMembers: owned.maxMembers, roots: owned.roots };
    return { kind: input.kind, record, authority, policy, phase: input.phase, commitTxHash };
  } catch { return fail(); }
}
function wireState(state: DdbPrivateRetryState) {
  return { ...state, record: { ...state.record, retained: { ...state.record.retained,
    members: state.record.retained.members.map(m => ({ envelope: m.envelope, hash: hex(m.hash) })) } } };
}
/** Local storage encoding only. Contains private material; protect it before writing to disk. */
export function encodeDdbPrivateRetryState(input: DdbPrivateRetryState): Uint8Array {
  try {
    const out = new TextEncoder().encode(stable(wireState(ownDdbPrivateRetryState(input))));
    if (out.length > DDB_PRIVATE_RETRY_MAX_BYTES) { out.fill(0); return fail(); }
    return out;
  } catch { return fail(); }
}
/** Rehydrates exact typed hashes and rejects alternate/unknown/duplicate local JSON spellings. */
export function decodeDdbPrivateRetryState(bytes: Uint8Array): DdbPrivateRetryState {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > DDB_PRIVATE_RETRY_MAX_BYTES) return fail();
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(input?.record?.retained?.members) || input.record.retained.members.length > DDB_TXN_MAX_OPS) return fail();
    input.record.retained.members = Array.from(input.record.retained.members, (m: any) => ({ ...m, hash: hexToBytes(fixed(m.hash, 32).slice(2)) }));
    const owned = ownDdbPrivateRetryState(input), canonical = encodeDdbPrivateRetryState(owned);
    try { if (canonical.length !== bytes.length || canonical.some((b, i) => b !== bytes[i])) return fail(); }
    finally { canonical.fill(0); }
    return owned;
  } catch { return fail(); }
}
