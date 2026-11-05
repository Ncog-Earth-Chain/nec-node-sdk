# PLACE-03 (NEC-97): private transaction SDK test cases

Run 22 candidate on SDK base `2cbf4342`; bounded implementation and BASIC checks complete. Independent review/integration remain separate requirements.
Scope: canonical typed member codec and offline locally bound signing preparation.
No server API or private multi-member admission is opened. This SDK catalog is mirrored outside the checkout for root to integrate
at node `docs/testing/private-txn-sdk-test-cases.md`. This lane edits no main node files.

Status: BASIC = written and actually passed; DEFERRED = not yet validated (test
implementation is identified below where already written); LIVE = later approved
testbed/device qualification; OWNER = publication or other owner action.
Current counts: **30 cases: 23 BASIC / 4 DEFERRED / 2 LIVE / 1 OWNER**.
Tests have been written before implementation; the initial baseline failed to
compile because the new codec module did not exist. No behavioral baseline or
passing test is inferred from that setup failure. Root subsequently executed the prepared author runner: 25 focused tests, source tsc and 73 legacy tests passed; the intended guard mutant failed and all 25 restored focused tests passed.

## Acceptance clauses

1. Encode/decode the closed V1 schema exactly across Go and TS, preserving uint64,
   intent bytes, Unicode, duplicates and SQL NULL distinctions.
2. Enforce existing byte/hard-member limits and the caller's captured member bound;
   reject malformed identities, context, business effects and result shape.
3. Never sign a host substitution for the locally retained intent or snapshot;
   validate ordered members, current procedure-only scope, whole-database read
   dependency and exact existing outer scalar representations.
4. Reuse the existing salted payload commitment, keyed tags and op-v2/TXN signing
   domains without cycles or changes to existing APIs or admission.
5. Export the same portable API in all SDK entries; preserve old vectors and
   provide complete deferred test/activation/publication boundaries.

## Test cases

All current focused fixtures are in `tests/ddb-private-txn.test.ts`. DEFERRED here
does not claim missing fixture implementation when its name is given in Setup.

| ID | Clause | Kind | Setup | Steps | Expected | Mutant that must turn it RED | Status | Test name / file (BASIC only) |
|---|---|---|---|---|---|---|---|---|---|
| PTS-01 | 1 | unit | Written round-trip fixture | Encode/decode >2^53 block/maxU64 nonce and raw numeric intent | All bits and intent bytes retained | Convert U64 through Number | BASIC | preserves exact integers, intent bytes, Unicode and SQL NULL |
| PTS-02 | 1 | unit | Written round-trip Unicode fixture | Encode controls/quote/backslash/astral/U+2028/29 | Exact explicit escaping, no HTML escaping | JSON.stringify fallback | BASIC | preserves exact integers, intent bytes, Unicode and SQL NULL |
| PTS-03 | 1 | determinism | Fixed Go 2993-byte fixture | Decode/reencode in TS and compare bytes | Exact equality, including complete context and duplicate rows | Rename/reorder one field | BASIC | matches the complete Go interoperability fixture byte for byte |
| PTS-04 | 1 | unit | Written round-trip result fixture | Round-trip NULL, empty bytea and opaque bytes | Distinct values, no accidental UTF8 decoding | Merge NULL/empty | BASIC | preserves exact integers, intent bytes, Unicode and SQL NULL |
| PTS-05 | 1 | unit | Written noncanonical matrix | Duplicate/unknown/null-array/order/whitespace/trailing fields | Refuse alternative grammar | Remove canonical byte comparison | BASIC | rejects duplicate/unknown/whitespace/trailing/key order/null array |
| PTS-06 | 1 | unit | Written scalar matrix | Numeric U64, leading zero, overflow and padding bits | Refuse instead of rounding/normalizing | Parse numeric JSON U64 | BASIC | rejects numeric U64/leading zero/overflow/bad base64 |
| PTS-07 | 1 | unit | Written Unicode refusal matrix | Invalid UTF8, BOM, surrogate and escape aliases | Refuse before signing | Nonfatal TextDecoder | BASIC | rejects surrogate/alternate escape; rejects invalid UTF8, BOM and input/output/active member bounds |
| PTS-08 | 2 | unit | Written bounds fixture | Input/output over128KiB; max1/2/4/5 and noninteger | Bounded refusal; explicit active limit honored | Use hard4 instead of passed max | BASIC | rejects invalid UTF8, BOM and input/output/active member bounds |
| PTS-09 | 2 | unit | Written context fixture | Change runtime/tombstone value or role ordering | Refuse invalid captured context | Remove runtime/role guard | BASIC | refuses caller-created nonwire fields, malformed scalars and context |
| PTS-10 | 2 | unit | Written effect/result fixture | Malformed row, NULL bytes, wrong row width, unqualified type | Refuse malformed material | Skip business/result validation | BASIC | refuses malformed business effects and result shape |
| PTS-11 | 1,2 | unit | Written caller-object fixture | Supply extra intent field or numeric native scalar | Refuse unrepresented fields/coercion | Discard unknown fields | BASIC | refuses caller-created nonwire fields, malformed scalars and context |
| PTS-12 | 3 | unit | Written local-intent refusal fixture | Host replaces original exact data bytes | Refuse before returning hashes | Bypass local intent equality | BASIC | refuses host replacement of locally retained intent bytes |
| PTS-13 | 3 | unit | Written substitution fixture | Mutate base block/caller/context or signed gas/nonce | Refuse locally pinned mismatch | Compare only database | BASIC | refuses common base, scalar, order and count substitutions |
| PTS-14 | 3 | unit | Written substitution/count fixtures | Use wrong member index, change count, omit intent/opening | Refuse incomplete/different unit | Ignore index/count | BASIC | refuses common base, scalar, order and count substitutions; refuses incomplete payload/intent/opening sets and missing signing key |
| PTS-15 | 3 | unit | Written read-shape fixture | Missing/narrow/extra reads or wrong version | Exactly one wholeDB read at captured block | Permit empty read list | BASIC | refuses absent/narrow/extra reads, wrong version and unsafe legacy read JSON |
| PTS-16 | 3 | unit | Written unsafe-read fixture | Read version >2^53-1 in existing numeric outer header | Explicit representation refusal | Number(readVersion) without bound | BASIC | refuses absent/narrow/extra reads, wrong version and unsafe legacy read JSON |
| PTS-17 | 3 | unit | Written gas/maxnonce fixture | Build with fullU64 gas/nonce | Exact fullU64 gas hex; maxnonce preserved in existing-hash fixture | Round through Number | BASIC | preserves all gas uint64 bits in the signed envelope; binds ordered openings through existing operation/TXN signing primitives |
| PTS-18 | 3 | unit | Written procedure-only fixture | Valid represented raw insert vs procedure | Builder refuses unauthorized raw-operation scope | Permit type4 in builder | BASIC | refuses wrong digest key and direct raw-data operation admission |
| PTS-19 | 3,4 | unit | Written key/opening fixture | Wrong digest fingerprint, 31-byte salt or empty caller public key | Refuse mismatched custody | Omit digest fingerprint equality | BASIC | refuses wrong digest key and direct raw-data operation admission; refuses incomplete payload/intent/opening sets and missing signing key |
| PTS-20 | 4 | crypto/vector | Written builder primitive fixture | Build two op15 headers; recompute existing TXN ID/member hashes from outer bytes; inspect sidecar payload | Exact TXN primitive agreement and retained sidecar bytes; read only on member0 | Hash independent single operations | BASIC | binds ordered openings through existing operation/TXN signing primitives |
| PTS-21 | 4 | crypto/vector | Fixed duplicated row and independent PythonHMAC constant | Build keyed tag sidecar twice | Two equal tags preserved; existing domain | Deduplicate row effects | BASIC | binds duplicate business effects to existing keyed tags |
| PTS-22 | 5 | regression | Prepared current commitment/transaction/preimage suites | Run unchanged old commitment/transaction/preimage vectors on candidate SDK | No old behavior/format change | Alter legacy domain | BASIC | ddb-commitment.test.ts; ddb-transaction.test.ts; ddb-preimage-v2.test.ts (73 tests) |
| PTS-23 | 5 | build | Prepared full source tsc harness | Check all three public entry modules | All three entry exports compile; no browser/RN runtime qualification inferred | Introduce an entrypoint export/type error | BASIC | full src tsc --noEmit; root-author-final1-tsc.log |
| PTS-24 | 2 | unit / fuzz | Further context/effect matrix not yet complete | Missing fields; zero/wronglength digest keys; zeroowner; all ordering/cancellation/row-marker/scalar/exactbound variants not covered above | Same refusal/acceptance as Go | Skip one exact guard | DEFERRED | |
| PTS-25 | 3,4 | integration / RPC | Future private preparation/submit API, currently absent | Capture authorized snapshot, prepare/sign/submit valid and stale unit | Semantic execution and coherent admission, no partial opening | Treat codec output as verified plan | DEFERRED | |
| PTS-26 | 3,4 | restart / fault | Future persisted intent/outcome protocol | Restart/retry without replacing local intent/base | No duplicate committed effect or stale rebase | Restore from host-only intent | DEFERRED | |
| PTS-27 | 2,5 | governance / compatibility | Future captured-rule/config integration | Active max reduced and old flag-off binaries | No current-mirror reinterpretation or acceptance change | Open private API unconditionally | DEFERRED | |
| PTS-28 | 1,5 | live / platform | Approved Node/browser/RN devices | Run same vectors and real authenticated transport | Samebytes and identity checks; real PQ transport separately established | Assume JS codec provides PQ channel | LIVE | |
| PTS-29 | 2,4 | live / perf | Later approved network/load/fault environment | Large payloads, malicious executor, host loss and delayed outcomes | Bounded work, verified effects and accurate durability; no throughput claim from codec | Trust self-reported effect or receipt | LIVE | |
| PTS-30 | all | owner / release | Root review/gate, complete protocol and release tuple | Existing publication and activation process | No SDK release, Ready or ticket Done inference | Publish partial grammar as working ACID API | OWNER | |

## Mutants

Root executed the prepared author mutation, bypassing only the exact locally
retained intent comparison. The selected host-replacement test failed with
`Received function did not throw`, Exit 1, 2.708s. The other 24 tests were
deselected by the test-name filter, not attempted or counted as passing in that
stage. Restoring exact production bytes passed all 25 focused tests in 3.551s,
without skips.

The same locked runner first passed 25 focused tests in 3.657s, full configured
source tsc Exit 0, and 73 existing commitment/transaction/preimage tests in 5.104s.
No source changes followed those runs. Logs and evidence are in
`wt4/private-txn-sdk/root-author-final1-{focused,tsc,legacy,mutant-red,restored}.log`
and `root-author-final1-evidence.json`. Source SHA256 before/after is
`8c516b83783678063f55ea9a62ebc0672289154c9778a4e3a66ea2490b470218`.
The shared 2993-byte fixture SHA256 is
`4ebb38e1ba625423fa74d790977dc835f2e40f01e3be2c8f54422cdc8db9d662`.

This is the author's prepared mutation executed by root, not an independent
review. Go-side and root/reviewer mutants are separately recorded.


## Residual risks and later work

This is a format/binding layer. It does not prove runtime catalog conformance,
authenticated snapshot acquisition, actual relational effects, Byzantine executor
verification, encrypted transport, replica quorum durability, restart outcomes or
legally admitted private transactions. Existing server NotReady/admission fences
stay closed. No RPC/metric, SQL/checkpoint migration, new governance setter or wire
domain is added here. Existing authoritative policy still applies at the host and
chain. The existing outer numeric read-version limitation is refused explicitly.
