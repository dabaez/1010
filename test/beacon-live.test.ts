// Talks to the real drand and NIST beacons: RUN_NETWORK_TESTS=1 pnpm test
import { describe, expect, it } from 'vitest';
import { liveBeacon } from '../src/server/beacon';
import { deriveNumber } from '../src/shared/beacon';

describe.runIf(process.env.RUN_NETWORK_TESTS === '1')('live beacons', () => {
  const beacon = liveBeacon();

  it('fetches and verifies a drand quicknet round', async () => {
    const r = await beacon.drand(1000);
    expect(r.source).toBe('drand');
    expect(r.randomness).toBe('fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd');
    expect(deriveNumber(r.randomness)).toBe(0xfe290beca10872efn);
  });

  it('refuses a round that does not exist yet', async () => {
    await expect(beacon.drand(4_000_000_000)).rejects.toThrow();
  });

  it('reads the first NIST pulse at or after a timestamp', async () => {
    const target = Date.parse('2026-10-01T10:00:00Z');
    const r = await beacon.nist(target);
    expect(r.source).toBe('nist');
    expect(Date.parse(r.time)).toBeGreaterThanOrEqual(target);
    expect(r.randomness).toMatch(/^[0-9a-f]{128}$/);
  });
});
