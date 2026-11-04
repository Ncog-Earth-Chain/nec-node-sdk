# Private signed-read routing (PLACE-02F)

`Ddb.signedSelect` and `Ddb.signedCallReadProcedure` can send directly to the current database assignment's exact home. Private routing is an explicit opt-in: use a dedicated private client, or pass `privateRouting` in the signed read options. An unconfigured client retains the public/legacy behavior and does not infer privacy from the database name. Do not send private queries through that path.

```ts
import { Ddb, type DdbPrivateReadPolicy } from '@ncog/necjs';

// Supplied by the application after implementing trusted-state verification and
// authenticating its real confidential transport. The SDK has no default policy.
declare const trustedPrivateReadPolicy: DdbPrivateReadPolicy;

const privateDdb = new Ddb(provider, {
  privateRouting: { policy: trustedPrivateReadPolicy },
});
const rows = await privateDdb.signedSelect(signer, database, 'accounts',
  { exactNumbers: true }, { chainId: networkChainId });
```

The same option is available per call through `DdbSignedReadOptions.privateRouting` and `DdbSignedReadProcedureOptions.privateRouting`. It does not change signing domains, preimages, query options, consistency options or exact-number decoding. The database must be the canonical `c_<40 lowercase hex>` contract identity. Constructor private mode refuses anonymous `select`, `selectVersioned`, `query` and `callReadProcedure`: these lack the signed hash used for routing. Public metadata remains available.

## Assignment and channel trust

Each operation requests `ddb_resolveDatabase(contract, { currentRoute: true })`. `Ddb.resolveCurrent` and `DdbResolver.resolveCurrent` expose this claim separately from the sealed epoch resolver. The SDK validates its identities, exact uint64 quantities, full sorted member set and PlacementManager group hash, and makes an immutable copy. It does not cache this claim across reads. Missing support refuses, including an older server that simply omits `currentRoute`. `withProof: true` explicitly refuses with `unsupported-current-proof`; a sealed proof never proves this current assignment.

Validation of JSON syntax and hashes is not authentication. The required policy has two steps, both completed before the signed envelope, private query or procedure arguments reach any transport:

1. `verifyAssignment(route)` must authenticate a finalized header and the rules, governed manager/runtime, complete placement assignment and directory/member identity binding at that state, using independently trusted state. Return `true` only after those checks succeed. Resolver JSON, two agreeing RPC nodes and a sealed provider proof alone cannot establish this binding.
2. `connect({ route, member, endpoints })` must verify the endpoint's ownership against that trusted directory/member identity and authenticate its actual confidential channel. The SDK passes only the selected member's endpoint candidates, with no query, arguments or signature. Return a `DdbAuthenticatedReadTransport` whose binding names the same complete route, member address and ID, endpoint URL and TLS key hash. Its `send` must use that channel without redirects, forwarding or hidden retries to another host.

The SDK also requires the transport's `endpointAuthenticated: true` and `confidentiality: 'post-quantum'` assertions. These assertions are the caller policy's responsibility. Returning them from a callback, repeating a `tlsKeyHash`, or using an ordinary HTTPS certificate does **not** implement or qualify post-quantum confidentiality. The application must verify the real authentication/KEM/handshake before returning the transport. Production transport integration and qualification are **NOT BUILT** by this SDK tranche. There is no default HTTP/HTTPS private transport and no fallback when a policy, verification or binding is absent.

`currentRoute` also does not prove replica readiness. The answering node still authorizes the caller and checks its current assignment and private state before serving rows. Unavailable or uninitialized homes refuse instead of returning misleading empty rows.

## Home and retry behavior

The exported `ddbSignedReadHome(hash, members)` mirrors the node: interpret the first eight signed-hash bytes as an unsigned big-endian integer, then take its remainder modulo the **complete** sorted assignment size. Endpoint availability is considered only after selecting that validator ID. A missing home endpoint refuses; it does not shrink the assignment or choose another live validator. The existing PlacementManager limit of 64 members is retained.

Only error code `-32063` with structured `data.reason === 'stale_route'` and `data.preService === true`, returned by the selected authenticated transport, permits one fresh resolution and another fully verified connection. The same envelope can then be sent once more. A second stale refusal propagates. Connection loss, unknown errors, missing `preService`, and `preService: false` propagate without retry; the caller must decide how to handle an uncertain outcome. Message text alone never enables retry.

The node's replay promise is limited to one stable assignment on its running home. Assignment changes and node restarts do not gain durable or cross-move single-use semantics from these unchanged signatures. No migration/snapshot transfer, readiness/cutover protocol, replay-claim transfer or current-assignment proof is supplied here.

## Capabilities and compatibility

CAP v1 encodes a sealed epoch audience. It cannot be reinterpreted as a placement-version audience, even when the numbers happen to match. A private-configured client refuses `issueCapabilityToken`, `requestCapabilityToken`, `tokenSelect` and `tokenCallReadProcedure` before signing or dispatch, including an explicit `groupVersion`. Public CAP v1 and the low-level token builder retain their existing behavior; they must not be used for private databases. The node independently refuses private CAP v1 data reads.

Without the opt-in, the sealed resolver cache/proof behavior, public read dispatch and public capability bytes remain unchanged. This compatibility path is not a privacy detector or a private transport substitute.
