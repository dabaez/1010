// Ritual III: which beacon round decides what, and how values are derived
// from its randomness. Shared by the server and the browser.

/** drand quicknet, run by the League of Entropy. Values from its /info. */
export const DRAND_CHAIN = {
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicKey:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  /** seconds */
  genesis: 1692803367,
  /** seconds */
  period: 3,
  schemeID: 'bls-unchained-g1-rfc9380',
  beaconID: 'quicknet',
} as const;

export const DRAND_RELAYS = [
  'https://api.drand.sh',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
  'https://drand.cloudflare.com',
] as const;

export function drandRoundUrl(round: number, relay: string = DRAND_RELAYS[0]): string {
  return `${relay}/${DRAND_CHAIN.hash}/public/${round}`;
}

export interface ChainTiming {
  genesis: number;
  period: number;
}

/**
 * The spec's formula: floor((t − genesis) / period) + 1, the round being
 * emitted at time t (seconds).
 */
export function roundAt(tSeconds: number, chain: ChainTiming = DRAND_CHAIN): number {
  return Math.floor((tSeconds - chain.genesis) / chain.period) + 1;
}

/** Round r is emitted at genesis + (r − 1) · period. */
export function roundTime(round: number, chain: ChainTiming = DRAND_CHAIN): number {
  return chain.genesis + (round - 1) * chain.period;
}

/**
 * The first round at or after t (ms). For window boundaries (whole minutes)
 * on quicknet this equals roundAt(): the boundaries fall exactly on rounds.
 */
export function firstRoundAtOrAfter(tMs: number, chain: ChainTiming = DRAND_CHAIN): number {
  const r = roundAt(Math.ceil(tMs / 1000), chain);
  return roundTime(r, chain) * 1000 >= tMs ? r : r + 1;
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2) throw new Error('randomness is not hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Number of the year: the first 8 bytes of the randomness, as an unsigned 64-bit big-endian integer. */
export function deriveNumber(randomnessHex: string): bigint {
  const b = hexBytes(randomnessHex);
  if (b.length < 8) throw new Error('randomness too short');
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(b[i]!);
  return n;
}

/** Bit of the year: the lowest bit of the last byte. */
export function deriveBit(randomnessHex: string): 0 | 1 {
  const b = hexBytes(randomnessHex);
  return (b[b.length - 1]! & 1) as 0 | 1;
}

/** Tower tie-break: the number derived from the close round, modulo the number of choices. */
export function pickIndex(randomnessHex: string, choices: number): number {
  if (choices < 1) throw new Error('nothing to pick from');
  return Number(deriveNumber(randomnessHex) % BigInt(choices));
}

export function u64Hex(n: bigint): string {
  return '0x' + n.toString(16).padStart(16, '0');
}
