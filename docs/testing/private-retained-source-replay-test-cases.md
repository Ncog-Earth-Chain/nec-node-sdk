# PLACE-03 (NEC-97): native retained-source SDK replay test cases

Built in run22 on SDK base a14a8baaa23d505bd7700a40fc8205063261e16c; the
fixture-only correction and its frozen commit are recorded in the external
qualification packet. Scope: fix the parked consumer's incompatible direct
creation of an attempted retry state, then execute its three existing cases
against an actual successful native export. Production SDK code is unchanged.
The .test.ts execution copy and vector remain isolated untracked qualification
inputs; the tracked consumer stays .deferred.ts outside default Jest discovery.
The store requests sync='file'. Reopen creates a second store object in the same
process; process restart, directory-sync and power-loss guarantees are unqualified.

BASIC = executed and green in this slice; DEFERRED = later implementation or
execution; LIVE = actual network environment; OWNER = remaining owner/reviewer act.
Counts:10 cases =3 BASIC /5 DEFERRED /1 LIVE /1 OWNER. No historical node ledger
or unexecuted integration is promoted by this replay.

## Acceptance clauses

1. Use real encrypted prepared/null create -> beginSubmission -> recordSubmission
   with the unchanged native commit -> reopen, asserting the complete persisted
   retry state. Preserve exact native bytes, original source and required hosts.
   Native SQL/evidence/publication are actual; finalized inclusion/current-source
   callbacks, SDK transport and dynamic READPROC signatures are explicit synthetic
   seams, not a live retained-Store/TLS composition proof.
2. After full group replacement [1] -> [2], collect through unchanged persisted
   source1 and retain original native outcome obligation1; do not rediscover a
   replacement source, prepare again or load a digest key during collection.
3. An unavailable original host stays pending; configured/persisted source
   mismatch refuses before network activity and cannot silently substitute host2.
4. Preserve genuine artifact provenance, the three selected tests/zero skips,
   semantic guard sensitivity, exact restoration and bounded qualification scope.

## Test cases

| ID | Clause | Kind | Setup | Steps | Expected | Mutant that must turn it RED | Status | Test name / file (BASIC only) |
|---|---|---|---|---|---|---|---|---|
| SR01 | 1,2,4 | integration | Actual native1900 export; original group/source1 and current group2; real encrypted retry store | Create prepared/null, begin submission, record exact native commit, reopen/full-state compare, collect | Original native result commits with required/durable host1; persisted source unchanged; no current-placement/digest preparation calls | Bypass real store transitions or replace original source/required host | BASIC | Go-recorded complete group replacement collects through the unchanged persisted evidence source / tests/ddb-private-retained-source-move.deferred.ts |
| SR02 | 1,3,4 | integration | Same genuine vector and real persisted/reopened record; original outcome transport unavailable | Collect while original host1 is unavailable | awaiting_hosts, committed=false, original obligation1 retained; no host2 substitution or finality success claim | Substitute current group2 as required host | BASIC | Go-recorded full replacement cannot substitute a new host for an unavailable original native outcome / same file |
| SR03 | 1,3,4 | integration | Same persisted source1; configure a client using replacement source2 | Collect and inspect channel-open spy plus stored authority | Reject before any channel opening; persisted source1 exact | Omit persisted/configured authority comparison in checked() | BASIC | Go-recorded full replacement preserves exact persisted source authority before any network work / same file |
| SR04 | 4 | contract | Missing/empty/oversized artifact, wrong supplied SHA or missing native-success provenance | Invoke isolated artifact-gated runner for each invalid input | Refuse before staging or Node execution; never synthesize native evidence | Skip size/hash/provenance guard | DEFERRED | - |
| SR05 | 1,2,4 | contract | Artifact with inconsistent original/current/outcome IDs, native identity or canonical member bytes | Validate immutable input and compare original published hashes | Refuse inconsistent evidence; do not repair times, expiry, signatures, source or responses | Rewrite a vector field to make replay pass | DEFERRED | - |
| SR06 | 1,4 | fault | Real retry store and genuine unchanged vector | Fail create/checkpoint/receipt write, use a wrong reopen key or truncate ciphertext | No fabricated attempted/recorded state; exact authority/commit retained or explicit refusal | Treat in-memory state as persisted success | DEFERRED | - |
| SR07 | 4 | fault | Existing staged input, concurrent staging creator or interrupted owned temporary directory | Attempt staging and stop/restart at publication/cleanup boundaries | Preserve existing bytes; no default-discovery promotion without genuine artifact; safe owned cleanup | Overwrite qualification input or stage before validation | DEFERRED | - |
| SR08 | 1,2,4 | determinism | Same native history across independently rebuilt exports and reopened encrypted records | Compare native identities, signed payloads, required-host policy and collection verdicts | Stable protocol evidence/verdict; local encryption randomness does not change authority | Infer authority from current placement or local serialization order | DEFERRED | - |
| SR09 | 1,2,3 | live | Actual retained Store/finality/current-policy source and real authenticated hybrid TLS endpoints | Join SDK persisted retry to full replacement and original-host outage without replay mocks | Same source/required-host policy under real network and policy changes; no premature commit | Treat synthetic inclusion/channel replay as live proof | LIVE | - |
| SR10 | 4 | doc | Frozen fixture correction, exact native1900 artifact and preserved initial review/evidence | Remaining ONE targeted independent client P1 confirmation | Reviewer confirms genuine replay and the narrow correction against original finding; no deployment/readiness inference | Close P1 on source or compilation alone | OWNER | - |

## Actual provenance, first RED and mutant

Native source1900e11e57172eb1d9d8300c9c84bcaeecc4462c generated the successful
152247-byte artifact SHA256
1d8efd8986b80af1588cf43f3eefce6028753d85681720a6b7d0d720f7eeccc2 through
TestMaintenanceFixtureRetainedSourceFullReplacement (actual SQL/evidence/
publication, zero skips). Native input timestamps1000/expiry1060 and epoch1 were
constructed before signing/native application, not changed in this replay.

First actual SDK execution failed all3 cases (Jest3.521s): direct create received
submission_attempted plus an existing commit, while the unchanged store requires
prepared/null before any filesystem operation. Exact original consumer SHA256
6568043eb83fc205dfdb1471a84ed768b7772ffd29c7440b9e97a2e47dcc03f4 and all
first-red logs/results are retained externally. The narrow real-state-transition
correction produced3 GREEN/zero skips (Jest1.998s).

ONE temporary mutant removed only the persisted/configured authority equality
disjunct from src/ddb-private-client.ts checked(), retaining txnId and owned-state
checks. SR01/SR02 passed; SR03 failed semantically (Jest2.208s):

    Received promise resolved instead of rejected
    reason: historical_placement_unverified

The mismatch returned pending instead of the required pre-network rejection.
The guarded SR03 also explicitly asserts no channel opening. Exact original
production bytes were restored; same3 cases returned GREEN/zero skips
(Jest2.992s). Original/restored client SHA256
36e54d2b64c1195a8f1676538cdb4d2e54f10813cfd553bb16ce390c994bea07.
No second mutation or permanent production change was made.

## Live and owner items / residual risks

All Node/ts-jest executions held /tmp/nec-testbed.lock, used cached Node26.8.2 and
existing absolute dependencies. No install/node_modules/junction change, prior94
or PQ32 suite rerun, source-pin/required-host weakening, rewritten vector or new
key/proof authority. This fixed-vector replay does not establish live TLS/Store
composition, crash/power-loss durability, broader fault/load behavior or fleet
availability. Original native required-host obligations remain unchanged.
Root owns final index/inventory, independent P1 confirmation and integration.
Existing private flags remain NotReady; no push, activation or deployment.
