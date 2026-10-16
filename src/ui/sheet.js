import { ico } from './icons.js';

/*
 * A sheet: a card that rises from the bottom of a phone (and sits in the middle when the phone is on its side), over a
 * dimmed screen. The menu's settings and chapters, the wallet and the way-in steps all use it, so they open, close and
 * look the same. Closing slides it away instead of cutting it. One sheet is open at a time per host.
 */

const CLOSE_MS = 175;
const ESC = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {HTMLElement} host where the sheet is drawn (inside #ms-ui, so its styles apply)
 * @param {{title: string, body: string, name?: string, dismissable?: boolean, onClose?: () => void, onAction?: (act: string, el: HTMLElement) => void}} opts
 *   `body` is trusted HTML (build it with the escaping helpers); a `[data-act]` inside it calls `onAction`.
 * @returns {{el: HTMLElement, setTitle(t: string): void, setBody(html: string): void, close(): void, isOpen(): boolean}}
 */
export function openSheet(host, { title, body, name = '', dismissable = true, onClose = null, onAction = null }) {
  host.__releaseSheet?.(); // a sheet already open here is replaced: stop it listening for keys
  let open = true;
  let closeTimer = null;
  host.innerHTML = `<div class="scrim" data-sheet="scrim"></div><section class="sheet${name ? ` s-${ESC(name)}` : ''}" role="dialog" aria-modal="true" aria-label="${ESC(title)}">
    <div class="sheet-h"><h2></h2><button class="icon-btn sm" data-sheet="close" aria-label="Close" type="button">${ico('close', 18)}</button></div>
    <div class="sheet-b"></div></section>`;
  const el = host.querySelector('.sheet');
  const scrim = host.querySelector('.scrim');
  const h2 = el.querySelector('h2');
  const bodyEl = el.querySelector('.sheet-b');
  h2.textContent = title;
  bodyEl.innerHTML = body;
  el.querySelector('[data-sheet="close"]').hidden = !dismissable;

  const api = {
    el,
    setTitle(t) { h2.textContent = t; el.setAttribute('aria-label', t); },
    setBody(html) { bodyEl.innerHTML = html; },
    isOpen: () => open,
    close() {
      if (!open) return;
      open = false;
      document.removeEventListener('keydown', onKey);
      el.classList.add('out');
      scrim.classList.add('out');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (host.contains(el)) host.innerHTML = ''; }, CLOSE_MS);
      onClose?.();
    },
  };

  const onKey = (e) => { if (e.key === 'Escape' && dismissable) api.close(); };
  document.addEventListener('keydown', onKey);
  host.__releaseSheet = () => { open = false; clearTimeout(closeTimer); document.removeEventListener('keydown', onKey); };
  host.onclick = (e) => {
    const closer = e.target.closest('[data-sheet]');
    if (closer && closer.dataset.sheet === 'scrim' && !dismissable) return;
    if (closer) { api.close(); return; }
    const a = e.target.closest('[data-act]');
    if (a && !a.disabled && onAction) onAction(a.dataset.act, a);
  };
  return api;
}

export { ESC as escapeHtml };
