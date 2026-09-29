// GOV-06 (NEC-111): preimageVersion 'auto'. The SDK reads nec_rules and signs the v2 preimage only
// when the node reports ddb-op-preimage-v2 ACTIVE in the current epoch. A node without nec_rules (or
// one that errors) gets v1 -- exactly what the SDK signed before 'auto' existed -- so the default can
// be 'auto' without changing anything on a network that has not activated v2.
import {
  Ddb,
  DdbSigner,
  buildDdbOp,
  canonicalDdbOperationHash,
  canonicalDdbOperationHashV2,
} from '../src/ddb';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const utf8 = (s: string) => new TextEncoder().encode(s);

const NETWORK = 0x9af;
const FIX = {
  schemaName: 'nec_vector_contract',
  dataText: '{"contract_address":"0x00000000000000000000000000000000000000C0","k":"v"}',
  from: '0x00000000000000000000000000000000000000a1',
  timestamp: 1700000000,
  gasLimit: 250000,
  nonce: 7,
};
const opts = { timestamp: FIX.timestamp, gasLimit: FIX.gasLimit, nonce: FIX.nonce };

const signer: DdbSigner = {
  getAddress: () => FIX.from,
  getPublicKey: () => new Uint8Array(4),
  signDdbHash: (h) => h, // echo: the submitted callerSig IS the signed hash
};

const V1_SIG = '0x' + hex(canonicalDdbOperationHash(
  7, FIX.schemaName, utf8(FIX.dataText), FIX.from, FIX.timestamp, FIX.gasLimit, FIX.nonce));

// A nec_rules result as gossip/rules_api.go serves it (only the fields the SDK reads matter).
const rules = (status: 'active' | 'scheduled' | 'inactive') => ({
  epoch: '0x5',
  features: {
    'ddb-op-preimage-v2': { id: 'ddb-op-preimage-v2', status, active: status === 'active', scheduled: status !== 'inactive' },
  },
});

type NecRules = ReturnType<typeof rules> | Error;
const mock = (necRules: NecRules) => {
  const calls: Array<[string, any[]]> = [];
  const provider: any = {
    send: (m: string, p: any[]) => {
      calls.push([m, p]);
      if (m === 'nec_rules') return necRules instanceof Error ? Promise.reject(necRules) : Promise.resolve(necRules);
      return Promise.resolve(m === 'eth_chainId' ? '0x9af' : '0xc0ffee');
    },
  };
  return { calls, provider };
};

const submit = (provider: any, ddbOpts?: any, callOpts: any = opts) =>
  new Ddb(provider, ddbOpts).submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, callOpts);

const submitted = (calls: Array<[string, any[]]>) => calls.find((c) => c[0] === 'ddb_submitSignedOp')![1][0];

describe("preimageVersion 'auto' (the default)", () => {
  it('signs v1 on an old node that has no nec_rules (method not found)', async () => {
    const { calls, provider } = mock(Object.assign(new Error('the method nec_rules does not exist/is not available'), { code: -32601 }));
    await submit(provider);
    expect(calls.map((c) => c[0])).toEqual(['nec_rules', 'ddb_submitSignedOp']);
    expect(submitted(calls).callerSig).toBe(V1_SIG);
    expect(submitted(calls)).not.toHaveProperty('expiry');
  });

  it('signs v1 when v2 is only SCHEDULED: the network does not verify v2 until its epoch', async () => {
    const { calls, provider } = mock(rules('scheduled'));
    await submit(provider);
    expect(calls.map((c) => c[0])).toEqual(['nec_rules', 'ddb_submitSignedOp']);
    expect(submitted(calls).callerSig).toBe(V1_SIG);
  });

  it('signs v2 (and asks for the chain id) when the node reports v2 active', async () => {
    const { calls, provider } = mock(rules('active'));
    await submit(provider);
    expect(calls.map((c) => c[0])).toEqual(['nec_rules', 'eth_chainId', 'ddb_submitSignedOp']);
    const env = submitted(calls);
    expect(env.callerSig).toBe('0x' + hex(canonicalDdbOperationHashV2({
      type: 7, chainId: NETWORK, schemaName: FIX.schemaName, data: utf8(FIX.dataText), from: FIX.from,
      timestamp: FIX.timestamp, gasLimit: FIX.gasLimit, nonce: FIX.nonce, expiry: FIX.timestamp + 300, keyVersion: 0,
    })));
    expect(env.expiry).toBe('0x' + (FIX.timestamp + 300).toString(16));
  });

  it('is the same as an explicit { opPreimageVersion: "auto" }', async () => {
    const { calls, provider } = mock(rules('active'));
    await submit(provider, { opPreimageVersion: 'auto' });
    expect(calls[0][0]).toBe('nec_rules');
    expect(submitted(calls).expiry).toBeDefined();
  });

  it('remembers v2 once seen (activation is monotonic), but re-asks while v1', async () => {
    const v2 = mock(rules('active'));
    const d2 = new Ddb(v2.provider);
    await d2.submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, opts);
    await d2.submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, opts);
    expect(v2.calls.filter((c) => c[0] === 'nec_rules')).toHaveLength(1);

    const v1 = mock(rules('scheduled'));
    const d1 = new Ddb(v1.provider);
    await d1.submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, opts);
    await d1.submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, opts);
    expect(v1.calls.filter((c) => c[0] === 'nec_rules')).toHaveLength(2);
  });

  it('an explicit version never asks nec_rules', async () => {
    for (const v of [1, 2] as const) {
      const { calls, provider } = mock(rules('active'));
      await submit(provider, { opPreimageVersion: v }, v === 2 ? opts : opts);
      expect(calls.map((c) => c[0])).not.toContain('nec_rules');
    }
  });

  it('resolveOpPreimageVersion reports the choice for a wallet that builds its own op', async () => {
    expect(await new Ddb(mock(rules('active')).provider).resolveOpPreimageVersion()).toBe(2);
    expect(await new Ddb(mock(rules('inactive')).provider).resolveOpPreimageVersion()).toBe(1);
    expect(await new Ddb(mock(new Error('boom')).provider).resolveOpPreimageVersion()).toBe(1);
  });

  it("buildDdbOp is offline and refuses 'auto' instead of guessing", () => {
    expect(() => buildDdbOp('callprocedure', FIX.schemaName, FIX.dataText, FIX.from, new Uint8Array(4),
      { ...opts, preimageVersion: 'auto' as any })).toThrow(/auto/);
  });
});
