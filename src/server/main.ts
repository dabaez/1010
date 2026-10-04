// The one server process: `node build/server/main.mjs` (or `pnpm start`).

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { turnstile } from './captcha';
import { isClockFaked } from './clock';
import { loadConfig } from './config';
import { createContext, log } from './context';
import { tick } from './rite';

const cfg = loadConfig();
const rite = createContext(cfg);
const captcha = turnstile(cfg.turnstile);

if (isClockFaked()) log(`FAKE_NOW is set: the Rite's clock reads ${rite.now().toISOString()}`);
if (cfg.fakeState) log(`FAKE_STATE is set: the tower reads ${cfg.fakeState}`);
if (cfg.beacon === 'fake') log('BEACON=fake: randomness is NOT real');
if (!cfg.turnstile) log('no TURNSTILE_SITE_KEY/TURNSTILE_SECRET: writes are not captcha-protected');
if (!cfg.ledger) log('no LEDGER_REPO/LEDGER_TOKEN: closed years are not exported to the ledger');

const app = createApp({ rite, captcha, publicDir: cfg.publicDir, siteUrl: cfg.siteUrl, trustProxy: cfg.trustProxy });

// Lazy jobs run on requests; this keeps them moving on a quiet night too
// (the reveal at the opening, retries, the close, the ledger export).
const timer = setInterval(() => void tick(rite), 5_000);
void tick(rite);

const server = serve({ fetch: app.fetch, hostname: cfg.host, port: cfg.port }, (info) => {
  log(`the Annual Rite listens on http://${info.address}:${info.port} (serving ${cfg.publicDir})`);
});

function shutdown(signal: string) {
  log(`${signal}: closing`);
  clearInterval(timer);
  server.close(() => {
    rite.db.$client.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
