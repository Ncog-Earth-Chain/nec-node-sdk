# PRIVATE-CLIENT-TRUST-SDK (NEC-97): test cases

Built in run 22 at implementation commit `e6d22c07c2c9aa840e4d36db556fa729bbad501e`.
Scope: explicitly configured authenticated validating-source adapter, source-backed
BASE/assignment/finality checks, bounded exact local retry codec, actual encrypted
file persistence and reference prepare/persist/custody/once-submit/resume flow.
Node contract: reviewed successor `1e769b8945b4d460a5c834eb645440d300531e70`.
No light client, portable proof, production keystore/ACL/backup deployment,
browser/mobile transport, anti-rollback storage, universal crash durability,
consensus/domain/governance/readiness change or live integration is built.

Status legend: BASIC = written and green in run 22 | DEFERRED = to write and run later | LIVE = needs a testbed run | OWNER = needs an owner act or an environment this host lacks.

## Acceptance clauses

These are the root-approved brief/author-dispatch clauses for this bounded SDK
slice of NEC-97, rather than a claim to close the entire ticket.

1. Require an explicitly configured, separately authenticated full validating source and the honest `trusted-validating-node` label; no default authority, discovery authority or outcome-as-finality.
2. Authenticate the fixed source before signing; use the unchanged READPROC domain and exactly the three frozen evidence methods on fresh one-use hybrid TLS channels. Preserve the prior nineteen required real TLS witnesses.
3. Bind the complete current and historical assignment, reviewed runtimes, exact host identities, independent directory publications/pins and lease; do not substitute reachable hosts or collapse the group to required hosts.
4. Treat candidate BASE as untrusted comparison input. Accept independently reconstructed canonical source BASE, original complete placement, exact retained intents and captured maxMembers. Do not claim independent post-root computation.
5. Verify canonical non-skipped exact finality independently of local outcomes. Compare ordered retained operation hashes and payload commitments, original read version/context, all candidate fields and the exact transaction-byte hash.
6. Own authority, observations, intent/record/policy and callback data across asynchronous work; preserve exact original signed bytes, salts and TXN on retry.
7. Encode and rehydrate a closed bounded local retry record with explicit required-host/custody/submit policy and typed hashes. Store no raw signing/digest key and allocate no consensus/signing domain.
8. Implement actual authenticated encrypted file I/O with a separate caller key, explicit filesystem sync choice, exclusive writer lock, temporary file, flush and rename. Failed or unsupported required flush must refuse; do not promise universal power-loss or Windows ACL durability.
9. The reference must actually compose source callbacks, preparation and persistence before mutation; explicit custody; persisted attempt before once-submit; known receipt persistence and bounded unknown reply handling; resume/collect without automatic replay, new salts or resubmission.
10. Final committed success still requires the explicit nonempty required-host set and independent finality. Keep public/generic behavior, resource bounds, Node-only transport limits, usage/example compile and build surfaces honest.
11. Complete BASIC happy/refusal coverage, author source-BASE substitution mutant, tagged remaining-work ledger and frozen clean evidence. Root reserves ordered operation-hash comparison and reviewer uses a distinct persistence/ownership witness.

## Test cases

There are 38 cases: 26 BASIC, 8 DEFERRED, 2 LIVE and 2 OWNER. Final checks passed
128 tests across ten focused suites, source and reference typechecks, 25 actual
modern Node TLS assertions with no skips/todos/failures and the mandatory report
gate, five bundles and declarations. Existing public/private suites account for
113 of the focused tests; fifteen tests are new. The cases below map assertions,
so a grouped test may establish more than one case.

Abbreviations: T = `tests/ddb-private-trust.test.ts`; R =
`tests/ddb-private-retry.test.ts`; P = `tests/ddb-private-read-node.pq.test.ts`.
T/R replace only the socket-opening primitive for wire/semantic fixtures; P uses
the actual loopback TLS connector and factory. Real encrypted fs I/O is used by
the persistence/reference tests. These are not a deployed SDK-to-node testbed.

| ID | Clause | Kind | Setup | Steps | Expected | Mutant that must turn it RED | Status | Test name / file (BASIC only) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PCT-01 | 1,2 | contract | Explicit authority distinct from discovery, valid current evidence | Read assignment and independently rebuild READPROC hash | Exact source ID/selector/args/signature; no resolver recursion; missing trust label rejected | Derive source from resolver or accept absent trust | BASIC | T: `explicit authority signs exact unchanged READPROC after authenticated bootstrap without resolver recursion` |
| PCT-02 | 2 | integration | Real hybrid loopback fixture | Send each exact evidence method once, then second send and unrelated mutation | Each exact signed envelope uses its authenticated socket; reuse/unrelated method refused | Remove exact method or permit source mutation | BASIC | P: `private evidence uses its authenticated one-use hybrid socket: %s` (three assertions) |
| PCT-03 | 1,2 | integration | Actual factory, complete source DTO, real hybrid fixture | Read assignment through the factory | Bootstrap before signer, one signed request, parsed assignment | Return stub policy or sign before connector | BASIC | P: `trusted validating-node factory authenticates bootstrap before signing evidence` |
| PCT-04 | 2 | integration | Wrong source pin or classical-only TLS | Invoke actual factory assignment read | No signing and no private HTTP body | Skip pin/group check or sign early | BASIC | P: `trusted source bootstrap refuses before signing or private bytes: %s` (two assertions) |
| PCT-05 | 2,10 | integration | Existing host connector and nineteen original real TLS cases | Run P and mandatory JSON report gate | Original signed reads/outcome/mutations, CA/hostname/limits/redirect/deadline refusals pass; no skipped witness accepted | Broaden method set, retry redirect or accept skipped report | BASIC | P; `.github/scripts/pq-transport-gate.cjs` |
| PCT-06 | 3 | determinism | Reviewed frozen node EndpointDirectory runtime bytecode vector | Hash independent bytecode and compare SDK constant | Exact reviewed runtime pin | Change pin without matching reviewed bytecode | BASIC | T: `endpoint runtime pin is the hash of the reviewed node bytecode vector` |
| PCT-07 | 3 | unit | Full group [2,7,9], current header and live independent pin | Verify route; connect explicit member; change header/pin/live state | Full route/pin match accepted; substitutions/inactive publication refused | Compare only selected member or trust discovery pin | BASIC | T: `source assignment binds full current route and independently observed endpoint pin` |
| PCT-08 | 3,4 | unit | Source host list misses one original member | Read current assignment | Refuse incomplete evidence | Compare only a reachable subset | BASIC | T: `source missing evidence malformed coverage and captured bound mismatch refuse instead of echoing claims` |
| PCT-09 | 4 | contract | Two canonical prepared members, independent source reconstruction | Prepare; decode signed snapshot arguments | Exact BASE and ordered intents; no effects/results/salts/key arguments; final record returned | Send result payload/key or echo host BASE | BASIC | T: `source BASE independently accepts exact preparation without effects results salts or keys in evidence args` |
| PCT-10 | 4,11 | unit | Source independently returns different owner context with same route | Prepare through source policy | Refuse before final record/mutation | Replace decoded source BASE with preview BASE at first use | BASIC | T: `independent SOURCE BASE context cannot be replaced by preview context in the adapter`; executed author mutant |
| PCT-11 | 4 | unit | Preparation captured maxMembers 4; source says 1 | Prepare through source callback | Refuse changed bound | Ignore captured maxMembers | BASIC | T: PCT-08 test |
| PCT-12 | 3,5 | unit | Original BASE block placement and source historical route | Verify historical placement; change historical header | Exact history true, changed header false | Use current/outcome group instead of original historical block | BASIC | T: `historical assignment and canonical finality compare all ordered retained identities without an outcome source` |
| PCT-13 | 5 | contract | Complete canonical source finality DTO and exact retained pair | Verify finality | True only for expected full identity; no source outcome call | Delegate finality to local outcome | BASIC | T: PCT-12 test |
| PCT-14 | 5,11 | unit | Same two-member finality but reversed operation hashes, then commitments | Verify each altered response | Both false | Omit ordered operation hash or commitment comparison | BASIC | T: PCT-12 test; root reserves operation-hash mutant |
| PCT-15 | 5,10 | unit | All required local hosts durable; source has no canonical inclusion | Collect | `committed:false`, `finality_unverified` | Treat all durability as finality | BASIC | T: `all local durability with no independent canonical source inclusion stays finality_unverified` |
| PCT-16 | 6 | determinism | Construct authority; then mutate caller config/source-returned endpoint | Read current assignment | Original configured authority and owned observation retained | Retain mutable source/options object | BASIC | T: `authority configuration and source observations are owned across caller mutation` |
| PCT-17 | 6,7 | determinism | Complete signed retry unit and explicit host policy | Encode/decode local record | Exact owned typed hashes, signatures, sidecars and policy | Recompute salts/signatures or retain hash buffer alias | BASIC | R: `closed local codec restores exact typed hashes signatures sidecars and explicit policy without keys` |
| PCT-18 | 7,10 | unit | Unknown field, empty/sparse required hosts, oversized bytes | Decode/encode invalid states; compare worst-case formula to cap | Refuse malformed policy/encoding and size; conservative bound below 8 MiB | Map sparse holes or ignore cap/closed keys | BASIC | R: PCT-17 test |
| PCT-19 | 8 | integration | Real temp directory, separate AES KeyObject, explicit file sync | Create/load encrypted record | File hides plaintext; exact original unit recovered | Write plaintext or decode before authentication | BASIC | R: `real encrypted atomic store preserves original unit and monotonic submission checkpoint` |
| PCT-20 | 8,9 | fault | Existing record, prepared then attempted state, known receipt | Duplicate create/begin, replace known receipt | Refuse overwrite, second attempt and changed receipt; original bytes retained | Permit phase reset or replace known hash | BASIC | R: PCT-19 test |
| PCT-21 | 8 | fault | Wrong key, copied filename scope, mutated/truncated ciphertext, invalid path, active lock | Load/begin under each fault | Auth/scope/path/lock refusal; existing lock not stolen; fixed public error | Skip GCM/AAD or steal active lock | BASIC | R: `wrong key ciphertext truncation scope swap and active lock refuse without plaintext disclosure` |
| PCT-22 | 8,9 | fault | Real fs with one rename failure and required directory-open/flush unsupported | Create | No successful persistence acknowledgement; handled temp/lock cleanup | Swallow rename/required flush failure | BASIC | R: `required flush and rename failures never become successful persistence and release handled locks` |
| PCT-23 | 9 | integration | Real encrypted store and reference client, explicit custody list | Prepare then custody; force create/checkpoint failure | Persistence before mutations; failed checkpoint gives zero submit calls | Send before create/beginSubmission resolves | BASIC | T: `reference client persists before custody and submission attempts and resumes without replay or digest retrieval` |
| PCT-24 | 6,9 | fault | Submit loses reply after observing saved attempt | Submit again; create resumed collector | Pending/null; second submit refused; no additional submit or digest load | Retry SQL/resalt or reset attempt after lost reply | BASIC | T: PCT-23 test |
| PCT-25 | 1,9,10 | integration | Full reference flow with actual encrypted record, known receipt, source finality, required hosts [2,7] | Prepare/custody/submit; resume with new client; change configured authority | Stored receipt; committed with exact required set only via independent source; changed authority refuses before connection | Trust saved authority over configured authority or skip source/host requirement | BASIC | T: `persisted reference workflow commits only through the independent source and explicit required hosts` |
| PCT-26 | 10,11 | contract | Existing public/generic suites, Node/shared entrypoints and executable example | Focused regressions; source/example compile; five bundles/declarations; docs/diff review | Existing public/private fences preserved; actual example composes encrypted store; Node factories excluded from browser/RN entrypoints | Export Node transport to shared entrypoint or remove public behavior | BASIC | `ddb-submit`, `ddb-transaction`, `ddb-signer`, `ddb-private-routing`, `ddb-private-txn`, `ddb-private-txn-online`, `ddb-private-txn-outcome`, `ddb-private-read-node-legacy` suites; lane `checks-focused.json`, `checks-build.json`, `checks-reference.json` |
| PCT-27 | 3,4,5 | unit | Table of every scalar/array DTO field, null/zero/width/noncanonical hex cases, duplicate outer JSON keys | Mutate one field at a time; call appropriate callback | Every required semantic mismatch refuses; outer duplicate-key parser behavior documented or separately strengthened | Drop corresponding parser comparison | DEFERRED | - |
| PCT-28 | 3,4,5,6 | determinism | Delayed callbacks while caller mutates BASE, finality candidate, CA buffers, source observations and stored record | Mutate at each await; run serial/parallel and reconstructed instances | Original owned expectation and captured authority retained; no stale cache acceptance | Read caller-owned data after await | DEFERRED | - |
| PCT-29 | 3,10 | fault | Clock moves, publication expires between observation/handshake, current head changes, historical state pruned | Connect/verify at each boundary | Explicit unavailability; never pin/route fallback or false committed | Reuse expired evidence or relax full-route comparison | DEFERRED | - |
| PCT-30 | 7,10 | perf | Four maximally sized members, tag multiplicity limits, 64-host route and longest legal source URL | Encode/decode and load near every boundary under recorded memory/time limits | Proven valid record fits cap; over-cap allocation refused; no unbounded parse expansion | Remove preallocation cap or lower bound below valid representation | DEFERRED | - |
| PCT-31 | 8,9 | fault | Child process stopped at temp write, file sync, rename, directory sync, checkpoint and receipt boundaries | Restart, inspect local files, explicitly recover owned stale locks, collect only | No successful save falsely reported; original signed record recoverable where storage contract permits; no automatic submit | Delete stale lock/prepare new record automatically | DEFERRED | - |
| PCT-32 | 8,9 | determinism | Two processes contend on same TXN; independent TXNs; read during rename | Race create/checkpoint/receipt updates and repeated loads | One attempt wins, no partial/plaintext file, unaffected independent TXNs | Nonexclusive lock or in-place write | DEFERRED | - |
| PCT-33 | 6,7,8 | fuzz | Canonical local codec corpus and valid encrypted files | Mutate nesting, duplicate keys, UTF-8, byte lengths, salts/signatures, file header/AAD; round-trip valid corpus | Closed bounded refusal or exact deterministic round trip; no private error text | Skip canonical reencode/retained validation/authentication | DEFERRED | - |
| PCT-34 | 2,10 | mixed-binary | Current source adapter against older node without evidence methods and current node with private features unavailable | Attempt read/prepare/collect; run ordinary public controls | Source method/feature unavailable refuses; public verdict/wire unchanged; no fallback | Use legacy public/outcome result when evidence method is missing | DEFERRED | - |
| PCT-35 | 1,3,4,5,9,10 | live | Explicitly approved full validating source and complete private host group, real keys and funded caller | Reference prepare/persist/custody/submit/collect, restart after unknown reply | Real SQL effects/result and exact canonical finality plus required durability; no replay | Replace source observation with preview/outcome | LIVE | - |
| PCT-36 | 3,5,9,10 | live | Approved testbed with assignment turnover, one unavailable required host and finality delay | Resume exact saved unit across changes and failures | Pending until independent finality and all required local records match; stale/removed hosts not silently replaced | Use reachable-group quorum or current group as original history | LIVE | - |
| PCT-37 | 1,8,10 | doc | Production source/key custody and supported filesystems | Owner chooses authority/pins, separate storage key, directory ACLs/backups/lock recovery and sync policy | Explicit documented trust and platform behavior; no universal durability/anti-rollback claim | Hide defaults or treat unsupported required flush as success | OWNER | - |
| PCT-38 | 10,11 | doc | Reviewed candidate, independent discriminator and root mutant | Root integrates, runs gate and updates index/readiness/Jira; release owner publishes only if separately approved | Honest scope evidence and unchanged activation defaults | Mark Ready or publish from this lane | OWNER | - |

## Mutants

Author run: in `src/ddb-private-trust-node.ts`, replace the independently decoded
`sourceBase` with preview `base` before canonical equality. PCT-10 failed
semantically with `Received promise resolved instead of rejected`; its different
source owner context was bypassed. Restoring the line passed. The targeted
mutant run intentionally selected one test (other cases reported skipped); the
final 128-test/25-TLS runs had no skips. Exact logs are in the lane RESULT.

The first persisted test-first RED preceded implementation but was compile-only
(missing modules/exports and initial test-authoring errors). It is not counted as
a semantic guard witness. Later fixture/typing corrections preceded the final
green runs; the first RED, mutant and final logs are retained, while intermediate
unit logs were overwritten by later runs. Root's ordered operation-hash mutant (PCT-14) and the
fresh reviewer's distinct persistence/ownership discriminator are separate
checks, not claimed as author executions. Other table mutants are work-list
edits, not executed exhaustive mutation coverage.

## Live and owner items

No live testbed is authorized or run by this lane. Later scripts for PCT-35/36
must use explicitly assigned ports, credentials and cleanup scope and persist
the original record before any mutation. PCT-37 covers production authority,
filesystem/key/backup choices; no owner answer is needed to build this local
slice. Root owns integration, gate, index, Jira and activation/publication.

There is no consensus-visible acceptance change, new flag, default, domain,
setter, migration, metric or alert in this SDK slice. Consequently governance
setter/Timelock tests, flag-off block-validity comparison, schema migration and
metrics rules are not applicable. PCT-34 records meaningful older-node refusal
and public compatibility work. Existing flags stay NotReady. New methods are
client calls to the frozen node contract; node-side RPC walk qualification is
owned by that lane. No CI package list or testing index is edited here.

## Residual risks

The explicit authority can lie; TLS and consistency checks do not turn it into a
light client. The adapter does not decode or independently prove the returned
transaction's consensus validity. A compromised caller process, signer, resolver
implementation, custom store or OS is outside the confidential transport/local
file protection boundary. JavaScript strings/objects may retain private data.
Local AES-GCM does not prevent restoring an older valid encrypted file. Process
crash/power-loss/ACL/backup guarantees vary by filesystem and application policy;
unsupported required flush is an error. A moving head, expired publication or
unavailable evidence can reduce liveness safely. Local wrapper parsing uses the
existing JSON-RPC parser rather than a new duplicate-key protocol. Exhaustive
failure schedules and broad parser/resource matrices are not claimed by
the BASIC tests; see the concrete deferred cases above.
