import { GAME, SCORE_MODEL } from "../config.js";

/*
 * Endless levels, the server's side. The ladder itself is the client's (src/engine/levels.js): a run reports the level it ended
 * on, the server bounds that by the kills the run claims and the time those kills take, and keeps the deepest level of each
 * player's ranked runs. That level opens the blades and armour that ask for one (shop.js): they are earned in the arena as
 * well as paid for.
 *
 * The level is still the client's word. The bound makes a made-up level cost real waiting (about 45 s for level 8, about three
 * minutes for level 25, against more than four and a half minutes of honest play for the last), not impossible: without
 * replaying the run the server cannot tell a script that waits and claims those kills from a player who made them. So depth
 * is progression, not security. The G$ fee is the gate that holds.
 */

/** The most kills a run of `seconds` of play can honestly have: SCORE_MODEL.KILLS_PER_SEC a second, and a burst's worth over. */
const killsBy = (seconds) => Math.floor(SCORE_MODEL.KILLS_PER_SEC * seconds) + 2 * GAME.KILLS_SLACK;

/**
 * The deepest level a run with this many kills, played for this many seconds, can have ended on. A run is in level n only after
 * killing every foe of levels 1 to n - 1, and no level has fewer than GAME.LEVELS.MIN_FOES_PER_LEVEL, so n - 1 levels cost at
 * least that many kills each; and no human kills more than SCORE_MODEL.KILLS_PER_SEC foes a second for long (killsBy), so
 * claiming more kills than the time allows buys no depth. KILLS_SLACK covers a kill the client's count missed. Both bounds are
 * loose on purpose (real levels have 15 to 34 foes): an honest run cannot fail them. Without `seconds` only the kills count.
 */
export const levelCeiling = (kills, seconds = Infinity) =>
  1 + Math.floor((Math.min(kills, killsBy(seconds)) + GAME.KILLS_SLACK) / GAME.LEVELS.MIN_FOES_PER_LEVEL);

/**
 * The deepest level a player has reached in a RANKED run, 0 when there is none. Ranked: verified, unflagged, played for a while
 * (runs.js), so a level claimed by a run the server doubts opens nothing. By the player (subject) or by any of their wallets,
 * the way ownedItems reads purchases: a wallet that played before it was verified as someone's second wallet is theirs now.
 *
 * Two lookups, one for each way of being theirs, joined by UNION ALL: written as `subject = $1 OR wallet IN (...)` the planner
 * cannot use either partial index for one player, and reads every ranked Endless run in the table on each call.
 */
export async function bestLevel(ctx, subject) {
  const { rows } = await ctx.db.query(
    `SELECT COALESCE(MAX(level), 0)::int AS best FROM (
       SELECT level FROM runs WHERE ranked_ok AND level IS NOT NULL AND subject = $1
       UNION ALL
       SELECT r.level FROM wallets w JOIN runs r ON r.wallet = w.address
        WHERE w.subject = $1 AND r.ranked_ok AND r.level IS NOT NULL
     ) reached`,
    [subject],
  );
  return rows[0].best;
}
