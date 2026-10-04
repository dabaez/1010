// The Tower: 12 rings on pegs A, B, C. Pure functions, no I/O.
//
// A state is a 12-character string, one character per ring from smallest
// (index 0) to largest (index 11), holding the peg the ring sits on. The order
// of rings on a peg is implied: larger rings are always below smaller ones.

export const RINGS = 12;
export const PEGS = ['A', 'B', 'C'] as const;
export type Peg = (typeof PEGS)[number];

export const START_STATE = 'A'.repeat(RINGS);
/** All rings on C. B does not count; the prophecy is specific. */
export const GOAL_STATE = 'C'.repeat(RINGS);
/** 2^12 − 1 */
export const OPTIMAL_TOTAL = 2 ** RINGS - 1;

export interface Move {
  from: Peg;
  to: Peg;
}

const STATE_RE = new RegExp(`^[ABC]{${RINGS}}$`);

export function isValidState(state: string): boolean {
  return STATE_RE.test(state);
}

function assertState(state: string): void {
  if (!isValidState(state)) throw new Error(`invalid tower state: ${JSON.stringify(state)}`);
}

/** `A→C`. Alphabetical order of names is the tie-break order. */
export function moveName(m: Move): string {
  return `${m.from}→${m.to}`;
}

/** Accepts `A→C`, `A->C`, `A-C` and `AC`. */
export function parseMove(name: string): Move | null {
  const m = /^([ABC])\s*(?:→|->|-)?\s*([ABC])$/.exec(name.trim().toUpperCase());
  if (!m || m[1] === m[2]) return null;
  return { from: m[1] as Peg, to: m[2] as Peg };
}

/** Index of the smallest ring on `peg`, or -1 if it is empty. */
export function topRing(state: string, peg: Peg): number {
  return state.indexOf(peg);
}

function thirdPeg(a: Peg, b: Peg): Peg {
  return PEGS.find((p) => p !== a && p !== b)!;
}

/**
 * Legal moves in alphabetical order of their names: 3 in any position,
 * 2 when two pegs are empty.
 */
export function legalMoves(state: string): Move[] {
  assertState(state);
  const moves: Move[] = [];
  for (const from of PEGS) {
    const ring = topRing(state, from);
    if (ring < 0) continue;
    for (const to of PEGS) {
      if (to === from) continue;
      const target = topRing(state, to);
      if (target < 0 || ring < target) moves.push({ from, to });
    }
  }
  return moves;
}

export function isLegal(state: string, m: Move): boolean {
  return legalMoves(state).some((l) => l.from === m.from && l.to === m.to);
}

export function applyMove(state: string, m: Move): string {
  if (!isLegal(state, m)) throw new Error(`illegal move ${moveName(m)} in ${state}`);
  const ring = topRing(state, m.from);
  return state.slice(0, ring) + m.to + state.slice(ring + 1);
}

export function isComplete(state: string): boolean {
  return state === GOAL_STATE;
}

/**
 * Fewest moves from `state` to all rings on C. Walk from the largest ring
 * down: a ring already on its target costs nothing; otherwise it must move
 * once (2^i moves for it and everything above it), and every smaller ring
 * first has to gather on the third peg.
 */
export function distanceToGoal(state: string): number {
  assertState(state);
  let target: Peg = 'C';
  let moves = 0;
  for (let i = RINGS - 1; i >= 0; i--) {
    const peg = state[i] as Peg;
    if (peg !== target) {
      moves += 2 ** i;
      target = thirdPeg(peg, target);
    }
  }
  return moves;
}

/** The move on an optimal path to the goal, or null when complete. Never shown on the ballot. */
export function optimalMove(state: string): Move | null {
  assertState(state);
  let target: Peg = 'C';
  let best: Move | null = null;
  for (let i = RINGS - 1; i >= 0; i--) {
    const peg = state[i] as Peg;
    if (peg !== target) {
      best = { from: peg, to: target };
      target = thirdPeg(peg, target);
    }
  }
  return best;
}

/** Pegs as stacks of ring indices, bottom (largest) first. For drawing. */
export function stacks(state: string): Record<Peg, number[]> {
  const out: Record<Peg, number[]> = { A: [], B: [], C: [] };
  for (let i = RINGS - 1; i >= 0; i--) out[state[i] as Peg].push(i);
  return out;
}
