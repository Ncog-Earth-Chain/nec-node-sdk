import { readFileSync } from 'fs';
import { join } from 'path';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { Ddb, buildDdbTransaction, type DdbSigner } from '../../src/ddb';
import { decodePrivateTxnMemberV1, encodePrivateTxnMemberV1 } from '../../src/ddb-private-txn';
import { decodeDdbCommitmentEnvelope } from '../../src/ddb-commitment';
import { collectDdbPrivateTransactionOutcome } from '../../src/ddb-private-txn-outcome';
import { parseDdbCurrentReadRoute } from '../../src/ddb-private-read';
import { PLACEMENT_MANAGER_RUNTIME_CODE_HASH } from '../../src/ddb-proof';
import {
  prepareDdbPrivateTransaction, storeDdbPrivateTransactionPayloads, submitDdbPrivateTransaction,
  type DdbPrivateTransactionPrepareInput,
} from '../../src/ddb-private-txn-online';

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
const hash = (b: string) => '0x' + b.repeat(32);
const caller = '0x' + '22'.repeat(20);
const contract = '0x' + '11'.repeat(20);
const database = 'c_' + contract.slice(2);
const chain = '0x' + BigInt(2570).toString(16).padStart(64, '0');
const pub = new Uint8Array(2592).fill(1);
const sig = new Uint8Array(4627).fill(2);
const digestKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const vector = new Uint8Array(readFileSync(join(__dirname, '../vectors/private-txn-member-v1.json')));
const tag = 'EBCtfNMVnBzfD2oOXnstz7BVQ6zaH9OEHns4ETdg5BQ=';
const commit = hash('88');

export function privateClientFixture(count = 2) {
  const placement = parseDdbCurrentReadRoute(contract, { contract, database, enabled: true, private: true,
    block: '0x1b', blockHash: hash('44'), stateRoot: hash('55'), epoch: '0x3', manager: '0x' + '66'.repeat(20),
    runtimeHash: PLACEMENT_MANAGER_RUNTIME_CODE_HASH, version: '0x2',
    groupHash: hex(keccak_256(Buffer.from([2, 7, 9].map(id => id.toString(16).padStart(64, '0')).join(''), 'hex'))),
    members: [2, 7, 9].map(validatorId => ({ validatorId, address: '0x' + validatorId.toString(16).padStart(40, '0') })) });
  const base = decodePrivateTxnMemberV1(vector, 4).base;
  Object.assign(base, { chain, database, contract, caller, block: BigInt(27), block_hash: placement.blockHash,
    state_root: placement.stateRoot, epoch: BigInt(3), manager: placement.manager, manager_runtime: placement.runtimeHash,
    placement_version: BigInt(2), group_hash: placement.groupHash, digest_version: BigInt(1),
    digest_fingerprint: hex(sha256(digestKey)), initial_anchor: hash('77') });
  base.context.definition.contract_address = contract;
  let preview: any[] = [];
  const alterPreview = jest.fn((p: any[]) => p);
  const send = jest.fn(async (method: string, params: any[]): Promise<any> => {
    if (method === 'ddb_previewPrivateBatch') {
      preview = params[0].map((e: any, i: number) => {
        const m = decodePrivateTxnMemberV1(vector, 4);
        m.index = BigInt(i); m.count = BigInt(params[0].length); m.base = base;
        m.intent = { type: BigInt(7), data: Uint8Array.from(Buffer.from(e.data.slice(2), 'hex')),
          timestamp: BigInt(e.timestamp), gas_limit: BigInt(e.gasLimit), nonce: BigInt(e.nonce), expiry: BigInt(e.expiry), key_version: BigInt(e.keyVersion) };
        return { payload: hex(encodePrivateTxnMemberV1(m, 4)), placementVersion: '0x2', digestKeyVersion: '0x1',
          stateDelta: { added: [tag, tag] }, prior: i ? hash('81') : base.initial_anchor, post: hash(i ? '82' : '81') };
      });
      return alterPreview(preview);
    }
    if (method === 'ddb_putPayloadBatch') return params[0].map((e: any) => decodeDdbCommitmentEnvelope(Buffer.from(e.data.slice(2), 'hex').toString()).commitment);
    if (method === 'ddb_submitSignedTransaction') return commit;
    throw new Error('unexpected method');
  });
  const resolveCurrent = jest.fn(async () => placement);
  const hostEndpoints = jest.fn(async (ids?: number[]): Promise<any[]> => (ids ?? []).map(validatorId => ({ validatorId, live: true,
    endpoints: [{ scheme: 'https', url: `https://host${validatorId}.example`, tlsKeyHash: hash('bb') }] })));
  const close = jest.fn();
  const verifyAssignment = jest.fn(async () => true);
  const connect = jest.fn(async (r: any): Promise<any> => ({ binding: { route: r.route, validatorId: r.member.validatorId,
    address: r.member.address, url: r.endpoints[0].url, tlsKeyHash: r.endpoints[0].tlsKeyHash }, endpointAuthenticated: true,
    confidentiality: 'post-quantum', send, close }));
  const signDdbHash = jest.fn(async (_hash: Uint8Array) => sig.slice());
  const signer: DdbSigner = { getAddress: () => caller, getPublicKey: () => pub.slice(), signDdbHash };
  const acceptPreparedSnapshot = jest.fn(async (_request: any) => ({ expectedBase: base, completePlacement: placement }));
  const input: DdbPrivateTransactionPrepareInput = { signer, resolver: { resolveCurrent, hostEndpoints }, policy: { verifyAssignment, connect },
    chain, caller, database, validatorId: 7, maxMembers: 4, digestKey: digestKey.slice(), keyVersion: BigInt(1),
    timestamp: 1800000000, expiry: BigInt(1800000300),
    members: Array.from({ length: count }, (_, i) => ({ data: '{"procedure":"transfer","args":[9007199254740993]}', gasLimit: 1000, nonce: BigInt(100 + i) })),
    acceptPreparedSnapshot };
  return { input, base, placement, send, alterPreview, resolveCurrent, hostEndpoints, close, verifyAssignment, connect, signDdbHash, acceptPreparedSnapshot };
}


export { hex, hash, caller, contract, database, chain, pub, sig, digestKey, commit };
