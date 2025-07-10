// src/global.d.ts

declare module '../webassembly/mlkem-node' {
  export interface MlKemNode {
    keyGen(): Promise<{ pubKey: string; privKey: string }>;
    encrypt(pubKey: string, message: string): Promise<{ encryptedData: string; version: string }>;
    decrypt(privKey: string, encryptedData: string, version: string): Promise<string>;
    symEncrypt(ssKey: string, message: string): Promise<{ encryptedData: string; version: string }>;
    symDecrypt(ssKey: string, encryptedData: string, version: string): Promise<string>;
    privateKeyToAddress(privateKey: string): string;
  }

  export function loadWasm(): Promise<MlKemNode>;
}