import { keccak_256 } from '@noble/hashes/sha3';

/**
 * ECO-06 (NEC-113; DECIDE-16): the host-group record, client side.
 *
 * `ddb_resolveHostGroup(validatorId)` serves a validator's schema-v3 host-group record as the provider registry held
 * it at the current sealed epoch's root -- only when it is resolvable: the registry accepted it signed by the
 * validator's bound consensus key, the provider was live at the seal, and the validator's HostBonds bond still covers
 * the DECIDE-17 minimum for the capacity offered. The node also decodes the record into fields; this module checks
 * that the served bytes hash to the served recordHash and that the fixed-offset head (the bytes the registry itself
 * parsed: tag, validator, key, operator, capacity, bond contract, payout, endpoint directory) agrees with the served
 * fields, so a client never acts on a decoding the bytes do not support. The signature itself was checked by the
 * registry contract through the ML-DSA-87 precompile; it is in the HostGroupRecorded event, not in the answer.
 *
 * Cache the answer against (epoch, root, rootSeq): the root moves on every accepted record and every removal.
 */

/** The 12-byte tag every v3 record begins with (ProviderRegistry.sol RECORD_DOMAIN). */
export const HOST_GROUP_RECORD_DOMAIN = 'NEC-DDB-CAP\x03';
/** The fixed head the registry parses: v2 head (88) | bond contract | payout | endpoint directory. */
export const HOST_GROUP_RECORD_HEAD_BYTES = 148;

/** ddb_resolveHostGroup's answer (ethapi RPCHostGroupRecord). Quantities are hex strings. */
export interface HostGroupRecordJSON {
  epoch: number;
  rootBlock: number;
  stateRoot: string;
  labels: string[];
  validatorId: number;
  recordHash: string;
  record: string;
  root: string;
  rootSeq: number;
  consensusKeyHash: string;
  operatorId: string;
  regions: string[];
  storageBytes: string;
  iops?: number;
  vcpu?: number;
  ramBytes?: string;
  maxConnections?: number;
  maxTenants?: number;
  postgresVersion?: string;
  extensions?: string[];
  sla?: { availabilityTargetPpm: number; p99LatencyMs: number; docHash: string; docUri: string };
  prices: { gbEpoch: string; vcpuHour: string; gpuHour: string; gbEgress: string; perCommit: string };
  bondContract: string;
  bond: string;
  minimumBond: string;
  payoutAddress: string;
  endpointDirectory: string;
  endpointsBlock: number;
  endpoints: { region: string; endpointId: string; resolved: boolean; scheme?: string; url?: string; tlsKeyHash?: string }[];
}

const strip0x = (h: string) => (h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h);
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');

function bytesOf(h: string): Uint8Array {
  const s = strip0x(h);
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error('ECO-06: the served record is not hex');
  return Uint8Array.from(Buffer.from(s, 'hex'));
}

function sameHex(a: string, b: string): boolean {
  return strip0x(a).toLowerCase() === strip0x(b).toLowerCase();
}

function quantity(q: string): bigint {
  return BigInt(q.startsWith('0x') || q.startsWith('0X') ? q : '0x' + q);
}

/**
 * Throws unless `a` is validatorId's record and its served head fields are the bytes' own. Returns `a`.
 */
export function verifyHostGroupRecord(validatorId: number, a: HostGroupRecordJSON): HostGroupRecordJSON {
  const rec = bytesOf(a.record);
  if (rec.length < HOST_GROUP_RECORD_HEAD_BYTES || Buffer.from(rec.slice(0, 12)).toString('latin1') !== HOST_GROUP_RECORD_DOMAIN) {
    throw new Error('ECO-06: the served record is not a schema-v3 host-group record');
  }
  if (!sameHex(hexOf(keccak_256(rec)), a.recordHash)) {
    throw new Error('ECO-06: the served record does not hash to its recordHash');
  }
  const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const id = view.getUint32(12);
  if (id !== validatorId || a.validatorId !== validatorId) {
    throw new Error(`ECO-06: asked for validator ${validatorId}, the record is validator ${id}'s`);
  }
  const head: [string, string, string][] = [
    ['consensusKeyHash', hexOf(rec.slice(16, 48)), a.consensusKeyHash],
    ['operatorId', hexOf(rec.slice(48, 80)), a.operatorId],
    ['bondContract', hexOf(rec.slice(88, 108)), a.bondContract],
    ['payoutAddress', hexOf(rec.slice(108, 128)), a.payoutAddress],
    ['endpointDirectory', hexOf(rec.slice(128, 148)), a.endpointDirectory],
  ];
  for (const [name, inRecord, served] of head) {
    if (!sameHex(inRecord, served)) throw new Error(`ECO-06: the served ${name} is not the record's`);
  }
  if (view.getBigUint64(80) !== quantity(a.storageBytes)) {
    throw new Error('ECO-06: the served storageBytes is not the record\'s');
  }
  return a;
}
