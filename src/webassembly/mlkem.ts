// Unified MLKEM interface for both Node.js and browser environments

export class WasmError extends Error {
  public readonly context?: any;
  constructor(message: string, context?: any) {
    super(`WASM Error: ${message}`);
    this.name = 'WasmError';
    this.context = context;
  }
}

export interface MlKem {
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
}

// Environment detection
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Load and initialize the MLKEM Go WebAssembly module.
 * Automatically detects environment and uses appropriate loader.
 */
export async function loadWasm(): Promise<MlKem> {
  if (isNode) {
    // Use Node.js loader
    const { loadWasm: loadNodeWasm } = await import('./mlkem-node');
    return await loadNodeWasm();
  } else if (isBrowser) {
    // Use browser loader
    const { loadWasm: loadBrowserWasm } = await import('./mlkem-browser');
    return await loadBrowserWasm();
  } else {
    throw new WasmError('Unsupported environment. This package requires Node.js or a browser environment.', { env: { isNode, isBrowser } });
  }
}

/**
 * Load WASM from buffer (useful for bundlers that inline WASM)
 */
export async function loadWasmFromBuffer(wasmBuffer: ArrayBuffer): Promise<MlKem> {
  if (isNode) {
    throw new WasmError('loadWasmFromBuffer is not supported in Node.js environment. Use loadWasm() instead.', { env: 'node' });
  } else if (isBrowser) {
    const { loadWasmFromBuffer: loadBrowserWasmFromBuffer } = await import('./mlkem-browser');
    return await loadBrowserWasmFromBuffer(wasmBuffer);
  } else {
    throw new WasmError('Unsupported environment. This package requires Node.js or a browser environment.', { env: { isNode, isBrowser } });
  }
}

// Re-export types for convenience
export type { MlKemNode } from './mlkem-node';
export type { MlKemBrowser } from './mlkem-browser'; 