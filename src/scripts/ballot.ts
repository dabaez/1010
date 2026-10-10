// Drives components/Ballot.astro: legal moves as buttons, the captcha, and the vote.

import { $, el, moveEl, postJson, type StateResponse } from './api';
import { mountCaptcha, type CaptchaWidget } from './captcha';

export interface BallotOptions {
  /** fetch the state again and re-render the page */
  refresh: () => Promise<void>;
  /** the move being considered, for drawing a preview; null when none */
  onSelect: (move: string | null) => void;
}

export interface Ballot {
  render(s: StateResponse): void;
  selected(): string | null;
}

export function createBallot(opts: BallotOptions): Ballot {
  let selected: string | null = null;
  let captcha: Promise<CaptchaWidget> | null = null;
  const box = $('#ballot');
  const moves = $('#moves');
  const button = $('#vote-button') as HTMLButtonElement;
  const status = $('#vote-status');

  button.addEventListener('click', async () => {
    if (!selected || !captcha) return;
    button.disabled = true;
    status.className = 'status dim';
    status.textContent = 'Esperando el captcha…';
    try {
      const widget = await captcha;
      const token = await widget.token();
      status.textContent = 'Votando…';
      const r = await postJson('/api/vote', { move: selected, captcha: token });
      widget.reset();
      if (r.status === 200) {
        selected = null;
        opts.onSelect(null);
        await opts.refresh();
      } else {
        status.className = 'status error';
        status.textContent = r.data?.error ?? `Algo salió mal (HTTP ${r.status}).`;
        button.disabled = false;
        if (r.status === 409 || r.status === 423) await opts.refresh();
      }
    } catch (e) {
      status.className = 'status error';
      status.textContent = (e as Error).message;
      button.disabled = false;
    }
  });

  return {
    selected: () => selected,
    render(s) {
      box.hidden = s.phase !== 'open';
      if (s.phase !== 'open') return;
      box.querySelectorAll('.ballot-year').forEach((e) => (e.textContent = String(s.window.year)));

      const voted = s.you?.vote ?? null;
      if (moves.dataset.for !== s.tower.ballot.join() + voted) {
        moves.dataset.for = s.tower.ballot.join() + voted;
        moves.replaceChildren(
          ...s.tower.ballot.map((m) => {
            const b = el('button', { type: 'button', role: 'radio', 'data-move': m, 'aria-checked': String(m === (voted ?? selected)) }, moveEl(m));
            b.disabled = !!voted;
            b.addEventListener('click', () => {
              selected = m;
              moves.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.move === m)));
              button.disabled = false;
              opts.onSelect(m);
            });
            return b;
          }),
        );
      }
      if (voted) {
        button.hidden = true;
        status.className = 'status success';
        status.replaceChildren('Tu voto, ', moveEl(voted), ', queda sellado hasta el cierre.');
      } else {
        button.disabled = !selected;
        captcha ??= mountCaptcha($('#vote-captcha'), s.captcha?.siteKey ?? null);
      }
    },
  };
}
