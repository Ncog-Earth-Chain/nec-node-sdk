// Key-rotation registry (Model B) + guardian recovery: byte-level tests.
//
// Everything here asserts on the BYTES that would reach the node -- calldata slices at exact offsets,
// storage slot keys, and the raw RLP of a rotated-account transaction -- never on a mock having been
// called. The digest and slot assertions rebuild the node's preimage inline from
// ncog-evm/core/vm/keyregistry.go rather than calling the function under test.
//
// The suite tagged LIVE runs the SDK's own calldata through the DEPLOYED node with eth_call (plus
// eth_call state overrides to stage guardian state), so the node's Go ML-DSA verifier and Go digest
// are what accept or reject the JS-built bytes. Set NEC_LIVE_RPC to enable, e.g.
//   NEC_LIVE_RPC=https://api.dsuite.ncog.earth/chain-rpc npx jest tests/key-registry.test.ts

import { keccak_256 } from '@noble/hashes/sha3';
import {
  KEY_REGISTRY_ADDRESS, KEY_REGISTRY_SELECTORS, REG_OFF,
  MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES, MAX_GUARDIANS,
  recordBaseSlot, registrySlot, guardianSlot,
  rotationSigningHash, recoverySigningHash, keyHashOf,
  signRotationProof, signRecoveryProof, signGuardianApproval,
  encodeRotateKey, encodeSetGuardians, encodeInitiateRecovery, encodeFinalizeRecovery, encodeCancelRecovery,
  keyRegistryGas, readKeyRegistry, senderFieldsFor,
  sampleBlockRate, estimateRecoveryWindow,
  MIN_ROTATION_GAP, RECOVERY_DELAY_BLOCKS, RECOVERY_COOLDOWN_BLOCKS,
  type KeyRegistryRecord, type GuardianApproval,
} from '../src/key-registry';
import {
  signTransactionMLDSA87, signRotatedTransactionMLDSA87, decodeRLPTransaction, publicKeyToAddress,
  SIGVER_MLDSA_V2, SIGVER_ROTATED,
} from '../src/tx-signer';

// ---------------------------------------------------------------------------
// local byte helpers (independent of the module under test)
// ---------------------------------------------------------------------------
const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};
const bytesToHex = (b: Uint8Array): string =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const cat = (...a: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};
const utf8 = (s: string) => new TextEncoder().encode(s);
const pad32 = (v: bigint) => hexToBytes(v.toString(16).padStart(64, '0'));
const be64 = (v: bigint) => hexToBytes(v.toString(16).padStart(16, '0'));

const GUARDIAN_ENTRY_LEN = 20 + MLDSA87_PUBKEY_BYTES + MLDSA87_SIG_BYTES; // 7239
const CHAIN_ID = 2479;

let mldsa: any;
type Key = { sk: Uint8Array; pk: Uint8Array; addr: string };
const keyCache = new Map<number, Key>();

/** Deterministic ML-DSA-87 key #n. Cached: keygen is ~ms but every test wants several. */
function key(n: number): Key {
  const hit = keyCache.get(n);
  if (hit) return hit;
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 31 + n * 17 + 3) & 0xff;
  const kp = mldsa.keygen(seed);
  const k: Key = { sk: kp.secretKey, pk: kp.publicKey, addr: publicKeyToAddress(kp.publicKey) };
  keyCache.set(n, k);
  return k;
}

beforeAll(async () => {
  // @ts-ignore - bundled JS without types
  const mod: any = await import('../src/noble-post-quantum.js');
  mldsa = (mod.default || mod).ml_dsa87;
});

// ===========================================================================
// selectors
// ===========================================================================
describe('method selectors', () => {
  it('match the exact 4 bytes the node dispatches on', () => {
    // keccak256(signature)[:4] of the strings in genesis/keyregistry/keyregistry.go.
    expect(KEY_REGISTRY_SELECTORS).toEqual({
      rotateKey: '0x4da33cee',
      setGuardians: '0xe94e9e99',
      initiateRecovery: '0xbebcdb45',
      finalizeRecovery: '0x315a7af3',
      cancelRecovery: '0x0ba234d6',
    });
    expect(KEY_REGISTRY_ADDRESS).toBe('0xd200EC0000000000000000000000000000000000');
  });
});

// ===========================================================================
// digests -- rebuilt inline from the Go preimage
// ===========================================================================
describe('signing digests', () => {
  const acc = '0x' + 'ab'.repeat(20);
  const newKeyHash = '0x' + '5c'.repeat(32);
  const binding = { chainId: CHAIN_ID, account: acc, newKeyHash, rotationNonce: 7 };

  const expected = (domain: string) => '0x' + bytesToHex(keccak_256(cat(
    cat(utf8(domain), Uint8Array.of(0x01)),
    pad32(BigInt(CHAIN_ID)),
    hexToBytes(acc),
    hexToBytes(newKeyHash),
    be64(BigInt(7)),
  )));

  it('rotationSigningHash == keccak(domain||pad32(chainId)||acc||keyHash||be64(nonce))', () => {
    expect(rotationSigningHash(binding)).toBe(expected('NEC-KEYREG-ROTATE'));
  });

  it('recoverySigningHash uses a distinct domain, so a rotation proof cannot be replayed as a recovery', () => {
    expect(recoverySigningHash(binding)).toBe(expected('NEC-KEYREG-RECOVER'));
    expect(recoverySigningHash(binding)).not.toBe(rotationSigningHash(binding));
  });

  it('every bound field changes the digest (chainId, account, keyHash, nonce)', () => {
    const base = rotationSigningHash(binding);
    expect(rotationSigningHash({ ...binding, chainId: CHAIN_ID + 1 })).not.toBe(base);
    expect(rotationSigningHash({ ...binding, account: '0x' + 'ac'.repeat(20) })).not.toBe(base);
    expect(rotationSigningHash({ ...binding, newKeyHash: '0x' + '5d'.repeat(32) })).not.toBe(base);
    expect(rotationSigningHash({ ...binding, rotationNonce: 8 })).not.toBe(base);
  });

  it('rejects a newKeyHash that is not 32 bytes', () => {
    expect(() => rotationSigningHash({ ...binding, newKeyHash: '0x1234' })).toThrow(/32 bytes/);
  });
});

// ===========================================================================
// storage slots
// ===========================================================================
describe('registry storage slots', () => {
  const acc = '0x00000000000000000000000000000000cafebabe';

  it('recordBaseSlot == keccak256(leftPad32(addr) ++ pad32(0))', () => {
    const buf = new Uint8Array(64);
    buf.set(hexToBytes(acc), 12);
    expect(recordBaseSlot(acc)).toBe('0x' + bytesToHex(keccak_256(buf)));
  });

  it('scalar field slots are base + offset', () => {
    const base = BigInt(recordBaseSlot(acc));
    for (const [name, off] of Object.entries(REG_OFF)) {
      expect(registrySlot(acc, off as number)).toBe(
        '0x' + bytesToHex(pad32(base + BigInt(off as number))));
      expect(name).toBeTruthy();
    }
    // currentKeyHash sits exactly at the record base -- what the node's live E2E reads.
    expect(registrySlot(acc, REG_OFF.currentKeyHash)).toBe(recordBaseSlot(acc));
  });

  it('guardian i lives at keccak256(fieldSlot(base, guardianCount)) + i', () => {
    const arrBase = BigInt('0x' + bytesToHex(
      keccak_256(hexToBytes(registrySlot(acc, REG_OFF.guardianCount)))));
    expect(guardianSlot(acc, 0)).toBe('0x' + bytesToHex(pad32(arrBase)));
    expect(guardianSlot(acc, 5)).toBe('0x' + bytesToHex(pad32(arrBase + BigInt(5))));
  });
});

// ===========================================================================
// calldata layouts -- exact offsets
// ===========================================================================
describe('rotateKey calldata', () => {
  it('is selector || newPubKey(2592) || newKeySig(4627), and the PoP verifies over the rotation digest', async () => {
    const acc = key(1).addr;
    const nk = key(2);
    const proof = await signRotationProof(nk.sk, { chainId: CHAIN_ID, account: acc, rotationNonce: 0 });

    const cd = hexToBytes(encodeRotateKey(proof));
    expect(cd.length).toBe(4 + MLDSA87_PUBKEY_BYTES + MLDSA87_SIG_BYTES); // 7223
    expect('0x' + bytesToHex(cd.slice(0, 4))).toBe(KEY_REGISTRY_SELECTORS.rotateKey);

    const pub = cd.slice(4, 4 + MLDSA87_PUBKEY_BYTES);
    const sig = cd.slice(4 + MLDSA87_PUBKEY_BYTES);
    expect(bytesToHex(pub)).toBe(bytesToHex(nk.pk));
    expect(sig.length).toBe(MLDSA87_SIG_BYTES);

    // The bytes on the wire must verify against the digest the node will recompute for THIS account
    // and rotationNonce -- not against whatever the signer happened to sign.
    const digest = rotationSigningHash({
      chainId: CHAIN_ID, account: acc, newKeyHash: keyHashOf(pub), rotationNonce: 0,
    });
    expect(mldsa.verify(pub, hexToBytes(digest), sig)).toBe(true);
    // and must NOT verify under the wrong nonce or the recovery domain
    expect(mldsa.verify(pub, hexToBytes(rotationSigningHash({
      chainId: CHAIN_ID, account: acc, newKeyHash: keyHashOf(pub), rotationNonce: 1 })), sig)).toBe(false);
    expect(mldsa.verify(pub, hexToBytes(recoverySigningHash({
      chainId: CHAIN_ID, account: acc, newKeyHash: keyHashOf(pub), rotationNonce: 0 })), sig)).toBe(false);
  });

  it('refuses a public key or signature of the wrong length rather than emitting calldata the node will slice wrong', () => {
    const good = { newPublicKey: '0x' + '11'.repeat(MLDSA87_PUBKEY_BYTES), newKeySignature: '0x' + '22'.repeat(MLDSA87_SIG_BYTES) };
    expect(() => encodeRotateKey({ ...good, newPublicKey: '0x' + '11'.repeat(64) })).toThrow(/2592 raw bytes/);
    expect(() => encodeRotateKey({ ...good, newKeySignature: '0x' + '22'.repeat(64) })).toThrow(/4627 bytes/);
  });
});

describe('setGuardians calldata', () => {
  it('is selector || threshold(1) || count(1) || count*address(20)', () => {
    const gs = [key(3).addr, key(4).addr, key(5).addr];
    const cd = hexToBytes(encodeSetGuardians({ threshold: 2, guardians: gs }));
    expect(cd.length).toBe(4 + 2 + 3 * 20);
    expect('0x' + bytesToHex(cd.slice(0, 4))).toBe(KEY_REGISTRY_SELECTORS.setGuardians);
    expect(cd[4]).toBe(2); // threshold M
    expect(cd[5]).toBe(3); // count N
    for (let i = 0; i < 3; i++) {
      expect('0x' + bytesToHex(cd.slice(6 + i * 20, 6 + (i + 1) * 20))).toBe(gs[i]);
    }
  });

  it('threshold 0 with an empty set is the documented "disable recovery" call', () => {
    const cd = hexToBytes(encodeSetGuardians({ threshold: 0, guardians: [] }));
    expect(cd.length).toBe(6);
    expect(cd[4]).toBe(0);
    expect(cd[5]).toBe(0);
  });

  it('rejects what the chain would revert on: threshold > count, and more than MAX_GUARDIANS', () => {
    expect(() => encodeSetGuardians({ threshold: 2, guardians: [key(3).addr] })).toThrow(/exceeds guardian count/);
    const many = Array.from({ length: MAX_GUARDIANS + 1 }, (_, i) => '0x' + i.toString(16).padStart(40, '0'));
    expect(() => encodeSetGuardians({ threshold: 1, guardians: many })).toThrow(/MAX_GUARDIANS/);
  });
});

describe('initiateRecovery calldata', () => {
  it('packs the header then one 7239-byte entry per guardian, each signature over the shared recovery digest', async () => {
    const acc = key(1).addr;
    const nk = key(6);
    const g1 = key(7), g2 = key(8);
    const rotationNonce = 3;

    const pop = await signRecoveryProof(nk.sk, { chainId: CHAIN_ID, account: acc, rotationNonce });
    const binding = { chainId: CHAIN_ID, account: acc, newKeyHash: pop.newKeyHash, rotationNonce };
    const approvals: GuardianApproval[] = [
      await signGuardianApproval(g1.sk, binding),
      await signGuardianApproval(g2.sk, binding),
    ];

    const cd = hexToBytes(encodeInitiateRecovery({ account: acc, ...pop, approvals }));
    const HDR = 4 + 20 + MLDSA87_PUBKEY_BYTES + MLDSA87_SIG_BYTES + 1; // 7244
    expect(cd.length).toBe(HDR + 2 * GUARDIAN_ENTRY_LEN);

    expect('0x' + bytesToHex(cd.slice(0, 4))).toBe(KEY_REGISTRY_SELECTORS.initiateRecovery);
    expect('0x' + bytesToHex(cd.slice(4, 24))).toBe(acc);
    const newPub = cd.slice(24, 24 + MLDSA87_PUBKEY_BYTES);
    const newSig = cd.slice(24 + MLDSA87_PUBKEY_BYTES, HDR - 1);
    expect(bytesToHex(newPub)).toBe(bytesToHex(nk.pk));
    expect(cd[HDR - 1]).toBe(2); // gcount

    // The single digest everyone signs.
    const digest = hexToBytes(recoverySigningHash({
      chainId: CHAIN_ID, account: acc, newKeyHash: keyHashOf(newPub), rotationNonce,
    }));
    expect(mldsa.verify(newPub, digest, newSig)).toBe(true); // new-key proof-of-possession

    for (const [i, g] of [g1, g2].entries()) {
      const p = HDR + i * GUARDIAN_ENTRY_LEN;
      expect('0x' + bytesToHex(cd.slice(p, p + 20))).toBe(g.addr);
      const gPub = cd.slice(p + 20, p + 20 + MLDSA87_PUBKEY_BYTES);
      const gSig = cd.slice(p + 20 + MLDSA87_PUBKEY_BYTES, p + GUARDIAN_ENTRY_LEN);
      expect(bytesToHex(gPub)).toBe(bytesToHex(g.pk));
      expect(mldsa.verify(gPub, digest, gSig)).toBe(true);
      // A guardian's approval is bound to this account: it must not verify for another one.
      const other = hexToBytes(recoverySigningHash({
        chainId: CHAIN_ID, account: key(9).addr, newKeyHash: keyHashOf(newPub), rotationNonce }));
      expect(mldsa.verify(gPub, other, gSig)).toBe(false);
    }
  });

  it('carries a rotated guardian\'s REGISTERED address, not the address its current key derives', async () => {
    const acc = key(1).addr;
    const registeredAddr = key(10).addr;   // the address the account registered as a guardian
    const rotatedKey = key(11);            // that guardian later rotated to this key
    expect(rotatedKey.addr).not.toBe(registeredAddr);

    const approval = await signGuardianApproval(
      rotatedKey.sk,
      { chainId: CHAIN_ID, account: acc, newKeyHash: '0x' + '77'.repeat(32), rotationNonce: 0 },
      registeredAddr,
    );
    expect(approval.address).toBe(registeredAddr);
    expect(approval.publicKey).toBe('0x' + bytesToHex(rotatedKey.pk));
    // default (no explicit address) falls back to the derived one -- correct only for an unrotated guardian
    const derivedApproval = await signGuardianApproval(
      rotatedKey.sk, { chainId: CHAIN_ID, account: acc, newKeyHash: '0x' + '77'.repeat(32), rotationNonce: 0 });
    expect(derivedApproval.address).toBe(rotatedKey.addr);
  });

  it('refuses zero approvals and an oversized approval set', () => {
    const stub = {
      account: key(1).addr,
      newPublicKey: '0x' + '11'.repeat(MLDSA87_PUBKEY_BYTES),
      newKeySignature: '0x' + '22'.repeat(MLDSA87_SIG_BYTES),
    };
    expect(() => encodeInitiateRecovery({ ...stub, approvals: [] })).toThrow(/at least one guardian/);
    const one: GuardianApproval = {
      address: key(3).addr,
      publicKey: '0x' + '33'.repeat(MLDSA87_PUBKEY_BYTES),
      signature: '0x' + '44'.repeat(MLDSA87_SIG_BYTES),
    };
    expect(() => encodeInitiateRecovery({ ...stub, approvals: Array(MAX_GUARDIANS + 1).fill(one) }))
      .toThrow(/MAX_GUARDIANS/);
  });
});

describe('finalizeRecovery / cancelRecovery calldata', () => {
  it('are the selector plus (only) the account, and the selector alone', () => {
    const acc = key(1).addr;
    expect(encodeFinalizeRecovery(acc)).toBe(KEY_REGISTRY_SELECTORS.finalizeRecovery + acc.slice(2));
    expect(hexToBytes(encodeFinalizeRecovery(acc)).length).toBe(24);
    expect(encodeCancelRecovery()).toBe(KEY_REGISTRY_SELECTORS.cancelRecovery);
    expect(hexToBytes(encodeCancelRecovery()).length).toBe(4);
  });
});

describe('gas', () => {
  it('mirrors the precompile\'s own charges', () => {
    expect(keyRegistryGas('rotateKey')).toBe(1_500_000 + 3 * 20_000);
    expect(keyRegistryGas('setGuardians', 3)).toBe((2 + 3) * 20_000);
    expect(keyRegistryGas('initiateRecovery', 2)).toBe(1_500_000 * 3 + 3 * 20_000);
    expect(keyRegistryGas('finalizeRecovery')).toBe(6 * 20_000);
    expect(keyRegistryGas('cancelRecovery')).toBe(6 * 20_000);
  });
});

// ===========================================================================
// registry reader
// ===========================================================================
describe('readKeyRegistry', () => {
  it('reads each field from the slot the node writes it to', async () => {
    const acc = key(1).addr;
    const g1 = key(3).addr, g2 = key(4).addr, g3 = key(5).addr;
    const word = (v: number | string) =>
      typeof v === 'number' ? '0x' + v.toString(16).padStart(64, '0') : v;
    const store: Record<string, string> = {
      [registrySlot(acc, REG_OFF.currentKeyHash)]: '0x' + 'ab'.repeat(32),
      [registrySlot(acc, REG_OFF.rotatedAt)]: word(4242),
      [registrySlot(acc, REG_OFF.rotationNonce)]: word(2),
      // deliberately DIFFERENT so a reader that swapped these two slots is caught
      [registrySlot(acc, REG_OFF.guardianThreshold)]: word(2),
      [registrySlot(acc, REG_OFF.guardianCount)]: word(3),
      [registrySlot(acc, REG_OFF.pendingKeyHash)]: '0x' + 'cd'.repeat(32),
      [registrySlot(acc, REG_OFF.pendingEffectiveBlock)]: word(263442),
      [registrySlot(acc, REG_OFF.pendingNonce)]: word(2),
      [registrySlot(acc, REG_OFF.recoveryCooldownUntil)]: word(9),
      [guardianSlot(acc, 0)]: '0x' + '00'.repeat(12) + g1.slice(2),
      [guardianSlot(acc, 1)]: '0x' + '00'.repeat(12) + g2.slice(2),
      [guardianSlot(acc, 2)]: '0x' + '00'.repeat(12) + g3.slice(2),
    };
    const asked: string[] = [];
    const provider = {
      async getStorageAt(address: string, position: string): Promise<string> {
        expect(address).toBe(KEY_REGISTRY_ADDRESS);
        asked.push(position);
        return store[position] ?? '0x' + '0'.repeat(64);
      },
    };

    const rec = await readKeyRegistry(provider, acc);
    expect(rec).toEqual({
      account: acc.toLowerCase(),
      currentKeyHash: '0x' + 'ab'.repeat(32),
      rotated: true,
      rotatedAt: 4242,
      rotationNonce: 2,
      guardianThreshold: 2,
      guardianCount: 3,
      guardians: [g1, g2, g3],
      pendingKeyHash: '0x' + 'cd'.repeat(32),
      pendingEffectiveBlock: 263442,
      pendingNonce: 2,
      recoveryCooldownUntil: 9,
    });
    // 9 scalar fields + 3 guardian entries, all at the slots the node uses.
    expect(asked.length).toBe(12);
    expect(new Set(asked).size).toBe(12);
  });

  it('reports a never-rotated account as legacy identity, not as key hash zero', async () => {
    const provider = { async getStorageAt() { return '0x' + '0'.repeat(64); } };
    const rec = await readKeyRegistry(provider, key(1).addr);
    expect(rec.rotated).toBe(false);
    expect(rec.currentKeyHash).toBeNull();
    expect(rec.pendingKeyHash).toBeNull();
    expect(rec.guardianThreshold).toBe(0); // recovery disabled until guardians are set
    expect(rec.guardians).toEqual([]);
  });
});

// ===========================================================================
// THE MODEL-B INVARIANT: rotation must not change the address
// ===========================================================================
describe('Model B: the address survives rotation', () => {
  const rec = (over: Partial<KeyRegistryRecord>): KeyRegistryRecord => ({
    account: key(1).addr, currentKeyHash: null, rotated: false, rotatedAt: 0, rotationNonce: 0,
    guardianThreshold: 0, guardianCount: 0, guardians: [], pendingKeyHash: null,
    pendingEffectiveBlock: 0, pendingNonce: 0, recoveryCooldownUntil: 0, ...over,
  });

  it('unrotated: sign as the derived address with sigVer 2', () => {
    const k = key(1);
    expect(senderFieldsFor(rec({}), k.pk)).toEqual({ from: k.addr, sigVer: SIGVER_MLDSA_V2 });
  });

  it('rotated: the SAME address, sigVer 3 -- never the address the new key derives', () => {
    const account = key(1).addr;
    const newKey = key(12);
    expect(newKey.addr).not.toBe(account); // the new key derives somewhere else entirely
    const out = senderFieldsFor(rec({ rotated: true, currentKeyHash: keyHashOf(newKey.pk) }), newKey.pk);
    expect(out).toEqual({ from: account, sigVer: SIGVER_ROTATED });
    expect(out.from).toBe(account);        // the balance-bearing address
    expect(out.from).not.toBe(newKey.addr); // the account-destroying one
  });

  it('refuses a key that is not the account\'s, in both branches', () => {
    expect(() => senderFieldsFor(rec({}), key(12).pk)).toThrow(/does not control/);
    expect(() => senderFieldsFor(
      rec({ rotated: true, currentKeyHash: keyHashOf(key(12).pk) }), key(13).pk))
      .toThrow(/not the registered key/);
  });
});

// ===========================================================================
// rotated-account transaction signing -- assert on the raw RLP that ships
// ===========================================================================
describe('rotated-account transaction bytes', () => {
  const tx = {
    nonce: 5, gasPrice: '0x3b9aca00', gas: '0x5208',
    to: '0x' + '44'.repeat(20), value: '0x0de0b6b3a7640000', data: '0x', chainId: CHAIN_ID,
  };

  it('claims the STABLE account address and sigVer 3, and the signature covers both', async () => {
    const account = key(1).addr;   // the account, whose key was rotated away
    const newKey = key(12);        // the key it rotated TO
    const skHex = bytesToHex(newKey.sk);

    const signed = await signRotatedTransactionMLDSA87(tx, skHex, account);
    const raw = hexToBytes(signed.raw);
    const d = decodeRLPTransaction(signed.raw);

    // Wire order is [nonce, gasPrice, gas, to, value, data, sig, pubKey, chainId, from, sigVer].
    expect(String(d.from).toLowerCase()).toBe(account.toLowerCase());
    expect(d.sigVer).toBe('3');
    expect(d.publicKey).toBe('0x' + bytesToHex(newKey.pk));
    expect(d.chainId).toBe(String(CHAIN_ID));
    // The trailing 22 bytes of the RLP are literally 0x94 (a 20-byte string header) || from(20)
    // || 0x03 (sigVer, a single byte < 0x80 is its own encoding).
    expect(raw[raw.length - 1]).toBe(0x03);
    expect(raw[raw.length - 22]).toBe(0x94);
    expect(bytesToHex(raw.slice(raw.length - 21, raw.length - 1))).toBe(account.slice(2));

    // The signature must verify over keccak(RLP([sigVer, from, nonce, gasPrice, gas, to, value,
    // data, chainId])) -- rebuilt here so a change to either leading field is caught.
    const rlp = require('../src/tx-signer').__test.rlpEncode;
    const min = (v: bigint) => v === BigInt(0) ? new Uint8Array(0)
      : hexToBytes(v.toString(16).length % 2 ? '0' + v.toString(16) : v.toString(16));
    const digest = keccak_256(rlp([
      Uint8Array.of(3), hexToBytes(account), min(BigInt(5)), min(BigInt('0x3b9aca00')),
      min(BigInt('0x5208')), hexToBytes(tx.to), min(BigInt('0x0de0b6b3a7640000')),
      new Uint8Array(0), min(BigInt(CHAIN_ID)),
    ]));
    expect(mldsa.verify(newKey.pk, digest, hexToBytes(signed.signature))).toBe(true);

    // Same digest with sigVer 2 must NOT verify: the scheme version is bound.
    const digestV2 = keccak_256(rlp([
      Uint8Array.of(2), hexToBytes(account), min(BigInt(5)), min(BigInt('0x3b9aca00')),
      min(BigInt('0x5208')), hexToBytes(tx.to), min(BigInt('0x0de0b6b3a7640000')),
      new Uint8Array(0), min(BigInt(CHAIN_ID)),
    ]));
    expect(mldsa.verify(newKey.pk, digestV2, hexToBytes(signed.signature))).toBe(false);
  });

  it('the default path is unchanged: derived address, sigVer 2', async () => {
    const k = key(2);
    const d = decodeRLPTransaction((await signTransactionMLDSA87(tx, bytesToHex(k.sk))).raw);
    expect(d.sigVer).toBe('2');
    expect(String(d.from).toLowerCase()).toBe(k.addr.toLowerCase());
  });

  it('an explicit from that differs from the derived address defaults to sigVer 3', async () => {
    const d = decodeRLPTransaction((await signTransactionMLDSA87(tx, bytesToHex(key(2).sk), {
      from: key(1).addr,
    })).raw);
    expect(d.sigVer).toBe('3');
    expect(String(d.from).toLowerCase()).toBe(key(1).addr.toLowerCase());
  });

  it('rejects a malformed from and a sigVer the node would refuse', async () => {
    await expect(signTransactionMLDSA87(tx, bytesToHex(key(2).sk), { from: '0xdeadbeef' }))
      .rejects.toThrow(/invalid "from" address length/);
    await expect(signTransactionMLDSA87(tx, bytesToHex(key(2).sk), { sigVer: 1 }))
      .rejects.toThrow(/invalid sigVer/);
  });
});


// ===========================================================================
// Signer.sendTransaction: the nonce belongs to the account that SIGNS
// ===========================================================================
//
// The node validates the nonce of the address the transaction was SIGNED as: preCheck reads
// `st.state.GetNonce(st.msg.From())` (ncogearthchain/evmcore/state_transition.go) and `From()` is
// `types.Sender()`'s return, i.e. the signed ClaimedFrom (ncog-evm/core/types/transaction_signing.go
// step 6). So these tests never assert that a mock was called: they decode the RAW BYTES the Signer
// handed to eth_sendRawTransaction and require the address whose nonce was fetched to be the `from`
// carried IN THOSE BYTES. Reading the nonce for any other identity -- a caller-supplied `from`, a
// data address, the address a rotated account's new key derives -- fails these tests, and would fail
// on-chain as "nonce too low" the moment the signing account had sent anything of its own.

/** Records every address a nonce was requested for and every raw tx submitted. No jest mocks. */
class RecordingProvider {
  nonceAskedFor: string[] = [];
  sentRaw: string[] = [];
  constructor(private nonces: Record<string, number> = {}) {}
  async getChainId(): Promise<number> { return CHAIN_ID; }
  async getGasPrice(): Promise<string> { return '0x3b9aca00'; }
  async getTransactionCount(address: string): Promise<number> {
    const a = String(address).toLowerCase();
    this.nonceAskedFor.push(a);
    return this.nonces[a] ?? 0;
  }
  async callRpc(method: string, params: any[]): Promise<any> {
    if (method !== 'eth_sendRawTransaction') throw new Error(`unexpected rpc ${method}`);
    this.sentRaw.push(params[0]);
    return { result: '0x' + 'ab'.repeat(32) };
  }
}

// Both builds carry the same Signer, and the browser one had never been unit-tested; the defect this
// pins was present in BOTH copies, so both are driven here.
const signerBuilds: Array<{ name: string; load: () => Promise<any> }> = [
  { name: 'src/wallet.ts (node/react-native)', load: () => import('../src/wallet') },
  { name: 'src/wallet.browser.ts (browser)', load: () => import('../src/wallet.browser') },
];

describe.each(signerBuilds)('Signer.sendTransaction nonce binding -- $name', ({ load }) => {
  const baseTx = { to: '0x' + '44'.repeat(20), value: '1', gas: '0x5208', data: '0x' };

  it('ROTATED account: the nonce is read for the SIGNED account, never for the address the new key derives', async () => {
    const { Wallet } = await load();
    const account = key(1).addr;   // the stable account: holds the balance and the real nonce
    const newKey = key(12);        // the key it rotated TO; derives a DIFFERENT, empty address
    expect(newKey.addr.toLowerCase()).not.toBe(account.toLowerCase()); // the whole premise

    const provider = new RecordingProvider({ [account.toLowerCase()]: 7, [newKey.addr.toLowerCase()]: 0 });
    const wallet = await Wallet.createRotated(bytesToHex(newKey.sk), account);
    await wallet.connect(provider as any).sendTransaction({ ...baseTx } as any);

    // Decode what actually went on the wire.
    expect(provider.sentRaw).toHaveLength(1);
    const d = decodeRLPTransaction(provider.sentRaw[0]);
    expect(String(d.from).toLowerCase()).toBe(account.toLowerCase());
    expect(d.sigVer).toBe('3');
    expect(d.publicKey).toBe('0x' + bytesToHex(newKey.pk));

    // THE PROPERTY: exactly one nonce lookup, and it was for the address in the signed bytes.
    expect(provider.nonceAskedFor).toEqual([String(d.from).toLowerCase()]);
    // Stated the other way round, so a regression names the wrong account out loud.
    expect(provider.nonceAskedFor).not.toContain(newKey.addr.toLowerCase());
    // ...and the value fetched for that account is the one that was signed.
    expect(d.nonce).toBe('7');
  });

  it('a caller-supplied `from` that is not this wallet is refused, not silently used for the nonce', async () => {
    const { Wallet } = await load();
    const account = key(1).addr;
    const newKey = key(12);
    const provider = new RecordingProvider({ [account.toLowerCase()]: 7 });
    const wallet = await Wallet.createRotated(bytesToHex(newKey.sk), account);
    const signer = wallet.connect(provider as any);

    // The natural call for someone holding only the new key: pass the address that key derives.
    await expect(signer.sendTransaction({ ...baseTx, from: newKey.addr } as any))
      .rejects.toThrow(/is not this wallet's account/);
    // A dApp-supplied third-party `from` is refused the same way.
    await expect(signer.sendTransaction({ ...baseTx, from: '0x' + '99'.repeat(20) } as any))
      .rejects.toThrow(/is not this wallet's account/);
    // Nothing was sent and no foreign nonce was read.
    expect(provider.sentRaw).toEqual([]);
    expect(provider.nonceAskedFor).toEqual([]);
  });

  it('the wallet own address is accepted as `from` in any case, and is what the nonce is read for', async () => {
    const { Wallet } = await load();
    const account = key(1).addr;
    const provider = new RecordingProvider({ [account.toLowerCase()]: 3 });
    const wallet = await Wallet.createRotated(bytesToHex(key(12).sk), account);
    // Checksum-ish / upper-case input must not be read as a different account.
    await wallet.connect(provider as any)
      .sendTransaction({ ...baseTx, from: '0x' + account.slice(2).toUpperCase() } as any);
    const d = decodeRLPTransaction(provider.sentRaw[0]);
    expect(provider.nonceAskedFor).toEqual([String(d.from).toLowerCase()]);
    expect(d.nonce).toBe('3');
  });

  it('UNROTATED account: same property -- the nonce follows the signed from', async () => {
    const { Wallet } = await load();
    const k = key(2);
    const provider = new RecordingProvider({ [k.addr.toLowerCase()]: 11 });
    const wallet = await Wallet.create(bytesToHex(k.sk));
    await wallet.connect(provider as any).sendTransaction({ ...baseTx } as any);
    const d = decodeRLPTransaction(provider.sentRaw[0]);
    expect(String(d.from).toLowerCase()).toBe(k.addr.toLowerCase());
    expect(d.sigVer).toBe('2');
    expect(provider.nonceAskedFor).toEqual([String(d.from).toLowerCase()]);
    expect(d.nonce).toBe('11');
    // and the rest of the bytes are the caller's: 1 NEC in wei, the given recipient.
    expect(d.value).toBe('0x0de0b6b3a7640000');
    expect(String(d.to).toLowerCase()).toBe(baseTx.to);
  });

  it('an explicit nonce of 0 is a real nonce: it is signed as 0 and no lookup is made', async () => {
    const { Wallet } = await load();
    const k = key(2);
    // A stale/other nonce is on offer; if the Signer fetched, it would sign 9 instead of 0.
    const provider = new RecordingProvider({ [k.addr.toLowerCase()]: 9 });
    const wallet = await Wallet.create(bytesToHex(k.sk));
    await wallet.connect(provider as any).sendTransaction({ ...baseTx, nonce: 0 } as any);
    expect(provider.nonceAskedFor).toEqual([]);
    expect(decodeRLPTransaction(provider.sentRaw[0]).nonce).toBe('0');
  });
});

// ===========================================================================
// block-rate helpers: the recovery window is a BLOCK count, so measure the rate
// ===========================================================================
describe('sampleBlockRate / estimateRecoveryWindow', () => {
  /** Timestamps as the node serves them; Provider normalizes hex to decimal strings, so serve both. */
  const stubProvider = (head: number, ts: Record<number, number>, decimalStrings = false) => ({
    async getBlockNumber() { return decimalStrings ? String(head) : '0x' + head.toString(16); },
    async getBlockByNumber(tag: string) {
      const n = Number(BigInt(tag));
      if (!(n in ts)) return null;
      return { timestamp: decimalStrings ? String(ts[n]) : '0x' + ts[n].toString(16) };
    },
  });

  it('divides the timestamp span by the block span', async () => {
    const s = await sampleBlockRate(stubProvider(6425, { 5425: 1788059335, 6425: 1788667756 }) as any, 1000);
    expect(s).toEqual({
      headBlock: 6425, fromBlock: 5425, blocks: 1000, seconds: 608421, secondsPerBlock: 608.421,
    });
  });

  it('reads decimal-normalized fields too (what Provider actually returns)', async () => {
    const s = await sampleBlockRate(stubProvider(100, { 90: 1000, 100: 1100 }, true) as any, 10);
    expect(s.secondsPerBlock).toBe(10);
  });

  it('clamps the window to the chain length instead of asking for a negative block', async () => {
    const s = await sampleBlockRate(stubProvider(5, { 0: 0, 5: 50 }) as any, 1000);
    expect({ from: s.fromBlock, blocks: s.blocks, spb: s.secondsPerBlock }).toEqual({ from: 0, blocks: 5, spb: 10 });
  });

  it('refuses to invent a rate it cannot measure', async () => {
    await expect(sampleBlockRate(stubProvider(0, { 0: 1 }) as any)).rejects.toThrow(/no interval/);
    await expect(sampleBlockRate(stubProvider(10, { 0: 5, 10: 5 }) as any, 10)).rejects.toThrow(/non-increasing/);
    await expect(sampleBlockRate(stubProvider(10, { 10: 5 }) as any, 10)).rejects.toThrow(/not found/);
  });

  it('converts the timing constants with the MEASURED rate, not a hardcoded 1s/block', async () => {
    const e = await estimateRecoveryWindow(stubProvider(6425, { 5425: 1788059335, 6425: 1788667756 }) as any, 1000);
    expect(e.secondsPerBlock).toBe(608.421);
    expect(e.recoveryDelaySeconds).toBe(RECOVERY_DELAY_BLOCKS * 608.421);
    expect(e.recoveryCooldownSeconds).toBe(RECOVERY_COOLDOWN_BLOCKS * 608.421);
    expect(e.minRotationGapSeconds).toBe(MIN_ROTATION_GAP * 608.421);
    // The point of the whole helper: at this measured rate the window is years, not the 72 hours the
    // node's comment implies. 259200 blocks * 608.421 s = 1825.3 days.
    expect(e.recoveryDelayDays).toBeCloseTo(1825.26, 1);
    expect(e.recoveryDelayDays).toBeGreaterThan(365);
    // A 1 s/block chain is what "72h" assumes; the helper reports that too when it is true.
    const fast = await estimateRecoveryWindow(stubProvider(1000, { 0: 0, 1000: 1000 }) as any, 1000);
    expect(fast.recoveryDelayDays).toBeCloseTo(3, 6);
  });
});

// ===========================================================================
// LIVE: the deployed node validates the JS-built bytes with its own Go verifier
// ===========================================================================
const LIVE_RPC = process.env.NEC_LIVE_RPC;
const liveDescribe = LIVE_RPC ? describe : describe.skip;

liveDescribe('LIVE deployed node accepts the SDK calldata (eth_call)', () => {
  jest.setTimeout(180000);
  let chainId = 0;

  const rpc = async (method: string, params: any[]) => {
    const r = await fetch(LIVE_RPC as string, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return r.json() as any;
  };
  /** eth_call the registry; returns null on success, or the node's error message. */
  const callRegistry = async (from: string, data: string, gas: number, overrides?: any) => {
    const params: any[] = [{ from, to: KEY_REGISTRY_ADDRESS, data, gas: '0x' + gas.toString(16) }, 'latest'];
    if (overrides) params.push(overrides);
    const res = await rpc('eth_call', params);
    return res.error ? String(res.error.message) : null;
  };
  const word = (v: number) => '0x' + v.toString(16).padStart(64, '0');
  const addrWord = (a: string) => '0x' + '00'.repeat(12) + a.slice(2).toLowerCase();

  beforeAll(async () => {
    chainId = parseInt((await rpc('eth_chainId', [])).result, 16);
    // eslint-disable-next-line no-console
    console.log('LIVE rpc=%s chainId=%d clientVersion=%s',
      LIVE_RPC, chainId, (await rpc('web3_clientVersion', [])).result);
  });

  it('the registry address is the precompile, not a plain account', async () => {
    // Short input reverts at the precompile's dispatch; the same input to an EOA succeeds.
    expect(await callRegistry(key(1).addr, '0x00', 100000)).toMatch(/reverted/);
    const res = await rpc('eth_call', [{ from: key(1).addr, to: '0x' + '11'.repeat(20), data: '0x00' }, 'latest']);
    expect(res.result).toBe('0x');
  });

  it('accepts a rotateKey built by the SDK -- the node re-derives the digest and verifies the ML-DSA PoP itself', async () => {
    const acc = key(20).addr; // fresh, never rotated => rotationNonce 0, no cooldown
    const nk = key(21);
    const good = await signRotationProof(nk.sk, { chainId, account: acc, rotationNonce: 0 });
    const data = encodeRotateKey(good);
    const err = await callRegistry(acc, data, 6_000_000);
    // eslint-disable-next-line no-console
    console.log('LIVE rotateKey ->', err ?? 'accepted');
    expect(err).toBeNull();

    // ...and what it costs, from the node instead of from arithmetic in a comment. keyRegistryGas
    // covers only the precompile's own charge; a caller sizing a transaction also pays the intrinsic
    // cost of 7223 calldata bytes, which is most of the difference people get wrong.
    const bytes = hexToBytes(data);
    let zeroBytes = 0;
    for (const b of bytes) if (b === 0) zeroBytes++;
    const intrinsic = 21000 + 16 * (bytes.length - zeroBytes) + 4 * zeroBytes;
    const predicted = keyRegistryGas('rotateKey') + intrinsic;
    const measured = parseInt(String((await rpc('eth_estimateGas',
      [{ from: acc, to: KEY_REGISTRY_ADDRESS, data }, 'latest'])).result), 16);
    // eslint-disable-next-line no-console
    console.log('LIVE rotateKey gas: %d calldata bytes (%d zero) -> intrinsic %d + precompile %d = %d ; eth_estimateGas %d',
      bytes.length, zeroBytes, intrinsic, keyRegistryGas('rotateKey'), predicted, measured);
    expect(bytes.length).toBe(4 + MLDSA87_PUBKEY_BYTES + MLDSA87_SIG_BYTES);
    expect(measured).toBe(predicted);
    // One gas less is genuinely not enough -- the boundary is real, not a rounded "budget ~6M".
    expect(await callRegistry(acc, data, predicted - 1)).toMatch(/out of gas/);
    expect(await callRegistry(acc, data, predicted)).toBeNull();
  });

  it('rejects a rotateKey whose PoP is bound to the wrong nonce, account or domain', async () => {
    const acc = key(20).addr;
    const nk = key(21);
    const wrongNonce = await signRotationProof(nk.sk, { chainId, account: acc, rotationNonce: 1 });
    const wrongAcc = await signRotationProof(nk.sk, { chainId, account: key(22).addr, rotationNonce: 0 });
    const wrongDomain = await signRecoveryProof(nk.sk, { chainId, account: acc, rotationNonce: 0 });
    expect(await callRegistry(acc, encodeRotateKey(wrongNonce), 6_000_000)).toMatch(/reverted/);
    expect(await callRegistry(acc, encodeRotateKey(wrongAcc), 6_000_000)).toMatch(/reverted/);
    expect(await callRegistry(acc, encodeRotateKey(wrongDomain), 6_000_000)).toMatch(/reverted/);
  });

  it('accepts setGuardians / cancelRecovery, and reverts finalizeRecovery with nothing pending', async () => {
    const acc = key(20).addr;
    expect(await callRegistry(acc, encodeSetGuardians({ threshold: 2, guardians: [key(23).addr, key(24).addr, key(25).addr] }), 500_000)).toBeNull();
    expect(await callRegistry(acc, encodeCancelRecovery(), 500_000)).toBeNull();
    expect(await callRegistry(acc, encodeFinalizeRecovery(acc), 500_000)).toMatch(/reverted/);
  });

  it('accepts an M-of-N initiateRecovery against staged guardian state, and reverts one signature short', async () => {
    const acc = key(30).addr;
    const nk = key(31);
    const g1 = key(32), g2 = key(33);
    const rotationNonce = 0;

    // Stage 2-of-2 guardians in the registry's storage for this eth_call only.
    const overrides = {
      [KEY_REGISTRY_ADDRESS]: {
        stateDiff: {
          [registrySlot(acc, REG_OFF.guardianThreshold)]: word(2),
          [registrySlot(acc, REG_OFF.guardianCount)]: word(2),
          [guardianSlot(acc, 0)]: addrWord(g1.addr),
          [guardianSlot(acc, 1)]: addrWord(g2.addr),
        },
      },
    };

    const pop = await signRecoveryProof(nk.sk, { chainId, account: acc, rotationNonce });
    const binding = { chainId, account: acc, newKeyHash: pop.newKeyHash, rotationNonce };
    const a1 = await signGuardianApproval(g1.sk, binding);
    const a2 = await signGuardianApproval(g2.sk, binding);

    const full = encodeInitiateRecovery({ account: acc, ...pop, approvals: [a1, a2] });
    const errFull = await callRegistry(key(34).addr, full, 30_000_000, overrides);
    // eslint-disable-next-line no-console
    console.log('LIVE initiateRecovery 2-of-2 ->', errFull ?? 'accepted');
    expect(errFull).toBeNull();

    // One short of threshold.
    const short = encodeInitiateRecovery({ account: acc, ...pop, approvals: [a1] });
    expect(await callRegistry(key(34).addr, short, 30_000_000, overrides)).toMatch(/reverted/);

    // An impostor claiming g2's address but signing with its own key: EnforceKeyHash rejects it.
    const imp = key(35);
    const fake: GuardianApproval = { ...(await signGuardianApproval(imp.sk, binding)), address: g2.addr };
    expect(await callRegistry(key(34).addr, encodeInitiateRecovery({ account: acc, ...pop, approvals: [a1, fake] }), 30_000_000, overrides))
      .toMatch(/reverted/);

    // Guardian sigs bound to a stale rotationNonce (what an owner veto produces) are dead.
    const stale = await signRecoveryProof(nk.sk, { chainId, account: acc, rotationNonce: 9 });
    const staleBinding = { chainId, account: acc, newKeyHash: stale.newKeyHash, rotationNonce: 9 };
    const s1 = await signGuardianApproval(g1.sk, staleBinding);
    const s2 = await signGuardianApproval(g2.sk, staleBinding);
    expect(await callRegistry(key(34).addr, encodeInitiateRecovery({ account: acc, ...stale, approvals: [s1, s2] }), 30_000_000, overrides))
      .toMatch(/reverted/);
  });

  it('reverts an initiateRecovery for an account with no guardians configured', async () => {
    const acc = key(36).addr;
    const nk = key(37);
    const pop = await signRecoveryProof(nk.sk, { chainId, account: acc, rotationNonce: 0 });
    const a1 = await signGuardianApproval(key(32).sk, { chainId, account: acc, newKeyHash: pop.newKeyHash, rotationNonce: 0 });
    expect(await callRegistry(key(34).addr, encodeInitiateRecovery({ account: acc, ...pop, approvals: [a1] }), 30_000_000))
      .toMatch(/reverted/);
  });

  it('finalizeRecovery respects the timelock: reverts inside the window, accepted after it', async () => {
    const acc = key(40).addr;
    const head = parseInt((await rpc('eth_blockNumber', [])).result, 16);
    const pendingHash = keyHashOf(key(41).pk);
    const mk = (effectiveBlock: number) => ({
      [KEY_REGISTRY_ADDRESS]: {
        stateDiff: {
          [registrySlot(acc, REG_OFF.pendingKeyHash)]: pendingHash,
          [registrySlot(acc, REG_OFF.pendingEffectiveBlock)]: word(effectiveBlock),
          [registrySlot(acc, REG_OFF.pendingNonce)]: word(0),
        },
      },
    });
    expect(await callRegistry(key(34).addr, encodeFinalizeRecovery(acc), 500_000, mk(head + 1000))).toMatch(/reverted/);
    expect(await callRegistry(key(34).addr, encodeFinalizeRecovery(acc), 500_000, mk(head - 1))).toBeNull();

    // A nonce that moved since initiate (an owner veto) blocks finalize even after the window.
    const vetoed = {
      [KEY_REGISTRY_ADDRESS]: {
        stateDiff: {
          [registrySlot(acc, REG_OFF.pendingKeyHash)]: pendingHash,
          [registrySlot(acc, REG_OFF.pendingEffectiveBlock)]: word(head - 1),
          [registrySlot(acc, REG_OFF.pendingNonce)]: word(0),
          [registrySlot(acc, REG_OFF.rotationNonce)]: word(1),
        },
      },
    };
    expect(await callRegistry(key(34).addr, encodeFinalizeRecovery(acc), 500_000, vetoed)).toMatch(/reverted/);

    // HOW LONG IS THAT WINDOW, on this chain? RECOVERY_DELAY_BLOCKS is a BLOCK count; the node's
    // comment glosses it as "~72h at ~1s/block". Measure the deployed network's actual rate instead
    // of repeating the gloss -- that is the whole reason sampleBlockRate exists.
    const rateProvider = {
      getBlockNumber: async () => (await rpc('eth_blockNumber', [])).result,
      getBlockByNumber: async (t: string) => (await rpc('eth_getBlockByNumber', [t, false])).result,
    };
    const rows: string[] = [];
    for (const w of [50, 200, 1000]) {
      const smp = await sampleBlockRate(rateProvider as any, w);
      rows.push(`  last ${String(smp.blocks).padStart(4)} blocks: ${smp.seconds} s -> ${smp.secondsPerBlock.toFixed(1)} s/block`);
      expect(smp.secondsPerBlock).toBeGreaterThan(0);
    }
    const est = await estimateRecoveryWindow(rateProvider as any, 1000);
    // eslint-disable-next-line no-console
    console.log('LIVE block rate (head %d):\n%s\n  RECOVERY_DELAY_BLOCKS=%d -> %s s = %s days\n  MIN_ROTATION_GAP=%d -> %s min',
      est.sample.headBlock, rows.join('\n'), RECOVERY_DELAY_BLOCKS,
      est.recoveryDelaySeconds.toFixed(0), est.recoveryDelayDays.toFixed(1),
      MIN_ROTATION_GAP, (est.minRotationGapSeconds / 60).toFixed(1));
    // Every figure must come from the measurement, never from a constant baked into the SDK.
    expect(est.recoveryDelaySeconds).toBeCloseTo(RECOVERY_DELAY_BLOCKS * est.sample.secondsPerBlock, 6);
    expect(est.recoveryDelayDays).toBeCloseTo(est.recoveryDelaySeconds / 86400, 6);
    expect(est.minRotationGapSeconds).toBeCloseTo(MIN_ROTATION_GAP * est.sample.secondsPerBlock, 6);
  });

  it('the deployed node accepts an 11-field SigV2 transaction and rejects the 9-field v1 form', async () => {
    // Unfunded: reaching "insufficient funds" proves Sender() (ML-DSA verify + sigVer gate + chainId)
    // accepted the bytes. The v1 form does not even decode.
    const k = key(50);
    const v2 = await signTransactionMLDSA87({
      nonce: 0, gasPrice: '0x2540be400', gas: '0x5208', to: '0x' + '11'.repeat(20),
      value: '0x1', data: '0x', chainId,
    }, bytesToHex(k.sk));
    const res = await rpc('eth_sendRawTransaction', [v2.raw]);
    // eslint-disable-next-line no-console
    console.log('LIVE sendRaw v2 ->', JSON.stringify(res.error ?? res.result));
    expect(String(res.error?.message)).toMatch(/insufficient funds/);
  });

  it('sigVer is a version FLOOR, not the "must be 3" gate the docs used to claim', async () => {
    // The module header used to say a rotated client "must set sigVer 3 or its transactions are
    // rejected". The node has no such rule: Sender()'s only test is `tx.SigVer() < SigVerMLDsaV2`
    // (ncog-evm/core/types/transaction_signing.go) and EnforceKeyHash never reads sigVer at all. This
    // puts that on the wire rather than in a comment. Every tx here is from an UNFUNDED key, so
    // reaching "insufficient funds" is the proof that Sender() ACCEPTED the bytes -- ML-DSA verify,
    // chainId bind and sigVer gate all passed -- while nothing can enter a block.
    const { rlpEncode, intToMinimalBytes } = require('../src/tx-signer').__test;
    const k = key(51);
    const base = {
      nonce: 0, gasPrice: '0x2540be400', gas: '0x5208', to: '0x' + '11'.repeat(20),
      value: '0x1', data: '0x', chainId,
    };

    // sigVer 3 is the scheme a rotated account declares -- and 2, 4 and a meaningless 255 clear
    // Sender() exactly as well, which is what makes "must be 3, or rejected" false.
    for (const sv of [SIGVER_MLDSA_V2, SIGVER_ROTATED, 4, 255]) {
      const signed = await signTransactionMLDSA87(base, bytesToHex(k.sk), { from: k.addr, sigVer: sv });
      expect(decodeRLPTransaction(signed.raw).sigVer).toBe(String(sv));
      const res = await rpc('eth_sendRawTransaction', [signed.raw]);
      // eslint-disable-next-line no-console
      console.log('LIVE sendRaw sigVer=%d -> %s', sv, JSON.stringify(res.error?.message ?? res.result));
      expect(String(res.error?.message)).toMatch(/insufficient funds/);
      expect(String(res.error?.message)).not.toMatch(/signature|sender|version/i);
    }

    // A claimed `from` that is NOT the derived address also clears Sender(): attribution is the
    // claimed from, and authorization is deferred to EnforceKeyHash at execution. This is the half
    // that IS load-bearing, and it works independently of the declared sigVer.
    const foreign = await signTransactionMLDSA87(base, bytesToHex(k.sk),
      { from: key(53).addr, sigVer: SIGVER_MLDSA_V2 });
    const fres = await rpc('eth_sendRawTransaction', [foreign.raw]);
    // eslint-disable-next-line no-console
    console.log('LIVE sendRaw from!=derived,sigVer=2 -> %s', JSON.stringify(fres.error?.message ?? fres.result));
    expect(String(fres.error?.message)).toMatch(/insufficient funds/);

    // The gate that DOES exist is a floor. sigVer 1 is below SigVerMLDsaV2; the SDK refuses to build
    // it, so build the wire by hand -- same 11 fields, same digest construction -- and let the node
    // reject it. Contrast with the four above: this one never reaches the balance check.
    const min = (v: bigint) => v === BigInt(0) ? new Uint8Array(0)
      : hexToBytes(v.toString(16).length % 2 ? '0' + v.toString(16) : v.toString(16));
    const f = {
      sigVer: intToMinimalBytes(BigInt(1)), from: hexToBytes(k.addr), nonce: min(BigInt(0)),
      gasPrice: min(BigInt('0x2540be400')), gas: min(BigInt('0x5208')), to: hexToBytes(base.to),
      value: min(BigInt(1)), data: new Uint8Array(0), chainId: min(BigInt(chainId)),
    };
    const digest1 = keccak_256(rlpEncode(
      [f.sigVer, f.from, f.nonce, f.gasPrice, f.gas, f.to, f.value, f.data, f.chainId]));
    const raw1 = '0x' + bytesToHex(rlpEncode([f.nonce, f.gasPrice, f.gas, f.to, f.value, f.data,
      mldsa.sign(k.sk, digest1), k.pk, f.chainId, f.from, f.sigVer]));
    expect(decodeRLPTransaction(raw1).sigVer).toBe('1'); // a well-formed 11-field tx, just v1
    const r1 = await rpc('eth_sendRawTransaction', [raw1]);
    // eslint-disable-next-line no-console
    console.log('LIVE sendRaw sigVer=1 -> %s', JSON.stringify(r1.error?.message ?? r1.result));
    // The tx-pool reports the Sender() failure as "invalid sender", masking the underlying
    // `unsupported signature version 1 (expected >= 2)`. The load-bearing part is the contrast.
    expect(r1.error).toBeTruthy();
    expect(String(r1.error?.message)).not.toMatch(/insufficient funds/);
    expect(String(r1.error?.message)).toMatch(/invalid sender|signature version|unsupported/i);
  });

});

// These four are CONSENSUS constants -- they mirror vm.MinRotationGap, vm.RecoveryDelayBlocks,
// vm.RecoveryCooldownBlocks and vm.MaxGuardians in the node's precompile. Every other assertion that
// mentions them puts the constant on BOTH sides of the comparison, so three of the four could be
// changed with the whole suite still green -- measured: MIN_ROTATION_GAP 4->1, RECOVERY_COOLDOWN_BLOCKS
// 259200->1000 and MAX_GUARDIANS 32->8 all SURVIVED, offline and live.
//
// MAX_GUARDIANS has teeth in both directions: below 32 the SDK refuses a legal 9-32 guardian set, and
// above it the SDK emits calldata the precompile reverts on (count > vm.MaxGuardians). A client whose
// idea of a consensus bound has drifted from the chain's produces transactions that cannot land.
//
// Pinned ABSOLUTELY, and deliberately in one place, so changing one is a decision that shows up in a
// diff rather than a silent divergence. If the node's values change, change these WITH the node -- do
// not relax the test.
describe('the consensus constants match the node precompile', () => {
  it('are the values the node enforces', () => {
    expect([MIN_ROTATION_GAP, RECOVERY_DELAY_BLOCKS, RECOVERY_COOLDOWN_BLOCKS, MAX_GUARDIANS])
      .toEqual([4, 259200, 259200, 32]);
  });
});
