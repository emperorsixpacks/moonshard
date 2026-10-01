import express from "express";
import { formatUnits } from "viem";
import { GAME } from "../config.js";
import { ah } from "./http.js";
import { dayKey } from "./time.js";
import { hasEngagementClaim, pendingBossRun } from "./engagement.js";

export function rewardsRoutes(ctx) {
  const r = express.Router();

  r.get("/rewards/status", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const day = dayKey(ctx.now());
    const rateGd = Number(formatUnits(GAME.SHARD_RATE, 18));
    const shardRow = await ctx.db.query("SELECT shards FROM shard_days WHERE day = $1 AND subject = $2", [day, p.subject]);
    const shards = shardRow.rows[0]?.shards ?? 0;
    const blessing = await ctx.db.query("SELECT 1 FROM blessings WHERE subject = $1 AND day = $2", [p.subject, day]);
    res.json({
      wallet: p.wallet,
      dateSeed: day,
      verified: p.verified,
      status: p.status,
      firstBossClaimed: await hasEngagementClaim(ctx, p.subject),
      firstBossPrizeG: Number(GAME.ENGAGEMENT_REWARD_G),
      crystalStatus: {
        gdEarned: Math.min(shards, GAME.DAILY_SHARD_CAP) * rateGd,
        dailyCapGd: GAME.DAILY_SHARD_CAP * rateGd,
        isCapped: shards >= GAME.DAILY_SHARD_CAP,
        shards,
        rateGd,
      },
      blessing: blessing.rows.length > 0,
      pendingBossRunId: await pendingBossRun(ctx, p.subject),
    });
  }));

  return r;
}
