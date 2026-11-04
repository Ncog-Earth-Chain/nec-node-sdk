# Private commitment builder (PLACE-03)

This is the offline SDK portion of the gated PLACE-03 implementation. It does not activate the feature, establish a client-to-host connection, or authorize production release. Private DB-01 atomic transactions are not supported by this phase; a homogeneous batch is not an application transaction.

`buildDdbCommitment(input, options)` returns `prepared`, `sidecar`, and `stateDelta`. Sign `prepared.hash` directly with the caller's ML-DSA-87 key. The public envelope contains operation type 15, a salted commitment, placement and digest versions, and keyed row tags. The sidecar contains the salt and plaintext operation with row images. Never put the sidecar or digest key into ordinary transaction calldata, logs, or a request sent through an arbitrary ingress node.

## Inputs and validation

- `payload`: exact bytes returned by the selected host's authenticated `ddb_previewPrivateOp` call. Preview occurs before the commitment is signed.
- `intent`: `{ type, data }` retained from the caller's original local mutation. Never copy this from the preview response. The builder rejects a preview that changes the operation, data, caller, database or contract. JSON numbers must be safe integers; pass exact decimal and large integer SQL arguments as strings.
- `contract`, `from`, `callerPubKey`: the contract and caller identity.
- `digestKey`: the nonzero 32-byte secret for the explicitly admitted digest version.
- `placementVersion`, `digestKeyVersion`: use `bigint` for values above JavaScript's safe integer range. Digest version zero is refused.
- `salt`: omit for a fresh cryptographically random 32-byte salt. Explicit salts support deterministic vectors or managed replay.
- `options`: ordinary `DdbSignOptions`, with operation preimage v2 and the correct chain ID. The outer commitment's nonce and expiry are the caller's new submission values.

The caller checks and signs the exact commitment bytes. A host independently reexecutes the private mutation and recomputes its row tags before accepting the payload. The builder does not prove that a malicious host's returned row images reflect the database; that check belongs to the placed group's endorsement and finality protocol.

Preview JSON uses the node's exact field names. The builder rejects unknown or differently cased operation, row-delta, primary-key and state-delta fields, duplicate members at every object level, invalid UTF-8, byte-order marks, unpaired Unicode surrogates and nesting beyond 128 levels. These checks prevent JavaScript and Go from interpreting the same signed bytes differently. SQL data object keys remain case-sensitive user data; ordinary Unicode and Go's escaped HTML characters are accepted without rewriting the sidecar.

`deriveDdbDigestKey(masterKey, contract)` implements the domain-separated HKDF derivation. It does not select a version or perform rotation. Encryption-key rotation must not silently change the active digest key. Use the key fingerprint and version admitted by the reviewed migration; retain older keys needed for historical recovery. The deterministic tags reveal equality of row versions, as accepted for release one.

## Host RPC sequence

Use an explicitly selected, authenticated placement-host transport. This SDK module does not implement or certify a post-quantum client-to-host channel. The selected SQL host sees plaintext; peer payload transport encryption does not hide data from the host executing SQL.

1. Sign the original data operation and send it directly to `ddb_previewPrivateOp`. Keep its local `{ type, data }` as `intent`. Preview requires read authority as well as mutation authority; confidential-column contracts are currently refused by the row-returning preview.
2. Build the commitment from the exact returned payload and local intent, then sign `prepared.hash`.
3. At that same selected host, call `ddb_putPayload` with the signed public envelope and `sidecar`, or call `ddb_submitSignedOp` with second argument `{ payloadSidecar: sidecar, groupDurableReceipt: true }`. The ordinary SDK `submitSignedOpDetailed` helper does not attach a sidecar; use the explicitly selected transport for these private RPCs.
4. Treat payload intake as storage acknowledgment only. Check the resulting commit status, local materialization and required group durability separately. Refusal, unknown status, missing historical context and pending application are not successful writes.

The node refuses private submission through its legacy global-committee forwarder. Client endpoint authentication, confidentiality, placement freshness and release activation remain separate requirements; do not rely on a routing fallback for private bytes.

Cross-language vectors cover HKDF, keyed row tags, exact envelope bytes, operation hash and request ID, including versions above 2^53 and uint64 maximum. Tests also reject altered intent, unsafe numbers, malformed rows, missing write sets, zero keys and oversized payloads.

## Ordered private batches

Use the authenticated selected placement host for the complete sequence. These calls are direct RPCs; the offline builder does not implement transport, endpoint authentication or post-quantum client-to-host encryption.

1. Retain every original local mutation intent and its order. Send the corresponding signed data-operation array to `ddb_previewPrivateBatch`. It previews the sequence in one rollback-only snapshot, so later members can observe earlier previewed changes.
2. Build and sign each commitment with `buildDdbCommitment`, using that member's exact returned payload and its **original local intent**, in the same order. Verify the database, placement and digest version are the intended common bindings. Each final signed operation needs its own nonce.
3. Call `ddb_putPayloadBatch` with the signed commitment array and matching sidecar array. Success acknowledges retention on that host. A disk failure can leave a retained prefix; retries are idempotent, and partial retention is not a committed batch.
4. Call `ddb_submitSignedPrivateBatch` with the same signed commitment array after retention succeeds. Poll `ddb_getCommitStatus` for its returned transaction hash and check local materialization separately.

The homogeneous batch is one ordered endorsement submission. Members apply independently; it is **not a DB-01 atomic transaction** or a guarantee of application-level all-or-nothing execution. Do not reorder, replace, or mix individually previewed operations into the sequence. Cross-member ACID semantics remain outside this phase.

For explicit digest-key migration preparation and signing, see [Digest-key rotation](DDB_DIGEST_ROTATION_REFERENCE.md).
