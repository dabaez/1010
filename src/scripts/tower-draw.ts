// Draws the Tower as SVG from its 12-character state.

import { PEGS, RINGS, stacks, topRing, type Peg } from '../shared/tower';

const NS = 'http://www.w3.org/2000/svg';
const W = 600;
const H = 260;
const BASE_Y = 226;
const RING_H = 14;
const RING_GAP = 2.4;
const PEG_X: Record<Peg, number> = { A: 100, B: 300, C: 500 };

function ringWidth(i: number): number {
  return 30 + (i / (RINGS - 1)) * 148;
}

function ringColor(i: number): string {
  // small rings burn bright gold; the large ones are old bronze
  const k = i / (RINGS - 1);
  const hue = 40 - 18 * k;
  const sat = 62 - 18 * k;
  const light = 66 - 30 * k;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export interface DrawOptions {
  /** the state to show faintly, e.g. the result of a move being considered */
  preview?: string | null;
  /** label for screen readers */
  label?: string;
}

export function drawTower(svg: SVGSVGElement, state: string, opts: DrawOptions = {}): void {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    opts.label ??
      `Tower state ${state}: ` + PEGS.map((p) => `peg ${p} holds ${stacks(state)[p].length} rings`).join(', '),
  );
  svg.replaceChildren();

  const defs = svgEl('defs', {});
  const shine = svgEl('linearGradient', { id: 'ring-shine', x1: 0, y1: 0, x2: 0, y2: 1 });
  shine.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.28 }),
    svgEl('stop', { offset: '45%', 'stop-color': '#fff', 'stop-opacity': 0 }),
    svgEl('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.3 }),
  );
  defs.append(shine);
  svg.append(defs);

  // the plinth
  svg.append(svgEl('rect', { x: 18, y: BASE_Y, width: W - 36, height: 7, rx: 1.5, fill: '#2e271e' }));
  svg.append(svgEl('rect', { x: 18, y: BASE_Y, width: W - 36, height: 1, fill: '#4a3f2f' }));

  for (const p of PEGS) {
    const x = PEG_X[p];
    svg.append(svgEl('rect', { x: x - 2.5, y: 22, width: 5, height: BASE_Y - 22, rx: 2.5, fill: '#3b3226' }));
    const label = svgEl('text', {
      x,
      y: BASE_Y + 27,
      'text-anchor': 'middle',
      fill: '#a39579',
      'font-family': 'IBM Plex Mono, monospace',
      'font-size': 13,
      'letter-spacing': 2,
    });
    label.textContent = p;
    svg.append(label);
  }

  const drawRings = (s: string, ghost: boolean, moved: number | null) => {
    const st = stacks(s);
    for (const p of PEGS) {
      st[p].forEach((ring, level) => {
        const w = ringWidth(ring);
        const y = BASE_Y - (level + 1) * (RING_H + RING_GAP) + RING_GAP / 2;
        const g = svgEl('g', { opacity: ghost ? (ring === moved ? 0.9 : 0) : 1 });
        g.append(
          svgEl('rect', {
            x: PEG_X[p] - w / 2,
            y,
            width: w,
            height: RING_H,
            rx: RING_H / 2,
            fill: ringColor(ring),
            stroke: ghost ? '#f3d593' : 'rgba(0,0,0,0.45)',
            'stroke-width': ghost ? 1.2 : 0.8,
            'stroke-dasharray': ghost ? '4 3' : '',
            'fill-opacity': ghost ? 0.25 : 1,
          }),
        );
        if (!ghost) {
          g.append(svgEl('rect', { x: PEG_X[p] - w / 2, y, width: w, height: RING_H, rx: RING_H / 2, fill: 'url(#ring-shine)' }));
        }
        svg.append(g);
      });
    }
  };

  if (opts.preview && opts.preview !== state) {
    const moved = [...state].findIndex((c, i) => opts.preview![i] !== c);
    drawRings(state, false, null);
    // dim the ring that is about to leave
    const from = state[moved] as Peg;
    if (topRing(state, from) === moved) {
      const st = stacks(state)[from];
      const level = st.indexOf(moved);
      const w = ringWidth(moved);
      const y = BASE_Y - (level + 1) * (RING_H + RING_GAP) + RING_GAP / 2;
      svg.append(svgEl('rect', { x: PEG_X[from] - w / 2, y, width: w, height: RING_H, rx: RING_H / 2, fill: '#0b0907', 'fill-opacity': 0.6 }));
    }
    drawRings(opts.preview, true, moved);
  } else {
    drawRings(state, false, null);
  }
}
