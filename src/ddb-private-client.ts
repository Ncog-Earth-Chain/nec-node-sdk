import { createDdbTrustedPrivatePolicy, type DdbTrustedPrivateOptions } from './ddb-private-trust';
import { prepareDdbPrivateTransaction, storeDdbPrivateTransactionPayloads, submitDdbPrivateTransaction,
  type DdbPrivateTransactionCall } from './ddb-private-txn-online';
import { collectDdbPrivateTransactionOutcome, type DdbPrivateTxnOutcomeResolver } from './ddb-private-txn-outcome';
import { ownDdbPrivateRetryState, type DdbPrivateRetryStore, type DdbPrivateRetryState, type DdbPrivateRetryPolicy } from './ddb-private-retry';
import { evidenceFixed, evidenceRecipient } from './ddb-private-evidence';

export interface DdbPrivateClientOptions {
  authority: DdbTrustedPrivateOptions;
  resolver: DdbPrivateTxnOutcomeResolver;
  store: DdbPrivateRetryStore;
  /** Return a fresh transient local digest-key buffer; this client clears it after preparation. */
  loadDigestKey(): Promise<Uint8Array>;
}
export interface DdbPrivatePrepareInput extends DdbPrivateRetryPolicy {
  members: readonly DdbPrivateTransactionCall[];
  prepareRecipient: number;
  keyVersion: number | bigint;
  timestamp?: number;
  expiry?: number | bigint;
}
const fail = (): never => { throw new Error('private reference client unavailable; retain the original retry record'); };
function policyCopy(input: DdbPrivateRetryPolicy): DdbPrivateRetryPolicy {
  function ids(values: readonly number[], required: boolean) {
    if (!Array.isArray(values) || values.length > 64 || required && !values.length) return fail();
    const out = Array.from(values, evidenceRecipient);
    if (new Set(out).size !== out.length || required && out.some((v, i) => i > 0 && v <= out[i - 1])) return fail();
    return out;
  }
  return { custodyHosts: ids(input.custodyHosts, false), requiredHosts: ids(input.requiredHosts, true), submitRecipient: evidenceRecipient(input.submitRecipient) };
}

/** Shared private flow; concrete authenticated channels and persistence are explicit application inputs. */
export function createDdbPrivateClient(input: DdbPrivateClientOptions) {
  const trust = createDdbTrustedPrivatePolicy(input.authority), authority = trust.authority;
  if (!input.resolver || typeof input.resolver.resolveCurrent !== 'function' || typeof input.resolver.hostEndpoints !== 'function' ||
    !input.store || ['create', 'load', 'beginSubmission', 'recordSubmission'].some(k => typeof (input.store as any)[k] !== 'function') || typeof input.loadDigestKey !== 'function') return fail();
  const resolver = { resolveCurrent: input.resolver.resolveCurrent.bind(input.resolver), hostEndpoints: input.resolver.hostEndpoints.bind(input.resolver) };
  const store = { create: input.store.create.bind(input.store), load: input.store.load.bind(input.store),
    beginSubmission: input.store.beginSubmission.bind(input.store), recordSubmission: input.store.recordSubmission.bind(input.store) };
  const signer = { getAddress: input.authority.signer.getAddress.bind(input.authority.signer),
    getPublicKey: input.authority.signer.getPublicKey.bind(input.authority.signer), signDdbHash: input.authority.signer.signDdbHash.bind(input.authority.signer) };
  const loadDigestKey = input.loadDigestKey;
  function checked(value: DdbPrivateRetryState, txnId: string): DdbPrivateRetryState {
    const state = ownDdbPrivateRetryState(value);
    if (state.record.retained.id !== txnId || JSON.stringify(state.authority) !== JSON.stringify(authority)) return fail();
    return state;
  }
  async function load(txnId: string) { const id = evidenceFixed(txnId, 32); return checked(await store.load(id), id); }
  return Object.freeze({
    trust: 'trusted-validating-node' as const,
    async prepare(options: DdbPrivatePrepareInput): Promise<string> {
      let digestKey: Uint8Array | undefined;
      try {
        const policy = policyCopy(options), prepareRecipient = evidenceRecipient(options.prepareRecipient);
        if (!Array.isArray(options.members) || options.members.length < 1 || options.members.length > 4) return fail();
        const members = Array.from(options.members, m => ({ data: typeof m.data === 'string' ? m.data : JSON.stringify(m.data), nonce: m.nonce, gasLimit: m.gasLimit }));
        const keyVersion = options.keyVersion, timestamp = options.timestamp, expiry = options.expiry;
        const assignment = await trust.readCurrentAssignment();
        const all = [prepareRecipient, policy.submitRecipient, ...policy.custodyHosts, ...policy.requiredHosts];
        if (all.some(id => !assignment.placement.members.some(m => m.validatorId === id))) return fail();
        digestKey = await loadDigestKey();
        const record = await prepareDdbPrivateTransaction({ ...authority, signer, resolver, policy: trust.policy, validatorId: prepareRecipient,
          maxMembers: assignment.maxMembers, digestKey, members, keyVersion, timestamp, expiry, acceptPreparedSnapshot: trust.acceptPreparedSnapshot });
        const state = ownDdbPrivateRetryState({ kind: 'private-client-retry-v1', record, authority, policy, phase: 'prepared', commitTxHash: null });
        await store.create(state); // No mutation helper is invoked before this durable-store contract succeeds.
        return record.retained.id;
      } catch { return fail(); } finally { if (digestKey instanceof Uint8Array) digestKey.fill(0); }
    },
    async custody(txnId: string) {
      try {
        const state = await load(txnId), results = [];
        for (const validatorId of state.policy.custodyHosts) results.push(await storeDdbPrivateTransactionPayloads({ record: state.record, resolver, policy: trust.policy, validatorId }));
        return results;
      } catch { return fail(); }
    },
    async submit(txnId: string) {
      try {
        const original = await load(txnId);
        if (original.phase !== 'prepared') return fail();
        const state = checked(await store.beginSubmission(original.record.retained.id), original.record.retained.id);
        if (state.phase !== 'submission_attempted') return fail();
        const receipt = await submitDdbPrivateTransaction({ record: state.record, resolver, policy: trust.policy, validatorId: state.policy.submitRecipient });
        let receiptStored = receipt.commitTxHash === null;
        if (receipt.commitTxHash !== null) {
          try { await store.recordSubmission(state.record.retained.id, receipt.commitTxHash); receiptStored = true; } catch { /* Attempt checkpoint remains recoverable. */ }
        }
        return { ...receipt, receiptStored };
      } catch { return fail(); }
    },
    async collect(txnId: string) {
      try {
        const state = await load(txnId);
        const outcome = await collectDdbPrivateTransactionOutcome({ signer, resolver, policy: trust.policy, chain: authority.chain,
          database: authority.database, caller: authority.caller, txnId: state.record.retained.id, expectedCommitTx: state.commitTxHash,
          maxMembers: state.record.maxMembers, retained: state.record.retained, completePlacement: state.record.completePlacement,
          requiredHosts: state.policy.requiredHosts, verifyHistoricalPlacement: trust.verifyHistoricalPlacement, verifyFinality: trust.verifyFinality });
        return { trust: 'trusted-validating-node' as const, outcome };
      } catch { return fail(); }
    },
  });
}
