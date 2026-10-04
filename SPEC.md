# The Annual Rite — Spec

Oct 3, 2026 · @Baez

## Concept

A website that opens for one day a year and hosts three computing rituals; the rest of the year it is a sealed shrine with a countdown and the archive.

- **The Tower.** A 12-ring Tower of Hanoi. Each open day, visitors vote and exactly one move is made. When the tower is complete, programming is over. The optimal solution is 2^12 − 1 = 4,095 moves, so the earliest possible end of programming is the year 6121.
- **The Sealed Guestbook.** Messages locked in time-lock puzzles: anyone can open them, but only by doing years of computation that cannot be parallelized. Deliberately not quantum-safe: a large enough quantum computer opens them instantly.
- **The Number and the Bit.** A publicly verifiable random number of the year, and a random bit of the year (0 or 1).

This spec is written to be handed to Claude Code. The decisions made so far are collected at the end.

## The Day

The Day is **October 10**: 10/10, which reads as 1010. Same date every year, no leap-year logic.

**Window: 50 hours, Anywhere on Earth.** Opens when October 10 begins in UTC+14 (10:00 UTC on October 9) and closes when it ends in UTC−12 (12:00 UTC on October 11). Somewhere on Earth it is October 10 the whole time.

**The other 364 days.** The site is read-only:

- A countdown to the next opening (to the second, in UTC).
- The tower in its current state, plus the full move history.fsdaf
- The archive: every year's number, bit, sealed guestbook puzzles, and vote tallies.
- All write endpoints return HTTP 423 Locked.

**Clock.** The server's clock is the only authority. The "is it the Day?" check lives in one function, `isRitualOpen(now)`, and `now` comes from a single `getNow()` that can be overridden by a `FAKE_NOW` environment variable in development so the day can be simulated.

## Ritual I: The Tower

One move per year, chosen by vote. Your math is right: 12 rings need at least 4,095 moves, so 4,095 years if the crowd plays perfectly.

**Setup.** Three pegs, A, B, C. All 12 rings start on A. The tower is complete when all 12 rings are on C. Moving everything to B does not count; the prophecy is specific.

**State.** A 12-character string, one character per ring from smallest to largest, holding the peg it sits on. Start: `AAAAAAAAAAAA`. This is compact, human-readable, and fully determines the position.

**Legal moves.** In any position there are exactly 3 legal moves, except when two pegs are empty (such as the start), where there are 2. The smallest ring can always go to either other peg; the third move is the only legal move between the other two pegs. The server computes them; the ballot only ever shows legal moves.

**Voting.**

- One vote per person per year (see Abuse, identity, and fairness).
- Votes are hidden until the window closes, so the result is a surprise and late voters cannot pile on.
- At close, the move with the most votes is applied.
- **Tie:** broken by the random number drawn at close (see Ritual III), modulo the number of tied moves, with ties ordered alphabetically by move name (`A→B`, `A→C`, …).
- **No votes at all:** the random number picks among all legal moves. The ritual never skips a year.

**The crowd will not play optimally.** There are 3^12 = 531,441 positions, and a crowd can undo its own moves. Show this honestly on the page: "Moves made: 37. Optimal moves remaining: 4,061." The distance-to-goal for any position is cheap to compute with the standard recursive algorithm. The ballot never says which legal move is optimal; the crowd is on its own.tod

**End of programming.** When the state becomes `CCCCCCCCCCCC`, the site permanently switches to a final page. Write it now, ship it now, test it with `FAKE_STATE`.

## Ritual II: The Sealed Guestbook

Each entry is sealed in an **RSW time-lock puzzle** (Rivest, Shamir, Wagner, 1996). Opening it requires T modular squarings done one after another; more computers do not help, only faster ones. It is exactly "breakable, but it takes a long time", and it rests on RSA-style factoring, so it is not quantum-safe: Shor's algorithm factors N and opens it instantly.

There is real precedent: Rivest's LCS35 puzzle (1999) was designed to take 35 years and was solved in 2019, once on an ordinary CPU over about 3.5 years and once with an FPGA in about two months. Expect your seals to fall early too; that is part of the charm.

**Sealing happens in the browser, so the server never sees plaintext.**

1. Generate an RSA-2048 key with WebCrypto, export it as JWK, and read the primes p and q from it.
2. Compute N = p × q and φ = (p − 1)(q − 1).
3. Look up T for the seal the writer chose (table below).
4. Shortcut that only the sealer can take: e = 2^T mod φ, then b = 2^e mod N. Use JavaScript BigInt with a square-and-multiply modpow.
5. Key K = SHA-256 of b as big-endian bytes. Encrypt the message with AES-256-GCM under K with a random 12-byte IV.
6. POST `{N, T, iv, ciphertext}`. Drop p, q, φ, and K from memory.

**Opening** (anyone, anytime): compute b = 2^(2^T) mod N by squaring 2 repeatedly T times, hash it, decrypt.

**Seal lengths.** The writer picks one. T is set by benchmarking 2048-bit modular squaring on a fast desktop CPU with GMP, then multiplying by the target time. Re-benchmark yearly and publish T with each year's archive.

| Seal | Target time on a fast CPU today |
| --- | --- |
| Short | 1 year |
| Decade | 10 years |
| Century | 100 years |

**Ship a solver.** A small open-source CLI in the repo (Rust or Python with gmpy2) that takes an entry ID, squares, checkpoints progress to disk so it can resume, and decrypts. Starting a solver should itself feel like a ritual.

**Limits.** Max 1,000 UTF-8 characters per entry; one entry per person per year. Entries cannot be moderated because nobody can read them, so say so on the page.

## Ritual III: The Number and the Bit

Use a **public randomness beacon** so the number is provably random and provably not chosen by you. Default: **drand**, run by the League of Entropy, whose rounds are threshold-signed and verifiable by anyone.

**Commit in advance.** The archive page publishes, a year ahead, the exact drand round that will decide each value. Round number = floor((t − genesis) / period) + 1, with genesis and period read from the chain's `/info` endpoint.

| Value | Decided by | Derived as |
| --- | --- | --- |
| Number of the year | First round at or after the window opens | First 8 bytes of the round's randomness as an unsigned 64-bit integer |
| Bit of the year | Same round | Lowest bit of the last byte |
| Tower tie-break | First round at or after window close | Same derivation as the number, taken modulo the number of tied moves |

The tie-break uses a later round on purpose: if it were known during voting, people could game it.

The page shows the round number, the raw randomness, the derivation, and a link to verify it. Revealing the Number and the Bit the moment the window opens, with a live countdown, is the opening ceremony. Show the Number in decimal and hex.

**Fallback.** If drand is unreachable at reveal time, retry for one hour, then fall back to the NIST Randomness Beacon pulse at the same timestamp, and record which source was used.

## Stack and architecture

Plain TypeScript: one web server process and one SQLite file. Nothing here assumes a host, so it deploys however you deploy.

&#91;embedded content: architecture · one server, two jobs, three stores\]

The browser does all the sealing, so the server only ever stores ciphertext. Opening and closing are two plain functions, `openRite()` and `closeRite()`. They run lazily: the first request after a window boundary triggers the pending job, guarded so it runs exactly once. Each is also a CLI command, so an external scheduler can call them on time if you have one. Beacon rounds come from the boundary timestamps, not the moment the job runs, so a late job gives the same result.

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js 22+, TypeScript | Boring, portable |
| Server | Hono | Small, typed, runs on any runtime |
| Frontend | Astro, static output, small vanilla-TS islands | Mostly static pages; no SPA needed |
| Database | SQLite via better-sqlite3, Drizzle for schema and migrations | One file, ample for one day of votes |
| Jobs | `openRite()` / `closeRite()`, lazy plus CLI | No scheduler required |
| Bot defense | Turnstile or hCaptcha | Free, works on any host |
| Browser crypto | WebCrypto + BigInt | RSA keygen, AES-GCM, modpow, no dependencies |
| Randomness | drand HTTP API + its verification client | Publicly verifiable |
| Tests | Vitest | Fast, TypeScript-native |
| Solver | Rust with GMP bindings (or Python + gmpy2) | Fast sequential squaring |
| Ledger | GitHub repo, written via REST API | Public, forkable, durable |

## Data model

Five SQLite tables. Everything except live votes is append-only; nothing is ever updated after a year closes.

| Table | Key columns | Notes |
| --- | --- | --- |
| `years` | `year` PK, `opened_at`, `closed_at`, `number_round`, `number_u64`, `bit`, `tiebreak_round`, `beacon_source` | One row per Day. |
| `tower_moves` | `year` PK, `state_before`, `move` (e.g. `A→C`), `state_after`, `tally_json`, `decided_by` (`votes`, `tiebreak`, `no_votes`) | Current tower state = `state_after` of the latest row. |
| `votes` | `year`, `voter_hash`, `move`, `created_at`; unique (`year`, `voter_hash`) | Hidden until close. |
| `guestbook` | `id` PK, `year`, `seal`, `n_hex`, `t`, `iv_b64`, `ciphertext_b64`, `created_at` | Never contains plaintext. |
| `voters_guestbook` | `year`, `voter_hash`; unique pair | Enforces one entry per person without linking hash to entry. |

After each close, the server also exports the whole year as `ledger/YYYY.json` to a public Git repository (see Longevity).

## Abuse, identity, and fairness

One move a year makes a single vote valuable, so someone will try to stuff the ballot. Default: no accounts, moderate friction.

- **A CAPTCHA (Turnstile or hCaptcha)** on every write (vote, guestbook entry).
- **voter\_hash** = HMAC-SHA256(yearly secret, IP prefix + user agent), using the /24 for IPv4 and the /64 for IPv6. The yearly secret is generated when the Day opens and deleted at close, so hashes cannot be linked across years or reversed afterwards.
- **Rate limits** per IP prefix on all endpoints, in server middleware.
- **Optional stronger mode:** "Sign in with GitHub" to vote, one vote per GitHub account older than 30 days. Thematically fitting, much harder to stuff, but excludes people without GitHub. Not in v1; revisit only if ballot stuffing becomes a real problem.

Shared IPs (offices, universities, carrier NAT) will collide under the default. Accept it; it is a ritual, not an election.

## Longevity: surviving 4,095 years

The website will not last 4,095 years; the ritual can, if its state and rules are public and boring to resume.

- **The ledger is the source of truth.** A public Git repo holds `RULES.md` (this spec's rules in plain words), `ledger/YYYY.json` per year, and the solver. Anyone can rebuild the tower state from the ledger alone.
- **Plain formats only:** JSON, UTF-8, hex. No binary blobs, no proprietary exports.
- **A succession clause** in `RULES.md`: if the site is dark on the Day, whoever holds the newest ledger may perform the move by the same rules and publish it.

## Build plan for Claude Code

Hand Claude Code this doc (export it as Markdown into the repo as `SPEC.md`) and work through these milestones one at a time, each ending with passing tests.

1. **Skeleton.** Server + static assets, `getNow()` with `FAKE_NOW`, `isRitualOpen()`, countdown page, 423 on writes outside the Day. Tests for the 50-hour window boundaries (October 9 10:00 UTC to October 11 12:00 UTC).
2. **Tower core (pure TypeScript, no I/O).** State string, legal moves, apply move, optimal distance-to-goal, optimal next move. Property tests: optimal solve from start is exactly 4,095 moves; legal-move count is always 2 or 3.
3. **Tower voting.** Vote endpoint, SQLite schema, hidden tallies, close-time tally, tie-break and no-vote rules. Simulate a full Day with `FAKE_NOW`.
4. **Beacon.** drand client with signature verification, round-number math, NIST fallback, reveal at open, tie-break at close.
5. **Sealed guestbook.** Browser sealing (WebCrypto + BigInt), storage, archive view. A test that seals with a tiny T (say 1,000) and opens with the solver, proving round-trip.
6. **Solver CLI** with checkpoint/resume, plus the squaring benchmark that sets T.
7. **Abuse layer.** Turnstile, voter\_hash with yearly secret, rate limits.
8. **Open and close jobs + ledger export** to the public repo.
9. **Look and feel.** Shrine, countdown, opening ceremony, the end-of-programming page.
10. **Dress rehearsal.** A full fake Day in staging, then go live before October 10.

## Decisions

| Question | Decision |
| --- | --- |
| Day | October 10 (10/10, 1010) |
| Window | 50 hours, Anywhere on Earth |
| Number of the year | Full unsigned 64-bit |
| Optimal move on the ballot | Never shown |
| Voting identity | Default: Turnstile + voter\_hash, no accounts |
| Home | 1010.b4ez.com |
