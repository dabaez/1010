// The Day: October 10 (10/10, read as 1010), held for 50 hours Anywhere on
// Earth. It opens when October 10 begins in UTC+14 (October 9, 10:00 UTC) and
// closes when it ends in UTC−12 (October 11, 12:00 UTC). Same dates every
// year, no leap-year logic. Shared by the server and the browser; the browser
// only ever uses it with the server's clock.

/** The first year the Rite is held. Nothing happens before it. */
export const FIRST_YEAR = 2026;

const OCTOBER = 9; // Date.UTC months are 0-based

export interface RiteWindow {
  year: number;
  /** ms since the epoch, inclusive */
  opensAt: number;
  /** ms since the epoch, exclusive */
  closesAt: number;
}

export function windowFor(year: number): RiteWindow {
  return {
    year,
    opensAt: Date.UTC(year, OCTOBER, 9, 10, 0, 0),
    closesAt: Date.UTC(year, OCTOBER, 11, 12, 0, 0),
  };
}

function ms(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

/** The one and only "is it the Day?" check. */
export function isRitualOpen(now: Date | number): boolean {
  const t = ms(now);
  const w = windowFor(new Date(t).getUTCFullYear());
  return t >= w.opensAt && t < w.closesAt;
}

/** The window that is open now, or else the next one to open. */
export function currentOrNextWindow(now: Date | number): RiteWindow {
  const t = ms(now);
  const year = Math.max(new Date(t).getUTCFullYear(), FIRST_YEAR);
  const w = windowFor(year);
  return t < w.closesAt ? w : windowFor(year + 1);
}

/** The next window that has not opened yet: the next Number still to be drawn. */
export function nextUnopenedWindow(now: Date | number): RiteWindow {
  const t = ms(now);
  const year = Math.max(new Date(t).getUTCFullYear(), FIRST_YEAR);
  return t < windowFor(year).opensAt ? windowFor(year) : windowFor(year + 1);
}

/** The latest window that has opened by `now`, or null before the first one. */
export function latestOpenedWindow(now: Date | number): RiteWindow | null {
  const t = ms(now);
  let year = new Date(t).getUTCFullYear();
  if (t < windowFor(year).opensAt) year -= 1;
  return year >= FIRST_YEAR ? windowFor(year) : null;
}
