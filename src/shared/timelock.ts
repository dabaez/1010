// Ritual II: RSW time-lock puzzles (Rivest, Shamir, Wagner, 1996).
//
// Sealing runs in the browser (WebCrypto + BigInt), so the server never sees
// plaintext. It also runs under Node, which has the same WebCrypto, for tests.
//
//   N = p·q (from a fresh RSA-2048 key), φ = (p−1)(q−1)
//   e = 2^T mod φ, b = 2^e mod N       (the sealer's shortcut)
//   K = SHA-256(b as big-endian bytes, left-padded to the byte length of N)
//   ciphertext = AES-256-GCM(K, iv, message), 12-byte random iv, no AAD
//
// Opening: b = 2^(2^T) mod N by squaring 2, T times in a row. Then the same
// K and decrypt. Nothing but the T squarings is secret.

export const MAX_MESSAGE_CHARS = 1000;
/** The optional public name next to an entry; it is not sealed. */
export const MAX_NAME_CHARS = 40;
/** 1,000 characters of at most 4 UTF-8 bytes each, plus the 16-byte GCM tag. */
export const MAX_CIPHERTEXT_BYTES = MAX_MESSAGE_CHARS * 4 + 16;
export const MODULUS_BITS = 2048;

export interface SealedPuzzle {
  /** N, lowercase hex, no prefix */
  n_hex: string;
  /** number of squarings, decimal string (it can exceed 2^53) */
  t: string;
  iv_b64: string;
  ciphertext_b64: string;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available here');
  return s;
}

/** Square-and-multiply. */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

export function byteLength(n: bigint): number {
  return Math.ceil(n.toString(16).length / 2);
}

export function bigToBytes(n: bigint, length: number): Uint8Array<ArrayBuffer> {
  let hex = n.toString(16);
  if (hex.length > length * 2) throw new Error('number does not fit');
  hex = hex.padStart(length * 2, '0');
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function bigFromBase64Url(s: string): bigint {
  const bytes = base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/'));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt('0x' + hex);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Characters as people count them: Unicode code points. */
export function messageLength(message: string): number {
  return [...message].length;
}

/** K = SHA-256 of b, big-endian, left-padded to the byte length of N. */
export async function keyFromB(b: bigint, n: bigint): Promise<CryptoKey> {
  const digest = await subtle().digest('SHA-256', bigToBytes(b, byteLength(n)));
  return subtle().importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export type SealStep = 'keygen' | 'shortcut' | 'encrypt';

/** Seals `message` so that opening it takes `t` sequential squarings. */
export async function seal(
  message: string,
  t: bigint,
  onStep: (step: SealStep) => void = () => {},
): Promise<SealedPuzzle> {
  const len = messageLength(message);
  if (len === 0) throw new Error('the message is empty');
  if (len > MAX_MESSAGE_CHARS) throw new Error(`the message is over ${MAX_MESSAGE_CHARS} characters`);
  if (t < 1n) throw new Error('T must be positive');

  // 1. A fresh RSA-2048 key; only its primes are used.
  onStep('keygen');
  const pair = await subtle().generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: MODULUS_BITS, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  let jwk: JsonWebKey | null = await subtle().exportKey('jwk', pair.privateKey);
  let p: bigint | null = bigFromBase64Url(jwk.p!);
  let q: bigint | null = bigFromBase64Url(jwk.q!);
  jwk = null;

  // 2–4. N, φ, and the shortcut only the sealer can take.
  onStep('shortcut');
  const n = p * q;
  let phi: bigint | null = (p - 1n) * (q - 1n);
  p = q = null;
  const e = modPow(2n, t, phi);
  phi = null;
  const b = modPow(2n, e, n);

  // 5. Encrypt under K = SHA-256(b).
  onStep('encrypt');
  const key = await keyFromB(b, n);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(message)),
  );

  // 6. Only public values leave this function.
  return {
    n_hex: n.toString(16),
    t: t.toString(),
    iv_b64: bytesToBase64(iv),
    ciphertext_b64: bytesToBase64(ciphertext),
  };
}

/** b = 2^(2^T) mod N, the slow way. `onProgress` is called every `every` squarings. */
export function squareChain(
  n: bigint,
  t: bigint,
  onProgress?: (done: bigint) => void,
  every = 100_000n,
): bigint {
  let x = 2n;
  for (let i = 0n; i < t; i++) {
    x = (x * x) % n;
    if (onProgress && (i + 1n) % every === 0n) onProgress(i + 1n);
  }
  return x;
}

export async function decryptWithB(p: SealedPuzzle, b: bigint): Promise<string> {
  const n = BigInt('0x' + p.n_hex);
  const key = await keyFromB(b, n);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(p.iv_b64) },
    key,
    base64ToBytes(p.ciphertext_b64),
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}

/** Opens a puzzle by doing all T squarings. Only sensible for tiny T; use the solver otherwise. */
export async function open(p: SealedPuzzle): Promise<string> {
  const n = BigInt('0x' + p.n_hex);
  return decryptWithB(p, squareChain(n, BigInt(p.t)));
}
