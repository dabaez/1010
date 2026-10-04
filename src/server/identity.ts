// voter_hash = HMAC-SHA256(yearly secret, IP prefix + user agent), with the
// /24 for IPv4 and the /64 for IPv6. The secret exists only while the Day is
// open, so hashes cannot be linked across years or reversed afterwards.
// Shared IPs (offices, universities, carrier NAT) collide; that is accepted.

import { createHmac, randomBytes } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

export function newSecret(): string {
  return randomBytes(32).toString('hex');
}

function expandIPv6(ip: string): number[] | null {
  let addr = ip.split('%')[0]!;
  // A trailing embedded IPv4 (::ffff:1.2.3.4) becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const parts = v4[1]!.split('.').map(Number);
    addr =
      addr.slice(0, -v4[1]!.length) +
      ((parts[0]! << 8) | parts[1]!).toString(16) +
      ':' +
      ((parts[2]! << 8) | parts[3]!).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** '203.0.113.0/24' or '2001:db8:1:2::/64'. Unknown input is kept as-is. */
export function ipPrefix(ip: string): string {
  const raw = ip.trim();
  if (isIPv4(raw)) return raw.split('.').slice(0, 3).join('.') + '.0/24';
  if (isIPv6(raw)) {
    const g = expandIPv6(raw);
    if (!g) return raw;
    // IPv4-mapped (::ffff:a.b.c.d): treat as the IPv4 address it is.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.0/24`;
    }
    return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
  }
  return raw || 'unknown';
}

export function voterHash(secret: string, ip: string, userAgent: string): string {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${ipPrefix(ip)}\n${userAgent}`)
    .digest('hex');
}
