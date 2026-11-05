# Private transactions with an explicitly trusted validating node

`createDdbTrustedNodePrivatePolicy` supplies the real source-backed callbacks for
the [private transaction helpers](private-transaction-mutations.md) and their
[outcome collector](private-transaction-outcomes.md). The application must select
`trust: 'trusted-validating-node'` and configure the chain, canonical contract
database, caller, source validator ID/address, HTTPS origin and TLS SPKI pin.
There is no default authority. Discovery and outcome responses cannot select it.
The source may be the same physical replica as an outcome host only when the
application separately configures and trusts it in this role.

TLS authenticates that configured source; the application trusts its full-node
validation and independent chain/SQL observations. This is not a light client or
a portable finality proof. The adapter checks evidence identity and consistency;
it does not independently execute the chain or reconstruct the post-state root.
The wire contract is the node's `docs/design/private-client-evidence.md` at
`1e769b8945b4d460a5c834eb645440d300531e70`. The source must currently be an
authorized assigned replica, and the caller must currently have disclosure
permission. Missing governed directory state, unavailable/pruned history,
ambiguous sealing state and permission failures refuse rather than supply echoes.

## Source-backed checks

Each source read opens a fresh, one-use connection to the explicitly configured
origin and pin before asking the signer to sign. It uses the unchanged signed
READPROC envelope and exactly these methods:

| Method | Selector | Arguments after the source validator's decimal ID |
| --- | --- | --- |
| `ddb_getPrivateAssignmentEvidence` | `@ddb/private-assignment-evidence/v1` | `current` or the positive canonical block hex |
| `ddb_getPrivateTransactionSnapshotEvidence` | `@ddb/private-txn-snapshot-evidence/v1` | Canonical BASE fragment hex, then the ordered canonical intent fragment hex strings |
| `ddb_getPrivateTransactionFinalityEvidence` | `@ddb/private-txn-finality-evidence/v1` | Positive canonical block hex and nonzero commit transaction hash |

The snapshot BASE is comparison input, not authority. The source independently
reconstructs it; the adapter compares every canonical byte with the host preview
and the locally retained intents. The captured `maxMembers` must also match. This
is a local callback addition, not a new governance or wire field. Snapshot
arguments contain no effects, results, salts or digest key. Preparation still
uses the separately supplied local digest key to recompute tags and commitments.
Root checks remain shape, initial-anchor equality and consecutive continuity;
they are not a computation of post roots from digests.

Assignment evidence covers the entire current or requested historical group.
The adapter checks the existing PlacementManager runtime and EndpointDirectory
runtime, exact host coverage/order, endpoint publication state and lease, and the
independently observed HTTPS pin. The directory publisher `auth` and the validator
ML-DSA identity are distinct fields. Discovery remains an untrusted hint. Each
selected recipient must match both the complete route and source evidence;
there is no reachable-host substitute. A moving current head can make two reads
disagree and refuse safely; the adapter does not cache or relax the comparison.

Finality uses canonical non-skipped inclusion from the source, independently of
the outcome table. The adapter compares chain/database/caller/TXN/commit, block
and block hash, original placement/group and journal, digest identity, initial
and final anchors, read version, count, and ordered operation hashes and payload
commitments. It also hashes the supplied exact transaction bytes to the commit
hash. That hash check is not a transaction decoder or a consensus proof. The
collector separately requires authenticated matching local durability from every
explicit `requiredHosts` member. All-local-durable plus unavailable finality
remains pending. An unknown commit hash can be learned from matching outcomes;
it never licenses a new preparation or automatic resubmission.

## Reference flow and local storage

`createDdbPrivateReferenceClient` implements the sequence below, rather than
returning placeholder trust callbacks. The executable TypeScript entry functions
are in [`examples/ddb-private-reference.ts`](../examples/ddb-private-reference.ts).
Its `createPrivateClient` composes the real encrypted Node store with the real
source adapter. The application supplies its existing signer, discovery resolver,
separate storage-key provider and a provider of a fresh transient digest-key
buffer. The reference clears that digest buffer after preparation. It does not
build a production keystore or put raw signing/digest keys in records, arguments
or logs.

1. `prepare` takes explicit preparation and submit recipients, ordered calls,
   key version, `custodyHosts` and nonempty sorted unique `requiredHosts`. It
   checks membership in the complete source-observed group, prepares through the
   source-backed policy, and saves the exact signed retry record before returning
   the TXN ID. Save failure prevents subsequent reference-flow mutations.
2. `custody(txnId)` reloads that record and calls the existing custody helper for
   exactly the listed hosts. An explicitly empty custody list is allowed; it
   supplies no durability guarantee. Custody results remain custody results.
3. `submit(txnId)` atomically persists `submission_attempted` before one submission
   of the original signed unit to the explicit recipient. Repeated submission
   refuses, including after a lost reply. Known receipts are persisted. A receipt
   persistence failure returns `receiptStored: false`; the attempt checkpoint
   remains. A null receipt is pending/unknown, not proof of refusal by the chain.
4. `collect(txnId)` reloads and validates the record and configured authority,
   then invokes the existing collector with source-backed historical/finality
   callbacks and the saved required-host policy. It returns the explicit trust
   label. A newly created reference-client instance can resume this operation
   without obtaining the digest key, replaying SQL, changing salts, or submitting.

The local codec retains exact canonical payloads, sidecars, signatures, typed
operation hashes, complete original placement, roots and explicit policy. It
revalidates the existing member/TXN/commitment relationships on load. Closed,
canonical local JSON rejects unknown fields and alternate or duplicate spellings;
it is not the JSON-RPC wire encoding. Source wrappers use the existing JSON-RPC
parser, so duplicate outer JSON keys are not independently detected there.

`createDdbNodePrivateRetryStore` uses built-in AES-256-GCM with a fresh 12-byte
nonce and full 16-byte tag. Its local framing/AAD binds the file version and TXN
ID. This allocates no consensus or signing domain. `key()` must return a separate
32-byte secret `KeyObject`; the application owns key provisioning and recovery.
No password KDF, directory creation, key export, backup or hidden key default is
provided. Plain local codec output contains private data and must not be written
unencrypted. The bundled store authenticates before decoding and clears temporary
byte buffers, but JavaScript object/string copies are not guaranteed erasable.

The existing absolute directory must be application controlled. Writers use an
exclusive per-TXN lock, an exclusive temporary file with requested mode `0600`,
file flush, close and rename. The caller must explicitly choose:

| `sync` | Requested operation and limit |
| --- | --- |
| `file` | Flush the temporary file before rename. Directory metadata persistence through power loss is not promised. |
| `file-and-directory` | Also open and flush the directory after rename. Failed or unsupported directory flush rejects, even if rename left a valid record. |

Handled failures clean up owned temporary files and locks. A process crash can
leave a lock or temporary file; the store never steals locks or silently retries
submission. The application must inspect/recover its local storage explicitly.
Mode `0600` is not a Windows ACL guarantee. Neither mode claims universal
power-loss durability, protection from a compromised OS, or rollback resistance
against restoration of an older valid encrypted file. Protect the directory,
storage key and backups according to the application's threat model. A custom
`DdbPrivateRetryStore` must provide the same atomic checkpoint contract.

The local plaintext cap is 8 MiB; encrypted files add exactly 36 bytes. The
exported conservative bound is derived from the existing four-member maximum,
128 KiB payload maximum, two envelope representations plus sidecar per member,
both bounded tag arrays, ML-DSA key/signature widths, and 128 KiB of route/policy
metadata. `DDB_PRIVATE_RETRY_WORST_CASE_BYTES` is below the hard cap. It is a local
resource limit, not a chain parameter. Oversized files are refused before
allocating their contents. Transport resource options remain explicit and
bounded by the existing 64 MiB hard maximum; source evidence is additionally
bounded to the node's 512 KiB result limit.

## Supported surface and qualification

The concrete adapter, connector, encrypted store and reference client are Node
entrypoint exports. Shared fragment/record helpers and types also build for
browser and React Native, but no browser/mobile private transport is supplied or
claimed. Actual transport qualification used Node 26.8.2: TLS 1.3,
`X25519MLKEM768`, `TLS_AES_256_GCM_SHA384`, ordinary certificate/hostname checks
and the explicit SPKI pin on the same request socket. Certificate authentication
remains classical. There is no redirect, reconnect or generic-provider fallback.

The source connector allows only the three evidence methods. The existing host
connector retains its six methods. Existing generic private-path guards and
unconfigured public behavior remain unchanged. The focused run passed 128 tests,
25 real TLS assertions with the required no-skips report gate, source/reference
typechecks, five bundles and declarations. See the
[tagged test ledger](testing/private-client-trust-sdk-test-cases.md) for the
unrun crash/platform/live work. No feature flag, consensus word, signing domain,
default host policy, Ready activation, live deployment or publication changed.
