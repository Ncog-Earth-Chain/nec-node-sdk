// anchor.test.ts — the cross-implementation pin for window anchoring.
//
// Every hex constant here was produced by the NODE, not by this SDK: they are the same goldens as
// ncogearthchain/gossip/ddb/anchor_merkle_test.go and anchor_window_test.go. That is the point of the
// file. A port of a consensus digest that is tested only against itself proves the port is
// self-consistent, which is exactly the bug that leaves a tenant unable to verify their own data while
// every test is green on both sides.
//
// If one of these fails after a node change, the node changed a consensus digest and this SDK is stale.
// Bump nothing here without the matching node commit.

import {
  anchorEmptyRoot, anchorServiceEmpty, anchorLeafHash, anchorNodeHash, anchorMerkleRoot,
  anchorServiceHash, anchorWindowRoot, anchorEndorsementHash, verifyAnchorInclusion, verifyAnchorProof,
  ANCHOR_HIERARCHY_VERSION, ANCHOR_KIND_DDB, ANCHOR_KIND_STORAGE, ANCHOR_KIND_AI,
  type AnchorWindowHeader, type AnchorServiceCommitment,
} from '../src/anchor';

const enc = (s: string) => new TextEncoder().encode(s);
const leaves = (...s: string[]) => s.map(enc);

// Produced by the Go implementation; see the header comment.
const GO = {
  empty: '0x2e30ab67c4ffe45f78ebfac6ed72a6879f9a89422fb2c16d6beeb892dba268a2',
  serviceEmpty1: '0x67f09d59ef4fb75beff90782fd4a8242c6468b28890e834cb5e4412b55e75254',
  leaf0a: '0xd14c12fceea1d88eed2339220901439d101b43e9505f03e1ed3bc486d4f5032a',
  root1: '0xd14c12fceea1d88eed2339220901439d101b43e9505f03e1ed3bc486d4f5032a',
  root2: '0xa18e1866585b12498f73ce54761380902dd6087bbeb04007d99041370953679b',
  root3: '0x5448392c1bfefd60ba1a8c288f8b5c9b48a47ceea4061b3f4cf525b2995b2aa3',
  root5: '0x41f3e0f6376877a69ee328ac74ec9d422c60a2bb0ca8ce56b589c041710e54d8',
  ddbServiceRoot: '0x95577f9bb52c4561412368d64ea86b3f958c03955c641d3455fa271b6cce560b',
  storageServiceRoot: '0x08a57b3b89b02fcf954327770af0fe5a6aa7212894ec89de40fe51b1eaee0be8',
  windowRoot: '0xf3fe93e7d11cff3389501558b6f58d34414c730154df40c9f7ae526143f33cc5',
  endorsement: '0x9f74b35892b35c5684b1cb4df980101a1195d02ba2a9e95008ea7b2f51195dba',
  path1: [
    '0x88b56b090f017f7d79008f2cff26b2c8e0bec06d387fcc4f01348d4b01cc738f',
    '0x1e056861dbb57e3e2c28d970265b53b1bf84c7d992071412753c92c4a3745d64',
  ],
};

const header = (): AnchorWindowHeader => ({
  version: ANCHOR_HIERARCHY_VERSION,
  windowId: 42,
  epoch: 7,
  firstBlock: 1000,
  lastBlock: 1009,
  priorWindowRoot: '0xaa' + '00'.repeat(31),
  kindSet: [ANCHOR_KIND_DDB, ANCHOR_KIND_STORAGE],
});

const services = (): AnchorServiceCommitment[] => ([
  { kind: ANCHOR_KIND_DDB, root: anchorMerkleRoot(leaves('op1', 'op2', 'op3')) },
  { kind: ANCHOR_KIND_STORAGE, root: anchorMerkleRoot(leaves('unit1')) },
]);

describe('anchor digests match the node byte for byte', () => {
  it('reproduces the node’s leaf, node and empty digests', () => {
    expect(anchorEmptyRoot()).toBe(GO.empty);
    expect(anchorServiceEmpty(1)).toBe(GO.serviceEmpty1);
    expect(anchorLeafHash(0, enc('a'))).toBe(GO.leaf0a);
  });

  it('reproduces the node’s Merkle roots, including the odd-count path', () => {
    expect(anchorMerkleRoot(leaves('a'))).toBe(GO.root1);
    expect(anchorMerkleRoot(leaves('a', 'b'))).toBe(GO.root2);
    expect(anchorMerkleRoot(leaves('a', 'b', 'c'))).toBe(GO.root3);
    expect(anchorMerkleRoot(leaves('a', 'b', 'c', 'd', 'e'))).toBe(GO.root5);
  });

  it('reproduces the node’s service roots, window root and endorsement hash', () => {
    expect(anchorMerkleRoot(leaves('op1', 'op2', 'op3'))).toBe(GO.ddbServiceRoot);
    expect(anchorMerkleRoot(leaves('unit1'))).toBe(GO.storageServiceRoot);
    const root = anchorWindowRoot(header(), services());
    expect(root).toBe(GO.windowRoot);
    expect(anchorEndorsementHash(root, 7, 42)).toBe(GO.endorsement);
  });

  it('reproduces the node’s inclusion path', () => {
    // The path the node produced for leaf 1 of [op1 op2 op3]. If this drifts, a proof the node issues
    // will not verify in a client even though both sides pass their own round-trip tests.
    const payloads = leaves('op1', 'op2', 'op3');
    expect(verifyAnchorInclusion(GO.ddbServiceRoot, 1, 3, payloads[1], GO.path1)).toBe(true);
  });
});

describe('inclusion verification', () => {
  it('accepts a correct proof at every index and size', () => {
    for (const n of [1, 2, 3, 4, 5, 8, 9, 17]) {
      const payloads = Array.from({ length: n }, (_, i) => enc(`op${i}`));
      const root = anchorMerkleRoot(payloads);
      for (let i = 0; i < n; i++) {
        // Build the path the same way the node does, so this also exercises foldLevel.
        let level = payloads.map((p, j) => anchorLeafHash(j, p));
        const path: string[] = [];
        for (let at = i; level.length > 1; at = Math.floor(at / 2)) {
          path.push(at % 2 === 0 ? (at + 1 < level.length ? level[at + 1] : level[at]) : level[at - 1]);
          const next: string[] = [];
          for (let k = 0; k < level.length; k += 2) {
            next.push(k + 1 < level.length ? anchorNodeHash(level[k], level[k + 1]) : anchorNodeHash(level[k], level[k]));
          }
          level = next;
        }
        expect(verifyAnchorInclusion(root, i, n, payloads[i], path)).toBe(true);
      }
    }
  });

  it('rejects forgeries', () => {
    const payloads = leaves('a', 'b', 'c', 'd', 'e');
    const root = anchorMerkleRoot(payloads);
    expect(verifyAnchorInclusion(root, 1, 3, payloads[1], GO.path1)).toBe(false); // another tree's path
    expect(verifyAnchorInclusion(root, 0, 0, payloads[0], [])).toBe(false);
    expect(verifyAnchorInclusion(root, 5, 5, payloads[0], [])).toBe(false);
    expect(verifyAnchorInclusion(root, -1, 5, payloads[0], [])).toBe(false);
    // A single-leaf tree with a non-empty path must be refused, or the root could be any node digest.
    expect(verifyAnchorInclusion(anchorMerkleRoot(leaves('a')), 0, 1, enc('a'), [GO.empty])).toBe(false);
  });
});

describe('window validation refuses what the node refuses', () => {
  it('refuses an unknown version, bad blocks, and KindSet mismatches', () => {
    expect(() => anchorWindowRoot({ ...header(), version: 99 }, services())).toThrow(/version/);
    expect(() => anchorWindowRoot({ ...header(), lastBlock: 999 }, services())).toThrow(/lastBlock/);
    expect(() => anchorWindowRoot({ ...header(), kindSet: [ANCHOR_KIND_DDB] }, services())).toThrow(/claims/);
    expect(() => anchorWindowRoot({ ...header(), kindSet: [ANCHOR_KIND_DDB, ANCHOR_KIND_AI] }, services())).toThrow(/kind/);
    const out = [services()[1], services()[0]];
    expect(() => anchorWindowRoot({ ...header(), kindSet: [ANCHOR_KIND_STORAGE, ANCHOR_KIND_DDB] }, out)).toThrow(/ascending/);
    // Positive control, so a validator that threw on everything could not pass this block.
    expect(anchorWindowRoot(header(), services())).toBe(GO.windowRoot);
  });

  it('binds the service root to its kind', () => {
    const r = '0x' + '33'.repeat(32);
    expect(anchorServiceHash(1, r)).not.toBe(anchorServiceHash(2, r));
  });
});

describe('verifyAnchorProof', () => {
  const proof = () => ({
    header: header(),
    services: services(),
    kind: ANCHOR_KIND_DDB,
    opIndex: 1,
    opTotal: 3,
    operation: enc('op2'),
    opPath: GO.path1,
  });

  it('accepts a whole honest proof against the root read from the chain', () => {
    expect(verifyAnchorProof(proof(), GO.windowRoot)).toBe(true);
  });

  it('rejects a proof that does not hash to the anchored root', () => {
    // The root must come from the CHAIN. A proof checked against a root it supplied itself proves only
    // that it is self-consistent, which is the failure this argument exists to prevent.
    expect(verifyAnchorProof(proof(), GO.empty)).toBe(false);
  });

  it('rejects a tampered operation, a wrong index and an absent kind', () => {
    expect(verifyAnchorProof({ ...proof(), operation: enc('op9') }, GO.windowRoot)).toBe(false);
    expect(verifyAnchorProof({ ...proof(), opIndex: 2 }, GO.windowRoot)).toBe(false);
    expect(verifyAnchorProof({ ...proof(), kind: ANCHOR_KIND_AI }, GO.windowRoot)).toBe(false);
  });

  it('rejects a proof whose services were edited to match a different root', () => {
    const p = proof();
    p.services = [{ ...p.services[0], root: GO.empty }, p.services[1]];
    expect(verifyAnchorProof(p, GO.windowRoot)).toBe(false);
  });
});
