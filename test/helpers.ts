import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server/app';
import { fakeBeacon, type Beacon } from '../src/server/beacon';
import type { Captcha } from '../src/server/captcha';
import { openDb } from '../src/server/db/client';
import { RateLimiter } from '../src/server/ratelimit';
import { resetBeaconThrottle, type RiteContext } from '../src/server/rite';

export const MIGRATIONS = resolve(import.meta.dirname, '..', 'drizzle');

export class Clock {
  constructor(public t: number) {}
  set(iso: string) {
    this.t = Date.parse(iso);
  }
  advance(ms: number) {
    this.t += ms;
  }
  now = () => new Date(this.t);
}

export function makePublicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rite-public-'));
  writeFileSync(join(dir, 'index.html'), '<title>shrine</title>');
  writeFileSync(join(dir, '404.html'), '<title>lost</title>');
  mkdirSync(join(dir, 'end'));
  writeFileSync(join(dir, 'end', 'index.html'), '<title>programming is over</title>');
  mkdirSync(join(dir, 'archive'));
  writeFileSync(join(dir, 'archive', 'index.html'), '<title>archive</title>');
  return dir;
}

export interface Harness {
  clock: Clock;
  rite: RiteContext;
  app: ReturnType<typeof createApp>;
  logs: string[];
}

export const passCaptcha: Captcha = { siteKey: null, verify: async (t) => t !== 'bad' };

export function harness(opts: { at: string; beacon?: Beacon; fakeState?: string | null; limiter?: RateLimiter }): Harness {
  resetBeaconThrottle();
  const clock = new Clock(Date.parse(opts.at));
  const logs: string[] = [];
  const rite: RiteContext = {
    db: openDb(':memory:', MIGRATIONS),
    beacon: opts.beacon ?? fakeBeacon(),
    now: clock.now,
    log: (m) => logs.push(m),
    fakeState: opts.fakeState ?? null,
    exportLedger: null,
  };
  const app = createApp({
    rite,
    captcha: passCaptcha,
    publicDir: makePublicDir(),
    siteUrl: 'https://1010.example',
    trustProxy: true,
    limiter: opts.limiter ?? new RateLimiter(() => clock.t),
  });
  return { clock, rite, app, logs };
}

let ipCounter = 0;
/** A distinct /24 per call, so each visitor is a different person. */
export function freshIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 8) & 255}.${ipCounter & 255}.7`;
}

export function post(h: Harness, path: string, body: unknown, ip = freshIp(), ua = 'test-agent') {
  return h.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, 'user-agent': ua },
    body: JSON.stringify(body),
  });
}

export function get(h: Harness, path: string, ip = '192.0.2.1', ua = 'test-agent') {
  return h.app.request(path, { headers: { 'x-real-ip': ip, 'user-agent': ua } });
}
