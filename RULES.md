# The Rules of the Annual Rite

These are the rules in plain words. They are the source of truth. The website
at <https://1010.b4ez.com> carries them out, and the ledger records what it
did each year, so that anyone can check its work or carry on without it.

## The Day

The Rite is held once a year, on **October 10** (10/10, which reads as 1010).
It is held for 50 hours, so that it is October 10 somewhere on Earth the whole
time:

- It **opens** at **10:00:00 UTC on October 9**, when October 10 begins in UTC+14.
- It **closes** at **12:00:00 UTC on October 11**, when October 10 ends in UTC−12.

The opening instant belongs to the Day; the closing instant does not. The dates
are the same every year. There is no leap-year rule. The first Day was in 2026.

The rest of the year nothing can be written: no votes, no entries.

## I. The Tower

There are 12 rings, numbered 1 (smallest) to 12 (largest), and three pegs: A,
B and C. On the first Day every ring was on A.

**The state** of the tower is written as 12 letters, one per ring from the
smallest to the largest, each giving the peg the ring sits on. The start is
`AAAAAAAAAAAA`. The order of rings on a peg follows from the rule below, so the
12 letters say everything.

**A move** takes the top (smallest) ring from one peg and puts it on another
peg, which must be empty or have a larger top ring. A move is named
`from→to`, for example `A→C`. Each position has exactly 3 legal moves, or 2
when all rings are on one peg.

**Each Day exactly one move is made.** Anyone may vote once for one of the
legal moves. Votes are kept hidden until the close. At the close:

1. The move with the most votes is made.
2. **A tie** between moves with the most votes is broken by the tie-break
   number (see III): list the tied moves in alphabetical order of their names
   (`A→B`, `A→C`, `B→A`, `B→C`, `C→A`, `C→B`), and take the one at position
   *number mod (how many are tied)*, counting from 0.
3. **No votes at all:** the same rule picks among *all* the legal moves.

The Rite never skips a year. If nobody could vote that year, rule 3 applies.

**The end of programming.** When all 12 rings are on **C**, the tower is
complete and programming is over. No more Days are held. All rings on B does
not count; the prophecy is specific. Played perfectly the tower takes
2^12 − 1 = 4,095 moves, one per year, so the earliest possible end is the
Day of 6121. The crowd will not play perfectly.

## II. The Sealed Guestbook

On the Day, each person may leave one message of up to 1,000 characters
(Unicode code points), sealed in an RSW time-lock puzzle (Rivest, Shamir,
Wagner, 1996). The message is sealed in the writer's browser; only the sealed
form ever leaves it. Nobody, including the keepers of the site, can read an
entry without opening its seal, so entries cannot be moderated.

An entry is `N`, `T`, `iv` and `ciphertext`:

- `N` is a 2048-bit RSA modulus, the product of two primes that only the
  writer's browser ever knew. Written in lowercase hexadecimal.
- `T` is a number of squarings, written in decimal.
- To open: start with x = 2 and replace x by x² mod N, T times in a row. Call
  the result b. (b = 2^(2^T) mod N.)
- The key K is the SHA-256 hash of b written as big-endian bytes, left-padded
  with zero bytes to the byte length of N (256 bytes for a 2048-bit N).
- The message is the AES-256-GCM decryption of `ciphertext` (base64, with the
  16-byte tag at the end) under K with the 12-byte `iv` (base64) and no
  additional data. It is UTF-8.

The writer chooses a seal, and the seal sets T:

| Seal    | Target: time to open on a fast desktop CPU that year |
| ------- | ---------------------------------------------------- |
| Short   | 1 year                                               |
| Decade  | 10 years                                             |
| Century | 100 years                                            |

T is the number of 2048-bit modular squarings per second that a fast desktop
CPU does with GMP, measured before each Day, times the target time. Each
year's ledger records the measurement and the T values used. Seals fall early
as computers get faster, and a large enough quantum computer would open all of
them at once by factoring N. That is part of the charm.

`rite-solver`, in `solver/`, opens entries. It checkpoints its progress to
disk, so the squaring can be paused and resumed for years.

## III. The Number and the Bit

Each Day has a **Number of the year** and a **Bit of the year**, taken from the
public randomness beacon **drand** (the League of Entropy's *quicknet* chain,
hash `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`,
genesis 1692803367, period 3 seconds). Its rounds are threshold-signed and
anyone can verify them.

The round that decides each value is fixed in advance: it is the first round
at or after a moment, round = floor((t − genesis) / period) + 1, where t is
the moment in seconds since 1970. The Day's boundaries fall exactly on rounds.

| Value              | Round                                | Derived as                                                        |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| Number of the year | the round at the opening of the Day  | the first 8 bytes of the round's randomness, as an unsigned 64-bit big-endian integer |
| Bit of the year    | the same round                       | the lowest bit of the last byte of the randomness                 |
| Tie-break number   | the round at the close of the Day    | the same derivation as the Number                                 |

The tie-break uses the later round on purpose, so that nobody can know it while
voting is open.

**Fallback.** If drand cannot be reached, it is retried for one hour. After
that the NIST Randomness Beacon (version 2.0) pulse at the same moment is used
instead (the first pulse at or after it), with its `outputValue` in place of
drand's randomness, and the ledger records which source was used.

## Privacy and fairness

There are no accounts. Each vote and each entry passes a CAPTCHA. "One per
person" is enforced with a hash: HMAC-SHA256 of the visitor's network prefix
(the /24 of an IPv4 address, the /64 of an IPv6 address) and browser user
agent, under a secret made when the Day opens and destroyed when it closes.
At the close the hashes are deleted as well; only the tally is kept. People
sharing a network and a browser count as one person. It is a ritual, not an
election.

## The ledger

After each close, the whole year is written to `ledger/YYYY.json` in a public
Git repository, together with these rules and the solver. It holds the
window, the beacon rounds with their randomness and signatures, the Number and
the Bit, the tower move with its tally and how it was decided, the T values
with their benchmark, and every sealed entry. Only plain formats are used:
JSON, UTF-8, hexadecimal, base64.

The tower can be rebuilt from the ledger alone: start from `AAAAAAAAAAAA` and
apply each year's `move`. Each year's `state_before` must equal the previous
year's `state_after`.

## Succession

The website will not last 4,095 years; the Rite can.

**If the site is dark on the Day, whoever holds the newest ledger may perform
the Rite by these same rules and publish the result.** That means: take the
state after the newest move, open voting for the 50-hour window (or, if no
voting was possible, use the no-votes rule), draw the Number, the Bit and the
tie-break from the rounds these rules name, make exactly one move, and publish
a ledger entry for the year in the same format. When several successors
publish different results for the same year, the one whose result follows
these rules from the previous ledger stands; if more than one does, the
earliest published stands.

If drand itself is gone, successors should choose a public, verifiable
randomness beacon, announce the choice a full year before it is used, and
record it in the ledger.
