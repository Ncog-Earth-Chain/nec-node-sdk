# 3.0.0

**Every client-signed DDB write was rejected on chain before this release.** If you are on 2.x and
using `createSchemaSigned` / `callProcedureSigned` / `grantRoleSigned` / `revokeRoleSigned`, they could
not have been working: the canonical preimage omitted the signed nonce, so the hash never matched what
the chain recomputes, and the node answered "caller signature verification failed".

## Breaking

- **`canonicalDdbOperationHash(...)` takes a `nonce`** as its 7th argument, appended to the preimage
  after `gasLimit` as a big-endian u64 — the position the node uses.
- **`canonicalDdbRequestId(...)` takes a `nonce`** as its 7th argument, before `requester`.
- **`Ddb.deriveDbName(contractAddress)` takes one argument** and returns `"c_" + the lowercased
  address`. It was `deriveDbName(contractName, contractAddress)` returning `name_last6`, a scheme the
  node retired because a 6-hex suffix collides and the contract name is caller-supplied. Throws on an
  empty or non-hex address instead of returning a schema that cannot exist.
- **The `*Signed` methods take a `DdbSignerLike`** — still a raw private-key string, or now a
  `DdbSigner`. Existing raw-key calls are unaffected.

Each of these is a compile error rather than a silent behaviour change, deliberately: the failure mode
they replace is an invalid signature that only surfaces at the node.

## Added

- **`DdbSigner`** — sign a DDB operation without handing the SDK a private key. Required for a wallet,
  a browser extension or a hardware device, none of which could authorize a DDB write before.
- **`buildDdbOp()` / `Ddb.submitSignedOp()`** — build and submit as separate steps, for signers the
  SDK cannot call into at all.
- **`privateKeyDdbSigner()`** — wrap a raw key as a `DdbSigner`; used internally so the raw-key and
  wallet paths share one code path.
- **`Ddb.updateSchemaSigned()`** — contract upgrades had no client-signed path. Since DDB schema
  evolution is additive-only and contracts cannot be deleted, upgrade is the only way a deployed
  contract ever changes.
- **`DdbSignOptions.nonce`** — pin the nonce for a deterministic hash. Omit it and you get 8
  cryptographically random bytes, which is what you want.

## Fixed

- The nonce is generated, signed over, and **sent** (`nonce` on the `ddb_submitSignedOp` envelope).
  The node cannot fill it in — it is inside the signed hash — so an SDK that omits it leaves the node
  reading 0 for every operation, and a replay of past bytes is then indistinguishable from the
  original and authorized by the caller's own signature.
- The golden vector is now a real cross-check. It previously pinned a constant this SDK computed
  itself, under a comment claiming to verify against the node, while the node pinned its own value
  too — so both suites passed for as long as the SDK could not sign anything the chain would accept.
  It now asserts the two constants the chain prints, for `nonce = 0` and for a nonce carrying real
  bytes.
