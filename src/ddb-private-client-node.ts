import { ddbNodePrivateOptions, type DdbTrustedNodePrivateOptions } from './ddb-private-trust-node';
import { createDdbPrivateClient, type DdbPrivateClientOptions, type DdbPrivatePrepareInput } from './ddb-private-client';

export interface DdbPrivateReferenceClientOptions extends Omit<DdbPrivateClientOptions, 'authority'> {
  authority: DdbTrustedNodePrivateOptions;
}
export interface DdbPrivateReferencePrepareInput extends DdbPrivatePrepareInput {}

/** Node reference flow retaining real TLS option ownership and explicit persistence inputs. */
export function createDdbPrivateReferenceClient(input: DdbPrivateReferenceClientOptions) {
  return createDdbPrivateClient({ ...input, authority: ddbNodePrivateOptions(input.authority) });
}
