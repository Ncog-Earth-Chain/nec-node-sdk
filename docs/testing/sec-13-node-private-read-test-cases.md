# SEC-13 / PLACE-02F (NEC-93): Node private-read transport test cases

Built in run 22 on branch `loop13/pq-client-node`, based on SDK `67a1b9dd`.
Scope: actual opted-in Node TLS connection for existing signed reads, authenticated
against caller-supplied trusted assignment/endpoint and certificate key pin.
Not built: independent current-state proofs, browser/mobile channel, PQ certificate
authentication, private-write integration, validator/SQL end-to-end qualification.

Status legend: BASIC = written and green in run 22; DEFERRED = further checks to
write/run; LIVE = requires actual deployment/testbed; OWNER = owner/environment act.
Fixture certificate/key are intentionally public test-only material, generated for
loopback tests. They are not operational credentials. All tests below use an actual
TLS server fixture, not a validator or PostgreSQL service, unless stated otherwise.

## Acceptance clauses

1. Actual hybrid TLS signed-read request and result succeed on the verified socket.
2. Untrusted binding, wrong pin/certificate/hostname or classical group refuses
   before private HTTP request bytes.
3. Redirects, malformed/wrong-ID/oversized responses, unknown failures and repeat
   send refuse without retry; authenticated structured RPC errors retain code/data.
4. Handshake and operation resources are bounded and the socket closes.
5. Node-only export; legacy/browser/RN paths and admission fences are unchanged.

## Test cases

All original BASIC names refer to `tests/ddb-private-read-node.pq.test.ts` unless
specified. This is the required modern-runtime suite; it is explicitly separated
from default Node20/22 discovery and never conditionally skipped. The ordinary
`tests/ddb-private-read-node-legacy.test.ts` exercises fail-closed behavior on the
retained runtimes. `npm run test:pq` and its CI job require the real hybrid suite
and enforce no skipped/todo/missing required witnesses.

| ID | Clause | Kind | Setup | Steps | Expected | Mutant that must turn it RED | Status | Test name / file |
|---|---|---|---|---|---|---|---|---|
| PNT-01 | 1 | integration | Real loopback hybrid TLS server with explicit trusted certificate | Connect, inspect empty request list, send signed-read RPC | Actual X25519MLKEM768 and one exact request/result on one socket | Return unverified or alternate socket | BASIC | real hybrid connection authenticates before sending and uses one socket |
| PNT-02 | 1,2,5 | integration | Actual Ddb.signedSelect, fixture trusted assignment/signer and real hybrid/classical servers | Dispatch through policy.connect with private filter | Hybrid succeeds; classical refuses; ingress never gets private filter | Replace connector with ordinary provider.send | BASIC | actual Ddb private-read callback uses connector and refuses downgrade: %s |
| PNT-03 | 2 | integration | Real classical X25519 server with otherwise valid certificate and pin | Connect | Refuses before HTTP | Remove negotiated-group guard | BASIC | classical negotiated group refuses before request bytes |
| PNT-04 | 2 | integration | Real hybrid server; trusted/published pin differs from certificate SPKI | Connect | Pin refusal before HTTP | Remove actual-pin comparison | BASIC | wrong trusted pin refuses before request bytes |
| PNT-05 | 2 | integration | Self-signed fixture omitted from CA roots; separately wrong DNS name | Connect each | CA refusal; ERR_TLS_CERT_ALTNAME_INVALID; no HTTP | Disable certificate/hostname verification | BASIC | untrusted CA and wrong hostname refuse before request bytes |
| PNT-06 | 2 | unit | Correct fixture route plus mismatched trusted member/address/URL/version | Connect each | Refuses before dial | Skip trusted binding comparison | BASIC | untrusted assignment and endpoint substitutions refuse before dial |
| PNT-07 | 2 | integration | Initially incorrect trusted pin | Begin async connect then mutate caller's pin to correct value | Original snapshot still refuses | Read caller-owned pin after await | BASIC | trusted binding is snapshotted before the asynchronous handshake |
| PNT-08 | 3 | integration | Authenticated server returns 302 | Send | One request then status refusal, no redirect | Follow Location | BASIC | redirect refuses without another request |
| PNT-09 | 3 | integration | Server returns wrong JSON-RPC ID | Send | Refusal, no retry | Remove ID equality | BASIC | invalid response wrong id refuses without retry |
| PNT-10 | 3 | integration | Server returns both result and error | Send | Refusal | Accept first outcome | BASIC | invalid response both outcomes refuses without retry |
| PNT-11 | 3 | integration | Server returns malformed JSON | Send | Parse refusal, no retry | Convert parse failure to empty result | BASIC | invalid response malformed JSON refuses without retry |
| PNT-12 | 3 | integration | Authenticated structured stale-route error | Send read-procedure RPC | Original code/data available to existing routing policy | Lose code/data in generic error | BASIC | authenticated structured refusal retains retry classification fields |
| PNT-13 | 3,4 | integration | Tiny request and response byte limits | Send each | Oversized request sends no HTTP; oversized response refuses after one request | Remove byte guard | BASIC | request and response byte limits refuse with no retry |
| PNT-14 | 3,4 | integration | Verified socket; unsupported method then idle deadline | Attempt each send | Neither sends HTTP, timeout closes socket | Remove method/deadline guard | BASIC | unsupported method and expired channel never send private bytes |
| PNT-15 | 3,4 | integration | Completed successful channel | Send again | Already-consumed refusal | Reset consumed flag | BASIC | real hybrid connection authenticates before sending and uses one socket |
| PNT-16 | 5 | integration | Existing SDK resolver, private routing and signed-read suites plus complete source typecheck | Run all three suites and tsc | 61 legacy cases pass; typed Node export compiles; no changed legacy source | Route private traffic through default provider | BASIC | ddb-private-routing.test.ts; ddb-resolve.test.ts; ddb-signed-read.test.ts; tsc --noEmit |
| PNT-17 | 3 | integration | Truncated/chunked/invalid UTF8/compressed/malformed headers | Send each under exact bound | Refuse safely, close, preserve no-retry semantics | Relax decoder/header/stream checks | DEFERRED | — |
| PNT-18 | 4 | fault | Handshake stall, response stall, close/error at every stage | Advance deadlines and disconnect | Bounded release, no unhandled rejection, no resend | Remove error/close handling | DEFERRED | — |
| PNT-19 | 2 | integration | Expired, not-yet-valid, intermediate/wrong-usage certificates | Connect each | Standard chain validation refuses as appropriate | Bypass standard validation | DEFERRED | — |
| PNT-20 | 2,5 | integration | Older Node/OpenSSL builds and supported release matrix | Import public SDK then attempt private helper | Public functionality preserved; missing hybrid/group capability refuses | Treat unknown group as PQ | DEFERRED | — |
| PNT-21 | 2,4 | integration | IPv6, DNS changes, malformed origin, fragmented network and proxy setup | Connect under bound | Exact intended endpoint identity or explicit refusal | Dial normalized replacement host | DEFERRED | — |
| PNT-22 | 2 | integration | Trusted endpoint key/lease/placement changes between calls | Refresh trusted policy and call again | New call uses current trusted binding; old pin cannot be substituted | Reuse prior unvalidated trust | DEFERRED | — |
| PNT-23 | 1,2,3 | integration | Real validator and private SQL with valid ML-DSA signer | SDK select/procedure and unauthorized/refused variants | Actual node permissions/readiness and rows verified | Skip node signature/storage check | DEFERRED | — |
| PNT-24 | 5 | integration | Packaged Node, browser and RN bundles | Build/import each platform artifact | Node helper works only in Node; no TLS/HTTPS built-ins enter browser/RN graphs | Re-export helper from common/browser entry | DEFERRED | — |
| PNT-25 | 2,3,4 | fuzz | Endpoint/JSON/header/length adversarial corpus and concurrent caller loads | Fuzz and resource profile | No unbounded response accumulation or retry amplification | Remove bounds | DEFERRED | — |
| PNT-26 | 4,5 | perf | Repeated one-shot private reads with realistic RTT | Measure handshake cost and app error telemetry | Record latency/resource costs; no unsupported relational-performance claim | Hide handshake cost | DEFERRED | — |
| PNT-27 | 1,2 | live | Selected-host AWS proxy with actual directory pin and custody | End-to-end signed read and key rotation | Real negotiated group and correct selected-host response | Proxy downgrade or wrong key | LIVE | — |
| PNT-28 | 2,3,4 | live | Network loss, proxy replacement and multiple host assignments | Interrupt/retry explicit operations | No silent fallback or uncertain-outcome resend | Enable generic retries | LIVE | — |
| PNT-29 | 2 | doc | Independently trusted chain-state source and endpoint publisher | Establish trust/custody, correct DER-SPKI pin, lease and proxy boundary | Reviewed actual operator/client setup | Treat resolver JSON as trusted | OWNER | — |
| PNT-30 | 2,5 | doc | Future full-PQ authentication/browser/mobile architecture | Choose supported reviewed profile and qualify clients | No classical-auth path described as fully PQ-authenticated | Rename hybrid confidentiality as full PQ auth | OWNER | — |
| PNT-31 | 2,5 | integration | Retained Node20.20.2/OpenSSL3.0.19 and real classical TLS server | Run complete default suite, including connector refusal | 637 pass, 30 existing declared skips; new refusal sends no HTTP | Replace opt-in connector with ordinary HTTPS | BASIC | retained runtime imports the connector and refuses a classical endpoint without private HTTP / tests/ddb-private-read-node-legacy.test.ts; r1-node20-default-full.log |
| PNT-32 | 5 | integration | Actual default/PQ Jest configuration with local dependency-resolution adapter | List both discoveries and run modern suite | Default excludes only explicit PQ class; modern collects and passes all15 real TLS cases | Remove ignore override or required modern testMatch | BASIC | r1-default-discovery.log; r1-pq-discovery.log; r1-modern-pq.log |
| PNT-33 | 1,2,5 | integration | Required modern report gate | Deliberately skip hybrid success, run Jest and gate, restore and rerun | Jest alone exits0 with one skip; mandatory gate exits1; restored15 pass and gate exits0 | Remove no-skip/required-witness gate from command | BASIC | r1-pq-skip-mutant-jest.log; r1-pq-skip-mutant-gate-red.log; r1-pq-restored.log; r1-pq-restored-gate.log |

## Mutants

Author bypassed only actual negotiated-group check. Real classical-server test
failed: `Received promise resolved instead of rejected` (1 failed, 14 deselected;
the deselected cases are not qualification). Restored full suite: 15/15 PASS,
3.094s, no skips. Source SHA before/after matches `author-evidence.json` in lane.
Independent and integrator mutants belong to their separate reports.

R1 fixed independently demonstrated default-CI incompatibility: the original
unconditional hybrid fixture could not initialize on the retained Node20 runtime.
The required modern suite is now separate, with no conditional skips and an
unconditional pinned CI job. Consumer engines and dependencies are unchanged.
Author checked default Node20 discovery/full suite and its existing skip ledger:
637 PASS / 30 declared SKIP / 667 total, 23.748s. The 30 skips are existing
sibling-IDE14 plus live16 cases, not transport qualification. Modern suite15/15
PASS2.406s; skipping its success witness deliberately left Jest green but made
the required gate RED, then restored15/15 PASS2.484s and gate GREEN. Source
TypeScript passed. These are local checks using inherited production discovery
with an absolute dependency-resolution adapter, not hosted Actions execution.

TDD baseline failed compilation for missing connector module before implementation.
A later behavioral test reproduced mutable caller pin acceptance before its fix.
Initial byte-limit test caught error ordering; rejection now precedes stream
destruction. Initial SDK callback fixture compared object insertion order; it now
compares canonical parsed routes, without weakening production trust checks.

## Live and owner items

No live chain/testbed was run or budget consumed. TLS loopback fixtures are basic
component tests. Official portable Node 26.8.2 / OpenSSL 3.5.8 was used without
installing packages or changing dependency trees. Operational TLS keys, directory
publication and independent chain trust are not provided by the test fixtures.

## Residual risks

Ordinary certificate signatures remain classical. No independent current-state
proof, PQ server authentication, browser/mobile transport, validator/PG read,
private transaction enablement or encrypted proxy-to-node hop is established.
No consensus word, format, parameter, migration or feature readiness changed;
mixed-binary consensus gates therefore do not apply to this local helper. Local
caller transport limits are configurable within hard bounds, not governance words.
No new node metric was registered. No throughput or production-readiness claim.
