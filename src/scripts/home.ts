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
    sub.append(
      'Hasta que abra el ',
      el('strong', {}, utc(s.window.opensAt)),
      ', cuando empieza el 10 de octubre en UTC+14.',
    );
    ceremony.hidden = true;
    countdown.hidden = false;
  } else if (s.phase === 'open') {
    eyebrow.textContent = `El Día de ${s.window.year} · abierto`;
    title.textContent = 'El Rito está abierto.';
    sub.innerHTML = '';
    sub.append(
      'Para votar y firmar. Cierra el ',
      el('strong', {}, utc(s.window.closesAt)),
      ', cuando termina el 10 de octubre en UTC−12.',
    );
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
    status.textContent = `Tu voto, ${voted}, queda sellado hasta el cierre.`;
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
    status.textContent = 'Esperando el captcha…';
    try {
      const captcha = await voteCaptcha;
      const token = await captcha.token();
      status.textContent = 'Votando…';
      const r = await postJson('/api/vote', { move: selectedMove, captcha: token });
      captcha.reset();
      if (r.status === 200) {
        selectedMove = null;
        await refresh();
      } else {
        status.className = 'status error';
        status.textContent = r.data?.error ?? `Algo salió mal (HTTP ${r.status}).`;
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
  $('#gb-count-label').textContent = count === 1 ? 'mensaje sellado' : 'mensajes sellados';
  const open = s.phase === 'open';
  $('#gb-closed').hidden = open;
  const form = $('#gb-form');
  form.hidden = !open;
  if (!open) return;
  for (const [k, v] of Object.entries(s.seals)) {
    const code = document.querySelector(`[data-t="${k}"]`);
    if (code) code.textContent = `T = ${fmt(v.t)}`;
  }
  $('#gb-bench').textContent = `T es ${fmt(s.sealBenchmark.squaringsPerSecond)} cuadrados por segundo (${s.sealBenchmark.cpu}, ${s.sealBenchmark.date}) por el tiempo objetivo.`;
  const button = $('#gb-button') as HTMLButtonElement;
  const status = $('#gb-status');
  if (s.you?.signed && !status.dataset.sealedId) {
    button.hidden = true;
    ($('#gb-text') as HTMLTextAreaElement).disabled = true;
    status.className = 'status success';
    status.textContent = 'Ya sellaste tu mensaje de este año.';
  } else if (!s.you?.signed) {
    gbCaptcha ??= mountCaptcha($('#gb-captcha'), s.captcha?.siteKey ?? null);
  }
}

const STEP_TEXT: Record<SealStep | 'send', string> = {
  keygen: 'Forjando un módulo N de 2048 bits a partir de dos primos nuevos',
  shortcut: 'Tomando el atajo que solo tiene quien sella: 2^(2^T) mod N, a través de φ(N)',
  encrypt: 'Cifrando con AES-256-GCM bajo el SHA-256 del resultado',
  send: 'Enviando N, T y el texto cifrado; los primos se olvidan',
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
      status.textContent = n === 0 ? 'Escribe algo primero.' : `Son ${fmt(n)} caracteres; el límite es 1.000.`;
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
          `Sellado como el mensaje #${r.data.id}. Abrirlo tomará ${state.seals[sealName].years === 1 ? 'cerca de un año' : `cerca de ${state.seals[sealName].years} años`} de cuadrados en el computador de escritorio más rápido de hoy: `,
          el('code', {}, `rite-solver open ${r.data.id}`),
        );
        button.hidden = true;
        await refresh();
      } else {
        throw new Error(r.data?.error ?? `Algo salió mal (HTTP ${r.status}).`);
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
    row('Año', String(y.year));
    row('Número', el('span', { class: 'mono' }, fmt(y.number.decimal)));
    row('Hex', el('span', { class: 'mono' }, y.number.hex));
    row('Bit', el('span', { class: 'mono' }, String(y.bit)));
    row('Fuente', y.source === 'nist' ? 'Baliza de aleatoriedad del NIST (respaldo)' : y.source === 'drand' ? 'drand quicknet' : String(y.source));
    row('Ronda', el('a', { href: drandRoundUrl(y.round) }, fmt(y.round)));
    row('Aleatoriedad', el('span', { class: 'hex' }, y.randomness));
    row(
      'Derivación',
      'Los primeros 8 bytes de la aleatoriedad, como entero sin signo de 64 bits: ',
      el('span', { class: 'mono' }, `${y.randomness.slice(0, 16)} = ${u64Hex(BigInt(y.number.decimal))}`),
      '. El Bit es el bit más bajo del último byte, ',
      el('span', { class: 'mono' }, `0x${y.randomness.slice(-2)}`),
      '.',
    );
    parts.push(dl);
    if (y.source === 'drand') {
      const out = el('p', { class: 'small dim', 'aria-live': 'polite' });
      const btn = el('button', { type: 'button' }, 'Verificarlo en tu navegador');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.className = 'small dim';
        out.textContent = 'Preguntando directamente a drand y revisando la firma…';
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
        `El Número y el Bit de ${c.year} los decidirá la ronda `,
        el('a', { href: drandRoundUrl(c.numberRound) }, fmt(c.numberRound)),
        ` de drand quicknet, emitida en el instante en que abre el Día (${utc(c.opensAt)}). Un empate en la torre al cierre lo rompe la ronda `,
        el('a', { href: drandRoundUrl(c.tiebreakRound) }, fmt(c.tiebreakRound)),
        ` (${utc(c.closesAt)}), que nadie puede conocer mientras la votación está abierta.`,
      ),
    );
  }
  box.replaceChildren(...parts);
}
