import { createDdbNodePrivateTunnelDialer, projectDdbPrivateTunnelRoute } from './ddb-private-tunnel-node';
import { openPrivateNodeChannel } from './ddb-private-channel-node';
import { ownPrivateCustodyBinding, type DdbPrivateCustodyBinding, type DdbAuthenticatedCustodyTransport, type DdbPrivateCustodyContext } from './ddb-private-custody';
import type { DdbNodePrivateReadTransportOptions } from './ddb-private-read-node';

export interface DdbNodeAuthenticatedCustodyTransport extends DdbAuthenticatedCustodyTransport {
  readonly negotiatedGroup: 'X25519MLKEM768';
}
/** Trusted current stable-ID endpoint; one actual hybrid TLS socket and only the existing outcome RPC. */
export async function connectDdbNodePrivateCustody(trusted: DdbPrivateCustodyBinding,
  options: DdbNodePrivateReadTransportOptions = {}, context?: DdbPrivateCustodyContext): Promise<DdbNodeAuthenticatedCustodyTransport> {
  const binding = ownPrivateCustodyBinding(trusted);
  if (options.tunnel && (options.socketDialer || !context)) throw new Error('retained tunnel requires verified original transaction context');
  const transportOptions = options.tunnel ? { ...options, socketDialer: createDdbNodePrivateTunnelDialer({ ...options.tunnel,
    route: projectDdbPrivateTunnelRoute('0x' + BigInt(binding.chain).toString(16), context!.originalPlacement, binding.validatorId, 'retained-original') }) } : options;
  const channel = await openPrivateNodeChannel(binding.url, binding.tlsKeyHash, ['ddb_getPrivateTransactionOutcome'], transportOptions);
  try {
    ownPrivateCustodyBinding(binding); // Lease may have expired during the handshake.
    return Object.freeze({ ...channel, binding,
      async send(method: string, params: any[]): Promise<any> {
        try {
          ownPrivateCustodyBinding(binding); // Signing/user work must not outlive the lease.
          return await channel.send(method, params);
        } finally { channel.close(); }
      },
    });
  } catch (error) { channel.close(); throw error; }
}
