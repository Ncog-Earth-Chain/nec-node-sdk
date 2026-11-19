import { openPrivateNodeChannel } from './ddb-private-channel-node';
import { createDdbNodePrivateTunnelDialer, projectDdbPrivateTunnelRoute, type DdbPrivateNodeSocketDialer, type DdbNodePrivateTunnelOptions } from './ddb-private-tunnel-node';
import {
  parseDdbCurrentReadRoute,
  type DdbAuthenticatedReadTransport,
  type DdbPrivateReadConnection,
  type DdbTrustedReadEndpoint,
} from './ddb-private-read';

/** Supplied by independently trusted application state, never copied from resolver JSON alone. */
export type DdbNodeTrustedReadEndpoint = DdbTrustedReadEndpoint;

export interface DdbNodePrivateReadTransportOptions {
  /** Optional explicit CA roots. Normal certificate chain and hostname checks remain mandatory. */
  ca?: string | Buffer | readonly (string | Buffer)[];
  /** Explicit raw byte carrier; actual selected-host TLS authentication still runs inside it. */
  socketDialer?: DdbPrivateNodeSocketDialer;
  /** Automatic public projection for this independently authenticated selected assignment. */
  tunnel?: Omit<DdbNodePrivateTunnelOptions, 'route'> & { readonly chainId: string };
  /** One deadline for handshake, waiting to send, and response. Default 10 seconds; maximum 5 minutes. */
  timeoutMs?: number;
  /** Local resource limits, each at most 64 MiB. Defaults: request 1 MiB, response 4 MiB. */
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

/**
 * Actual hybrid key establishment; ordinary TLS certificate authentication remains classical.
 * This does not supply current-chain proofs, PQ server authentication, or browser/mobile transport.
 */
export interface DdbNodeAuthenticatedReadTransport extends DdbAuthenticatedReadTransport {
  readonly negotiatedGroup: 'X25519MLKEM768';
  /** Release a verified connection that the caller elects not to use. send() also closes it. */
  close(): void;
}

/**
 * Establish one real Node TLS connection before private request data reaches it. The trusted input
 * must already authenticate assignment, endpoint ownership/lease and current key. Matching copies
 * are only consistency checks here, not an independent chain trust mechanism.
 */
export async function connectDdbNodePrivateRead(
  connection: DdbPrivateReadConnection,
  trusted: DdbNodeTrustedReadEndpoint,
  options: DdbNodePrivateReadTransportOptions = {},
): Promise<DdbNodeAuthenticatedReadTransport> {
  const route = parseDdbCurrentReadRoute(connection.route.contract, connection.route);
  const expected = parseDdbCurrentReadRoute(route.contract, trusted.route);
  // Take owned scalar copies before the asynchronous handshake; caller-owned policy records can move.
  const trustedURL = trusted.url;
  const trustedPin = trusted.tlsKeyHash;
  const member = route.members.find(m => m.validatorId === connection.member.validatorId && m.address === connection.member.address);
  if (!route.enabled || !route.private || !member || JSON.stringify(route) !== JSON.stringify(expected) ||
      trusted.validatorId !== member.validatorId || trusted.address !== member.address ||
      !/^0x[0-9a-f]{64}$/.test(trusted.tlsKeyHash) || trusted.tlsKeyHash === '0x' + '00'.repeat(32) ||
      !connection.endpoints.some(e => e.scheme === 'https' && e.url === trusted.url && e.tlsKeyHash === trusted.tlsKeyHash)) {
    throw new Error('private read endpoint does not match trusted assignment and endpoint');
  }
  if (options.tunnel && options.socketDialer) throw new Error('private read accepts one explicit transport dialer');
  const transportOptions = options.tunnel ? { ...options, socketDialer: createDdbNodePrivateTunnelDialer({ ...options.tunnel,
    route: projectDdbPrivateTunnelRoute(options.tunnel.chainId, route, member.validatorId) }) } : options;
  const channel = await openPrivateNodeChannel(trustedURL, trustedPin,
    ['ddb_signedSelect', 'ddb_signedCallReadProcedure', 'ddb_tokenSelect', 'ddb_tokenCallReadProcedure', 'ddb_getPrivateTransactionOutcome',
      'ddb_previewPrivateBatch', 'ddb_putPayloadBatch', 'ddb_submitSignedTransaction'], transportOptions);
  return Object.freeze({ ...channel,
    binding: Object.freeze({ route, validatorId: member.validatorId, address: member.address, url: trustedURL, tlsKeyHash: trustedPin }) });
}
