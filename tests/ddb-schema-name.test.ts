// The per-contract Postgres schema name (db_name) is a WIRE VALUE: every schema-scoped DDB RPC is
// keyed by this string and the node does NOT normalize it, so a client that derives a different
// name addresses a schema that does not exist -- silently, with no error that names the cause.
//
// These tests deliberately do NOT assert the FORMAT. A format assertion ("starts with c_", "is 42
// chars") passes just as happily against an off-by-one as against the truth, which is how the
// retired `name_last6` scheme survived in two clients after the node moved off it. Instead every
// expected value below was READ OUT OF a live NCOG validator's Postgres -- real contracts, deployed
// by the real node, whose schemas really exist -- and is compared against what the client computes
// from the same `contract_address`.
//
// Provenance of the fixture (read-only, 2026-09-05), reproduced verbatim from the 2-node dev pair:
//
//   $ docker exec ddb-postgres1 psql -U postgres -d contracts_common_db -A -F'|' -t \
//       -c "SELECT contract_address, contract_name, db_name FROM public.contracts ORDER BY contract_address;"
//
// ddb-postgres1 (:5432) and ddb-postgres2 (:5433) agree on every row reproduced here, and every
// dbName below is also present in that database's pg_namespace.
import { Ddb } from '../src/ddb';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Real rows from `public.contracts` on the live pair. `dbName` is the schema the NODE itself wrote
 * and CREATE SCHEMA'd -- not a value any client computed. `name` is carried only so the retired
 * scheme can be reconstructed and shown to miss.
 */
const LIVE_CONTRACTS: { address: string; name: string; dbName: string }[] = [
  { address: '0x000000000000000000000000000000000000c101', name: 'rl', dbName: 'c_000000000000000000000000000000000000c101' },
  { address: '0x000000000000000000000000000000000000d103', name: 'rld', dbName: 'c_000000000000000000000000000000000000d103' },
  { address: '0x000000000000000000000000000000000000f102', name: 'rl', dbName: 'c_000000000000000000000000000000000000f102' },
  { address: '0x000000000000000000000000000000000044aa55', name: 'n4', dbName: 'c_000000000000000000000000000000000044aa55' },
  { address: '0x00000000000000000000000000000000004fbb01', name: 'fb', dbName: 'c_00000000000000000000000000000000004fbb01' },
  { address: '0x00000000000000000000000000000000007a8b9c', name: 'upg', dbName: 'c_00000000000000000000000000000000007a8b9c' },
  { address: '0x0000000000000000000000000000000000a1b2c3', name: 'upg', dbName: 'c_0000000000000000000000000000000000a1b2c3' },
  { address: '0x0000000000000000000000000000000000ab1201', name: 'kt', dbName: 'c_0000000000000000000000000000000000ab1201' },
  { address: '0x0000000000000000000000000000000000b1c2d3', name: 'tbl', dbName: 'c_0000000000000000000000000000000000b1c2d3' },
  { address: '0x0000000000000000000000000000000000c1d2e3', name: 'bz', dbName: 'c_0000000000000000000000000000000000c1d2e3' },
  { address: '0x0000000000000000000000000000000000d4e5f6', name: 'upg', dbName: 'c_0000000000000000000000000000000000d4e5f6' },
  { address: '0x0000000000000000000000000000000000e4f5a6', name: 'seq', dbName: 'c_0000000000000000000000000000000000e4f5a6' },
  { address: '0x0000000000000000000000000000000000f4a5b6', name: 'bz', dbName: 'c_0000000000000000000000000000000000f4a5b6' },
];

/** The scheme the SDK and IDE used to ship, reconstructed so it can be shown to address nothing. */
const retiredNameLast6 = (name: string, address: string) => (name + '_' + address.slice(-6)).toLowerCase();

describe('deriveDbName against schemas a real node actually created', () => {
  it.each(LIVE_CONTRACTS)('derives the live schema $dbName from $address', ({ address, dbName }) => {
    expect(Ddb.deriveDbName(address)).toBe(dbName);
  });

  it('the retired name_last6 scheme matches NONE of the live schemas', () => {
    // This is the regression that matters. Every one of these strings was, until recently, what the
    // SDK and the Trimix IDE put on the wire for these very contracts.
    const live = new Set(LIVE_CONTRACTS.map((c) => c.dbName));
    for (const c of LIVE_CONTRACTS) {
      const old = retiredNameLast6(c.name, c.address);
      expect(old).not.toBe(c.dbName);
      expect(live.has(old)).toBe(false);
    }
  });

  it('two live contracts that SHARE a name still get distinct schemas', () => {
    // 'rl', 'upg' and 'bz' each appear on several live contracts. The contract name is caller-supplied,
    // so any derivation that consumed it put two tenants one address-grind away from one schema.
    const byName = new Map<string, string[]>();
    for (const c of LIVE_CONTRACTS) {
      byName.set(c.name, [...(byName.get(c.name) ?? []), Ddb.deriveDbName(c.address)]);
    }
    const shared = [...byName.entries()].filter(([, s]) => s.length > 1);
    expect(shared.length).toBeGreaterThan(0); // the fixture really does contain duplicate names
    for (const [, schemas] of shared) {
      expect(new Set(schemas).size).toBe(schemas.length);
    }
  });

  it('normalizes the forms a caller actually types to the ONE live schema', () => {
    // A checksummed address from a wallet, a bare address from a config file and a padded one from a
    // copy-paste must all reach the same schema, or one contract owns two names and its writes split.
    const { address, dbName } = LIVE_CONTRACTS[4]; // 0x...4fbb01
    for (const form of [
      address,
      '0x' + address.slice(2).toUpperCase(),
      '0X' + address.slice(2),
      address.slice(2),
      '  ' + address + '  ',
    ]) {
      expect(Ddb.deriveDbName(form)).toBe(dbName);
    }
  });

  it('refuses an address that cannot name a schema instead of returning one', () => {
    for (const bad of ['', '   ', '0x', '0xnothex', '0x21c3; DROP SCHEMA public CASCADE--', '../../etc/passwd']) {
      expect(() => Ddb.deriveDbName(bad)).toThrow(/invalid contract address/);
    }
  });
});

// The scheme drifted in the first place because it was copy-pasted rather than shared. The Trimix IDE
// cannot import @ncog/necjs yet (it pins ^2.0.1, whose deriveDbName still returns the retired form), so
// it keeps its own copy -- and this fails the moment that copy disagrees with this one.
const IDE_MODULE = path.resolve(
  __dirname,
  '../../ncog-trimix-ide/apps/remix-ide/src/app/plugins/contract-generator/ddbSchemaName.ts',
);
// Skipped outside the monorepo (a standalone SDK checkout has no IDE), never silently passed.
const describeIde = fs.existsSync(IDE_MODULE) ? describe : describe.skip;

describeIde('the Trimix IDE copy agrees with the SDK', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ideDerive: (a: string) => string = require(IDE_MODULE).deriveDbName;

  it.each(LIVE_CONTRACTS)('IDE derives $dbName for $address, same as the SDK', ({ address, dbName }) => {
    expect(ideDerive(address)).toBe(dbName);
    expect(ideDerive(address)).toBe(Ddb.deriveDbName(address));
  });

  it('IDE agrees with the SDK on normalization and on failing closed', () => {
    const messy = '  0X00000000000000000000000000000000004FBB01 ';
    expect(ideDerive(messy)).toBe(Ddb.deriveDbName(messy));
    expect(ideDerive(messy)).toBe('c_00000000000000000000000000000000004fbb01');
    for (const bad of ['', '0x', '0xnothex']) {
      expect(() => ideDerive(bad)).toThrow(/invalid contract address/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// resolveDbName: ask the chain, derive only as a fallback.
//
// WHY THIS EXISTS, and why deriveDbName alone is not enough. Two independent reviewers checked the
// derivation against different chains and reached opposite verdicts, and BOTH were right:
//
//   * against a locally-built node, all 25 derived names matched pg_namespace exactly;
//   * against a node running an OLDER binary -- one predating "derive the contract schema from the
//     full address" -- ddb_getSchema reports db_name "userregistry_006a66", the retired
//     contractName_last6 scheme. There, ddb_select("c_<40 hex>", "users") errors on EVERY call while
//     ddb_select("userdirectory_6615e7", "users") returns the rows.
//
// So a source-correct derivation can still be production-incompatible. The node already reports the
// real name; asking removes the guess, and on a current node both answers agree.
describe('resolveDbName prefers what the chain reports', () => {
  const ADDR = '0xddb0000000000000000000000000000000006a66';

  function ddbWith(getSchemaImpl: (addr: string) => Promise<any>): any {
    const ddb: any = new (Ddb as any)({ send: async () => ({}) });
    ddb.getSchema = getSchemaImpl;
    return ddb;
  }

  it('uses the OLD-scheme db_name a legacy node reports, not the derived one', async () => {
    const ddb = ddbWith(async () => ({ contracts: [{ contract_address: ADDR, db_name: 'userregistry_006a66' }] }));
    const got = await ddb.resolveDbName(ADDR);
    expect(got).toBe('userregistry_006a66');
    // The whole point: it must NOT be the derived name, which addresses nothing on that node.
    expect(got).not.toBe(Ddb.deriveDbName(ADDR));
  });

  it('agrees with derivation on a current node', async () => {
    const current = Ddb.deriveDbName(ADDR);
    const ddb = ddbWith(async () => ({ contracts: [{ contract_address: ADDR, db_name: current }] }));
    await expect(ddb.resolveDbName(ADDR)).resolves.toBe(current);
  });

  it('falls back to derivation when the node reports no db_name', async () => {
    const ddb = ddbWith(async () => ({ contracts: [{ contract_address: ADDR }] }));
    await expect(ddb.resolveDbName(ADDR)).resolves.toBe(Ddb.deriveDbName(ADDR));
  });

  it('falls back to derivation when the lookup fails outright', async () => {
    const ddb = ddbWith(async () => { throw new Error('node unreachable'); });
    await expect(ddb.resolveDbName(ADDR)).resolves.toBe(Ddb.deriveDbName(ADDR));
  });
});
