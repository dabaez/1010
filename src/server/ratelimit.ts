// Fixed-window rate limits per IP prefix, in memory. One process, one Day:
// nothing fancier is needed.

import { ipPrefix } from './identity';

export interface Limit {
  /** requests per window */
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** True if the request is allowed. */
  allow(bucket: string, ip: string, limit: Limit): boolean {
    const t = this.now();
    this.sweep(t);
    const key = `${bucket}|${ipPrefix(ip)}`;
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + limit.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= limit.max;
  }

  private sweep(t: number): void {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

export const LIMITS = {
  /** every request */
  read: { max: 600, windowMs: 60_000 },
  /** votes and guestbook entries, including failed attempts */
  write: { max: 10, windowMs: 10 * 60_000 },
} satisfies Record<string, Limit>;
