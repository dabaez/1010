// The web server: a JSON API under /api, and the built Astro site for
// everything else. Outside the Day every write answers 423 Locked.

import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { isRitualOpen, currentOrNextWindow, windowFor } from '../shared/calendar';
import { isSeal, sealTableFor, SEAL_YEARS, SEALS } from '../shared/seals';
import { MAX_CIPHERTEXT_BYTES, MODULUS_BITS } from '../shared/timelock';
import { OPTIMAL_TOTAL, distanceToGoal, isComplete, legalMoves, moveName } from '../shared/tower';
import type { Captcha } from './captcha';
import { voterHash } from './identity';
import { LIMITS, RateLimiter } from './ratelimit';
import { archive, entriesFor, entryById, ledgerFor, towerHistory, yearView } from './records';
import {
  addEntry,
  castVote,
  commitments,
  ensureOpened,
  getYear,
  hasSigned,
  isProgrammingOver,
  latestYear,
  movesMade,
  myVote,
  tick,
  towerState,
  yearSecret,
  type RiteContext,
} from './rite';
import { serveStatic } from './static';
import { ledgerJson } from './ledger';

export interface AppDeps {
  rite: RiteContext;
  captcha: Captcha;
  publicDir: string;
  siteUrl: string;
  trustProxy: boolean;
  limiter?: RateLimiter;
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const real = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0];
    if (real) return real.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // app.request() in tests has no socket
  }
}

type Phase = 'sealed' | 'open' | 'closing' | 'over';

export function createApp(deps: AppDeps) {
  const { rite } = deps;
  const limiter = deps.limiter ?? new RateLimiter();
  const app = new Hono();

  // Rate limits, then the lazy jobs: the first request after a boundary
  // opens or closes the Rite.
  app.use('*', async (c, next) => {
    const ip = clientIp(c, deps.trustProxy);
    if (!limiter.allow('read', ip, LIMITS.read)) return c.json({ error: 'too many requests' }, 429);
    if (c.req.method === 'POST' && !limiter.allow('write', ip, LIMITS.write)) {
      return c.json({ error: 'too many requests' }, 429);
    }
    ensureOpened(rite);
    void tick(rite);
    await next();
  });

  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
  });

  function phase(now: Date): Phase {
    if (isProgrammingOver(rite)) return 'over';
    if (isRitualOpen(now)) return 'open';
    const last = latestYear(rite.db);
    if (last && !last.closed_at && now.getTime() >= windowFor(last.year).closesAt) return 'closing';
    return 'sealed';
  }

  function identity(c: Context, year: number): string | null {
    const secret = yearSecret(rite.db, year);
    if (!secret) return null;
    return voterHash(secret, clientIp(c, deps.trustProxy), c.req.header('user-agent') ?? '');
  }

  // ---------------------------------------------------------------- reads

  app.get('/api/state', (c) => {
    const now = rite.now();
    const p = phase(now);
    const state = towerState(rite);
    const window = currentOrNextWindow(now);
    const latest = latestYear(rite.db);
    const open = p === 'open';
    const voter = open ? identity(c, window.year) : null;
    const table = sealTableFor(window.year);
    const shown = latest ? yearView(latest, undefined, -1, entriesFor(rite.db, latest.year).length) : null;

    return c.json({
      serverNow: now.toISOString(),
      phase: p,
      window: {
        year: window.year,
        opensAt: new Date(window.opensAt).toISOString(),
        closesAt: new Date(window.closesAt).toISOString(),
      },
      commitments: commitments(window.year),
      tower: {
        state,
        movesMade: movesMade(rite.db),
        optimalRemaining: distanceToGoal(state),
        optimalTotal: OPTIMAL_TOTAL,
        complete: isComplete(state),
        // The ballot: legal moves only, alphabetical, never marked optimal.
        ballot: open ? legalMoves(state).map(moveName).sort() : [],
      },
      // The latest year that opened: its Number and Bit, once revealed.
      year: shown && {
        year: shown.year,
        number: shown.number,
        bit: shown.bit,
        source: shown.beacon.number.source,
        round: shown.beacon.number.committed_drand_round,
        randomness: shown.beacon.number.randomness,
        guestbookCount: shown.guestbook_count,
        closed: !!shown.closed_at,
      },
      you: open && voter ? { vote: myVote(rite, window.year, voter), signed: hasSigned(rite, window.year, voter) } : null,
      captcha: deps.captcha.siteKey ? { provider: 'turnstile', siteKey: deps.captcha.siteKey } : null,
      seals: Object.fromEntries(SEALS.map((s) => [s, { t: table.t[s], years: SEAL_YEARS[s] }])),
      sealBenchmark: table.benchmark,
    });
  });

  app.get('/api/tower', (c) => {
    const state = towerState(rite);
    return c.json({
      state,
      movesMade: movesMade(rite.db),
      optimalRemaining: distanceToGoal(state),
      complete: isComplete(state),
      history: towerHistory(rite.db),
    });
  });

  app.get('/api/archive', (c) => {
    const now = rite.now();
    const next = currentOrNextWindow(now);
    return c.json({ years: archive(rite.db), next: commitments(next.year) });
  });

  app.get('/api/guestbook', (c) => {
    const year = Number(c.req.query('year') ?? latestYear(rite.db)?.year);
    if (!Number.isInteger(year)) return c.json({ year: null, entries: [] });
    return c.json({ year, entries: entriesFor(rite.db, year) });
  });

  app.get('/api/guestbook/:id{[0-9]+}', (c) => {
    const e = entryById(rite.db, Number(c.req.param('id')));
    return e ? c.json(e) : c.json({ error: 'no such entry' }, 404);
  });

  app.get('/api/ledger/:file{[0-9]+\\.json}', (c) => {
    const year = Number(c.req.param('file').replace('.json', ''));
    const row = getYear(rite.db, year);
    if (!row?.closed_at) return c.json({ error: 'that year is not closed' }, 404);
    return c.body(ledgerJson(ledgerFor(rite.db, year, deps.siteUrl)), 200, {
      'content-type': 'application/json; charset=utf-8',
    });
  });

  // ---------------------------------------------------------------- writes

  async function guardWrite(c: Context): Promise<
    { ok: true; year: number; voter: string; body: Record<string, unknown> } | { ok: false; res: Response }
  > {
    const now = rite.now();
    if (!isRitualOpen(now) || isProgrammingOver(rite)) {
      return {
        ok: false,
        res: c.json({ error: 'The shrine is sealed. Come back on the Day.', opensAt: new Date(currentOrNextWindow(now).opensAt).toISOString() }, 423),
      };
    }
    const year = windowFor(now.getUTCFullYear()).year;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return { ok: false, res: c.json({ error: 'expected a JSON body' }, 400) };
    const ip = clientIp(c, deps.trustProxy);
    if (!(await deps.captcha.verify(body.captcha, ip))) {
      return { ok: false, res: c.json({ error: 'the captcha did not pass; try again' }, 403) };
    }
    const voter = identity(c, year);
    if (!voter) return { ok: false, res: c.json({ error: 'the Rite is still opening; try again in a moment' }, 503) };
    return { ok: true, year, voter, body };
  }

  app.post('/api/vote', async (c) => {
    const g = await guardWrite(c);
    if (!g.ok) return g.res;
    const r = castVote(rite, g.year, g.voter, String(g.body.move ?? ''), rite.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true, message: 'Your vote is sealed until the close.' });
  });

  app.post('/api/guestbook', async (c) => {
    const g = await guardWrite(c);
    if (!g.ok) return g.res;
    const { seal, n_hex, t, iv_b64, ciphertext_b64 } = g.body;
    if (!isSeal(seal)) return c.json({ error: 'choose a seal: short, decade or century' }, 400);
    if (String(t) !== sealTableFor(g.year).t[seal]) return c.json({ error: `T does not match the ${seal} seal of ${g.year}` }, 400);
    if (typeof n_hex !== 'string' || !/^[0-9a-f]+$/.test(n_hex) || BigInt('0x' + n_hex).toString(2).length !== MODULUS_BITS) {
      return c.json({ error: `N must be a ${MODULUS_BITS}-bit number in lowercase hex` }, 400);
    }
    const iv = typeof iv_b64 === 'string' ? Buffer.from(iv_b64, 'base64') : null;
    if (!iv || iv.length !== 12 || iv.toString('base64') !== iv_b64) return c.json({ error: 'the iv must be 12 bytes of base64' }, 400);
    const ct = typeof ciphertext_b64 === 'string' ? Buffer.from(ciphertext_b64, 'base64') : null;
    if (!ct || ct.toString('base64') !== ciphertext_b64 || ct.length < 17 || ct.length > MAX_CIPHERTEXT_BYTES) {
      return c.json({ error: 'the ciphertext is not valid base64 of a sealed message of up to 1,000 characters' }, 400);
    }
    const r = addEntry(rite, g.year, g.voter, { seal, n_hex, t: String(t), iv_b64, ciphertext_b64 }, rite.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true, id: r.id });
  });

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  // ---------------------------------------------------------------- pages

  // When the tower is complete the site permanently becomes the final page.
  app.get('/', async (c, next) => {
    if (isProgrammingOver(rite)) return serveStatic(c, deps.publicDir, '/end/');
    await next();
  });
  app.get('/end', (c) => c.redirect('/end/', 301));
  app.get('/end/', async (c, next) => {
    if (!isProgrammingOver(rite)) return c.redirect('/', 302);
    await next();
  });
  app.get('*', (c) => serveStatic(c, deps.publicDir, c.req.path));

  return app;
}
