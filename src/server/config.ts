// Everything the server reads from its environment, in one place.
// In production these come from the systemd unit and %h/rite.env.

import { resolve } from 'node:path';
import { isValidState } from '../shared/tower';

export interface Config {
  production: boolean;
  host: string;
  port: number;
  /** SQLite file; lives outside releases on the droplet */
  dbPath: string;
  migrationsDir: string;
  /** the built Astro site */
  publicDir: string;
  /** public URL, for links in the ledger */
  siteUrl: string;
  /** trust X-Real-IP / X-Forwarded-For (only behind our own nginx) */
  trustProxy: boolean;
  /** 'live' = drand with NIST fallback; 'fake' = deterministic, development only */
  beacon: 'live' | 'fake';
  /** development: pretend the tower is in this state (e.g. CCCCCCCCCCCC for the final page) */
  fakeState: string | null;
  turnstile: { siteKey: string; secret: string } | null;
  ledger: { repo: string; token: string; branch: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const fakeState = env.FAKE_STATE?.trim() || null;
  if (fakeState && !isValidState(fakeState)) throw new Error(`FAKE_STATE must be 12 of A/B/C, got ${fakeState}`);
  const beacon = env.BEACON === 'fake' ? 'fake' : 'live';

  if (production) {
    const devOnly = [env.FAKE_NOW && 'FAKE_NOW', fakeState && 'FAKE_STATE', beacon === 'fake' && 'BEACON=fake'].filter(
      Boolean,
    );
    if (devOnly.length) throw new Error(`refusing to run in production with ${devOnly.join(', ')}`);
  }

  const dataDir = env.DATA_DIR ?? 'data';
  return {
    production,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8710),
    dbPath: env.DB_PATH ?? resolve(dataDir, 'rite.sqlite'),
    migrationsDir: resolve(env.MIGRATIONS_DIR ?? 'drizzle'),
    publicDir: resolve(env.PUBLIC_DIR ?? 'dist'),
    siteUrl: (env.SITE_URL ?? 'https://1010.b4ez.com').replace(/\/$/, ''),
    trustProxy: env.TRUST_PROXY === '1',
    beacon,
    fakeState,
    turnstile:
      env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET
        ? { siteKey: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET }
        : null,
    ledger:
      env.LEDGER_REPO && env.LEDGER_TOKEN
        ? { repo: env.LEDGER_REPO, token: env.LEDGER_TOKEN, branch: env.LEDGER_BRANCH ?? 'main' }
        : null,
  };
}
