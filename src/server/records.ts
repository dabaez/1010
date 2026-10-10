// Public views of the record: what the archive shows and what goes into
// ledger/YYYY.json. Plain JSON, UTF-8 and hex only.

import { asc, desc, eq, sql } from 'drizzle-orm';
import { DRAND_CHAIN, drandRoundUrl, pickIndex, u64Hex } from '../shared/beacon';
import { windowFor } from '../shared/calendar';
import type { SealTable } from '../shared/seals';
import { distanceToGoal } from '../shared/tower';
import { guestbook, tower_moves, years } from './db/schema';
import type { DB } from './db/client';
import type { YearRow } from './rite';

export const LEDGER_FORMAT = 'annual-rite-ledger/1';

type MoveRow = typeof tower_moves.$inferSelect;
type EntryRow = typeof guestbook.$inferSelect;

function parse<T>(json: string | null): T | null {
  return json ? (JSON.parse(json) as T) : null;
}

export function entryView(e: EntryRow) {
  return {
    id: e.id,
    year: e.year,
    seal: e.seal,
    name: e.name,
    n_hex: e.n_hex,
    t: e.t,
    iv_b64: e.iv_b64,
    ciphertext_b64: e.ciphertext_b64,
    created_at: e.created_at,
  };
}

export function moveView(m: MoveRow, index: number) {
  return {
    year: m.year,
    number: index + 1,
    state_before: m.state_before,
    move: m.move,
    state_after: m.state_after,
    tally: JSON.parse(m.tally_json) as Record<string, number>,
    decided_by: m.decided_by,
    optimal_remaining: distanceToGoal(m.state_after),
  };
}

function beaconView(source: string | null, round: number, randomness: string | null, proof: string | null) {
  return {
    committed_drand_round: round,
    committed_drand_url: drandRoundUrl(round),
    source,
    randomness,
    proof: parse<Record<string, unknown>>(proof),
  };
}

export function yearView(row: YearRow, move: MoveRow | undefined, moveIndex: number, entryCount: number) {
  const w = windowFor(row.year);
  const number = row.number_u64 === null ? null : BigInt(row.number_u64);
  const tally = move ? (JSON.parse(move.tally_json) as Record<string, number>) : null;
  const tied = tally ? Object.keys(tally).filter((k) => tally[k] === Math.max(...Object.values(tally))) : [];
  return {
    year: row.year,
    window: { opens_at: new Date(w.opensAt).toISOString(), closes_at: new Date(w.closesAt).toISOString() },
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    number: number === null ? null : { decimal: number.toString(), hex: u64Hex(number) },
    bit: row.bit,
    beacon: {
      chain: { name: 'drand quicknet', hash: DRAND_CHAIN.hash, genesis: DRAND_CHAIN.genesis, period: DRAND_CHAIN.period },
      number: beaconView(row.beacon_source, row.number_round, row.number_randomness, row.number_proof),
      tiebreak: {
        ...beaconView(row.tiebreak_source, row.tiebreak_round, row.tiebreak_randomness, row.tiebreak_proof),
        // When the tie-break decided something: number mod choices.
        derivation:
          move && row.tiebreak_randomness && move.decided_by !== 'votes'
            ? {
                choices: move.decided_by === 'no_votes' ? Object.keys(tally!).sort() : tied.sort(),
                index: pickIndex(
                  row.tiebreak_randomness,
                  move.decided_by === 'no_votes' ? Object.keys(tally!).length : tied.length,
                ),
              }
            : null,
      },
    },
    tower: move ? moveView(move, moveIndex) : null,
    seals: JSON.parse(row.seal_table) as SealTable,
    guestbook_count: entryCount,
  };
}

/** One line per year, newest first: what the archive lists. */
export function yearSummaries(db: DB) {
  const rows = db.select().from(years).orderBy(desc(years.year)).all();
  const moves = new Map(db.select().from(tower_moves).all().map((m) => [m.year, m]));
  const counts = new Map(
    db
      .select({ year: guestbook.year, n: sql<number>`count(*)` })
      .from(guestbook)
      .groupBy(guestbook.year)
      .all()
      .map((r) => [r.year, r.n]),
  );
  return rows.map((row) => {
    const n = row.number_u64 === null ? null : BigInt(row.number_u64);
    const m = moves.get(row.year);
    return {
      year: row.year,
      closed: !!row.closed_at,
      number: n === null ? null : { decimal: n.toString(), hex: u64Hex(n) },
      bit: row.bit,
      move: m?.move ?? null,
      decided_by: m?.decided_by ?? null,
      guestbook_count: counts.get(row.year) ?? 0,
    };
  });
}

/** Everything about one year, with its sealed entries, as its archive page shows it. */
export function yearFull(db: DB, year: number) {
  const row = db.select().from(years).where(eq(years.year, year)).get();
  if (!row) return null;
  const moves = db.select().from(tower_moves).orderBy(asc(tower_moves.year)).all();
  const i = moves.findIndex((m) => m.year === year);
  const entries = entriesFor(db, year);
  return { ...yearView(row, moves[i], i, entries.length), entries };
}

export function towerHistory(db: DB) {
  return db.select().from(tower_moves).orderBy(asc(tower_moves.year)).all().map(moveView);
}

export function entriesFor(db: DB, year: number) {
  return db.select().from(guestbook).where(eq(guestbook.year, year)).orderBy(asc(guestbook.id)).all().map(entryView);
}

export function entryCount(db: DB, year: number): number {
  return db.select({ n: sql<number>`count(*)` }).from(guestbook).where(eq(guestbook.year, year)).get()!.n;
}

export function entryById(db: DB, id: number) {
  const e = db.select().from(guestbook).where(eq(guestbook.id, id)).get();
  return e ? entryView(e) : null;
}

/** ledger/YYYY.json: everything about one year, enough to continue the Rite without this site. */
export function ledgerFor(db: DB, year: number, siteUrl: string) {
  const row = db.select().from(years).where(eq(years.year, year)).get();
  if (!row) return null;
  const moves = db.select().from(tower_moves).orderBy(asc(tower_moves.year)).all();
  const i = moves.findIndex((m) => m.year === year);
  const entries = entriesFor(db, year);
  const { guestbook_count: _, ...view } = yearView(row, moves[i], i, entries.length);
  return {
    format: LEDGER_FORMAT,
    rules: 'RULES.md',
    site: siteUrl,
    ...view,
    guestbook: entries,
  };
}
