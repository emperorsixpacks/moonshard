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
 * What a connected player's rewards come to, as the server reported them: the first-boss bounty (an amount or cap the server
 * did not send is left out) and the day's Shard Harvest, which is null while the server pays no prizes.
 * @returns {{ claimed: boolean, prize: number|null, harvest: { earned: string, cap: string|null, capped: boolean }|null }}
 */
export function rewardsFacts(status) {
  const cap = positiveNumber(status.crystalStatus?.dailyCapGd);
  return {
    claimed: Boolean(status.firstBossClaimed),
    prize: positiveNumber(status.firstBossPrizeG),
    harvest: status.prizesEnabled === false ? null : {
      earned: Number(status.crystalStatus?.gdEarned || 0).toFixed(0),
      cap: cap === null ? null : cap.toFixed(0),
      capped: Boolean(status.crystalStatus?.isCapped),
    },
  };
}

/**
 * The first-boss bounty and the day's Shard Harvest, in words, for a connected player: "First boss: unclaimed (2400 G$)" and
 * "Harvest today: 4 / 100 G$". An amount or cap the server did not send is left out, and so is the harvest itself while the
 * server pays no prizes.
 * @returns {{ boss: string, harvest: string|null }}
 */
export function rewardsLine(status) {
  const { claimed, prize, harvest } = rewardsFacts(status);
  const boss = claimed
    ? `First boss: claimed${prize === null ? '' : ` (+${prize} G$)`}`
    : `First boss: unclaimed${prize === null ? '' : ` (${prize} G$)`}`;
  if (!harvest) return { boss, harvest: null };
  const amount = harvest.cap === null ? `${harvest.earned} G$` : `${harvest.earned} / ${harvest.cap} G$`;
  return { boss, harvest: `Harvest today: ${amount}${harvest.capped ? ' (full)' : ''}` };
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

/**
 * The honors cell of a row: a medal for the top three (gold, silver, bronze), with the prize amount on the daily board when
 * the server named one. Everyone else has none.
 * @returns {{ medal: 'gold'|'silver'|'bronze', amount: string|null }|null}
 */
export function honorsFor(idx, amount) {
  const medal = ['gold', 'silver', 'bronze'][idx];
  if (!medal) return null;
  const n = positiveNumber(amount);
  return { medal, amount: n === null ? null : String(n) };
}

/** The three daily prize amounts, from the config or else from the daily board itself, or null when neither has them. */
export function dailyPrizeAmounts(cfg, daily) {
  for (const source of [cfg?.prizesG, daily?.prizesG]) {
    if (!Array.isArray(source) || source.length < 3) continue;
    const top = source.slice(0, 3);
    if (top.every((p) => positiveNumber(p) !== null)) return top.map(String);
  }
  return null;
}
