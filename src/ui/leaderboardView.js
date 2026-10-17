import { identiconSvg } from '../gd/identicon.js';
import { ico } from './icons.js';
import { dailyPrizeAmounts, honorsFor, rewardsLine, secondsLabel, shortAddress, spoilsPanelDetail } from './leaderboardText.js';

/*
 * The leaderboard, as pure functions of what the server sent and who the player is (no DOM, no service), so every state it
 * can be in is testable. Everything that comes from the server or the wallet is escaped, or is a number, or is looked up
 * in a fixed table: nothing is interpolated into the markup as-is.
 *
 * `leaderboardModel` decides what to show; `leaderboardHtml` draws it. The screen that owns them (leaderboardScreen.js) places
 * the markup, and the scene (scenes/LeaderboardScene.js) loads the boards and carries out what the player taps.
 */

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MEDAL_ICON = { gold: 'medal', silver: 'medal_silver', bronze: 'medal_bronze' };

/** The words for a board that could not be loaded. */
export function loadErrorText(err) {
  return err?.status === 0
    ? "Can't reach the server. The boards are unavailable right now."
    : 'The boards are unavailable right now. Try again in a moment.';
}

/**
 * @param {{
 *   tab: 'alltime'|'daily', view: 'ranked'|'open',
 *   load: { state: 'loading'|'ready'|'error', error?: string },
 *   daily?: object|null, alltime?: object|null, cfg?: object|null, rewards?: object|null,
 *   status: { verified?: boolean, shortAddress?: string },
 *   myWallet: string|null, prizesOn: boolean,
 * }} s
 */
export function leaderboardModel({ tab, view, load, daily = null, alltime = null, cfg = null, rewards = null, status, myWallet, prizesOn }) {
  const isDaily = tab === 'daily';
  const board = (isDaily ? daily : alltime) ?? {};
  const entries = Array.isArray(board.entries) ? board.entries : [];
  const prizes = isDaily ? dailyPrizeAmounts(cfg, daily) : null;

  const rows = entries.map((e, i) => ({
    rank: i + 1,
    wallet: String(e.wallet ?? ''),
    name: shortAddress(e.wallet),
    time: secondsLabel(e.durationMs),
    score: Number(e.score) || 0,
    // the daily prize amount belongs to the verified board; the open board is not the one the prizes are paid from
    honors: honorsFor(i, isDaily && view === 'ranked' ? board.prizesG?.[i] : null),
    isPlayer: Boolean(myWallet) && e.wallet === myWallet,
  }));

  let statusLine;
  if (!myWallet) {
    statusLine = { text: 'Not connected. Tap to connect a wallet and join the board.', tone: 'plain' };
  } else if (!status.verified) {
    statusLine = { text: `${status.shortAddress || shortAddress(myWallet)}: verify you are human to compete for G$ prizes. Tap to verify.`, tone: 'warn' };
  } else {
    const mine = entries.find((e) => e.wallet === myWallet);
    statusLine = mine
      ? { text: `${status.shortAddress}: you are rank #${mine.rank}`, tone: 'good' }
      : { text: `${status.shortAddress}: verified. Play a Trial to claim a spot.`, tone: 'good' };
  }

  const empty = load.state === 'ready' && rows.length === 0
    ? {
      title: view === 'ranked' ? (isDaily ? 'No verified runs today' : 'No verified runs yet') : (isDaily ? 'No runs today' : 'No runs yet'),
      hint: 'Play a Trial and your verified score appears here.',
    }
    : null;

  return {
    tab, view, load, rows, empty, prizes, statusLine,
    honorsHead: isDaily ? 'Honors' : 'Legend',
    viewText: view === 'ranked' ? 'View: Verified' : 'View: Open',
    rewards: myWallet && rewards ? rewardsLine(rewards) : null,
    showSpoils: Boolean(prizesOn),
    spoilsDetail: spoilsPanelDetail({ prizes: dailyPrizeAmounts(cfg, daily), shardCapG: rewards?.crystalStatus?.dailyCapGd }),
  };
}

const honorsCell = (h) => (h
  ? `<span class="hn">${ico(MEDAL_ICON[h.medal], 28)}${h.amount ? `<small>${esc(h.amount)}</small>` : ''}</span>`
  : '<span class="hn none">-</span>');

const rowHtml = (r) => `<li class="lb-row${r.isPlayer ? ' me' : ''}" title="${esc(r.wallet)}">
    <b class="rk r${r.rank <= 3 ? r.rank : 'n'}">${r.rank}.</b>
    <span class="av">${identiconSvg(r.wallet)}</span>
    <span class="nm">${esc(r.name)}</span>
    <span class="tm">${esc(r.time)}</span>
    <span class="sc">${esc(r.score)}<small>pts</small></span>
    ${honorsCell(r.honors)}
  </li>`;

function listHtml(m) {
  if (m.load.state === 'loading') return '<p class="lb-note" role="status">Loading scores…</p>';
  if (m.load.state === 'error') {
    return `<div class="lb-note err" role="alert"><p>${esc(m.load.error)}</p><button type="button" class="btn-2" data-act="retry">Try again</button></div>`;
  }
  if (m.empty) return `<div class="lb-note"><b>${esc(m.empty.title)}</b><p>${esc(m.empty.hint)}</p></div>`;
  return `<ol class="lb-rows">${m.rows.map(rowHtml).join('')}</ol>`;
}

/** The player's rewards and the Spoils note: below the list, so on a short screen they scroll out of the way of the rows. */
function extraHtml(m) {
  if (m.load.state !== 'ready' || (!m.rewards && !m.showSpoils)) return '';
  const rewards = m.rewards ? `<p class="lb-rewards">${esc(m.rewards.boss)}${m.rewards.harvest ? `<br>${esc(m.rewards.harvest)}` : ''}</p>` : '';
  const spoils = m.showSpoils ? '<p class="lb-spoils">Spoils settle after UTC midnight. <button type="button" class="lnk" data-act="spoils">Spoils status</button></p>' : '';
  return `<div class="lb-extra">${rewards}${spoils}</div>`;
}

/** The markup of the whole screen (inside its root). */
export function leaderboardHtml(m) {
  const tab = (key, label) => `<button type="button" role="tab" class="lb-tab${m.tab === key ? ' on' : ''}" aria-selected="${m.tab === key}" data-act="tab" data-tab="${key}">${label}</button>`;
  const showTable = m.load.state === 'ready' && m.rows.length > 0;
  return `<header class="lb-head">
      <h1 class="lb-title">Leaderboard</h1>
      <div class="lb-tabs" role="tablist" aria-label="Which board">${tab('alltime', 'All-time')}${tab('daily', 'Daily')}</div>
      <button type="button" class="lb-view" data-act="view">${esc(m.viewText)} <span aria-hidden="true">&#9656;</span></button>
      ${m.prizes ? `<p class="lb-prizes">Daily prizes: 1st ${esc(m.prizes[0])} · 2nd ${esc(m.prizes[1])} · 3rd ${esc(m.prizes[2])} G$. Verified humans only.</p>` : ''}
    </header>
    <div class="lb-scroll">
      ${showTable ? `<div class="lb-cols" aria-hidden="true"><span class="rk">Rank</span><span class="av"></span><span class="nm">Warrior</span><span class="tm">Time</span><span class="sc">Score</span><span class="hn">${esc(m.honorsHead)}</span></div>` : ''}
      ${listHtml(m)}
      ${extraHtml(m)}
    </div>
    <footer class="lb-foot">
      <button type="button" class="lb-status ${esc(m.statusLine.tone)}" data-act="wallet">${esc(m.statusLine.text)}</button>
      <div class="lb-bar"><button type="button" class="btn-2" data-act="menu">Menu</button><button type="button" class="gold btn" data-act="endless">Play Endless</button></div>
    </footer>`;
}

/** The body of the Spoils sheet: the lines of the explanation, as paragraphs. */
export const spoilsSheetHtml = (m) => m.spoilsDetail.split('\n').map((line) => `<p class="lead">${esc(line)}</p>`).join('');
