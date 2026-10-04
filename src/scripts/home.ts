// The shrine page: countdown by the server's clock, the opening ceremony,
// the ballot, and sealing guestbook entries in the browser.

import { drandRoundUrl, u64Hex } from '../shared/beacon';
import { MAX_MESSAGE_CHARS, messageLength, seal, type SealStep } from '../shared/timelock';
import { applyMove, parseMove } from '../shared/tower';
import { $, el, fetchState, fmt, pad, postJson, serverNow, splitDuration, utc, type StateResponse } from './api';
import { mountCaptcha, type CaptchaWidget } from './captcha';
import { drawTower } from './tower-draw';
import { verifyDrandInBrowser } from './verify';

let state: StateResponse | null = null;
let selectedMove: string | null = null;
let voteCaptcha: Promise<CaptchaWidget> | null = null;
let gbCaptcha: Promise<CaptchaWidget> | null = null;
let shownNumber: string | null = null;
let rolling: number | null = null;
let refreshing = false;
let lastBoundaryRefresh = 0;

export function mountHome(): void {
  void refresh();
  setInterval(tickClock, 250);
  setInterval(() => void refresh(), 30_000);
  wireBallot();
  wireGuestbook();
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await fetchState();
    render();
  } catch {
    $('#hero-sub').textContent = 'The shrine is silent for a moment. Trying again…';
    setTimeout(() => void refresh(), 5_000);
  } finally {
    refreshing = false;
  }
  // Watch closely while something is about to happen.
  if (state && ((state.phase === 'open' && !state.year?.number) || state.phase === 'closing')) {
    setTimeout(() => void refresh(), 1_500);
  }
}

// ------------------------------------------------------------------ clock

function countdownTarget(s: StateResponse): number | null {
  if (s.phase === 'sealed') return Date.parse(s.window.opensAt);
  if (s.phase === 'open') return Date.parse(s.window.closesAt);
  return null;
}

function tickClock(): void {
  if (!state) return;
  const target = countdownTarget(state);
  const remaining = target === null ? 0 : target - serverNow();
  const { d, h, m, s } = splitDuration(remaining);
  const set = (u: string, v: string) => {
    const e = document.querySelector<HTMLElement>(`#countdown [data-u="${u}"]`);
    if (e && e.textContent !== v) e.textContent = v;
  };
  set('d', pad(d));
  set('h', pad(h));
  set('m', pad(m));
  set('s', pad(s));
  // A boundary has passed by the server's clock: ask the server, which opens
  // or closes the Rite on that very request.
  if (target !== null && remaining <= 0 && Date.now() - lastBoundaryRefresh > 1_000) {
    lastBoundaryRefresh = Date.now();
    void refresh();
  }
}

// ------------------------------------------------------------------ render

function render(): void {
  const s = state!;
  document.querySelectorAll('[data-year]').forEach((e) => (e.textContent = String(s.window.year)));
  renderHero(s);
  renderTower(s);
  renderGuestbook(s);
  renderNumber(s);
  tickClock();
}

function renderHero(s: StateResponse): void {
  const hero = $('#hero');
  hero.dataset.phase = s.phase;
  const eyebrow = $('#hero-eyebrow');
  const title = $('#hero-title');
  const sub = $('#hero-sub');
  const ceremony = $('#ceremony');
  const countdown = $('#countdown');
  const thisYear = s.year && s.year.year === s.window.year ? s.year : null;

  if (s.phase === 'sealed') {
    eyebrow.textContent = `The Day of ${s.window.year}`;
    title.textContent = 'The shrine is sealed.';
    sub.innerHTML = '';
    sub.append(
      'Until it opens on ',
      el('strong', {}, utc(s.window.opensAt)),
      ', when October 10 begins in UTC+14.',
    );
    ceremony.hidden = true;
    countdown.hidden = false;
  } else if (s.phase === 'open') {
    eyebrow.textContent = `The Day of ${s.window.year} · open`;
    title.textContent = 'The Rite is open.';
    sub.innerHTML = '';
    sub.append(
      'Left to vote and to sign. It closes on ',
      el('strong', {}, utc(s.window.closesAt)),
      ', when October 10 ends in UTC−12.',
    );
    ceremony.hidden = false;
    countdown.hidden = false;
    renderCeremony(thisYear);
  } else if (s.phase === 'closing') {
    eyebrow.textContent = `The Day of ${s.year?.year ?? ''} · closed`;
    title.textContent = 'The Rite has closed.';
    sub.textContent = 'The votes are being counted and the move is being made…';
    ceremony.hidden = !s.year?.number;
    countdown.hidden = true;
    renderCeremony(s.year);
  } else {
    // The server serves the final page at / once the tower is complete.
    location.reload();
  }
}

function renderCeremony(y: StateResponse['year']): void {
  const dec = $('#number-dec');
  const hex = $('#number-hex');
  const bit = $('#bit');
  const source = $('#ceremony-source');
  if (!y) return;
  if (!y.number) {
    // The draw: digits churn until the round arrives.
    dec.classList.add('drawing');
    hex.textContent = '0x················';
    bit.textContent = '·';
    source.textContent = `Drawing from drand round ${fmt(y.round)}…`;
    if (rolling === null) {
      rolling = window.setInterval(() => {
        let digits = '';
        for (let i = 0; i < 20; i++) digits += Math.floor(Math.random() * 10);
        dec.textContent = BigInt(digits).toLocaleString('en-US');
      }, 70);
    }
    return;
  }
  const value = y.number.decimal;
  const fresh = shownNumber === null && rolling !== null;
  if (rolling !== null) {
    clearInterval(rolling);
    rolling = null;
  }
  if (shownNumber !== value) {
    shownNumber = value;
    dec.classList.remove('drawing');
    if (fresh) settleDigits(dec, fmt(value));
    else dec.textContent = fmt(value);
  }
  hex.textContent = y.number.hex;
  bit.textContent = String(y.bit);
  source.innerHTML = '';
  source.append(
    y.source === 'drand' ? 'From drand round ' : y.source === 'nist' ? 'From the NIST beacon (drand was unreachable), committed round ' : 'From round ',
    el('a', { href: drandRoundUrl(y.round) }, fmt(y.round)),
    '.',
  );
}

/** The opening ceremony's reveal: digits settle left to right. */
function settleDigits(target: HTMLElement, final: string): void {
  const chars = [...final];
  let settled = 0;
  const timer = setInterval(() => {
    settled++;
    target.textContent = chars
      .map((c, i) => (i < settled || !/\d/.test(c) ? c : String(Math.floor(Math.random() * 10))))
      .join('');
    if (settled >= chars.length) clearInterval(timer);
  }, 90);
}

function renderTower(s: StateResponse): void {
  const svg = document.querySelector<SVGSVGElement>('#tower-svg')!;
  const preview = selectedMove ? applyMove(s.tower.state, parseMove(selectedMove)!) : null;
  drawTower(svg, s.tower.state, { preview });
  $('#moves-made').textContent = fmt(s.tower.movesMade);
  $('#optimal-remaining').textContent = fmt(s.tower.optimalRemaining);

  const ballot = $('#ballot');
  ballot.hidden = s.phase !== 'open';
  if (s.phase !== 'open') return;

  const moves = $('#moves');
  const voted = s.you?.vote ?? null;
  if (moves.dataset.for !== s.tower.ballot.join() + voted) {
    moves.dataset.for = s.tower.ballot.join() + voted;
    moves.replaceChildren(
      ...s.tower.ballot.map((m) => {
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(m === (voted ?? selectedMove)) }, m);
        b.disabled = !!voted;
        b.addEventListener('click', () => {
          selectedMove = m;
          moves.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x.textContent === m)));
          ($('#vote-button') as HTMLButtonElement).disabled = false;
          renderTower(state!);
        });
        return b;
      }),
    );
  }
  const button = $('#vote-button') as HTMLButtonElement;
  const status = $('#vote-status');
  if (voted) {
    button.hidden = true;
    status.className = 'status success';
    status.textContent = `Your vote, ${voted}, is sealed until the close.`;
  } else {
    button.disabled = !selectedMove;
    voteCaptcha ??= mountCaptcha($('#vote-captcha'), s.captcha?.siteKey ?? null);
  }
}

function wireBallot(): void {
  const button = $('#vote-button') as HTMLButtonElement;
  const status = $('#vote-status');
  button.addEventListener('click', async () => {
    if (!selectedMove || !voteCaptcha) return;
    button.disabled = true;
    status.className = 'status dim';
    status.textContent = 'Waiting for the captcha…';
    try {
      const captcha = await voteCaptcha;
      const token = await captcha.token();
      status.textContent = 'Casting…';
      const r = await postJson('/api/vote', { move: selectedMove, captcha: token });
      captcha.reset();
      if (r.status === 200) {
        selectedMove = null;
        await refresh();
      } else {
        status.className = 'status error';
        status.textContent = r.data?.error ?? `Something went wrong (HTTP ${r.status}).`;
        button.disabled = false;
        if (r.status === 409 || r.status === 423) await refresh();
      }
    } catch (e) {
      status.className = 'status error';
      status.textContent = (e as Error).message;
      button.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ guestbook

function renderGuestbook(s: StateResponse): void {
  const count = s.year && s.year.year === s.window.year ? s.year.guestbookCount : 0;
  $('#gb-count').textContent = fmt(count);
  $('#gb-count-label').textContent = count === 1 ? 'entry' : 'entries';
  const open = s.phase === 'open';
  $('#gb-closed').hidden = open;
  const form = $('#gb-form');
  form.hidden = !open;
  if (!open) return;
  for (const [k, v] of Object.entries(s.seals)) {
    const code = document.querySelector(`[data-t="${k}"]`);
    if (code) code.textContent = `T = ${fmt(v.t)}`;
  }
  $('#gb-bench').textContent = `T is ${fmt(s.sealBenchmark.squaringsPerSecond)} squarings per second (${s.sealBenchmark.cpu}, ${s.sealBenchmark.date}) times the target time.`;
  const button = $('#gb-button') as HTMLButtonElement;
  const status = $('#gb-status');
  if (s.you?.signed && !status.dataset.sealedId) {
    button.hidden = true;
    ($('#gb-text') as HTMLTextAreaElement).disabled = true;
    status.className = 'status success';
    status.textContent = 'You have sealed your entry for this year.';
  } else if (!s.you?.signed) {
    gbCaptcha ??= mountCaptcha($('#gb-captcha'), s.captcha?.siteKey ?? null);
  }
}

const STEP_TEXT: Record<SealStep | 'send', string> = {
  keygen: 'Forging a 2048-bit modulus N from two fresh primes',
  shortcut: 'Taking the shortcut only the sealer has: 2^(2^T) mod N, through φ(N)',
  encrypt: 'Encrypting with AES-256-GCM under SHA-256 of the result',
  send: 'Sending N, T and the ciphertext; the primes are forgotten',
};

function wireGuestbook(): void {
  const form = $('#gb-form') as HTMLFormElement;
  const text = $('#gb-text') as HTMLTextAreaElement;
  const chars = $('#gb-chars');
  const counter = chars.parentElement!;
  const button = $('#gb-button') as HTMLButtonElement;
  const status = $('#gb-status');
  const steps = $('#gb-steps');

  text.addEventListener('input', () => {
    const n = messageLength(text.value);
    chars.textContent = fmt(n);
    counter.classList.toggle('over', n > MAX_MESSAGE_CHARS);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state || !gbCaptcha) return;
    const message = text.value;
    const n = messageLength(message);
    if (n === 0 || n > MAX_MESSAGE_CHARS) {
      status.className = 'status error';
      status.textContent = n === 0 ? 'Write something first.' : `That is ${fmt(n)} characters; the limit is 1,000.`;
      return;
    }
    const sealName = (form.querySelector('input[name="seal"]:checked') as HTMLInputElement).value as keyof StateResponse['seals'];
    const t = state.seals[sealName].t;
    button.disabled = true;
    text.disabled = true;
    status.className = 'status dim';
    status.textContent = '';
    steps.hidden = false;
    steps.replaceChildren(...(['keygen', 'shortcut', 'encrypt', 'send'] as const).map((k) => el('li', { 'data-step': k }, STEP_TEXT[k])));
    const mark = (k: string) => {
      let passed = true;
      steps.querySelectorAll('li').forEach((li) => {
        if (li.dataset.step === k) {
          passed = false;
          li.className = 'active';
        } else li.className = passed ? 'done' : '';
      });
    };
    try {
      const captcha = await gbCaptcha;
      const token = await captcha.token();
      // Give the browser a frame to paint each step.
      const sealed = await seal(message, BigInt(t), (k) => mark(k));
      mark('send');
      const r = await postJson('/api/guestbook', { seal: sealName, ...sealed, captcha: token });
      captcha.reset();
      if (r.status === 200) {
        steps.querySelectorAll('li').forEach((li) => (li.className = 'done'));
        text.value = '';
        chars.textContent = '0';
        status.dataset.sealedId = String(r.data.id);
        status.className = 'status success';
        status.innerHTML = '';
        status.append(
          `Sealed as entry #${r.data.id}. Opening it will take ${state.seals[sealName].years === 1 ? 'about a year' : `about ${state.seals[sealName].years} years`} of squaring on today's fastest desktop: `,
          el('code', {}, `rite-solver open ${r.data.id}`),
        );
        button.hidden = true;
        await refresh();
      } else {
        throw new Error(r.data?.error ?? `Something went wrong (HTTP ${r.status}).`);
      }
    } catch (err) {
      status.className = 'status error';
      status.textContent = (err as Error).message;
      button.disabled = false;
      text.disabled = false;
      steps.hidden = true;
    }
  });
}

// ------------------------------------------------------------------ number panel

function renderNumber(s: StateResponse): void {
  const box = $('#number-details');
  const y = s.year;
  const key = `${y?.year}:${y?.number?.decimal}:${s.commitments.year}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const parts: Node[] = [];
  if (y?.number && y.randomness) {
    const dl = el('dl');
    const row = (k: string, ...v: (Node | string)[]) => dl.append(el('dt', {}, k), el('dd', {}, ...v));
    row('Year', String(y.year));
    row('Number', el('span', { class: 'mono' }, fmt(y.number.decimal)));
    row('Hex', el('span', { class: 'mono' }, y.number.hex));
    row('Bit', el('span', { class: 'mono' }, String(y.bit)));
    row('Source', y.source === 'nist' ? 'NIST Randomness Beacon (fallback)' : y.source === 'drand' ? 'drand quicknet' : String(y.source));
    row('Round', el('a', { href: drandRoundUrl(y.round) }, fmt(y.round)));
    row('Randomness', el('span', { class: 'hex' }, y.randomness));
    row(
      'Derivation',
      'The first 8 bytes of the randomness as an unsigned 64-bit integer: ',
      el('span', { class: 'mono' }, `${y.randomness.slice(0, 16)} = ${u64Hex(BigInt(y.number.decimal))}`),
      '. The Bit is the lowest bit of the last byte, ',
      el('span', { class: 'mono' }, `0x${y.randomness.slice(-2)}`),
      '.',
    );
    parts.push(dl);
    if (y.source === 'drand') {
      const out = el('p', { class: 'small dim', 'aria-live': 'polite' });
      const btn = el('button', { type: 'button' }, 'Verify it in your browser');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.className = 'small dim';
        out.textContent = 'Asking drand directly and checking the signature…';
        try {
          out.textContent = await verifyDrandInBrowser(y.round, y.randomness!);
          out.className = 'small success';
        } catch (e) {
          out.textContent = `Could not verify: ${(e as Error).message}`;
          out.className = 'small error';
          btn.disabled = false;
        }
      });
      parts.push(el('p', {}, btn), out);
    }
  }
  const c = s.commitments;
  if (!y || y.year !== c.year) {
    parts.push(
      el(
        'p',
        {},
        `The Number and the Bit of ${c.year} will be decided by drand quicknet round `,
        el('a', { href: drandRoundUrl(c.numberRound) }, fmt(c.numberRound)),
        `, emitted the moment the Day opens (${utc(c.opensAt)}). A tower tie at the close is broken by round `,
        el('a', { href: drandRoundUrl(c.tiebreakRound) }, fmt(c.tiebreakRound)),
        ` (${utc(c.closesAt)}), which nobody can know while the votes are open.`,
      ),
    );
  }
  box.replaceChildren(...parts);
}
