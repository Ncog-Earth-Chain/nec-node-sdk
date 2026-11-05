# Private transaction outcomes

`readDdbPrivateTransactionOutcome` reads one selected host's authenticated local
observation. `collectDdbPrivateTransactionOutcome` makes one pass across an explicit
required durability set and returns committed only when every required host has
matching exact results and the application's independent canonical-finality verifier
accepts the completed transaction. These functions do not prepare or submit mutations.
Use the separate [prepare/custody/submit helpers](private-transaction-mutations.md)
to create and retain the exact unit before invoking this collector.

Use a canonical contract database (`c_` followed by the lowercase contract address).
Wallet aliases must resolve to that existing contract before signing; aliases never
combine storage, authorization or transaction boundaries.

The collector requires:

- The exact `BuiltDdbPrivateTransaction` retained before submission, including its
  salted sidecars and ordered member hashes. Keep this sensitive retry material in
  the application's secure storage. The collector recomputes commitments, DB01 ID
  and member hashes locally; it sends neither salts nor sidecars to outcome endpoints.
- A complete independently trusted historical placement matching the retained
  transaction BASE, and an explicit nonempty sorted unique `requiredHosts` subset.
  There is no default all-host, quorum or reachable-host policy. The application
  selects this set explicitly; success is relative to that set.
- A discovery resolver and `DdbPrivateReadPolicy` authenticating each host's complete
  current assignment and actual confidential channel. Discovery receives only public
  routing queries. The Node implementation uses the existing authenticated hybrid
  TLS connector; browser/mobile applications must supply a qualified transport.
- Mandatory `verifyHistoricalPlacement` and `verifyFinality` callbacks. Their trust
  comes from the application; the SDK does not implement a light client or turn
  matching RPC answers into a proof.

`verifyFinality` must authenticate actual canonical completed, non-skipped inclusion
of the exact commit and complete DB01 unit, matching the supplied TXN ID and ordered
operation hashes. It must also bind the historical group/journal/digest identities
and initial/final roots. A block header, ordinary transaction receipt, local marker
or matching host response is insufficient. The callback receives independently
owned expected values from the retained unit and a separate candidate observation.

```ts
import { collectDdbPrivateTransactionOutcome, type DdbPrivateTxnCollectionInput } from '@ncog/necjs';

// Supplied by the application: retained builder output, explicit durability policy,
// signer, public discovery and independently trusted historical/current/finality adapters.
declare const input: DdbPrivateTxnCollectionInput;

const outcome = await collectDdbPrivateTransactionOutcome(input);
if (outcome.committed) {
  // finality.finalized is true, and every ID in requiredHosts is in durableHosts.
  // payloads are the exact canonical member-v1 bytes; members preserve SQL NULL
  // and raw cell bytes, with uint64 fields represented as bigint.
  const { commitTx, readToken, finality, members } = outcome;
} else {
  // Keep the SAME original retry record. Retry this read collector later.
  // A pending/unavailable result is neither abort nor proof of noncommit.
  const { reason, hosts } = outcome;
}
```

Pass a known nonzero `expectedCommitTx` to bind every signed lookup to that commit.
Pass **explicit `null`** after a lost submit response to query by retained TXN ID.
Omitting the field is an error. Unknown-commit recovery requires every counted host
to identify the same commit and the independent finality callback to validate that
commit against the retained unit; it never chooses a plurality.

The lower-level reader additionally takes one `validatorId` and exact `mode` of
`status` or `result`. It signs the unchanged READPROC v1 selector and four arguments
for that host with fresh time/nonce. It returns only `pending` or `local_durable`;
status mode has no payloads. Canonical shape/identity checks on this single response
do not establish the collector's selected-host completion policy.

Current authorization and historical durability are separate. A newer current route
can authorize the same historically required host, but cannot replace the old required
set. Removed hosts, changed member identities, unavailable historical trust or pruned
evidence leave completion unresolved. No migration receipt or substitute-host rule
is inferred. Original mutation expiry does not cancel a transaction already included.

The collector performs bounded host/member work and relies on transport deadlines
and application adapter cancellation. It does not poll, regenerate mutation salts or
nonces, resubmit SQL, or use generic `Ddb.waitForCommitted`/DB08 receipts. Only new read
envelopes are generated on another call. Per-host failures return bounded dispositions
without raw endpoint errors. Inputs and callback expectations are copied before
asynchronous work. Returned payload/result buffers belong to the caller; JavaScript
does not guarantee forensic zeroization of sensitive copies.

All three SDK entrypoints export the common functions, but only Node has the built-in
hybrid transport. TLS certificate authentication remains classical. No portable quorum
certificate, automatic governed durability selection, private mutation admission,
Ready activation, real-chain deployment or hosted CI result is claimed by this slice.
