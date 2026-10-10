import { describe, expect, it } from 'vitest';
import { currentOrNextWindow, isRitualOpen, latestOpenedWindow, nextUnopenedWindow, windowFor } from '../src/shared/calendar';

const t = (iso: string) => Date.parse(iso);

describe('the 50-hour window', () => {
  it('opens at 10:00 UTC on October 9 and closes at 12:00 UTC on October 11', () => {
    const w = windowFor(2026);
    expect(new Date(w.opensAt).toISOString()).toBe('2026-10-09T10:00:00.000Z');
    expect(new Date(w.closesAt).toISOString()).toBe('2026-10-11T12:00:00.000Z');
    expect(w.closesAt - w.opensAt).toBe(50 * 3600 * 1000);
  });

  it('is closed the millisecond before opening', () => {
    expect(isRitualOpen(t('2026-10-09T09:59:59.999Z'))).toBe(false);
  });

  it('is open at the opening instant', () => {
    expect(isRitualOpen(t('2026-10-09T10:00:00.000Z'))).toBe(true);
    expect(isRitualOpen(new Date('2026-10-09T10:00:00Z'))).toBe(true);
  });

  it('is open throughout October 10 and until the last millisecond', () => {
    expect(isRitualOpen(t('2026-10-10T00:00:00Z'))).toBe(true);
    expect(isRitualOpen(t('2026-10-10T23:59:59Z'))).toBe(true);
    expect(isRitualOpen(t('2026-10-11T11:59:59.999Z'))).toBe(true);
  });

  it('is closed at the closing instant and after', () => {
    expect(isRitualOpen(t('2026-10-11T12:00:00.000Z'))).toBe(false);
    expect(isRitualOpen(t('2026-10-12T00:00:00Z'))).toBe(false);
  });

  it('is closed the rest of the year', () => {
    for (const iso of ['2027-01-01T00:00:00Z', '2027-06-15T12:00:00Z', '2027-10-09T09:00:00Z', '2026-12-31T23:59:59Z']) {
      expect(isRitualOpen(t(iso))).toBe(false);
    }
  });

  it('uses the same dates every year, leap years included', () => {
    for (const year of [2028, 2100, 2400, 6121]) {
      const w = windowFor(year);
      expect(isRitualOpen(w.opensAt - 1)).toBe(false);
      expect(isRitualOpen(w.opensAt)).toBe(true);
      expect(isRitualOpen(w.closesAt - 1)).toBe(true);
      expect(isRitualOpen(w.closesAt)).toBe(false);
    }
  });
});

describe('next and latest windows', () => {
  it('counts down to this year before the Day', () => {
    expect(currentOrNextWindow(t('2026-10-03T00:00:00Z')).year).toBe(2026);
  });
  it('is the current window during the Day', () => {
    expect(currentOrNextWindow(t('2026-10-10T00:00:00Z')).year).toBe(2026);
  });
  it('moves to next year at the close', () => {
    expect(currentOrNextWindow(t('2026-10-11T12:00:00Z')).year).toBe(2027);
  });
  it('never counts down to a year before the first', () => {
    expect(currentOrNextWindow(t('2020-01-01T00:00:00Z')).year).toBe(2026);
  });
  it('points at the next Number still to be drawn', () => {
    expect(nextUnopenedWindow(t('2026-10-09T09:59:59Z')).year).toBe(2026);
    // While the Day is open its Number is already drawn: the next one is next year's.
    expect(nextUnopenedWindow(t('2026-10-09T10:00:00Z')).year).toBe(2027);
    expect(nextUnopenedWindow(t('2026-12-01T00:00:00Z')).year).toBe(2027);
  });
  it('knows the latest window that opened', () => {
    expect(latestOpenedWindow(t('2026-10-09T09:59:59Z'))).toBeNull();
    expect(latestOpenedWindow(t('2026-10-09T10:00:00Z'))?.year).toBe(2026);
    expect(latestOpenedWindow(t('2027-03-01T00:00:00Z'))?.year).toBe(2026);
    expect(latestOpenedWindow(t('2027-10-09T10:00:00Z'))?.year).toBe(2027);
  });
});
