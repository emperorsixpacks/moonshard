/**
 * What the leaderboard screen says in words, as plain functions of what the server sent (no Phaser, so they can be
 * tested). The rule for every amount: it comes from the server or it is left out. A number on a reward screen is a
 * promise, so none is filled in from a guess.
 */

/** A finite number above zero (a number or a numeric string), else null. */
export function positiveNumber(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * "1st Boss" and "Harvest" status line for a connected player. An amount or cap the server did not send is left out, and so
 * is the Shard Harvest (a prize) while the server pays no prizes.
 */
export function rewardsPillText(status) {
  const prize = positiveNumber(status.firstBossPrizeG);
  const bossText = status.firstBossClaimed
    ? `CLAIMED${prize === null ? '' : ` (+${prize} G$)`}`
    : `UNCLAIMED${prize === null ? '' : ` (${prize} G$)`}`;
  if (status.prizesEnabled === false) return `🏆 1st Boss: ${bossText}`;
  const cap = positiveNumber(status.crystalStatus?.dailyCapGd);
  const earned = Number(status.crystalStatus?.gdEarned || 0).toFixed(0);
  const amount = cap === null ? `${earned} G$` : `${earned} / ${cap.toFixed(0)} G$`;
  const harvestText = status.crystalStatus?.isCapped ? `${amount} (MAX 🔒)` : amount;
  return `🏆 1st Boss: ${bossText}  |  💎 Harvest: ${harvestText}`;
}

/**
 * The explanation in the "daily Spoils settlement" panel. `prizes` is the three daily prize amounts (or null) and
 * `shardCapG` the most the Shard Harvest pays in a day (or null), both as the server reported them.
 */
export function spoilsPanelDetail({ prizes, shardCapG }) {
  const cap = positiveNumber(shardCapG);
  return [
    prizes ? `Top-3 verified daily runs win ${prizes.join('/')} G$ at UTC midnight.` : 'Top-3 verified daily runs win G$ at UTC midnight.',
    cap === null ? 'Shards you collect are paid as G$ too.' : `Shards you collect are paid as G$ too (up to ${cap} G$/day).`,
    'Open the G$ wallet in the header to redeem your Spoils.',
  ].join('\n');
}

export function shortAddress(addr) {
  const clean = String(addr || '').replace(/\s+/g, '');
  if (clean.length < 10) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

export function secondsLabel(durationMs) {
  const s = Number(durationMs) || 0;
  return `${Math.floor(s / 1000)}s`;
}

/** The prize cell of a daily-board row: a medal and the amount for the top three, a tree for everyone else. */
export function prizeLabel(idx, amount) {
  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
  if (idx < 3) return medal && amount ? `${medal} ${amount} G$` : (medal || '🌲');
  return '🌲';
}
