import { fetchReferrals, referralLink } from '../gd/referral.js';
import { getToken } from '../gd/session.js';
import { explainError } from '../gd/format.js';
import { openSheet } from './sheet.js';
import { showToast } from './toast.js';
import { inviteHtml, inviteTitle } from './referralView.js';

const SHARE = { title: 'Moonshard: The High Forest', text: 'Join me in Moonshard, a pixel action game where G$ is how you play.' };
const COPIED_MS = 2200;

/** Puts `text` on the clipboard: the browser's own way, and the old way for a webview that has only that. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* not allowed here (a webview, a page without focus): try the old way */ }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Opens the phone's own share sheet. 'shared', 'cancelled' (the player closed it), or 'unsupported' to fall back to copying. */
export async function shareLink({ title, text, url }) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'unsupported';
  try {
    await navigator.share({ title, text, url });
    return 'shared';
  } catch (err) {
    return err?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

const browserCanShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * The invite sheet: the player's link to copy or share, and how far each friend they brought in has got. It is a sheet of
 * its own, not part of the wallet's, which is redrawn whenever the wallet's status changes.
 *
 * @param {HTMLElement} host where sheets are drawn
 * @param {{
 *   load?: () => Promise<object>,            GET /referrals/me
 *   link?: (code: string) => string,
 *   share?: typeof shareLink, copy?: typeof copyText, canShare?: () => boolean,
 *   onBack?: () => void,                     the sheet was closed (the wallet's sheet comes back, when it was opened from there)
 *   now?: () => number
 * }} [deps]
 */
export function openReferralSheet(host, {
  load = () => fetchReferrals({ token: getToken() }),
  link = referralLink,
  share = shareLink,
  copy = copyText,
  canShare = browserCanShare,
  onBack = null,
  now = Date.now,
} = {}) {
  let state = { phase: 'loading' };
  let copiedTimer = null;
  let alive = true;
  let sheet = null;

  const draw = () => { if (sheet?.isOpen()) sheet.setBody(inviteHtml(state, { canShare: canShare(), now: now() })); };

  async function fetchMine() {
    state = { phase: 'loading' };
    draw();
    try {
      const me = await load();
      if (!alive) return;
      state = {
        phase: 'ready', link: link(me.code), joined: me.joined, verified: me.verified, playing: me.playing,
        friends: Array.isArray(me.friends) ? me.friends : [], copied: false,
      };
    } catch (err) {
      if (!alive) return;
      state = { phase: 'error', error: explainError(err) };
    }
    draw();
  }

  async function copyLink() {
    if (!(await copy(state.link))) {
      showToast('Could not copy it. Press and hold the link to copy it by hand.', { type: 'warn' });
      return;
    }
    if (!alive) return;
    state = { ...state, copied: true };
    draw();
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { state = { ...state, copied: false }; draw(); }, COPIED_MS);
  }

  sheet = openSheet(host, {
    title: inviteTitle,
    name: 'invite',
    body: inviteHtml(state, { canShare: canShare(), now: now() }),
    onClose: () => { alive = false; clearTimeout(copiedTimer); onBack?.(); },
    onAction: async (act) => {
      if (state.phase === 'error' && act === 'retry') { fetchMine(); return; }
      if (state.phase !== 'ready') return;
      if (act === 'copy') await copyLink();
      if (act === 'share') {
        const outcome = await share({ ...SHARE, url: state.link });
        if (outcome === 'unsupported') await copyLink(); // no share sheet here after all: copying is the next best
      }
    },
  });
  fetchMine();
  return sheet;
}
