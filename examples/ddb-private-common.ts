/** Common composition only. The application supplies its actual authenticated channels, store,
 * wallet signer and transient digest-key loader; this example implements no transport or approval UI.
 */
import { createDdbPrivateClient, type DdbPrivateClientOptions, type DdbPrivatePrepareInput } from '../src/ddb-private-client';
import { createDdbTrustedPrivatePolicy, type DdbTrustedPrivateOptions } from '../src/ddb-private-trust';

export function createApplicationPrivateClient(options: DdbPrivateClientOptions) {
  return createDdbPrivateClient(options);
}
export async function prepareApprovedPrivate(options: DdbPrivateClientOptions, approved: DdbPrivatePrepareInput) {
  return createDdbPrivateClient(options).prepare(approved);
}
export async function collectSavedPrivate(options: DdbPrivateClientOptions, txnId: string) {
  return createDdbPrivateClient(options).collect(txnId);
}
export function createApplicationPrivateReadPolicy(options: DdbTrustedPrivateOptions) {
  return createDdbTrustedPrivatePolicy(options).policy;
}
