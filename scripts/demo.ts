// A made-up history to look at: several past Days with votes, names and
// sealed messages, in data/demo.sqlite (rebuilt on every run), served at
// http://127.0.0.1:8711 with the clock set after the last of them. (A port of
// its own, so it can run next to `pnpm dev:server`.)
//
//   pnpm demo              six past Days, the shrine sealed
//   pnpm demo 20           twenty past Days
//   pnpm demo 6 --open     six past Days, and the next one open right now
//
// The randomness is fake (BEACON=fake) and nothing touches the real database.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBeacon } from '../src/server/beacon';
import { openDb } from '../src/server/db/client';
import { addEntry, castVote, ensureOpened, realTowerState, tick, type RiteContext } from '../src/server/rite';
import { FIRST_YEAR, windowFor } from '../src/shared/calendar';
import { SEALS, sealTableFor } from '../src/shared/seals';
import { seal } from '../src/shared/timelock';
import { legalMoves, moveName } from '../src/shared/tower';

const args = process.argv.slice(2);
const years = Number(args.find((a) => /^\d+$/.test(a)) ?? 6);
const openNext = args.includes('--open');
const dbPath = resolve('data/demo.sqlite');

const NAMES = ['Ana', 'Pedro', 'Lucía', 'Tomás', 'la abuela', 'Martina y Joaquín', 'J.', 'una visitante', 'Camila', '🌙'];
const MESSAGES = ['Hola, futuro.', '¿Todavía existe la torre?', 'Saludos desde el pasado.', 'Ojalá estés bien.', 'Vota A→C.'];

for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });

let t = windowFor(FIRST_YEAR).opensAt;
const ctx: RiteContext = {
  db: openDb(dbPath, resolve('drizzle')),
  beacon: fakeBeacon(),
  now: () => new Date(t),
  log: () => {},
  exportLedger: null,
};

const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const voter = () => randomBytes(32).toString('hex');

for (let y = FIRST_YEAR; y < FIRST_YEAR + years; y++) {
  const w = windowFor(y);
  t = w.opensAt + 3600_000;
  ensureOpened(ctx);
  await tick(ctx);

  // Votes: a crowd leaning one way, not always the wise way.
  const ballot = legalMoves(realTowerState(ctx.db)).map(moveName);
  const favourite = pick(ballot);
  const crowd = 3 + Math.floor(Math.random() * 30);
  for (let i = 0; i < crowd; i++) {
    castVote(ctx, y, voter(), Math.random() < 0.5 ? favourite : pick(ballot), new Date(t));
  }

  // A few sealed messages, some signed.
  const entries = Math.floor(Math.random() * 6);
  for (let i = 0; i < entries; i++) {
    const s = pick(SEALS);
    const sealed = await seal(pick(MESSAGES), BigInt(sealTableFor(y).t[s]));
    t += 600_000;
    addEntry(ctx, y, voter(), { seal: s, name: Math.random() < 0.7 ? pick(NAMES) : null, ...sealed }, new Date(t));
  }

  t = w.closesAt;
  await tick(ctx);
  console.log(`${y}: ${crowd} votes, ${entries} messages, tower ${realTowerState(ctx.db)}`);
}

const last = FIRST_YEAR + years - 1;
const fakeNow = openNext
  ? new Date(windowFor(last + 1).opensAt + 3600_000).toISOString()
  : new Date(Date.UTC(last, 11, 1)).toISOString();
ctx.db.$client.close();

console.log(`\nServing the demo at http://127.0.0.1:8711 with the clock at ${fakeNow} (Ctrl-C to stop)\n`);
spawn('npx', ['tsx', 'src/server/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '8711', DB_PATH: dbPath, BEACON: 'fake', FAKE_NOW: fakeNow, FAKE_NOW_RUNNING: '1' },
});
