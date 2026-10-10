import { describe, expect, it } from 'vitest';
import { cleanName } from '../src/server/app';
import { ipPrefix, voterHash } from '../src/server/identity';
import { LIMITS, RateLimiter } from '../src/server/ratelimit';
import { loadConfig } from '../src/server/config';
import { sealTableFor } from '../src/shared/seals';
import { seal } from '../src/shared/timelock';
import { get, harness, post } from './helpers';

const MIDDLE = '2026-10-10T12:00:00Z';

describe('identity', () => {
  it('uses the /24 for IPv4 and the /64 for IPv6', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ipPrefix('2001:db8:aaaa:bbbb:1:2:3:4')).toBe('2001:db8:aaaa:bbbb::/64');
    expect(ipPrefix('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipPrefix('::ffff:198.51.100.9')).toBe('198.51.100.0/24');
    expect(ipPrefix('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('hashes prefix and user agent under the yearly secret', () => {
    const s1 = 'aa'.repeat(32);
    const s2 = 'bb'.repeat(32);
    expect(voterHash(s1, '203.0.113.1', 'ua')).toBe(voterHash(s1, '203.0.113.250', 'ua'));
    expect(voterHash(s1, '203.0.113.1', 'ua')).not.toBe(voterHash(s1, '203.0.114.1', 'ua'));
    expect(voterHash(s1, '203.0.113.1', 'ua')).not.toBe(voterHash(s1, '203.0.113.1', 'ub'));
    // A new year's secret makes the same person unlinkable.
    expect(voterHash(s1, '203.0.113.1', 'ua')).not.toBe(voterHash(s2, '203.0.113.1', 'ua'));
  });
});

describe('the sealed guestbook', () => {
  it('stores ciphertext only, one entry per person, with the year’s T', async () => {
    const h = harness({ at: MIDDLE });
    const t = BigInt(sealTableFor(2026).t.short);
    const sealed = await seal('to whoever is listening in 2027', t);

    const ok = await post(h, '/api/guestbook', { seal: 'short', ...sealed, captcha: 'ok' }, '10.9.9.9');
    expect(ok.status).toBe(200);
    const { id } = await ok.json();

    const again = await post(h, '/api/guestbook', { seal: 'short', ...sealed, captcha: 'ok' }, '10.9.9.1');
    expect(again.status).toBe(409);

    const entry = await (await get(h, `/api/guestbook/${id}`)).json();
    expect(entry).toEqual({ id, year: 2026, seal: 'short', name: null, ...sealed, created_at: '2026-10-10T12:00:00.000Z' });
    expect(JSON.stringify(entry)).not.toContain('listening');

    const list = await (await get(h, '/api/guestbook?year=2026')).json();
    expect(list.entries).toHaveLength(1);
    const state = await (await get(h, '/api/state', '10.9.9.9')).json();
    expect(state.you.signed).toBe(true);
    expect(state.year.guestbookCount).toBe(1);
  });

  it('keeps an optional name in plaintext next to the sealed message', async () => {
    const h = harness({ at: MIDDLE });
    const sealed = await seal('secret words', BigInt(sealTableFor(2026).t.decade));
    const r = await post(h, '/api/guestbook', { seal: 'decade', name: '  Ana   de 2026 ', ...sealed, captcha: 'ok' });
    expect(r.status).toBe(200);
    const { id } = await r.json();
    const entry = await (await get(h, `/api/guestbook/${id}`)).json();
    expect(entry.name).toBe('Ana de 2026');
    expect(JSON.stringify(entry)).not.toContain('secret words');
    const tooLong = await post(h, '/api/guestbook', { seal: 'decade', name: 'x'.repeat(41), ...sealed, captcha: 'ok' });
    expect(tooLong.status).toBe(400);
  });

  it('cleans names', () => {
    expect(cleanName(undefined)).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(' Ana\n López ')).toBe('Ana López');
    expect(cleanName('👩‍👩‍👧 familia')).toBe('👩‍👩‍👧 familia');
    expect(cleanName('a\u202Eb')).toBe(false);
    expect(cleanName(42)).toBe(false);
    expect(cleanName('ñ'.repeat(40))).toBe('ñ'.repeat(40));
  });

  it('rejects a T that does not match the chosen seal, and malformed puzzles', async () => {
    const h = harness({ at: MIDDLE });
    const sealed = await seal('x', 1000n);
    const bad = await post(h, '/api/guestbook', { seal: 'short', ...sealed, captcha: 'ok' });
    expect(bad.status).toBe(400);
    const t = sealTableFor(2026).t.century;
    const cases = [
      { seal: 'forever', ...sealed, t },
      { seal: 'century', ...sealed, t, n_hex: 'abc' },
      { seal: 'century', ...sealed, t, iv_b64: 'AAAA' },
      { seal: 'century', ...sealed, t, ciphertext_b64: 'A'.repeat(8000) },
      { seal: 'century', ...sealed, t, ciphertext_b64: '!!' },
    ];
    for (const c of cases) expect((await post(h, '/api/guestbook', { ...c, captcha: 'ok' })).status, JSON.stringify(c).slice(0, 60)).toBe(400);
  });

  it('is locked outside the Day', async () => {
    const h = harness({ at: '2026-10-12T00:00:00Z' });
    const r = await post(h, '/api/guestbook', { seal: 'short' });
    expect(r.status).toBe(423);
    expect((await r.json()).opensAt).toBe('2027-10-09T10:00:00.000Z');
  });
});

describe('the end of programming', () => {
  it('serves the final page at / once the tower stands on C, and locks every write', async () => {
    const h = harness({ at: MIDDLE, fakeState: 'CCCCCCCCCCCC' });
    const home = await get(h, '/');
    expect(await home.text()).toContain('programming is over');
    const s = await (await get(h, '/api/state')).json();
    expect(s.phase).toBe('over');
    expect(s.tower).toMatchObject({ complete: true, optimalRemaining: 0, ballot: [] });
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' })).status).toBe(423);
    expect((await get(h, '/end/')).status).toBe(200);
  });

  it('keeps the final page hidden until then', async () => {
    const h = harness({ at: MIDDLE });
    expect(await (await get(h, '/')).text()).toContain('shrine');
    const end = await get(h, '/end/');
    expect(end.status).toBe(302);
    expect(end.headers.get('location')).toBe('/');
  });

  it('does not count all rings on B', async () => {
    const h = harness({ at: MIDDLE, fakeState: 'BBBBBBBBBBBB' });
    expect((await (await get(h, '/api/state')).json()).phase).toBe('open');
  });
});

describe('the archive', () => {
  it('serves the latest year in full, a line per year, and one page per year', async () => {
    const h = harness({ at: '2026-10-10T12:00:00Z' });
    const sealed = await seal('hola', BigInt(sealTableFor(2026).t.short));
    await post(h, '/api/guestbook', { seal: 'short', name: 'Ana', ...sealed, captcha: 'ok' });
    h.clock.set('2027-11-01T00:00:00Z');
    await get(h, '/api/state');
    const { tick } = await import('../src/server/rite');
    await tick(h.rite);

    const a = await (await get(h, '/api/archive')).json();
    expect(a.latest.year).toBe(2027);
    expect(a.years.map((y: { year: number }) => y.year)).toEqual([2027, 2026]);
    expect(a.years[1]).toMatchObject({ year: 2026, closed: true, guestbook_count: 1 });
    expect(a.next.year).toBe(2028);

    const y2026 = await (await get(h, '/api/archive/2026')).json();
    expect(y2026.entries).toHaveLength(1);
    expect(y2026.entries[0].name).toBe('Ana');
    expect(y2026.tower.move).toMatch(/^A→[BC]$/);
    expect((await get(h, '/api/archive/1999')).status).toBe(404);

    const page = await get(h, '/archive/2026/');
    expect(await page.text()).toContain('one year');
    expect((await get(h, '/archive/2026')).headers.get('location')).toBe('/archive/2026/');
  });
});

describe('static pages', () => {
  it('serves directories, redirects to the trailing slash, and 404s', async () => {
    const h = harness({ at: MIDDLE });
    expect((await get(h, '/archive/')).status).toBe(200);
    const r = await get(h, '/archive');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/archive/');
    const missing = await get(h, '/nope');
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('lost');
    expect((await get(h, '/..%2f..%2fetc%2fpasswd')).status).toBe(404);
  });
});

describe('rate limits', () => {
  it('limits writes per IP prefix', async () => {
    const h = harness({ at: MIDDLE });
    const statuses = [];
    for (let i = 0; i < LIMITS.write.max + 2; i++) {
      statuses.push((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' }, `10.77.1.${i}`)).status);
    }
    expect(statuses.slice(0, 2)).toEqual([200, 409]);
    expect(statuses.at(-1)).toBe(429);
    // A different prefix is unaffected.
    expect((await post(h, '/api/vote', { move: 'A→B', captcha: 'ok' }, '10.78.1.1')).status).toBe(200);
  });

  it('resets after the window', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    const limit = { max: 2, windowMs: 1000 };
    expect([rl.allow('x', '1.2.3.4', limit), rl.allow('x', '1.2.3.5', limit), rl.allow('x', '1.2.3.6', limit)]).toEqual([
      true,
      true,
      false,
    ]);
    t = 1000;
    expect(rl.allow('x', '1.2.3.4', limit)).toBe(true);
  });
});

describe('config', () => {
  it('refuses development overrides in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', FAKE_NOW: '2026-10-10T00:00:00Z' })).toThrow(/FAKE_NOW/);
    expect(() => loadConfig({ NODE_ENV: 'production', FAKE_STATE: 'CCCCCCCCCCCC' })).toThrow(/FAKE_STATE/);
    expect(() => loadConfig({ NODE_ENV: 'production', BEACON: 'fake' })).toThrow(/BEACON/);
    expect(() => loadConfig({ FAKE_STATE: 'DDDDDDDDDDDD' })).toThrow();
    expect(loadConfig({ NODE_ENV: 'production' }).production).toBe(true);
  });
});
