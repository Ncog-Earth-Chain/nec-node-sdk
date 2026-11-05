# Node private-read transport

The opt-in `connectDdbNodePrivateRead` helper implements the connection portion of
`DdbPrivateReadPolicy` using Node's real TLS and HTTPS clients. It accepts only the
two existing signed-read RPC methods. It does not enable private transactions,
replace a trusted chain-state verifier, or provide browser/mobile transport.

The application must first authenticate the current assignment and the chosen
validator's current endpoint using independently trusted state. Pass that trusted
binding to this helper separately from the resolver's untrusted candidate. The
helper checks that both name the identical route, member, endpoint and key pin;
it does not turn two matching untrusted responses into proof.

```ts
import { connectDdbNodePrivateRead, type DdbPrivateReadPolicy } from '@ncog/necjs';

// Application-owned trust: validates finalized chain state, active assignment,
// endpoint directory ownership/lease, and current key binding. Not SDK defaults.
declare const trustedState: {
  verifyAssignment: DdbPrivateReadPolicy['verifyAssignment'];
  endpoint(request: Parameters<DdbPrivateReadPolicy['connect']>[0]): Promise<
    Parameters<typeof connectDdbNodePrivateRead>[1]
  >;
};

const policy: DdbPrivateReadPolicy = {
  verifyAssignment: route => trustedState.verifyAssignment(route),
  connect: async request => connectDdbNodePrivateRead(
    request, await trustedState.endpoint(request),
    { timeoutMs: 10000, maxRequestBytes: 1024 * 1024, maxResponseBytes: 4 * 1024 * 1024 },
  ),
};
```

Only HTTPS directory endpoints without credentials, query, fragment or an RPC
path are accepted. Certificate chain and hostname verification remain enabled.
The public-key pin is `0x` plus the lowercase SHA256 digest of the certificate's
DER SubjectPublicKeyInfo, not the hash of the certificate, PEM text or a raw EC
point. This specifies the public-key representation consumed by this connector
under `EndpointDirectory.sol`'s existing SHA256 public-key rule. A differently
encoded published pin must be corrected through the existing directory process;
the helper never accepts multiple interpretations or updates a registry itself.

The helper establishes TLS 1.3, then checks the **actual negotiated**
`X25519MLKEM768` group, AES-256-GCM suite, peer certificate and key pin before
returning a transport. Classical negotiation, unknown group reporting, session
resumption and missing certificate evidence refuse. It uses the same authenticated
socket for one JSON-RPC request and response. It never redirects, retries, forwards,
reconnects or pools sessions. The connector offers a classical group so it can
identify and refuse a classical-only endpoint before private HTTP bytes, rather
than silently accepting a fallback.

One deadline covers handshake, waiting to send, and reading the response. Local
caller options bound the request and response byte counts; defaults are 10 seconds,
1 MiB and 4 MiB, with hard safety bounds of 5 minutes and 64 MiB. These are client
resource limits, not blockchain consensus or governance parameters. Each returned
transport can be used once and closes after completion or error. Call `close()`
if abandoning it early. It supports only uncompressed JSON responses, rejects
redirects/non-200 statuses and checks JSON-RPC version, ID and exactly one outcome.
An authenticated RPC error retains its `code` and `data` for the existing explicit
pre-service stale-route refresh logic. A network failure never triggers a resend.

Node runtime support is checked by the real handshake, not its version string.
The qualification target is official Node 26.8.2: its
[TLS API](https://nodejs.org/download/release/v26.8.2/docs/api/tls.html#tlssocketgetephemeralkeyinfo)
exposes the negotiated TLS Supported Group through `getEphemeralKeyInfo()`.
This is not a claim that 26.8.2 was the first compatible release. Older runtimes
that lack hybrid negotiation or group reporting refuse; public SDK functionality
keeps its existing supported engine range. No Node built-in transport import is
added to browser or React Native entry points.

## Required validation commands

Run both suites before publishing:

- `npm test` / `npm run test:ci` run the retained general SDK suite, including a
  real classical-endpoint refusal test that also runs on Node 20/22. These commands
  explicitly exclude only `*.pq.test.ts` because those fixtures require a hybrid
  TLS runtime.
- `npm run test:pq` uses `jest.pq.config.js` to run the real hybrid suite
  unconditionally. It then checks the JSON report: every collected assertion and
  the named negotiation, SDK callback, downgrade and pin witnesses must pass.
  Skipped/todo/missing required cases fail; an unsupported runtime fails rather
  than reporting a skipped success.

CI retains its existing Node 20/22 jobs and adds a separate unconditional
`pq-transport` job pinned to Node 26.8.2. `prepublishOnly` requires both commands,
so publishing needs a capable development runtime; this does not change the
package's consumer `engines.node` range. The PQ job's runtime evidence includes
the actual Node and OpenSSL versions. These are local test/configuration changes;
a workflow definition is not evidence that hosted CI has executed.

Hybrid key establishment protects confidentiality against recorded-session
decryption, assuming the component algorithms remain secure. Ordinary RSA/ECDSA
TLS certificate authentication is still classical. A certificate pin does not make
that signature algorithm quantum-resistant. Full PQ server authentication, browser
and mobile channels, independent chain proofs and private-write integration remain
unbuilt. The selected endpoint terminates TLS; this helper does not attest or
encrypt a further proxy-to-node hop. Deployment must keep termination within the
intended trusted selected-host boundary. No network-wide E2E or production latency
claim follows from the component tests.
