import { explorerTx } from '../gd/config.js';
import { explainError, formatCountdown, formatG } from '../gd/format.js';
import { identiconSvg } from '../gd/identicon.js';
import { canPlay, entryBlade, gateStep } from '../engine/playGateRules.js';

/**
 * The wallet panel as a pure function of the service status (no DOM, no service import), so every state it can be
 * in is testable. Everything that comes from the server or the wallet is escaped, or is a number, or is looked up in
 * a fixed table: nothing is interpolated into the markup as-is.
 */

const LABELS = {
  anonymous: 'NOT CONNECTED',
  unknown: 'CHECKING…',
  unverified: 'NOT VERIFIED',
  verified: 'VERIFIED HUMAN',
  expired: 'VERIFICATION EXPIRED',
};

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const button = (act, label, { disabled = false, id = '', cls = '' } = {}) =>
  `<button type="button" class="pixel-modal-btn gd-btn ${cls.includes('gd-ghost') ? '' : 'btn-resume'} ${cls}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;

const NO_WALLET = 'No wallet detected. Open Moonshard inside GoodWallet (or any wallet app\'s browser), or install a browser wallet such as MetaMask and reload this page.';

const section = (title, inner) => `<section class="gd-sec"><h4>${title}</h4>${inner}</section>`;
const note = (text) => `<p class="gd-muted">${text}</p>`;
const warn = (text) => `<p class="gd-warn">${text}</p>`;

/** A server "reason" is either a sentence (shown) or a code (looked up); never shown raw. */
const reasonText = (reason) => (/\s/.test(String(reason)) ? String(reason).slice(0, 120) : explainError(String(reason || 'not_claimable')));

const txLink = (hash) => `<a class="gd-link" href="${esc(explorerTx(hash))}" target="_blank" rel="noopener">VIEW TRANSACTION ▸</a>`;

/** G$ in a wallet, rounded down: a balance shown as "20" must be able to pay 20. */
const walletG = (g) => formatG(Math.floor(Number(g) * 100) / 100, 2);
const balanceLine = (s) => (s.balance == null ? '' : `<p>Your G$: <b>${walletG(s.balance)}</b></p>`);
/** Known to hold less than `priceG` (an unknown balance is not short: the wallet checks before anything is sent). */
const isShort = (s, priceG) => s.balance != null && Number(s.balance) < Number(priceG);

function dailyHtml(s, txDisabled, now) {
  const ubi = s.ubi;
  let html = balanceLine(s);
  if (s.awaiting?.ubi) {
    html += `<p>Claim sent ✓ — waiting for the network to confirm.</p>${txLink(s.awaiting.ubi)}`;
  } else if (!ubi) {
    html += note('UBI status unavailable right now.');
  } else if (ubi.canClaim) {
    html += `<p>Your daily G$ is ready: <b>${formatG(ubi.entitlementG, 2)} G$</b></p>${button('ubi', 'CLAIM DAILY G$', { disabled: txDisabled })}`;
  } else if (ubi.nextClaimAt) {
    html += `<p>Claimed today. Next claim in <b>${formatCountdown(ubi.nextClaimAt - now)}</b></p>`;
  } else {
    html += '<p>Claimed today.</p>';
  }
  html += s.blessing
    ? '<p class="gd-blessing">✨ CITIZEN\'S BLESSING ACTIVE — +25% Forge materials today</p>'
    : note("Claim your daily G$ to receive the Citizen's Blessing (+25% Forge materials).");
  const c = s.rewards?.crystalStatus;
  if (c) html += note(`Shards today: ${formatG(c.gdEarned)} / ${formatG(c.dailyCapGd)} G$ (paid after UTC midnight)`);
  if (s.stale?.ubi || s.stale?.rewards) html += note('Could not be refreshed just now — showing the last known info.');
  return html;
}

function bountyHtml(s, txDisabled, now) {
  const b = s.bounty;
  if (s.awaiting?.bounty) return `<p>Bounty sent — waiting for the network to confirm.</p>${txLink(s.awaiting.bounty)}`;
  if (!b) return note(s.stale?.bounty ? 'Boss bounty status unavailable right now.' : 'Checking the boss bounty…');
  if (!b.configured) return note('Boss bounty is coming soon.');
  if (b.claimedHere) return '<p class="gd-blessing">✔ First-boss bounty claimed.</p>';
  // the amount is shown only when the server gave one: the player's share is not the protocol's headline number
  const amount = Number(b.rewardG) > 0 ? `${formatG(b.rewardG)} G$` : null;
  if (b.pendingRunId) {
    if (b.canClaim === false) return warn(esc(reasonText(b.reason)));
    // the server only signs for a boss kill from the last 24 h: say how long is left, and never offer a refused claim
    const left = b.attestExpiresAt ? Date.parse(b.attestExpiresAt) - now : null;
    if (left !== null && Number.isFinite(left) && left <= 0) {
      return warn('Too late: the claim window for that boss kill has closed. Defeat a boss again to unlock the bounty.');
    }
    const window = left !== null && Number.isFinite(left) ? note(`Claim within ${formatCountdown(left)}.`) : '';
    return `<p>Boss defeated! Claim your one-time reward.</p>${window}${button('bounty', amount ? `CLAIM ${amount} BOUNTY` : 'CLAIM BOUNTY', { disabled: txDisabled })}`;
  }
  if (b.canClaim === false) return warn(esc(reasonText(b.reason))); // never promise an unlock the contract would refuse
  return note(`Defeat a chapter boss in Story Mode to unlock a one-time ${amount ? `bounty of ${amount}` : 'G$ bounty'}.`);
}

function spoilsHtml(s, txDisabled) {
  if (!s.spoils.length) {
    return s.stale?.spoils
      ? warn('Spoils are unavailable right now. Try again in a moment.')
      : note('No Spoils yet. Reach the top 3 of the verified daily board or collect Shards. Settled after UTC midnight.');
  }
  const rows = s.spoils.map((sp) => {
    const label = sp.kind === 'TRIAL_PRIZE' ? `DAILY PRIZE #${Number(sp.rank) || '-'}` : 'SHARD HARVEST';
    let action;
    if (sp.claimed) action = '<span class="gd-blessing">✔ CLAIMED</span>';
    else if (s.awaiting?.spoils?.[sp.id]) action = '<span class="gd-muted">confirming…</span>';
    else if (sp.voucher) action = button('redeem', 'REDEEM', { id: sp.id, disabled: txDisabled });
    else action = '<span class="gd-muted">unavailable</span>';
    return `<div class="gd-spoil"><span>${label}<small>${esc(sp.day)} • ${formatG(sp.amountG)} G$</small></span>${action}</div>`;
  });
  if (s.stale?.spoils) rows.push(note('Could not be refreshed just now — showing the last known Spoils.'));
  return rows.join('');
}

/**
 * The gate's blade step: the blade a hero fights with is paid for in G$. A player known to be short of the price is not
 * offered a purchase that would fail: today's free claim comes first, or when the next one does.
 */
function bladeHtml(s, blade, txDisabled, now) {
  const price = formatG(blade.priceG, 2);
  const out = [
    `<p>Your hero fights with a blade paid for in G$: the <b>${esc(blade.name)}</b>, ${price} G$. What you pay goes into the prize vault that pays the daily prizes.</p>`,
    balanceLine(s),
  ];
  const sent = s.awaiting?.shop?.[blade.id];
  if (sent) {
    out.push(`<p>Payment sent ✓ — waiting for the network to confirm.</p>${txLink(sent)}`);
  } else if (!isShort(s, blade.priceG)) {
    out.push(button('buy', `BUY ${esc(String(blade.name).toUpperCase())} — ${price} G$`, { id: blade.id, disabled: txDisabled }));
  } else {
    out.push(warn(`You need ${price} G$.`));
    if (s.awaiting?.ubi) out.push(`<p>Claim sent ✓ — waiting for the network to confirm.</p>${txLink(s.awaiting.ubi)}`);
    else if (s.ubi?.canClaim) out.push(`<p>Claim today's free G$ first: <b>${formatG(s.ubi.entitlementG, 2)} G$</b></p>${button('ubi', 'CLAIM DAILY G$', { disabled: txDisabled })}`);
    else if (s.ubi?.nextClaimAt) out.push(note(`Your next free G$ comes in ${formatCountdown(s.ubi.nextClaimAt - now)}. You can also add G$ to this wallet from another one.`));
    else out.push(note('Add G$ to this wallet to buy it.'));
  }
  return out.join('');
}

/**
 * The way into the game, shown when the player tries to start a game mode: the steps, the current one marked, and the one
 * action that moves them forward. With a Moon Shop on the server the blade is a step of its own. `gate.label` names the
 * mode they asked for.
 */
function gateHtml(s, gate, busy, txDisabled, now) {
  const step = gateStep(s);
  const blade = s.shop?.enabled ? entryBlade(s.shop) : null;
  const titles = ['1. Connect your wallet', '2. Prove you are human', ...(blade ? ['3. Buy your blade with G$'] : []), `${blade ? 4 : 3}. Play ${gate.label}`];
  const about = s.verified ? 2 : 1; // "checking" and "unreachable" are about the blade once the player is verified
  const at = { connect: 0, checking: about, unreachable: about, verify: 1, blade: 2, ready: titles.length - 1 }[step];
  const steps = titles.map((text, i) => {
    const cls = i < at ? 'gd-step-done' : i === at ? 'gd-step-now' : 'gd-step-todo';
    const mark = i < at ? '✔' : i === at ? '▶' : '○';
    return `<li class="${cls}">${mark} ${text}</li>`;
  });
  let action = '';
  if (step === 'connect') {
    action = button('connect', 'CONNECT WALLET', { disabled: busy });
    if (!s.hasWallet) action += warn(NO_WALLET);
  } else if (step === 'checking') {
    action = note(s.verified ? 'Checking your blade…' : 'Checking your verification…');
  } else if (step === 'unreachable') {
    action = `${warn(`Can't reach the server to check your ${s.verified ? 'blade' : 'verification'}.`)}${button('recheck', 'TRY AGAIN', { disabled: busy })}`;
  } else if (step === 'blade') {
    action = bladeHtml(s, blade, txDisabled, now);
  } else if (step === 'verify') {
    const expired = s.status === 'expired';
    action = `<p>${expired ? 'Your GoodDollar verification has expired. Verify again to play.' : "GoodDollar's quick face scan proves you are a real person. Moonshard never sees your face."}</p>${button('verify', 'VERIFY (FACE SCAN)', { disabled: txDisabled })}${button('recheck', "I'M DONE — CHECK AGAIN", { disabled: busy, cls: 'gd-ghost' })}`;
  } else {
    action = button('play', `PLAY ${esc(gate.label)} ▶`, { disabled: busy });
  }
  const then = blade ? ', then buy your blade with G$,' : '';
  return section('VERIFIED HUMANS ONLY', `<p>Moonshard is played by real people: one human, one slot. Connect your wallet and prove you are human with GoodDollar${then} to play.</p><ol class="gd-steps">${steps.join('')}</ol>${action}`);
}

export function renderPanelHtml(s, now = Date.now(), { gate = null } = {}) {
  const busy = Boolean(s.busy);
  const txDisabled = busy || s.wrongChain || s.needsReconnect;
  const status = Object.hasOwn(LABELS, s.status) ? s.status : 'anonymous'; // never interpolate server text into markup
  const label = status === 'unknown' && s.offline ? 'SERVER OFFLINE' : LABELS[status];
  const out = [];

  out.push(`<div class="gd-status gd-st-${status}">
      ${s.connected ? `<span class="gd-avatar">${identiconSvg(s.address)}</span>` : '<span class="gd-dot"></span>'}
      <div class="gd-status-text"><b>${label}</b>${
        s.connected ? `<small>${esc(s.shortAddress)}${s.host !== 'browser' ? ` • ${esc(String(s.host).toUpperCase())}` : ''}</small>` : ''
      }</div></div>`);

  if (busy) out.push(note('Working… confirm in your wallet if asked.'));

  if (gate) {
    if (!s.connected && s.sessionExpired) out.push(warn('Your session ended. Connect your wallet again to keep playing.'));
    if (s.connected && s.needsReconnect && gateStep(s) !== 'ready') out.push(warn('Reconnect your wallet to continue.'));
    out.push(gateHtml(s, gate, busy, txDisabled, now));
    if (s.connected) out.push(button('disconnect', 'DISCONNECT', { disabled: busy, cls: 'gd-ghost' }));
  } else if (!s.connected) {
    if (s.sessionExpired) out.push(warn('Your session ended. Connect your wallet again to keep earning.'));
    out.push(note('Moonshard is for verified humans. Connect your Celo wallet and prove you are human (GoodDollar face scan) to play, claim your daily G$ and earn Spoils.'));
    out.push(button('connect', 'CONNECT WALLET', { disabled: busy }));
    if (!s.hasWallet) out.push(warn(NO_WALLET));
  } else {
    if (s.offline) {
      // the gate holds play while the verification cannot be checked: only promise play to a player who is through already
      out.push(warn(canPlay(s)
        ? 'Server unreachable. You can still play; rewards resume when it is back.'
        : "Server unreachable, so we can't check your verification yet. Play opens as soon as it is back."));
    }
    if (s.needsReconnect) {
      out.push(warn('Reconnect your wallet to claim rewards.'));
      out.push(button('reconnect', 'RECONNECT WALLET', { disabled: busy }));
    }
    if (s.wrongChain) {
      out.push(warn('Your wallet is not on the Celo network.'));
      out.push(button('switch', 'SWITCH TO CELO', { disabled: busy }));
    }

    if (status === 'unknown') {
      if (!s.offline) out.push(warn("Can't check your verification right now."));
      out.push(button('recheck', 'TRY AGAIN', { disabled: busy }));
    } else if (status !== 'verified') {
      const copy = status === 'expired'
        ? 'Your GoodDollar verification has expired. Re-verify to keep earning.'
        : "Moonshard is played by verified humans: one human, one slot. GoodDollar's quick face scan proves you are a real person. Moonshard never sees your face.";
      out.push(section("PROVE YOU'RE HUMAN", `<p>${copy}</p>${button('verify', 'VERIFY (FACE SCAN)', { disabled: txDisabled })}${button('recheck', "I'M DONE — CHECK AGAIN", { disabled: busy, cls: 'gd-ghost' })}`));
    } else {
      out.push(section('DAILY G$', dailyHtml(s, txDisabled, now)));
      out.push(section('FIRST-BOSS BOUNTY', bountyHtml(s, txDisabled, now)));
      out.push(section('SPOILS', spoilsHtml(s, txDisabled)));
    }

    if (s.pendingCount > 0) {
      out.push(note(`${s.pendingCount} payment${s.pendingCount === 1 ? '' : 's'} waiting to be recorded — retrying automatically.`));
    }
    out.push(button('disconnect', 'DISCONNECT', { disabled: busy, cls: 'gd-ghost' }));
  }

  out.push('<a class="gd-link" href="/stats.html" target="_blank" rel="noopener">PUBLIC STATS ▸</a>');
  return out.join('');
}
