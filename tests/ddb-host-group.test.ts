/**
 * ECO-06 (NEC-113): Ddb.resolveHostGroup and the client-side record check. The record is the NODE's schema-v3 golden
 * vector (ddb/placement TestHostGroupRecordV3GoldenVector, copied to tests/vectors/eco06_host_group_record_v3.hex),
 * so the SDK checks the bytes the node produces. Basic tests (owner ruling 36 (2)); the full list is the node's
 * docs/testing/eco-06-test-cases.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HOST_GROUP_RECORD_DOMAIN, verifyHostGroupRecord, type HostGroupRecordJSON } from '../src/ddb-host-group';

const RECORD = '0x' + fs.readFileSync(path.join(__dirname, 'vectors', 'eco06_host_group_record_v3.hex'), 'utf8').trim();
// From ddb/placement goldenHostGroupRecordV3Hash -- the node's constant, not ours.
const RECORD_HASH = '0x7547ce378a16794cc9830a74186509199909f1c25c406cebbc4abc39a54b412a';

function answer(over: Partial<HostGroupRecordJSON> = {}): HostGroupRecordJSON {
  return {
    epoch: 7, rootBlock: 107, stateRoot: '0x' + '11'.repeat(32), labels: ['region best-effort'],
    validatorId: 7, recordHash: RECORD_HASH, record: RECORD, root: '0x' + '22'.repeat(32), rootSeq: 3,
    consensusKeyHash: '0x084005a289eba121b5a1eb8557799d3bc35acfc91ec67bdb1903e5c5c1047ed0',
    operatorId: '0x' + '0a'.repeat(32), regions: ['ap-south-1', 'eu-west-1'], storageBytes: '0x40000000000',
    bondContract: '0xb0d5000000000000000000000000000000000001', payoutAddress: '0x9a40000000000000000000000000000000000007',
    endpointDirectory: '0xe9d1000000000000000000000000000000000001', bond: '0x1', minimumBond: '0x1',
    prices: { gbEpoch: '0xe8d4a51000', vcpuHour: '0x2d79883d2000', gpuHour: '0x0', gbEgress: '0x71afd498d0000', perCommit: '0x2540be400' },
    endpoints: [], endpointsBlock: 0,
    ...over,
  } as HostGroupRecordJSON;
}

describe('ECO-06 host-group record', () => {
  test('the node\'s golden record verifies against its hash and its served fields', () => {
    expect(HOST_GROUP_RECORD_DOMAIN).toBe('NEC-DDB-CAP\x03');
    expect(() => verifyHostGroupRecord(7, answer())).not.toThrow();
  });

  test('a record that does not hash to recordHash, names another validator or disagrees with a served field is refused', () => {
    expect(() => verifyHostGroupRecord(7, answer({ recordHash: '0x' + '00'.repeat(32) }))).toThrow(/does not hash/);
    expect(() => verifyHostGroupRecord(8, answer())).toThrow(/validator 7/);
    expect(() => verifyHostGroupRecord(7, answer({ payoutAddress: '0x' + '00'.repeat(20) }))).toThrow(/payoutAddress/);
    expect(() => verifyHostGroupRecord(7, answer({ bondContract: '0x' + '01'.repeat(20) }))).toThrow(/bondContract/);
    expect(() => verifyHostGroupRecord(7, answer({ storageBytes: '0x1' }))).toThrow(/storageBytes/);
    const v2 = '0x' + Buffer.from('NEC-DDB-CAP\x02').toString('hex') + RECORD.slice(2 + 24);
    expect(() => verifyHostGroupRecord(7, answer({ record: v2 }))).toThrow(/schema-v3/);
  });

  test('Ddb.resolveHostGroup asks ddb_resolveHostGroup and refuses an answer that does not check', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Ddb } = require('../src/ddb');
    let served = answer();
    const calls: [string, any[]][] = [];
    const ddb = new Ddb({ send: async (m: string, p: any[]) => { calls.push([m, p]); return served; } } as any);
    await expect(ddb.resolveHostGroup(7)).resolves.toMatchObject({ validatorId: 7, recordHash: RECORD_HASH });
    expect(calls[calls.length - 1]).toEqual(['ddb_resolveHostGroup', [7]]);
    served = answer({ recordHash: '0x' + '33'.repeat(32) });
    await expect(ddb.resolveHostGroup(7)).rejects.toThrow(/does not hash/);
  });
});
