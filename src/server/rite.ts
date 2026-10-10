// The two jobs, openRite() and closeRite(), and the lazy tick that runs them.
//
// They run lazily: the first request after a window boundary triggers the
// pending job (the server also ticks every few seconds), and each is a CLI
// command too (`pnpm rite open`, `pnpm rite close`). Every step is idempotent
// and guarded so it happens exactly once, even with the CLI and the server
// running at the same time. Beacon rounds come from the boundary timestamps,
// so a job that runs late gives the same result.

import { asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { firstRoundAtOrAfter, deriveBit, deriveNumber, pickIndex } from '../shared/beacon';
import { FIRST_YEAR, isRitualOpen, windowFor } from '../shared/calendar';
import { sealTableFor } from '../shared/seals';
import { START_STATE, applyMove, isComplete, legalMoves, moveName, parseMove } from '../shared/tower';
import type { Beacon, BeaconReading } from './beacon';
import type { DB } from './db/client';
import { guestbook, rite_meta, tower_moves, voters_guestbook, votes, years } from './db/schema';
import { newSecret } from './identity';

/** How long drand may stay unreachable before the NIST fallback. */
export const FALLBACK_AFTER_MS = 60 * 60 * 1000;

export interface RiteContext {
  db: DB;
  beacon: Beacon;
  now: () => Date;
  log: (msg: string) => void;
  /** development only: pretend the tower is in this state when reading */
  fakeState?: string | null;
  /** called once per closed year; throws to be retried later */
  exportLedger?: ((year: number) => Promise<void>) | null;
}

export type YearRow = typeof years.$inferSelect;
export type DecidedBy = 'votes' | 'tiebreak' | 'no_votes';

// ------------------------------------------------------------------ meta

export function getMeta(db: DB, key: string): string | null {
  return db.select().from(rite_meta).where(eq(rite_meta.key, key)).get()?.value ?? null;
}

function setMeta(db: DB, key: string, value: string): void {
  db.insert(rite_meta).values({ key, value }).onConflictDoUpdate({ target: rite_meta.key, set: { value } }).run();
}

function setMetaIfAbsent(db: DB, key: string, value: string): string {
  db.insert(rite_meta).values({ key, value }).onConflictDoNothing().run();
  return getMeta(db, key)!;
}

function deleteMeta(db: DB, key: string): void {
  db.delete(rite_meta).where(eq(rite_meta.key, key)).run();
}

const secretKey = (year: number) => `secret:${year}`;

/** The yearly HMAC secret; only exists while that year's Day is open. */
export function yearSecret(db: DB, year: number): string | null {
  return getMeta(db, secretKey(year));
}

// ------------------------------------------------------------------ reads

export function getYear(db: DB, year: number): YearRow | undefined {
  return db.select().from(years).where(eq(years.year, year)).get();
}

export function latestYear(db: DB): YearRow | undefined {
  return db.select().from(years).orderBy(desc(years.year)).limit(1).get();
}

/** The real tower state: state_after of the latest move. */
export function realTowerState(db: DB): string {
  return db.select().from(tower_moves).orderBy(desc(tower_moves.year)).limit(1).get()?.state_after ?? START_STATE;
}

export function towerState(ctx: RiteContext): string {
  return ctx.fakeState ?? realTowerState(ctx.db);
}

export function isProgrammingOver(ctx: RiteContext): boolean {
  return isComplete(towerState(ctx));
}

export function movesMade(db: DB): number {
  return db.select({ n: sql<number>`count(*)` }).from(tower_moves).get()!.n;
}

/** The rounds committed in advance for a year's window. */
export function commitments(year: number) {
  const w = windowFor(year);
  return {
    year,
    opensAt: new Date(w.opensAt).toISOString(),
    closesAt: new Date(w.closesAt).toISOString(),
    numberRound: firstRoundAtOrAfter(w.opensAt),
    tiebreakRound: firstRoundAtOrAfter(w.closesAt),
  };
}

// ------------------------------------------------------------------ opening

/**
 * Inserts the row for the next window if it has opened, and the yearly
 * secret if it is still open. Synchronous and idempotent. A year only opens
 * once the previous one is closed, and nothing opens once the tower is done.
 * Returns the year it opened, if any.
 */
export function ensureOpened(ctx: RiteContext, now: Date = ctx.now()): number | null {
  const last = latestYear(ctx.db);
  if (last && !last.closed_at) {
    // Open (or awaiting its close): make sure it has its secret while open.
    const w = windowFor(last.year);
    if (now.getTime() >= w.opensAt && now.getTime() < w.closesAt) {
      setMetaIfAbsent(ctx.db, secretKey(last.year), newSecret());
    }
    return null;
  }
  if (isProgrammingOver(ctx)) return null;
  const year = last ? last.year + 1 : FIRST_YEAR;
  const w = windowFor(year);
  if (now.getTime() < w.opensAt) return null;

  const c = commitments(year);
  const inserted = ctx.db
    .insert(years)
    .values({
      year,
      opened_at: c.opensAt,
      number_round: c.numberRound,
      tiebreak_round: c.tiebreakRound,
      seal_table: JSON.stringify(sealTableFor(year)),
    })
    .onConflictDoNothing()
    .run();
  if (isRitualOpen(now)) setMetaIfAbsent(ctx.db, secretKey(year), newSecret());
  if (inserted.changes) ctx.log(`opened the Rite of ${year}`);
  return inserted.changes ? year : null;
}

// ------------------------------------------------------------------ beacon

/** Wall-clock throttle for beacon attempts, per purpose and year. */
const nextAttempt = new Map<string, { at: number; delay: number }>();

/**
 * drand first; if it has been failing for an hour (by the Rite's clock), the
 * NIST pulse at the same timestamp. Returns null when it should be retried.
 */
async function readBeacon(
  ctx: RiteContext,
  key: string,
  round: number,
  targetMs: number,
): Promise<BeaconReading | null> {
  const throttle = nextAttempt.get(key);
  if (throttle && throttle.at > Date.now()) return null;
  const now = ctx.now().getTime();
  try {
    const r = await ctx.beacon.drand(round);
    nextAttempt.delete(key);
    return r;
  } catch (e) {
    const firstFailure = Number(setMetaIfAbsent(ctx.db, `beacon-first-failure:${key}`, String(now)));
    ctx.log(`beacon ${key}: ${(e as Error).message}`);
    if (now - firstFailure >= FALLBACK_AFTER_MS) {
      try {
        const r = await ctx.beacon.nist(targetMs);
        ctx.log(`beacon ${key}: drand unreachable for an hour, using NIST pulse ${r.round}`);
        nextAttempt.delete(key);
        return r;
      } catch (e2) {
        ctx.log(`beacon ${key}: NIST fallback failed too: ${(e2 as Error).message}`);
      }
    }
    const delay = Math.min((throttle?.delay ?? 1500) * 2, 60_000);
    nextAttempt.set(key, { at: Date.now() + delay, delay });
    return null;
  }
}

/** For tests: forget beacon throttling. */
export function resetBeaconThrottle(): void {
  nextAttempt.clear();
}

/** Reveals the Number and the Bit of `year`. True once revealed. */
export async function reveal(ctx: RiteContext, year: number): Promise<boolean> {
  const row = getYear(ctx.db, year);
  if (!row) return false;
  if (row.number_u64 !== null) return true;
  const w = windowFor(year);
  const r = await readBeacon(ctx, `number:${year}`, row.number_round, w.opensAt);
  if (!r) return false;
  const n = deriveNumber(r.randomness);
  ctx.db
    .update(years)
    .set({
      number_u64: n.toString(),
      bit: deriveBit(r.randomness),
      number_randomness: r.randomness,
      beacon_source: r.source,
      number_proof: JSON.stringify({ ...r.proof, url: r.url, time: r.time, source_round: r.round }),
    })
    .where(sql`${years.year} = ${year} and ${years.number_u64} is null`)
    .run();
  ctx.log(`the Number of ${year} is ${n} and the Bit is ${deriveBit(r.randomness)} (${r.source} ${r.round})`);
  return true;
}

/** Opens any window that has opened and reveals its Number. The `open` job. */
export async function openRite(ctx: RiteContext): Promise<void> {
  ensureOpened(ctx);
  const unrevealed = ctx.db.select().from(years).where(isNull(years.number_u64)).orderBy(asc(years.year)).all();
  for (const row of unrevealed) await reveal(ctx, row.year);
}

// ------------------------------------------------------------------ closing

export interface Decision {
  move: string;
  decidedBy: DecidedBy;
  tally: Record<string, number>;
}

/**
 * The close-time rules. Most votes wins. A tie goes to the tie-break number
 * modulo the number of tied moves, ties ordered alphabetically by name. No
 * votes at all: the same number picks among all legal moves.
 */
export function decide(state: string, counts: Record<string, number>, tiebreakRandomness: string): Decision {
  const legal = legalMoves(state).map(moveName).sort();
  const tally = Object.fromEntries(legal.map((m) => [m, counts[m] ?? 0]));
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { move: legal[pickIndex(tiebreakRandomness, legal.length)]!, decidedBy: 'no_votes', tally };
  }
  const max = Math.max(...Object.values(tally));
  const tied = legal.filter((m) => tally[m] === max);
  if (tied.length === 1) return { move: tied[0]!, decidedBy: 'votes', tally };
  return { move: tied[pickIndex(tiebreakRandomness, tied.length)]!, decidedBy: 'tiebreak', tally };
}

export type CloseResult = 'closed' | 'already-closed' | 'not-yet' | 'beacon-pending' | 'no-such-year';

/** Closes `year` (default: the open or pending one) if its window has closed. The `close` job. */
export async function closeRite(ctx: RiteContext, year?: number): Promise<CloseResult> {
  const row = year === undefined ? latestYear(ctx.db) : getYear(ctx.db, year);
  if (!row) return 'no-such-year';
  if (row.closed_at) return 'already-closed';
  const w = windowFor(row.year);
  if (ctx.now().getTime() < w.closesAt) return 'not-yet';

  const r = await readBeacon(ctx, `tiebreak:${row.year}`, row.tiebreak_round, w.closesAt);
  if (!r) return 'beacon-pending';

  const db = ctx.db;
  const result = db.$client
    .transaction((): CloseResult => {
      const fresh = getYear(db, row.year)!;
      if (fresh.closed_at) return 'already-closed';
      const before = realTowerState(db);
      const counts: Record<string, number> = {};
      for (const v of db
        .select({ move: votes.move, n: sql<number>`count(*)` })
        .from(votes)
        .where(eq(votes.year, row.year))
        .groupBy(votes.move)
        .all()) {
        counts[v.move] = v.n;
      }
      const d = decide(before, counts, r.randomness);
      const after = applyMove(before, parseMove(d.move)!);
      db.insert(tower_moves)
        .values({
          year: row.year,
          state_before: before,
          move: d.move,
          state_after: after,
          tally_json: JSON.stringify(d.tally),
          decided_by: d.decidedBy,
        })
        .run();
      db.update(years)
        .set({
          closed_at: new Date(w.closesAt).toISOString(),
          tiebreak_randomness: r.randomness,
          tiebreak_source: r.source,
          tiebreak_proof: JSON.stringify({ ...r.proof, url: r.url, time: r.time, source_round: r.round }),
        })
        .where(eq(years.year, row.year))
        .run();
      // The tally is recorded; the hashes and the secret go.
      db.delete(votes).where(eq(votes.year, row.year)).run();
      db.delete(voters_guestbook).where(eq(voters_guestbook.year, row.year)).run();
      deleteMeta(db, secretKey(row.year));
      ctx.log(`closed the Rite of ${row.year}: ${d.move} by ${d.decidedBy}, ${before} → ${after}`);
      return 'closed';
    })
    .immediate();
  return result;
}

// ------------------------------------------------------------------ tick

let running: Promise<void> | null = null;
let lastExportAttempt = 0;

/** Runs whatever is pending. Single-flight: concurrent callers share one run. */
export function tick(ctx: RiteContext): Promise<void> {
  running ??= (async () => {
    try {
      for (let guard = 0; guard < 10_000; guard++) {
        await openRite(ctx);
        const r = await closeRite(ctx);
        if (r !== 'closed') break; // otherwise a later year may be waiting to open
      }
      await exportPending(ctx);
    } catch (e) {
      ctx.log(`tick failed: ${(e as Error).stack ?? e}`);
    } finally {
      running = null;
    }
  })();
  return running;
}

const exportedKey = (year: number) => `ledger-exported:${year}`;

async function exportPending(ctx: RiteContext): Promise<void> {
  if (!ctx.exportLedger || Date.now() - lastExportAttempt < 5 * 60_000) return;
  const closed = ctx.db.select({ year: years.year }).from(years).where(sql`${years.closed_at} is not null`).all();
  const pending = closed.filter((r) => !getMeta(ctx.db, exportedKey(r.year)));
  if (!pending.length) return;
  lastExportAttempt = Date.now();
  for (const { year } of pending) {
    try {
      await ctx.exportLedger(year);
      setMeta(ctx.db, exportedKey(year), new Date().toISOString());
      ctx.log(`exported ledger/${year}.json`);
    } catch (e) {
      ctx.log(`ledger export for ${year} failed, will retry: ${(e as Error).message}`);
      return;
    }
  }
}

export function markExported(ctx: RiteContext, year: number): void {
  setMeta(ctx.db, exportedKey(year), new Date().toISOString());
}

// ------------------------------------------------------------------ writes

export type WriteResult = { ok: true } | { ok: false; status: 400 | 409 | 423; error: string };

export function castVote(ctx: RiteContext, year: number, voter: string, move: string, now: Date): WriteResult {
  const m = parseMove(move);
  if (!m) return { ok: false, status: 400, error: 'eso no es un movimiento' };
  const name = moveName(m);
  const state = realTowerState(ctx.db);
  if (!legalMoves(state).some((l) => moveName(l) === name)) {
    return { ok: false, status: 400, error: `${name} no es un movimiento legal` };
  }
  const res = ctx.db
    .insert(votes)
    .values({ year, voter_hash: voter, move: name, created_at: now.toISOString() })
    .onConflictDoNothing()
    .run();
  if (!res.changes) return { ok: false, status: 409, error: 'ya votaste este año' };
  return { ok: true };
}

export function myVote(ctx: RiteContext, year: number, voter: string): string | null {
  return (
    ctx.db
      .select({ move: votes.move })
      .from(votes)
      .where(sql`${votes.year} = ${year} and ${votes.voter_hash} = ${voter}`)
      .get()?.move ?? null
  );
}

export function hasSigned(ctx: RiteContext, year: number, voter: string): boolean {
  return !!ctx.db
    .select()
    .from(voters_guestbook)
    .where(sql`${voters_guestbook.year} = ${year} and ${voters_guestbook.voter_hash} = ${voter}`)
    .get();
}

export function addEntry(
  ctx: RiteContext,
  year: number,
  voter: string,
  entry: { seal: string; n_hex: string; t: string; iv_b64: string; ciphertext_b64: string },
  now: Date,
): WriteResult & { id?: number } {
  return ctx.db.$client
    .transaction(() => {
      const res = ctx.db.insert(voters_guestbook).values({ year, voter_hash: voter }).onConflictDoNothing().run();
      if (!res.changes) return { ok: false as const, status: 409 as const, error: 'ya firmaste este año' };
      const row = ctx.db
        .insert(guestbook)
        .values({ year, ...entry, created_at: now.toISOString() })
        .returning({ id: guestbook.id })
        .get();
      return { ok: true as const, id: row.id };
    })
    .immediate();
}
