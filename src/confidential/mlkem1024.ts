// ML-KEM-1024 (FIPS 203), written against the standard's algorithms so it can be pinned byte for byte
// to the Go node's crypto/mlkem by the PRIV-02 golden vectors (tests/vectors/priv02_vectors.json).
//
// Why a separate implementation: the SDK's bundled ML-KEM (src/noble-post-quantum.js, the WASM module)
// is a modified, non-FIPS "encrypt a message" construction that returns no shared secret and cannot be
// derandomized, so it cannot produce a slot another client can open. This file is only the KEM; the
// PRIV-02 construction around it is in ./index.ts.
//
// Keys are handled as FIPS 203 seeds (d ‖ z, 64 bytes), the same form Go's crypto/mlkem stores.
import { sha3_256, sha3_512, shake128, shake256 } from '@noble/hashes/sha3';
import { randomBytes } from '@noble/hashes/utils';

const N = 256;
const Q = 3329;
const K = 4;
const ETA1 = 2;
const ETA2 = 2;
const DU = 11;
const DV = 5;

export const EK_LEN = 384 * K + 32; // 1568
export const DK_LEN = 768 * K + 96; // 3168
export const CT_LEN = 32 * (DU * K + DV); // 1568
export const SEED_LEN = 64;

type Poly = Int32Array;

const mod = (a: number): number => {
  const r = a % Q;
  return r < 0 ? r + Q : r;
};

function bitrev7(i: number): number {
  let r = 0;
  for (let b = 0; b < 7; b++) r |= ((i >> b) & 1) << (6 - b);
  return r;
}

function powq(b: number, e: number): number {
  let r = 1;
  let x = b % Q;
  while (e > 0) {
    if (e & 1) r = (r * x) % Q;
    x = (x * x) % Q;
    e >>= 1;
  }
  return r;
}

const ZETAS = Array.from({ length: 128 }, (_, i) => powq(17, bitrev7(i)));
const GAMMAS = Array.from({ length: 128 }, (_, i) => powq(17, 2 * bitrev7(i) + 1));

function ntt(f: Poly): Poly {
  const a = Int32Array.from(f);
  let i = 1;
  for (let len = 128; len >= 2; len >>= 1) {
    for (let start = 0; start < N; start += 2 * len) {
      const zeta = ZETAS[i++];
      for (let j = start; j < start + len; j++) {
        const t = (zeta * a[j + len]) % Q;
        a[j + len] = mod(a[j] - t);
        a[j] = (a[j] + t) % Q;
      }
    }
  }
  return a;
}

function invNtt(f: Poly): Poly {
  const a = Int32Array.from(f);
  let i = 127;
  for (let len = 2; len <= 128; len <<= 1) {
    for (let start = 0; start < N; start += 2 * len) {
      const zeta = ZETAS[i--];
      for (let j = start; j < start + len; j++) {
        const t = a[j];
        a[j] = (t + a[j + len]) % Q;
        a[j + len] = (zeta * mod(a[j + len] - t)) % Q;
      }
    }
  }
  for (let j = 0; j < N; j++) a[j] = (a[j] * 3303) % Q;
  return a;
}

function mulNtt(f: Poly, g: Poly): Poly {
  const h = new Int32Array(N);
  for (let i = 0; i < 128; i++) {
    const a0 = f[2 * i], a1 = f[2 * i + 1], b0 = g[2 * i], b1 = g[2 * i + 1];
    h[2 * i] = (a0 * b0 + ((a1 * b1) % Q) * GAMMAS[i]) % Q;
    h[2 * i + 1] = (a0 * b1 + a1 * b0) % Q;
  }
  return h;
}

function add(f: Poly, g: Poly): Poly {
  const h = new Int32Array(N);
  for (let i = 0; i < N; i++) h[i] = (f[i] + g[i]) % Q;
  return h;
}

function sub(f: Poly, g: Poly): Poly {
  const h = new Int32Array(N);
  for (let i = 0; i < N; i++) h[i] = mod(f[i] - g[i]);
  return h;
}

function byteEncode(f: Poly, d: number): Uint8Array {
  const out = new Uint8Array(32 * d);
  let bit = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < d; j++, bit++) {
      if ((f[i] >> j) & 1) out[bit >> 3] |= 1 << (bit & 7);
    }
  }
  return out;
}

function byteDecode(b: Uint8Array, d: number): Poly {
  const f = new Int32Array(N);
  let bit = 0;
  for (let i = 0; i < N; i++) {
    let v = 0;
    for (let j = 0; j < d; j++, bit++) v |= ((b[bit >> 3] >> (bit & 7)) & 1) << j;
    f[i] = d === 12 ? v % Q : v;
  }
  return f;
}

function compress(f: Poly, d: number): Poly {
  const g = new Int32Array(N);
  for (let i = 0; i < N; i++) g[i] = Math.floor((f[i] * 2 ** d + (Q - 1) / 2) / Q) % 2 ** d;
  return g;
}

function decompress(f: Poly, d: number): Poly {
  const g = new Int32Array(N);
  for (let i = 0; i < N; i++) g[i] = Math.floor((f[i] * Q + 2 ** (d - 1)) / 2 ** d);
  return g;
}

function cbd(b: Uint8Array, eta: number): Poly {
  const f = new Int32Array(N);
  const bit = (k: number) => (b[k >> 3] >> (k & 7)) & 1;
  for (let i = 0; i < N; i++) {
    let x = 0, y = 0;
    for (let j = 0; j < eta; j++) {
      x += bit(2 * i * eta + j);
      y += bit(2 * i * eta + eta + j);
    }
    f[i] = mod(x - y);
  }
  return f;
}

function sampleNtt(rho: Uint8Array, j: number, i: number): Poly {
  const x = shake128.create({});
  x.update(concat(rho, Uint8Array.of(j, i)));
  const a = new Int32Array(N);
  let n = 0;
  while (n < N) {
    const c = x.xof(168);
    for (let k = 0; k + 2 < c.length && n < N; k += 3) {
      const d1 = c[k] + 256 * (c[k + 1] & 15);
      const d2 = (c[k + 1] >> 4) + 16 * c[k + 2];
      if (d1 < Q) a[n++] = d1;
      if (d2 < Q && n < N) a[n++] = d2;
    }
  }
  return a;
}

const prf = (eta: number, s: Uint8Array, b: number) => shake256(concat(s, Uint8Array.of(b)), { dkLen: 64 * eta });

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function matrix(rho: Uint8Array, transpose: boolean): Poly[][] {
  const A: Poly[][] = [];
  for (let i = 0; i < K; i++) {
    A.push([]);
    for (let j = 0; j < K; j++) A[i].push(transpose ? sampleNtt(rho, i, j) : sampleNtt(rho, j, i));
  }
  return A;
}

function pkeKeyGen(d: Uint8Array): { ek: Uint8Array; dkPke: Uint8Array } {
  const g = sha3_512(concat(d, Uint8Array.of(K)));
  const rho = g.subarray(0, 32), sigma = g.subarray(32, 64);
  const A = matrix(rho, false);
  let nonce = 0;
  const s: Poly[] = [], e: Poly[] = [];
  for (let i = 0; i < K; i++) s.push(ntt(cbd(prf(ETA1, sigma, nonce++), ETA1)));
  for (let i = 0; i < K; i++) e.push(ntt(cbd(prf(ETA1, sigma, nonce++), ETA1)));
  const t: Poly[] = [];
  for (let i = 0; i < K; i++) {
    let acc: Poly = e[i];
    for (let j = 0; j < K; j++) acc = add(acc, mulNtt(A[i][j], s[j]));
    t.push(acc);
  }
  return { ek: concat(...t.map((p) => byteEncode(p, 12)), rho), dkPke: concat(...s.map((p) => byteEncode(p, 12))) };
}

function pkeEncrypt(ek: Uint8Array, m: Uint8Array, r: Uint8Array): Uint8Array {
  const t: Poly[] = [];
  for (let i = 0; i < K; i++) t.push(byteDecode(ek.subarray(384 * i, 384 * (i + 1)), 12));
  const rho = ek.subarray(384 * K);
  const AT = matrix(rho, true); // AT[i][j] = Â[j][i]
  let nonce = 0;
  const y: Poly[] = [], e1: Poly[] = [];
  for (let i = 0; i < K; i++) y.push(ntt(cbd(prf(ETA1, r, nonce++), ETA1)));
  for (let i = 0; i < K; i++) e1.push(cbd(prf(ETA2, r, nonce++), ETA2));
  const e2 = cbd(prf(ETA2, r, nonce++), ETA2);
  const u: Poly[] = [];
  for (let i = 0; i < K; i++) {
    let acc: Poly = new Int32Array(N);
    for (let j = 0; j < K; j++) acc = add(acc, mulNtt(AT[i][j], y[j]));
    u.push(add(invNtt(acc), e1[i]));
  }
  let tv: Poly = new Int32Array(N);
  for (let i = 0; i < K; i++) tv = add(tv, mulNtt(t[i], y[i]));
  const mu = decompress(byteDecode(m, 1), 1);
  const v = add(add(invNtt(tv), e2), mu);
  return concat(...u.map((p) => byteEncode(compress(p, DU), DU)), byteEncode(compress(v, DV), DV));
}

function pkeDecrypt(dkPke: Uint8Array, c: Uint8Array): Uint8Array {
  const u: Poly[] = [];
  for (let i = 0; i < K; i++) u.push(decompress(byteDecode(c.subarray(32 * DU * i, 32 * DU * (i + 1)), DU), DU));
  const v = decompress(byteDecode(c.subarray(32 * DU * K), DV), DV);
  let acc: Poly = new Int32Array(N);
  for (let i = 0; i < K; i++) acc = add(acc, mulNtt(byteDecode(dkPke.subarray(384 * i, 384 * (i + 1)), 12), ntt(u[i])));
  return byteEncode(compress(sub(v, invNtt(acc)), 1), 1);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** Expands a 64-byte seed d ‖ z into (ek, dk) -- ML-KEM.KeyGen_internal. */
export function keyFromSeed(seed: Uint8Array): { ek: Uint8Array; dk: Uint8Array } {
  if (seed.length !== SEED_LEN) throw new Error('ML-KEM-1024: seed must be 64 bytes');
  const { ek, dkPke } = pkeKeyGen(seed.subarray(0, 32));
  return { ek, dk: concat(dkPke, ek, sha3_256(ek), seed.subarray(32, 64)) };
}

/** FIPS 203 §7.2 encapsulation-key check (length + modulus). */
export function checkEncapsulationKey(ek: Uint8Array): void {
  if (ek.length !== EK_LEN) throw new Error('ML-KEM-1024: bad encapsulation key length');
  for (let i = 0; i < K; i++) {
    const chunk = ek.subarray(384 * i, 384 * (i + 1));
    if (!equal(byteEncode(byteDecode(chunk, 12), 12), chunk)) throw new Error('ML-KEM-1024: encapsulation key not reduced mod q');
  }
}

/** ML-KEM.Encaps; m (32 bytes) is the derandomization input used only by the golden vectors. */
export function encapsulate(ek: Uint8Array, m: Uint8Array = randomBytes(32)): { sharedKey: Uint8Array; ciphertext: Uint8Array } {
  checkEncapsulationKey(ek);
  if (m.length !== 32) throw new Error('ML-KEM-1024: m must be 32 bytes');
  const g = sha3_512(concat(m, sha3_256(ek)));
  return { sharedKey: g.slice(0, 32), ciphertext: pkeEncrypt(ek, m, g.subarray(32, 64)) };
}

/** ML-KEM.Decaps with implicit rejection: a bad ciphertext yields a pseudorandom key, never an error. */
export function decapsulate(dk: Uint8Array, c: Uint8Array): Uint8Array {
  if (dk.length !== DK_LEN || c.length !== CT_LEN) throw new Error('ML-KEM-1024: bad key or ciphertext length');
  const dkPke = dk.subarray(0, 384 * K);
  const ek = dk.subarray(384 * K, 768 * K + 32);
  const h = dk.subarray(768 * K + 32, 768 * K + 64);
  const z = dk.subarray(768 * K + 64);
  const m2 = pkeDecrypt(dkPke, c);
  const g = sha3_512(concat(m2, h));
  const kBar = shake256(concat(z, c), { dkLen: 32 });
  return equal(c, pkeEncrypt(ek, m2, g.subarray(32, 64))) ? g.slice(0, 32) : kBar;
}
