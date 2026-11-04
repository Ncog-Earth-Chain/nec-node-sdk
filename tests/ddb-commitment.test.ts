import * as fs from 'fs';
import * as path from 'path';
import { buildDdbCommitment, deriveDdbDigestKey, encodeDdbCommitmentEnvelope, decodeDdbCommitmentEnvelope } from '../src/ddb-commitment';

const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors/place03_commitment_vector.json'), 'utf8'));
const bytes = (s: string) => new Uint8Array(Buffer.from(s.slice(2), 'hex'));
const input = () => ({ payload: bytes(v.sidecar.payload), salt: bytes(v.sidecar.salt), digestKey: bytes(v.digestKey),
  intent: { type: 5, data: { table: 'users', set: { name: 'bob' }, where: { id: 1 } } },
  contract: v.contract, from: v.from, callerPubKey: new Uint8Array([1]), placementVersion: BigInt(3), digestKeyVersion: BigInt(1) });
const opts = { chainId: v.chainId, timestamp: v.timestamp, expiry: v.expiry, gasLimit: v.gasLimit, nonce: v.nonce, preimageVersion: 2 as const };

test('HKDF, private row tags and caller-signed operation match the Go vectors exactly, including uint64 boundaries', () => {
  expect(Buffer.from(deriveDdbDigestKey(bytes(v.masterKey), v.contract)).toString('hex')).toBe(v.digestKey.slice(2));
  for (const c of v.cases) {
    const p = buildDdbCommitment({ ...input(), placementVersion: BigInt(c.placementVersion), digestKeyVersion: BigInt(c.digestKeyVersion) }, opts);
    expect(p.sidecar).toEqual(v.sidecar);
    expect(p.stateDelta).toEqual(v.stateDelta);
    expect(p.prepared.envelope.stateDelta).toEqual(v.stateDelta);
    expect(Buffer.from(p.prepared.hash).toString('hex')).toBe(c.hash.slice(2));
    expect(p.prepared.requestId).toBe(c.requestId);
    expect(Buffer.from(p.prepared.envelope.data.slice(2), 'hex').toString()).toBe(c.envelope);
    expect(p.prepared.envelope.type).toBe(15);
    expect(JSON.stringify(p.prepared)).not.toContain('alice');
    expect(decodeDdbCommitmentEnvelope(c.envelope).digestKeyVersion).toBe(BigInt(c.digestKeyVersion));
  }
});

test('fresh salts change commitments and signatures without changing deterministic row tags', () => {
  const a = buildDdbCommitment(input(), opts);
  const b = buildDdbCommitment({ ...input(), salt: new Uint8Array(32).fill(8) }, opts);
  expect(a.prepared.requestId).not.toBe(b.prepared.requestId);
  expect(a.stateDelta).toEqual(b.stateDelta);
  const c = buildDdbCommitment({ ...input(), digestKey: new Uint8Array(32).fill(9) }, opts);
  expect(c.stateDelta).not.toEqual(a.stateDelta);
});

test.each(['mutation', 'operation', 'rounded-number'])('untrusted preview cannot change the locally intended %s', (change) => {
  const i = input();
  const inner = JSON.parse(Buffer.from(i.payload).toString());
  if (change === 'mutation') inner.data.set.name = 'mallory';
  if (change === 'operation') inner.type = 7;
  if (change === 'rounded-number') { inner.data.where.id = Number.MAX_SAFE_INTEGER + 1; i.intent.data.where.id = Number.MAX_SAFE_INTEGER + 1; }
  i.payload = new TextEncoder().encode(JSON.stringify(inner));
  expect(() => buildDdbCommitment(i, opts)).toThrow(/intent|number/);
});

test('intent comparison accepts reordered object keys without changing exact committed bytes', () => {
  const i = input();
  i.intent.data = { where: { id: 1 }, set: { name: 'bob' }, table: 'users' };
  const p = buildDdbCommitment(i, opts);
  expect(p.sidecar).toEqual(v.sidecar);
  expect(p.prepared.requestId).toBe(v.cases[0].requestId);
});

test.each(['DATA', 'TYPE', 'ROLES', 'unknown', 'row-alias', 'delta-alias', 'pk-alias', 'delta-array', 'pk-type'])('private preview rejects ambiguous schema %s before signing', (change) => {
  const i = input(), inner = JSON.parse(Buffer.from(i.payload).toString());
  switch (change) {
    case 'DATA': inner.DATA = { ...inner.data, set: { name: 'changed' } }; break;
    case 'TYPE': inner.TYPE = 7; break;
    case 'ROLES': inner.ROLES = ['admin']; break;
    case 'unknown': inner.future_operation = {}; break;
    case 'row-alias': inner.write_set[0].new = inner.write_set[0].Old; break;
    case 'delta-alias': inner.state_delta = { Added: [inner.write_set[0].New] }; break;
    case 'pk-alias': inner.write_set[0].PK[0].valid = false; break;
    case 'delta-array': inner.state_delta = []; break;
    case 'pk-type': inner.write_set[0].PK[0].Valid = 'true'; break;
  }
  i.payload = new TextEncoder().encode(JSON.stringify(inner));
  expect(() => buildDdbCommitment(i, opts)).toThrow(/private|field|schema/);
});

test.each(['operation', 'escaped-key', 'sql-data', 'row', 'general-delta'])('private preview rejects duplicate %s JSON members before signing', (change) => {
  const i = input();
  let raw = Buffer.from(i.payload).toString();
  switch (change) {
    case 'operation': raw = raw.replace('"data":', '"data":{},"data":'); break;
    case 'escaped-key': raw = raw.replace('"data":', '"d\\u0061ta":{},"data":'); break;
    case 'sql-data': raw = raw.replace('"name":"bob"', '"name":"first","name":"bob"'); break;
    case 'row': raw = raw.replace('"Table":', '"Table":"other","Table":'); break;
    case 'general-delta': raw = raw.slice(0, -1) + ',"state_delta":{"added":[],"added":[]}}'; break;
  }
  i.payload = new TextEncoder().encode(raw);
  expect(() => buildDdbCommitment(i, opts)).toThrow(/duplicate/);
});

test.each(['invalid-utf8', 'byte-order-mark', 'unpaired-surrogate', 'depth'])('private preview rejects %s without changing committed bytes', (change) => {
  const i = input(), inner = JSON.parse(Buffer.from(i.payload).toString());
  if (change === 'invalid-utf8') {
    const payload = Buffer.from(i.payload);
    payload[payload.indexOf('bob')] = 255;
    i.payload = payload;
    i.intent.data.set.name = '\ufffdob';
  } else if (change === 'byte-order-mark') {
    i.payload = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(i.payload)]);
  } else if (change === 'unpaired-surrogate') {
    inner.data.set.name = '\ud800'; i.intent.data.set.name = '\ud800';
    i.payload = new TextEncoder().encode(JSON.stringify(inner));
  } else {
    let deep: unknown = 'end';
    for (let n = 0; n < 130; n++) deep = [deep];
    inner.data = deep;
    i.payload = new TextEncoder().encode(JSON.stringify(inner));
    expect(() => buildDdbCommitment({ ...i, intent: { type: 5, data: deep } }, opts)).toThrow(/depth/);
    return;
  }
  expect(() => buildDdbCommitment(i, opts)).toThrow();
});

test('private preview preserves normal Go JSON escaping, Unicode and arbitrary SQL object keys', () => {
  const i = input(), inner = JSON.parse(Buffer.from(i.payload).toString());
  const data = { procedure: 'update_profile', args: [{ DATA: '雪😀<&>', Name: 'value', 'a"b': '\\' }] };
  inner.type = 7; inner.data = data;
  inner.state_delta = { removed: [inner.write_set[0].Old], added: [inner.write_set[0].New] };
  delete inner.write_set;
  i.payload = new TextEncoder().encode(JSON.stringify(inner).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
  const result = buildDdbCommitment({ ...i, intent: { type: 7, data } }, opts);
  expect(result.sidecar.payload).toBe('0x' + Buffer.from(i.payload).toString('hex'));
  expect(result.stateDelta).toEqual(v.stateDelta);
});

test.each(['zero-key', 'short-key', 'salt', 'oversize', 'caller', 'contract', 'database', 'public-op', 'metadata', 'bad-row', 'missing-delta'])('%s refuses before signing', (kind) => {
  const i = input();
  const inner = JSON.parse(Buffer.from(i.payload).toString());
  switch (kind) {
    case 'zero-key': i.digestKey.fill(0); break;
    case 'short-key': i.digestKey = new Uint8Array(31); break;
    case 'salt': i.salt = new Uint8Array(31); break;
    case 'oversize': i.payload = new Uint8Array(131073); break;
    case 'caller': i.from = '0x' + '22'.repeat(20); break;
    case 'contract': i.contract = '0x' + '22'.repeat(20); break;
    case 'database': inner.schema_name = 'c_' + '22'.repeat(20); break;
    case 'public-op': inner.type = 0; break;
    case 'metadata': inner.roles = ['admin']; break;
    case 'bad-row': inner.write_set[0].New = Buffer.from('not a row').toString('base64'); break;
    case 'missing-delta': delete inner.write_set; delete inner.state_delta; break;
  }
  if (['database', 'public-op', 'metadata', 'bad-row', 'missing-delta'].includes(kind)) i.payload = new TextEncoder().encode(JSON.stringify(inner));
  expect(() => buildDdbCommitment(i, opts)).toThrow();
});

test('canonical envelope refuses unsafe numbers, zero digest version and alternative byte spellings', () => {
  const c = v.cases[0];
  const env = decodeDdbCommitmentEnvelope(c.envelope);
  expect(encodeDdbCommitmentEnvelope(env)).toBe(c.envelope);
  for (const bad of [c.envelope + ' ', c.envelope.replace('"digest_key_version":1', '"digest_key_version":0'), c.envelope.replace('"placement_version":3', '"placement_version":03')]) {
    expect(() => decodeDdbCommitmentEnvelope(bad)).toThrow();
  }
  expect(() => encodeDdbCommitmentEnvelope({ ...env, placementVersion: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  expect(() => encodeDdbCommitmentEnvelope({ ...env, digestKeyVersion: BigInt(1) << BigInt(64) })).toThrow();
  expect(() => buildDdbCommitment(input(), { ...opts, preimageVersion: 1 })).toThrow();
});
