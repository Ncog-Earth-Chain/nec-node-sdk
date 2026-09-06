// src/key-registry.ts
//
// Client surface for the NCOG Earth Chain account key-rotation registry (Model B) and guardian
// social recovery. Faithful port of the node's write-side precompile and the read-side slot layout:
//
//   node write side : ncogearthchain/ncogearthchain/genesis/keyregistry/keyregistry.go
//   node read side  : ncog-evm/core/vm/keyregistry.go   (slot layout, digests, consensus constants)
//   enforcement     : ncogearthchain/evmcore/state_transition.go preCheck -> vm.EnforceKeyHash
//   registration    : ncogearthchain/ncogearthchain/rules.go  DefaultVMConfig.StatePrecompiles
//
// =================================================================================================
// MODEL B, AND THE ONE THING A CLIENT MUST NEVER GET WRONG
// =================================================================================================
// Rotation changes the KEY. It does NOT change the ADDRESS. That is the entire point: balances,
// token allowances, contract ownership and on-chain identity all hang off the address, so an address
// change is indistinguishable from losing the account.
//
// Before rotation an account's identity is derived: address == keccak256(rawPubkey)[12:].
// After rotation the new key hashes to a DIFFERENT address, and the account's address stays put. The
// binding now lives in the registry, and every later transaction from that account is signed:
//
//     from   = the account's ORIGINAL, STABLE address     (NOT keccak(newPubkey)[12:])   <- MUST
//     sigVer = 3  (SIGVER_ROTATED)                                                       <- declare
//
// The two are not equally load-bearing, and the next section says exactly which is which.
//
// `signTransactionMLDSA87` defaults to `from = keccak(pubkey)[12:]`, `sigVer = 2`, which is correct
// for an unrotated account and WRONG -- permanently unusable -- for a rotated one. Use
// `signRotatedTransactionMLDSA87(tx, newPrivateKey, accountAddress)` (or
// `Wallet.createRotated(newPrivateKey, accountAddress)`) after a rotation or a recovery.
//
// WHAT THE NODE ACTUALLY ENFORCES (stated exactly, because it is easy to over-claim here):
//
//   * `from` is load-bearing. `Sender()` returns the tx's CLAIMED from (transaction_signing.go step
//     6) after verifying the ML-DSA-87 signature over a digest that BINDS it, and preCheck then
//     calls `vm.EnforceKeyHash(state, From, keccak256(pubkey))`, which requires -- for a rotated
//     account -- that the key hash equal the registry's currentKeyHash. Get `from` wrong and you have
//     signed for a different account.
//   * `sigVer` is bound into the digest too (SigningHash leads with it), so it cannot be altered
//     after signing. But it is NOT an authorization input and NOT what selects the rotated path.
//     `Sender()`'s only check on it is `tx.SigVer() < types.SigVerMLDsaV2` -- ANY value >= 2 passes,
//     including values with no defined meaning -- and `EnforceKeyHash` never reads it at all.
//     Verified on the deployed node (chainId 0x9af, ncogearthchain/v1.0.2-rc.5-fbfa9c33): raw
//     transactions signed with sigVer 2, 3, 4 and 255 all get past Sender() to the balance check.
//   * Both directions of the consequence: a liar who claims sigVer 3 on an account that never
//     rotated gains nothing, because the legacy keccak binding still has to hold
//     (ncogearthchain/evmcore/keyregistry_rotate_test.go TestEnforcement_MasqueradeAndSigVer); and a
//     genuinely rotated account is accepted because of `from` + the registry, NOT because it said 3.
//
// So sigVer 3 is a DECLARATION of scheme -- for indexers, wallets and any future gate -- not an
// enforcement the deployed node performs. Emit it: it is the honest description of the signature and
// the only field that distinguishes the two schemes on the wire. Just do not believe that emitting
// it is what makes a rotated transaction work, or that omitting it is what would make one fail.
//
// THE COROLLARY THAT HAS ALREADY COST THIS PROJECT ONCE -- THE NONCE BELONGS TO THE SIGNED `from`.
// preCheck reads `st.state.GetNonce(st.msg.From())`, and `From()` is the signed ClaimedFrom. A client
// that signs as the account but fetches the nonce for some other identity -- a dApp-supplied `from`,
// a data address, the address the new key derives -- sends a transaction the node rejects
// "nonce too low" as soon as the real account has sent anything of its own. `Signer.sendTransaction`
// (src/wallet.ts, src/wallet.browser.ts) fetches the nonce for the wallet's own account and refuses a
// mismatched caller-supplied `from`; anything that hand-rolls a send must do the same.
//
// =================================================================================================
// FLOW 1 -- SELF-ROTATION (the user still holds the old key; e.g. the key was exposed)
// =================================================================================================
//   1. read state:   const rec = await readKeyRegistry(provider, account)
//   2. generate the NEW ML-DSA-87 key pair (keep the old one until step 5 confirms).
//   3. proof-of-possession, signed by the NEW key (anti-brick -- the chain refuses to install a key
//      nobody can sign for):
//        const pop = await signRotationProof(newSecretKey, { chainId, account, rotationNonce: rec.rotationNonce })
//   4. send `encodeRotateKey(pop)` to KEY_REGISTRY_ADDRESS, signed by the CURRENT (old) key, from the
//      account itself. `caller == tx.origin` is required: no contract may rotate on your behalf.
//      Gas: `keyRegistryGas('rotateKey')` = 1,560,000 (one ML-DSA-87 verify at 1,500,000 + three
//      SSTOREs) PLUS the intrinsic cost of 7223 calldata bytes, ~136,000. Measured end-to-end on the
//      deployed node: `eth_estimateGas` on a real SDK-built rotateKey returned 0x19e0e0 = 1,695,968.
//   5. confirm: readKeyRegistry(...).currentKeyHash === pop.newKeyHash. ONLY THEN discard the old key.
//   6. from now on sign with the new key AND `from = account`, `sigVer = 3`.
//
//   Self-rotation is subject to MIN_ROTATION_GAP blocks between rotations (the first is exempt).
//
// =================================================================================================
// FLOW 2 -- GUARDIAN SETUP (do this BEFORE you lose the key; there is no retrofit)
// =================================================================================================
//   The account sends `encodeSetGuardians({ threshold: M, guardians: [...N addresses] })` to the
//   registry, signed by its own current key (`caller == tx.origin`; nobody can set your guardians and
//   you cannot set anybody else's). N <= MAX_GUARDIANS, M <= N. M === 0 disables recovery entirely.
//   Guardian addresses are just addresses -- a guardian who later rotates their OWN key keeps the same
//   address and keeps working (their approval is validated against their CURRENT registered key).
//
// =================================================================================================
// FLOW 3 -- GUARDIAN RECOVERY (the user has LOST the key). Three parties, two transactions.
// =================================================================================================
//   USER (or whoever is helping them):
//     a. generate a NEW key pair; read `rotationNonce` from the chain.
//     b. compute the recovery digest and sign the new-key proof-of-possession:
//          const pop = await signRecoveryProof(newSecretKey, { chainId, account, rotationNonce })
//        `pop.digest` is the SINGLE digest every guardian signs. Circulate {account, chainId,
//        newKeyHash, rotationNonce} -- a guardian must recompute the digest, never trust one handed to
//        them, or they can be tricked into approving a key they have not seen.
//
//   EACH GUARDIAN (>= M of them), offline, on their own device:
//     c. `const approval = await signGuardianApproval(guardianSecretKey, { chainId, account,
//            newKeyHash: pop.newKeyHash, rotationNonce }, guardianAddress)`
//        `guardianAddress` is the guardian's REGISTERED address, which is NOT keccak(their pubkey)[12:]
//        if that guardian has itself rotated -- pass the registered one.
//
//   ANY RELAYER (needs gas, needs no authority -- authority is the M signatures):
//     d. send `encodeInitiateRecovery({ account, ...pop, approvals })` to the registry. This only
//        records a PENDING key.
//     e. wait RECOVERY_DELAY_BLOCKS (259200 BLOCKS -- see the constant; it is NOT 72 hours on the
//        deployed network, it is years). During the window the real owner -- if they still hold the
//        key -- can `encodeCancelRecovery()` and kill it. Show a user the block count, or the output
//        of `estimateRecoveryWindow(provider)`, never an hours figure from a hardcoded block rate.
//     f. send `encodeFinalizeRecovery(account)`. Anyone may send it. It installs the pending key and
//        bumps rotationNonce.
//
//   THE ADDRESS DOES NOT CHANGE AT ANY POINT. After (f) the user signs with the new key and
//   `from = account`, `sigVer = 3` -- same address, same balance, same everything.
//
//   OWNER VETO: `encodeCancelRecovery()` bumps rotationNonce, which invalidates the pending recovery
//   AND every guardian signature already collected off-chain (they are bound to the old nonce), and
//   starts RECOVERY_COOLDOWN_BLOCKS during which no new recovery may be initiated. Cancelling with
//   nothing pending is legal and useful: it pre-emptively burns any signature set being gathered.
//
// =================================================================================================
// ENCODING NOTE
// =================================================================================================
// The 4-byte selectors are keccak256 of Solidity-looking signatures, but the BODIES ARE NOT ABI-
// ENCODED. They are tightly packed fixed-width fields (the precompile slices raw offsets). Passing
// ABI-encoded calldata reverts.

import { keccak_256 } from '@noble/hashes/sha3';

// ---------------------------------------------------------------------------
// addresses, sizes, consensus constants  (ncog-evm/core/vm/keyregistry.go)
// ---------------------------------------------------------------------------

/** The key-rotation registry state precompile. `vm.KeyRegistryAddress`. */
export const KEY_REGISTRY_ADDRESS = '0xd200EC0000000000000000000000000000000000';

/** RAW marshaled ML-DSA-87 public key length. */
export const MLDSA87_PUBKEY_BYTES = 2592;
/** ML-DSA-87 signature length. */
export const MLDSA87_SIG_BYTES = 4627;

// ---------------------------------------------------------------------------------------------
// The three timing constants below are BLOCK COUNTS and nothing else. The node's own comments gloss
// them as "~72h at ~1s/block"; that block rate is not what the deployed network runs at, and the
// gloss is off by more than two orders of magnitude. Measured against
// https://api.dsuite.ncog.earth/chain-rpc (chainId 0x9af, ncogearthchain/v1.0.2-rc.5-fbfa9c33) at
// head 6425 on 2026-09-06, via eth_getBlockByNumber timestamps:
//
//     last   50 blocks:    31166 s / 50   = 623.3 s/block
//     last  200 blocks:   120991 s / 200  = 605.0 s/block
//     last 1000 blocks:   608421 s / 1000 = 608.4 s/block
//     last 6000 blocks:  3655953 s / 6000 = 609.3 s/block
//
// At ~608 s/block, RECOVERY_DELAY_BLOCKS is ~1,825 days -- five YEARS, not 72 hours -- and
// MIN_ROTATION_GAP is ~41 minutes, not ~4 seconds. That rate is a property of the network's current
// traffic, not of the protocol, so do NOT hardcode any of these numbers either: call
// `estimateRecoveryWindow(provider)`, which samples the chain's actual rate, or show block counts.
// ---------------------------------------------------------------------------------------------

/**
 * Minimum BLOCKS between an account's SELF-rotations; the first rotation is exempt.
 * `vm.MinRotationGap`. Guardian recovery is deliberately not subject to it.
 */
export const MIN_ROTATION_GAP = 4;
/**
 * Challenge window between initiateRecovery and finalizeRecovery, in BLOCKS.
 * `vm.RecoveryDelayBlocks`. See the note above before converting this to a wall-clock duration.
 */
export const RECOVERY_DELAY_BLOCKS = 259200;
/**
 * BLOCKS after an owner veto during which no new recovery may be initiated.
 * `vm.RecoveryCooldownBlocks`. Same caveat: a block count, not a duration.
 */
export const RECOVERY_COOLDOWN_BLOCKS = 259200;
/** Hard cap on the guardian set. `vm.MaxGuardians`. */
export const MAX_GUARDIANS = 32;

/** Gas the precompile charges for ONE ML-DSA-87 verification. */
export const MLDSA_VERIFY_GAS = 1_500_000;
/** `params.SstoreSetGasEIP2200` -- the per-slot write price the precompile charges. */
const SSTORE_SET_GAS = 20_000;

/** Record field offsets within an account's registry record. `vm.RegOff*`. */
export const REG_OFF = {
  currentKeyHash: 0,
  rotatedAt: 1,
  rotationNonce: 2,
  guardianThreshold: 3,
  guardianCount: 4,
  pendingKeyHash: 5,
  pendingEffectiveBlock: 6,
  pendingNonce: 7,
  recoveryCooldownUntil: 8,
} as const;

// ---------------------------------------------------------------------------
// hex / byte helpers (self-contained: this module is imported by wallets that
// tree-shake, and duplicating 20 lines beats exporting tx-signer internals)
// ---------------------------------------------------------------------------

function stripHex(hex: string): string {
  const s = (hex || '').trim();
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

function hexToBytes(hex: string): Uint8Array {
  let h = stripHex(hex).toLowerCase();
  if (h.length % 2 === 1) h = '0' + h;
  if (h.length > 0 && !/^[0-9a-f]+$/.test(h)) throw new Error('invalid hex string');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  const s = String(v).trim();
  if (s === '' || s === '0x' || s === '0X') return BigInt(0);
  return BigInt(s);
}

/** Left-pad a non-negative integer to a 32-byte big-endian word. */
function pad32(v: bigint): Uint8Array {
  if (v < BigInt(0)) throw new Error('negative value cannot be a 32-byte word');
  let h = v.toString(16);
  if (h.length > 64) throw new Error('value exceeds 32 bytes');
  h = h.padStart(64, '0');
  return hexToBytes(h);
}

/** 8-byte big-endian, as the node's `binary.BigEndian.PutUint64`. */
function be64(v: bigint): Uint8Array {
  if (v < BigInt(0) || v > BigInt('0xffffffffffffffff')) throw new Error('value out of uint64 range');
  return hexToBytes(v.toString(16).padStart(16, '0'));
}

function addressBytes(addr: string): Uint8Array {
  const b = hexToBytes(addr);
  if (b.length !== 20) throw new Error(`invalid address length ${b.length} (expected 20): ${addr}`);
  return b;
}

function toBytes(v: Uint8Array | string): Uint8Array {
  return v instanceof Uint8Array ? v : hexToBytes(v);
}

// ---------------------------------------------------------------------------
// bundled ML-DSA-87 loader (same bundle tx-signer.ts uses)
// ---------------------------------------------------------------------------
let _mldsa: any = null;
async function getMldsa(): Promise<any> {
  if (!_mldsa) {
    // @ts-ignore - noble-post-quantum.js is a bundled JS file without types
    const mod = await import('./noble-post-quantum.js');
    const algorithms = (mod as any).default || mod;
    _mldsa = algorithms.ml_dsa87;
    if (!_mldsa) throw new Error('ml_dsa87 not available in bundled noble-post-quantum');
  }
  return _mldsa;
}

// ---------------------------------------------------------------------------
// 4-byte selectors -- keccak256(signature)[:4]
// ---------------------------------------------------------------------------
function selector(sig: string): string {
  return '0x' + bytesToHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4));
}

/**
 * Method selectors, computed (not hardcoded) from the exact signature strings the node hashes in
 * `ncogearthchain/genesis/keyregistry/keyregistry.go`. Their values, verified against the live node
 * at chainId 2479: rotateKey 0x4da33cee, setGuardians 0xe94e9e99, initiateRecovery 0xbebcdb45,
 * finalizeRecovery 0x315a7af3, cancelRecovery 0x0ba234d6.
 */
export const KEY_REGISTRY_SELECTORS = {
  rotateKey: selector('rotateKey(bytes,bytes)'),
  setGuardians: selector('setGuardians(address[],uint8)'),
  initiateRecovery: selector('initiateRecovery(address,bytes,bytes,bytes[],bytes[])'),
  finalizeRecovery: selector('finalizeRecovery(address)'),
  cancelRecovery: selector('cancelRecovery()'),
} as const;

// ---------------------------------------------------------------------------
// storage slots  (ncog-evm/core/vm/keyregistry.go recordBaseSlot/fieldSlot/guardianSlot)
// ---------------------------------------------------------------------------

const TWO_256 = BigInt(1) << BigInt(256);

/** keccak256(leftPad32(addr) ++ pad32(0)) -- the Solidity mapping base slot for an account's record. */
export function recordBaseSlot(account: string): string {
  const buf = new Uint8Array(64);
  buf.set(addressBytes(account), 12); // left-pad into the first word; second word is the mapping slot 0
  return '0x' + bytesToHex(keccak_256(buf));
}

/** Storage key of a scalar record field (`REG_OFF.*`): base + offset, wrapping at 2^256. */
export function registrySlot(account: string, offset: number): string {
  const base = BigInt(recordBaseSlot(account));
  return '0x' + bytesToHex(pad32((base + BigInt(offset)) % TWO_256));
}

/** Storage key of the i-th guardian address: keccak256(fieldSlot(base, guardianCount)) + i. */
export function guardianSlot(account: string, i: number): string {
  const arrBase = BigInt('0x' + bytesToHex(keccak_256(hexToBytes(registrySlot(account, REG_OFF.guardianCount)))));
  return '0x' + bytesToHex(pad32((arrBase + BigInt(i)) % TWO_256));
}

// ---------------------------------------------------------------------------
// digests  (ncog-evm/core/vm/keyregistry.go keyRegistryDigest)
//   keccak256( domain ++ pad32(chainId) ++ account(20) ++ newKeyHash(32) ++ be64(rotationNonce) )
// ---------------------------------------------------------------------------

// "NEC-KEYREG-ROTATE\x01" and "NEC-KEYREG-RECOVER\x01": distinct domains so a proof gathered for a
// self-rotation can never be replayed as a recovery, or vice versa.
const ROTATION_DOMAIN = concatBytes(new TextEncoder().encode('NEC-KEYREG-ROTATE'), Uint8Array.of(0x01));
const RECOVERY_DOMAIN = concatBytes(new TextEncoder().encode('NEC-KEYREG-RECOVER'), Uint8Array.of(0x01));

export interface RotationBinding {
  /** eth_chainId of the target chain. Bound into the digest: a proof cannot cross chains. */
  chainId: string | number | bigint;
  /** The account being rotated/recovered -- its STABLE address. */
  account: string;
  /** keccak256(rawNewPublicKey), 32 bytes. */
  newKeyHash: string | Uint8Array;
  /** The account's CURRENT registry rotationNonce (0 for a never-rotated account). */
  rotationNonce: string | number | bigint;
}

function keyRegistryDigest(domain: Uint8Array, b: RotationBinding): string {
  const kh = toBytes(b.newKeyHash);
  if (kh.length !== 32) throw new Error(`newKeyHash must be 32 bytes, got ${kh.length}`);
  return '0x' + bytesToHex(keccak_256(concatBytes(
    domain,
    pad32(toBigInt(b.chainId)),
    addressBytes(b.account),
    kh,
    be64(toBigInt(b.rotationNonce)),
  )));
}

/** Digest the NEW key signs to prove possession when SELF-rotating. `vm.RotationSigningHash`. */
export function rotationSigningHash(b: RotationBinding): string {
  return keyRegistryDigest(ROTATION_DOMAIN, b);
}

/** Digest the NEW key AND EACH GUARDIAN sign to authorize a recovery. `vm.RecoverySigningHash`. */
export function recoverySigningHash(b: RotationBinding): string {
  return keyRegistryDigest(RECOVERY_DOMAIN, b);
}

/** keccak256 of a raw ML-DSA-87 public key -- the value the registry stores and compares. */
export function keyHashOf(rawPublicKey: Uint8Array | string): string {
  const pub = toBytes(rawPublicKey);
  if (pub.length !== MLDSA87_PUBKEY_BYTES) {
    throw new Error(`public key must be ${MLDSA87_PUBKEY_BYTES} raw bytes, got ${pub.length}`);
  }
  return '0x' + bytesToHex(keccak_256(pub));
}

// ---------------------------------------------------------------------------
// proof signing
// ---------------------------------------------------------------------------

export interface KeyProof {
  /** RAW marshaled ML-DSA-87 public key, 0x-hex (2592 bytes). */
  newPublicKey: string;
  /** ML-DSA-87 signature over `digest`, 0x-hex (4627 bytes). */
  newKeySignature: string;
  /** keccak256(newPublicKey). */
  newKeyHash: string;
  /** The digest that was signed -- the value guardians must independently recompute. */
  digest: string;
}

async function signProof(
  domain: Uint8Array,
  newSecretKey: Uint8Array | string,
  b: Omit<RotationBinding, 'newKeyHash'>,
): Promise<KeyProof> {
  const mldsa = await getMldsa();
  const sk = toBytes(newSecretKey);
  const pub: Uint8Array = mldsa.derivePublicKey(sk);
  const newKeyHash = keyHashOf(pub);
  const digest = keyRegistryDigest(domain, { ...b, newKeyHash });
  const sig: Uint8Array = mldsa.sign(sk, hexToBytes(digest));
  return {
    newPublicKey: '0x' + bytesToHex(pub),
    newKeySignature: '0x' + bytesToHex(sig),
    newKeyHash,
    digest,
  };
}

/**
 * Proof-of-possession for a SELF-rotation: the NEW key signs `rotationSigningHash`. Without it the
 * chain would let you install a key nobody can sign for and brick the account, so it is mandatory.
 */
export function signRotationProof(
  newSecretKey: Uint8Array | string,
  b: Omit<RotationBinding, 'newKeyHash'>,
): Promise<KeyProof> {
  return signProof(ROTATION_DOMAIN, newSecretKey, b);
}

/** Proof-of-possession for a GUARDIAN RECOVERY: the NEW key signs `recoverySigningHash`. */
export function signRecoveryProof(
  newSecretKey: Uint8Array | string,
  b: Omit<RotationBinding, 'newKeyHash'>,
): Promise<KeyProof> {
  return signProof(RECOVERY_DOMAIN, newSecretKey, b);
}

export interface GuardianApproval {
  /** The guardian's REGISTERED address. Not derivable from `publicKey` if the guardian has rotated. */
  address: string;
  /** The guardian's CURRENT raw ML-DSA-87 public key, 0x-hex. */
  publicKey: string;
  /** The guardian's signature over the recovery digest, 0x-hex. */
  signature: string;
}

/**
 * One guardian's approval of a recovery. The guardian signs the SAME `recoverySigningHash` the new
 * key signed. Recompute the digest from {chainId, account, newKeyHash, rotationNonce} rather than
 * accepting a digest someone hands you -- otherwise you can be induced to approve an unknown key.
 *
 * `guardianAddress` defaults to keccak(pubkey)[12:], which is correct only for a guardian that has
 * never rotated its own key. A rotated guardian MUST pass its registered address explicitly.
 */
export async function signGuardianApproval(
  guardianSecretKey: Uint8Array | string,
  b: RotationBinding,
  guardianAddress?: string,
): Promise<GuardianApproval> {
  const mldsa = await getMldsa();
  const sk = toBytes(guardianSecretKey);
  const pub: Uint8Array = mldsa.derivePublicKey(sk);
  const digest = recoverySigningHash(b);
  const sig: Uint8Array = mldsa.sign(sk, hexToBytes(digest));
  const address = guardianAddress ?? '0x' + bytesToHex(keccak_256(pub).slice(12));
  return { address, publicKey: '0x' + bytesToHex(pub), signature: '0x' + bytesToHex(sig) };
}

// ---------------------------------------------------------------------------
// calldata builders -- TIGHTLY PACKED, NOT ABI-ENCODED
// ---------------------------------------------------------------------------

function checkedPubKey(v: Uint8Array | string, label: string): Uint8Array {
  const b = toBytes(v);
  if (b.length !== MLDSA87_PUBKEY_BYTES) {
    throw new Error(`${label} must be ${MLDSA87_PUBKEY_BYTES} raw bytes, got ${b.length}`);
  }
  return b;
}

function checkedSig(v: Uint8Array | string, label: string): Uint8Array {
  const b = toBytes(v);
  if (b.length !== MLDSA87_SIG_BYTES) {
    throw new Error(`${label} must be ${MLDSA87_SIG_BYTES} bytes, got ${b.length}`);
  }
  return b;
}

/**
 * `rotateKey`: selector + newPubKey(2592) + newKeySig(4627). 7223 bytes.
 * Send from the account itself, signed by its CURRENT key. `caller == tx.origin` is enforced.
 */
export function encodeRotateKey(proof: Pick<KeyProof, 'newPublicKey' | 'newKeySignature'>): string {
  return '0x' + bytesToHex(concatBytes(
    hexToBytes(KEY_REGISTRY_SELECTORS.rotateKey),
    checkedPubKey(proof.newPublicKey, 'newPublicKey'),
    checkedSig(proof.newKeySignature, 'newKeySignature'),
  ));
}

/**
 * `setGuardians`: selector + threshold(1) + count(1) + count*address(20). Send from the account
 * itself. `threshold === 0` disables recovery. Replaces the whole set.
 */
export function encodeSetGuardians(args: { threshold: number; guardians: string[] }): string {
  const { threshold, guardians } = args;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('threshold must be an integer in 0..255');
  }
  if (guardians.length > MAX_GUARDIANS) {
    throw new Error(`guardian set of ${guardians.length} exceeds MAX_GUARDIANS (${MAX_GUARDIANS})`);
  }
  if (threshold > guardians.length) {
    throw new Error(`threshold ${threshold} exceeds guardian count ${guardians.length} -- the chain rejects this`);
  }
  const parts = [hexToBytes(KEY_REGISTRY_SELECTORS.setGuardians), Uint8Array.of(threshold, guardians.length)];
  for (const g of guardians) parts.push(addressBytes(g));
  return '0x' + bytesToHex(concatBytes(...parts));
}

/**
 * `initiateRecovery`: selector + account(20) + newPubKey(2592) + newKeySig(4627) + gcount(1)
 *                     + gcount*( guardianAddr(20) + guardianPubKey(2592) + guardianSig(4627) ).
 * Sendable by ANYONE -- authority is the M valid guardian signatures, never the caller.
 */
export function encodeInitiateRecovery(args: {
  account: string;
  newPublicKey: Uint8Array | string;
  newKeySignature: Uint8Array | string;
  approvals: GuardianApproval[];
}): string {
  const { account, approvals } = args;
  if (approvals.length === 0) throw new Error('initiateRecovery needs at least one guardian approval');
  if (approvals.length > MAX_GUARDIANS) {
    throw new Error(`${approvals.length} approvals exceed MAX_GUARDIANS (${MAX_GUARDIANS})`);
  }
  const parts = [
    hexToBytes(KEY_REGISTRY_SELECTORS.initiateRecovery),
    addressBytes(account),
    checkedPubKey(args.newPublicKey, 'newPublicKey'),
    checkedSig(args.newKeySignature, 'newKeySignature'),
    Uint8Array.of(approvals.length),
  ];
  for (const a of approvals) {
    parts.push(addressBytes(a.address));
    parts.push(checkedPubKey(a.publicKey, `guardian ${a.address} publicKey`));
    parts.push(checkedSig(a.signature, `guardian ${a.address} signature`));
  }
  return '0x' + bytesToHex(concatBytes(...parts));
}

/** `finalizeRecovery`: selector + account(20). Sendable by anyone once the timelock has elapsed. */
export function encodeFinalizeRecovery(account: string): string {
  return '0x' + bytesToHex(concatBytes(hexToBytes(KEY_REGISTRY_SELECTORS.finalizeRecovery), addressBytes(account)));
}

/** `cancelRecovery`: selector only. The owner's veto; must come from the account itself. */
export function encodeCancelRecovery(): string {
  return KEY_REGISTRY_SELECTORS.cancelRecovery;
}

// ---------------------------------------------------------------------------
// gas estimates -- mirror the precompile's own charges so a caller can size a tx
// without an eth_estimateGas round trip (estimateGas on a precompile that
// verifies 2592-byte keys is expensive and easy to underquote).
// ---------------------------------------------------------------------------

export type KeyRegistryOp =
  'rotateKey' | 'setGuardians' | 'initiateRecovery' | 'finalizeRecovery' | 'cancelRecovery';

/**
 * Gas the precompile itself charges. Add the intrinsic tx cost (21000 + 16 per non-zero calldata
 * byte) to size a transaction. `n` is the guardian count for setGuardians / the approval count for
 * initiateRecovery; it is ignored otherwise.
 */
export function keyRegistryGas(op: KeyRegistryOp, n = 0): number {
  switch (op) {
    case 'rotateKey': return MLDSA_VERIFY_GAS + 3 * SSTORE_SET_GAS;
    case 'setGuardians': return (2 + n) * SSTORE_SET_GAS;
    case 'initiateRecovery': return MLDSA_VERIFY_GAS * (1 + n) + 3 * SSTORE_SET_GAS;
    case 'finalizeRecovery': return 6 * SSTORE_SET_GAS;
    case 'cancelRecovery': return 6 * SSTORE_SET_GAS;
    default: throw new Error(`unknown key-registry op: ${op}`);
  }
}


// ---------------------------------------------------------------------------
// how long is the recovery window, really -- MEASURED, never assumed
// ---------------------------------------------------------------------------
//
// RECOVERY_DELAY_BLOCKS / RECOVERY_COOLDOWN_BLOCKS / MIN_ROTATION_GAP are block counts. Turning one
// into "72 hours" requires a block rate, and the only honest source of a block rate is the chain the
// client is actually talking to. These helpers sample it, so a wallet can tell a user "your recovery
// unlocks in about N days on THIS network" instead of repeating a constant that is wrong by ~500x on
// the deployed one.

/** Minimal Provider shape the block-rate helpers need -- satisfied by `Provider`. */
export interface BlockRateReader {
  getBlockNumber(): Promise<number | string>;
  getBlockByNumber(tag: string, full?: boolean): Promise<{ timestamp?: unknown } | null>;
}

/** Accept a hex string, a decimal string, a number or a bigint -- `Provider` normalizes hex away. */
function toNum(v: unknown, what: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const s = v.trim();
    const n = /^0[xX]/.test(s) ? Number(BigInt(s)) : Number(s);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`${what}: expected a number, got ${JSON.stringify(v)}`);
}

export interface BlockRateSample {
  /** Head block the sample ends at. */
  headBlock: number;
  /** Block the sample starts at (headBlock - blocks). */
  fromBlock: number;
  /** Blocks spanned. May be smaller than the requested window on a short chain. */
  blocks: number;
  /** Wall-clock seconds between the two block timestamps. */
  seconds: number;
  /** seconds / blocks. */
  secondsPerBlock: number;
}

/**
 * Measure the chain's recent block rate from two block timestamps (two `eth_getBlockByNumber` calls).
 * `window` is the number of blocks to look back; it is clamped to what the chain has.
 *
 * This is a MEASUREMENT of one network at one moment, not a protocol constant: the rate moves with
 * traffic. Re-sample rather than caching it across sessions.
 */
export async function sampleBlockRate(provider: BlockRateReader, window = 1000): Promise<BlockRateSample> {
  if (!Number.isInteger(window) || window < 1) throw new Error(`window must be a positive integer, got ${window}`);
  const head = toNum(await provider.getBlockNumber(), 'eth_blockNumber');
  if (head < 1) throw new Error(`chain has no interval to measure (head block ${head})`);
  const blocks = Math.min(window, head);
  const from = head - blocks;
  const tag = (n: number) => '0x' + n.toString(16);
  const [hb, fb] = await Promise.all([
    provider.getBlockByNumber(tag(head), false),
    provider.getBlockByNumber(tag(from), false),
  ]);
  if (!hb || !fb) throw new Error(`block ${!hb ? head : from} not found -- cannot measure the block rate`);
  const seconds = toNum(hb.timestamp, `block ${head} timestamp`) - toNum(fb.timestamp, `block ${from} timestamp`);
  if (!(seconds > 0)) {
    throw new Error(`non-increasing block timestamps between ${from} and ${head} (${seconds}s) -- cannot measure a rate`);
  }
  return { headBlock: head, fromBlock: from, blocks, seconds, secondsPerBlock: seconds / blocks };
}

export interface RecoveryWindowEstimate {
  /** The sample the rest of this object is derived from -- report it alongside any figure shown. */
  sample: BlockRateSample;
  secondsPerBlock: number;
  /** RECOVERY_DELAY_BLOCKS at the measured rate. */
  recoveryDelaySeconds: number;
  recoveryDelayDays: number;
  /** RECOVERY_COOLDOWN_BLOCKS at the measured rate. */
  recoveryCooldownSeconds: number;
  /** MIN_ROTATION_GAP at the measured rate -- how long after a self-rotation before the next is allowed. */
  minRotationGapSeconds: number;
}

/**
 * The rotation/recovery timing constants converted to wall-clock using the chain's MEASURED block
 * rate. Use this (and show `sample`) instead of any hardcoded "~72h": on the deployed network the
 * measured rate makes RECOVERY_DELAY_BLOCKS about five years, and a user told "72 hours" would be
 * told something false by a factor of ~600.
 */
export async function estimateRecoveryWindow(
  provider: BlockRateReader,
  window = 1000,
): Promise<RecoveryWindowEstimate> {
  const sample = await sampleBlockRate(provider, window);
  const spb = sample.secondsPerBlock;
  return {
    sample,
    secondsPerBlock: spb,
    recoveryDelaySeconds: RECOVERY_DELAY_BLOCKS * spb,
    recoveryDelayDays: (RECOVERY_DELAY_BLOCKS * spb) / 86400,
    recoveryCooldownSeconds: RECOVERY_COOLDOWN_BLOCKS * spb,
    minRotationGapSeconds: MIN_ROTATION_GAP * spb,
  };
}

// ---------------------------------------------------------------------------
// registry reader -- plain eth_getStorageAt, no precompile call needed
// ---------------------------------------------------------------------------

export interface KeyRegistryRecord {
  account: string;
  /** keccak256 of the account's authorized key, or null when it has never rotated. */
  currentKeyHash: string | null;
  /** true once the account has rotated: its address no longer equals keccak(pubkey)[12:]. */
  rotated: boolean;
  /** Block of the last key write. Self-rotation is barred until rotatedAt + MIN_ROTATION_GAP. */
  rotatedAt: number;
  /** Monotonic. Bound into every rotation/recovery digest; cancelRecovery bumps it. */
  rotationNonce: number;
  /** M of the M-of-N guardian rule. 0 means guardian recovery is DISABLED for this account. */
  guardianThreshold: number;
  /** N. */
  guardianCount: number;
  /**
   * Registered guardian addresses, read from the array slots. Length is
   * `min(guardianCount, MAX_GUARDIANS)`: `guardianCount` is reported raw as the chain stores it,
   * while the read is clamped, so the two differ only if a record somehow carries a count above the
   * cap the precompile enforces -- in which case this list is the part that was actually read.
   */
  guardians: string[];
  /** Pending recovery target key hash, or null when no recovery is in flight. */
  pendingKeyHash: string | null;
  /** Block at which a pending recovery may be finalized. */
  pendingEffectiveBlock: number;
  /** rotationNonce snapshot at initiate; finalize requires rotationNonce to still equal it. */
  pendingNonce: number;
  /** No new recovery may be initiated before this block (set by an owner veto). */
  recoveryCooldownUntil: number;
}

/** Minimal Provider shape this module needs -- satisfied by `Provider`. */
export interface StorageReader {
  getStorageAt(address: string, position: string, tag?: string): Promise<string>;
}

const ZERO32 = '0x' + '0'.repeat(64);

function slotToNumber(raw: string): number {
  const v = BigInt(!raw || raw === '0x' ? '0x0' : raw);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`registry slot value ${v} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(v);
}

function normHash(raw: string): string {
  return '0x' + bytesToHex(pad32(BigInt(!raw || raw === '0x' ? '0x0' : raw)));
}

/**
 * Read an account's full registry record. Uses `eth_getStorageAt` on KEY_REGISTRY_ADDRESS, so it
 * needs no precompile call and works against any full node.
 */
export async function readKeyRegistry(
  provider: StorageReader,
  account: string,
  tag = 'latest',
): Promise<KeyRegistryRecord> {
  const read = (off: number) => provider.getStorageAt(KEY_REGISTRY_ADDRESS, registrySlot(account, off), tag);
  const [cur, rotAt, nonce, thr, cnt, pend, pendBlk, pendNonce, cooldown] = await Promise.all([
    read(REG_OFF.currentKeyHash), read(REG_OFF.rotatedAt), read(REG_OFF.rotationNonce),
    read(REG_OFF.guardianThreshold), read(REG_OFF.guardianCount), read(REG_OFF.pendingKeyHash),
    read(REG_OFF.pendingEffectiveBlock), read(REG_OFF.pendingNonce), read(REG_OFF.recoveryCooldownUntil),
  ]);

  const guardianCount = slotToNumber(cnt);
  const guardians: string[] = [];
  if (guardianCount > 0) {
    const raw = await Promise.all(
      Array.from({ length: Math.min(guardianCount, MAX_GUARDIANS) },
        (_, i) => provider.getStorageAt(KEY_REGISTRY_ADDRESS, guardianSlot(account, i), tag)),
    );
    for (const r of raw) guardians.push('0x' + normHash(r).slice(-40));
  }

  const currentKeyHash = normHash(cur);
  const pendingKeyHash = normHash(pend);
  return {
    account: account.toLowerCase(),
    currentKeyHash: currentKeyHash === ZERO32 ? null : currentKeyHash,
    rotated: currentKeyHash !== ZERO32,
    rotatedAt: slotToNumber(rotAt),
    rotationNonce: slotToNumber(nonce),
    guardianThreshold: slotToNumber(thr),
    guardianCount,
    guardians,
    pendingKeyHash: pendingKeyHash === ZERO32 ? null : pendingKeyHash,
    pendingEffectiveBlock: slotToNumber(pendBlk),
    pendingNonce: slotToNumber(pendNonce),
    recoveryCooldownUntil: slotToNumber(cooldown),
  };
}

/**
 * Which `from` / `sigVer` a client must sign with for this account, given its registry record and
 * the public key it holds. This is the guard against the one catastrophic client bug: signing a
 * rotated account's transactions with the DERIVED address, which is a different, empty account.
 *
 * Throws when the held key is not the account's authorized key -- better a loud client-side error
 * than a transaction the node silently refuses to execute.
 */
export function senderFieldsFor(
  record: KeyRegistryRecord,
  rawPublicKey: Uint8Array | string,
): { from: string; sigVer: 2 | 3 } {
  const pub = toBytes(rawPublicKey);
  const derived = '0x' + bytesToHex(keccak_256(pub).slice(12));
  const account = record.account.toLowerCase();
  if (!record.rotated) {
    if (derived.toLowerCase() !== account) {
      throw new Error(
        `key does not control ${account}: it derives ${derived} and the account has never rotated`);
    }
    return { from: account, sigVer: 2 };
  }
  if (keyHashOf(pub).toLowerCase() !== String(record.currentKeyHash).toLowerCase()) {
    throw new Error(
      `key is not the registered key for ${account} (registry currentKeyHash=${record.currentKeyHash})`);
  }
  // Rotated: the address STAYS. Sign as the account, declare sigVer 3.
  return { from: account, sigVer: 3 };
}
