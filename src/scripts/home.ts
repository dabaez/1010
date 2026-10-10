// The shrine page: countdown by the server's clock, the opening ceremony,
// the ballot and the guestbook form (shared with their own pages), and the
// Number.

import { drandRoundUrl } from '../shared/beacon';
import { applyMove, parseMove } from '../shared/tower';
import { $, el, fetchState, fmt, pad, serverNow, splitDuration, utc, type StateResponse } from './api';
import { createBallot, type Ballot } from './ballot';
import { createGuestbookForm, type GuestbookForm } from './gb-form';
import { drawTower } from './tower-draw';
import { verifyDrandInBrowser } from './verify';

let state: StateResponse | null = null;
let ballot: Ballot;
let gbForm: GuestbookForm;
let shownNumber: string | null = null;
let rolling: number | null = null;
let refreshing = false;
let lastBoundaryRefresh = 0;

export function mountHome(): void {
  ballot = createBallot({ refresh, onSelect: () => state && renderTower(state) });
  gbForm = createGuestbookForm(refresh);
  void refresh();
  setInterval(tickClock, 250);
  setInterval(() => void refresh(), 30_000);
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await fetchState();
    render();
  } catch {
    $('#hero-sub').textContent = 'El templo guarda silencio un momento. Reintentando…';
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
    eyebrow.textContent = `El Día de ${s.window.year}`;
    title.textContent = 'El templo está sellado.';
    sub.innerHTML = '';
    sub.append('Abre el ', el('strong', {}, utc(s.window.opensAt)), '.');
    ceremony.hidden = true;
    countdown.hidden = false;
  } else if (s.phase === 'open') {
    eyebrow.textContent = `El Día de ${s.window.year} · abierto`;
    title.textContent = 'El Rito está abierto.';
    sub.innerHTML = '';
    sub.append('Cierra el ', el('strong', {}, utc(s.window.closesAt)), '.');
    ceremony.hidden = false;
    countdown.hidden = false;
    renderCeremony(thisYear);
  } else if (s.phase === 'closing') {
    eyebrow.textContent = `El Día de ${s.year?.year ?? ''} · cerrado`;
    title.textContent = 'El Rito ha cerrado.';
    sub.textContent = 'Se están contando los votos y haciendo el movimiento…';
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
    source.textContent = `Sacando de la ronda ${fmt(y.round)} de drand…`;
    if (rolling === null) {
      rolling = window.setInterval(() => {
        let digits = '';
        for (let i = 0; i < 20; i++) digits += Math.floor(Math.random() * 10);
        dec.textContent = fmt(digits);
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
    y.source === 'drand' ? 'De la ronda de drand ' : y.source === 'nist' ? 'De la baliza del NIST (drand no respondía); ronda comprometida ' : 'De la ronda ',
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
  const move = ballot.selected();
  drawTower(svg, s.tower.state, { preview: move ? applyMove(s.tower.state, parseMove(move)!) : null });
  $('#moves-made').textContent = fmt(s.tower.movesMade);
  $('#optimal-remaining').textContent = fmt(s.tower.optimalRemaining);
  ballot.render(s);
}

function renderGuestbook(s: StateResponse): void {
  const count = s.year && s.year.year === s.window.year ? s.year.guestbookCount : 0;
  $('#gb-count').textContent = fmt(count);
  $('#gb-count-label').textContent = count === 1 ? 'mensaje sellado' : 'mensajes sellados';
  $('#gb-closed').hidden = s.phase === 'open';
  gbForm.render(s);
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
    row('Año', String(y.year));
    row('Número', el('span', { class: 'mono' }, fmt(y.number.decimal)));
    row('Bit', el('span', { class: 'mono' }, String(y.bit)));
    if (y.source === 'nist') row('Fuente', 'baliza del NIST (drand no respondió)');
    else row('Ronda de drand', el('a', { href: drandRoundUrl(y.round) }, fmt(y.round)));
    parts.push(dl);
    if (y.source === 'drand') {
      const out = el('p', { class: 'small dim', 'aria-live': 'polite' });
      const btn = el('button', { type: 'button' }, 'Verificar');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.className = 'small dim';
        out.textContent = 'Verificando…';
        try {
          out.textContent = await verifyDrandInBrowser(y.round, y.randomness!);
          out.className = 'small success';
        } catch (e) {
          out.textContent = `No se pudo verificar: ${(e as Error).message}`;
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
        `El Número de ${c.year} saldrá de la ronda `,
        el('a', { href: drandRoundUrl(c.numberRound) }, fmt(c.numberRound)),
        ' de drand.',
      ),
    );
  }
  box.replaceChildren(...parts);
}
