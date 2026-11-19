/**
 * Source-only A4 compatibility cases. The account trie leaves below are synthetic:
 * they reuse existing storage proofs with a separately bound runtime and root.
 * They prove verifier compatibility, never contract execution or collateral.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { encodeRlp, keccak256 } from 'ethers';
import { Ddb } from '../src/ddb';
import {
  PROVIDER_REGISTRY_RUNTIME_CODE_HASH, PROVIDER_REGISTRY_A4_RUNTIME_CODE_HASH,
  PLACEMENT_MANAGER_RUNTIME_CODE_HASH, PLACEMENT_MANAGER_V2_RUNTIME_CODE_HASH, PLACEMENT_MANAGER_V2_A4_RUNTIME_CODE_HASH,
  isSupportedProviderRegistryRuntime, isSupportedPlacementManagerRuntime, isPlacementManagerV2Runtime,
  hasA4BookingRuntimeGuards, verifyRegistryProof, verifyPlacementProof, type RegistryProofJSON,
} from '../src/ddb-proof';
import { evidenceRoute, samePrivateRoute } from '../src/ddb-private-evidence';
import { decodePrivateTxnMemberV1, encodePrivateTxnMemberV1, decodePrivateTxnBaseV1, encodePrivateTxnBaseV1 } from '../src/ddb-private-txn';

const json = (name: string) => JSON.parse(readFileSync(join(__dirname, 'vectors', name), 'utf8'));
const registry = json('place02_registry_proof.json');
const placement = json('sdk_placement_runtime_proofs.json');
const pins = json('a4-runtime-pins.json');
const oldPins = json('placement-runtime-pins.json');
const originalMember = readFileSync(join(__dirname, 'vectors/private-txn-member-v1.json'), 'utf8');
const member = (runtime: string) => new TextEncoder().encode(originalMember.replace(oldPins.v1, runtime));
const unknown = '0x' + 'ab'.repeat(32);

function withRuntime(original: RegistryProofJSON, runtime: string): RegistryProofJSON {
  const proof: RegistryProofJSON = JSON.parse(JSON.stringify(original));
  // Both retained fixture accounts have nonce=balance=0. Encode the canonical
  // empty quantities and a full even leaf path for this one-account state trie.
  expect(proof.account.nonce).toBe('0x0');
  expect(proof.account.balance).toBe('0x0');
  const value = encodeRlp(['0x', '0x', proof.account.storageHash, runtime]);
  const leaf = encodeRlp(['0x20' + keccak256(proof.account.address).slice(2), value]);
  proof.stateRoot = keccak256(leaf);
  proof.account.codeHash = runtime;
  proof.account.accountProof = [leaf];
  return proof;
}

const route = (runtime: string) => {
  const p = placement.v2, booking = p.placementRecord;
  return { database: 'c_' + p.contract.slice(2), contract: p.contract, enabled: true, private: true,
    block: p.block, blockHash: '0x' + '11'.repeat(32), stateRoot: p.stateRoot, epoch: '0x3',
    manager: booking.manager, runtimeHash: runtime, version: booking.version, groupHash: booking.groupHash,
    members: booking.members.map((validatorId: number) => ({ validatorId, address: '0x' + validatorId.toString(16).padStart(40, '0') })) };
};

test('old constants keep their exact artifact identities', () => {
  expect(PROVIDER_REGISTRY_RUNTIME_CODE_HASH).toBe(registry.registryCodeHash);
  expect(PLACEMENT_MANAGER_RUNTIME_CODE_HASH).toBe(oldPins.v1);
  expect(PLACEMENT_MANAGER_V2_RUNTIME_CODE_HASH).toBe(oldPins.v2);
});

test.each([
  { name: 'registry', file: 'ProviderRegistry.a4.bin-runtime', key: 'registry', size: 15213 },
  { name: 'V2-A4', file: 'PlacementManagerV2.a4.bin-runtime', key: 'v2', size: 20252 },
])('new $name pin hashes the reviewed compiled artifact', ({ file, key, size }) => {
  const runtime = readFileSync(join(__dirname, 'vectors', 'a4', file), 'utf8');
  expect(runtime).toMatch(/^[0-9a-f]+$/);
  expect(runtime.length / 2).toBe(size);
  expect(keccak256('0x' + runtime)).toBe(pins[key]);
  expect(key === 'registry' ? PROVIDER_REGISTRY_A4_RUNTIME_CODE_HASH : PLACEMENT_MANAGER_V2_A4_RUNTIME_CODE_HASH).toBe(pins[key]);
});

test.each([oldPins.v1, oldPins.v2, pins.v2])('placement history supports exact runtime %s', runtime => {
  expect(isSupportedPlacementManagerRuntime(runtime)).toBe(true);
  expect(isPlacementManagerV2Runtime(runtime)).toBe(runtime !== oldPins.v1);
});

test.each([registry.registryCodeHash, pins.registry])('registry history supports exact runtime %s', runtime => {
  expect(isSupportedProviderRegistryRuntime(runtime)).toBe(true);
});

test.each([
  { r: pins.registry, m: oldPins.v1, expected: true }, { r: pins.registry, m: pins.v2, expected: true },
  { r: pins.registry, m: oldPins.v2, expected: false }, { r: registry.registryCodeHash, m: oldPins.v1, expected: false },
  { r: registry.registryCodeHash, m: pins.v2, expected: false }, { r: unknown, m: pins.v2, expected: false },
  { r: pins.registry, m: unknown, expected: false },
])('runtime guard classification $r / $m is $expected (no evidence claim)', ({ r, m, expected }) => {
  expect(hasA4BookingRuntimeGuards(r, m)).toBe(expected);
});

test.each([unknown, oldPins.prePublisherV2, '0x' + '00'.repeat(32)])('unsupported manager %s refuses every strict consumer', runtime => {
  expect(isSupportedPlacementManagerRuntime(runtime)).toBe(false);
  expect(isPlacementManagerV2Runtime(runtime)).toBe(false);
  expect(() => evidenceRoute(route(runtime).database, route(runtime))).toThrow();
  expect(() => decodePrivateTxnMemberV1(member(runtime), 4)).toThrow(/placement/);
});

test.each([pins.registry.toUpperCase(), pins.registry.slice(2), ' ' + pins.registry, pins.registry + ' '])('registry classification never normalizes %s', runtime => {
  expect(isSupportedProviderRegistryRuntime(runtime)).toBe(false);
  expect(hasA4BookingRuntimeGuards(runtime, pins.v2)).toBe(false);
});

test.each([pins.v2.toUpperCase(), pins.v2.slice(2), ' ' + pins.v2, pins.v2 + ' '])('manager identity never normalizes %s', runtime => {
  expect(isSupportedPlacementManagerRuntime(runtime)).toBe(false);
  expect(isPlacementManagerV2Runtime(runtime)).toBe(false);
  expect(hasA4BookingRuntimeGuards(pins.registry, runtime)).toBe(false);
  expect(() => evidenceRoute(route(runtime).database, route(runtime))).toThrow();
  expect(() => decodePrivateTxnMemberV1(member(runtime), 4)).toThrow();
});

test('guarded registry synthetic account proof verifies all retained provider storage words', () => {
  const proof = withRuntime(registry.sealed.proof, pins.registry);
  expect(verifyRegistryProof(proof.stateRoot, registry.registry, proof, registry.sealed.providers)).toEqual({ valid: true });
  const changed = JSON.parse(JSON.stringify(registry.sealed.providers));
  changed[0].record.committed = '0x1';
  expect(verifyRegistryProof(proof.stateRoot, registry.registry, proof, changed).valid).toBe(false);
  expect(verifyRegistryProof(registry.sealed.stateRoot, registry.registry, proof, registry.sealed.providers).valid).toBe(false);
});

test('unknown proven registry runtime refuses by default even if response codeHash claims guarded runtime', () => {
  const proof = withRuntime(registry.sealed.proof, unknown);
  proof.account.codeHash = pins.registry;
  expect(verifyRegistryProof(proof.stateRoot, registry.registry, proof, registry.sealed.providers)).toMatchObject({ valid: false });
});

test('arbitrary registry override retains case-insensitive exclusive matching without granting runtime classification', () => {
  const proof = withRuntime(registry.sealed.proof, unknown);
  expect(verifyRegistryProof(proof.stateRoot, registry.registry, proof, registry.sealed.providers).valid).toBe(false);
  expect(verifyRegistryProof(proof.stateRoot, registry.registry, proof, registry.sealed.providers,
    { registryCodeHash: unknown.toUpperCase() })).toEqual({ valid: true });
  expect(isSupportedProviderRegistryRuntime(unknown)).toBe(false);
  expect(hasA4BookingRuntimeGuards(unknown, pins.v2)).toBe(false);
  const guarded = withRuntime(registry.sealed.proof, pins.registry);
  expect(verifyRegistryProof(guarded.stateRoot, registry.registry, guarded, registry.sealed.providers,
    { registryCodeHash: registry.registryCodeHash }).valid).toBe(false);
  expect(verifyRegistryProof(registry.sealed.stateRoot, registry.registry, registry.sealed.proof, registry.sealed.providers,
    { registryCodeHash: pins.registry }).valid).toBe(false);
  expect(verifyRegistryProof(guarded.stateRoot, registry.registry, guarded, registry.sealed.providers,
    { registryCodeHash: undefined })).toEqual({ valid: true });
  expect(verifyRegistryProof(guarded.stateRoot, registry.registry, guarded, registry.sealed.providers,
    { registryCodeHash: null } as any)).toEqual({ valid: true });
  expect(verifyRegistryProof(guarded.stateRoot, registry.registry, guarded, registry.sealed.providers,
    { registryCodeHash: '' }).valid).toBe(false);
});

test('V2-A4 synthetic account proof verifies nine packed members without rebinding the legacy root', () => {
  const record = JSON.parse(JSON.stringify(placement.v2.placementRecord));
  record.proof = withRuntime(record.proof, pins.v2);
  expect(record.members).toHaveLength(9);
  expect(verifyPlacementProof(record.proof.stateRoot, placement.v2.contract, record)).toEqual({ valid: true });
  expect(verifyPlacementProof(placement.v2.stateRoot, placement.v2.contract, record).valid).toBe(false);
  expect(verifyPlacementProof(record.proof.stateRoot, placement.v2.contract, placement.v2.placementRecord).valid).toBe(false);
  record.members[8] = 99;
  expect(verifyPlacementProof(record.proof.stateRoot, placement.v2.contract, record).valid).toBe(false);
});

test('V2-A4 source evidence and BASE/member grammar retain the exact new runtime word', () => {
  const bytes = member(pins.v2), decoded = decodePrivateTxnMemberV1(bytes, 4);
  expect(decoded.base.manager_runtime).toBe(pins.v2);
  expect(encodePrivateTxnMemberV1(decoded, 4)).toEqual(bytes);
  expect(decodePrivateTxnBaseV1(encodePrivateTxnBaseV1(decoded.base))).toEqual(decoded.base);
  expect(evidenceRoute(route(pins.v2).database, route(pins.v2)).runtimeHash).toBe(pins.v2);
  expect(samePrivateRoute(evidenceRoute(route(oldPins.v2).database, route(oldPins.v2)),
    evidenceRoute(route(pins.v2).database, route(pins.v2)))).toBe(false);
  expect(bytes).not.toEqual(member(oldPins.v2));
});

test.each(['0x1234', '0x'])('quote preserves existing calldata %s for V1 place / V2 consent-handoff respectively', async calldata => {
  // Existing wire fields only. A V2 quote carries empty calldata because its
  // place selector always reverts. Candidate members/size require consent/handoff.
  const response = { calldata };
  const send = jest.fn(async () => response);
  const ddb = new Ddb({ send } as any);
  const request = { contract: placement.v2.contract, owner: registry.registry, replicaBytes: BigInt(4096) };
  expect(await ddb.quotePlacement(request)).toBe(response);
  expect(send.mock.calls).toEqual([['ddb_quotePlacement', [{ ...request, replicaBytes: '0x1000' }]]]);
});
