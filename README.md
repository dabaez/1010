# The Annual Rite

<https://1010.b4ez.com>: a website that opens for one day a year (October 10,
for 50 hours, Anywhere on Earth) and hosts three computing rituals:

- **The Tower.** A 12-ring Tower of Hanoi. Each Day visitors vote and exactly
  one ring moves. When all rings stand on C, programming is over.
- **The Sealed Guestbook.** Messages sealed in RSW time-lock puzzles, in the
  browser. Anyone can open them, given years of sequential squaring.
- **The Number and the Bit.** A random number and bit of the year, from the
  drand beacon, with the deciding rounds committed a year ahead.

The rest of the year it is a sealed shrine with a countdown and the archive.
[`SPEC.md`](SPEC.md) is the design; [`RULES.md`](RULES.md) is the rules in
plain words, and the source of truth.

## Layout

| Path | What |
|---|---|
| `src/shared/` | Pure code used by both sides: the calendar (`isRitualOpen`), the tower, beacon derivations, time-lock sealing, seal T values |
| `src/server/` | Hono server, SQLite (better-sqlite3 + Drizzle), `openRite()`/`closeRite()`, beacon client, ledger export, CLI |
| `src/pages/`, `src/scripts/` | Astro static pages and their small vanilla-TS islands |
| `drizzle/` | Migrations, applied at startup |
| `solver/` | `rite-solver`, the Rust + GMP opener and benchmark |
| `test/` | Vitest |
| `deploy/` | Droplet build, systemd units, nginx config |

## Development

```sh
pnpm install
pnpm build && pnpm start          # http://127.0.0.1:8710, serving dist/
pnpm test                         # RUN_NETWORK_TESTS=1 also hits drand and NIST
(cd solver && cargo build --release)   # the solver round-trip tests run once it is built
```

For live reload, run `pnpm dev:server` and `pnpm dev` side by side (Astro
proxies `/api` to the server).

Simulating the Day (all refused when `NODE_ENV=production`):

```sh
# the opening ceremony, ten seconds out, with a clock that runs
FAKE_NOW=2026-10-09T09:59:50Z FAKE_NOW_RUNNING=1 BEACON=fake DB_PATH=/tmp/day.sqlite pnpm start
# the final page
FAKE_STATE=CCCCCCCCCCCC pnpm start
# several Days at once: every missed year is opened and closed in order
FAKE_NOW=2030-01-01T00:00:00Z BEACON=fake DB_PATH=/tmp/h.sqlite pnpm rite tick
```

`BEACON=fake` derives randomness from `sha256("fake-beacon:<round>")`, since
real drand rounds for a future Day don't exist yet.

## The jobs

`openRite()` and `closeRite()` run lazily: the first request after a window
boundary triggers the pending one, and the server also ticks every 5 seconds.
Each step is idempotent and guarded, so it happens exactly once. Rounds come
from the boundary timestamps, so a late job gives the same result, and a
server that was down for whole Days catches up year by year (the Rite never
skips a year). The same jobs are CLI commands:

```sh
pnpm rite status | open | close [year] | tick | commitments [year] | ledger <year> | export <year> | backup <dir>
# on the droplet, as the site user, from ~/current/app:
node build/server/cli.mjs status
```

If drand is unreachable, it is retried (with backoff) for an hour from the
first failure, then the NIST beacon pulse at the same timestamp is used, and
`years.beacon_source` records it.

## Every year, before the Day

1. `cd solver && cargo build --release && ./target/release/rite-solver bench` on a fast desktop CPU.
2. Add the year's row to `src/shared/seals.ts`.
3. Refresh `deploy/nginx/cloudflare-real-ip.conf` from <https://www.cloudflare.com/ips/> if it changed.
4. Ship, and check `/api/state` shows the right commitments.

## Deploying

The site is a server process ("kind 4" in droplet-infra's `NEW-SITE.md`):
`scripts/ship.sh` uploads the committed source, the droplet builds it with
`deploy/build`, and receive-site restarts `deploy/systemd/rite.service`
(Node on 127.0.0.1:8710). nginx proxies to it (`deploy/nginx/`). The
database lives in `/srv/sites/rite/data/`, outside releases, with backups
every 6 hours in `/srv/sites/rite/backups/`. Secrets go in
`/srv/sites/rite/rite.env`:

```sh
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET=...
LEDGER_REPO=dabaez/1010-ledger
LEDGER_TOKEN=...      # fine-grained, Contents: read and write on the ledger repo only
```

Without Turnstile keys, writes are not captcha-protected; without the ledger
settings, closed years are not exported (the server says so at startup).
