# PLACE-03: SDK exact V2 runtime compatibility

Author lane: private-sdk-v2-runtime; SDK base 94d0f5c2, node source/fixture base fd5ad9cf. Qualification passed: 9 new tests, 89 focused regressions, node fixture export/recheck, source typecheck, all five bundles and declarations. Exact commands and semantic RED/restored GREEN evidence are retained in the lane RESULT.md.

Acceptance clauses: (1) accept V1 and only the reviewed first-publisher V2 runtime in the three existing acceptance paths; (2) preserve exact BASE/route/runtime bindings, formats, existing V1 vectors and proof/flag policy; (3) derive the pin from real bytes, compare actual layouts and verify actual trie proofs; (4) keep compatibility separate from handoff readiness/custody.

Status legend: BASIC = executed with retained evidence; DEFERRED = later implementation/qualification; LIVE = external deployment; OWNER = root integration or rollout decision.

| ID | Clause | Case | Discriminator | Status | Test/evidence |
|---|---|---|---|---|---|
| VR01 | 1,2 | Existing V1 member/BASE/evidence/proof still accepts | Replace V1 pin with V2 only | BASIC | ddb-placement-runtime.test.ts: V1 remains accepted |
| VR02 | 1 | Actual reviewed V2 hash accepted by source evidence parser | Keep evidenceRoute V1-only | BASIC | reviewed V2 runtime is accepted in independent source evidence route |
| VR03 | 1,2 | V2 canonical member and BASE roundtrip unchanged | Keep validateMember V1-only | BASIC | reviewed V2 BASE and retained canonical member roundtrip |
| VR04 | 1,3 | Actual V2 account and all nine packed members verify | Keep placement proof codeHash V1-only or ignore ninth member | BASIC | reviewed V2 account and all nine placement members verify |
| VR05 | 1 | Unknown/pre-publisher/zero runtime refuse evidence and member/BASE | Broaden runtime allowlist to all nonzero hashes | BASIC | three refusal cases in ddb-placement-runtime.test.ts |
| VR06 | 1,3 | Valid unknown-runtime trie proof refuses | Trust valid MPT without exact code hash | BASIC | cryptographically valid unknown-runtime trie proof still refuses |
| VR07 | 2,3 | V1/V2 proof cannot be rebound to another root | Stop comparing trusted root | BASIC | V1 and V2 account proofs cannot be rebound |
| VR08 | 3 | Exact compiler reproduces embedded bytes; prior storage equals | Shift Placement offset/type or change compiler | BASIC | derive-runtime.cjs/runtime-layout-report.json; node TestSDKPlacementRuntimeProofVector |
| VR09 | 2 | Existing proof/private-txn/trust/online/outcome/retry suites and declarations/bundles | Relax retained BASE/route equality | BASIC | focused-regressions/source-typecheck/external-bundles/external-declarations logs |
| VR10 | 1,3 | Semantic tests-first RED plus broad-allowlist mutant RED/restored GREEN | Accept every nonzero runtime | BASIC | tests-first-red/allowlist-mutant-red/allowlist-restored-green logs |
| VR11 | 4 | Current proof mode, flags, custody and authority remain unchanged | Treat accepted V2 hash as permission/activation | DEFERRED | Full handoff/custody composition belongs to separate slices |
| VR12 | 4 | Real approved manager deployment/rollover with endpoint clients | Accept old transition/artifact implicitly | LIVE | No deployment authorized by this lane |
| VR13 | 4 | Fresh independent review and root integration | Treat author checks as rollout approval | OWNER | Root owns review, inventory and integration |

No new production server API or consensus dependency is introduced. Fixtures prove storage/code-hash compatibility; they are not portable current authority evidence. Unknown code and the earlier V2 runtime must continue to fail closed.
