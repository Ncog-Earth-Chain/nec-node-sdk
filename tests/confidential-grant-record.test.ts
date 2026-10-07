// PRIV-02d (NEC-171): necjs reads and writes the grant record (contract metadata key `confidential_grants`)
// exactly as the node checks it. tests/vectors/priv02_grant_record_vectors.json is a copy of ncogearthchain
// ddb/confidential/testdata/priv02_grant_record_vectors.json: every record case must be accepted or refused with
// the node's error name, every accepted record must re-encode to the same bytes, and the upgrade rule must agree.
import * as fs from 'fs';
import * as path from 'path';
import {
  parseGrantRecord, canonicalGrantRecord, checkGrantRecordUpgrade, findGrant, publishGrant, grantFromMetadata,
  acceptGrantFromMetadata, activeMetadataFromSchema, newGrant, recipientKeyFromSeed, newRecipientKey, GrantRecordError,
  CONFIDENTIAL_GRANTS_METADATA_KEY, DEFAULT_GRANT_RECORD_LIMITS, GRANT_RECORD_VERSION, GrantRecord,
} from '../src/confidential';

const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'priv02_grant_record_vectors.json'), 'utf8'));
const hx = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

function code(f: () => unknown): string {
  try {
    f();
    return '';
  } catch (e: unknown) {
    return e instanceof GrantRecordError ? e.code : `not a GrantRecordError: ${String(e)}`;
  }
}
const parseText = (t: string | null | undefined): GrantRecord | null => (t === null || t === undefined || t === 'null' ? null : parseGrantRecord(t));

describe('PRIV-02d grant record vectors (same verdicts as Go)', () => {
  it('pins the metadata key, the version and the default bounds', () => {
    expect(CONFIDENTIAL_GRANTS_METADATA_KEY).toBe(V.metadataKey);
    expect(GRANT_RECORD_VERSION).toBe(1);
    expect(DEFAULT_GRANT_RECORD_LIMITS).toEqual(V.defaultLimits);
  });

  it('accepts or refuses every record case with the node\'s error name', () => {
    expect(V.records.length).toBeGreaterThanOrEqual(30);
    for (const c of V.records) {
      // the node sees metadata as a decoded JSON value; the SDK may hold either form
      const lim = c.limits ?? DEFAULT_GRANT_RECORD_LIMITS;
      expect({ name: c.name, got: code(() => parseGrantRecord(c.record, lim)) }).toEqual({ name: c.name, got: c.error });
      let value: unknown;
      try { value = JSON.parse(c.record); } catch { continue; }
      expect({ name: c.name, got: code(() => parseGrantRecord(value, lim)) }).toEqual({ name: c.name, got: c.error });
    }
  });

  it('re-encodes the canonical vector byte for byte, and every accepted record to a canonical fixpoint', () => {
    expect(canonicalGrantRecord(parseGrantRecord(V.canonical.record))).toBe(V.canonical.record);
    for (const c of V.records.filter((r: any) => r.error === '')) {
      // the node accepts a value-equal spelling (3.0, whitespace, key order); what a writer emits is canonical
      const lim = c.limits ?? DEFAULT_GRANT_RECORD_LIMITS;
      const once = canonicalGrantRecord(parseGrantRecord(c.record, lim));
      expect({ name: c.name, again: canonicalGrantRecord(parseGrantRecord(once, lim)) }).toEqual({ name: c.name, again: once });
      expect(once).toBe(JSON.stringify(JSON.parse(once))); // no whitespace
    }
  });

  it('applies the append-only upgrade rule like the node', () => {
    for (const c of V.upgrades) {
      const got = code(() => checkGrantRecordUpgrade(parseText(c.stored), parseText(c.next)));
      expect({ name: c.name, got }).toEqual({ name: c.name, got: c.error });
    }
  });

  it('a reader discovers its wrapped key from the record and opens the epoch', async () => {
    const d = V.discovery;
    const reader = recipientKeyFromSeed(hx(d.readerSeed));
    const metadata = { [CONFIDENTIAL_GRANTS_METADATA_KEY]: JSON.parse(d.record) };
    const epoch = await acceptGrantFromMetadata(reader, metadata, BigInt(d.chainId), hx(d.contract), d.group, Number(d.epoch));
    expect(Buffer.from(epoch.key).toString('hex')).toBe(d.dmk);
    expect(epoch.n).toBe(Number(d.epoch));
    expect(grantFromMetadata(metadata, d.group, 999)).toBeNull();
  });
});

describe('PRIV-02d publishing a grant (the wallet "open epoch" write)', () => {
  const chainId = BigInt(4003);
  const contract = hx('2c224edad544bbafdbffa39ecc4be480539f6ec0');

  it('appends to the metadata in canonical form, keeps other keys, and a reader finds it', async () => {
    const r1 = newRecipientKey();
    const r2 = newRecipientKey();
    const g1 = await newGrant(chainId, contract, 'default', 1, [r1.ek]);
    const m1 = publishGrant({ confidential_columns: { t: ['c'] } }, 'default', g1.grant);
    expect(m1.confidential_columns).toEqual({ t: ['c'] });
    const g2 = await newGrant(chainId, contract, 'default', 2, [r2.ek]);
    const m2 = publishGrant(m1, 'default', g2.grant);
    const rec = parseGrantRecord(m2[CONFIDENTIAL_GRANTS_METADATA_KEY]);
    expect(rec.grants.map((e: { epoch: number }) => e.epoch)).toEqual([1, 2]);
    expect(code(() => checkGrantRecordUpgrade(parseGrantRecord(m1[CONFIDENTIAL_GRANTS_METADATA_KEY]), rec))).toBe('');
    expect((await acceptGrantFromMetadata(r2, m2, chainId, contract, 'default', 2)).key).toEqual(g2.epoch.key);
    expect(findGrant(rec, 'default', 1)).not.toBeNull();
  });

  it('refuses to republish an epoch or to publish an older one', async () => {
    const r = newRecipientKey();
    const g3 = await newGrant(chainId, contract, 'default', 3, [r.ek]);
    const m = publishGrant(undefined, 'default', g3.grant);
    const again = await newGrant(chainId, contract, 'default', 3, [r.ek]);
    expect(code(() => publishGrant(m, 'default', again.grant))).toBe('changed');
    const older = await newGrant(chainId, contract, 'default', 2, [r.ek]);
    expect(code(() => publishGrant(m, 'default', older.grant))).toBe('epochNotNewer');
  });
});

describe('PRIV-02d reading the record from ddb_getSchema', () => {
  it('takes the ACTIVE version\'s metadata from spec_json', () => {
    const info = { contracts: [{ versions: [
      { status: 'superseded', spec_json: JSON.stringify({ metadata: { v: 1 } }) },
      { status: 'active', spec_json: JSON.stringify({ metadata: { v: 2 } }) },
    ] }] };
    expect(activeMetadataFromSchema(info)).toEqual({ v: 2 });
    expect(activeMetadataFromSchema({ contracts: [{ versions: [{ status: 'pending', spec_json: '{}' }] }] })).toBeUndefined();
    expect(activeMetadataFromSchema({})).toBeUndefined();
  });
});
