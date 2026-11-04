import * as fs from 'fs';
import * as path from 'path';
import { buildDdbDigestRotation, buildDdbDigestRotationPreview } from '../src/ddb-digest-rotation';
import { canonicalDdbOperationBytesV2, type DdbSignOptions } from '../src/ddb';

const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors/place03_digest_rotation_vector.json'), 'utf8'));
const enc = new TextEncoder();
const identity = () => ({ contract: v.contract, from: v.from, callerPubKey: new Uint8Array([1]) });
const opts = { chainId: v.chainId, timestamp: v.timestamp, expiry: v.expiry, gasLimit: v.gasLimit, nonce: v.nonce, preimageVersion: 2 as const };
const expected = (c = v.cases[1]) => ({ ...c.expected, fromVersion: BigInt(c.expected.fromVersion), placementVersion: BigInt(c.expected.placementVersion), asOfBlock: BigInt(c.expected.asOfBlock) });
const input = (c = v.cases[1]) => ({ ...identity(), payload: enc.encode(c.data), expected: expected(c) });
const changedHash = '0x' + '44'.repeat(32);
const zeroHash = '0x' + '00'.repeat(32);
const lanes = (raw: string) => /^\{"lanes":"([^"]+)"/.exec(raw)![1];

test('digest rotation preview binds the exact Go request hash and request ID', () => {
  const p = buildDdbDigestRotationPreview({ ...identity(), toFingerprint: v.toFingerprint }, opts);
  expect(Buffer.from(p.hash).toString('hex')).toBe(v.requestHash.slice(2));
  expect(p.requestId).toBe(v.requestId);
  expect(Buffer.from(p.envelope.data.slice(2), 'hex').toString()).toBe(v.requestData);
  expect(p.envelope.type).toBe(10);
  expect(p.envelope.schemaName).toBe(v.database);
});

test.each([0, 1, 2, 3])('digest rotation preserves Go vector %i through the complete uint64 range', (index) => {
  const c = v.cases[index];
  for (const payload of [enc.encode(c.data), '0x' + Buffer.from(c.data).toString('hex')]) {
    const p = buildDdbDigestRotation({ ...input(c), payload }, opts);
    expect(Buffer.from(p.hash).toString('hex')).toBe(c.hash.slice(2));
    expect(p.requestId).toBe(c.requestId);
    expect(p.envelope.data).toBe('0x' + Buffer.from(c.data).toString('hex'));
    expect(p.envelope.type).toBe(10);
    expect(p.envelope).not.toHaveProperty('stateDelta');
  }
});

test.each(['fromVersion', 'fromFingerprint', 'toFingerprint', 'placementVersion', 'expectedPrior', 'asOfBlock'])('rotation refuses a host preview that changes expected %s', (field) => {
  const i = input();
  let raw: string = v.cases[1].data;
  switch (field) {
    case 'fromVersion': raw = raw.replace('"from_version":1,"to_version":2', '"from_version":2,"to_version":3'); break;
    case 'fromFingerprint': raw = raw.replace(i.expected.fromFingerprint, changedHash); break;
    case 'toFingerprint': raw = raw.replace(i.expected.toFingerprint, changedHash); break;
    case 'placementVersion': raw = raw.replace('"placement_version":9007199254740993', '"placement_version":9007199254740994'); break;
    case 'expectedPrior': raw = raw.replace(i.expected.expectedPrior, changedHash); break;
    case 'asOfBlock': raw = raw.replace('"asOfBlock":9007199254740993', '"asOfBlock":9007199254740994'); break;
  }
  expect(() => buildDdbDigestRotation({ ...i, payload: enc.encode(raw) }, opts)).toThrow(/expected/);
});

test.each(['fromVersion', 'fromFingerprint', 'toFingerprint', 'placementVersion', 'expectedPrior', 'asOfBlock'])('rotation requires the locally retained %s expectation', (field) => {
  const i = input();
  delete i.expected[field];
  expect(() => buildDdbDigestRotation(i, opts)).toThrow();
});

const malformed: Array<[string, (s: string) => string]> = [
  ['whitespace', (s) => s + '\n'],
  ['unknown root field', (s) => s.slice(0, -1) + ',"extra":0}'],
  ['unknown binding field', (s) => s.slice(0, -2) + ',"extra":0}}'],
  ['duplicate field', (s) => s.replace('"from_version":1', '"from_version":1,"from_version":1')],
  ['field alias', (s) => s.replace('"asOfBlock"', '"ASOFBLOCK"')],
  ['escaped field', (s) => s.replace('"from_version"', '"\\u0066rom_version"')],
  ['reordered fields', (s) => s.replace(`{"lanes":"${lanes(s)}","asOfBlock":9007199254740993`, `{"asOfBlock":9007199254740993,"lanes":"${lanes(s)}"`)],
  ['short lanes', (s) => s.replace(lanes(s), lanes(s).slice(0, -2))],
  ['long lanes', (s) => s.replace(lanes(s), lanes(s) + '00')],
  ['uppercase lanes', (s) => s.replace(lanes(s), '0x' + lanes(s).slice(2).toUpperCase())],
  ['negative version', (s) => s.replace('"from_version":1', '"from_version":-1')],
  ['leading zero', (s) => s.replace('"from_version":1', '"from_version":01')],
  ['exponent number', (s) => s.replace('"from_version":1', '"from_version":1e0')],
  ['fractional number', (s) => s.replace('"from_version":1', '"from_version":1.0')],
  ['uint64 overflow', (s) => s.replace('"asOfBlock":9007199254740993', '"asOfBlock":18446744073709551616')],
  ['nonconsecutive version', (s) => s.replace('"to_version":2', '"to_version":3')],
  ['zero next version', (s) => s.replace('"to_version":2', '"to_version":0')],
  ['exhausted previous version', (s) => s.replace('"from_version":1,"to_version":2', '"from_version":18446744073709551615,"to_version":0')],
  ['zero new fingerprint', (s) => s.replace(v.toFingerprint, zeroHash)],
  ['same fingerprint', (s) => s.replace(v.toFingerprint, v.cases[1].expected.fromFingerprint)],
  ['zero prior fingerprint after initialization', (s) => s.replace(v.cases[1].expected.fromFingerprint, zeroHash)],
  ['nonzero prior fingerprint at initialization', (s) => s.replace('"from_version":1,"to_version":2', '"from_version":0,"to_version":1')],
];
test.each(malformed)('rotation rejects %s before signing', (_, change) => {
  expect(() => buildDdbDigestRotation({ ...input(), payload: enc.encode(change(v.cases[1].data)) }, opts)).toThrow(/rotation/);
});

test.each(['missing', 'zero', 'short', 'uppercase'])('preview refuses %s next fingerprint', (kind) => {
  const toFingerprint = kind === 'missing' ? undefined : kind === 'zero' ? zeroHash : kind === 'short' ? '0x22' : '0x' + 'AB'.repeat(32);
  expect(() => buildDdbDigestRotationPreview({ ...identity(), toFingerprint: toFingerprint as string }, opts)).toThrow(/fingerprint/);
});

test.each(['unsafe-number', 'negative', 'fraction', 'overflow', 'string', 'missing-expectations'])('rotation rejects invalid local expectations: %s', (kind) => {
  const i = input();
  const values: Record<string, unknown> = { 'unsafe-number': Number.MAX_SAFE_INTEGER + 1, negative: -1, fraction: 1.5, overflow: BigInt(1) << BigInt(64), string: '1' };
  if (kind === 'missing-expectations') i.expected = undefined;
  else i.expected.fromVersion = values[kind];
  expect(() => buildDdbDigestRotation(i, opts)).toThrow(/expected|uint64/);
});

test('rotation bounds and validates encoded bytes before parsing', () => {
  for (const payload of [new Uint8Array(5121), '0x' + '00'.repeat(5121), '0x1', 'not-hex', '', new Uint8Array([255])]) {
    expect(() => buildDdbDigestRotation({ ...input(), payload }, opts)).toThrow();
  }
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(v.cases[1].data)]);
  expect(() => buildDdbDigestRotation({ ...input(), payload: bom }, opts)).toThrow();
});

test('rotation uses the shared scalar validation, v2 defaults, exact nonce and chain binding', () => {
  const p = buildDdbDigestRotation(input(), { ...opts, preimageVersion: undefined, nonce: (BigInt(1) << BigInt(64)) - BigInt(1) });
  expect(p.envelope.nonce).toBe('0xffffffffffffffff');
  expect(p.envelope.type).toBe(10);
  for (const invalid of [{ preimageVersion: 1 }, { preimageVersion: 'auto' }, { chainId: undefined }, { nonce: Number.MAX_SAFE_INTEGER + 1 }, { gasLimit: -1 }, { timestamp: Date.now() }, { expiry: opts.timestamp - 1 }]) {
    const options = { ...opts, ...invalid } as DdbSignOptions;
    expect(() => buildDdbDigestRotation(input(), options)).toThrow();
    expect(() => buildDdbDigestRotationPreview({ ...identity(), toFingerprint: v.toFingerprint }, options)).toThrow();
  }
  const regular = buildDdbDigestRotation(input(), opts);
  const otherChain = buildDdbDigestRotation(input(), { ...opts, chainId: v.chainId + 1 });
  expect(otherChain.requestId).not.toBe(regular.requestId);
  expect(buildDdbDigestRotation({ ...input(), contract: '0x' + '44'.repeat(20) }, opts).requestId).not.toBe(regular.requestId);
  expect(buildDdbDigestRotation({ ...input(), from: '0x' + '44'.repeat(20) }, opts).requestId).not.toBe(regular.requestId);
  for (const field of ['contract', 'from']) {
    expect(() => buildDdbDigestRotation({ ...input(), [field]: '0x' + '00'.repeat(20) }, opts)).toThrow(/address/);
  }
});

test.each([11, 12, 13, 14, 16, 255, -1, 10.5])('shared v2 codec still refuses reserved or invalid type %s', (type) => {
  expect(() => canonicalDdbOperationBytesV2({ type, chainId: v.chainId, schemaName: v.database, data: enc.encode('{}'), from: v.from,
    timestamp: v.timestamp, gasLimit: v.gasLimit, nonce: v.nonce, expiry: v.expiry, keyVersion: 0 })).toThrow(/unknown DDB operation/);
});
