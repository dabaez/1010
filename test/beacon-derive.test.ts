import { describe, expect, it } from 'vitest';
import {
  DRAND_CHAIN,
  deriveBit,
  deriveNumber,
  firstRoundAtOrAfter,
  pickIndex,
  roundAt,
  roundTime,
  u64Hex,
} from '../src/shared/beacon';
import { windowFor } from '../src/shared/calendar';

describe('round math', () => {
  it('uses floor((t − genesis) / period) + 1', () => {
    expect(roundAt(DRAND_CHAIN.genesis)).toBe(1);
    expect(roundAt(DRAND_CHAIN.genesis + 2)).toBe(1);
    expect(roundAt(DRAND_CHAIN.genesis + 3)).toBe(2);
    expect(roundTime(2)).toBe(DRAND_CHAIN.genesis + 3);
  });

  it('lands window boundaries exactly on a round, so "at or after" equals the formula', () => {
    for (const year of [2026, 2027, 2100, 6121]) {
      const w = windowFor(year);
      for (const t of [w.opensAt, w.closesAt]) {
        const r = firstRoundAtOrAfter(t);
        expect(r).toBe(roundAt(t / 1000));
        expect(roundTime(r) * 1000).toBe(t);
      }
    }
  });

  it('commits to these rounds for 2026', () => {
    const w = windowFor(2026);
    // (1791540000 − 1692803367) / 3 + 1
    expect(firstRoundAtOrAfter(w.opensAt)).toBe(32912212);
    expect(firstRoundAtOrAfter(w.closesAt)).toBe(32972212);
  });

  it('rounds up between rounds', () => {
    const t = (DRAND_CHAIN.genesis + 4) * 1000;
    expect(firstRoundAtOrAfter(t)).toBe(3);
  });
});

describe('derivations', () => {
  const r = 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd';

  it('takes the first 8 bytes as an unsigned 64-bit integer', () => {
    expect(deriveNumber(r)).toBe(0xfe290beca10872efn);
    expect(u64Hex(deriveNumber(r))).toBe('0xfe290beca10872ef');
    expect(deriveNumber('ff'.repeat(32))).toBe(2n ** 64n - 1n);
  });

  it('takes the lowest bit of the last byte', () => {
    expect(deriveBit(r)).toBe(1); // 0xdd
    expect(deriveBit('00'.repeat(31) + 'fe')).toBe(0);
  });

  it('picks modulo the number of choices', () => {
    expect(pickIndex(r, 3)).toBe(Number(0xfe290beca10872efn % 3n));
    expect(pickIndex(r, 1)).toBe(0);
    expect(() => pickIndex(r, 0)).toThrow();
  });
});
