// known-defect-rpc-number-precision.test.ts
//
// THIS TEST DOCUMENTS A DEFECT. It does not protect the behaviour it asserts.
//
// normalizeResponse converts a hex quantity to a JavaScript NUMBER, so every value above 2^53 is
// silently rounded and large ones come back in exponential form. Measured:
//
//   1 NEC            1000000000000000000  ->  1000000000000000000   exact, by luck
//   1 NEC + 1 wei    1000000000000000001  ->  1000000000000000000   the wei is GONE
//   80,000,000 NEC   80000000000000000000000000  ->  8e+25          unusable as a value
//
// Since 1 NEC is 1e18 wei, essentially every real balance is affected. eth_getBalance is the canonical
// caller, so a wallet that computes "can the user afford this" from provider.rpc is computing with a
// rounded number, and anything that stringifies the result into a transaction value writes "8e+25".
//
// It cannot CREATE money -- the node is authoritative and refuses an overspend -- but it misreports
// balances and mis-computes affordability, which is bad enough on a money path.
//
// WHY IT IS NOT FIXED IN THE SAME COMMIT AS THE TEST: the fix is to return a string or a bigint, and
// that changes the return type of every provider.rpc call for every consumer of a published package.
// That is the owner's call, recorded in docs/operations/OWNER_TASKS_NOW.md. The project already solved
// this exact problem on the DDB read path -- `exactNumbers`, `ddbExactRows`,
// DDB_EXACT_NUMBERS_UNSUPPORTED -- so the precedent for an opt-in exact mode exists and is the obvious
// shape for the fix.
//
// WHEN YOU FIX IT: these expectations will fail. That is correct. Update them deliberately and delete
// this header, rather than reaching for the old behaviour to make a red test green.

import { normalizeResponse } from '../src/utils';

const TEN = BigInt(10);
const E18 = TEN ** BigInt(18);
const ONE = BigInt(1);

const hexOf = (v: bigint) => '0x' + v.toString(16);

describe('KNOWN DEFECT: provider.rpc loses precision on quantities above 2^53', () => {
  it('is exact for a value float64 happens to represent', () => {
    expect(String(normalizeResponse(hexOf(E18)))).toBe('1000000000000000000');
  });

  it('SILENTLY DROPS a single wei from 1 NEC + 1 wei', () => {
    const exact = E18 + ONE;
    const got = String(normalizeResponse(hexOf(exact)));
    expect(exact.toString()).toBe('1000000000000000001');
    expect(got).toBe('1000000000000000000'); // <- the defect: one wei vanished
    expect(got).not.toBe(exact.toString());
  });

  it('returns a large balance in EXPONENTIAL form, which is unusable as a value', () => {
    const exact = BigInt(80000000) * E18; // the Public allocation on chain 2570
    const got = String(normalizeResponse(hexOf(exact)));
    expect(got).toBe('8e+25'); // <- the defect: not a number any RPC will accept back
    expect(got).not.toBe(exact.toString());
  });

  it('crosses from exact to lossy exactly at 2^53, as a float64 does', () => {
    const p53 = TEN ** BigInt(0) * BigInt('9007199254740992'); // 2^53
    expect(String(normalizeResponse(hexOf(p53)))).toBe('9007199254740992');
    expect(String(normalizeResponse(hexOf(p53 + ONE)))).toBe('9007199254740992'); // +1 is lost
  });

  it('the WORKAROUND until it is fixed: read the hex yourself', () => {
    // Any caller that needs an exact quantity today must bypass the normalizer and parse the raw
    // JSON-RPC result. This is what deploy/chain2570's scripts and the faucet do.
    const exact = E18 + ONE;
    expect(BigInt(hexOf(exact)).toString()).toBe('1000000000000000001');
  });
});
