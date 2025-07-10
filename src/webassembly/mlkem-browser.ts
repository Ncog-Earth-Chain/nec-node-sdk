// Browser-compatible MLKEM WebAssembly loader

// --- Polyfill for Web Crypto API ---
declare global {
  var Go: any;
  var mlkemKeyGen: () => any;
  var mlkemEncrypt: (pubKey: string, message: string) => any;
  var mlkemDecrypt: (privKey: string, encryptedData: string, version: string) => any;
  var symEncrypt: (ssKey: string, message: string) => any;
  var symDecrypt: (ssKey: string, encryptedData: string, version: string) => any;
  var privateKeyToWalletAddress: (pk: string) => any;
  interface Crypto {
    getRandomValues(array: Uint8Array): void;
  }
}

// Ensure crypto is available
if (typeof globalThis.crypto === 'undefined') {
  throw new Error('Web Crypto API is required but not available in this environment');
}

// --- End Polyfill ---

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
}

/**
 * Load and initialize the MLKEM Go WebAssembly module in browser.
 */
export async function loadWasm(): Promise<MlKemBrowser> {
  // Load the Go WebAssembly support code
  // In browser, this should be loaded via script tag or dynamic import
  if (typeof globalThis.Go === 'undefined') {
    throw new Error('Go WebAssembly runtime not loaded. Please include wasm_exec.js before using this module.');
  }

  // Load the WASM file
  const wasmResponse = await fetch('./webassembly/main.wasm');
  const wasmBuffer = await wasmResponse.arrayBuffer();

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
  };
}

/**
 * Alternative loader that accepts WASM buffer directly
 */
export async function loadWasmFromBuffer(wasmBuffer: ArrayBuffer): Promise<MlKemBrowser> {
  if (typeof globalThis.Go === 'undefined') {
    throw new Error('Go WebAssembly runtime not loaded. Please include wasm_exec.js before using this module.');
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
  };
} 