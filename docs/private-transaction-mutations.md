# Private transaction preparation, custody and submission

Use `prepareDdbPrivateTransaction`, `storeDdbPrivateTransactionPayloads` and
`submitDdbPrivateTransaction` for an explicitly addressed private DB01 transaction.
Preparation returns the complete retry record before any custody or submission.
Submission returns **pending**. Completion requires the separate
[authenticated outcome collector](private-transaction-outcomes.md), independent
canonical finality and every host in the application's explicit required durability set.

All calls use one canonical contract database (`c_` plus the lowercase address).
Resolve wallet aliases before calling; they do not combine contract authorization,
storage, key or transaction boundaries. Members are ordered declared mutation
procedure calls. The node supports ordinary joins, predicates, arithmetic, DML and
RETURNING inside those procedures; this API does not accept arbitrary SQL or
read-only, TABLE/SETOF or cross-contract transaction members.

## Application trust and preparation

Every request requires an explicit recipient validator ID, discovery resolver and
`DdbPrivateReadPolicy`. The policy authenticates the complete current assignment,
endpoint identity and confidential channel independently of discovery JSON. The
helpers never choose a home host or use the generic Provider for private data.

Preparation also requires explicit chain, caller, key version, captured member
bound (1..4), local digest key and `acceptPreparedSnapshot`. This callback must
authenticate the candidate's completed BASE header/rules, full placement and SQL
context against independent trusted application evidence. That includes definition,
permissions, gas/context, digest identity and runtime. Echoing the preview BASE is
not authentication. The callback can validate a candidate against trusted evidence;
the SDK does not implement that evidence acquisition or a light client.

The SDK signs an op7 DB01 preparation array using unchanged op-v2 domains. It retains
the exact local intent bytes and scalars, checks bounded canonical member-v1 replies,
requires their common BASE to equal the independently accepted BASE, and recomputes
keyed tags and salted commitments with the locally supplied digest key. Tag ordering
and multiplicity must match. The key is not sent, included in policy arguments or
their receiver, or retained in the returned record. The SDK clears its temporary
key copy; JavaScript does not guarantee forensic erasure of copies.

Root validation checks exact 32-byte shape, the initial anchor, and sequential
prior/post continuity. It does **not** reconstruct LtHash post roots from digests:
the required lane state is not present in this wire format. Applications with
trusted lane state may independently check the sequence. The node performs actual
SQL/quorum checks, and the outcome finality policy must bind canonical final roots.
The separate stateDelta field is derived and checked; the operation signature binds
the payload commitment and transaction unit, not independent stateDelta bytes.

Only after acceptance does the SDK sign the final op15 unit and return a
`DdbPrivateTransactionRetryRecord`. No custody or submit request is made implicitly.
Keep the record in secure, integrity-protected application storage before continuing.
It contains plaintext canonical results/context, salts and exact signed envelopes;
it contains no digest key or signing key. Its member hashes are `Uint8Array` values:
use storage that preserves typed arrays, or explicitly rehydrate them before reuse.
Plain JSON.parse of JSON.stringify(record) does not restore typed arrays. The SDK
does not provide a persistent store or a serialization protocol.

## Explicit custody, submission and recovery

```ts
import {
  prepareDdbPrivateTransaction, storeDdbPrivateTransactionPayloads,
  submitDdbPrivateTransaction, collectDdbPrivateTransactionOutcome,
  type DdbPrivateTransactionPrepareInput, type DdbPrivateTransactionRetryRecord,
  type DdbPrivateTxnCollectionInput,
} from '@ncog/necjs';

// All policies and IDs below are explicit application inputs, not SDK defaults.
declare const preparation: DdbPrivateTransactionPrepareInput;
declare const custodyHosts: readonly number[];
declare const submitRecipient: number;
declare const requiredHosts: number[]; // Nonempty, sorted, unique; subset of full trusted placement.
declare const persistSecurely: (record: DdbPrivateTransactionRetryRecord) => Promise<void>;
declare const verifyHistoricalPlacement: DdbPrivateTxnCollectionInput['verifyHistoricalPlacement'];
declare const verifyFinality: DdbPrivateTxnCollectionInput['verifyFinality'];

const record = await prepareDdbPrivateTransaction(preparation);
await persistSecurely(record); // Must succeed before a mutating network request.
const channel = { resolver: preparation.resolver, policy: preparation.policy };
for (const validatorId of custodyHosts) {
  const custody = await storeDdbPrivateTransactionPayloads({ ...channel, record, validatorId });
  if (custody.state !== 'custody_stored') throw new Error('custody unresolved; retain the same record');
}
// The application decides whether its explicit custody policy permits submission.
const submission = await submitDdbPrivateTransaction({ ...channel, record, validatorId: submitRecipient });
const outcome = await collectDdbPrivateTransactionOutcome({
  ...channel, signer: preparation.signer, chain: preparation.chain,
  database: preparation.database, caller: preparation.caller,
  txnId: record.retained.id, expectedCommitTx: submission.commitTxHash,
  maxMembers: record.maxMembers, retained: record.retained,
  completePlacement: record.completePlacement, requiredHosts,
  verifyHistoricalPlacement, verifyFinality,
});
// outcome.committed requires both canonical finality and every required storage host.
```

Custody addresses one host and compares its complete ordered response with the
locally recomputed commitments. `custody_stored` means keeper retention at that host,
not post-apply durability or group commitment. A partial store or lost reply yields
`custody_unknown`; the host may have retained a prefix. There is no custody threshold,
implicit host list or selected reachable subset in the helper.

Submission sends the same signed final unit exactly once, with no sidecars or
automatic custody, signing or reprepare. A nonzero commit hash is pending. Errors,
lost replies and malformed responses yield pending with `commitTxHash: null` and
the original TXN/member identities. These states are not proof of noncommit.
Resolve an unknown reply through the outcome collector using explicit null expected
commit, or retry exact custody bytes under application policy. Never replay SQL or
generate fresh salts/nonces merely because a response was lost.

Each call copies and revalidates record contents before its first await: canonical
payloads, salts/commitments, DB01/member hashes, headers and signed/unsigned envelope
pairing. Persisted record integrity remains an application responsibility. Without
the digest key, retry cannot independently rederive tags; preparation checks them
and the node rechecks them during actual admission. Signature width and pairing
are checked locally; the node validates cryptographic signatures and key registry
authorization. A locally edited record is not made trustworthy by a checksum.

Current blocks can advance while the assignment stays the same. Mutation calls
refuse service when the retained full assignment/version/group/manager/runtime or
member identities differ. They do not rebase BASE, replace recipients or infer a
migration policy. The outcome collector separately supports current authorization
of historical required hosts; pruned or inaccessible evidence remains unresolved.

## Transport and generic SDK behavior

Node's existing `connectDdbNodePrivateRead` now permits exactly the two signed-read
methods, the authenticated outcome method, and the three mutation methods above.
Each helper opens a fresh authenticated one-use channel. Existing CA/hostname/pin,
hybrid group, request/response bounds, deadline and redirect refusal still apply.
The built-in channel uses X25519MLKEM768 key establishment and classical TLS
certificate authentication. Browser/mobile applications must supply a qualified
transport; exporting the helpers does not supply one.

Transport defaults stay request 1 MiB / response 4 MiB. Maximal valid custody units
can exceed the default request allowance. Configure `maxRequestBytes: 4 * 1024 *
1024` explicitly on the Node connector when needed; the existing hard bound is
64 MiB. No global default or governance parameter changes.

A `Ddb` configured with `privateRouting` refuses generic sign/submit/run/wait paths
before their provider/signing/attempt callbacks. Generic transaction submission also
refuses any numeric op15 member, and single-op submission refuses extracted DB01
members. Generic waits refuse `requiresAuthenticatedOutcome: true` before local
applied/durable/readToken success, including contradictory success responses. That
refusal cannot trigger runTransaction's automatic SQL retry. Public unconfigured
single operations, transactions and waits preserve their existing behavior.

The four deprecated server-signed mutation conveniences also refuse explicit private
routing before serialization or Provider work; their unconfigured public wire is unchanged.
An unmarked op7 intention or bare hash does not encode database privacy. These
guards cannot infer stripped metadata or protect direct raw Provider calls.
`getCommitStatus` remains diagnostic. There is no portable quorum certificate,
required-host default, replacement policy, new signing domain, Ready activation
or deployment in this SDK slice. The separately opt-in
[trusted validating-node adapter and reference client](private-client-trust.md)
now supply concrete source-backed context/finality callbacks and encrypted local
retry persistence when the application explicitly configures that authority.
