/** Node-only application entry: supply real authority, signer/key provider, resolver and encrypted store.
 * No embedded keys, implicit source, RPC URL, host policy, live action or automatic SQL replay.
 */
import { createDdbPrivateReferenceClient, type DdbPrivateReferenceClientOptions,
  type DdbPrivateReferencePrepareInput } from '../src/ddb-private-client-node';
import { createDdbNodePrivateRetryStore, type DdbNodePrivateRetryStoreOptions } from '../src/ddb-private-retry-node';

/** Compose actual encrypted persistence; all authority, key and filesystem choices are supplied. */
export function createPrivateClient(options: Omit<DdbPrivateReferenceClientOptions, 'store'>,
  storage: DdbNodePrivateRetryStoreOptions) {
  return createDdbPrivateReferenceClient({ ...options, store: createDdbNodePrivateRetryStore(storage) });
}

export async function preparePrivate(options: DdbPrivateReferenceClientOptions, intent: DdbPrivateReferencePrepareInput) {
  return createDdbPrivateReferenceClient(options).prepare(intent); // Returns only after persistence succeeds.
}
export async function custodyPrivate(options: DdbPrivateReferenceClientOptions, txnId: string) {
  return createDdbPrivateReferenceClient(options).custody(txnId);
}
export async function submitPrivateOnce(options: DdbPrivateReferenceClientOptions, txnId: string) {
  return createDdbPrivateReferenceClient(options).submit(txnId); // Checkpoint precedes the one submit.
}
export async function resumePrivate(options: DdbPrivateReferenceClientOptions, txnId: string) {
  return createDdbPrivateReferenceClient(options).collect(txnId); // No prepare/store/submit side effects.
}
