import { createCipheriv, createDecipheriv, KeyObject, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { encodeDdbPrivateRetryState, decodeDdbPrivateRetryState, ownDdbPrivateRetryState,
  DDB_PRIVATE_RETRY_MAX_BYTES, type DdbPrivateRetryState, type DdbPrivateRetryStore } from './ddb-private-retry';
import { evidenceFixed } from './ddb-private-evidence';

// Local encrypted file framing only: 8-byte version, 12-byte GCM nonce, 16-byte tag, ciphertext.
// Neither this framing nor its AAD is a network or transaction signing domain.
const MAGIC = Buffer.from('NPRTRY01', 'ascii'), HEADER = 36, FILE_MAX = DDB_PRIVATE_RETRY_MAX_BYTES + HEADER;
const fail = (): never => { throw new Error('private retry storage unavailable'); };
export interface DdbNodePrivateRetryStoreOptions {
  /** Existing absolute application-controlled directory. No directory or key is silently created. */
  directory: string;
  /** Separate caller-owned AES key; never a signing/digest key or a passphrase/argv value. */
  key(): Promise<KeyObject>;
  /** Explicit guarantee requested. Unsupported/failed required directory sync is an error. */
  sync: 'file' | 'file-and-directory';
}

/** Real authenticated encrypted I/O. File sync alone does not promise directory/power-loss durability. */
export function createDdbNodePrivateRetryStore(options: DdbNodePrivateRetryStoreOptions): DdbPrivateRetryStore {
  if (!options || typeof options.directory !== 'string' || !isAbsolute(options.directory) || typeof options.key !== 'function' ||
    !['file', 'file-and-directory'].includes(options.sync)) return fail();
  const directory = resolve(options.directory), getKey = options.key, sync = options.sync;
  const id = (value: string) => evidenceFixed(value, 32);
  const filename = (txn: string) => join(directory, txn.slice(2) + '.retry');
  const aad = (txn: string) => Buffer.concat([MAGIC, Buffer.from(txn.slice(2), 'hex')]);
  async function key(): Promise<KeyObject> {
    const value = await getKey();
    if (!(value instanceof KeyObject) || value.type !== 'secret' || value.symmetricKeySize !== 32) return fail();
    return value;
  }
  async function loadCaptured(txn: string): Promise<DdbPrivateRetryState> {
    const handle = await fs.open(filename(txn), 'r'); let encrypted: Buffer | undefined, plaintext: Buffer | undefined;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= HEADER || stat.size > FILE_MAX) return fail();
      encrypted = Buffer.alloc(stat.size + 1); let used = 0;
      while (used < encrypted.length) {
        const { bytesRead } = await handle.read(encrypted, used, encrypted.length - used, used);
        if (!bytesRead) break; used += bytesRead;
      }
      if (used !== stat.size || (await handle.stat()).size !== stat.size || !encrypted.subarray(0, 8).equals(MAGIC)) return fail();
      const decipher = createDecipheriv('aes-256-gcm', await key(), encrypted.subarray(8, 20), { authTagLength: 16 });
      decipher.setAAD(aad(txn)); decipher.setAuthTag(encrypted.subarray(20, HEADER));
      const pending = decipher.update(encrypted.subarray(HEADER, stat.size));
      try { plaintext = Buffer.concat([pending, decipher.final()]); } finally { pending.fill(0); }
      const state = decodeDdbPrivateRetryState(plaintext);
      if (state.record.retained.id !== txn) return fail();
      return state;
    } finally { plaintext?.fill(0); encrypted?.fill(0); await handle.close(); }
  }
  async function writeCaptured(state: DdbPrivateRetryState, create: boolean): Promise<void> {
    const txn = state.record.retained.id, target = filename(txn);
    if (create) {
      try { await fs.access(target); return fail(); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    }
    const plaintext = encodeDdbPrivateRetryState(state), nonce = randomBytes(12);
    const temporary = join(directory, txn.slice(2) + '.' + randomBytes(12).toString('hex') + '.tmp');
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined, created = false, renamed = false;
    try {
      const cipher = createCipheriv('aes-256-gcm', await key(), nonce, { authTagLength: 16 }); cipher.setAAD(aad(txn));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const framed = Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]); encrypted.fill(0);
      try {
        handle = await fs.open(temporary, 'wx', 0o600); created = true;
        await handle.writeFile(framed); await handle.sync(); await handle.close(); handle = undefined;
        await fs.rename(temporary, target); renamed = true;
        if (sync === 'file-and-directory') {
          const parent = await fs.open(directory, 'r');
          try { await parent.sync(); } finally { await parent.close(); }
        }
      } finally { framed.fill(0); }
    } finally {
      plaintext.fill(0); nonce.fill(0);
      if (handle) await handle.close();
      if (created && !renamed) await fs.unlink(temporary);
    }
  }
  async function locked<T>(txn: string, action: () => Promise<T>): Promise<T> {
    // Exclusive creation never steals another process's lock; crashed locks require application recovery.
    const path = join(directory, txn.slice(2) + '.lock'), lock = await fs.open(path, 'wx', 0o600);
    try { return await action(); }
    finally { try { await lock.close(); } finally { await fs.unlink(path); } }
  }
  return {
    async create(input) {
      try {
        const state = ownDdbPrivateRetryState(input);
        if (state.phase !== 'prepared' || state.commitTxHash !== null) return fail();
        await locked(id(state.record.retained.id), () => writeCaptured(state, true));
      } catch { return fail(); }
    },
    async load(txnId) { try { return await loadCaptured(id(txnId)); } catch { return fail(); } },
    async beginSubmission(txnId) {
      try {
        const txn = id(txnId);
        return await locked(txn, async () => {
          const state = await loadCaptured(txn);
          if (state.phase !== 'prepared') return fail();
          state.phase = 'submission_attempted'; await writeCaptured(state, false);
          return ownDdbPrivateRetryState(state);
        });
      } catch { return fail(); }
    },
    async recordSubmission(txnId, commitTxHash) {
      try {
        const txn = id(txnId), commit = evidenceFixed(commitTxHash, 32);
        await locked(txn, async () => {
          const state = await loadCaptured(txn);
          if (state.phase !== 'submission_attempted' || state.commitTxHash !== null && state.commitTxHash !== commit) return fail();
          state.commitTxHash = commit; await writeCaptured(state, false);
        });
      } catch { return fail(); }
    },
  };
}
