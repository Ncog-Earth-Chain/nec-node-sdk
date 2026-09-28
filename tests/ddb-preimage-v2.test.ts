/**
 * The v2 DDB operation preimage (SEC-03, NEC-55): "NEC-DDB-OP\x02", which binds the chain id, the
 * database identity, an expiry and a key version on top of the v1 fields.
 *
 * Every constant below is the node's, copied verbatim from ncogearthchain gossip/ddb/op_preimage_test.go
 * (canonicalOpVectorsV2, fixture vectorOpV2, network 0x9af). None is recomputed from src/ddb.ts: a
 * vector derived from the implementation under test catches nothing. If one of these fails, this SDK
 * signs a v2 operation the chain will refuse with "caller signature verification failed".
 *
 * v2 is NOT the default. FeatureDdbOpPreimageV2 is not active on any network, and the node reports no
 * rules or features over RPC, so a caller opts in explicitly (preimageVersion: 2, per call or per Ddb).
 */
import { ethers } from 'ethers';
import {
  Ddb,
  DdbSigner,
  buildDdbOp,
  canonicalDdbOperationBytesV2,
  canonicalDdbOperationHash,
  canonicalDdbOperationHashV2,
  canonicalDdbRequestIdV2,
  ddbOpPreimageDbIdentity,
} from '../src/ddb';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const utf8 = (s: string) => new TextEncoder().encode(s);

// [name, preimage hex, hash] in type-byte order 0..9 (inter.DdbOperationType iota order).
const V2_VECTORS: ReadonlyArray<readonly [string, string, string]> = [
  ["CreateSchema", "4e45432d4444422d4f50020000000000000000000000000000000000000000000000000000000000000009af000000000000002a635f3030303030303030303030303030303030303030303030303030303030303030303030303030633000000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x1210bd5d4090dcdc9e7084b15312f8294c34cbaa2d018ad2a59c1b877260a6f8"],
  ["UpdateSchema", "4e45432d4444422d4f50020100000000000000000000000000000000000000000000000000000000000009af000000000000002a635f3030303030303030303030303030303030303030303030303030303030303030303030303030633000000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x76223281e83c8b2ee21894d3caa3b0bb273dc8aaa879701a6c368400aaf7ae44"],
  ["DeleteSchema", "4e45432d4444422d4f50020200000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0xcbe4b7af3cbf59ad0fdab3cf94e07aebd1babeab75ff8a4ebd27f463ad141567"],
  ["CreateTable", "4e45432d4444422d4f50020300000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x97557e25fa9858afb6a3f40e486437619eb8c13fbb1919c7446472244a0b32dc"],
  ["InsertData", "4e45432d4444422d4f50020400000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0xac405b7c43e8382697fbefe1ab6bbdd413fa28d604822674576c64c5ca98a187"],
  ["UpdateData", "4e45432d4444422d4f50020500000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x5927c7b74305e84552304d0ad11c041dfde28505813263791d66b3b9e3c914a2"],
  ["DeleteData", "4e45432d4444422d4f50020600000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x21513003d9b70b27dfcca6e30c0178051e2be37d90ba84974df8351d8ecb31c6"],
  ["CallProcedure", "4e45432d4444422d4f50020700000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x9aae183f7dd3faba73715c820179ce37cde0caef88f73610357e317b2a6c016b"],
  ["GrantRole", "4e45432d4444422d4f50020800000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0x5c4bab2ffa3474f186eb272856d783525de8c3b4e677591da5e836a5a5d4e27b"],
  ["RevokeRole", "4e45432d4444422d4f50020900000000000000000000000000000000000000000000000000000000000009af00000000000000136e65635f766563746f725f636f6e747261637400000000000000136e65635f766563746f725f636f6e747261637400000000000000497b22636f6e74726163745f61646472657373223a22307830303030303030303030303030303030303030303030303030303030303030303030303030304330222c226b223a2276227d00000000000000000000000000000000000000a1000000006553f100000000000003d0900000000000000007000000006553f3580000000000000003", "0xd2b632f31a0974f174f0235447a5002da424b5a0b5863d7c03800b49ea4f2b0b"],
];

// vectorOpV2: vectorOp plus a Data naming a contract address, Expiry and KeyVersion.
const NETWORK = 0x9af;
const FIX = {
  schemaName: 'nec_vector_contract',
  dataText: '{"contract_address":"0x00000000000000000000000000000000000000C0","k":"v"}',
  from: '0x00000000000000000000000000000000000000a1',
  timestamp: 1700000000,
  gasLimit: 250000,
  nonce: 7,
  expiry: 1700000600,
  keyVersion: 3,
};
const fixOp = (type: number) => ({
  type,
  chainId: NETWORK,
  schemaName: FIX.schemaName,
  data: utf8(FIX.dataText),
  from: FIX.from,
  timestamp: FIX.timestamp,
  gasLimit: FIX.gasLimit,
  nonce: FIX.nonce,
  expiry: FIX.expiry,
  keyVersion: FIX.keyVersion,
});

describe('the v2 preimage, pinned to the node vectors for all ten operation types', () => {
  it('has a vector for every type the node defines', () => {
    expect(V2_VECTORS).toHaveLength(10);
  });

  V2_VECTORS.forEach(([name, preimage, hash], type) => {
    it(`${name} (type ${type}): preimage and hash byte for byte`, () => {
      expect(hex(canonicalDdbOperationBytesV2(fixOp(type)))).toBe(preimage);
      expect('0x' + hex(canonicalDdbOperationHashV2(fixOp(type)))).toBe(hash);
      // The pinned hash is keccak256 of the pinned bytes, checked with a second keccak copy (ethers).
      expect(ethers.keccak256('0x' + preimage)).toBe(hash);
    });
  });

  it('the request id is keccak256(preimage || requester)', () => {
    const want = ethers.keccak256('0x' + V2_VECTORS[7][1] + FIX.from.slice(2));
    expect('0x' + hex(canonicalDdbRequestIdV2(fixOp(7), FIX.from))).toBe(want);
  });

  it('starts with the v2 domain and keeps the type byte at offset 11', () => {
    const b = canonicalDdbOperationBytesV2(fixOp(4));
    expect(Buffer.from(b.slice(0, 11)).toString('latin1')).toBe('NEC-DDB-OP\x02');
    expect(b[11]).toBe(4);
  });

  it('binds the chain id: the same op on another network is a different hash', () => {
    expect(hex(canonicalDdbOperationHashV2({ ...fixOp(7), chainId: 1 })))
      .not.toBe(hex(canonicalDdbOperationHashV2(fixOp(7))));
  });

  it('refuses an operation type outside the node range instead of truncating it', () => {
    expect(() => canonicalDdbOperationBytesV2(fixOp(10))).toThrow(/operation type/);
    expect(() => canonicalDdbOperationBytesV2(fixOp(undefined as any))).toThrow(/operation type/);
  });
});

describe('the v2 database identity (Go preimageDbIdentity)', () => {
  const data = (s: string) => utf8(s);
  it('is c_ + the lower-case address for a create or an update', () => {
    expect(ddbOpPreimageDbIdentity(0, 'x', data(FIX.dataText))).toBe('c_00000000000000000000000000000000000000c0');
    expect(ddbOpPreimageDbIdentity(1, 'x', data(' {"contract_address":" 0XABcd "}'))).toBe('c_abcd');
  });
  it('is SchemaName for every other type, whatever Data says', () => {
    for (const t of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(ddbOpPreimageDbIdentity(t, 'nec_vector_contract', data(FIX.dataText))).toBe('nec_vector_contract');
    }
  });
  it('is empty when Data is not a contract definition or the address is not hex', () => {
    for (const d of ['{"k":"v"}', '[]', 'null', '"s"', '{"contract_address":7}', '{"contract_address":"0xZZ"}',
      '{"contract_address":""}', '{"contract_address":"0x"}', 'not json']) {
      expect(ddbOpPreimageDbIdentity(0, 'x', data(d))).toBe('');
    }
  });
  it('follows encoding/json key matching: case-insensitive, last match wins', () => {
    expect(ddbOpPreimageDbIdentity(0, 'x', data('{"contract_address":"0xaa","CONTRACT_ADDRESS":"0xbb"}'))).toBe('c_bb');
    expect(ddbOpPreimageDbIdentity(0, 'x', data('{"Contract_Address":"0xaa"}'))).toBe('c_aa');
    // A JSON null leaves the field untouched, as Go does.
    expect(ddbOpPreimageDbIdentity(0, 'x', data('{"contract_address":"0xaa","contract_address":null}'))).toBe('c_aa');
  });
});

describe('buildDdbOp: v1 stays the default, v2 is an explicit opt-in', () => {
  const PUB = new Uint8Array(4);
  const base = { timestamp: FIX.timestamp, gasLimit: FIX.gasLimit, nonce: FIX.nonce };

  it('without preimageVersion signs v1 and sends no v2 fields', () => {
    const p = buildDdbOp('createschema', FIX.schemaName, FIX.dataText, FIX.from, PUB, base);
    expect(hex(p.hash)).toBe(hex(canonicalDdbOperationHash(
      0, FIX.schemaName, utf8(FIX.dataText), FIX.from, FIX.timestamp, FIX.gasLimit, FIX.nonce)));
    expect(p.envelope).not.toHaveProperty('expiry');
    expect(p.envelope).not.toHaveProperty('keyVersion');
  });

  it('refuses expiry or keyVersion under v1, which would not sign them', () => {
    expect(() => buildDdbOp('createschema', 's', {}, FIX.from, PUB, { ...base, expiry: FIX.expiry }))
      .toThrow(/preimage v2/);
    expect(() => buildDdbOp('createschema', 's', {}, FIX.from, PUB, { ...base, keyVersion: 1 }))
      .toThrow(/preimage v2/);
  });

  it('with preimageVersion 2 signs the node vector and carries expiry/keyVersion on the envelope', () => {
    const p = buildDdbOp('createschema', FIX.schemaName, FIX.dataText, FIX.from, PUB, {
      ...base, preimageVersion: 2, chainId: NETWORK, expiry: FIX.expiry, keyVersion: FIX.keyVersion,
    });
    expect('0x' + hex(p.hash)).toBe(V2_VECTORS[0][2]);
    expect(p.requestId).toBe(ethers.keccak256('0x' + V2_VECTORS[0][1] + FIX.from.slice(2)));
    expect(p.envelope.expiry).toBe('0x6553f358');
    expect(p.envelope.keyVersion).toBe('0x3');
    expect(p.envelope.type).toBe('createschema');
  });

  it('requires the chain id under v2 rather than guessing one', () => {
    expect(() => buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...base, preimageVersion: 2 }))
      .toThrow(/chainId/);
  });

  it('defaults expiry to timestamp + 300 s and keyVersion to 0', () => {
    const p = buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...base, preimageVersion: 2, chainId: NETWORK });
    expect(p.envelope.expiry).toBe('0x' + (FIX.timestamp + 300).toString(16));
    expect(p.envelope.keyVersion).toBe('0x0');
  });

  it('refuses an expiry the node admission rule would refuse', () => {
    const v2 = { ...base, preimageVersion: 2 as const, chainId: NETWORK };
    expect(() => buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...v2, expiry: 0 })).toThrow(/expiry/);
    expect(() => buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...v2, expiry: FIX.timestamp - 1 }))
      .toThrow(/expiry/);
    expect(() => buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...v2, expiry: FIX.timestamp + 901 }))
      .toThrow(/900/);
    // The boundaries themselves are admitted.
    buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...v2, expiry: FIX.timestamp });
    buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...v2, expiry: FIX.timestamp + 900 });
  });

  it('refuses an unknown preimage version', () => {
    expect(() => buildDdbOp('callprocedure', 's', {}, FIX.from, PUB, { ...base, preimageVersion: 3 as any }))
      .toThrow(/preimage version/);
  });
});

describe('Ddb: the v2 wire path', () => {
  const signer: DdbSigner = {
    getAddress: () => FIX.from,
    getPublicKey: () => new Uint8Array(4),
    signDdbHash: (h) => h, // echo: lets the test read back exactly what was signed
  };
  const mock = () => {
    const calls: Array<[string, any[]]> = [];
    const provider: any = {
      send: (m: string, p: any[]) => {
        calls.push([m, p]);
        return Promise.resolve(m === 'eth_chainId' ? '0x9af' : '0xc0ffee');
      },
    };
    return { calls, provider };
  };
  const opts = { timestamp: FIX.timestamp, gasLimit: FIX.gasLimit, nonce: FIX.nonce, expiry: FIX.expiry, keyVersion: 3 };

  it('a Ddb built with opPreimageVersion 2 asks the node for its chain id and signs the node vector', async () => {
    const { calls, provider } = mock();
    await new Ddb(provider, { opPreimageVersion: 2 })
      .submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, opts);
    expect(calls.map((c) => c[0])).toEqual(['eth_chainId', 'ddb_submitSignedOp']);
    const env = calls[1][1][0];
    expect(env.callerSig).toBe(V2_VECTORS[7][2]);
    expect(env.expiry).toBe('0x6553f358');
    expect(env.keyVersion).toBe('0x3');
  });

  it('a default Ddb still signs v1 and never asks for the chain id', async () => {
    const { calls, provider } = mock();
    const { expiry, keyVersion, ...v1opts } = opts;
    await new Ddb(provider).submitOperationSigned(signer, 'callprocedure', FIX.schemaName, FIX.dataText, v1opts);
    expect(calls.map((c) => c[0])).toEqual(['ddb_submitSignedOp']);
    expect(calls[0][1][0].callerSig).toBe('0x' + hex(canonicalDdbOperationHash(
      7, FIX.schemaName, utf8(FIX.dataText), FIX.from, FIX.timestamp, FIX.gasLimit, FIX.nonce)));
    expect(calls[0][1][0]).not.toHaveProperty('expiry');
  });

  it('a per-call preimageVersion overrides the Ddb default', async () => {
    const { calls, provider } = mock();
    await new Ddb(provider).deleteSchemaSigned(signer, FIX.schemaName, { ...opts, preimageVersion: 2, chainId: NETWORK });
    expect(calls.map((c) => c[0])).toEqual(['ddb_submitSignedOp']);
    expect(calls[0][1][0].callerSig).toBe('0x' + hex(canonicalDdbOperationHashV2({
      ...fixOp(2), data: utf8('{}'),
    })));
  });
});
