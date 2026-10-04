// The server's clock is the only authority on whether it is the Day.
// getNow() is the single source of `now`. In development FAKE_NOW (an ISO
// timestamp) overrides it so the Day can be simulated:
//
//   FAKE_NOW=2026-10-09T09:59:50Z            frozen at that instant
//   FAKE_NOW=2026-10-09T09:59:50Z FAKE_NOW_RUNNING=1   starts there and ticks
//
// config.ts refuses FAKE_NOW when NODE_ENV=production.

const processStart = Date.now();

function parseFakeNow(): number | null {
  const raw = process.env.FAKE_NOW?.trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw new Error(`FAKE_NOW is not a timestamp: ${raw}`);
  return t;
}

const fakeNow = parseFakeNow();
const running = process.env.FAKE_NOW_RUNNING === '1';

export function getNow(): Date {
  if (fakeNow === null) return new Date();
  return new Date(running ? fakeNow + (Date.now() - processStart) : fakeNow);
}

export function isClockFaked(): boolean {
  return fakeNow !== null;
}
