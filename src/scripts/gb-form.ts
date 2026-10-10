// Drives components/GuestbookForm.astro: the message is sealed in this
// browser, and only N, T, the iv, the ciphertext and the optional name are sent.

import { MAX_MESSAGE_CHARS, messageLength, seal } from '../shared/timelock';
import { $, fmt, postJson, type StateResponse } from './api';
import { mountCaptcha, type CaptchaWidget } from './captcha';

export interface GuestbookForm {
  render(s: StateResponse): void;
}

/** `onSealed` runs after a message is stored, e.g. to refresh the page. */
export function createGuestbookForm(onSealed: () => Promise<void>): GuestbookForm {
  let state: StateResponse | null = null;
  let captcha: Promise<CaptchaWidget> | null = null;
  const form = $('#gb-form') as HTMLFormElement;
  const name = $('#gb-name') as HTMLInputElement;
  const text = $('#gb-text') as HTMLTextAreaElement;
  const chars = $('#gb-chars');
  const counter = chars.parentElement!;
  const button = $('#gb-button') as HTMLButtonElement;
  const status = $('#gb-status');

  text.addEventListener('input', () => {
    const n = messageLength(text.value);
    chars.textContent = fmt(n);
    counter.classList.toggle('over', n > MAX_MESSAGE_CHARS);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state || !captcha) return;
    const message = text.value;
    const n = messageLength(message);
    if (n === 0 || n > MAX_MESSAGE_CHARS) {
      status.className = 'status error';
      status.textContent = n === 0 ? 'Escribe algo primero.' : `Son ${fmt(n)} caracteres; el límite es 1.000.`;
      return;
    }
    const sealName = (form.querySelector('input[name="seal"]:checked') as HTMLInputElement).value as keyof StateResponse['seals'];
    button.disabled = true;
    text.disabled = true;
    name.disabled = true;
    status.className = 'status dim';
    status.textContent = 'Sellando…';
    try {
      const widget = await captcha;
      const token = await widget.token();
      const sealed = await seal(message, BigInt(state.seals[sealName].t));
      const r = await postJson('/api/guestbook', { seal: sealName, name: name.value.trim() || null, ...sealed, captcha: token });
      widget.reset();
      if (r.status !== 200) throw new Error(r.data?.error ?? `Algo salió mal (HTTP ${r.status}).`);
      text.value = '';
      chars.textContent = '0';
      status.dataset.sealedId = String(r.data.id);
      status.className = 'status success';
      status.textContent = `Sellado como el mensaje #${r.data.id}.`;
      button.hidden = true;
      await onSealed();
    } catch (err) {
      status.className = 'status error';
      status.textContent = (err as Error).message;
      button.disabled = false;
      text.disabled = false;
      name.disabled = false;
    }
  });

  return {
    render(s) {
      state = s;
      form.hidden = s.phase !== 'open';
      if (s.phase !== 'open') return;
      if (s.you?.signed && !status.dataset.sealedId) {
        button.hidden = true;
        text.disabled = true;
        name.disabled = true;
        status.className = 'status success';
        status.textContent = 'Ya sellaste tu mensaje de este año.';
      } else if (!s.you?.signed) {
        captcha ??= mountCaptcha($('#gb-captcha'), s.captcha?.siteKey ?? null);
      }
    },
  };
}
