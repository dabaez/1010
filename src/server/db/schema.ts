// Everything except live votes is append-only: nothing is updated after a
// year closes. Votes and voters_guestbook are emptied at close, once the
// tally is recorded and the year's secret is gone.

import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per Day, inserted when it opens and completed when it closes. */
export const years = sqliteTable('years', {
  year: integer('year').primaryKey(),
  /** ISO timestamps of the window boundaries */
  opened_at: text('opened_at').notNull(),
  closed_at: text('closed_at'),
  /** drand round committed for the Number and the Bit */
  number_round: integer('number_round').notNull(),
  /** unsigned 64-bit, decimal (it does not fit SQLite's signed integer) */
  number_u64: text('number_u64'),
  bit: integer('bit'),
  number_randomness: text('number_randomness'),
  /** 'drand', 'nist' or 'fake' */
  beacon_source: text('beacon_source'),
  /** the beacon response, JSON, so anyone can re-verify */
  number_proof: text('number_proof'),
  tiebreak_round: integer('tiebreak_round').notNull(),
  tiebreak_randomness: text('tiebreak_randomness'),
  tiebreak_source: text('tiebreak_source'),
  tiebreak_proof: text('tiebreak_proof'),
  /** the seal T table in force that year, JSON */
  seal_table: text('seal_table').notNull(),
});

export const tower_moves = sqliteTable('tower_moves', {
  year: integer('year').primaryKey(),
  state_before: text('state_before').notNull(),
  /** e.g. 'A→C' */
  move: text('move').notNull(),
  state_after: text('state_after').notNull(),
  /** every legal move with its votes, alphabetical */
  tally_json: text('tally_json').notNull(),
  /** 'votes', 'tiebreak' or 'no_votes' */
  decided_by: text('decided_by').notNull(),
});

/** Hidden until close. */
export const votes = sqliteTable(
  'votes',
  {
    year: integer('year').notNull(),
    voter_hash: text('voter_hash').notNull(),
    move: text('move').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.year, t.voter_hash] })],
);

/** The message is never stored in plaintext; only the optional name is. */
export const guestbook = sqliteTable('guestbook', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  year: integer('year').notNull(),
  seal: text('seal').notNull(),
  /** optional public name, plaintext; null when anonymous */
  name: text('name'),
  n_hex: text('n_hex').notNull(),
  /** squarings, decimal */
  t: text('t').notNull(),
  iv_b64: text('iv_b64').notNull(),
  ciphertext_b64: text('ciphertext_b64').notNull(),
  created_at: text('created_at').notNull(),
});

/** One entry per person per year, without linking the hash to the entry. */
export const voters_guestbook = sqliteTable(
  'voters_guestbook',
  {
    year: integer('year').notNull(),
    voter_hash: text('voter_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.year, t.voter_hash] })],
);

/**
 * Operational state that is not part of the record: the yearly HMAC secret
 * (deleted at close), beacon retry bookkeeping, ledger export status.
 */
export const rite_meta = sqliteTable('rite_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
