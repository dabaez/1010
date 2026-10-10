// Cloudflare Turnstile, loaded only on the Day and only when the server has a
// site key. Without one (development) a placeholder token is sent.

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id: string): void;
      remove(id: string): void;
    };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('no se pudo cargar el captcha'));
    document.head.append(s);
  });
  return loading;
}

export interface CaptchaWidget {
  /** resolves once the visitor has passed; each token is good for one write */
  token(): Promise<string>;
  reset(): void;
}

export async function mountCaptcha(container: HTMLElement, siteKey: string | null): Promise<CaptchaWidget> {
  if (!siteKey) {
    container.hidden = true;
    return { token: async () => 'no-captcha-configured', reset() {} };
  }
  await loadScript();
  let current: string | null = null;
  let waiters: ((t: string) => void)[] = [];
  // Invisible unless Cloudflare wants the visitor to click; the container
  // only takes up room (data-shown) once it does.
  const id = window.turnstile!.render(container, {
    sitekey: siteKey,
    theme: 'dark',
    language: 'es',
    appearance: 'interaction-only',
    'before-interactive-callback': () => {
      container.dataset.shown = '';
    },
    callback: (t: string) => {
      current = t;
      waiters.forEach((w) => w(t));
      waiters = [];
    },
    'expired-callback': () => {
      current = null;
    },
  });
  return {
    token: () => (current ? Promise.resolve(current) : new Promise((r) => waiters.push(r))),
    reset() {
      current = null;
      delete container.dataset.shown;
      window.turnstile!.reset(id);
    },
  };
}
