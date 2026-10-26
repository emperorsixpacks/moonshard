import express from "express";
import { formatUnits } from "viem";
import { GAME, prizesOn } from "../config.js";
import { ah } from "./http.js";
import { dayKey } from "./time.js";
import { engagementRewardG, hasEngagementClaim, pendingBossRun } from "./engagement.js";
import { ownedItems } from "./shop.js";
import { bestLevel } from "./levels.js";

export function rewardsRoutes(ctx) {
  const r = express.Router();

  r.get("/rewards/status", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const day = dayKey(ctx.now());
    const prizes = prizesOn(ctx.config); // with prizes off, Shards are worth nothing and no harvest is shown
    const rateGd = prizes ? Number(formatUnits(GAME.SHARD_RATE, 18)) : 0;
    const shardRow = await ctx.db.query("SELECT shards FROM shard_days WHERE day = $1 AND subject = $2", [day, p.subject]);
    const shards = shardRow.rows[0]?.shards ?? 0;
    const blessing = await ctx.db.query("SELECT 1 FROM blessings WHERE subject = $1 AND day = $2", [p.subject, day]);
    const bounty = await engagementRewardG(ctx); // what the player receives, same value as /engagement/status rewardG
    res.json({
      wallet: p.wallet,
      dateSeed: day,
      verified: p.verified,
      status: p.status,
      firstBossClaimed: await hasEngagementClaim(ctx, p.subject),
      firstBossPrizeG: bounty === null ? null : Number(bounty),
      prizesEnabled: prizes,
      crystalStatus: {
        gdEarned: Math.min(shards, GAME.DAILY_SHARD_CAP) * rateGd,
        dailyCapGd: GAME.DAILY_SHARD_CAP * rateGd,
        isCapped: prizes && shards >= GAME.DAILY_SHARD_CAP,
        shards,
        rateGd,
      },
      blessing: blessing.rows.length > 0,
      pendingBossRunId: await pendingBossRun(ctx, p.subject),
      owned: await ownedItems(ctx, p.subject), // Moon Shop items (shop.js)
      bestLevel: await bestLevel(ctx, p.subject), // the deepest Endless level reached in a ranked run (levels.js); opens the blades that ask for one
    });
  }));

  return r;
}
