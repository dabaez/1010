// Talking to the server, and keeping time by its clock rather than ours.

export type Phase = 'sealed' | 'open' | 'closing' | 'over';

export interface NumberView {
  decimal: string;
  hex: string;
}

export interface StateResponse {
  serverNow: string;
  phase: Phase;
  window: { year: number; opensAt: string; closesAt: string };
  commitments: { year: number; opensAt: string; closesAt: string; numberRound: number; tiebreakRound: number };
  tower: {
    state: string;
    movesMade: number;
    optimalRemaining: number;
    optimalTotal: number;
    complete: boolean;
    ballot: string[];
  };
  year: {
    year: number;
    number: NumberView | null;
    bit: 0 | 1 | null;
    source: string | null;
    round: number;
    randomness: string | null;
    guestbookCount: number;
    closed: boolean;
  } | null;
  you: { vote: string | null; signed: boolean } | null;
  captcha: { provider: 'turnstile'; siteKey: string } | null;
  seals: Record<'short' | 'decade' | 'century', { t: string; years: number }>;
  sealBenchmark: { cpu: string; squaringsPerSecond: number; tool: string; date: string };
}

let offset = 0;

/** ms since the epoch by the server's clock (estimated from the last response). */
export function serverNow(): number {
  return Date.now() + offset;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchState(): Promise<StateResponse> {
  const t0 = Date.now();
  const s = await getJson<StateResponse>('/api/state');
  const t1 = Date.now();
  offset = Date.parse(s.serverNow) - (t0 + t1) / 2;
  return s;
}

export async function postJson(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, data };
}

// Spanish groups thousands with dots; 'always' makes 4095 read 4.095 too.
// (TypeScript's lib types useGrouping as boolean only.)
const numbers = new Intl.NumberFormat('es', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
export const fmt = (n: number | bigint | string) => numbers.format(BigInt(n));

export function splitDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function utc(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' UTC';
}

/** A rough human duration for T squarings at the published rate. */
export function humanYears(years: number): string {
  return years === 1 ? 'cerca de un año' : `cerca de ${years} años`;
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el as HTMLElement;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
