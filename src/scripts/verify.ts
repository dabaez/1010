// Re-checks a drand round from the visitor's own browser: fetches it from a
// drand relay (not from us), verifies the BLS signature against the League of
// Entropy's public key, and compares the randomness with what we published.

import { DRAND_CHAIN, DRAND_RELAYS } from '../shared/beacon';
import { fmt } from './api';

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
        throw new Error(`MISMATCH: drand dice ${beacon.randomness} para la ronda ${round}`);
      }
      return `Verificado en tu navegador: la ronda ${fmt(round)} está firmada por drand y coincide.`;
    } catch (e) {
      if (String((e as Error).message).startsWith('MISMATCH')) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error('ningún relay de drand respondió');
}
