// A DDB write authorized WITHOUT the SDK ever seeing a private key.
//
// This is the shape a wallet needs and had no path to: the extension background page, the mobile
// approval sheet and a hardware device all hold the key precisely so that nothing else sees it, while
// the SDK's only entry point was `(privateKey: string, ...)`. Everything here goes through the public
// API, so if these pass, a wallet can drive it.
import { Ddb, buildDdbOp, privateKeyDdbSigner, type DdbSigner } from '../src/ddb';

async function mldsa() {
  // @ts-ignore - bundled JS without types
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  return (noblePQ.default || noblePQ).ml_dsa87;
}

async function deterministicKey() {
  const m = await mldsa();
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = (i * 13 + 5) & 0xff;
  const kp = m.keygen(seed);
  return { skHex: Buffer.from(kp.secretKey).toString('hex'), pub: kp.publicKey as Uint8Array, sk: kp.secretKey as Uint8Array };
}

function capturingProvider(sent: any[]) {
  return { send: (_m: string, params: any[]) => { sent.push(params[0]); return Promise.resolve('0x'); } } as any;
}

describe('DDB signing through a wallet-shaped signer', () => {
  it('produces the same envelope as the raw-key path', async () => {
    const { skHex, pub, sk } = await deterministicKey();
    const m = await mldsa();

    // A remote signer: it never hands the key over, it only answers "sign these 32 bytes".
    let sawHash: Uint8Array | null = null;
    const remote: DdbSigner = {
      getAddress: () => privateKeyDdbSigner(skHex).getAddress(),
      getPublicKey: () => pub,
      signDdbHash: (hash) => { sawHash = hash; return m.sign(sk, hash) as Uint8Array; },
    };

    const viaKey: any[] = [];
    const viaSigner: any[] = [];
    const opts = { timestamp: 1000, gasLimit: 100000, nonce: 99 };

    await new Ddb(capturingProvider(viaKey))
      .callProcedureSigned(skHex, 'c_0000000000000000000000000000000000abcdef', 'addUser', ['alice'], opts);
    await new Ddb(capturingProvider(viaSigner))
      .callProcedureSigned(remote, 'c_0000000000000000000000000000000000abcdef', 'addUser', ['alice'], opts);

    // Byte-identical envelopes. ML-DSA-87 signing in circl/noble is deterministic, so even callerSig
    // matches -- which is the strongest form this assertion can take.
    expect(viaSigner[0]).toEqual(viaKey[0]);

    // And the signer was handed the canonical hash itself, 32 bytes, not a re-hash or an EIP-191
    // digest. A wallet that routes this through its personal_sign path signs the wrong thing.
    expect(sawHash).not.toBeNull();
    expect((sawHash as unknown as Uint8Array).length).toBe(32);
  });

  it('never asks the signer for the key material', async () => {
    const { skHex, pub, sk } = await deterministicKey();
    const m = await mldsa();
    const asked: string[] = [];
    const signer: DdbSigner = {
      getAddress: () => { asked.push('address'); return privateKeyDdbSigner(skHex).getAddress(); },
      getPublicKey: () => { asked.push('publicKey'); return pub; },
      signDdbHash: (h) => { asked.push('sign'); return m.sign(sk, h) as Uint8Array; },
    };
    const sent: any[] = [];
    await new Ddb(capturingProvider(sent)).grantRoleSigned(
      signer, 'c_0000000000000000000000000000000000abcdef', 'writer',
      '0x0000000000000000000000000000000000001234', { timestamp: 1, nonce: 1 },
    );
    expect(asked.sort()).toEqual(['address', 'publicKey', 'sign']);
    expect(sent[0].callerSig).toMatch(/^0x[0-9a-f]+$/);
  });
});

describe('buildDdbOp / submitSignedOp (sign somewhere else entirely)', () => {
  it('round-trips a detached signature', async () => {
    const { skHex, pub, sk } = await deterministicKey();
    const m = await mldsa();
    const from = await privateKeyDdbSigner(skHex).getAddress();

    // Step 1, in the app: build. No key involved.
    const prepared = buildDdbOp(
      'callprocedure', 'c_0000000000000000000000000000000000abcdef',
      { procedure: 'addUser', args: ['alice'] }, from, pub,
      { timestamp: 1000, nonce: 7 },
    );
    expect(prepared.hash.length).toBe(32);
    expect(prepared.requestId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(prepared.envelope.nonce).toBe('0x7');
    expect((prepared.envelope as any).callerSig).toBeUndefined();

    // Step 2, across the boundary: sign the digest.
    const sig = m.sign(sk, prepared.hash) as Uint8Array;

    // Step 3, back in the app: submit.
    const sent: any[] = [];
    const requestId = await new Ddb(capturingProvider(sent)).submitSignedOp(prepared, sig);

    expect(requestId).toBe(prepared.requestId);
    expect(sent[0].callerSig).toBe('0x' + Buffer.from(sig).toString('hex'));
    expect(sent[0].from).toBe(from);
  });

  it('matches what the all-in-one path would have submitted', async () => {
    const { skHex, pub, sk } = await deterministicKey();
    const m = await mldsa();
    const from = await privateKeyDdbSigner(skHex).getAddress();
    const opts = { timestamp: 2000, nonce: 11 };

    const prepared = buildDdbOp('grantrole', 'c_0000000000000000000000000000000000abcdef',
      { role: 'writer', account: from }, from, pub, opts);
    const detached: any[] = [];
    await new Ddb(capturingProvider(detached)).submitSignedOp(prepared, m.sign(sk, prepared.hash) as Uint8Array);

    const allInOne: any[] = [];
    await new Ddb(capturingProvider(allInOne))
      .grantRoleSigned(skHex, 'c_0000000000000000000000000000000000abcdef', 'writer', from, opts);

    expect(detached[0]).toEqual(allInOne[0]);
  });
});
