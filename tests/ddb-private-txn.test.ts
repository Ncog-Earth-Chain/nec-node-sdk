import { readFileSync } from 'fs';
import { join } from 'path';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  encodePrivateTxnMemberV1, decodePrivateTxnMemberV1, buildDdbPrivateTransaction,
  type PrivateTxnMemberV1, type BuildDdbPrivateTransactionInput,
} from '../src/ddb-private-txn';
import { DDB_COMMITMENT_PAYLOAD_MAX_BYTES } from '../src/ddb-commitment';
import { PLACEMENT_MANAGER_RUNTIME_CODE_HASH } from '../src/ddb-proof';
import { canonicalDdbTxnId, canonicalDdbTxnMemberHash, type DdbCanonicalOpV2 } from '../src/ddb';

const enc = new TextEncoder();
const dec = new TextDecoder();
const n = BigInt;
const hash = '0x' + '12'.repeat(32);
const contract = '0x' + '11'.repeat(20);
const caller = '0x' + '22'.repeat(20);
const digestKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const gas = () => ({ base_cost: n(0), per_row_read: n(0), per_row_written: n(0), per_index_used: n(0), max_gas_per_tx: n(0) });
function member(index = 0): PrivateTxnMemberV1 {
  return {
    kind: 'private-txn-member', version: n(1), index: n(index), count: n(2),
    base: {
      chain: hash, database: 'c_' + contract.slice(2), contract, caller, block: n(27),
      block_hash: hash, state_root: hash, epoch: n(3), initial_anchor: hash,
      manager: '0x' + '33'.repeat(20), manager_runtime: PLACEMENT_MANAGER_RUNTIME_CODE_HASH,
      placement_version: n(2), group_hash: hash, digest_version: n(1),
      digest_fingerprint: '0x' + bytesToHex(sha256(digestKey)),
      context: {
        definition: { contract_address: contract, contract_name: 'quotes"\\\n\t<&>🌍\u2028\u2029', version: '1', type: 'ddbPool',
          schema: { tables: [] }, procedures: [], roles: [], role_assignments: [], procedure_access: [] },
        owner: contract, tombstoned: false, caller_roles: ['Admin', 'writer', 'writer'], gas_declared: false,
        declared_gas: gas(), network_gas: gas(), schema_features: { check_constraints: false, apply_refusal: false, binding_refusal: false, signature_supersede: false },
        statement_check: { literal_aware: false, drop_superseded_function: false },
        overloads: [], confidential_columns: [], confidential_grants: new Uint8Array(),
      },
    },
    intent: { type: n(7), data: enc.encode('{"procedure":"transfer","args":[9007199254740993]}'), timestamp: n(1700000000),
      gas_limit: n(1000), nonce: n('18446744073709551615') - n(index), expiry: n(1700000300), key_version: n(1) },
    effect: { removed: [], added: [] },
    result: { columns: [{ name: 'value', type: 'pg_catalog.bytea' }], rows: [[{ null: true, value: new Uint8Array() }], [{ null: false, value: new Uint8Array() }], [{ null: false, value: Uint8Array.of(0, 255) }]], affected: n(0) },
  };
}
function input(): BuildDdbPrivateTransactionInput {
  const members = [member(0), member(1)];
  return { expectedBase: member().base, expectedIntents: members.map((m) => m.intent),
    payloads: members.map((m) => encodePrivateTxnMemberV1(m, 4)),
    salts: [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)],
    digestKey, callerPubKey: Uint8Array.of(1, 2, 3), maxMembers: 4,
    readVersion: n(27), reads: [{}] };
}

describe('private transaction V1 closed codec', () => {
  test('preserves exact integers, intent bytes, Unicode and SQL NULL', () => {
    const m = member(); m.base.block = n('9007199254740993');
    const bytes = encodePrivateTxnMemberV1(m, 4);
    expect(dec.decode(bytes)).toContain('\\u000a\\u0009<&>🌍\\u2028\\u2029');
    const got = decodePrivateTxnMemberV1(bytes, 4);
    expect(got).toEqual(m);
    expect(got.intent.nonce).toBe(n('18446744073709551615'));
    expect(encodePrivateTxnMemberV1(got, 4)).toEqual(bytes);
    got.intent.data[0] = 0;
    expect(decodePrivateTxnMemberV1(bytes, 4).intent.data[0]).toBe(123);
  });
  test('matches the complete Go interoperability fixture byte for byte', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'vectors/private-txn-member-v1.json')));
    expect(encodePrivateTxnMemberV1(decodePrivateTxnMemberV1(bytes, 4), 4)).toEqual(bytes);
  });
  test.each([
    ['duplicate', (s: string) => s.replace('"kind":', '"kind":"private-txn-member","kind":')],
    ['unknown', (s: string) => s.replace('"kind":', '"extra":false,"kind":')],
    ['whitespace', (s: string) => ' ' + s],
    ['trailing', (s: string) => s + '{}'],
    ['key order', (s: string) => s.replace('"index":"0","count":"2"', '"count":"2","index":"0"')],
    ['numeric U64', (s: string) => s.replace('"block":"27"', '"block":27')],
    ['leading zero', (s: string) => s.replace('"block":"27"', '"block":"027"')],
    ['overflow', (s: string) => s.replace('"block":"27"', '"block":"18446744073709551616"')],
    ['null array', (s: string) => s.replace('"removed":[]', '"removed":null')],
    ['alternate escape', (s: string) => s.replace('\\u000a', '\\n')],
    ['surrogate', (s: string) => s.replace('"value"', '"\\ud800"')],
    ['bad base64', (s: string) => s.replace('"AP8="', '"AP9="')],
  ])('rejects %s', (_name, change) => {
    expect(() => decodePrivateTxnMemberV1(enc.encode(change(dec.decode(encodePrivateTxnMemberV1(member(), 4)))), 4)).toThrow();
  });
  test('rejects invalid UTF8, BOM and input/output/active member bounds', () => {
    const bytes = encodePrivateTxnMemberV1(member(), 4);
    expect(encodePrivateTxnMemberV1(member(), 2)).toEqual(bytes);
    expect(() => decodePrivateTxnMemberV1(Uint8Array.from([239, 187, 191, ...bytes]), 4)).toThrow();
    expect(() => decodePrivateTxnMemberV1(Uint8Array.of(255), 4)).toThrow();
    expect(() => decodePrivateTxnMemberV1(new Uint8Array(DDB_COMMITMENT_PAYLOAD_MAX_BYTES + 1), 4)).toThrow(/bound/);
    for (const limit of [0, 1, 5, 1.5]) expect(() => encodePrivateTxnMemberV1(member(), limit)).toThrow();
    const huge = member(); huge.intent.data = new Uint8Array(DDB_COMMITMENT_PAYLOAD_MAX_BYTES);
    expect(() => encodePrivateTxnMemberV1(huge, 4)).toThrow(/bound/);
  });
  test('refuses caller-created nonwire fields, malformed scalars and context', () => {
    const invalid = member() as any; invalid.intent.txn = {};
    expect(() => encodePrivateTxnMemberV1(invalid, 4)).toThrow();
    const number = member() as any; number.intent.nonce = 1;
    expect(() => encodePrivateTxnMemberV1(number, 4)).toThrow();
    const bad = member(); bad.base.context.caller_roles.reverse();
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/roles/);
    bad.base.context.caller_roles.reverse(); bad.base.manager_runtime = hash;
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/placement/);
    bad.base.manager_runtime = PLACEMENT_MANAGER_RUNTIME_CODE_HASH; bad.base.context.tombstoned = true;
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/context/);
  });
  test('refuses malformed business effects and result shape', () => {
    const bad = member(); bad.effect.added = [enc.encode('R:broken')];
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/row/);
    bad.effect.added = []; bad.result.rows[0][0].value = Uint8Array.of(1);
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/NULL/);
    bad.result.rows[0][0].value = new Uint8Array(); bad.result.rows[0] = [];
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/width/);
    bad.result.rows = []; bad.result.columns[0].type = 'bytea';
    expect(() => encodePrivateTxnMemberV1(bad, 4)).toThrow(/qualified/);
  });
});

describe('private transaction offline builder', () => {
  test('binds ordered openings through existing operation/TXN signing primitives', () => {
    const request = input(); const built = buildDdbPrivateTransaction(request);
    expect(built.members).toHaveLength(2);
    const ops: DdbCanonicalOpV2[] = built.members.map((m) => ({ type: 15, chainId: request.expectedBase.chain,
      schemaName: request.expectedBase.database, data: Uint8Array.from(Buffer.from(m.envelope.data.slice(2), 'hex')),
      from: caller, timestamp: n(m.envelope.timestamp), gasLimit: n(m.envelope.gasLimit), nonce: n(m.envelope.nonce),
      expiry: n(m.envelope.expiry!), keyVersion: n(m.envelope.keyVersion!) }));
    const id = canonicalDdbTxnId(ops, request.readVersion, [{}]);
    expect(built.id).toBe('0x' + bytesToHex(id));
    for (let i = 0; i < 2; i++) expect(built.members[i].hash).toEqual(canonicalDdbTxnMemberHash(ops[i], id, i, 2));
    expect(built.members[0].envelope.txn.reads).toEqual([{}]);
    expect(built.members[1].envelope.txn.reads).toBeUndefined();
    expect(built.members[0].envelope.txn.read_version).toBe(27);
    expect(built.sidecars[0].payload).toBe('0x' + bytesToHex(request.payloads[0]));
  });
  test('refuses host replacement of locally retained intent bytes', () => {
    const request = input(); const host = member(); host.intent.data = enc.encode('{"procedure":"steal"}');
    request.payloads[0] = encodePrivateTxnMemberV1(host, 4);
    expect(() => buildDdbPrivateTransaction(request)).toThrow(/intent/);
  });
  test('preserves all gas uint64 bits in the signed envelope', () => {
    const request = input(); const m = member(); m.intent.gas_limit = n('18446744073709551615');
    request.expectedIntents[0] = m.intent; request.payloads[0] = encodePrivateTxnMemberV1(m, 4);
    expect(buildDdbPrivateTransaction(request).members[0].envelope.gasLimit).toBe('0xffffffffffffffff');
  });
  test('binds duplicate business effects to existing keyed tags', () => {
    const vector = decodePrivateTxnMemberV1(new Uint8Array(readFileSync(join(__dirname, 'vectors/private-txn-member-v1.json'))), 4);
    const request = input(); const m = member(); m.effect = vector.effect;
    request.payloads[0] = encodePrivateTxnMemberV1(m, 4);
    const tags = buildDdbPrivateTransaction(request).members[0].envelope.stateDelta;
    // Independent Python hashlib/hmac calculation over the fixed Go row bytes.
    expect(tags).toEqual({ added: ['EBCtfNMVnBzfD2oOXnstz7BVQ6zaH9OEHns4ETdg5BQ=', 'EBCtfNMVnBzfD2oOXnstz7BVQ6zaH9OEHns4ETdg5BQ='] });
  });
  test('refuses common base, scalar, order and count substitutions', () => {
    const variants: Array<(m: PrivateTxnMemberV1) => void> = [
      (m) => { m.base.caller = contract; }, (m) => { m.base.block += n(1); },
      (m) => { m.base.context.definition.contract_name += 'changed'; },
      (m) => { m.intent.gas_limit += n(1); }, (m) => { m.intent.nonce -= n(1); },
      (m) => { m.index = n(1); }, (m) => { m.count = n(3); },
    ];
    for (const mutate of variants) { const req = input(); const m = member(); mutate(m);
      req.payloads[0] = encodePrivateTxnMemberV1(m, 4); expect(() => buildDdbPrivateTransaction(req)).toThrow(); }
  });
  test('refuses absent/narrow/extra reads, wrong version and unsafe legacy read JSON', () => {
    for (const reads of [[], [{ table: 'accounts', pk: ['1'] }], [{}, {}], [{ pk: ['1'] }]]) {
      const req = input(); req.reads = reads; expect(() => buildDdbPrivateTransaction(req)).toThrow(/read/);
    }
    const req = input(); req.readVersion = n(28); expect(() => buildDdbPrivateTransaction(req)).toThrow(/read/);
    req.readVersion = n('9007199254740993'); req.expectedBase.block = req.readVersion;
    expect(() => buildDdbPrivateTransaction(req)).toThrow();
  });
  test('refuses wrong digest key and direct raw-data operation admission', () => {
    const req = input(); req.digestKey = new Uint8Array(32).fill(3);
    expect(() => buildDdbPrivateTransaction(req)).toThrow(/digest/);
    const raw = input(); const host = member(); host.intent.type = n(4);
    raw.expectedIntents[0] = host.intent; raw.payloads[0] = encodePrivateTxnMemberV1(host, 4);
    expect(() => buildDdbPrivateTransaction(raw)).toThrow(/procedure/);
  });
  test('refuses incomplete payload/intent/opening sets and missing signing key', () => {
    const mutations: Array<(r: BuildDdbPrivateTransactionInput) => void> = [
      (r) => { r.payloads = []; }, (r) => { r.expectedIntents.pop(); },
      (r) => { r.salts = [new Uint8Array(32)]; }, (r) => { r.salts![0] = new Uint8Array(31); },
      (r) => { r.callerPubKey = new Uint8Array(); }, (r) => { r.maxMembers = 1; },
      (r) => { r.maxMembers = 5; },
    ];
    for (const mutate of mutations) { const request = input(); mutate(request); expect(() => buildDdbPrivateTransaction(request)).toThrow(); }
  });
});
