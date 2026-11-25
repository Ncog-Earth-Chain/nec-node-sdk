// anchor.ts — verify that an operation is included in a window the chain anchored.
//
// This is the client half of docs/design/anchor-commitment-hierarchy.md in the chain repository, and it
// is a faithful port of gossip/ddb/anchor_merkle.go and anchor_window.go. Every digest below must match
// the node's byte for byte, which is why the golden vectors in tests/anchor.test.ts are the SAME
// constants as the Go test's: a divergence between the two implementations has to surface as a failing
// test here rather than as a tenant who cannot verify their own data.
//
// WHY A CLIENT NEEDS THIS AT ALL. Under window anchoring the chain carries a root, not the operations,
// so "my write is on chain" stops being something you can read off a transaction and becomes something
// you PROVE: recompute the leaf, walk the path, recompute the window root, compare with the root the
// chain anchored. Without a client-side verifier the anchor is a receipt the operator asks you to
// trust, which is the opposite of the point.

import { keccak_256 } from '@noble/hashes/sha3';

/** Service kinds. Permanent and never reused; a retired service keeps its id. */
export const ANCHOR_KIND_DDB = 1;
export const ANCHOR_KIND_STORAGE = 2;
export const ANCHOR_KIND_COMPUTE = 3;
export const ANCHOR_KIND_AI = 4;

/** The hierarchy version these functions implement. A node anchoring another version is not verifiable here. */
export const ANCHOR_HIERARCHY_VERSION = 1;

// == Go's anchorLeafTag / anchorNodeTag / anchorServiceTag / anchorEmptyTag / anchorWindowTag /
// anchorEndorseTag. A change to any of these is a consensus change on the node side and a client break
// here, which is why they are written out rather than derived.
const TAG_LEAF = new TextEncoder().encode('NEC-ANCHOR-LEAF\x01');
const TAG_NODE = new TextEncoder().encode('NEC-ANCHOR-NODE\x01');
const TAG_SERVICE = new TextEncoder().encode('NEC-ANCHOR-SERVICE\x01');
const TAG_EMPTY = new TextEncoder().encode('NEC-ANCHOR-EMPTY\x01');
const TAG_WINDOW = new TextEncoder().encode('NEC-ANCHOR-WINDOW\x01');
const TAG_ENDORSE = new TextEncoder().encode('NEC-ANCHOR-ENDORSE\x01');

function cat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function u16be(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`u16 out of range: ${v}`);
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}

function u32be(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`);
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

// BigInt CONSTANTS rather than literals: this package targets ES2019, where `0n` is a compile error.
// Same convention as ddb-capability.ts:59, which solved this before.
const B_ZERO = BigInt(0);
const B_EIGHT = BigInt(8);
const B_FF = BigInt(0xff);
const B_U64_MAX = BigInt('18446744073709551615');

// u64be takes a bigint rather than a number: block heights and window ids can exceed 2^53, and silently
// losing precision on a field that is part of a consensus digest is the kind of bug that only shows up
// once the chain is old.
function u64be(v: bigint | number): Uint8Array {
  let x = typeof v === 'bigint' ? v : BigInt(v);
  if (x < B_ZERO || x > B_U64_MAX) throw new Error(`u64 out of range: ${v}`);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { out[i] = Number(x & B_FF); x >>= B_EIGHT; }
  return out;
}

/** A 32-byte digest, as the 0x-prefixed lower-case hex the node prints. */
export type AnchorHash = string;

function toHash(b: Uint8Array): AnchorHash {
  return '0x' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function fromHash(h: AnchorHash): Uint8Array {
  const s = h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
  if (s.length !== 64 || /[^0-9a-fA-F]/.test(s)) throw new Error(`not a 32-byte hash: ${h}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** == Go AnchorLeafHash. The index is covered so two identical payloads at different positions differ. */
export function anchorLeafHash(index: number, payload: Uint8Array): AnchorHash {
  return toHash(keccak_256(cat(TAG_LEAF, u32be(index), u32be(payload.length), payload)));
}

/** == Go AnchorNodeHash. Ordered: swapping the children must change the digest. */
export function anchorNodeHash(left: AnchorHash, right: AnchorHash): AnchorHash {
  return toHash(keccak_256(cat(TAG_NODE, fromHash(left), fromHash(right))));
}

/** == Go AnchorEmptyRoot. A window in which a service had no operations. Never the zero hash. */
export function anchorEmptyRoot(): AnchorHash {
  return toHash(keccak_256(TAG_EMPTY));
}

/** == Go AnchorServiceEmpty. An activated but idle service, bound to its kind. */
export function anchorServiceEmpty(kind: number): AnchorHash {
  return toHash(keccak_256(cat(TAG_SERVICE, u16be(kind), new TextEncoder().encode('empty'))));
}

/** == Go AnchorServiceHash. Binds a service root to its kind so a root cannot move between kinds. */
export function anchorServiceHash(kind: number, root: AnchorHash): AnchorHash {
  return toHash(keccak_256(cat(TAG_SERVICE, u16be(kind), fromHash(root))));
}

/**
 * == Go AnchorMerkleRoot. The caller owns the order, which must be the node's canonical one.
 *
 * It does not sort, for the same reason the Go side does not: sorting here would silently accept a
 * caller that fed an unordered collection, hiding the one mistake that makes a client disagree with the
 * chain.
 */
export function anchorMerkleRoot(payloads: Uint8Array[]): AnchorHash {
  if (payloads.length === 0) return anchorEmptyRoot();
  let level = payloads.map((p, i) => anchorLeafHash(i, p));
  while (level.length > 1) level = foldLevel(level);
  return level[0];
}

// A lone trailing node is DUPLICATED, not promoted. See the Go file's comment: the index binding is what
// closes the classic odd-count collision, and duplication is kept so that safety does not rest on one
// property alone.
function foldLevel(level: AnchorHash[]): AnchorHash[] {
  const next: AnchorHash[] = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(i + 1 < level.length ? anchorNodeHash(level[i], level[i + 1]) : anchorNodeHash(level[i], level[i]));
  }
  return next;
}

/**
 * == Go VerifyAnchorInclusion. Recompute the root from the leaf and its path.
 *
 * `total` is required and is NOT inferred from the path length, because the path alone cannot say where
 * a level duplicated its last node. Verifying without it is how an inclusion proof becomes forgeable.
 */
export function verifyAnchorInclusion(
  root: AnchorHash, index: number, total: number, payload: Uint8Array, path: AnchorHash[],
): boolean {
  if (!Number.isInteger(index) || !Number.isInteger(total)) return false;
  if (index < 0 || total <= 0 || index >= total) return false;
  if (total === 1) return path.length === 0 && anchorLeafHash(index, payload) === root;
  let h = anchorLeafHash(index, payload);
  let at = index;
  let size = total;
  for (const sib of path) {
    if (size <= 1) return false; // a path longer than the tree is tall
    h = at % 2 === 0 ? anchorNodeHash(h, sib) : anchorNodeHash(sib, h);
    at = Math.floor(at / 2);
    size = Math.ceil(size / 2);
  }
  return size === 1 && h === root;
}

/** One service's commitment in a window. */
export interface AnchorServiceCommitment { kind: number; root: AnchorHash }

/** == Go WindowHeader. `kindSet` must be ascending and exactly the kinds the commitments carry. */
export interface AnchorWindowHeader {
  version: number;
  windowId: bigint | number;
  epoch: bigint | number;
  firstBlock: bigint | number;
  lastBlock: bigint | number;
  priorWindowRoot: AnchorHash;
  kindSet: number[];
}

function encodeHeader(h: AnchorWindowHeader): Uint8Array {
  return cat(
    u16be(h.version), u64be(h.windowId), u64be(h.epoch), u64be(h.firstBlock), u64be(h.lastBlock),
    fromHash(h.priorWindowRoot), u32be(h.kindSet.length), ...h.kindSet.map(u16be),
  );
}

/**
 * == Go WindowRoot, including its refusals. Throws rather than returning a digest for an ambiguous
 * window, so a client cannot verify against a root the node would never have produced.
 */
export function anchorWindowRoot(h: AnchorWindowHeader, services: AnchorServiceCommitment[]): AnchorHash {
  if (h.version !== ANCHOR_HIERARCHY_VERSION) throw new Error(`unknown anchor hierarchy version ${h.version}`);
  if (BigInt(h.lastBlock) < BigInt(h.firstBlock)) throw new Error('anchor window: lastBlock is below firstBlock');
  for (let i = 1; i < services.length; i++) {
    if (services[i].kind === services[i - 1].kind) throw new Error(`anchor window: service kind ${services[i].kind} appears twice`);
    if (services[i].kind < services[i - 1].kind) throw new Error('anchor window: service commitments are not in ascending kind order');
  }
  if (h.kindSet.length !== services.length) {
    throw new Error(`anchor window: header claims ${h.kindSet.length} kind(s), ${services.length} commitment(s) supplied`);
  }
  for (let i = 0; i < services.length; i++) {
    if (h.kindSet[i] !== services[i].kind) {
      throw new Error(`anchor window: header position ${i} is kind ${h.kindSet[i]}, commitment is kind ${services[i].kind}`);
    }
  }
  return toHash(keccak_256(cat(
    TAG_WINDOW, encodeHeader(h), u16be(services.length),
    ...services.map(s => fromHash(anchorServiceHash(s.kind, s.root))),
  )));
}

/** == Go WindowEndorsementHash: what a committee member signs, bound to its epoch and window. */
export function anchorEndorsementHash(root: AnchorHash, epoch: bigint | number, windowId: bigint | number): AnchorHash {
  return toHash(keccak_256(cat(TAG_ENDORSE, fromHash(root), u64be(epoch), u64be(windowId))));
}

/** A complete proof that one operation is in an anchored window (hierarchy §6). */
export interface AnchorInclusionProof {
  header: AnchorWindowHeader;
  services: AnchorServiceCommitment[];
  kind: number;
  opIndex: number;
  opTotal: number;
  operation: Uint8Array;
  opPath: AnchorHash[];
}

/**
 * verifyAnchorProof is the whole check a tenant runs: the operation is under its service's root, that
 * root is in the window, and the window hashes to `anchoredRoot` — the root read from the chain.
 *
 * `anchoredRoot` must come from the chain, not from the proof. A proof that supplies its own expected
 * root proves only that it is self-consistent.
 */
export function verifyAnchorProof(proof: AnchorInclusionProof, anchoredRoot: AnchorHash): boolean {
  const svc = proof.services.find(s => s.kind === proof.kind);
  if (!svc) return false;
  if (!verifyAnchorInclusion(svc.root, proof.opIndex, proof.opTotal, proof.operation, proof.opPath)) return false;
  let computed: AnchorHash;
  try {
    computed = anchorWindowRoot(proof.header, proof.services);
  } catch {
    return false;
  }
  return computed === anchoredRoot;
}
