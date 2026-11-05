import { createSecretKey, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { encodeDdbPrivateRetryState, decodeDdbPrivateRetryState, DDB_PRIVATE_RETRY_MAX_BYTES, DDB_PRIVATE_RETRY_WORST_CASE_BYTES } from '../src/ddb-private-retry';
import { createDdbNodePrivateRetryStore } from '../src/ddb-private-retry-node';
import { prepareDdbPrivateTransaction } from '../src/ddb-private-txn-online';
import { privateClientFixture, caller, database, chain, hash } from './fixtures/private-client';

const dirs: string[] = [];
afterEach(async () => { for (const directory of dirs.splice(0)) await fs.rm(directory, { recursive: true, force: true }); jest.restoreAllMocks(); });
async function fixture() {
  const f = privateClientFixture(); const record = await prepareDdbPrivateTransaction(f.input);
  const state = { kind: 'private-client-retry-v1' as const, record, phase: 'prepared' as const, commitTxHash: null,
    authority: { trust: 'trusted-validating-node' as const, chain, database, caller,
      source: { validatorId: 9, address: f.placement.members[2].address, url: 'https://authority.example', tlsKeyHash: hash('cc') } },
    policy: { custodyHosts: [2, 7], requiredHosts: [2, 7], submitRecipient: 7 } };
  const directory = await fs.mkdtemp(join(tmpdir(), 'nec-private-retry-')); dirs.push(directory);
  const key = createSecretKey(randomBytes(32));
  const store = createDdbNodePrivateRetryStore({ directory, key: async () => key, sync: 'file' });
  return { f, state, directory, key, store };
}

test('closed local codec restores exact typed hashes signatures sidecars and explicit policy without keys', async () => {
  const { state } = await fixture(); const encoded = encodeDdbPrivateRetryState(state);
  const decoded = decodeDdbPrivateRetryState(encoded);
  expect(decoded).toEqual(state); expect(decoded.record.retained.members[0].hash).toBeInstanceOf(Uint8Array);
  expect(decoded.record.retained.members[0].hash).not.toBe(state.record.retained.members[0].hash);
  expect(encoded.length).toBeLessThan(DDB_PRIVATE_RETRY_MAX_BYTES);
  const text = new TextDecoder().decode(encoded);
  expect(() => decodeDdbPrivateRetryState(new TextEncoder().encode(text.replace('"requiredHosts":[2,7]', '"requiredHosts":[]')))).toThrow();
  expect(() => decodeDdbPrivateRetryState(new TextEncoder().encode(text.replace('{', '{"unexpected":true,')))).toThrow();
  expect(() => encodeDdbPrivateRetryState({ ...state, policy: { ...state.policy, requiredHosts: new Array(2) } })).toThrow();
  expect(DDB_PRIVATE_RETRY_WORST_CASE_BYTES).toBeLessThan(DDB_PRIVATE_RETRY_MAX_BYTES);
  expect(() => decodeDdbPrivateRetryState(new Uint8Array(DDB_PRIVATE_RETRY_MAX_BYTES + 1))).toThrow();
});

test('real encrypted atomic store preserves original unit and monotonic submission checkpoint', async () => {
  const { state, directory, store } = await fixture(); await store.create(state);
  const files = await fs.readdir(directory); expect(files).toHaveLength(1);
  const ciphertext = await fs.readFile(join(directory, files[0]));
  expect(ciphertext.toString()).not.toContain(state.record.retained.sidecars[0].payload);
  expect(ciphertext.toString()).not.toContain('transfer');
  expect(await store.load(state.record.retained.id)).toEqual(state);
  await expect(store.create(state)).rejects.toThrow();
  const attempted = await store.beginSubmission(state.record.retained.id);
  expect(attempted.phase).toBe('submission_attempted'); expect(attempted.record).toEqual(state.record);
  await expect(store.beginSubmission(state.record.retained.id)).rejects.toThrow();
  await store.recordSubmission(state.record.retained.id, hash('88'));
  expect((await store.load(state.record.retained.id)).commitTxHash).toBe(hash('88'));
  await expect(store.recordSubmission(state.record.retained.id, hash('99'))).rejects.toThrow();
});

test('wrong key ciphertext truncation scope swap and active lock refuse without plaintext disclosure', async () => {
  const { state, directory, store } = await fixture(); await store.create(state);
  const wrong = createDdbNodePrivateRetryStore({ directory, key: async () => createSecretKey(randomBytes(32)), sync: 'file' });
  await expect(wrong.load(state.record.retained.id)).rejects.toThrow(/private retry/);
  const name = (await fs.readdir(directory))[0], file = join(directory, name); const bytes = await fs.readFile(file);
  await fs.writeFile(join(directory, hash('ee').slice(2) + '.retry'), bytes);
  await expect(store.load(hash('ee'))).rejects.toThrow();
  const lock = join(directory, state.record.retained.id.slice(2) + '.lock'); await fs.writeFile(lock, 'existing writer');
  await expect(store.beginSubmission(state.record.retained.id)).rejects.toThrow();
  expect(await fs.readFile(lock, 'utf8')).toBe('existing writer'); await fs.unlink(lock);
  bytes[bytes.length - 1] ^= 1; await fs.writeFile(file, bytes);
  await expect(store.load(state.record.retained.id)).rejects.toThrow(/private retry/);
  await fs.writeFile(file, bytes.subarray(0, 12)); await expect(store.load(state.record.retained.id)).rejects.toThrow();
  await expect(store.load('../outside')).rejects.toThrow();
});

test('required flush and rename failures never become successful persistence and release handled locks', async () => {
  const { state, directory, key, store } = await fixture();
  const rename = jest.spyOn(require('fs/promises'), 'rename').mockRejectedValueOnce(new Error('private path sentinel'));
  await expect(store.create(state)).rejects.toThrow(/private retry/); expect(await fs.readdir(directory)).toEqual([]); rename.mockRestore();
  const realOpen = fs.open;
  const opened = jest.spyOn(require('fs/promises'), 'open').mockImplementation(async (path: any, ...args: any[]) => {
    if (path === directory) throw new Error('directory flush unsupported');
    return (realOpen as any)(path, ...args);
  });
  const required = createDdbNodePrivateRetryStore({ directory, key: async () => key, sync: 'file-and-directory' });
  await expect(required.create(state)).rejects.toThrow(/private retry/); opened.mockRestore();
  // A failed post-rename directory flush may leave a valid record, but was not acknowledged as saved.
  expect((await fs.readdir(directory)).every(name => !name.endsWith('.lock') && !name.endsWith('.tmp'))).toBe(true);
});
