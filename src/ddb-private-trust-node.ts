import { openPrivateNodeChannel } from './ddb-private-channel-node';
import { connectDdbNodePrivateRead, type DdbNodePrivateReadTransportOptions } from './ddb-private-read-node';
import { createDdbTrustedPrivatePolicy, type DdbTrustedPrivateOptions } from './ddb-private-trust';
import type { DdbSigner } from './ddb';
import { evidenceObject as obj, evidenceFixed as fixed, evidenceRecipient, evidenceOrigin, ownPrivateAuthority,
  type DdbPrivateAuthority, type DdbPrivateEvidenceSource } from './ddb-private-evidence';

const METHODS = Object.freeze(['ddb_getPrivateAssignmentEvidence', 'ddb_getPrivateTransactionSnapshotEvidence', 'ddb_getPrivateTransactionFinalityEvidence']);

/** Authenticate the explicitly configured source directly. No route discovery or policy recursion. */
export async function connectDdbNodePrivateEvidence(source: DdbPrivateEvidenceSource, options: DdbNodePrivateReadTransportOptions = {}) {
  const s = obj(source, ['validatorId', 'address', 'url', 'tlsKeyHash']);
  const binding = Object.freeze({ validatorId: evidenceRecipient(s.validatorId), address: fixed(s.address, 20),
    url: evidenceOrigin(s.url), tlsKeyHash: fixed(s.tlsKeyHash, 32) });
  const channel = await openPrivateNodeChannel(binding.url, binding.tlsKeyHash, METHODS, options);
  return Object.freeze({ ...channel, binding });
}

export interface DdbTrustedNodePrivateOptions extends DdbPrivateAuthority {
  signer: DdbSigner;
  sourceTls?: DdbNodePrivateReadTransportOptions;
  hostTls?: DdbNodePrivateReadTransportOptions;
}
function optionsCopy(options: DdbNodePrivateReadTransportOptions = {}): DdbNodePrivateReadTransportOptions {
  const ca = Array.isArray(options.ca) ? options.ca.map(v => typeof v === 'string' ? v : Buffer.from(v)) :
    typeof options.ca === 'string' || options.ca === undefined ? options.ca : Buffer.from(options.ca as Buffer);
  return Object.freeze({ ca, timeoutMs: options.timeoutMs, maxRequestBytes: options.maxRequestBytes, maxResponseBytes: options.maxResponseBytes });
}
/** @internal Capture Node TLS options before any asynchronous callback. Not a package export. */
export function ddbNodePrivateOptions(input: DdbTrustedNodePrivateOptions): DdbTrustedPrivateOptions {
  const authority = ownPrivateAuthority(input), sourceTls = optionsCopy(input.sourceTls), hostTls = optionsCopy(input.hostTls);
  return { ...authority, signer: input.signer,
    async connectEvidence(source) {
      const channel = await connectDdbNodePrivateEvidence(source, sourceTls);
      return Object.freeze({ ...channel, send: (method: string, params: readonly unknown[]) => channel.send(method, Array.from(params)) });
    },
    connectHost: (connection, trusted) => connectDdbNodePrivateRead(connection, trusted, hostTls),
  };
}

/** Explicit full-node trust with actual one-use authenticated Node hybrid TLS channels. */
export function createDdbTrustedNodePrivatePolicy(input: DdbTrustedNodePrivateOptions) {
  return createDdbTrustedPrivatePolicy(ddbNodePrivateOptions(input));
}
