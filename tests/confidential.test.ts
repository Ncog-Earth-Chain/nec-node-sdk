// PRIV-02 (NEC-84): necjs reproduces the node's golden vectors byte for byte
// (tests/vectors/priv02_vectors.json is a copy of ncogearthchain ddb/confidential/testdata/priv02_vectors.json),
// and the tamper / swap / replay / restore properties hold here as they do in Go.
import * as fs from 'fs';
import * as path from 'path';
import { keyFromSeed, encapsulate, decapsulate } from '../src/confidential/mlkem1024';
import {
  identityFromAccountSeed, recipientKeyFromSeed, newRecipientKey, newGrant, acceptGrant, encodeGrant, decodeGrant,
  slotContext, commitment, seal, open, columnKey, cellAad, checkSuccessor, restoreKeystore, backupKeystore,
  identityDigest, lastResortDigest, poolDigest, grantRef, ConfidentialError, Cell, Epoch, PURPOSE_READER, MAX_SEALS_PER_EPOCH,
} from '../src/confidential';

const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'priv02_vectors.json'), 'utf8'));
const hx = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const cellOf = (c: any): Cell => ({ chainId: BigInt(c.chainId), contract: hx(c.contract), table: c.table, column: c.column, pk: c.pk ?? [] });
const epochs = (n: number, key: Uint8Array) => new Map<number, Epoch>([[n, { n, key, seals: BigInt(0) }]]);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return e instanceof ConfidentialError ? e.code : String(e);
  }
}

describe('PRIV-02 golden vectors (byte for byte with Go)', () => {
  it('ML-KEM-1024: keygen, encapsulation and decapsulation', () => {
    for (const k of V.kem) {
      const { ek, dk } = keyFromSeed(hx(k.seed));
      expect(toHex(ek)).toBe(k.ek);
      const { sharedKey, ciphertext } = encapsulate(ek, hx(k.m));
      expect(toHex(ciphertext)).toBe(k.ct);
      expect(toHex(sharedKey)).toBe(k.ss);
      expect(toHex(decapsulate(dk, hx(k.ct)))).toBe(k.ss);
    }
  });

  it('identity derivation from the account seed', () => {
    const id = identityFromAccountSeed(hx(V.identity.accountSeed), BigInt(V.identity.chainId), hx(V.identity.account), V.identity.keyVersion);
    expect(toHex(id.seed)).toBe(V.identity.seed);
    expect(toHex(id.ek)).toBe(V.identity.ek);
  });

  it('grant: same bytes, and both holders open it to the vector key', async () => {
    const g = V.grant;
    const reader = recipientKeyFromSeed(hx(g.readerSeed));
    const recov = recipientKeyFromSeed(hx(g.recoverySeed));
    expect(toHex(slotContext(BigInt(g.chainId), hx(g.contract), g.group, g.epoch, PURPOSE_READER))).toBe(g.readerContext);
    expect(toHex(commitment(hx(g.dmk)))).toBe(g.commitment);
    const { grant } = await newGrant(BigInt(g.chainId), hx(g.contract), g.group, g.epoch, [reader.ek], [recov.ek], { dmk: hx(g.dmk), m: g.m.map(hx) });
    expect(toHex(encodeGrant(grant))).toBe(g.encoded);
    const parsed = decodeGrant(hx(g.encoded));
    for (const k of [reader, recov]) {
      const e = await acceptGrant(k, parsed, BigInt(g.chainId), hx(g.contract), g.group);
      expect(toHex(e.key)).toBe(g.dmk);
    }
  });

  it('envelopes: column key, AAD and envelope bytes; and they open', async () => {
    for (const e of V.envelopes) {
      const c = cellOf(e.cell);
      expect(toHex(columnKey(hx(e.dmk), c))).toBe(e.columnKey);
      expect(toHex(cellAad(c, hx(e.envelope).subarray(0, 14)))).toBe(e.aad);
      const env = await seal({ n: e.epoch, key: hx(e.dmk), seals: BigInt(0) }, c, BigInt(e.cellVersion), hx(e.value), hx(e.nonce));
      expect(toHex(env)).toBe(e.envelope);
      const got = await open(epochs(e.epoch, hx(e.dmk)), c, hx(e.envelope));
      expect(toHex(got.value)).toBe(e.value);
      expect(got.cellVersion).toBe(BigInt(e.cellVersion));
    }
  });

  it('negative vectors fail with the same error as Go', async () => {
    for (const n of V.negative) {
      const got = await code(open(epochs(n.epoch, hx(n.dmk)), cellOf(n.cell), hx(n.envelope), BigInt(n.minVersion)));
      expect(`${n.name}: ${got}`).toBe(`${n.name}: ${n.error}`);
    }
  });

  it('keystore backup: restores the Go blob and re-creates it byte for byte', async () => {
    const b = V.backup;
    const id = identityFromAccountSeed(hx(b.accountSeed), BigInt(b.chainId), hx(b.account), b.keyVersion);
    const ks = await restoreKeystore(id, hx(b.blob));
    expect(ks.pool.map((k) => toHex(k.seed))).toEqual([b.poolSeed]);
    expect(ks.epochs).toHaveLength(1);
    expect(toHex(ks.epochs[0].epoch.key)).toBe(b.dmk);
    expect(ks.epochs[0].epoch.seals).toBe(BigInt(b.seals));
    // Go's backup randomness is SHA-256("PRIV02-vector:backup:" ‖ i) blocks: bk = first 32 bytes, nonce = next 12.
    const { sha256 } = await import('@noble/hashes/sha256');
    const blk = (label: string, i: number) => sha256(new Uint8Array([...Buffer.from(`PRIV02-vector:${label}:`), i]));
    const stream = new Uint8Array([...blk('backup', 0), ...blk('backup', 1)]);
    const m = blk('backupM', 0);
    const again = await backupKeystore(ks, { bk: stream.slice(0, 32), nonce: stream.slice(32, 44), m });
    expect(toHex(again)).toBe(b.blob);
    const other = identityFromAccountSeed(hx(b.accountSeed), BigInt(b.chainId), hx(b.account), b.keyVersion + 1);
    expect(await code(restoreKeystore(other, hx(b.blob)))).toBe('backup');
  });

  it('directory digests and the grant reference', () => {
    const d = V.directory;
    const chain = BigInt(d.chainId);
    expect(toHex(identityDigest(chain, hx(d.directory), hx(d.account), d.keyVersion, hx(d.ek)))).toBe(d.identityDigest);
    expect(toHex(lastResortDigest(chain, hx(d.directory), hx(d.account), d.keyVersion, hx(V.kem[0].ek)))).toBe(d.lastResortDigest);
    expect(toHex(poolDigest(chain, hx(d.directory), hx(d.account), d.keyVersion, d.firstIndex, d.poolEks.map(hx)))).toBe(d.poolDigest);
    expect(toHex(grantRef(chain, hx(d.contract), d.group, d.epoch))).toBe(d.grantRef);
  });
});

describe('PRIV-02 properties in necjs', () => {
  const cell: Cell = { chainId: BigInt(4003), contract: new Uint8Array(20).fill(7), table: 'patients', column: 'diagnosis', pk: ['42'] };

  it('random round trip through a fresh grant; tamper, swap, replay and budget fail', async () => {
    const reader = newRecipientKey();
    const { grant, epoch } = await newGrant(cell.chainId, cell.contract, 'default', 1, [reader.ek]);
    const mine = await acceptGrant(reader, decodeGrant(encodeGrant(grant)), cell.chainId, cell.contract, 'default');
    const v1 = await seal(epoch, cell, BigInt(1), new TextEncoder().encode('hypertension'));
    const v2 = await seal(epoch, cell, BigInt(2), new TextEncoder().encode('none'));
    const held = new Map([[1, mine]]);
    expect(new TextDecoder().decode((await open(held, cell, v1)).value)).toBe('hypertension');
    for (let i = 0; i < v1.length; i++) {
      const bad = Uint8Array.from(v1);
      bad[i] ^= 1;
      expect(await code(open(held, cell, bad))).not.toBe('');
    }
    expect(await code(open(held, { ...cell, pk: ['43'] }, v1))).toBe('auth');
    expect(await code(open(held, { ...cell, column: 'notes' }, v1))).toBe('auth');
    expect(await code(open(held, cell, v1, BigInt(2)))).toBe('stale');
    expect(() => checkSuccessor(v1, v2)).not.toThrow();
    expect(() => checkSuccessor(v2, v1)).toThrow(ConfidentialError);
    expect(await code(seal({ n: 1, key: epoch.key, seals: MAX_SEALS_PER_EPOCH }, cell, BigInt(3), new Uint8Array(1)))).toBe('nonceBudget');
    expect(await code(acceptGrant(newRecipientKey(), grant, cell.chainId, cell.contract, 'default'))).toBe('notAGrantMember');
    expect(await code(acceptGrant(reader, { ...grant, epoch: 2 }, cell.chainId, cell.contract, 'default'))).toBe('unwrap');
  }, 60000);
});
