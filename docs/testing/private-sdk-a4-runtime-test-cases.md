# PLACE-02 (NEC-93): exact SDK A4 runtime compatibility test cases

Prepared against SDK `69672f68216032ba7ce6130986b70a2563c282e9` in private branch `loop13/a4-sdk-runtime-compatibility`. Source scope: reviewed guarded registry and V2-A4 history/proof support, shared private evidence/BASE support, necessary-only runtime guard classification, and existing quote passthrough documentation. Every case below is DEFERRED: test source is present where named, but no SDK test, typecheck, build or mutant was run. The separate contract component's accepted BASIC evidence does not qualify these SDK changes.

Status legend: BASIC = written and actually green in this lane; DEFERRED = still requires execution or implementation; LIVE = needs a testbed; OWNER = needs an owner action. This ledger has no BASIC, LIVE or OWNER verdicts. Runtime checks belong on Azure under root's canonical exclusive lock. A tests-source-first patch is a source snapshot, not an observed TDD RED.

## Acceptance clauses

1. Keep exact legacy runtime constants, blobs and proof vectors; add only the reviewed guarded registry and V2-A4 artifacts. Unknown and pre-publisher runtimes remain unsupported by strict defaults.
2. Extend history/proof layout support without claiming collateral, consenting set, current authority, readiness or future inclusion. New hashes preserve complete observed identity in private evidence and BASE/member bytes.
3. Preserve arbitrary explicit registry overrides, including case-insensitive exclusive matching and nullish fallback. An override must never establish A4 runtime classification or suitability.
4. Distinguish history support from the necessary A4 guard tuple: guarded registry plus V1 or V2-A4 only. Actual suitability additionally needs complete same-seal canonical collateral and association evidence, which this SDK does not verify.
5. Keep exact classification with no normalization or replacement of old hashes. Export the same additions in Node, browser and React Native entry points.
6. Preserve quote wire shape and document that V1 placeArgs are executable while V2 calldata is empty hex `0x` and requires the existing consent/handoff workflow. Add no transaction submission, RPC field, flag, role, domain, consensus word or policy/default.

## Test cases

| ID | Clause | Kind | Setup and steps | Expected | Mutant that must turn it RED | Status | Test source / later check |
|---|---|---|---|---|---|---|---|
| A4SDK-01 | 1 | unit | Read legacy pins and retained proof vectors; compare old constants | Original identities retained | Replace legacy V2 pin with V2-A4 | DEFERRED | `tests/ddb-a4-runtime.test.ts`: old constants |
| A4SDK-02 | 1 | unit | Hash both new runtime files and check decoded lengths | Exact reviewed registry/V2-A4 hashes and 15213/20252 bytes | Change one byte of a new artifact | DEFERRED | New pin artifact cases |
| A4SDK-03 | 1,2 | unit | Classify V1, old V2, V2-A4 and both registries | History support for every exact reviewed layout; V2 family excludes V1 | Omit V2-A4 from family helper | DEFERRED | Placement/registry history cases |
| A4SDK-04 | 1,2 | unit | Present unknown, zero and pre-publisher manager hashes to helper/evidence/member decoder | Every strict consumer refuses | Admit arbitrary V2-family hash | DEFERRED | Unsupported manager cases; retained unknown placement trie test |
| A4SDK-05 | 2 | unit | Synthetic guarded account root with retained provider storage proofs; alter committed value | Exact storage verifies; altered served record refuses | Skip served/proven comparison | DEFERRED | Guarded registry synthetic account case |
| A4SDK-06 | 2,5 | unit | Bind guarded registry proof to old root | Cryptographic root mismatch refuses | Use proof.stateRoot as trust source | DEFERRED | Guarded registry synthetic account case |
| A4SDK-07 | 1,3 | unit | Valid unknown code in account leaf, metadata claims guarded code | Default proof refuses actual unknown leaf code | Trust response account.codeHash | DEFERRED | Unknown proven registry case |
| A4SDK-08 | 3 | unit | Explicit uppercase unknown hash override against exact unknown account leaf | Proof accepts override; runtime class/guard tuple remain false | Let accepted override enter classifier | DEFERRED | Arbitrary registry override case |
| A4SDK-09 | 3 | unit | Explicit legacy override against guarded proof, and guarded override against legacy proof | Both refuse despite default layout support | OR default allowlist with explicit override | DEFERRED | Arbitrary registry override case |
| A4SDK-10 | 3 | unit | Undefined/null override versus explicit empty override | Nullish fallback accepts guarded default; empty string refuses | Treat empty string as absent | DEFERRED | Arbitrary registry override case |
| A4SDK-11 | 2 | unit | Synthetic V2-A4 account leaf around retained nine-member storage trie; change ninth member | Exact proof accepts; changed packed member refuses | Drop second packed word comparison | DEFERRED | V2-A4 synthetic account case |
| A4SDK-12 | 2,5 | unit | Exchange old-V2 and new-V2 trusted roots/proofs | Both directions refuse | Normalize all V2 identities to new hash | DEFERRED | V2-A4 synthetic account case; retained old vector suite |
| A4SDK-13 | 2,5 | unit | Decode/re-encode new-runtime BASE and canonical member bytes; parse source route | Exact new runtime retained, canonical bytes roundtrip | Rewrite decoded manager_runtime to old V2 | DEFERRED | V2-A4 source evidence and BASE/member case |
| A4SDK-14 | 2,5 | unit | Compare otherwise identical old/new source routes and member bytes | Distinct identities stay distinct | Ignore runtime in route identity | DEFERRED | V2-A4 source evidence and BASE/member case |
| A4SDK-15 | 4 | unit | Guarded registry with V1/new V2 versus old V2; legacy/unknown registry or manager | True only guarded+(V1/new V2); no evidence verdict added | Admit old V2 as A4 guard tuple | DEFERRED | Runtime guard tuple cases |
| A4SDK-16 | 5 | unit | Uppercase, no-prefix, leading/trailing whitespace hashes | Classifiers refuse; private manager evidence/member decoding refuse | Lowercase/trim in exact classifier | DEFERRED | Registry/manager non-normalization cases |
| A4SDK-17 | 5 | integration | Azure typecheck and build Node/browser/RN entry points; inspect emitted declarations | Same new constants/helpers exported; existing entries retained | Omit new helper from one entry point | DEFERRED | Existing SDK build/types; declaration/export review |
| A4SDK-18 | 6 | unit/doc | Mock existing quote calldata for V1 and empty V2; inspect request and return | Exactly one existing RPC call; decimal bytes converted to hex; same response object; no submission | Rewrite empty V2 calldata into V1 call | DEFERRED | Quote preserves existing calldata cases; JSDoc and compatibility document |
| A4SDK-19 | 1,2 | integration | Execute retained registry/placement/private runtime suites on Azure | Original vectors and refusal behavior preserved | Globally replace old constant identity | DEFERRED | `ddb-proof`, `ddb-placement-proof`, `ddb-placement-runtime`, related private suites |
| A4SDK-20 | 1-6 | integration | Root schedules focused suite, relevant private regressions, typecheck/build and distinct causal controls | Actual named results and restored source captured honestly | Author removes guarded registry default support; independent/root choose distinct behavior guards | DEFERRED | Future Azure execution and fresh independent review |

## Mutants

No mutant was run. Suggested author control: remove guarded registry default support while leaving the explicit override path intact; the guarded synthetic proof case must fail. An independent reviewer and root must choose their own distinct causal edits and observe named RED/restored PASS under the canonical lock. Original failures, selected test membership, skips, restoration and exact input identities must be retained.

## Remaining execution and owner boundaries

SDK runtime checks, typecheck, bundle/declaration build, causally observed mutants and fresh independent correctness review remain deferred. No local Node/npm/Go/gofmt/SSH or remote action is authorized for this source lane. Root alone schedules later Azure runtime and integration. Publishing SDK packages, enabling flags, installation, activation, governance migration and Ready require their existing separate processes; none follows from this source patch.

## Residual risks

This work adds readable exact runtimes, not client-verified A4 collateral. The fixtures do not construct actual HostBonds multi-account proofs or establish same-seal module/association/free-balance evidence. Runtime guards alone do not prove a quote is bookable, nor that its consent, readiness or future execution will succeed. Synthetic account fixtures are not governance upgrades, deployed code, executed bookings, handoffs or replays. No consensus/default/retention/metrics/resource policy changes are introduced; later full-node seal, execution, rollout, gas-at-bounds and migration qualification remain outside this SDK component.
