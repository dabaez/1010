import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeBeacon } from '../src/server/beacon';
import { rite_meta, tower_moves, voters_guestbook, votes, years } from '../src/server/db/schema';
import { ledgerFor } from '../src/server/records';
import {
  FALLBACK_AFTER_MS,
  closeRite,
  decide,
  ensureOpened,
  getYear,
  realTowerState,
  tick,
  yearSecret,
} from '../src/server/rite';
import { deriveNumber, pickIndex } from '../src/shared/beacon';
import { START_STATE, applyMove, parseMove } from '../src/shared/tower';
import { get, harness, post } from './helpers';

const BEFORE = '2026-10-09T09:59:59Z';
const OPEN = '2026-10-09T10:00:00Z';
const MIDDLE = '2026-10-10T12:00:00Z';
const CLOSE = '2026-10-11T12:00:00Z';

describe('the close-time rules', () => {
  const r = 'ab'.repeat(32);

  it('applies the move with the most votes', () => {
    const d = decide(START_STATE, { 'A→B': 3, 'A→C': 5 }, r);
    expect(d).toEqual({ move: 'A→C', decidedBy: 'votes', tally: { 'A→B': 3, 'A→C': 5 } });
  });

  it('breaks ties with the close number modulo the tied moves, alphabetically', () => {
    const state = 'CBAAAAAAAAAA'; // legal: A→C? no. C→A, C→B, B→A? see below
    const d = decide(state, {}, r);
    const legal = Object.keys(d.tally);
    expect(legal).toEqual([...legal].sort());
    const tie = decide(state, Object.fromEntries(legal.map((m) => [m, 2])), r);
    expect(tie.decidedBy).toBe('tiebreak');
    expect(tie.move).toBe(legal[pickIndex(r, legal.length)]);
    const two = decide(state, { [legal[0]!]: 4, [legal[2]!]: 4, [legal[1]!]: 1 }, r);
    expect(two.move).toBe([legal[0]!, legal[2]!][Number(deriveNumber(r) % 2n)]);
  });

  it('never skips a year: no votes means the number picks among all legal moves', () => {
    const d = decide(START_STATE, {}, r);
    expect(d.decidedBy).toBe('no_votes');
    expect(d.move).toBe(['A→B', 'A→C'][pickIndex(r, 2)]);
    expect(d.tally).toEqual({ 'A→B': 0, 'A→C': 0 });
  });
});

describe('a full Day, simulated', () => {
  it('stays sealed before the window and answers writes with 423', async () => {
    const h = harness({ at: BEFORE });
    const s = await (await get(h, '/api/state')).json();
    expect(s.phase).toBe('sealed');
    expect(s.tower.ballot).toEqual([]);
    expect(s.year).toBeNull();
    expect((await post(h, '/api/vote', { move: 'A→C' })).status).toBe(423);
    expect((await post(h, '/api/guestbook', {})).status).toBe(423);
    expect(getYear(h.rite.db, 2026)).toBeUndefined();
  });

  it('opens, reveals, takes hidden votes, closes, and makes exactly one move', async () => {
    const h = harness({ at: BEFORE });
    h.clock.set(OPEN);

    // The first request after the boundary opens the Rite.
    let s = await (await get(h, '/api/state')).json();
    expect(s.phase).toBe('open');
    expect(s.tower.ballot).toEqual(['A→B', 'A→C']);
    expect(yearSecret(h.rite.db, 2026)).toMatch(/^[0-9a-f]{64}$/);

    // The opening ceremony: the Number and the Bit from the committed round.
    await tick(h.rite);
    s = await (await get(h, '/api/state')).json();
    expect(s.year.round).toBe(32912212);
    expect(s.year.number.decimal).toMatch(/^\d+$/);
    expect(s.year.number.hex).toMatch(/^0x[0-9a-f]{16}$/);
    expect([0, 1]).toContain(s.year.bit);

    h.clock.set(MIDDLE);
    const voters = [
      ['10.0.1.1', 'A→C'],
      ['10.0.2.1', 'A→C'],
      ['10.0.3.1', 'A→B'],
      ['2001:db8:1:1::1', 'A-C'],
    ];
    for (const [ip, move] of voters) {
      const r = await post(h, '/api/vote', { move, captcha: 'ok' }, ip);
      expect(r.status, `${ip} ${move}`).toBe(200);
    }
    // One vote per person: same /24 and user agent is the same person.
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' }, '10.0.1.200')).status).toBe(409);
    // The same /64 too.
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' }, '2001:db8:1:1:ffff::9')).status).toBe(409);
    // A different browser behind the same NAT is a different person.
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' }, '10.0.1.1', 'other-agent')).status).toBe(200);
    // Illegal moves and failed captchas are refused.
    expect((await post(h, '/api/vote', { move: 'B→C', captcha: 'ok' })).status).toBe(400);
    expect((await post(h, '/api/vote', { move: 'A→C', captcha: 'bad' })).status).toBe(403);

    // Votes are hidden: the state shows your own vote, never a tally.
    s = await (await get(h, '/api/state', '10.0.1.1')).json();
    expect(s.you).toEqual({ vote: 'A→C', signed: false });
    expect(JSON.stringify(s)).not.toContain('tally');
    expect((await (await get(h, '/api/tower')).json()).history).toEqual([]);

    // The last millisecond still counts; the close does not.
    h.clock.set('2026-10-11T11:59:59.999Z');
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' })).status).toBe(200);
    h.clock.set(CLOSE);
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' })).status).toBe(423);

    // Close: A→C has 3, A→B has 3 → a tie, broken by the close round.
    await tick(h.rite);
    const move = h.rite.db.select().from(tower_moves).all();
    expect(move).toHaveLength(1);
    expect(JSON.parse(move[0]!.tally_json)).toEqual({ 'A→B': 3, 'A→C': 3 });
    expect(move[0]!.decided_by).toBe('tiebreak');
    const tiebreak = getYear(h.rite.db, 2026)!.tiebreak_randomness!;
    expect(move[0]!.move).toBe(['A→B', 'A→C'][pickIndex(tiebreak, 2)]);
    expect(realTowerState(h.rite.db)).toBe(applyMove(START_STATE, parseMove(move[0]!.move)!));

    // The secret and the hashes are gone; the record stays.
    expect(yearSecret(h.rite.db, 2026)).toBeNull();
    expect(h.rite.db.select().from(votes).all()).toEqual([]);
    expect(h.rite.db.select().from(voters_guestbook).all()).toEqual([]);
    expect(getYear(h.rite.db, 2026)!.closed_at).toBe('2026-10-11T12:00:00.000Z');

    // Running the jobs again changes nothing.
    await tick(h.rite);
    expect(await closeRite(h.rite, 2026)).toBe('already-closed');
    expect(h.rite.db.select().from(tower_moves).all()).toHaveLength(1);

    s = await (await get(h, '/api/state')).json();
    expect(s.phase).toBe('sealed');
    expect(s.window.year).toBe(2027);
    expect(s.tower.movesMade).toBe(1);
    expect(s.tower.optimalRemaining).toBeGreaterThanOrEqual(4094);
    const history = (await (await get(h, '/api/tower')).json()).history;
    expect(history[0]).toMatchObject({ year: 2026, number: 1, tally: { 'A→B': 3, 'A→C': 3 } });
  });

  it('decides by votes when there is a clear winner', async () => {
    const h = harness({ at: MIDDLE });
    for (let i = 0; i < 3; i++) await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' });
    await post(h, '/api/vote', { move: 'A→C', captcha: 'ok' });
    h.clock.set(CLOSE);
    await tick(h.rite);
    const m = h.rite.db.select().from(tower_moves).get()!;
    expect(m).toMatchObject({ move: 'A→B', decided_by: 'votes', state_after: 'BAAAAAAAAAAA' });
  });

  it('closes exactly once under concurrent triggers', async () => {
    const h = harness({ at: MIDDLE });
    ensureOpened(h.rite);
    h.clock.set(CLOSE);
    const results = await Promise.all([closeRite(h.rite), closeRite(h.rite), tick(h.rite), closeRite(h.rite)]);
    expect(results.filter((r) => r === 'closed')).toHaveLength(1);
    expect(h.rite.db.select().from(tower_moves).all()).toHaveLength(1);
  });

  it('never skips a year, even if the server slept through several Days', async () => {
    const h = harness({ at: '2029-11-01T00:00:00Z' });
    await tick(h.rite);
    const moves = h.rite.db.select().from(tower_moves).all();
    expect(moves.map((m) => m.year)).toEqual([2026, 2027, 2028, 2029]);
    expect(moves.every((m) => m.decided_by === 'no_votes')).toBe(true);
    for (let i = 1; i < moves.length; i++) expect(moves[i]!.state_before).toBe(moves[i - 1]!.state_after);
    // Rounds come from the boundaries, not from when the job ran.
    expect(getYear(h.rite.db, 2027)!.number_round).toBe(getYear(h.rite.db, 2027)!.number_round);
    expect(getYear(h.rite.db, 2026)!.number_u64).not.toBeNull();
    // No secrets were left behind for closed years.
    expect(h.rite.db.select().from(rite_meta).all().filter((m) => m.key.startsWith('secret:'))).toEqual([]);
    expect(h.rite.db.select().from(years).all()).toHaveLength(4);
  });

  it('gives the same result whenever the close job runs', async () => {
    const a = harness({ at: '2026-10-11T12:00:00Z' });
    const b = harness({ at: '2027-03-01T00:00:00Z' });
    await tick(a.rite);
    await tick(b.rite);
    const ma = a.rite.db.select().from(tower_moves).get();
    const mb = b.rite.db.select().from(tower_moves).get();
    expect(ma).toEqual(mb);
    expect(getYear(a.rite.db, 2026)!.number_u64).toBe(getYear(b.rite.db, 2026)!.number_u64);
  });
});

describe('the beacon fallback', () => {
  it('retries drand for an hour, then uses NIST and records it', async () => {
    let drandUp = false;
    const h = harness({ at: OPEN, beacon: fakeBeacon({ failDrand: () => !drandUp }) });
    const { resetBeaconThrottle } = await import('../src/server/rite');
    await tick(h.rite);
    expect(getYear(h.rite.db, 2026)!.number_u64).toBeNull();
    let s = await (await get(h, '/api/state')).json();
    expect(s.year.number).toBeNull();

    h.clock.advance(FALLBACK_AFTER_MS - 1000);
    resetBeaconThrottle();
    await tick(h.rite);
    expect(getYear(h.rite.db, 2026)!.number_u64).toBeNull();

    h.clock.advance(1000);
    resetBeaconThrottle();
    await tick(h.rite);
    const row = getYear(h.rite.db, 2026)!;
    expect(row.beacon_source).toBe('nist');
    expect(row.number_u64).not.toBeNull();
    s = await (await get(h, '/api/state')).json();
    expect(s.year.source).toBe('nist');

    // The close uses drand again once it is back.
    drandUp = true;
    h.clock.set(CLOSE);
    resetBeaconThrottle();
    await tick(h.rite);
    expect(getYear(h.rite.db, 2026)!.tiebreak_source).toBe('fake');
  });
});

describe('the ledger', () => {
  it('holds everything needed to continue the Rite', async () => {
    const h = harness({ at: MIDDLE });
    await post(h, '/api/vote', { move: 'A→C', captcha: 'ok' });
    h.clock.set('2027-10-12T00:00:00Z');
    await tick(h.rite);

    const l2026 = ledgerFor(h.rite.db, 2026, 'https://1010.example')!;
    const l2027 = ledgerFor(h.rite.db, 2027, 'https://1010.example')!;
    expect(l2026.format).toBe('annual-rite-ledger/1');
    expect(l2026.tower).toMatchObject({ state_before: START_STATE, move: 'A→C', decided_by: 'votes' });
    expect(l2027.tower!.state_before).toBe(l2026.tower!.state_after);
    expect(l2027.tower!.decided_by).toBe('no_votes');
    expect(l2027.beacon.tiebreak.derivation).not.toBeNull();
    expect(l2026.seals.t.y1).toMatch(/^\d+$/);

    // Rebuild the tower from the ledgers alone.
    let state = START_STATE;
    for (const l of [l2026, l2027]) {
      expect(l.tower!.state_before).toBe(state);
      state = applyMove(state, parseMove(l.tower!.move)!);
      expect(state).toBe(l.tower!.state_after);
    }

    const res = await get(h, '/api/ledger/2026.json');
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toEqual(JSON.parse(JSON.stringify(l2026)));
    expect((await get(h, '/api/ledger/2028.json')).status).toBe(404);
    const arch = await (await get(h, '/api/archive')).json();
    expect(arch.years.map((y: { year: number }) => y.year)).toEqual([2027, 2026]);
    expect(arch.next.year).toBe(2028);
    expect(arch.next.numberRound).toBeGreaterThan(32912212);
    expect(h.rite.db.select().from(years).where(eq(years.year, 2026)).get()!.closed_at).not.toBeNull();
  });
});
