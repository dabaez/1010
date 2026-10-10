// Seal lengths. T = (2048-bit modular squarings per second, measured with GMP
// on a fast desktop CPU by `rite-solver bench`) × the target time. Re-benchmark
// every year before the Day, add that year's row, and the year's T goes into
// its ledger.

export const SEALS = ['short', 'decade', 'century'] as const;
export type Seal = (typeof SEALS)[number];

export const SEAL_YEARS: Record<Seal, number> = { short: 1, decade: 10, century: 100 };

export const SEAL_LABELS: Record<Seal, string> = { short: 'Corto', decade: 'Década', century: 'Siglo' };

export interface SealTable {
  /** what was benchmarked, for the record */
  benchmark: { cpu: string; squaringsPerSecond: number; tool: string; date: string };
  /** decimal strings: T can exceed 2^53 */
  t: Record<Seal, string>;
}

export const SEAL_TABLES: Record<number, SealTable> = {
  2026: {
    benchmark: {
      cpu: 'AMD Ryzen 7 7800X3D',
      squaringsPerSecond: 1104905,
      tool: 'rite-solver bench (rug 1.30 / GMP), 20 s',
      date: '2026-10-03',
    },
    t: {
      short: '34868142602589',
      decade: '348681426025887',
      century: '3486814260258865',
    },
  },
};

/** The table for `year`, or the newest one before it if that year was never re-benchmarked. */
export function sealTableFor(year: number): SealTable {
  const years = Object.keys(SEAL_TABLES)
    .map(Number)
    .filter((y) => y <= year)
    .sort((a, b) => b - a);
  const y = years[0] ?? Math.min(...Object.keys(SEAL_TABLES).map(Number));
  return SEAL_TABLES[y]!;
}

export function isSeal(s: unknown): s is Seal {
  return typeof s === 'string' && (SEALS as readonly string[]).includes(s);
}
