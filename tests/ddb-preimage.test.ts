/**
 * The exact bytes a DDB operation is signed over, and the exact bytes that reach the node.
 *
 * This is the one failure mode a wallet cannot detect for itself: an ML-DSA-87 signature over the
 * WRONG preimage is a perfectly valid ML-DSA-87 signature. Nothing local objects. The node recomputes
 * gossip/ddb.CanonicalOperationHash from the envelope it received, finds a different 32 bytes, and
 * answers "caller signature verification failed" without saying which field disagreed. Every off-node
 * signer in this ecosystem has already been wrong here once: necjs shipped a preimage with no nonce
 * while its test pinned a constant of its own, and the node's test pinned another, and both suites
 * were green for as long as the SDK could not sign one operation the chain would accept.
 *
 * So nothing below is compared against the SDK's own encoder. `refPreimage` is transcribed by hand
 * from ncogearthchain/gossip/ddb/canonical.go:
 *
 *   b = "NEC-DDB-OP\x01"
 *   b = append(b, byte(op.Type))
 *   b = appendLenPrefixed(b, []byte(op.SchemaName))   // u64BE length, then bytes
 *   b = appendLenPrefixed(b, []byte(op.Data))
 *   b = append(b, op.From.Bytes()...)                 // fixed 20 bytes
 *   b = appendU64(b, op.Timestamp)
 *   b = appendU64(b, op.GasLimit)
 *   b = appendU64(b, op.Nonce)
 *   CanonicalOperationHash = crypto.Keccak256Hash(b)
 *
 * and it is hashed with ethers' keccak256. Be precise about what that buys, because an earlier version
 * of this header was not: ethers' keccak is NOT a second implementation. It is a separately-installed
 * copy of the SAME library --
 *
 *   node_modules/ethers/lib.commonjs/crypto/keccak.js:9  require("@noble/hashes/sha3")
 *   -> node_modules/ethers/node_modules/@noble/hashes/sha3.js   (1.3.2)
 *   vs the SDK's own                                             (1.8.0)
 *
 * -- so it catches a regression in one installed copy, and would NOT catch a design error shared by
 * both. The independence that actually matters here is the encoder above (hand-transcribed, sharing no
 * code with src/ddb.ts) checked against the node's OWN pinned golden constants, which are reproduced
 * verbatim below. Those constants come from the Go tree, not from any JS.
 *
 * The mutants below are the same encoder with one field dropped, moved or truncated -- each is a shape
 * a signer has plausibly shipped -- and every one must disagree with the SDK.
 */
import { ethers } from 'ethers';
import {
  Ddb,
  buildDdbOp,
  canonicalDdbOperationHash,
  canonicalDdbRequestId,
  privateKeyDdbSigner,
} from '../src/ddb';

// ---------------------------------------------------------------------------
// an independent reading of the wire format
// ---------------------------------------------------------------------------

const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const utf8 = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) { out.set(x, o); o += x.length; }
  return out;
};

/** Go binary.BigEndian.PutUint64. */
function u64(v: number | bigint): Uint8Array {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(v));
  return Uint8Array.from(b);
}
/** Go appendLenPrefixed: an 8-byte big-endian length, then the bytes. */
function lp(b: Uint8Array): Uint8Array {
  return cat(u64(b.length), b);
}
/** ethers' keccak-256: a separately-installed copy of @noble/hashes (1.3.2), not a second implementation. */
function keccak(b: Uint8Array): Uint8Array {
  return bytes(ethers.keccak256(b));
}

interface Op {
  type: number;
  schemaName: string;
  data: Uint8Array;
  from: string;
  timestamp: number | bigint;
  gasLimit: number | bigint;
  nonce: number | bigint;
}

/** Which piece of the encoding to break. `undefined` = the faithful encoding. */
type Mutation =
  | 'dropDomain'
  | 'dropVersionByte'
  | 'dropType'
  | 'dropSchemaLengthPrefix'
  | 'dropDataLengthPrefix'
  | 'swapSchemaAndData'
  | 'dropFrom'
  | 'dropTimestamp'
  | 'dropGasLimit'
  | 'dropNonce'
  | 'nonceBeforeGasLimit'
  | 'nonceLittleEndian'
  | 'timestampAsU32';

function refPreimage(op: Op, mut?: Mutation): Uint8Array {
  const parts: Uint8Array[] = [];

  if (mut !== 'dropDomain') {
    parts.push(utf8('NEC-DDB-OP'));
    if (mut !== 'dropVersionByte') parts.push(Uint8Array.of(0x01));
  }
  if (mut !== 'dropType') parts.push(Uint8Array.of(op.type & 0xff));

  const schema = utf8(op.schemaName);
  const data = op.data;
  if (mut === 'swapSchemaAndData') {
    parts.push(lp(data), lp(schema));
  } else {
    parts.push(mut === 'dropSchemaLengthPrefix' ? schema : lp(schema));
    parts.push(mut === 'dropDataLengthPrefix' ? data : lp(data));
  }

  if (mut !== 'dropFrom') parts.push(bytes(op.from));

  if (mut === 'timestampAsU32') {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(Number(op.timestamp));
    parts.push(Uint8Array.from(b));
  } else if (mut !== 'dropTimestamp') {
    parts.push(u64(op.timestamp));
  }

  const nonceBytes = mut === 'nonceLittleEndian'
    ? Uint8Array.from(Buffer.from(u64(op.nonce)).reverse())
    : u64(op.nonce);

  if (mut === 'nonceBeforeGasLimit') {
    parts.push(nonceBytes, u64(op.gasLimit));
  } else {
    if (mut !== 'dropGasLimit') parts.push(u64(op.gasLimit));
    if (mut !== 'dropNonce') parts.push(nonceBytes);
  }

  return cat(...parts);
}

const refHash = (op: Op, mut?: Mutation) => keccak(refPreimage(op, mut));

const sdkHash = (op: Op) =>
  canonicalDdbOperationHash(op.type, op.schemaName, op.data, op.from, op.timestamp, op.gasLimit, op.nonce);

// The node's own golden operation (gossip/ddb/canonical_golden_test.go).
const GOLDEN: Op = {
  type: 0,
  schemaName: 'users',
  data: utf8('{"a":1}'),
  from: '0x000000000000000000000000000000000000abcd',
  timestamp: 1234567890,
  gasLimit: 100000,
  nonce: 0,
};

async function mldsa() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  return (noblePQ.default || noblePQ).ml_dsa87;
}
async function fixedKey() {
  const m = await mldsa();
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
  const kp = m.keygen(seed);
  return {
    sk: kp.secretKey as Uint8Array,
    pub: kp.publicKey as Uint8Array,
    skHex: Buffer.from(kp.secretKey).toString('hex'),
  };
}

// ---------------------------------------------------------------------------

describe('the canonical operation preimage, byte for byte', () => {
  it('is exactly the 84 bytes the chain encodes for the golden operation', () => {
    // Spelled out in full rather than as a hash, so a reader can check the field boundaries by eye:
    //   4e45432d4444422d4f50 01                  "NEC-DDB-OP" + version
    //   00                                       type 0 (createschema)
    //   0000000000000005 7573657273              len(5) "users"
    //   0000000000000007 7b2261223a317d          len(7) {"a":1}
    //   000000000000000000000000000000000000abcd from (20 bytes)
    //   00000000499602d2                         timestamp 1234567890
    //   00000000000186a0                         gasLimit 100000
    //   0000000000000000                         nonce 0
    expect(hex(refPreimage(GOLDEN))).toBe(
      '0x4e45432d4444422d4f5001' +
      '00' +
      '0000000000000005' + '7573657273' +
      '0000000000000007' + '7b2261223a317d' +
      '000000000000000000000000000000000000abcd' +
      '00000000499602d2' +
      '00000000000186a0' +
      '0000000000000000',
    );
    expect(refPreimage(GOLDEN).length).toBe(84);
  });

  it('hashes to the value the node pinned in Go', () => {
    // gossip/ddb/canonical_golden_test.go, `want`.
    expect(hex(refHash(GOLDEN))).toBe('0xdf419c1221e0ffccf8674d9d6401446731e1fbe0724e2bfdadd19581f3b530e5');
    // ...and the SDK agrees with the independent encoder, not merely with the constant.
    expect(hex(sdkHash(GOLDEN))).toBe(hex(refHash(GOLDEN)));
  });

  it('hashes to the node vector with the nonce carrying real bytes', () => {
    // `want2`: the vector that pins the nonce's POSITION and byte order, not merely its presence.
    const op = { ...GOLDEN, nonce: BigInt('0x0102030405060708') };
    expect(hex(refHash(op))).toBe('0x39630961e2d666eb29bdbaf969e18f61f0ac367cc969a5bf55d04c70375a16c9');
    expect(hex(sdkHash(op))).toBe(hex(refHash(op)));
  });

  it('agrees with the independent encoder across a spread of operations', () => {
    const ops: Op[] = [
      GOLDEN,
      { ...GOLDEN, type: 1, schemaName: 'c_0000000000000000000000000000000000abcdef' },
      { ...GOLDEN, type: 2, data: utf8('{}') },
      {
        ...GOLDEN,
        type: 7,
        data: utf8('{"procedure":"transfer","args":["alice","500"]}'),
        nonce: BigInt('0xfedcba9876543210'),
      },
      { ...GOLDEN, type: 8, schemaName: '', data: new Uint8Array(), timestamp: 0, gasLimit: 0, nonce: 0 },
      { ...GOLDEN, type: 9, schemaName: 'unicode check', data: utf8('{"k":"v"}'), timestamp: BigInt('0xffffffffffffffff') },
    ];
    for (const op of ops) expect(hex(sdkHash(op))).toBe(hex(refHash(op)));
  });
});

describe('every mutation of the preimage disagrees with the SDK', () => {
  // Each of these is a shape an off-node signer has plausibly shipped. If the SDK ever matches one of
  // them, it is producing signatures the node will reject -- and `dropNonce` in particular is not
  // hypothetical: it is what necjs actually shipped.
  const mutations: Array<[Mutation, string]> = [
    ['dropDomain', 'no domain-separation prefix'],
    ['dropVersionByte', 'domain without the version byte'],
    ['dropType', 'operation type omitted'],
    ['dropSchemaLengthPrefix', 'schemaName concatenated without its length'],
    ['dropDataLengthPrefix', 'data concatenated without its length'],
    ['swapSchemaAndData', 'schemaName and data in the wrong order'],
    ['dropFrom', 'caller address omitted'],
    ['dropTimestamp', 'timestamp omitted'],
    ['dropGasLimit', 'gasLimit omitted'],
    ['dropNonce', 'nonce omitted -- the replay bug necjs shipped'],
    ['nonceBeforeGasLimit', 'nonce placed before gasLimit'],
    ['nonceLittleEndian', 'nonce encoded little-endian'],
    ['timestampAsU32', 'timestamp as a 4-byte field'],
  ];

  // A non-zero nonce and a non-zero gasLimit, so no mutation can coincide with the faithful encoding
  // by accident.
  const op: Op = { ...GOLDEN, gasLimit: 100000, nonce: BigInt('0x0102030405060708') };

  it.each(mutations)('%s (%s) produces a different hash', (mut) => {
    expect(hex(refHash(op, mut as Mutation))).not.toBe(hex(sdkHash(op)));
  });

  it('the faithful encoding, by contrast, matches', () => {
    expect(hex(refHash(op))).toBe(hex(sdkHash(op)));
  });
});

describe('the bytes that actually reach the node', () => {
  it('carries a signature the node will verify over the independently-derived hash', async () => {
    const m = await mldsa();
    const { skHex, pub } = await fixedKey();

    const sent: any[] = [];
    const provider: any = {
      send: (_method: string, params: any[]) => { sent.push(params[0]); return Promise.resolve('0xc0ffee'); },
    };

    const schemaName = 'c_0000000000000000000000000000000000abcdef';
    const opts = { timestamp: 1700000000, gasLimit: 100000, nonce: 0x2a };
    await new Ddb(provider).callProcedureSigned(skHex, schemaName, 'transfer', ['alice', '500'], opts);

    expect(sent).toHaveLength(1);
    const env = sent[0];

    // Reconstruct the operation FROM THE ENVELOPE -- the same fields, read the same way, that
    // ethapi.SubmitSignedOp reads before it calls VerifyCallerSignature.
    const fromEnvelope: Op = {
      type: 7, // "callprocedure" -> inter.DdbCallProcedure
      schemaName: env.schemaName,
      data: bytes(env.data),
      from: env.from,
      timestamp: BigInt(env.timestamp),
      gasLimit: BigInt(env.gasLimit),
      nonce: BigInt(env.nonce),
    };
    const expected = refHash(fromEnvelope);

    // This is the node's check, run locally: ValidateMLDsa87Signature(pub, CanonicalOperationHash(op), sig).
    expect(m.verify(bytes(env.callerPubKey), expected, bytes(env.callerSig))).toBe(true);

    // ...and it is the right identity: address = keccak256(rawMLDSAPubkey)[12:], cryptod.PubkeyToAddress.
    expect(env.from.toLowerCase()).toBe(hex(keccak(pub).slice(12)));
    expect(bytes(env.callerPubKey)).toEqual(pub);

    // ...over the payload the caller meant, compacted exactly as the node requires.
    expect(Buffer.from(bytes(env.data)).toString('utf8')).toBe('{"procedure":"transfer","args":["alice","500"]}');

    // ...with every hashed field present on the wire, so the node can rebuild the preimage at all.
    expect(Object.keys(env).sort()).toEqual(
      ['callerPubKey', 'callerSig', 'data', 'from', 'gasLimit', 'nonce', 'schemaName', 'timestamp', 'type'],
    );
    expect(env.type).toBe('callprocedure');
    expect(env.timestamp).toBe('0x6553f100');
    expect(env.gasLimit).toBe('0x186a0');
    expect(env.nonce).toBe('0x2a');
  });

  it('a signature over ANY mutated preimage fails the node check', async () => {
    // The proof that the assertion above is load-bearing: sign the same operation over each broken
    // encoding and watch the node's verification reject every one. This is precisely what the wallet
    // cannot see for itself -- each of these signatures is valid ML-DSA-87, over the wrong bytes.
    const m = await mldsa();
    const { sk, pub } = await fixedKey();
    const op: Op = { ...GOLDEN, type: 7, nonce: BigInt('0x0102030405060708') };
    const truth = refHash(op);

    expect(m.verify(pub, truth, m.sign(sk, truth))).toBe(true);
    for (const mut of ['dropNonce', 'nonceBeforeGasLimit', 'swapSchemaAndData', 'dropFrom', 'dropTimestamp'] as Mutation[]) {
      const wrong = m.sign(sk, refHash(op, mut));
      expect(m.verify(pub, truth, wrong)).toBe(false);
    }
  });

  it('the envelope numbers and the signed numbers are the same numbers', () => {
    // The divergence that has no local symptom: the hash says one value, the envelope another. Reading
    // the envelope back and re-deriving the hash from it must land on the digest that was signed.
    const nonce = BigInt('0xfffffffffffffffe');
    const prepared = buildDdbOp(
      'grantrole', 'c_0000000000000000000000000000000000abcdef',
      { role: 'writer', account: '0x0000000000000000000000000000000000001234' },
      GOLDEN.from, new Uint8Array(2592),
      { timestamp: 1700000000, gasLimit: 250000, nonce },
    );
    const rebuilt = refHash({
      type: 8,
      schemaName: prepared.envelope.schemaName,
      data: bytes(prepared.envelope.data),
      from: prepared.envelope.from,
      timestamp: BigInt(prepared.envelope.timestamp),
      gasLimit: BigInt(prepared.envelope.gasLimit),
      nonce: BigInt(prepared.envelope.nonce),
    });
    expect(hex(prepared.hash)).toBe(hex(rebuilt));
    expect(prepared.envelope.nonce).toBe('0xfffffffffffffffe');
  });

  it('refuses a number the envelope and the hash would encode differently', () => {
    const from = GOLDEN.from;
    const pub = new Uint8Array(2592);
    // A fractional timestamp: the preimage truncated it, the envelope emitted "0x6553f100.8".
    expect(() => buildDdbOp('createschema', 'users', { a: 1 }, from, pub, { timestamp: 1700000000.5 }))
      .toThrow(/timestamp must be a whole number/);
    // A nonce past 2^53: rounded by the Number type before either encoder ever saw it.
    expect(() => buildDdbOp('createschema', 'users', { a: 1 }, from, pub, { nonce: 2 ** 53 + 1 }))
      .toThrow(/exceeds Number.MAX_SAFE_INTEGER/);
    expect(() => buildDdbOp('createschema', 'users', { a: 1 }, from, pub, { gasLimit: -1 }))
      .toThrow(/must not be negative/);
    expect(() => buildDdbOp('createschema', 'users', { a: 1 }, from, pub, { nonce: BigInt(1) << BigInt(64) }))
      .toThrow(/does not fit in a uint64/);
  });
});

describe('the request id is derived from the same bytes', () => {
  it('is keccak256(canonicalBytes || requester), independently derived', () => {
    const requester = '0x0000000000000000000000000000000000001234';
    const expected = keccak(cat(refPreimage(GOLDEN), bytes(requester)));
    expect(hex(canonicalDdbRequestId(
      GOLDEN.type, GOLDEN.schemaName, GOLDEN.data, GOLDEN.from,
      GOLDEN.timestamp, GOLDEN.gasLimit, GOLDEN.nonce, requester,
    ))).toBe(hex(expected));
  });
});

describe('contract retirement (deleteSchemaSigned)', () => {
  // deleteschema is inter.DdbDeleteSchema == 2. The node implements it end to end -- authz rule,
  // endorsement branch, tombstone SQL, block-validity allow-list -- and exposes NO convenience RPC for
  // it, so ddb_submitSignedOp is the only door. It was missing from the SDK's type map entirely.
  it('submits op type "deleteschema" as byte 2', async () => {
    const { skHex } = await fixedKey();
    const sent: any[] = [];
    const provider: any = { send: (_m: string, p: any[]) => { sent.push(p[0]); return Promise.resolve('0xc0ffee'); } };
    const schemaName = 'c_0000000000000000000000000000000000abcdef';
    const opts = { timestamp: 1700000000, gasLimit: 100000, nonce: 3 };

    const requestId = await new Ddb(provider).deleteSchemaSigned(skHex, schemaName, opts);
    const env = sent[0];
    expect(env.type).toBe('deleteschema');
    expect(env.schemaName).toBe(schemaName);

    // The type byte is what the preimage carries, and 2 is the value inter.DdbDeleteSchema has. Getting
    // this wrong signs a DIFFERENT operation type than the envelope names.
    const expectedHash = refHash({
      type: 2, schemaName, data: bytes(env.data), from: env.from,
      timestamp: BigInt(env.timestamp), gasLimit: BigInt(env.gasLimit), nonce: BigInt(env.nonce),
    });
    const m = await mldsa();
    expect(m.verify(bytes(env.callerPubKey), expectedHash, bytes(env.callerSig))).toBe(true);

    // The node consults no payload for a delete (operation_sql.go keys the tombstone on op.SchemaName),
    // so the SDK sends a compact empty object rather than inventing a shape the node never reads.
    expect(Buffer.from(bytes(env.data)).toString('utf8')).toBe('{}');

    expect(requestId).toBe('0x' + Buffer.from(canonicalDdbRequestId(
      2, schemaName, bytes(env.data), env.from,
      BigInt(env.timestamp), BigInt(env.gasLimit), BigInt(env.nonce), env.from,
    )).toString('hex'));
  });
});

describe('the commit tx hash the node returns', () => {
  // ddb_submitSignedOp returns proof.CommitTxHash. The SDK used to await it and throw it away, which
  // left ddb_getCommitStatus -- the only RPC that can report a deterministic SKIP -- unreachable, because
  // that hash is its sole parameter. A skipped commit tx has no tx-position index, so every other RPC
  // reports it identically to a tx that was never mined.
  it('is returned to the caller, not discarded', async () => {
    const { skHex } = await fixedKey();
    const txHash = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const provider: any = { send: () => Promise.resolve(txHash) };
    const receipt = await new Ddb(provider).submitOperationSigned(
      skHex, 'callprocedure', 'c_0000000000000000000000000000000000abcdef',
      { procedure: 'transfer', args: ['alice'] }, { timestamp: 1700000000, nonce: 1 },
    );
    expect(receipt.commitTxHash).toBe(txHash);
    expect(receipt.requestId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('waitForCommit throws on a deterministic skip instead of reporting success', async () => {
    const provider: any = {
      send: (method: string) => {
        expect(method).toBe('ddb_getCommitStatus');
        return Promise.resolve({ txHash: '0xabc', status: 'skipped', reason: 'state_chain_break', blockNumber: '0x10' });
      },
    };
    await expect(new Ddb(provider).waitForCommit('0xabc', { intervalMs: 1, timeoutMs: 100 }))
      .rejects.toThrow(/SKIPPED on every node: state_chain_break/);
  });

  it('waitForCommit does not treat "unknown" as success', async () => {
    // "unknown" means this node has no verdict -- not finalized, evicted, or restarted. Resolving there
    // is the bug the node's own GetCommitStatus comment calls out.
    const provider: any = { send: () => Promise.resolve({ txHash: '0xabc', status: 'unknown' }) };
    await expect(new Ddb(provider).waitForCommit('0xabc', { intervalMs: 1, timeoutMs: 50 }))
      .rejects.toThrow(/timed out/);
  });

  it('waitForCommit resolves on applied, and can insist on local durability', async () => {
    const seq = [
      { txHash: '0xabc', status: 'unknown' },
      { txHash: '0xabc', status: 'applied', blockNumber: '0x20', durable: false },
      { txHash: '0xabc', status: 'applied', blockNumber: '0x20', durable: true, durableBlockNumber: '0x20' },
    ];
    let i = 0;
    const provider: any = { send: () => Promise.resolve(seq[Math.min(i++, seq.length - 1)]) };
    const res = await new Ddb(provider).waitForCommit('0xabc', { intervalMs: 1, timeoutMs: 2000, requireDurable: true });
    expect(res.status).toBe('applied');
    expect(res.durable).toBe(true);
    expect(i).toBeGreaterThanOrEqual(3);
  });
});

describe('the timestamp unit, which buildDdbOp owns', () => {
  // The one field whose DEFAULT is decided here rather than by a caller, and the one mistake in this
  // file with no local symptom: milliseconds produce a valid signature over a well-formed envelope,
  // and every node refuses it. gossip/ddb/authz.go checkOperationFreshness:
  //   ts == 0                      -> "operation timestamp is zero" (refused by name)
  //   now - ts > maxOperationAge   -> refused, maxOperationAge  = 15 * 60
  //   ts - now > maxOperationSkew  -> refused, maxOperationSkew =  5 * 60
  // Date.now() is 1.7e12; the window ends at now+300. A milliseconds default is not a rounding error,
  // it is every operation rejected as ~53,000 years in the future.
  const FROM = GOLDEN.from;
  const PUB = new Uint8Array(2592);

  it('defaults to unix SECONDS, inside the node freshness window', () => {
    const before = Math.floor(Date.now() / 1000);
    const prepared = buildDdbOp('createschema', 'users', { a: 1 }, FROM, PUB); // no opts: the default
    const after = Math.floor(Date.now() / 1000);

    const ts = Number(BigInt(prepared.envelope.timestamp));
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(ts).toBeGreaterThan(1_600_000_000); // plainly seconds...
    expect(ts).toBeLessThan(4_000_000_000);    // ...and not milliseconds
    expect(ts).not.toBe(0);                    // refused by name on the node

    // The node's own arithmetic, run here: both sides of checkOperationFreshness.
    const now = Math.floor(Date.now() / 1000);
    expect(now - ts).toBeLessThan(900);
    expect(ts - now).toBeLessThan(300);

    // ...and that timestamp is the one the SIGNED preimage carries, not merely the envelope's.
    expect(hex(prepared.hash)).toBe(hex(refHash({
      type: 0,
      schemaName: prepared.envelope.schemaName,
      data: bytes(prepared.envelope.data),
      from: prepared.envelope.from,
      timestamp: BigInt(prepared.envelope.timestamp),
      gasLimit: BigInt(prepared.envelope.gasLimit),
      nonce: BigInt(prepared.envelope.nonce),
    })));
  });

  it('refuses a milliseconds timestamp rather than signing one the node will always reject', () => {
    expect(() => buildDdbOp('createschema', 'users', { a: 1 }, FROM, PUB, { timestamp: Date.now() }))
      .toThrow(/not unix seconds/);
    expect(() => buildDdbOp('createschema', 'users', { a: 1 }, FROM, PUB, { timestamp: 1_700_000_000_000 }))
      .toThrow(/looks like milliseconds/);
  });

  it('still accepts the small fixed timestamps a capability probe uses', () => {
    // Both wallets build buildDdbOp(..., { timestamp: 1, gasLimit: 1, nonce: 1 }) twice, under two
    // type names, to ask whether this SDK encodes `deleteschema` as its own type — and they read a
    // THROW as "it does not". A freshness window here would turn an SDK upgrade into a wallet that
    // refuses contract retirement forever.
    expect(() => buildDdbOp('deleteschema', 's', {}, FROM, PUB, { timestamp: 1, gasLimit: 1, nonce: 1 }))
      .not.toThrow();
    const asDelete = buildDdbOp('deleteschema', 's', {}, FROM, PUB, { timestamp: 1, gasLimit: 1, nonce: 1 });
    const asCreate = buildDdbOp('createschema', 's', {}, FROM, PUB, { timestamp: 1, gasLimit: 1, nonce: 1 });
    expect(hex(asDelete.hash)).not.toBe(hex(asCreate.hash)); // the probe's answer, on THIS source
  });

  it('defaults the other two fields the same way: a stated gasLimit and a FRESH random nonce', () => {
    const a = buildDdbOp('callprocedure', 'c_1', { procedure: 'p', args: [] }, FROM, PUB);
    const b = buildDdbOp('callprocedure', 'c_1', { procedure: 'p', args: [] }, FROM, PUB);
    expect(a.envelope.gasLimit).toBe('0x186a0'); // 100000
    // The nonce is inside the signed preimage, so a repeated one makes two distinct operations
    // byte-identical and a replay indistinguishable from the original.
    expect(a.envelope.nonce).not.toBe(b.envelope.nonce);
    expect(hex(a.hash)).not.toBe(hex(b.hash));
  });
});

describe('an operation type this SDK does not know', () => {
  // The bug the published necjs 3.0.0 still ships, pinned here so this SDK cannot regress into it: its
  // op-type map has no `deleteschema`, and its buildDdbOp has no guard, so it reads `undefined`,
  // encodes `undefined & 0xff` -- which is 0 -- and returns a well-formed operation whose SIGNED type
  // byte says CREATE SCHEMA while the envelope's `type` field says "deleteschema". Measured on the copy
  // both wallets load (node -e against their node_modules): the two hashes are byte-identical.
  //
  // The node fails closed on that -- SubmitSignedOp decodes the envelope's name to type 2 and re-hashes
  // with byte 2, so the signature is rejected with "caller signature verification failed" -- which makes
  // it an unreachable feature rather than a wrong operation executed. Silently signing a type byte
  // nobody asked for is still not a property to leave untested.
  const FROM = GOLDEN.from;
  const PUB = new Uint8Array(2592);
  const opts = { timestamp: 1700000000, gasLimit: 1, nonce: 1 };

  it('throws instead of encoding it as type 0', () => {
    expect(() => buildDdbOp('deletetable' as any, 's', {}, FROM, PUB, opts))
      .toThrow(/unknown DDB operation type/);
    expect(() => buildDdbOp('' as any, 's', {}, FROM, PUB, opts)).toThrow(/unknown DDB operation type/);
    expect(() => buildDdbOp(undefined as any, 's', {}, FROM, PUB, opts)).toThrow(/unknown DDB operation type/);
  });

  it('offers exactly the six types the node can commit, each on its own byte', () => {
    // gossip/ddb/main_chain_consensus.go verifyOperationValidity admits DdbCreateSchema(0),
    // DdbUpdateSchema(1), DdbDeleteSchema(2), DdbCallProcedure(7), DdbGrantRole(8), DdbRevokeRole(9);
    // every other type "has no main-chain commit implementation". Types 3-6 are therefore NOT signable,
    // and offering them would produce operations that die at block validity after a full quorum round.
    const known: Array<[string, number]> = [
      ['createschema', 0], ['updateschema', 1], ['deleteschema', 2],
      ['callprocedure', 7], ['grantrole', 8], ['revokerole', 9],
    ];
    for (const [name, byte] of known) {
      expect(hex(buildDdbOp(name as any, 's', {}, FROM, PUB, opts).hash)).toBe(hex(refHash({
        type: byte, schemaName: 's', data: utf8('{}'), from: FROM,
        timestamp: opts.timestamp, gasLimit: opts.gasLimit, nonce: opts.nonce,
      })));
    }
    // Six distinct digests: if any two collided, one operation would be signed as the other.
    expect(new Set(known.map(([n]) => hex(buildDdbOp(n as any, 's', {}, FROM, PUB, opts).hash))).size).toBe(6);
    for (const n of ['createtable', 'insertdata', 'updatedata', 'deletedata']) {
      expect(() => buildDdbOp(n as any, 's', {}, FROM, PUB, opts)).toThrow(/unknown DDB operation type/);
    }
  });
});

// THE NODE REJECTS NON-COMPACT JSON BEFORE IT VERIFIES THE SIGNATURE.
// gossip/ddb/dual_consensus_flow.go, ahead of VerifyCallerSignature:
//
//     if !bytes.Equal(compact.Bytes(), op.Data) {
//         return nil, errors.New("operation Data must be compact JSON (re-serialize compactly before signing)")
//     }
//
// Both wallets hand the dApp's RAW STRING straight through (ddbOperationFor returns data: p[2] for
// createschema/updateschema), so this one line in buildDdbOp is the ONLY normalizer standing between a
// dApp that pretty-prints its contract JSON and a hard node rejection.
//
// It was unasserted: replacing `JSON.stringify(JSON.parse(data))` with `data` left the whole SDK suite
// AND both wallet suites green, because every fixture literal was already compact -- so the tests only
// ever proved their own literals were compact, never that buildDdbOp compacts.
describe('buildDdbOp compacts the payload before signing', () => {
  const pretty = JSON.stringify({ contract_name: 'balances', tables: [{ name: 't' }] }, null, 2);

  it('a pretty-printed payload is signed COMPACT, not as given', () => {
    const prepared = buildDdbOp(
      'createschema', 'balances', pretty, GOLDEN.from, new Uint8Array(2592),
      { timestamp: 1700000000, gasLimit: 100000, nonce: 1 },
    );
    const wire = new TextDecoder().decode(bytes(prepared.envelope.data));
    expect(wire).not.toContain(String.fromCharCode(10)); // no newline: it is compact
    expect(wire).toBe(JSON.stringify(JSON.parse(pretty)));
  });

  it('the signed bytes are what the node would accept unchanged', () => {
    const prepared = buildDdbOp(
      'createschema', 'balances', pretty, GOLDEN.from, new Uint8Array(2592),
      { timestamp: 1700000000, gasLimit: 100000, nonce: 1 },
    );
    const wire = new TextDecoder().decode(bytes(prepared.envelope.data));
    // The node's check is byte equality against its own json.Compact of the same bytes.
    expect(JSON.stringify(JSON.parse(wire))).toBe(wire);
  });
});
