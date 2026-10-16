import { GAME_CONFIG } from '../config.js';
import { explorerAddress, explorerTx } from '../gd/config.js';
import { explainError, formatCountdown, formatG } from '../gd/format.js';
import { identiconSvg } from '../gd/identicon.js';
import { canPlay, entryBlade, gateStep } from '../engine/playGateRules.js';
import { ico } from './icons.js';

/**
 * The wallet and the way into the game, as pure functions of the service status (no DOM, no service import), so every
 * state they can be in is testable. Everything that comes from the server or the wallet is escaped, or is a number, or is
 * looked up in a fixed table: nothing is interpolated into the markup as-is.
 *
 * Two views share one sheet (src/ui/sheet.js):
 *   - the wallet: who you are, your G$, today's claim, and anything waiting for you;
 *   - the way in (the "gate"): shown when a player tries to start a mode they may not play yet. One step at a time.
 */

const LABELS = {
  anonymous: 'Not connected',
  unknown: 'Checking…',
  unverified: 'Not verified yet',
  verified: 'Verified human',
  expired: 'Verification expired',
};

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** kind: 'gold' (the one main action), 'plain' (a second choice) or 'ghost' (a quiet text button). */
const KIND = { gold: 'gold btn', plain: 'btn-2', ghost: 'btn-ghost' };
const button = (act, label, { disabled = false, id = '', kind = 'gold', cls = '' } = {}) =>
  `<button type="button" class="${KIND[kind]}${cls ? ` ${cls}` : ''}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;

const NO_WALLET = 'No wallet detected. Open Moonshard inside GoodWallet (or any wallet app\'s browser), or install a browser wallet such as MetaMask and reload this page.';

const note = (text) => `<p class="note">${text}</p>`;
const warn = (text) => `<p class="note gd-warn">${text}</p>`;
const lead = (text) => `<p class="lead">${text}</p>`;
const secH = (text) => `<h4 class="sec-h">${text}</h4>`;
/** A note that runs the full width of a wide sheet (on a phone every block does). */
const wide = (text) => `<p class="note wide">${text}</p>`;
/** One column of a wide sheet's two-column layout: the sheet lays these side by side, and a phone stacks their contents. */
const col = (html) => `<div class="col">${html}</div>`;

/** A wallet's icon, only when it is an image inside the page itself (never one fetched from elsewhere). */
const walletIcon = (w) => (typeof w.icon === 'string' && /^data:image\//i.test(w.icon)
  ? `<img class="gd-wallet-icon" src="${esc(w.icon)}" alt="" width="22" height="22">`
  : '');

/**
 * The connect step. Wallet extensions announce themselves (EIP-6963): with several installed there is one button for each
 * (window.ethereum would reach only one of them, or a broken one when two fight over it); with one, its button names it;
 * with none announced, the plain button reaches window.ethereum or WalletConnect.
 */
function connectHtml(s, busy) {
  const wallets = Array.isArray(s.wallets) ? s.wallets : [];
  if (wallets.length > 1) {
    const buttons = wallets.map((w) => button('connect', `${walletIcon(w)}<span>${esc(w.name)}</span>`, { id: w.id, disabled: busy, kind: 'plain', cls: 'gd-wallet' }));
    return `<p class="note">Choose your wallet</p><div class="gd-wallets">${buttons.join('')}</div>`;
  }
  if (wallets.length === 1) {
    return button('connect', `${walletIcon(wallets[0])}<span>Connect ${esc(wallets[0].name)}</span>`, { id: wallets[0].id, disabled: busy, cls: 'gd-wallet' });
  }
  return `${button('connect', 'Connect wallet', { disabled: busy })}${s.hasWallet ? '' : warn(NO_WALLET)}`;
}

/** A server "reason" is either a sentence (shown) or a code (looked up); never shown raw. */
const reasonText = (reason) => (/\s/.test(String(reason)) ? String(reason).slice(0, 120) : explainError(String(reason || 'not_claimable')));

const txLink = (hash) => `<a class="lnk" href="${esc(explorerTx(hash))}" target="_blank" rel="noopener">View transaction</a>`;

/** G$ in a wallet, rounded down: a balance shown as "20" must be able to pay 20. */
const walletG = (g) => formatG(Math.floor(Number(g) * 100) / 100, 2);

/** The text on the G$ button in the page header: a verified player's balance, once it is known. */
export function walletPillText(s) {
  if (!s.connected) return 'G$';
  if (!s.verified) return s.shortAddress || 'G$';
  if (s.balance == null) return 'G$ ✔';
  const g = Math.floor(Number(s.balance) * 100) / 100;
  return `G$ ${g >= 1000 ? formatG(Math.floor(g)) : formatG(g, 2)}`;
}
/** Known to hold less than `priceG` (an unknown balance is not short: the wallet checks before anything is sent). */
const isShort = (s, priceG) => s.balance != null && Number(s.balance) < Number(priceG);

const sparkleCard = (title, inner) => `<div class="perk">${ico('sparkle', 26)}<div><b>${title}</b>${inner}</div></div>`;

/** Who the player is: their avatar, how far they have got, and (when verified) the tick, the one green in the interface. */
function identityHtml(s, label) {
  const host = s.host !== 'browser' ? ` • ${esc(String(s.host).toUpperCase())}` : '';
  return `<div class="idrow" data-status="${esc(label.status)}"><span class="avatar">${identiconSvg(s.address)}</span><div class="idt"><b>${esc(label.text)}</b><small>${esc(s.shortAddress)}${host}</small></div>${s.verified ? ico('check', 24) : ''}</div>`;
}

/** The balance, as the coin purse. */
const purseHtml = (s) => (s.balance == null ? '' : `<div class="purse">${ico('coin', 40)}<div class="bal"><span class="bal-n">${walletG(s.balance)}</span><span class="bal-u">G$</span></div></div>`);

function claimHtml(s, txDisabled, now) {
  const ubi = s.ubi;
  let html = '';
  if (s.awaiting?.ubi) {
    html += `${note('Claim sent ✓ waiting for the network to confirm.')}${txLink(s.awaiting.ubi)}`;
  } else if (!ubi) {
    html += note('Daily G$ status unavailable right now.');
  } else if (ubi.canClaim) {
    html += `<div class="claimcard">${lead("Today's free G$ is ready.")}<small>${formatG(ubi.entitlementG, 2)} G$, free once a day for verified humans.</small></div>${button('ubi', `${ico('coin', 26)}Claim today's G$`, { disabled: txDisabled })}`;
  } else {
    const left = ubi.nextClaimAt ? ubi.nextClaimAt - now : null;
    const next = left != null && left > 0 ? `<span class="nx">Next claim in <b>${formatCountdown(left)}</b></span>` : '';
    // how much of the day has passed since the last claim: the bar fills as the next one gets closer
    const meter = left != null && left > 0
      ? `<div class="meter" role="img" aria-label="Time until the next claim"><i style="width:${Math.round(Math.min(1, Math.max(0, 1 - left / 86_400_000)) * 100)}%"></i></div>`
      : '';
    html += `<div class="claimed"><div class="cl-h">${ico('tick', 18)}<b>Claimed today</b>${next}</div>${meter}</div>`;
  }
  if (s.blessing) {
    html += sparkleCard("Citizen's Blessing", '<small>+25% forge materials today</small>');
  } else if (ubi?.canClaim) {
    html += note("Claim your daily G$ to receive the Citizen's Blessing (+25% forge materials).");
  }
  const c = s.rewards?.crystalStatus;
  if (c && s.prizes === true) html += note(`Shards today: ${formatG(c.gdEarned)} / ${formatG(c.dailyCapGd)} G$ (paid after UTC midnight)`);
  if (s.stale?.ubi || s.stale?.rewards) html += note('Could not be refreshed just now. Showing the last known info.');
  return html;
}

/** The first-boss bounty. Nothing is shown for a server that has none yet; an amount the server did not give is never named. */
function bountyHtml(s, txDisabled, now) {
  const b = s.bounty;
  let inner;
  if (s.awaiting?.bounty) {
    inner = `${note('Bounty sent. Waiting for the network to confirm.')}${txLink(s.awaiting.bounty)}`;
  } else if (!b) {
    inner = note(s.stale?.bounty ? 'Boss bounty status unavailable right now.' : 'Checking the boss bounty…');
  } else if (!b.configured) {
    return '';
  } else if (b.claimedHere) {
    inner = '<p class="gd-claimed">✔ First-boss bounty claimed.</p>';
  } else {
    // the amount is shown only when the server gave one: the player's share is not the protocol's headline number
    const amount = Number(b.rewardG) > 0 ? `${formatG(b.rewardG)} G$` : null;
    if (b.pendingRunId) {
      if (b.canClaim === false) {
        inner = warn(esc(reasonText(b.reason)));
      } else {
        // the server only signs for a boss kill from the last 24 h: say how long is left, and never offer a refused claim
        const left = b.attestExpiresAt ? Date.parse(b.attestExpiresAt) - now : null;
        if (left !== null && Number.isFinite(left) && left <= 0) {
          inner = warn('Too late: the claim window for that boss kill has closed. Defeat a boss again to unlock the bounty.');
        } else {
          const window = left !== null && Number.isFinite(left) ? note(`Claim within ${formatCountdown(left)}.`) : '';
          inner = `${lead('Boss defeated! Claim your one-time reward.')}${window}${button('bounty', amount ? `Claim ${amount} bounty` : 'Claim bounty', { disabled: txDisabled })}`;
        }
      }
    } else if (b.canClaim === false) {
      inner = warn(esc(reasonText(b.reason))); // never promise an unlock the contract would refuse
    } else {
      inner = note(`Defeat a chapter boss in Story Mode to unlock a one-time ${amount ? `bounty of ${amount}` : 'G$ bounty'}.`);
    }
  }
  return `<section class="gd-sec">${secH('First-boss bounty')}${inner}</section>`;
}

function spoilsHtml(s, txDisabled) {
  if (!s.spoils.length) {
    return s.stale?.spoils
      ? warn('Spoils are unavailable right now. Try again in a moment.')
      : note('No Spoils yet. Reach the top 3 of the verified daily board or collect Shards. Settled after UTC midnight.');
  }
  const rows = s.spoils.map((sp) => {
    const label = sp.kind === 'TRIAL_PRIZE' ? `Daily prize #${Number(sp.rank) || '-'}` : 'Shard harvest';
    let action;
    if (sp.claimed) action = '<span class="gd-claimed">✔ Claimed</span>';
    else if (s.awaiting?.spoils?.[sp.id]) action = '<span class="note">confirming…</span>';
    else if (sp.voucher) action = button('redeem', 'Redeem', { id: sp.id, disabled: txDisabled, kind: 'plain', cls: 'gd-small' });
    else action = '<span class="note">unavailable</span>';
    return `<div class="gd-spoil"><span>${label}<small>${esc(sp.day)} • ${formatG(sp.amountG)} G$</small></span>${action}</div>`;
  });
  if (s.stale?.spoils) rows.push(note('Could not be refreshed just now. Showing the last known Spoils.'));
  return rows.join('');
}

/**
 * The way-in's blade step: the blade a hero fights with is paid for in G$. A player known to be short of the price is not
 * offered a purchase that would fail: today's free claim comes first, or when the next one does.
 */
function bladeHtml(s, blade, txDisabled, now) {
  const price = formatG(blade.priceG, 2);
  const short = isShort(s, blade.priceG);
  const out = [
    `<div class="item"><div class="pedestal">${ico('sword', 64)}</div><div class="item-t"><span class="kind">Starter blade</span><b>${esc(blade.name)}</b><small>Your hero needs a blade to fight.</small></div></div>`,
    `<div class="pair"><div><small>Price</small><b>${ico('coin', 24)}${price}</b></div><div${short ? ' class="low"' : ''}><small>You have</small><b>${ico('coin', 24)}${s.balance == null ? '—' : `<span class="have">${walletG(s.balance)}</span>`}</b></div></div>`,
    note(`What you pay goes into Moonshard's prize vault${s.prizes === true ? ', which pays the daily prizes' : ' on Celo'}.`),
  ];
  const sent = s.awaiting?.shop?.[blade.id];
  if (sent) {
    out.push(`${note('Payment sent ✓ waiting for the network to confirm.')}${txLink(sent)}`);
  } else if (!short) {
    out.push(button('buy', `Buy for ${price} G$`, { id: blade.id, disabled: txDisabled }));
  } else {
    out.push(warn(`You need ${price} G$.`));
    if (s.awaiting?.ubi) out.push(`${note('Claim sent ✓ waiting for the network to confirm.')}${txLink(s.awaiting.ubi)}`);
    else if (s.ubi?.canClaim) out.push(`${note(`Today's free G$ covers it: ${formatG(s.ubi.entitlementG, 2)} G$.`)}${button('ubi', `${ico('coin', 26)}Claim today's G$`, { disabled: txDisabled })}`);
    else if (s.ubi?.nextClaimAt) out.push(note(`Your next free G$ comes in <b>${formatCountdown(s.ubi.nextClaimAt - now)}</b>. You can also add G$ to this wallet from another one.`));
    else out.push(note('Add G$ to this wallet to buy it.'));
  }
  return out.join('');
}

/** What the player asked to start, in words: "the story", "Endless mode". */
const MODES = { 'STORY MODE': 'the story', 'ENDLESS MODE': 'Endless mode' };
export const modeName = (label) => MODES[label] ?? (String(label || 'the game').charAt(0) + String(label || 'the game').slice(1).toLowerCase());

/** The steps before play, by name; the blade is a step of its own on a server with a Moon Shop. */
function gateNodes(s) {
  const blade = s.shop?.enabled ? entryBlade(s.shop) : null;
  return { blade, names: ['Connect', 'Verify', ...(blade ? ['Blade'] : [])] };
}

/** The title of the way-in sheet: the step the player is on. */
export function gateTitle(s) {
  switch (gateStep(s)) {
    case 'connect': return 'Connect your wallet';
    case 'checking': return s.verified ? 'Checking your blade' : 'Checking your account';
    case 'unreachable': return "Can't reach the server";
    case 'verify': return s.status === 'expired' ? 'Verify again' : 'Prove you are human';
    case 'blade': return 'Get your blade';
    default: return 'You are in';
  }
}

/** The title of whatever the sheet is showing. */
export const panelTitle = (s, { gate = null } = {}) => (gate ? gateTitle(s) : 'Wallet');

/**
 * The way in, shown when the player tries to start a mode they may not play yet: the steps, the current one marked, and the
 * one action that moves them forward. `gate.label` names the mode they asked for.
 */
function gateHtml(s, gate, busy, txDisabled, now) {
  const step = gateStep(s);
  const { blade, names } = gateNodes(s);
  const about = s.verified ? 2 : 1; // "checking" and "unreachable" are about the blade once the player is verified
  const at = { connect: 0, checking: about, unreachable: about, verify: 1, blade: 2, ready: names.length }[step];
  const steps = names.map((text, i) => {
    const cls = i < at ? 'done' : i === at ? 'now' : '';
    return `<li class="${cls}" data-step="${text.toLowerCase()}">${ico(i <= at ? 'shard' : 'shardo', 22)}${text}</li>`;
  });
  let action;
  if (step === 'connect') {
    action = `${lead('Moonshard is for real people: one human, one slot. Connect a Celo wallet to get started.')}${connectHtml(s, busy)}`;
  } else if (step === 'checking') {
    action = note(s.verified ? 'Checking your blade…' : 'Checking your verification…');
  } else if (step === 'unreachable') {
    action = `${warn(`Can't reach the server to check your ${s.verified ? 'blade' : 'verification'}.`)}${button('recheck', 'Try again', { disabled: busy })}`;
  } else if (step === 'blade') {
    action = bladeHtml(s, blade, txDisabled, now);
  } else if (step === 'verify') {
    const expired = s.status === 'expired';
    action = `${lead(expired ? 'Your GoodDollar verification has expired. Verify again to play.' : "A quick face scan from GoodDollar proves you are a real person. Moonshard never sees your face.")}${button('verify', 'Start face scan', { disabled: txDisabled })}${button('recheck', "I'm done, check again", { disabled: busy, kind: 'ghost' })}`;
  } else {
    action = `${lead(blade ? 'You are verified and your blade is ready.' : 'You are verified.')}${button('play', `Play ${esc(modeName(gate.label))}`, { disabled: busy })}`;
  }
  return `<ol class="stepper" aria-label="Steps">${steps.join('')}</ol>${action}`;
}

/** The sheet's body. */
export function renderPanelHtml(s, now = Date.now(), { gate = null, config = null, howOpen = false } = {}) {
  const busy = Boolean(s.busy);
  const txDisabled = busy || s.wrongChain || s.needsReconnect;
  const status = Object.hasOwn(LABELS, s.status) ? s.status : 'anonymous'; // never interpolate server text into markup
  const label = { status, text: status === 'unknown' && s.offline ? 'Server offline' : LABELS[status] };
  const out = [];

  if (busy) out.push(wide('Working… confirm in your wallet if asked.'));

  if (gate) {
    if (!s.connected && s.sessionExpired) out.push(warn('Your session ended. Connect your wallet again to keep playing.'));
    if (s.connected && s.needsReconnect && gateStep(s) !== 'ready') out.push(warn('Reconnect your wallet to continue.'));
    out.push(gateHtml(s, gate, busy, txDisabled, now));
    if (s.connected) out.push(button('disconnect', 'Disconnect', { disabled: busy, kind: 'ghost' }));
  } else if (!s.connected) {
    // why on the left, which wallet on the right
    const why = `${s.sessionExpired ? warn('Your session ended. Connect your wallet again to keep earning.') : ''}${lead('Moonshard is for verified humans. Connect your Celo wallet and prove you are human (GoodDollar face scan) to claim your daily G$ and play.')}`;
    out.push(col(why), col(connectHtml(s, busy)));
  } else {
    // the top row of a wide sheet: who the player is (and what is wrong with the connection) beside the next thing to do
    const who = [identityHtml(s, label)];
    if (s.offline) {
      // the gate holds play while the verification cannot be checked: only promise play to a player who is through already
      who.push(warn(canPlay(s)
        ? 'Server unreachable. You can still play; rewards resume when it is back.'
        : "Server unreachable, so we can't check your verification yet. Play opens as soon as it is back."));
    }
    if (s.needsReconnect) {
      who.push(warn('Reconnect your wallet to claim rewards.'));
      who.push(button('reconnect', 'Reconnect wallet', { disabled: busy }));
    }
    if (s.wrongChain) {
      who.push(warn('Your wallet is not on the Celo network.'));
      who.push(button('switch', 'Switch to Celo', { disabled: busy }));
    }

    let next = '';
    if (status === 'unknown') {
      next = `${s.offline ? '' : warn("Can't check your verification right now.")}${button('recheck', 'Try again', { disabled: busy })}`;
    } else if (status !== 'verified') {
      const copy = status === 'expired'
        ? 'Your GoodDollar verification has expired. Verify again to keep earning.'
        : "Moonshard is played by verified humans: one human, one slot. GoodDollar's quick face scan proves you are a real person. Moonshard never sees your face.";
      next = `${lead(copy)}${button('verify', 'Start face scan', { disabled: txDisabled })}${button('recheck', "I'm done, check again", { disabled: busy, kind: 'ghost' })}`;
    } else {
      next = purseHtml(s);
    }
    out.push(col(who.join('')), col(next));

    if (status === 'verified') {
      // the day's claim on the left, what is still to win on the right
      let more = bountyHtml(s, txDisabled, now);
      // Prizes are paid only while the server pays them (PRIZES_ENABLED); Spoils already won stay redeemable either way
      if (s.prizes === true || s.spoils.length > 0) more += `<section class="gd-sec">${secH('Spoils')}${spoilsHtml(s, txDisabled)}</section>`;
      out.push(col(claimHtml(s, txDisabled, now)), col(more));
    }

    if (s.pendingCount > 0) {
      out.push(wide(`${s.pendingCount} payment${s.pendingCount === 1 ? '' : 's'} waiting to be recorded. Retrying automatically.`));
    }
  }

  // The reference card and the footer belong to the wallet: the way in keeps the player on its one step.
  if (!gate) {
    out.push(howHtml(s, config, { open: howOpen }));
    const links = ['<a class="lnk" href="/stats.html" target="_blank" rel="noopener">Public stats</a>'];
    if (s.connected) links.push(button('disconnect', 'Disconnect', { disabled: busy, kind: 'ghost', cls: 'lnk' }));
    out.push(`<div class="foot">${links.join('')}</div>`);
  }
  return out.join('');
}

/* ---- How G$ works: what G$ is, what it buys, how it comes back, where it goes. Amounts come from the server. ---- */

const gText = (v) => `${formatG(v, 2)} G$`;
const SKINS = new Set(Object.values(GAME_CONFIG.WEAPONS).filter((w) => w.isSkin).map((w) => w.id));
const CELESTIAL = new Set(Object.values(GAME_CONFIG.WEAPONS).filter((w) => w.tier === 'Celestial Blade').map((w) => w.id));

/** "100 G$ each" for a group at one price, "from 80 G$" for a group at several. */
function groupPrice(items) {
  const prices = [...new Set(items.map((x) => Number(x.priceG)))];
  if (prices.length > 1) return `from ${gText(Math.min(...prices))}`;
  return items.length > 1 ? `${gText(prices[0])} each` : gText(prices[0]);
}

function looksLine(looks) {
  const skins = looks.filter((x) => SKINS.has(x.id));
  const celestial = looks.filter((x) => CELESTIAL.has(x.id));
  const pet = looks.filter((x) => x.id === 'satchel_pet');
  const other = looks.filter((x) => !skins.includes(x) && !celestial.includes(x) && !pet.includes(x));
  const parts = [];
  if (skins.length) parts.push(`Sword skins: ${groupPrice(skins)}`);
  if (celestial.length) parts.push(`Celestial blades: ${groupPrice(celestial)} (a new look for the Glaive's power; forge the Glaive first)`);
  if (pet.length) parts.push(`Moon Sprite pet: ${groupPrice(pet)}`);
  for (const x of other) parts.push(`${esc(x.name)}: ${gText(x.priceG)}`);
  return parts.join(' · ');
}

function bountyLine(s) {
  const bounty = Number(s.rewards?.firstBossPrizeG ?? s.bounty?.rewardG);
  return bounty > 0
    ? `First-boss bounty: <b>${formatG(bounty)} G$</b>, once, from GoodDollar's Engagement Rewards.`
    : "A one-time G$ bounty for your first boss, from GoodDollar's Engagement Rewards.";
}

function earnLines(s, config) {
  const prizes = Array.isArray(config?.prizesG) && config.prizesG.length ? config.prizesG : null;
  const rate = Number(config?.shardRateG);
  const cap = Number(config?.dailyShardCap);
  return [
    prizes
      ? `Daily prizes: <b>${prizes.map((p) => formatG(p)).join(' / ')} G$</b> for the top 3 verified players of the day.`
      : 'Daily G$ prizes for the top 3 verified players of the day.',
    rate > 0 && cap > 0
      ? `Shard Harvest: ${gText(rate)} a Shard, up to ${gText(rate * cap)} a day.`
      : 'Shard Harvest: G$ for the Shards you collect.',
    bountyLine(s),
  ];
}

/**
 * The reference card at the bottom of the wallet: what G$ is in Moonshard. Amounts come from the server (the shop's
 * catalog, /api/config, the player's bounty share); one the server did not give is left out, never invented. `config`
 * is the /api/config answer, or null. It is a closed block the player opens when they want it; nothing opens it for them.
 */
export function howHtml(s, config = null, { open = false } = {}) {
  const { shop } = s;
  const shopOpen = Boolean(shop?.enabled);
  const blade = shopOpen ? entryBlade(shop) : null;
  // the daily prizes and the Shard Harvest are promised only while the server pays them (PRIZES_ENABLED)
  const prizes = (config?.prizesEnabled ?? s.prizes) === true;
  const li = (icon, text) => `<li>${ico(icon, 22)}<span>${text}</span></li>`;
  const items = [
    li('coin', "G$ is GoodDollar: a free daily income for verified humans, on the Celo network. Claim it once a day. Claiming also brings the Citizen's Blessing: +25% forest materials that day."),
  ];
  if (!shop) {
    items.push(li('sword_clean', 'The prices could not be loaded right now.'));
  } else if (!shopOpen) {
    items.push(li('sword_clean', 'On this server your first blade is free, and blades are forged from forest materials alone.'));
  } else {
    if (blade) items.push(li('sword_clean', `Your hero fights with the <b>${esc(blade.name)}</b>: ${gText(blade.priceG)}. No blade, no fight: it is the last step before you play.`));
    const forge = shop.items.filter((x) => x.kind === 'forge');
    if (forge.length) items.push(li('anvil', `Stronger blades: ${forge.map((x) => `<b>${esc(x.name)}</b> forest materials + ${gText(x.priceG)}`).join(' · ')}. The materials only come from playing, so G$ alone never buys power.`));
    const looks = shop.items.filter((x) => x.kind === 'cosmetic');
    if (looks.length) items.push(li('sparkle', `The Moon Shop sells looks only: ${looksLine(looks)}. Nothing here adds power. Find them in the Forge.`));
  }
  if (prizes) earnLines(s, config).forEach((t) => items.push(li('trophy', t)));
  else items.push(li('trophy', bountyLine(s)));
  if (shopOpen) {
    const vault = `<a class="lnk" href="${esc(explorerAddress(shop.vault))}" target="_blank" rel="noopener">prize vault</a>`;
    items.push(li('chest', prizes
      ? `Every G$ you pay goes into Moonshard's ${vault}, which pays the daily prizes and the Shard Harvests. All of it happens on the Celo chain.`
      : `Every G$ you pay goes into Moonshard's ${vault} on the Celo chain, where anyone can see it.`));
  }
  return `<details class="how"${open ? ' open' : ''}><summary>How G$ works${ico('chev', 16)}</summary><ul>${items.join('')}</ul></details>`;
}
