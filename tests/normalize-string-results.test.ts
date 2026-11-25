// normalize-string-results.test.ts — a JSON-RPC result that is TEXT must survive normalization.
//
// normalizeResponse handed every top-level string that was not long hex to hexToDecimalString, which
// throws on non-hex input. So every method whose result is text crashed the provider rather than
// returning, including the two a new integrator reaches for first:
//
//   web3_clientVersion -> "ncogearthchain/v1.0.2-rc.5-96ac5d71-2026-11-25/linux-amd64/go1.26.8"
//   net_version        -> "2570"
//
// Found by running the quickstart against the live endpoint with a clean install of the published
// 3.0.1, rather than writing the quickstart from memory. The first call after creating a wallet failed.

import { normalizeResponse } from '../src/utils';

describe('normalizeResponse and string results', () => {
  it('returns plain text unchanged instead of throwing', () => {
    const v = 'ncogearthchain/v1.0.2-rc.5-96ac5d71-2026-11-25/linux-amd64/go1.26.8';
    expect(normalizeResponse(v)).toBe(v);
  });

  it('returns a decimal net_version unchanged', () => {
    // "2570" is not hex-prefixed, so the old code sent it to hexToDecimalString and threw.
    expect(normalizeResponse('2570')).toBe('2570');
  });

  it('still converts a hex quantity to decimal', () => {
    // The behaviour that must NOT regress: eth_chainId, eth_blockNumber and friends.
    //
    // Note the type: a hex quantity comes back as a NUMBER, not a decimal string, despite the
    // converter being called hexToDecimalString. Asserted as measured rather than as the name implies.
    expect(normalizeResponse('0xa0a')).toBe(2570);
    expect(normalizeResponse('0x0')).toBe(0);
    expect(normalizeResponse('0x21128')).toBe(135464); // the real gas cost of a PQ transfer
  });

  it('still passes addresses and hashes through unchanged', () => {
    const addr = '0x81bb96fe6870075f75a9c8af7b219250906bd544';
    const hash = '0x' + 'ab'.repeat(32);
    expect(normalizeResponse(addr)).toBe(addr);
    expect(normalizeResponse(hash)).toBe(hash);
  });

  it('handles the shapes around it that the old code already got right', () => {
    expect(normalizeResponse(null)).toEqual({});
    expect(normalizeResponse(true)).toBe(true);
    expect(normalizeResponse(false)).toBe(false);
  });

  it('does not treat a 0x-prefixed non-hex string as a quantity', () => {
    // A string that merely starts with 0x but is not hex must not be converted, and must not throw.
    expect(normalizeResponse('0xZZtop')).toBe('0xZZtop');
  });
});
