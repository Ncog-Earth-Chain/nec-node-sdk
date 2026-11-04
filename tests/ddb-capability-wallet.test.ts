/**
 * PLACE-02 wallet half (NEC-93): the SDK helpers a wallet needs to answer ddb_requestCapability -- the lifetime bound
 * read at request time, the client-side token check, Ddb.requestCapabilityToken -- and the CROSS-LANGUAGE vectors:
 *
 *  - tests/vectors/place02_capability_token_go.json: a token the NODE's Go code built and signed (ethapi
 *    DdbCapabilityToken.Hash(), cryptod.SignMLDsa87, the ML-DSA-87 key of seed 0x2a*32). verifyDdbCapabilityToken
 *    must accept it.
 *  - tests/vectors/place02_capability_token_js.json: a token THIS SDK built (buildDdbCapabilityToken, noble ML-DSA-87,
 *    the same seed) plus the same token with its role swapped. The node's own checks (json.Unmarshal into
 *    ethapi.DdbCapabilityToken, cryptod.UnmarshalPubkey, PubkeyToAddress, Hash(), ValidateMLDsa87Signature) answered
 *    "js-signed: OK hash=0x2f966fc5...dd69" and "js-signed-role-swapped: refused: the token's signature verification
 *    failed" (run 22, recorded in the lane's RESULT.md); the SDK's check must give the same two verdicts.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  canonicalDdbCapabilityHash, readDdbTokenLifetimeBound, verifyDdbCapabilityToken, type DdbCapabilityToken,
} from '../src/ddb-capability';
import type { DdbSigner } from '../src/ddb';

const load = (f: string) => JSON.parse(readFileSync(resolve(__dirname, 'vectors', f), 'utf8')) as { name: string; token: DdbCapabilityToken }[];
const GO = load('place02_capability_token_go.json')[0].token;
const [JS, JS_SWAPPED] = load('place02_capability_token_js.json').map((e) => e.token);
const AT = { chainId: 2479, now: 1800000100, lifetimeBound: 600 };
const hex = (b: Uint8Array) => '0x' + Buffer.from(b).toString('hex');

let ml: any;
beforeAll(async () => {
  // @ts-ignore - noble-post-quantum.js is a bundled JS file without TypeScript declarations
  const noblePQ: any = await import('../src/noble-post-quantum.js');
  ml = (noblePQ.default || noblePQ).ml_dsa87;
});

describe('cross-language vectors', () => {
  test('the node-signed token passes the SDK check', async () => {
    expect(hex(canonicalDdbCapabilityHash(GO))).toBe('0x001bde691827918c91c4b5823285c1acc1cac9e4718f2f39c655876b9a7e8a6b');
    expect(await verifyDdbCapabilityToken(GO, AT)).toEqual({ valid: true });
  });

  test('the SDK-signed tokens get the verdicts the node gave them', async () => {
    expect(hex(canonicalDdbCapabilityHash(JS))).toBe('0x2f966fc55291b44697ef0ee70da2205ecd4470c42c131cf434f7e6708b5ddd69');
    expect(await verifyDdbCapabilityToken(JS, AT)).toEqual({ valid: true });
    expect(await verifyDdbCapabilityToken(JS_SWAPPED, AT)).toMatchObject({ valid: false, reason: expect.stringMatching(/signature verification failed/) });
  });
});

describe('verifyDdbCapabilityToken refuses, in the host order', () => {
  test.each([
    ['another chain', GO, { ...AT, chainId: 1 }, /chain/],
    ['expired', GO, { ...AT, now: 1800000600 }, /expired/],
    ['issued in the future', GO, { ...AT, now: 1800000000 - 16 }, /future/],
    ['above the lifetime bound', GO, { ...AT, lifetimeBound: 300 }, /above the lifetime bound/],
    ['a caller that is not the key', { ...GO, caller: '0x00000000000000000000000000000000000000a7' }, AT, /does not match its caller/],
    ['expiry at issuance', { ...GO, expiry: GO.issuedAt }, AT, /at or before/],
  ])('%s', async (_n, tok, opts, re) => {
    expect(await verifyDdbCapabilityToken(tok as DdbCapabilityToken, opts)).toMatchObject({ valid: false, reason: expect.stringMatching(re) });
  });
});

describe('readDdbTokenLifetimeBound', () => {
  const DIR = '0x00000000000000000000000000000000000000d1';
  const send = (over: Record<string, any> = {}) => async (m: string, p: any[]) => {
    const a = { ddb_hostEndpoints: { directory: DIR, hosts: [] }, eth_getStorageAt: (q: any[]) => (q[2] === '0x64' ? '0x258' : '0x1c2'), ...over }[m];
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(p) : a;
  };

  test('the lower of the sealed root and the head, from slot 2 of the named directory', async () => {
    const calls: any[] = [];
    const s = send();
    expect(await readDdbTokenLifetimeBound(async (m, p) => { calls.push([m, p]); return s(m, p); }, 100)).toEqual({ directory: DIR, seconds: 450 });
    expect(calls.filter((c) => c[0] === 'eth_getStorageAt').map((c) => c[1])).toEqual([[DIR, '0x2', '0x64'], [DIR, '0x2', 'latest']]);
  });

  test('a pruned root leaves the head; no directory or no in-range value is refused', async () => {
    expect((await readDdbTokenLifetimeBound(send({ eth_getStorageAt: (q: any[]) => { if (q[2] !== 'latest') throw new Error('missing trie node'); return '0x258'; } }), 100)).seconds).toBe(600);
    await expect(readDdbTokenLifetimeBound(send({ ddb_hostEndpoints: { directory: '0x' + '0'.repeat(40) } }))).rejects.toThrow(/no EndpointDirectory/);
    await expect(readDdbTokenLifetimeBound(send({ eth_getStorageAt: '0x0' }))).rejects.toThrow(/no readable token lifetime/);
  });
});

describe('Ddb.requestCapabilityToken (the wallet path)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Ddb } = require('../src/ddb');
  const provider = (resolveErr?: any) => ({ send: async (m: string) => {
    if (m === 'eth_chainId') return '0x9af';
    if (m === 'eth_getBlockByNumber') return { epoch: '0x7' };
    if (m === 'ddb_resolveDatabase') { if (resolveErr) throw resolveErr; return { contract: '0x00000000000000000000000000000000000000c7', epoch: 7, rootBlock: 100, hostGroup: { members: [] } }; }
    if (m === 'ddb_hostEndpoints') return { directory: '0x00000000000000000000000000000000000000d1', hosts: [] };
    if (m === 'eth_getStorageAt') return '0x1c2';
    throw new Error(`unexpected ${m}`);
  } });
  const signer = (prefix = false): DdbSigner => {
    const kp = ml.keygen(new Uint8Array(32).fill(0x2a));
    return {
      getAddress: () => GO.caller,
      getPublicKey: () => kp.publicKey,
      signDdbHash: (h: Uint8Array) => ml.sign(kp.secretKey, prefix ? new Uint8Array([...Buffer.from('\x19Ethereum Signed Message:\n32'), ...h]) : h),
    };
  };

  test('caps the lifetime at the bound read now and returns a token that passes the host checks', async () => {
    const { token, ttl } = await new Ddb(provider() as any).requestCapabilityToken(signer(), '0x00000000000000000000000000000000000000c7', 'Reader', { ttlSeconds: 3600 });
    expect(ttl).toBe(450);
    expect(token).toMatchObject({ chainId: '0x9af', groupVersion: '0x7', role: 'reader', caller: GO.caller });
    expect(Number(token.expiry) - Number(token.issuedAt)).toBe(450);
    expect(await verifyDdbCapabilityToken(token, { chainId: 2479, lifetimeBound: 450 })).toEqual({ valid: true });
  });

  test('a signer that signs another digest (EIP-191) is refused before the token leaves the SDK', async () => {
    await expect(new Ddb(provider() as any).requestCapabilityToken(signer(true), '0x00000000000000000000000000000000000000c7', 'reader'))
      .rejects.toThrow(/signature verification failed/);
  });

  test('an older node without the resolver is refused', async () => {
    const err = Object.assign(new Error('the method ddb_resolveDatabase does not exist/is not available'), { code: -32601 });
    await expect(new Ddb(provider(err) as any).requestCapabilityToken(signer(), '0x00000000000000000000000000000000000000c7', 'reader'))
      .rejects.toThrow(/no resolver/);
  });
});
