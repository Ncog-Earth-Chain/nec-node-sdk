# PLACE-02 (NEC-93): exact SDK A4 runtime compatibility test cases

Qualified on Azure against private SDK `d7831fdbb863c1b083703ac1528f9eb2c3f30705` (tree `24240f01c3474547dd122f615e495bac4822f2e1`). This bounded component has 20 BASIC cases. Actual results: 105 focused PASS, 761 ordinary PASS with 16 individually retained LIVE pending cases elsewhere, and 32 actual PQ-TLS PASS. Typecheck, existing skip/PQ/SigV2 gates, five bundles, three declaration files and export/WASM checks passed. Browser and React Native bundles were built; their platforms were not executed.

Author, independent reviewer and root each observed a distinct causal RED and exact restored 105 PASS with zero focused skips. The original initial worker refused during a final read-only Git FD capture; it remains unchanged. Root's separate source/Git/tool/dependency/TMP reconciliation supports the cumulative acceptance, and gives that failed capture no passing credit.

Status legend: BASIC = observed in this bounded SDK scope; DEFERRED = additional implementation or execution required; LIVE = testbed-dependent; OWNER = owner action. This ledger does not qualify full collateral proofs, full-node integration, deployment, publication or feature activation. Exact raw reports and root decisions are recorded in `wt4/a4-sdk-runtime-compatibility/revisions/functional-qualified01/RESULT.json` outside the product tree.

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
| A4SDK-01 | 1 | unit | Read legacy pins and retained proof vectors; compare old constants | Original identities retained | Replace legacy V2 pin with V2-A4 | BASIC | `tests/ddb-a4-runtime.test.ts`: old constants |
| A4SDK-02 | 1 | unit | Hash both new runtime files and check decoded lengths | Exact reviewed registry/V2-A4 hashes and 15213/20252 bytes | Change one byte of a new artifact | BASIC | New pin artifact cases |
| A4SDK-03 | 1,2 | unit | Classify V1, old V2, V2-A4 and both registries | History support for every exact reviewed layout; V2 family excludes V1 | Omit V2-A4 from family helper | BASIC | Placement/registry history cases |
| A4SDK-04 | 1,2 | unit | Present unknown, zero and pre-publisher manager hashes to helper/evidence/member decoder | Every strict consumer refuses | Admit arbitrary V2-family hash | BASIC | Unsupported manager cases; retained unknown placement trie test |
| A4SDK-05 | 2 | unit | Synthetic guarded account root with retained provider storage proofs; alter committed value | Exact storage verifies; altered served record refuses | Skip served/proven comparison | BASIC | Guarded registry synthetic account case |
| A4SDK-06 | 2,5 | unit | Bind guarded registry proof to old root | Cryptographic root mismatch refuses | Use proof.stateRoot as trust source | BASIC | Guarded registry synthetic account case |
| A4SDK-07 | 1,3 | unit | Valid unknown code in account leaf, metadata claims guarded code | Default proof refuses actual unknown leaf code | Trust response account.codeHash | BASIC | Unknown proven registry case |
| A4SDK-08 | 3 | unit | Explicit uppercase unknown hash override against exact unknown account leaf | Proof accepts override; runtime class/guard tuple remain false | Let accepted override enter classifier | BASIC | Arbitrary registry override case |
| A4SDK-09 | 3 | unit | Explicit legacy override against guarded proof, and guarded override against legacy proof | Both refuse despite default layout support | OR default allowlist with explicit override | BASIC | Arbitrary registry override case |
| A4SDK-10 | 3 | unit | Undefined/null override versus explicit empty override | Nullish fallback accepts guarded default; empty string refuses | Treat empty string as absent | BASIC | Arbitrary registry override case |
| A4SDK-11 | 2 | unit | Reconstruct the retained storage proof's groupHash leaf and every affected hashed ancestor; positive original group passes. Change ninth served member to 99 and both served/proven groupHash to its matching hash while the authenticated second packed member word stays 9 | Exact reconstruction accepts; inconsistent ninth packed member refuses specifically with `placement member differs`, after account/storage/group checks | Gate only the packed comparison with `i < 8`; the coherent refusal must wrongly accept (actual author control: causal RED; exact restored GREEN) | BASIC | `V2-A4 coherent proof refuses ninth packed member despite matching served and proven group hash`; original generic tamper remains separate |
| A4SDK-12 | 2,5 | unit | Exchange old-V2 and new-V2 trusted roots/proofs | Both directions refuse | Normalize all V2 identities to new hash | BASIC | V2-A4 synthetic account case; retained old vector suite |
| A4SDK-13 | 2,5 | unit | Decode/re-encode new-runtime BASE and canonical member bytes; parse source route | Exact new runtime retained, canonical bytes roundtrip | Rewrite decoded manager_runtime to old V2 | BASIC | V2-A4 source evidence and BASE/member case |
| A4SDK-14 | 2,5 | unit | Compare otherwise identical old/new source routes and member bytes | Distinct identities stay distinct | Ignore runtime in route identity | BASIC | V2-A4 source evidence and BASE/member case |
| A4SDK-15 | 4 | unit | Guarded registry with V1/new V2 versus old V2; legacy/unknown registry or manager | True only guarded+(V1/new V2); no evidence verdict added | Admit old V2 as A4 guard tuple | BASIC | Runtime guard tuple cases |
| A4SDK-16 | 5 | unit | Uppercase, no-prefix, leading/trailing whitespace hashes | Classifiers refuse; private manager evidence/member decoding refuse | Lowercase/trim in exact classifier | BASIC | Registry/manager non-normalization cases |
| A4SDK-17 | 5 | integration | Azure typecheck and build Node/browser/RN entry points; inspect emitted declarations | Same new constants/helpers exported; existing entries retained | Omit new helper from one entry point | BASIC | Existing SDK build/types; declaration/export review |
| A4SDK-18 | 6 | unit/doc | Mock existing quote calldata for V1 and empty V2; inspect request and return | Exactly one existing RPC call; decimal bytes converted to hex; same response object; no submission | Rewrite empty V2 calldata into V1 call | BASIC | Quote preserves existing calldata cases; JSDoc and compatibility document |
| A4SDK-19 | 1,2 | integration | Execute retained registry/placement/private runtime suites on Azure | Original vectors and refusal behavior preserved | Globally replace old constant identity | BASIC | `ddb-proof`, `ddb-placement-proof`, `ddb-placement-runtime`, related private suites |
| A4SDK-20 | 1-6 | integration | Root schedules focused suite, relevant private regressions, typecheck/build and distinct causal controls | Actual named results and restored source captured honestly | Author omits packed words after member eight; independent admits legacy V2 to A4 guards; root treats empty override as absent | BASIC | Actual Azure raw reports and bounded independent FINALBUGCHECK |

## Observed controls and qualification

- Author omitted only packed-member comparisons for indices 8 and above. The coherent ninth-member case failed with expected refusal versus actual acceptance; all 105 focused assertions passed after exact restoration.
- Independent reviewer broadened the A4 manager guard to admit old V2. Exactly the legacy-V2 false-classification assertion failed; all 105 focused assertions passed after restoration.
- Root changed nullish override fallback to truthiness. The explicit empty override wrongly accepted and its assertion failed; all 105 focused assertions passed after restoration.

The initial source review found that a generic ninth-member tamper also failed the group-hash check. One source correction and confirmation produced the coherent authenticated-group fixture; the actual author control closed that test-strength finding. Independent FINALBUGCHECK covers that bounded source review and its own observed control. Root's third control is separately retained and audited.

Root decisions: initial `ddace22b`, author `6f37f5dd`, independent `2f3be360`, root `179ae849`. Controls retain their filtered assertions as filtered, not LIVE skips. Each actual runtime held the canonical exclusive lock; original source, dependencies and tools were restored/preserved, owned sessions cleaned and TMP removed.

## Remaining execution and owner boundaries

Full-node RPC/coherent integration, actual governance rollout, gas-at-bounds, multi-host load/fault and platform execution remain outside this SDK component. Full same-seal HostBonds/association/consent/readiness verification is not implemented by this patch. The main SDK is unchanged. Package publication, installation, activation and Ready retain their existing separate processes.

## Residual risks

This work adds readable exact runtimes, not client-verified A4 collateral. The fixtures do not construct actual HostBonds multi-account proofs or establish same-seal module/association/free-balance evidence. Runtime guards alone do not prove a quote is bookable, nor that its consent, readiness or future execution will succeed. Synthetic account fixtures are not governance upgrades, deployed code, executed bookings, handoffs or replays. No consensus/default/retention/metrics/resource policy changes are introduced; later full-node seal, execution, rollout, gas-at-bounds and migration qualification remain outside this SDK component.
