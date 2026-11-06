import { readFileSync } from 'fs';
import { join } from 'path';
import { verifyPlacementProof, PLACEMENT_MANAGER_RUNTIME_CODE_HASH } from '../src/ddb-proof';
import { evidenceRoute } from '../src/ddb-private-evidence';
import { decodePrivateTxnMemberV1, encodePrivateTxnMemberV1, decodePrivateTxnBaseV1, encodePrivateTxnBaseV1 } from '../src/ddb-private-txn';

const pins = JSON.parse(readFileSync(join(__dirname, 'vectors/placement-runtime-pins.json'), 'utf8'));
const proofs = JSON.parse(readFileSync(join(__dirname, 'vectors/sdk_placement_runtime_proofs.json'), 'utf8'));
const original = readFileSync(join(__dirname, 'vectors/private-txn-member-v1.json'), 'utf8');
const member = (runtime: string) => new TextEncoder().encode(original.replace(pins.v1, runtime));
const route = (runtime: string) => {
  const p = proofs.v2, booking = p.placementRecord;
  return { database: 'c_' + p.contract.slice(2), contract: p.contract, enabled: true, private: true,
    block: p.block, blockHash: '0x' + '11'.repeat(32), stateRoot: p.stateRoot, epoch: '0x3',
    manager: booking.manager, runtimeHash: runtime, version: booking.version, groupHash: booking.groupHash,
    members: booking.members.map((validatorId: number) => ({ validatorId, address: '0x' + validatorId.toString(16).padStart(40, '0') })) };
};

test('V1 remains accepted by BASE, source evidence and actual placement trie proof', () => {
  expect(pins.v1).toBe(PLACEMENT_MANAGER_RUNTIME_CODE_HASH);
  const m = decodePrivateTxnMemberV1(member(pins.v1), 4);
  expect(encodePrivateTxnMemberV1(m, 4)).toEqual(member(pins.v1));
  expect(decodePrivateTxnBaseV1(encodePrivateTxnBaseV1(m.base))).toEqual(m.base);
  expect(evidenceRoute(route(pins.v1).database, route(pins.v1)).runtimeHash).toBe(pins.v1);
  expect(verifyPlacementProof(proofs.v1.stateRoot, proofs.v1.contract, proofs.v1.placementRecord)).toEqual({ valid: true });
});

test('reviewed V2 runtime is accepted in independent source evidence route', () => {
  expect(proofs.v2.runtimeHash).toBe(pins.v2);
  expect(evidenceRoute(route(pins.v2).database, route(pins.v2)).runtimeHash).toBe(pins.v2);
});

test('reviewed V2 BASE and retained canonical member roundtrip without changing format', () => {
  const bytes = member(pins.v2);
  const m = decodePrivateTxnMemberV1(bytes, 4);
  expect(m.base.manager_runtime).toBe(pins.v2);
  expect(encodePrivateTxnMemberV1(m, 4)).toEqual(bytes);
  expect(decodePrivateTxnBaseV1(encodePrivateTxnBaseV1(m.base))).toEqual(m.base);
});

test('reviewed V2 account and all nine placement members verify against a real trie root', () => {
  const p = proofs.v2;
  expect(p.placementRecord.members).toHaveLength(9);
  expect(verifyPlacementProof(p.stateRoot, p.contract, p.placementRecord)).toEqual({ valid: true });
  const changed = JSON.parse(JSON.stringify(p));
  changed.placementRecord.members[8] = 99;
  expect(verifyPlacementProof(changed.stateRoot, changed.contract, changed.placementRecord).valid).toBe(false);
});

test.each([
  ['unknown', '0x' + 'ab'.repeat(32)],
  ['pre-publisher V2', pins.prePublisherV2],
  ['zero', '0x' + '00'.repeat(32)],
])('%s runtime still refuses evidence and canonical BASE/member decoding', (_name, runtime) => {
  expect(() => evidenceRoute(route(runtime).database, route(runtime))).toThrow();
  expect(() => decodePrivateTxnMemberV1(member(runtime), 4)).toThrow(/placement/);
  const b = decodePrivateTxnMemberV1(member(pins.v1), 4).base;
  b.manager_runtime = runtime;
  expect(() => encodePrivateTxnBaseV1(b)).toThrow(/placement/);
});

test('a cryptographically valid unknown-runtime trie proof still refuses', () => {
  const p = proofs.unknown;
  expect(verifyPlacementProof(p.stateRoot, p.contract, p.placementRecord)).toMatchObject({ valid: false, reason: expect.stringMatching(/reviewed PlacementManager/) });
});

test('V1 and V2 account proofs cannot be rebound to the other runtime root', () => {
  expect(verifyPlacementProof(proofs.v1.stateRoot, proofs.v2.contract, proofs.v2.placementRecord).valid).toBe(false);
  expect(verifyPlacementProof(proofs.v2.stateRoot, proofs.v1.contract, proofs.v1.placementRecord).valid).toBe(false);
});
