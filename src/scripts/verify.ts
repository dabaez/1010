// Re-checks a drand round from the visitor's own browser: fetches it from a
// drand relay (not from us), verifies the BLS signature against the League of
// Entropy's public key, and compares the randomness with what we published.

import { DRAND_CHAIN, DRAND_RELAYS } from '../shared/beacon';

export async function verifyDrandInBrowser(round: number, expectedRandomness: string): Promise<string> {
  const { fetchBeacon, HttpCachingChain, HttpChainClient } = await import('drand-client');
  const opts = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: { chainHash: DRAND_CHAIN.hash, publicKey: DRAND_CHAIN.publicKey },
  };
  let lastError: unknown = null;
  for (const relay of DRAND_RELAYS) {
    try {
      const client = new HttpChainClient(new HttpCachingChain(`${relay}/${DRAND_CHAIN.hash}`, opts), opts);
      const beacon = await fetchBeacon(client, round);
      if (beacon.randomness.toLowerCase() !== expectedRandomness.toLowerCase()) {
        throw new Error(`MISMATCH: drand says ${beacon.randomness} for round ${round}`);
      }
      return `Verified in your browser via ${new URL(relay).host}: the BLS signature on round ${round.toLocaleString('en-US')} is valid, and its randomness matches.`;
    } catch (e) {
      if (String((e as Error).message).startsWith('MISMATCH')) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error('no drand relay answered');
}
