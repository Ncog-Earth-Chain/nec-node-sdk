// DDB client-signed submit flow + EIP-191 personal signing. Asserts the exact ddb_submitSignedOp envelope
// the node parses (derived `from`, compact-JSON data bytes, hex timestamp/gasLimit, caller pubkey/sig) and
// that the returned value is the endorsement requestId. No live node — provider.send is mocked.
import { Ddb, canonicalDdbRequestId } from '../src/ddb';
import { personalTextHash, signPersonalMessageMLDSA, verifyPersonalMessageMLDSA } from '../src/utils';

const DDB_OP_CALLPROCEDURE = 7; // matches inter.DdbOperationType iota + src/ddb.ts DDB_OP_TYPE.callprocedure
const GOLDEN_ADDRESS = '0x0609f7a1e5ac783acc81480059551aa95320219b';

async function deterministicKey() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  const mldsa = (noblePQ.default || noblePQ).ml_dsa87;
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
  const kp = mldsa.keygen(seed);
  return { skHex: Buffer.from(kp.secretKey).toString('hex'), pub: kp.publicKey as Uint8Array };
}

describe('DDB signed-op submit envelope', () => {
  it('builds the exact ddb_submitSignedOp envelope and returns the requestId', async () => {
    const { skHex, pub } = await deterministicKey();
    const sent: any[] = [];
    const provider: any = { send: (method: string, params: any[]) => { sent.push({ method, params }); return Promise.resolve('0xnode-op-hash'); } };
    const ddb = new Ddb(provider);

    const schemaName = 'users_abcdef';
    const ts = 1000;
    const gas = 100000;
    const requestId = await ddb.callProcedureSigned(skHex, schemaName, 'addUser', ['alice', '30'], { timestamp: ts, gasLimit: gas });

    // one RPC, the signed-op submit
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('ddb_submitSignedOp');
    const env = sent[0].params[0];

    // envelope fields
    expect(env.type).toBe('callprocedure');
    expect(env.schemaName).toBe(schemaName);
    expect(env.from.toLowerCase()).toBe(GOLDEN_ADDRESS); // keccak256(rawPubkey)[12:]
    expect(env.timestamp).toBe('0x' + ts.toString(16));
    expect(env.gasLimit).toBe('0x' + gas.toString(16));
    expect(env.callerPubKey.toLowerCase()).toBe('0x' + Buffer.from(pub).toString('hex'));
    expect(typeof env.callerSig).toBe('string');
    expect(env.callerSig.startsWith('0x')).toBe(true);

    // data must be the COMPACT JSON of { procedure, args }, hex-encoded
    const payload = JSON.stringify({ procedure: 'addUser', args: ['alice', '30'] });
    const dataBytes = new TextEncoder().encode(payload);
    expect(env.data.toLowerCase()).toBe('0x' + Buffer.from(dataBytes).toString('hex'));

    // return value is the endorsement requestId = keccak256(canonicalBytes || requester)
    const expected = '0x' + Buffer.from(
      canonicalDdbRequestId(DDB_OP_CALLPROCEDURE, schemaName, dataBytes, GOLDEN_ADDRESS, ts, gas, GOLDEN_ADDRESS),
    ).toString('hex');
    expect(requestId).toBe(expected);
    expect(requestId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('deriveDbName lowercases contractName + last-6 of address', () => {
    expect(Ddb.deriveDbName('Users', '0x0000000000000000000000000000000000ABCDEF')).toBe('users_abcdef');
  });
});

describe('EIP-191 personal signing (node-interoperable)', () => {
  it('personalTextHash matches the golden EIP-191 digest', () => {
    const h = '0x' + Buffer.from(personalTextHash('hello world')).toString('hex');
    expect(h).toBe('0xd9eba16ed0ecae432b71fe008c98cc872bb4cc214d3220a36f365326cf807d68');
  });

  it('signPersonalMessageMLDSA round-trips and rejects a tampered message', async () => {
    const { skHex, pub } = await deterministicKey();
    // signPersonalMessageMLDSA emits BARE hex and verify's internal hexToUint8Array rejects a 0x prefix,
    // so the pubkey/signature round-trip is bare-hex (no 0x). skHex is likewise bare.
    const pubHex = Buffer.from(pub).toString('hex');
    const sig = await signPersonalMessageMLDSA('hello world', skHex);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    await expect(verifyPersonalMessageMLDSA('hello world', sig, pubHex)).resolves.toBe(true);
    await expect(verifyPersonalMessageMLDSA('hello worlds', sig, pubHex)).resolves.toBe(false);
  });
});

describe('waitForEndorsement', () => {
  // The node's ddb_getEndorsementStatus reports "pending" then "completed" on success. This locks in that
  // the poller treats "completed" as terminal (it previously only accepted committed/finalized/applied and
  // would have looped to timeout on every successful write).
  it('resolves on node status "completed", polling through "pending"', async () => {
    const seq = [{ status: 'pending' }, { status: 'pending' }, { requestId: '0xabc', status: 'completed' }];
    let i = 0;
    const provider: any = {
      send: (method: string) => {
        expect(method).toBe('ddb_getEndorsementStatus');
        return Promise.resolve(seq[Math.min(i++, seq.length - 1)]);
      },
    };
    const ddb = new Ddb(provider);
    const res = await ddb.waitForEndorsement('0xabc', { intervalMs: 5, timeoutMs: 3000 });
    expect(res.status).toBe('completed');
    expect(i).toBeGreaterThanOrEqual(3); // it actually polled through the pending states
  });

  it('rejects if the node reports a failure status', async () => {
    const provider: any = { send: () => Promise.resolve({ status: 'failed', error: 'quorum not reached' }) };
    const ddb = new Ddb(provider);
    await expect(ddb.waitForEndorsement('0xabc', { intervalMs: 5, timeoutMs: 500 })).rejects.toThrow(/endorsement failed/i);
  });
});
