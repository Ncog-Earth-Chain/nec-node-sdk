import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { buildDdbOp, canonicalDdbOperationHashV2, canonicalDdbRequestIdV2, type DdbCanonicalOpV2, type DdbPreparedOp, type DdbSignOptions } from './ddb';

const enc = new TextEncoder();
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const ZERO_HASH = '0x' + '00'.repeat(32);
const PAYLOAD_MAX_BYTES = 2 * 2048 + 1024; // Node DecodeDigestRotationPayload fixed-shape bound.
const decimal = '(0|[1-9][0-9]{0,19})';
const hash = '(0x[0-9a-f]{64})';
const payloadPattern = new RegExp('^\\{"lanes":"(0x[0-9a-f]{4096})","asOfBlock":' + decimal +
  ',"digest_rotation":\\{"from_version":' + decimal + ',"to_version":' + decimal +
  ',"from_fingerprint":"' + hash + '","to_fingerprint":"' + hash + '","placement_version":' + decimal +
  ',"expected_prior":"' + hash + '"\\}\\}$');
const hex = (value: Uint8Array) => '0x' + bytesToHex(value);

function uint64(value: number | bigint, name: string): bigint {
  if ((typeof value !== 'bigint' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new Error('digest rotation ' + name + ' must be a safe uint64 number or bigint');
  }
  const result = BigInt(value);
  if (result < BigInt(0) || result > U64_MAX) throw new Error('digest rotation ' + name + ' outside uint64 bounds');
  return result;
}

function fingerprint(value: string, name: string, nonzero = false): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || (nonzero && value === ZERO_HASH)) {
    throw new Error('invalid digest rotation ' + name + ' fingerprint');
  }
  return value;
}

function address(value: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value)) {
    throw new Error('invalid digest rotation address');
  }
  return value.toLowerCase();
}

interface DigestRotationIdentity { contract: string; from: string; callerPubKey: Uint8Array }

export interface BuildDdbDigestRotationPreviewInput extends DigestRotationIdentity {
  /** Public fingerprint of an already provisioned key; never the key itself. */
  toFingerprint: string;
}

/** Retain these from trusted local/chain state and the intended key, never from an unverified preview. */
export interface DdbDigestRotationExpected {
  fromVersion: number | bigint;
  fromFingerprint: string;
  toFingerprint: string;
  placementVersion: number | bigint;
  expectedPrior: string;
  asOfBlock: number | bigint;
}

export interface BuildDdbDigestRotationInput extends DigestRotationIdentity {
  /** Exact canonical migration Data returned by preview, as bytes or lowercase RPC hex. */
  payload: Uint8Array | string;
  expected: DdbDigestRotationExpected;
}

function exactPayload(input: Uint8Array | string): Uint8Array {
  if (typeof input === 'string') {
    if (input.length > 2 * PAYLOAD_MAX_BYTES + 2 || !/^0x(?:[0-9a-f]{2})+$/.test(input)) {
      throw new Error('digest rotation payload must be bounded lowercase hex bytes');
    }
    return hexToBytes(input.slice(2));
  }
  if (!(input instanceof Uint8Array) || input.length === 0 || input.length > PAYLOAD_MAX_BYTES) {
    throw new Error('digest rotation payload exceeds its fixed-shape byte bound');
  }
  return new Uint8Array(input);
}

function decodedBinding(payload: Uint8Array) {
  const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
  const m = payloadPattern.exec(raw);
  if (!m) throw new Error('digest rotation payload has a noncanonical shape');
  const asOfBlock = uint64(BigInt(m[2]), 'asOfBlock');
  const fromVersion = uint64(BigInt(m[3]), 'fromVersion'), toVersion = uint64(BigInt(m[4]), 'toVersion');
  const fromFingerprint = m[5], toFingerprint = m[6];
  const placementVersion = uint64(BigInt(m[7]), 'placementVersion'), expectedPrior = m[8];
  if (fromVersion === U64_MAX || toVersion !== fromVersion + BigInt(1)) throw new Error('digest rotation version must increment exactly once');
  if (toFingerprint === ZERO_HASH || toFingerprint === fromFingerprint) throw new Error('digest rotation next fingerprint must be nonzero and different');
  if ((fromVersion === BigInt(0)) !== (fromFingerprint === ZERO_HASH)) throw new Error('digest rotation zero prior fingerprint is reserved for initialization');
  const canonical = `{"lanes":"${m[1]}","asOfBlock":${asOfBlock},"digest_rotation":{"from_version":${fromVersion},"to_version":${toVersion},"from_fingerprint":"${fromFingerprint}","to_fingerprint":"${toFingerprint}","placement_version":${placementVersion},"expected_prior":"${expectedPrior}"}}`;
  if (canonical !== raw) throw new Error('digest rotation payload is not canonical');
  return { fromVersion, fromFingerprint, toFingerprint, placementVersion, expectedPrior, asOfBlock };
}

function prepare(identity: DigestRotationIdentity, data: Uint8Array, options: DdbSignOptions): DdbPreparedOp {
  if (options.preimageVersion !== undefined && options.preimageVersion !== 2) throw new Error('digest rotation requires operation preimage v2');
  const contract = address(identity.contract), from = address(identity.from), database = 'c_' + contract.slice(2);
  // Reuse the shared scalar validation/defaults without passing migration JSON
  // through buildDdbOp's JSON.parse/stringify path, which rounds large integers.
  const base = buildDdbOp('callprocedure', database, {}, from, identity.callerPubKey, { ...options, preimageVersion: 2 });
  const e = base.envelope;
  const op: DdbCanonicalOpV2 = { type: 10, chainId: options.chainId!, schemaName: database, data, from,
    timestamp: BigInt(e.timestamp), gasLimit: BigInt(e.gasLimit), nonce: BigInt(e.nonce), expiry: BigInt(e.expiry!), keyVersion: BigInt(e.keyVersion!) };
  return { hash: canonicalDdbOperationHashV2(op), requestId: hex(canonicalDdbRequestIdV2(op, from)),
    envelope: { ...e, type: 10, data: hex(data) } };
}

/** Build the signed preparation request. This neither imports a key nor activates a migration. */
export function buildDdbDigestRotationPreview(input: BuildDdbDigestRotationPreviewInput, options: DdbSignOptions = {}): DdbPreparedOp {
  const target = fingerprint(input.toFingerprint, 'next', true);
  return prepare(input, enc.encode(`{"to_fingerprint":"${target}"}`), options);
}

/** Validate local migration expectations, then prepare the exact preview bytes for a new signature. */
export function buildDdbDigestRotation(input: BuildDdbDigestRotationInput, options: DdbSignOptions = {}): DdbPreparedOp {
  if (!input.expected) throw new Error('digest rotation requires locally retained expected bindings');
  const payload = exactPayload(input.payload), actual = decodedBinding(payload), expected = input.expected;
  const fromVersion = uint64(expected.fromVersion, 'expected fromVersion');
  const placementVersion = uint64(expected.placementVersion, 'expected placementVersion');
  const asOfBlock = uint64(expected.asOfBlock, 'expected asOfBlock');
  const fromFingerprint = fingerprint(expected.fromFingerprint, 'expected previous');
  const toFingerprint = fingerprint(expected.toFingerprint, 'expected next', true);
  const expectedPrior = fingerprint(expected.expectedPrior, 'expected prior anchor');
  const sameBinding = actual.fromVersion === fromVersion && actual.fromFingerprint === fromFingerprint &&
    actual.toFingerprint === toFingerprint && actual.placementVersion === placementVersion &&
    actual.expectedPrior === expectedPrior && actual.asOfBlock === asOfBlock;
  if (!sameBinding) throw new Error('digest rotation preview differs from locally retained expected bindings');
  return prepare(input, payload, options);
}
