import { ico } from './icons.js';
import { escapeHtml as esc } from './sheet.js';

/*
 * The invite sheet, as a pure function of what the server said about the player's link (no DOM, no network), so every state
 * it can be in is testable: loading, failed, and the link with how far each friend got. Everything that comes from the
 * server is escaped, or is a number, or is looked up in a fixed table.
 */

export const inviteTitle = 'Invite friends';

/** Where a friend can be, in the order they get there. The server sends the key; the words and the icon are ours. */
const STATUS = {
  joined: { text: 'Joined', icon: null },
  verified: { text: 'Verified', icon: 'check' },
  playing: { text: 'Playing', icon: 'sword_clean' },
};

const DAY_MS = 86_400_000;

/** "today", "yesterday", "5 days ago": when a friend joined, from the server's timestamp. */
export function joinedAgo(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const days = Math.floor((now - at) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 30 ? `${days} days ago` : 'over a month ago';
}

/** The link, breaking (when it must) before its query (…xyz/ then ?ref=CODE), never in the code and never leaving one character alone. */
function linkHtml(link) {
  const text = String(link ?? '');
  const at = text.indexOf('?');
  return at < 0 ? esc(text) : `${esc(text.slice(0, at))}<span class="q">${esc(text.slice(at))}</span>`;
}

const count = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0);

/** kind: 'gold' (the one main action) or 'plain' (a second choice), as in the wallet's buttons. */
const button = (act, label, { kind = 'gold' } = {}) =>
  `<button type="button" class="${kind === 'gold' ? 'gold btn' : 'btn-2'} gd-wallet" data-act="${act}">${label}</button>`;

function friendRow(f, now) {
  const st = STATUS[f.status] ?? STATUS.joined;
  const when = joinedAgo(f.joinedAt, now);
  return `<div class="gd-spoil"><span>${esc(f.who)}${when ? `<small>Joined ${when}</small>` : ''}</span><span class="fr-st ${esc(f.status in STATUS ? f.status : 'joined')}">${st.icon ? ico(st.icon, 18) : ''}${st.text}</span></div>`;
}

/**
 * @param {{phase: 'loading'|'ready'|'error', error?: string, link?: string, joined?: number, verified?: number, playing?: number,
 *          friends?: Array<{who: string, status: string, joinedAt: string}>, copied?: boolean}} s
 * @param {{canShare?: boolean, now?: number}} [opts] `canShare`: the browser can open its own share sheet (most phones)
 */
export function inviteHtml(s, { canShare = false, now = Date.now() } = {}) {
  if (s.phase === 'loading') {
    return '<div class="busy"><span class="spin"><i></i><i></i><i></i></span>Getting your link…</div>';
  }
  if (s.phase === 'error') {
    return `<p class="note gd-warn">${esc(s.error || 'Something went wrong. Try again in a moment.')}</p>${button('retry', 'Try again')}`;
  }

  const copy = button('copy', s.copied ? `${ico('tick', 22)}<span>Copied</span>` : `${ico('copy', 22)}<span>Copy link</span>`, { kind: canShare ? 'plain' : 'gold' });
  const actions = canShare ? `${button('share', `${ico('share', 22)}<span>Share</span>`)}${copy}` : copy;
  const friends = Array.isArray(s.friends) ? s.friends : [];
  const list = friends.length
    ? friends.map((f) => friendRow(f, now)).join('')
    : '<p class="note">No friends yet. Send your link to get started.</p>';
  return [
    '<p class="lead">Share your link. When a friend joins and proves they are human, it counts for you.</p>',
    `<div class="invite-link" aria-label="Your invite link">${linkHtml(s.link)}</div>`,
    actions,
    `<div class="stats3"><div><b>${count(s.joined)}</b><small>Joined</small></div><div><b>${count(s.verified)}</b><small>Verified</small></div><div><b>${count(s.playing)}</b><small>Playing</small></div></div>`,
    `<section class="gd-sec"><h4 class="sec-h">Your friends</h4>${list}</section>`,
    '<p class="note">A friend is verified once GoodDollar\'s face scan says they are a real person, and playing once they own their blade. Each person counts once, and only players new to Moonshard can be invited.</p>',
  ].join('');
}
