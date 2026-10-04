// Ritual III's randomness. drand quicknet first, verified with drand-client;
// if drand stays unreachable for an hour, the NIST Randomness Beacon pulse at
// the same timestamp. Rounds and timestamps always come from the window
// boundaries, never from when the job happens to run.

import { createHash } from 'node:crypto';
import { HttpCachingChain, HttpChainClient, fetchBeacon } from 'drand-client';
import { DRAND_CHAIN, DRAND_RELAYS, drandRoundUrl } from '../shared/beacon';

export type BeaconSource = 'drand' | 'nist' | 'fake';

export interface BeaconReading {
  source: BeaconSource;
  /** drand round, or NIST pulse index */
  round: number;
  /** lowercase hex */
  randomness: string;
  /** ISO time of the round or pulse */
  time: string;
  /** where anyone can fetch the same value */
  url: string;
  /** what is needed to verify it: signature, chain, pulse fields */
  proof: Record<string, unknown>;
}

export interface Beacon {
  /** The verified drand round, or throws. */
  drand(round: number): Promise<BeaconReading>;
  /** The first NIST pulse at or after `targetMs`, or throws. */
  nist(targetMs: number): Promise<BeaconReading>;
}

const TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), TIMEOUT_MS).unref()),
  ]);
}

export function liveBeacon(): Beacon {
  const opts = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: { chainHash: DRAND_CHAIN.hash, publicKey: DRAND_CHAIN.publicKey },
  };
  const clients = DRAND_RELAYS.map(
    (relay) => [relay, new HttpChainClient(new HttpCachingChain(`${relay}/${DRAND_CHAIN.hash}`, opts), opts)] as const,
  );

  return {
    async drand(round) {
      const errors: string[] = [];
      for (const [relay, client] of clients) {
        try {
          // fetchBeacon checks the chain info against our pinned hash and
          // public key, and the BLS signature against the round.
          const b = await withTimeout(fetchBeacon(client, round), relay);
          if (b.round !== round) throw new Error(`asked for round ${round}, got ${b.round}`);
          return {
            source: 'drand',
            round,
            randomness: b.randomness.toLowerCase(),
            time: new Date((DRAND_CHAIN.genesis + (round - 1) * DRAND_CHAIN.period) * 1000).toISOString(),
            url: drandRoundUrl(round),
            proof: {
              chain_hash: DRAND_CHAIN.hash,
              public_key: DRAND_CHAIN.publicKey,
              scheme: DRAND_CHAIN.schemeID,
              round,
              signature: b.signature,
              randomness: b.randomness,
              relay,
            },
          };
        } catch (e) {
          errors.push(`${relay}: ${(e as Error).message}`);
        }
      }
      throw new Error(`drand round ${round} unavailable (${errors.join('; ')})`);
    },

    async nist(targetMs) {
      const url = `https://beacon.nist.gov/beacon/2.0/pulse/time/${targetMs}`;
      const res = await withTimeout(fetch(url, { headers: { accept: 'application/json' } }), 'NIST beacon');
      if (!res.ok) throw new Error(`NIST beacon: HTTP ${res.status}`);
      const { pulse } = (await res.json()) as { pulse: Record<string, unknown> };
      const time = Date.parse(String(pulse.timeStamp));
      if (!(time >= targetMs)) throw new Error(`NIST pulse ${pulse.timeStamp} is before the target`);
      const output = String(pulse.outputValue ?? '');
      if (!/^[0-9A-Fa-f]{128}$/.test(output)) throw new Error('NIST pulse has no 512-bit outputValue');
      return {
        source: 'nist',
        round: Number(pulse.pulseIndex),
        randomness: output.toLowerCase(),
        time: new Date(time).toISOString(),
        url: String(pulse.uri),
        proof: {
          uri: pulse.uri,
          chainIndex: pulse.chainIndex,
          pulseIndex: pulse.pulseIndex,
          timeStamp: pulse.timeStamp,
          outputValue: pulse.outputValue,
          signatureValue: pulse.signatureValue,
          certificateId: pulse.certificateId,
        },
      };
    },
  };
}

/**
 * Deterministic stand-in for development and tests: sha256("fake-beacon:<round>").
 * Its NIST fallback reports source 'nist' so the fallback path can be tested.
 */
export function fakeBeacon(opts: { failDrand?: () => boolean } = {}): Beacon {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  return {
    async drand(round) {
      if (opts.failDrand?.()) throw new Error('fake drand is down');
      return {
        source: 'fake',
        round,
        randomness: hash(`fake-beacon:${round}`),
        time: new Date((DRAND_CHAIN.genesis + (round - 1) * DRAND_CHAIN.period) * 1000).toISOString(),
        url: '',
        proof: { fake: true },
      };
    },
    async nist(targetMs) {
      return {
        source: 'nist',
        round: Math.floor(targetMs / 60000),
        randomness: hash(`fake-nist:${targetMs}`) + hash(`fake-nist-2:${targetMs}`),
        time: new Date(targetMs).toISOString(),
        url: '',
        proof: { fake: true, nist: true },
      };
    },
  };
}
