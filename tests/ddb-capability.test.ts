/**
 * PLACE-02 capability tokens (NEC-93): the SDK's token preimage against the NODE's pinned constants
 * (ethapi TestCapabilityTokenGoldenVector), so a wallet and a host agree on what is signed; and the builder signs
 * that exact hash through the raw-hash path (never EIP-191).
 */
import {
  canonicalDdbCapabilityBytes, canonicalDdbCapabilityHash, buildDdbCapabilityToken, DDB_TOKEN_LIFETIME_MAX,
} from '../src/ddb-capability';
import type { DdbSigner } from '../src/ddb';

// From ethapi TestCapabilityTokenGoldenVector -- the node's constants, not ours.
const WANT_BYTES = '4e45432d4444422d43415001'
  + '00000000000000000000000000000000000000000000000000000000000009af'
  + '00000000000000000000000000000000000000c7'
  + '00000006' + '726561646572'
  + '00000000000000000000000000000000000000a7'
  + '0000000000000007' + '000000006b49d200' + '000000006b49d458' + '000000000000002a';
const WANT_HASH = '1e94ed5f88d02cba4ab1dbeb3ea93b5adb267663e5946c2bc0edbef0f846b1c4';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const golden = {
  chainId: 2479, contract: '0x00000000000000000000000000000000000000c7', role: ' Reader ',
  caller: '0x00000000000000000000000000000000000000a7', groupVersion: 7, issuedAt: 1800000000, expiry: 1800000600, nonce: 42,
};

describe('PLACE-02 capability token', () => {
  test('the preimage is the node\'s, byte for byte', () => {
    expect(hex(canonicalDdbCapabilityBytes(golden))).toBe(WANT_BYTES);
    expect(hex(canonicalDdbCapabilityHash(golden))).toBe(WANT_HASH);
  });

  test('every field is bound', () => {
    for (const [k, v] of Object.entries({ chainId: 1, contract: '0x00000000000000000000000000000000000000c8', role: 'writer',
      caller: '0x00000000000000000000000000000000000000a8', groupVersion: 8, issuedAt: 1800000001, expiry: 1800000601, nonce: 43 })) {
      expect(hex(canonicalDdbCapabilityHash({ ...golden, [k]: v }))).not.toBe(WANT_HASH);
    }
  });

  test('the builder signs the token hash as given and stamps the time when called', async () => {
    const signed: Uint8Array[] = [];
    const signer: DdbSigner = {
      getAddress: () => golden.caller,
      getPublicKey: () => new Uint8Array([1, 2, 3]),
      signDdbHash: (h: Uint8Array) => { signed.push(h); return new Uint8Array([9, 9]); },
    };
    const tok = await buildDdbCapabilityToken(signer, { chainId: 2479, contract: golden.contract, role: ' Reader ', groupVersion: 7,
      issuedAt: 1800000000, ttlSeconds: 600, nonce: 42 });
    expect(hex(signed[0])).toBe(WANT_HASH);
    expect(tok).toMatchObject({ role: 'reader', groupVersion: '0x7', issuedAt: '0x6b49d200', expiry: '0x6b49d458', nonce: '0x2a',
      callerPubKey: '0x010203', signature: '0x0909' });
    const before = Math.floor(Date.now() / 1000);
    const fresh = await buildDdbCapabilityToken(signer, { chainId: 2479, contract: golden.contract, role: 'reader', groupVersion: 7 });
    expect(Number(fresh.issuedAt)).toBeGreaterThanOrEqual(before);
    expect(Number(fresh.expiry) - Number(fresh.issuedAt)).toBe(600);
  });

  test('a lifetime above the contract maximum is refused before signing', async () => {
    const signer: DdbSigner = { getAddress: () => golden.caller, getPublicKey: () => new Uint8Array([1]), signDdbHash: () => { throw new Error('signed'); } };
    await expect(buildDdbCapabilityToken(signer, { chainId: 1, contract: golden.contract, role: 'reader', groupVersion: 1,
      ttlSeconds: DDB_TOKEN_LIFETIME_MAX + 1 })).rejects.toThrow(/ttlSeconds/);
  });
});

describe('PLACE-02 Ddb token methods', () => {
  test('issueCapabilityToken binds the resolved sealed epoch and tokenSelect sends the token to ddb_tokenSelect', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Ddb } = require('../src/ddb');
    const calls: [string, any[]][] = [];
    const provider = { send: async (m: string, p: any[]) => {
      calls.push([m, p]);
      if (m === 'eth_chainId') return '0x9af';
      if (m === 'eth_getBlockByNumber') return { epoch: '0x7' };
      if (m === 'ddb_resolveDatabase') return { contract: golden.contract, epoch: 7, hostGroup: { members: [] } };
      return [{ ok: true }];
    } };
    const ddb = new Ddb(provider as any);
    const signer: DdbSigner = { getAddress: () => golden.caller, getPublicKey: () => new Uint8Array([1]), signDdbHash: () => new Uint8Array([2]) };
    const tok = await ddb.issueCapabilityToken(signer, golden.contract, 'Reader', { ttlSeconds: 120 });
    expect(tok).toMatchObject({ chainId: '0x9af', groupVersion: '0x7', role: 'reader' });
    expect(Number(tok.expiry) - Number(tok.issuedAt)).toBe(120);
    await ddb.tokenSelect(tok, 'items');
    expect(calls[calls.length - 1][0]).toBe('ddb_tokenSelect');
    expect(calls[calls.length - 1][1][0]).toBe(tok);
    await ddb.tokenCallReadProcedure(tok, 'report', ['2026']);
    expect(calls[calls.length - 1]).toEqual(['ddb_tokenCallReadProcedure', [tok, 'report', ['2026']]]);
  });
});
