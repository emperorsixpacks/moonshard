import { GAME } from "../config.js";

/*
 * Endless levels, the server's side. The ladder itself is the client's (src/engine/levels.js): a run reports the level it ended
 * on, the server bounds that by the kills the run claims, and keeps the deepest level of each player's ranked runs. That level
 * opens the blades that ask for one (shop.js): they are earned in the arena as well as paid for.
 */

/**
 * The deepest level a run with this many kills can have ended on. A run is in level n only after killing every foe of levels 1
 * to n - 1, and no level has fewer than GAME.LEVELS.MIN_FOES_PER_LEVEL, so n - 1 levels cost at least that many kills each.
 * KILLS_SLACK covers a kill the client's count missed. The bound is loose on purpose (real levels have 15 to 34 foes): it
 * stops a made-up level, and an honest count of kills cannot fail it.
 */
export const levelCeiling = (kills) => 1 + Math.floor((kills + GAME.KILLS_SLACK) / GAME.LEVELS.MIN_FOES_PER_LEVEL);

/**
 * The deepest level a player has reached in a RANKED run, 0 when there is none. Ranked: verified, unflagged, played for a while
 * (runs.js), so a level claimed by a run the server doubts opens nothing. By the player (subject) or by any of their wallets,
 * the way ownedItems reads purchases: a wallet that played before it was verified as someone's second wallet is theirs now.
 */
export async function bestLevel(ctx, subject) {
  const { rows } = await ctx.db.query(
    `SELECT COALESCE(MAX(level), 0)::int AS best FROM runs
      WHERE ranked_ok AND level IS NOT NULL
        AND (subject = $1 OR wallet IN (SELECT address FROM wallets WHERE subject = $1))`,
    [subject],
  );
  return rows[0].best;
}
