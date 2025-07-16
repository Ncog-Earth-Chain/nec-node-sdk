// WARNING: This file is for browser builds only.
// The WASM import below will break Node builds.
// Node builds should use mlkem-node.ts, which does not import WASM as a module.
//
// If you see errors about importing .wasm or ?url in Node, you are importing the wrong file.
//
// See package.json "browser" field and mlkem.ts for environment selection logic.
// Browser-compatible MLKEM WebAssembly loader

function createGoRuntime() {

  "use strict";

  // Check if we're in a browser environment
  if (typeof window === 'undefined' && typeof self === 'undefined') {
    throw new Error('This runtime is designed for browser environments');
  }
  const _global: any = typeof window !== 'undefined' ? window : self;

  // Go runtime implementation
  class Go {
    argv: string[];
    env: Record<string, string>;
    exit: (code: number) => void;
    _callbackTimeouts: Map<number, any>;
    _nextCallbackTimeoutID: number;
    _inst: any;
    _values: Map<any, any>;
    _goRefCounts: Map<any, any>;
    _ids: Map<any, any>;
    _idPool: { get: () => any; put: (id: any) => void };
    _mem: any;
    _lastSP: number;
    importObject: any;

    constructor() {
      this.argv = [];
      this.env = {};
      this.exit = (code: number) => {
        if (code !== 0) {
          console.warn('exit code:', code);
        }
      };
      this._callbackTimeouts = new Map();
      this._nextCallbackTimeoutID = 1;

      const mem = () => {
        const buffer = new ArrayBuffer(this._inst.exports.mem.buffer.byteLength);
        const u8 = new Uint8Array(buffer);
        const u16 = new Uint16Array(buffer);
        const u32 = new Uint32Array(buffer);
        const f32 = new Float32Array(buffer);
        const f64 = new Float64Array(buffer);
        const setInt64 = (addr: number, v: number) => {
          u32[addr + 4] = v;
          u32[addr] = (v / 4294967296) | 0;
        };
        const getInt64 = (addr: number) => {
          const low = u32[addr];
          const high = u32[addr + 4];
          return low + high * 4294967296;
        };
        const setUint64 = (addr: number, v: number) => {
          u32[addr + 4] = v;
          u32[addr] = (v / 4294967296) >>> 0;
        };
        const getUint64 = (addr: number) => {
          const low = u32[addr];
          const high = u32[addr + 4];
          return low + high * 4294967296;
        };

        return {
          buffer: buffer,
          u8: u8,
          u16: u16,
          u32: u32,
          u64: new BigUint64Array(buffer),
          f32: f32,
          f64: f64,
          setInt64: setInt64,
          getInt64: getInt64,
          setUint64: setUint64,
          getUint64: getUint64,
        };
      };

      this._inst = null;
      this._values = new Map();
      this._goRefCounts = new Map();
      this._ids = new Map();
      this._idPool = (() => {
        let ids: any[] = [];
        return {
          get: () => {
            if (ids.length === 0) {
              ids = new Array(16);
              for (let i = 0; i < 16; i++) {
                ids[i] = 1 + i;
              }
            }
            return ids.pop();
          },
          put: (id: any) => {
            ids.push(id);
          },
        };
      })();
      this._mem = mem();
      this._lastSP = 0;
      this.importObject = {
        go: {
          js: {
            mem: this._mem,
            setInt64: this._mem.setInt64,
            getInt64: this._mem.getInt64,
            setUint64: this._mem.setUint64,
            getUint64: this._mem.getUint64,
            debug: (value: any) => {
              console.log(value);
            },
          },
        },
      };
    }

    run(instance: WebAssembly.Instance) {
      this._inst = instance;
      this._mem = new DataView(this._inst.exports.mem.buffer);
      this._values = new Map();
      this._goRefCounts = new Map();
      this._ids = new Map();
      this._idPool = (() => {
        let ids: any[] = [];
        return {
          get: () => {
            if (ids.length === 0) {
              ids = new Array(16);
              for (let i = 0; i < 16; i++) {
                ids[i] = 1 + i;
              }
            }
            return ids.pop();
          },
          put: (id: any) => {
            ids.push(id);
          },
        };
      })();

      const setInt64 = (addr: number, v: number) => {
        this._mem.setUint32(addr + 4, v, true);
        this._mem.setUint32(addr, (v / 4294967296) | 0, true);
      };
      const getInt64 = (addr: number) => {
        const low = this._mem.getUint32(addr, true);
        const high = this._mem.getInt32(addr + 4, true);
        return low + high * 4294967296;
      };
      const setUint64 = (addr: number, v: number) => {
        this._mem.setUint32(addr + 4, v, true);
        this._mem.setUint32(addr, (v / 4294967296) >>> 0, true);
      };
      const getUint64 = (addr: number) => {
        const low = this._mem.getUint32(addr, true);
        const high = this._mem.getUint32(addr + 4, true);
        return low + high * 4294967296;
      };

      (this._mem as any).setInt64 = setInt64;
      (this._mem as any).getInt64 = getInt64;
      (this._mem as any).setUint64 = setUint64;
      (this._mem as any).getUint64 = getUint64;

      this._inst.exports.run();
    }
  }

  // Make Go available globally
  _global.Go = Go;

}

// --- Polyfill for Web Crypto API ---
declare global {
  var Go: any;
  var mlkemKeyGen: () => any;
  var mlkemEncrypt: (pubKey: string, message: string) => any;
  var mlkemDecrypt: (privKey: string, encryptedData: string, version: string) => any;
  var symEncrypt: (ssKey: string, message: string) => any;
  var symDecrypt: (ssKey: string, encryptedData: string, version: string) => any;
  var privateKeyToWalletAddress: (pk: string) => any;
  var signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => any;
  var decodeRLPTransaction: (txHex: string) => any;
  interface Crypto {
    getRandomValues(array: Uint8Array): void;
  }
}

// Ensure crypto is available
if (typeof globalThis.crypto === 'undefined') {
  throw new Error('Web Crypto API is required but not available in this environment');
}

import { wasmBase64 } from '../webassembly/wasm-base64';

function base64ToUint8Array(base64: string): Uint8Array {
  // Browser-only base64 decode
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Public interface for MLKEM operations in browser
 */
export interface MlKemBrowser {
  /**
   * Generate a new keypair.
   * Resolves to an object: { pubKey: base64-string; privKey: base64-string }.
   */
  keyGen(): Promise<{ pubKey: string; privKey: string }>;

  /**
   * Asymmetric encrypt with the given public key.
   */
  encrypt(
    pubKey: string,
    message: string
  ): Promise<{ encryptedData: string; version: string }>;

  /**
   * Asymmetric decrypt with the given private key.
   */
  decrypt(
    privKey: string,
    encryptedData: string,
    version: string
  ): Promise<string>;

  /**
   * Symmetric encrypt with the shared-secret key.
   */
  symEncrypt(
    ssKey: string,
    message: string
  ): Promise<{ encryptedData: string; version: string }>;

  /**
   * Symmetric decrypt with the shared-secret key.
   */
  symDecrypt(
    ssKey: string,
    encryptedData: string,
    version: string
  ): Promise<string>;

  /**
   * Derive an EVM-style address (hex) from a raw private-key string.
   */
  privateKeyToAddress(privateKey: string): string;

  /**
   * Sign a transaction object with the given private key.
   */
  signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => any;

  decodeRLPTransaction: (txHex: string) => any;
}

/**
 * Load and initialize the MLKEM Go WebAssembly module in browser.
 */
export async function loadWasm(): Promise<MlKemBrowser> {

  if (typeof globalThis.Go === 'undefined') {
    createGoRuntime();
  }

  const wasmBytes = base64ToUint8Array(wasmBase64);
  console.log("wasmBytes length", wasmBytes.length);
  if (!wasmBytes || wasmBytes.length === 0) {
    throw new Error('WASM bytes are empty! Check your base64 conversion and file generation.');
  }

  const go = new Go();
  const importObject = go.importObject;
  const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);

  try {
    go.run(instance);
  } catch (err) {
    console.error('Error starting go.run(instance):', err);
    throw err;
  }

  // Give Go time to register its JS functions
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    keyGen: async (): Promise<{ pubKey: string; privKey: string }> => {
      if (typeof globalThis.mlkemKeyGen !== 'function') {
        console.error(
          'Available globalThis keys:',
          Object.keys(globalThis).slice(0, 20)
        );
        throw new Error('mlkemKeyGen not found on globalThis');
      }
      const result = globalThis.mlkemKeyGen();
      if (result?.error) throw new Error(`Go keyGen failed: ${result.error}`);
      if (!result?.pubKey || !result?.privKey) {
        console.error('Unexpected keyGen result:', result);
        throw new Error('Invalid result from mlkemKeyGen');
      }
      return { pubKey: result.pubKey, privKey: result.privKey };
    },

    encrypt: async (pubKey, message) => {
      if (typeof globalThis.mlkemEncrypt !== 'function') {
        throw new Error('mlkemEncrypt not found on globalThis');
      }
      const result = globalThis.mlkemEncrypt(pubKey, message);
      if (result?.error) throw new Error(`Go encrypt failed: ${result.error}`);
      if (!result?.encrypted || !result?.version) {
        console.error('Unexpected encrypt result:', result);
        throw new Error('Invalid result from mlkemEncrypt');
      }
      return { encryptedData: result.encrypted, version: result.version };
    },

    decrypt: async (privKey, encryptedData, version) => {
      if (typeof globalThis.mlkemDecrypt !== 'function') {
        throw new Error('mlkemDecrypt not found on globalThis');
      }
      const result = globalThis.mlkemDecrypt(privKey, encryptedData, version);
      if (result?.error) throw new Error(`Go decrypt failed: ${result.error}`);
      if (typeof result.decrypted !== 'string') {
        console.error('Unexpected decrypt result:', result);
        throw new Error('Invalid result from mlkemDecrypt');
      }
      return result.decrypted;
    },

    symEncrypt: async (ssKey, message) => {
      if (typeof globalThis.symEncrypt !== 'function') {
        throw new Error('symEncrypt not found on globalThis');
      }
      const result = globalThis.symEncrypt(ssKey, message);
      if (result?.error) throw new Error(`Go symEncrypt failed: ${result.error}`);
      if (!result?.encrypted || !result?.version) {
        console.error('Unexpected symEncrypt result:', result);
        throw new Error('Invalid result from symEncrypt');
      }
      return { encryptedData: result.encrypted, version: result.version };
    },

    symDecrypt: async (ssKey, encryptedData, version) => {
      if (typeof globalThis.symDecrypt !== 'function') {
        throw new Error('symDecrypt not found on globalThis');
      }
      const result = globalThis.symDecrypt(ssKey, encryptedData, version);
      if (result?.error) throw new Error(`Go symDecrypt failed: ${result.error}`);
      if (typeof result.decrypted !== 'string') {
        console.error('Unexpected symDecrypt result:', result);
        throw new Error('Invalid result from symDecrypt');
      }
      return result.decrypted;
    },

    privateKeyToAddress: (privateKey: string): string => {
      if (typeof globalThis.privateKeyToWalletAddress !== 'function') {
        throw new Error('privateKeyToWalletAddress not found on globalThis');
      }
      const result = globalThis.privateKeyToWalletAddress(privateKey);
      if (result?.error) throw new Error(`Go privateKeyToAddress failed: ${result.error}`);
      if (typeof result.address !== 'string') {
        console.error('Unexpected address result:', result);
        throw new Error('Invalid result from privateKeyToWalletAddress');
      }
      return result.address;
    },

    signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => {
      if (typeof globalThis.signTransactionMLDSA87 !== 'function') {
        throw new Error('signTransactionMLDSA87 not found on globalThis');
      }
      const result = globalThis.signTransactionMLDSA87(TxObject, privateKeyHex);
      if (result?.error) throw new Error(`Go signTransactionMLDSA87 failed: ${result.error}`);
      if (typeof result !== 'object') {
        console.error('Unexpected result:', result);
        throw new Error('Invalid result from signTransactionMLDSA87');
      }
      return result;
    },
    decodeRLPTransaction: (txHex: string) => {
      if (typeof globalThis.decodeRLPTransaction !== 'function') {
        throw new Error('decodeRLPTransaction not found on globalThis');
      }
      const result = globalThis.decodeRLPTransaction(txHex);
      if (result?.error) throw new Error(`Go decodeRLPTransaction failed: ${result.error}`);
      if (typeof result !== 'object') {
        console.error('Unexpected result:', result);
        throw new Error('Invalid result from decodeRLPTransaction');
      }
      return result;
    }

  };
}

/**
 * Alternative loader that accepts WASM buffer directly
 */
export async function loadWasmFromBuffer(wasmBuffer: ArrayBuffer): Promise<MlKemBrowser> {
  if (typeof globalThis.Go === 'undefined') {
    createGoRuntime();
  }

  const go = new Go();
  const importObject = go.importObject;
  const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);

  try {
    go.run(instance);
  } catch (err) {
    console.error('Error starting go.run(instance):', err);
    throw err;
  }

  // Give Go time to register its JS functions
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    keyGen: async (): Promise<{ pubKey: string; privKey: string }> => {
      if (typeof globalThis.mlkemKeyGen !== 'function') {
        throw new Error('mlkemKeyGen not found on globalThis');
      }
      const result = globalThis.mlkemKeyGen();
      if (result?.error) throw new Error(`Go keyGen failed: ${result.error}`);
      if (!result?.pubKey || !result?.privKey) {
        throw new Error('Invalid result from mlkemKeyGen');
      }
      return { pubKey: result.pubKey, privKey: result.privKey };
    },

    encrypt: async (pubKey, message) => {
      if (typeof globalThis.mlkemEncrypt !== 'function') {
        throw new Error('mlkemEncrypt not found on globalThis');
      }
      const result = globalThis.mlkemEncrypt(pubKey, message);
      if (result?.error) throw new Error(`Go encrypt failed: ${result.error}`);
      if (!result?.encrypted || !result?.version) {
        throw new Error('Invalid result from mlkemEncrypt');
      }
      return { encryptedData: result.encrypted, version: result.version };
    },

    decrypt: async (privKey, encryptedData, version) => {
      if (typeof globalThis.mlkemDecrypt !== 'function') {
        throw new Error('mlkemDecrypt not found on globalThis');
      }
      const result = globalThis.mlkemDecrypt(privKey, encryptedData, version);
      if (result?.error) throw new Error(`Go decrypt failed: ${result.error}`);
      if (typeof result.decrypted !== 'string') {
        throw new Error('Invalid result from mlkemDecrypt');
      }
      return result.decrypted;
    },

    symEncrypt: async (ssKey, message) => {
      if (typeof globalThis.symEncrypt !== 'function') {
        throw new Error('symEncrypt not found on globalThis');
      }
      const result = globalThis.symEncrypt(ssKey, message);
      if (result?.error) throw new Error(`Go symEncrypt failed: ${result.error}`);
      if (!result?.encrypted || !result?.version) {
        throw new Error('Invalid result from symEncrypt');
      }
      return { encryptedData: result.encrypted, version: result.version };
    },

    symDecrypt: async (ssKey, encryptedData, version) => {
      if (typeof globalThis.symDecrypt !== 'function') {
        throw new Error('symDecrypt not found on globalThis');
      }
      const result = globalThis.symDecrypt(ssKey, encryptedData, version);
      if (result?.error) throw new Error(`Go symDecrypt failed: ${result.error}`);
      if (typeof result.decrypted !== 'string') {
        throw new Error('Invalid result from symDecrypt');
      }
      return result.decrypted;
    },

    privateKeyToAddress: (privateKey: string): string => {
      if (typeof globalThis.privateKeyToWalletAddress !== 'function') {
        throw new Error('privateKeyToWalletAddress not found on globalThis');
      }
      const result = globalThis.privateKeyToWalletAddress(privateKey);
      if (result?.error) throw new Error(`Go privateKeyToAddress failed: ${result.error}`);
      if (typeof result.address !== 'string') {
        throw new Error('Invalid result from privateKeyToWalletAddress');
      }
      return result.address;
    },

    signTransactionMLDSA87: (TxObject: any, privateKeyHex: string) => {
      if (typeof globalThis.signTransactionMLDSA87 !== 'function') {
        throw new Error('signTransactionMLDSA87 not found on globalThis');
      }
      const result = globalThis.signTransactionMLDSA87(TxObject, privateKeyHex);
      if (result?.error) throw new Error(`Go signTransactionMLDSA87 failed: ${result.error}`);
      if (typeof result !== 'object') {
        throw new Error('Invalid result from signTransactionMLDSA87');
      }
      return result;
    },

    decodeRLPTransaction: (txHex: string) => {
      if (typeof globalThis.decodeRLPTransaction !== 'function') {
        throw new Error('decodeRLPTransaction not found on globalThis');
      }
      const result = globalThis.decodeRLPTransaction(txHex);
      if (result?.error) throw new Error(`Go decodeRLPTransaction failed: ${result.error}`);
      if (typeof result !== 'object') {
        throw new Error('Invalid result from decodeRLPTransaction');
      }
      return result;
    }
  };
} 