/**
 * The signed read-procedure preimage (ddb_signedCallReadProcedure, REL-02b / NEC-140), and the helpers
 * that use it.
 *
 * Checked against the node's OWN pinned constants, copied verbatim from
 * ncogearthchain/ethapi/ddb_signed_read_procedure_test.go TestSignedReadProcedureHashGoldenVector,
 * which pins ethapi.SignedReadProcedureHash:
 *
 *   "NEC-DDB-READPROC\x01"                17 bytes, domain + version
 *   chainID                               32 bytes, big-endian, left-padded (a uint256 word)
 *   u64be(len(schemaName)) || schemaName
 *   u64be(len(procedure))  || procedure
 *   u64be(len(args))                       the COUNT of arguments
 *     u64be(len(args[i])) || args[i]       each, in call order
 *   from                                  20 bytes
 *   u64be(timestamp)
 *   u64be(nonce)
 *   SignedReadProcedureHash = keccak256(all of it)
 *
 * Nothing here is computed by the SDK's encoder and then compared with itself.
 */
import {
  Ddb, buildDdbSignedReadProcedure, canonicalDdbSignedReadProcedureBytes, canonicalDdbSignedReadProcedureHash,
  canonicalDdbSignedReadBytes, privateKeyDdbSigner,
} from '../src/ddb';

// From TestSignedReadProcedureHashGoldenVector -- the node's constants, not ours.
const CHAIN_ID = 2479;
const FROM = '0x000000000000000000000000000000000000abcd';
const SCHEMA = 'c_users';
const PROCEDURE = 'orders_by_status';
const ARGS = ['open', '7'];
const TS = 1234567890;
const NONCE = BigInt('0x0102030405060708');
const WANT_PREIMAGE = '4e45432d4444422d5245414450524f430100000000000000000000000000000000000000000000000000000000000009af0000000000000007635f757365727300000000000000106f72646572735f62795f737461747573000000000000000200000000000000046f70656e000000000000000137000000000000000000000000000000000000abcd00000000499602d20102030405060708';
const WANT_HASH = 'ce735eec8bfed02e75ba4a47a2862de32aa1b324f492950de4e1a4ec3cbcdc89';
const WANT_NOARGS_HASH = '3833dda30b864a686cc0a5d0aefb39fe2faa717b433570a6c8bb4d8d7ff8f378';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

async function mldsa() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  return (noblePQ.default || noblePQ).ml_dsa87;
}

async function deterministicKey() {
  const m = await mldsa();
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 5 + 11) & 0xff;
  const kp = m.keygen(seed);
  return { skHex: Buffer.from(kp.secretKey).toString('hex'), pub: kp.publicKey as Uint8Array };
}

function recordingProvider(calls: { method: string; params: any[] }[], chainId: string = '0x9af') {
  return {
    send: (method: string, params: any[]) => {
      calls.push({ method, params });
      return Promise.resolve(method === 'eth_chainId' ? chainId : [{ note: 'x' }]);
    },
  } as any;
}

describe('signed read-procedure preimage matches the node golden vector', () => {
  it('preimage and hash', () => {
    expect(hex(canonicalDdbSignedReadProcedureBytes(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, FROM, TS, NONCE))).toBe(WANT_PREIMAGE);
    expect(hex(canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, FROM, TS, NONCE))).toBe(WANT_HASH);
  });

  it('no-argument form: count 0, nothing after it', () => {
    expect(hex(canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, [], FROM, TS, NONCE))).toBe(WANT_NOARGS_HASH);
  });

  it('every field moves the hash, and entries are delimited', () => {
    const variants = [
      canonicalDdbSignedReadProcedureHash(1, SCHEMA, PROCEDURE, ARGS, FROM, TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, 'c_users2', PROCEDURE, ARGS, FROM, TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, 'orders_by_status2', ARGS, FROM, TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ['open', '8'], FROM, TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ['7', 'open'], FROM, TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, '0x0000000000000000000000000000000000000001', TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, FROM, TS + 1, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, FROM, TS, NONCE + BigInt(1)),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ['openx7'], FROM, TS, NONCE),
      canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, [''], FROM, TS, NONCE),
    ].map(hex);
    for (const v of variants) expect(v).not.toBe(WANT_HASH);
    expect(new Set([...variants, WANT_NOARGS_HASH]).size).toBe(variants.length + 1);
  });

  it('is a different domain from NEC-DDB-READ: with no args the preimages differ ONLY in the prefix', () => {
    const proc = canonicalDdbSignedReadProcedureBytes(CHAIN_ID, SCHEMA, 'orders', [], FROM, TS, NONCE);
    const read = canonicalDdbSignedReadBytes(CHAIN_ID, SCHEMA, 'orders', [], FROM, TS, NONCE);
    expect(hex(proc.slice(0, 17))).toBe(hex(new TextEncoder().encode('NEC-DDB-READPROC\x01')));
    expect(hex(read.slice(0, 13))).toBe(hex(new TextEncoder().encode('NEC-DDB-READ\x02')));
    expect(hex(proc.slice(17))).toBe(hex(read.slice(13)));
    expect(hex(proc)).not.toBe(hex(read));
  });
});

describe('buildDdbSignedReadProcedure', () => {
  it('builds the envelope the node parses, omitting args when there are none', () => {
    const pub = new Uint8Array([1, 2, 3]);
    const a = buildDdbSignedReadProcedure(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, FROM, pub, { timestamp: TS, nonce: NONCE });
    expect(hex(a.hash)).toBe(WANT_HASH);
    expect(a.envelope).toEqual({
      schemaName: SCHEMA, procedure: PROCEDURE, args: ARGS, from: FROM,
      timestamp: '0x499602d2', nonce: '0x102030405060708', callerPubKey: '0x010203',
    });
    const b = buildDdbSignedReadProcedure(CHAIN_ID, SCHEMA, PROCEDURE, [], FROM, pub, { timestamp: TS, nonce: NONCE });
    expect(b.envelope.args).toBeUndefined();
    expect(hex(b.hash)).toBe(WANT_NOARGS_HASH);
  });

  it('refuses a milliseconds timestamp, a missing name and more args than a procedure can take', () => {
    const pub = new Uint8Array([1]);
    expect(() => buildDdbSignedReadProcedure(CHAIN_ID, SCHEMA, PROCEDURE, [], FROM, pub, { timestamp: Date.now() })).toThrow(/milliseconds/);
    expect(() => buildDdbSignedReadProcedure(CHAIN_ID, SCHEMA, '', [], FROM, pub)).toThrow(/procedure/);
    expect(() => buildDdbSignedReadProcedure(CHAIN_ID, SCHEMA, PROCEDURE, new Array(101).fill('x'), FROM, pub)).toThrow(/at most 100/);
  });
});

describe('Ddb.signedCallReadProcedure', () => {
  it('signs the call with the chain id it asked the node for', async () => {
    const { skHex, pub } = await deterministicKey();
    const m = await mldsa();
    const calls: { method: string; params: any[] }[] = [];
    const rows = await new Ddb(recordingProvider(calls))
      .signedCallReadProcedure(skHex, SCHEMA, PROCEDURE, ARGS, { timestamp: TS, nonce: NONCE });
    expect(rows).toEqual([{ note: 'x' }]);
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId', 'ddb_signedCallReadProcedure']);
    expect(calls[1].params.length).toBe(1);
    const [envelope] = calls[1].params;
    const from = await privateKeyDdbSigner(skHex).getAddress();
    expect(envelope).toMatchObject({ schemaName: SCHEMA, procedure: PROCEDURE, args: ARGS, from });
    expect(envelope.callerPubKey).toBe('0x' + hex(pub));

    const sig = Buffer.from(envelope.callerSig.slice(2), 'hex');
    expect(m.verify(pub, canonicalDdbSignedReadProcedureHash(CHAIN_ID, SCHEMA, PROCEDURE, ARGS, from, TS, NONCE), sig)).toBe(true);
    // Not valid for another network.
    expect(m.verify(pub, canonicalDdbSignedReadProcedureHash(1, SCHEMA, PROCEDURE, ARGS, from, TS, NONCE), sig)).toBe(false);
  });

  it('uses an explicit chainId without asking the node', async () => {
    const { skHex } = await deterministicKey();
    const calls: { method: string; params: any[] }[] = [];
    await new Ddb(recordingProvider(calls)).signedCallReadProcedure(skHex, SCHEMA, PROCEDURE, [], { chainId: CHAIN_ID });
    expect(calls.map((c) => c.method)).toEqual(['ddb_signedCallReadProcedure']);
    expect(calls[0].params[0].args).toBeUndefined();
  });
});
