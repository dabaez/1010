// Cloudflare Turnstile on every write. With no keys configured (development)
// every token passes and the server says so at startup.

export interface Captcha {
  siteKey: string | null;
  verify(token: unknown, ip: string): Promise<boolean>;
}

export function turnstile(cfg: { siteKey: string; secret: string } | null): Captcha {
  if (!cfg) return { siteKey: null, verify: async () => true };
  return {
    siteKey: cfg.siteKey,
    async verify(token, ip) {
      if (typeof token !== 'string' || !token || token.length > 2048) return false;
      try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          body: new URLSearchParams({ secret: cfg.secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await res.json()) as { success?: boolean };
        return data.success === true;
      } catch {
        return false;
      }
    },
  };
}
