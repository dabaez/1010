// Renders one year of the archive, and lists of guestbook entries. Used by
// the archive, each year's page, and the guestbook page.

import { drandRoundUrl } from '../shared/beacon';
import { SEAL_LABELS, isSeal } from '../shared/seals';
import { base64ToBytes } from '../shared/timelock';
import { el, fmt, moveEl, tallyEl, utc } from './api';
import { verifyDrandInBrowser } from './verify';

export interface Entry {
  id: number;
  year: number;
  seal: string;
  name: string | null;
  n_hex: string;
  t: string;
  iv_b64: string;
  ciphertext_b64: string;
  created_at: string;
}

interface BeaconView {
  committed_drand_round: number;
  source: string | null;
  randomness: string | null;
  proof: Record<string, unknown> | null;
}

export interface YearFull {
  year: number;
  window: { opens_at: string; closes_at: string };
  closed_at: string | null;
  number: { decimal: string; hex: string } | null;
  bit: number | null;
  beacon: { number: BeaconView; tiebreak: BeaconView & { derivation: { choices: string[]; index: number } | null } };
  tower: {
    number: number;
    move: string;
    tally: Record<string, number>;
    decided_by: string;
    state_before: string;
    state_after: string;
    optimal_remaining: number;
  } | null;
  seals: { benchmark: { cpu: string; squaringsPerSecond: number }; t: Record<string, string> };
  entries: Entry[];
}

export interface YearSummary {
  year: number;
  closed: boolean;
  number: { decimal: string; hex: string } | null;
  bit: number | null;
  move: string | null;
  decided_by: string | null;
  guestbook_count: number;
}

const DECIDED: Record<string, string> = {
  votes: 'por votación',
  tiebreak: 'por desempate',
  no_votes: 'sin votos; eligió la baliza',
};

function sealName(seal: string): string {
  return isSeal(seal) ? SEAL_LABELS[seal] : seal;
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('es', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Bytes the server cannot check are shown in hex, not as the base64 they are
 * stored in: anyone can pick base64 that spells words, but 0–9 and a–f say
 * almost nothing.
 */
const b64ToHex = (b64: string) => Array.from(base64ToBytes(b64), (b) => b.toString(16).padStart(2, '0')).join('');

/** The sealed message itself: unreadable, shown in hex. Click to see all of it. */
function cipherText(b64: string): HTMLElement {
  const p = el('p', { class: 'entry-cipher', title: 'Texto cifrado, en hexadecimal (clic para verlo entero)' }, b64ToHex(b64));
  p.addEventListener('click', () => p.classList.toggle('expanded'));
  return p;
}

/** The sealed entries of a year, newest last. */
export function renderEntries(entries: Entry[]): HTMLElement {
  if (!entries.length) return el('p', { class: 'dim' }, 'Nadie selló un mensaje este año.');
  return el(
    'ol',
    { class: 'entries' },
    ...entries.map((e) => {
      return el(
        'li',
        { class: 'entry', id: `mensaje-${e.id}` },
        el('span', { class: 'entry-num mono' }, `#${e.id}`),
        el('span', { class: e.name ? 'entry-name' : 'entry-name anon' }, e.name ?? 'Anónimo'),
        el('span', { class: 'entry-meta' }, `sello de ${sealName(e.seal)}`),
        cipherText(e.ciphertext_b64),
        el(
          'details',
          { class: 'entry-puzzle' },
          el('summary', {}, 'el resto del acertijo'),
          el('p', { class: 'hex' }, `N = ${e.n_hex}`),
          el('p', { class: 'hex' }, `T = ${e.t}`),
          el('p', { class: 'hex' }, `iv = ${b64ToHex(e.iv_b64)}`),
        ),
      );
    }),
  );
}

function verifyButton(round: number, randomness: string): Node[] {
  const out = el('p', { class: 'small dim', 'aria-live': 'polite' });
  const btn = el('button', { type: 'button' }, 'Verificar');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    out.className = 'small dim';
    out.textContent = 'Verificando…';
    try {
      out.textContent = await verifyDrandInBrowser(round, randomness);
      out.className = 'small success';
    } catch (e) {
      out.textContent = `No se pudo verificar: ${(e as Error).message}`;
      out.className = 'small error';
      btn.disabled = false;
    }
  });
  return [el('p', {}, btn), out];
}

/** One year: its Number, its move, its guestbook, and the technical record. */
export function renderYear(y: YearFull): HTMLElement {
  const parts: Node[] = [
    el('header', { class: 'year-head' }, el('h2', {}, `El Día de ${y.year}`), el('span', { class: 'dim' }, y.closed_at ? 'cerrado' : 'abierto')),
  ];

  // The Number and the Bit
  if (y.number) {
    parts.push(
      el(
        'div',
        { class: 'year-number' },
        el('div', {}, el('p', { class: 'eyebrow' }, 'El Número'), el('p', { class: 'big-number' }, fmt(y.number.decimal)), el('p', { class: 'hex' }, y.number.hex)),
        el('div', {}, el('p', { class: 'eyebrow' }, 'El Bit'), el('p', { class: 'big-number' }, String(y.bit))),
      ),
    );
    if (y.beacon.number.source === 'drand' && y.beacon.number.randomness) {
      parts.push(...verifyButton(y.beacon.number.committed_drand_round, y.beacon.number.randomness));
    }
  } else {
    parts.push(el('p', { class: 'dim' }, 'El Número aún no se ha sorteado.'));
  }

  // The move
  if (y.tower) {
    parts.push(
      el('h3', {}, 'La Torre'),
      el(
        'p',
        {},
        'Movimiento ',
        el('strong', { class: 'mono' }, moveEl(y.tower.move)),
        `, ${DECIDED[y.tower.decided_by] ?? y.tower.decided_by}. `,
        el('span', { class: 'mono small dim' }, tallyEl(y.tower.tally)),
      ),
    );
  } else if (!y.closed_at) {
    parts.push(el('h3', {}, 'La Torre'), el('p', { class: 'dim' }, 'Los votos están sellados hasta el cierre.'));
  }

  // The guestbook, front and center
  parts.push(
    el('h3', {}, `Libro de visitas · ${fmt(y.entries.length)} ${y.entries.length === 1 ? 'mensaje' : 'mensajes'}`),
    renderEntries(y.entries),
  );

  // The technical record, for whoever wants to check it
  const facts = el('dl', { class: 'facts' });
  const row = (k: string, ...v: (Node | string)[]) => facts.append(el('dt', {}, k), el('dd', {}, ...v));
  row('Ventana', `${utc(y.window.opens_at)} hasta ${utc(y.window.closes_at)}`);
  const nb = y.beacon.number;
  row(
    'Ronda del Número',
    el('a', { href: drandRoundUrl(nb.committed_drand_round) }, fmt(nb.committed_drand_round)),
    nb.source === 'nist' ? ' (drand no respondió; se usó la baliza del NIST)' : nb.source === 'fake' ? ' (falsa, desarrollo)' : '',
  );
  if (nb.randomness) {
    row('Aleatoriedad', el('span', { class: 'hex' }, nb.randomness));
    row('Derivación', 'Número: los primeros 8 bytes, como entero sin signo de 64 bits. Bit: el bit más bajo del último byte.');
  }
  const tb = y.beacon.tiebreak;
  row('Ronda de desempate', el('a', { href: drandRoundUrl(tb.committed_drand_round) }, fmt(tb.committed_drand_round)));
  if (tb.derivation) {
    row(
      'Desempate',
      `número mod ${tb.derivation.choices.length} = ${tb.derivation.index}; de `,
      ...tb.derivation.choices.flatMap((c, i) => [i ? ', ' : '', el('span', { class: 'mono' }, moveEl(c))]),
      ' salió ',
      el('span', { class: 'mono' }, moveEl(tb.derivation.choices[tb.derivation.index]!)),
    );
  }
  if (y.tower) row('Estado de la torre', el('span', { class: 'mono' }, `${y.tower.state_before} → ${y.tower.state_after}`));
  row(
    'Sellos',
    el('span', { class: 'mono small' }, Object.entries(y.seals.t).map(([k, v]) => `${sealName(k)} T=${fmt(v)}`).join(' · ')),
    ` (${fmt(y.seals.benchmark.squaringsPerSecond)} cuadrados/s en ${y.seals.benchmark.cpu})`,
  );
  if (y.closed_at) row('Registro', el('a', { href: `/api/ledger/${y.year}.json` }, `${y.year}.json`));
  parts.push(el('details', { class: 'technical' }, el('summary', {}, 'Detalles técnicos'), facts));

  return el('section', { class: 'panel year', id: `y${y.year}` }, ...parts);
}

/** A line per year, linking to its page. */
export function renderYearList(years: YearSummary[]): HTMLElement {
  return el(
    'ol',
    { class: 'year-list' },
    ...years.map((y) =>
      el(
        'li',
        {},
        el(
          'a',
          { href: `/archive/${y.year}/` },
          el('strong', {}, String(y.year)),
          el('span', { class: 'mono' }, y.number ? fmt(y.number.decimal) : '—'),
          el('span', { class: 'mono' }, y.move ? moveEl(y.move) : y.closed ? '—' : 'abierto'),
          el('span', {}, `${fmt(y.guestbook_count)} ${y.guestbook_count === 1 ? 'mensaje' : 'mensajes'}`),
        ),
      ),
    ),
  );
}
