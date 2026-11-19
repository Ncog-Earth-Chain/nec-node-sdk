import * as fs from 'fs';
import * as path from 'path';
import { verifyPlacementProof, PLACEMENT_MANAGER_RUNTIME_CODE_HASH } from '../src/ddb-proof';
import { DdbResolver } from '../src/ddb-resolve';

const vector = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'place02_placement_proof.json'), 'utf8'));
const fresh = () => JSON.parse(JSON.stringify(vector.answer));

test('the node placement vector proves version, capacity, group and all nine packed members', () => {
  const a = fresh();
  expect(PLACEMENT_MANAGER_RUNTIME_CODE_HASH).toBe(vector.managerRuntimeCodeHash);
  expect(verifyPlacementProof(a.stateRoot, a.contract, a.placementRecord)).toEqual({ valid: true });
  // These untrusted convenience values cannot change authenticated leaves.
  a.placementRecord.proof.account.storageProof.forEach((p: any) => { p.value = '0xffff'; });
  expect(verifyPlacementProof(a.stateRoot, a.contract, a.placementRecord).valid).toBe(true);
});

test.each(['version', 'replicaBytes', 'groupHash', 'member', 'last-member', 'count', 'manager', 'root', 'missing-word', 'missing-proof'])('%s tampering refuses', (kind) => {
  const a = fresh();
  const p = a.placementRecord;
  switch (kind) {
    case 'version': p.version = '0x8'; break;
    case 'replicaBytes': p.replicaBytes = '0x1'; break;
    case 'groupHash': p.groupHash = '0x' + '11'.repeat(32); break;
    case 'member': p.members[0] = 99; break;
    case 'last-member': p.members[8] = 99; break;
    case 'count': p.members.pop(); break;
    case 'manager': p.manager = '0x' + 'aa'.repeat(20); break;
    case 'root': a.stateRoot = '0x' + 'aa'.repeat(32); break;
    case 'missing-word': p.proof.account.storageProof.pop(); break;
    case 'missing-proof': delete p.proof; break;
  }
  expect(verifyPlacementProof(a.stateRoot, a.contract, p).valid).toBe(false);
});

test('an account with another runtime cannot prove a placement', () => {
  const a = fresh();
  a.placementRecord.manager = a.registry;
  a.placementRecord.proof = a.proof;
  expect(verifyPlacementProof(a.stateRoot, a.contract, a.placementRecord)).toMatchObject({ valid: false, reason: expect.stringMatching(/reviewed PlacementManager/) });
});

test('resolver proof mode verifies both provider records and the attached booking', async () => {
  const a = fresh();
  const send = async (method: string) => method === 'eth_chainId' ? '0x1' :
    method === 'eth_getBlockByNumber' ? { epoch: a.epoch, stateRoot: a.stateRoot } : a;
  expect((await new DdbResolver(send, { withProof: true }).resolve(a.contract)).proven).toBe(true);
  a.placementRecord.version = '0x8';
  await expect(new DdbResolver(send, { withProof: true }).resolve(a.contract)).rejects.toThrow(/placement proof/);
});

test('valid storage proofs do not bypass cross-checking the activation metadata', async () => {
  const a = fresh();
  const other = fresh();
  other.placementRecord.enforced = false;
  const send = async (method: string) => method === 'eth_chainId' ? '0x1' :
    method === 'eth_getBlockByNumber' ? { epoch: a.epoch, stateRoot: a.stateRoot } : a;
  await expect(new DdbResolver(send, { withProof: true, crossCheck: async (method) => method === 'eth_chainId' ? '0x1' : other })
    .resolve(a.contract)).rejects.toThrow(/disagree/);
});
