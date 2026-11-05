# PLACE-03 (NEC-97): common private client SDK test cases

Built in run 22 at implementation commit `6fc644b4a24aa23360bc89a2ef6f3302cd5b7c80`.
Scope: extract the reviewed explicit-source trust policy and retry controller
into common SDK modules, require concrete caller-selected channels and storage,
and retain the Node factories as compatible TLS-owning wrappers. Native IPC,
wallet approval UI, encrypted-store deployment, registration and live chain
integration belong to the parent lane. This extraction supplies no browser or
mobile transport by itself and changes no consensus rules or wire formats.

Status legend: BASIC = written and green in run 22 | DEFERRED = to write and run later | LIVE = needs a testbed run | OWNER = needs an owner act or an environment this host lacks.

## Acceptance clauses

The assigned brief clauses below apply only to this SDK slice of NEC-97.

1. Common extraction preserves trust: reviewed Node factory still performs exact current/historical/BASE/finality comparisons; common factory requires concrete evidence and selected-host channels.
2. Keep `createDdbTrustedNodePrivatePolicy` and `connectDdbNodePrivateEvidence` public API/behavior unchanged; retain Node option copying, CA/pin/lease checks and all existing witnesses.
3. Extract the existing prepare/persist/custody/attempt/submit/collect controller around the common verified adapter and existing record-store interface; preserve exact retry codec, original explicit host policy and submission-attempt checkpoint.
4. Export required pure common factories/types in browser and Node entrypoints; keep TLS/filesystem/crypto store implementation Node-only. Common exports alone make no browser/mobile transport claim.
5. Own authority, source/channel/callback and preparation inputs across asynchronous boundaries; exact UTF-8 response sizing must use no Node Buffer/import in the extracted common logic.
6. Complete bounded BASIC happy/refusal witnesses, a distinct semantic mutant/restoration, source/example types, all five bundles and declarations using existing dependencies and the shared test lock.

## Test cases

There are 14 cases: 9 BASIC, 3 DEFERRED, 1 LIVE and 1 OWNER.
Final qualification passed 133 focused tests, all 25 actual TLS assertions,
source/examples, five bundles, declarations and the artifact audit. T = `tests/ddb-private-common.test.ts`;
N = `tests/ddb-private-trust.test.ts`; P = `tests/ddb-private-read-node.pq.test.ts`.
T uses explicit synthetic chain/channel and in-memory encoded-store fixtures;
it supplies no evidence of TLS authentication or durable I/O. N retains real
encrypted I/O; P uses actual loopback hybrid TLS. No deployed-node run is claimed.

| ID | Clause | Kind | Setup | Steps | Expected | Mutant that must turn it RED | Status | Test name / file (BASIC only) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ECS-01 | 1,5 | unit | Explicit full authority and separate fixture connectors | Read current assignment, replace original options source and connector | Original source receives exact signed READPROC; replacing options has no effect; absent connectors refuse | Read mutable options after await or supply fallback connector | BASIC | T: common policy requires concrete connectors and captures exact source and callback ownership |
| ECS-02 | 1,5 | unit | Source channel returns wrong pin | Read assignment | Close before signing/send; no callback assertion accepted as proof | Remove source-channel binding comparison | BASIC | T: common source channel mismatch refuses before signing or sending and closes the channel |
| ECS-03 | 1,5 | unit | Complete route and independent host publication | Connect host, substitute returned pin and current header | Connector gets complete connection plus independent trusted binding; mismatch closes/refuses before send | Omit trusted binding argument or returned-binding check | BASIC | T: common host connector receives independently trusted full binding and rejects a substituted channel |
| ECS-04 | 1,2 | contract | Reviewed complete source DTO fixtures | Run current/historical/source BASE/member-bound and ordered-finality tests through Node wrapper | Exact matches succeed; missing evidence/context/order changes refuse | Compare only selected fields or unordered hashes | BASIC | N: existing full source semantic suite |
| ECS-05 | 2 | integration | Real Node 26 hybrid TLS fixture | Run all 25 mandatory transport assertions and report gate | Actual group/certificate/hostname/SPKI/fresh socket behavior preserved; downgrade/wrong pin/CA/hostname/unknown group produce no private bytes | Bypass any actual TLS gate | BASIC | P and `.github/scripts/pq-transport-gate.cjs` |
| ECS-06 | 3,5 | contract | Explicit encoded-store fixture and selected recipients | Prepare, custody, checkpoint, lose submit reply, recreate client and collect | Digest cleared; attempted persisted before send; one submit; resume does not reload digest or reprepare | Send before checkpoint or permit already attempted record | BASIC | T: common client uses exact retry codec and persists attempt before submit then resumes collection without reprepare |
| ECS-07 | 3,5 | contract | Store refusal and differing configured authority | Reject checkpoint/create; load record through changed source | No mutation after storage failure; exact authority and original required hosts retained | Skip checked authority or ignore persistence rejection | BASIC | T: common client storage and authority refusal prevents custody or submit and preserves explicit host policy |
| ECS-08 | 2,3 | integration | Existing actual encrypted Node store fixture | Existing known/unknown receipt, durability/finality, retry and filesystem suites | Reviewed reference behavior and exact codec unchanged | Replace original policy or drop attempt marker | BASIC | N and `tests/ddb-private-retry.test.ts` |
| ECS-09 | 4,6 | contract | Exact source plus existing external dependency harness | Compile source/examples/declarations and all five bundles; inspect browser/RN imports | New factories/types exported; no Node-only transport/store imports in browser/RN graph or declaration surface | Export Node wrapper from common entrypoint | BASIC | External locked harness and bundle audit |
| ECS-10 | 5 | unit | Multibyte and surrogate strings near response resource bound | Compare UTF-8 count to independent encoded bytes across boundary values | Exact bytes; no character-count shortcut; oversized response refused | Replace encoded byte count by string length | DEFERRED | — |
| ECS-11 | 1,3,5 | fault | Delayed connectors/signer/store, mutable input objects | Mutate every owned route/endpoint/source/callback/intent/policy at each await boundary | Captured approved scope remains exact or operation refuses | Retain mutable object reference | DEFERRED | — |
| ECS-12 | 3 | fault | Separate actual helper/store processes | Kill at create/checkpoint/receipt persistence boundaries and resume | Attempted records never replay; unavailable records require recovery | Treat corrupt/locked record as absent | DEFERRED | — |
| ECS-13 | 1,2 | live | Installed helper and assigned authorized source/hosts | Signed read and transaction; advance head, rotate source endpoint and collect history | Exact independent source and original required-host policy retained | Trust generic status/receipt or use replacement host | LIVE | — |
| ECS-14 | 4 | doc | Installed browser/device runtime and approved host registration | Verify real bundle resolution, native permission, origin/ACL and local keystore | Explicit unsupported when missing; no claim of mobile integration | Fall back to generic provider | OWNER | — |

## Mutants

The author removed only the common source-channel binding comparison and ran
ECS-02. The wrong-pin fixture channel proceeded to signing and resolved, producing
`Received promise resolved instead of rejected` (1 failed, 4 deliberately
unselected). Exact restoration produced GREEN (1 passed, 4 unselected).
The final full focused and actual TLS runs have no skips.
Prior reviewed source-BASE, ordered-finality and store-checkpoint mutants remain
historical evidence and are not re-claimed as this extraction's new mutant.

## Live and owner items

ECS-13 requires a separately authorized deployed-node environment. ECS-14 needs
installed browser/native-host origin enforcement, platform signing/ACL/keystore
and device work. Parent lane owns native framing, subprocess/TLS/store composition
and wallet lifecycle tests. Root owns integration, full gate, indexes and Jira.

## Residual risks

Factories trust the explicitly supplied concrete channel/store implementation;
matching callback fields are consistency checks, not portable TLS attestation.
This preserves trusted full-node evidence rather than adding light-client proof
verification. File-sync and anti-rollback guarantees remain as documented in the
reviewed Node store. No consensus-visible acceptance, governance setter, metric,
RPC server surface, migration or readiness flag changes: old-binary gate parity,
governance bounds and chain rebuild determinism are unchanged and out of scope.
