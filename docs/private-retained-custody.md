# Original-host retained outcome retries

The Node trusted-source client can collect original outcomes after a database
moves to another placement. It keeps the retained historical placement and
explicit `requiredHosts`. Every required original validator must return its own
native durable result; an imported copy on a replacement host cannot satisfy
that obligation. An unavailable original host leaves the collection pending.

`createDdbPrivateReferenceClient` supplies this path through
`createDdbTrustedNodePrivatePolicy`. It authenticates the configured source by
certificate, hostname and SPKI pin, checks the existing `eth_chainId`, then reads
existing `ddb_hostEndpoints` for each stable validator ID. The trusted source
must run the strict endpoint backend with both existing private flags and
explicit local custody budgets. Current publisher auth/endpoint pins may rotate;
historical host addresses are not reused as today's endpoint authority.

`connectDdbNodePrivateCustody` uses a separate binding with chain, stable ID,
current auth/lease, directory, block/time and source/endpoint pins. It never
constructs a placement route. Its one-use TLS socket permits only
`ddb_getPrivateTransactionOutcome`; READPROC and result formats are unchanged.
Actual X25519MLKEM768 negotiation is required. Certificate/hostname/SPKI checks,
deadlines and byte bounds remain mandatory. No redirects, transport retries or
classical-only fallback are supported. Certificate authentication is classical;
hybrid key establishment does not make certificates post-quantum authenticated.

Standalone collectors can supply `custodyPolicy`; without it the existing
current-assignment path remains. Generic trusted policies accept optional
`connectCustodyHost`, which must provide equivalent authenticated transport.
Browser/mobile transport is still application-supplied, and callbacks alone are
not proof of TLS security. New custody types are exported across entry points;
the concrete Node function is exported only from the Node entry point.

Source trust is explicit, not light-client verification. The existing endpoint
response carries block/time and directory, not a block hash or host public key.
Unsafe numeric JSON values refuse. Exact historical placement, payload agreement
and canonical finality checks remain necessary before `committed` is returned.
Node retained-outcome authorization/runtime support is a separate prerequisite;
this adapter alone does not establish distributed-move readiness or latency.
