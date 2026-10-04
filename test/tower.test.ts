import { describe, expect, it } from 'vitest';
import {
  GOAL_STATE,
  OPTIMAL_TOTAL,
  PEGS,
  RINGS,
  START_STATE,
  applyMove,
  distanceToGoal,
  isComplete,
  isLegal,
  legalMoves,
  moveName,
  optimalMove,
  parseMove,
  stacks,
} from '../src/shared/tower';

function* allStates(): Generator<string> {
  const total = 3 ** RINGS;
  for (let k = 0; k < total; k++) {
    let s = '';
    let x = k;
    for (let i = 0; i < RINGS; i++) {
      s += PEGS[x % 3];
      x = Math.floor(x / 3);
    }
    yield s;
  }
}

// Small deterministic PRNG so random walks are reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('tower basics', () => {
  it('starts with every ring on A and 4,095 moves to go', () => {
    expect(START_STATE).toBe('AAAAAAAAAAAA');
    expect(OPTIMAL_TOTAL).toBe(4095);
    expect(distanceToGoal(START_STATE)).toBe(4095);
    expect(distanceToGoal(GOAL_STATE)).toBe(0);
    expect(isComplete(GOAL_STATE)).toBe(true);
  });

  it('does not count all rings on B as done', () => {
    expect(isComplete('BBBBBBBBBBBB')).toBe(false);
    expect(distanceToGoal('BBBBBBBBBBBB')).toBe(4095);
  });

  it('offers two moves at the start, both for the smallest ring', () => {
    expect(legalMoves(START_STATE).map(moveName)).toEqual(['A→B', 'A→C']);
  });

  it('moves the smallest ring and rejects illegal moves', () => {
    expect(applyMove(START_STATE, { from: 'A', to: 'C' })).toBe('CAAAAAAAAAAA');
    expect(() => applyMove(START_STATE, { from: 'B', to: 'C' })).toThrow();
    // The second ring cannot land on the smallest.
    expect(isLegal('CAAAAAAAAAAA', { from: 'A', to: 'C' })).toBe(false);
    expect(applyMove('CAAAAAAAAAAA', { from: 'A', to: 'B' })).toBe('CBAAAAAAAAAA');
  });

  it('parses move names', () => {
    expect(parseMove('A→C')).toEqual({ from: 'A', to: 'C' });
    expect(parseMove('b->a')).toEqual({ from: 'B', to: 'A' });
    expect(parseMove('CA')).toEqual({ from: 'C', to: 'A' });
    expect(parseMove('A→A')).toBeNull();
    expect(parseMove('A→D')).toBeNull();
  });

  it('draws stacks largest first', () => {
    expect(stacks('CBAAAAAAAAAA')).toEqual({ A: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2], B: [1], C: [0] });
  });

  it('rejects malformed states', () => {
    expect(() => legalMoves('AAA')).toThrow();
    expect(() => distanceToGoal('AAAAAAAAAAAD')).toThrow();
  });
});

describe('tower properties', () => {
  it('solves optimally from the start in exactly 4,095 moves', () => {
    let state = START_STATE;
    let moves = 0;
    while (!isComplete(state)) {
      const before = distanceToGoal(state);
      state = applyMove(state, optimalMove(state)!);
      expect(distanceToGoal(state)).toBe(before - 1);
      moves++;
    }
    expect(moves).toBe(4095);
    expect(optimalMove(state)).toBeNull();
  });

  it('has 2 or 3 legal moves in every one of the 531,441 positions, and 2 exactly when two pegs are empty', () => {
    let count = 0;
    for (const s of allStates()) {
      const n = legalMoves(s).length;
      const emptyPegs = PEGS.filter((p) => !s.includes(p)).length;
      expect(n).toBe(emptyPegs === 2 ? 2 : 3);
      count++;
    }
    expect(count).toBe(531441);
  });

  it('has an optimal move that is legal and lowers the distance by one, everywhere', () => {
    for (const s of allStates()) {
      if (isComplete(s)) continue;
      const m = optimalMove(s)!;
      expect(isLegal(s, m)).toBe(true);
      expect(distanceToGoal(applyMove(s, m))).toBe(distanceToGoal(s) - 1);
    }
  });

  it('changes distance by at most one on any legal move (random walks)', () => {
    const rand = mulberry32(1010);
    let state = START_STATE;
    for (let i = 0; i < 20000; i++) {
      const moves = legalMoves(state);
      expect(moves.length === 2 || moves.length === 3).toBe(true);
      const next = applyMove(state, moves[Math.floor(rand() * moves.length)]!);
      expect(Math.abs(distanceToGoal(next) - distanceToGoal(state))).toBeLessThanOrEqual(1);
      state = next;
    }
  });

  it('never needs more than 2^12 − 1 moves from anywhere', () => {
    let max = 0;
    for (const s of allStates()) max = Math.max(max, distanceToGoal(s));
    expect(max).toBe(4095);
  });
});
