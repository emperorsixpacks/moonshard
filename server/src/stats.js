import express from "express";
import { formatUnits } from "viem";
import { ah } from "./http.js";
import { DAY_MS, dayKey } from "./time.js";

const CACHE_MS = 60_000;

/**
 * What each number is backed by (the public stats page should label them accordingly):
 *
 *   Chain-backed
 *     verifiedPlayers      users whose wallet the identity contract has ever vouched for (users.root is set from
 *                          getWhitelistedRoot() and never cleared): "ever verified", NOT "verified now".
 *     verifiedActiveToday  distinct verified players with a finished (submitted) run today. runs.verified is the
 *                          chain's answer at the moment the run started, so a player whose verification has lapsed
 *                          does not count. This is the honest "real people playing today".
 *     ubiClaimsTotal / ubiClaimsToday   recorded only after the claim's receipt shows the UBI scheme's UBIClaimed event.
 *     engagementClaims     recorded only after the receipt shows the Engagement Rewards RewardClaimed event.
 *     spoilsPaidG          recorded only from Claimed events of the vault in a confirmed receipt.
 *     shopPurchases / shopSpentG   Moon Shop purchases, recorded only from the G$ token's Transfer event into the vault
 *                          in a confirmed receipt (shop.js).
 *   Self-reported (free wallets count: anyone can make a wallet and sign in without verifying)
 *     walletsConnected     every wallet that ever signed in.
 *     runsToday            finished runs today, verified or not.
 *     activeToday          distinct players who STARTED a run today (finished or not), verified or not.
 *     series[].runs / .active   finished runs and distinct players per day, verified or not.
 *   Computed by the server
 *     spoilsIssuedG        what settlement has granted (prizes and shard harvests; vouchers are signed for verified players).
 */
async function compute(ctx) {
  const now = ctx.now();
  const today = dayKey(now);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(now - (6 - i) * DAY_MS));
  const q = async (sql, params = []) => (await ctx.db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0];

  const verified = await one("SELECT count(*)::int AS n FROM users WHERE root IS NOT NULL");
  const wallets = await one("SELECT count(*)::int AS n FROM wallets");
  const runsToday = await one("SELECT count(*)::int AS n FROM runs WHERE day = $1 AND status = 'submitted'", [today]);
  const activeToday = await one("SELECT count(DISTINCT subject)::int AS n FROM runs WHERE day = $1", [today]);
  const verifiedActiveToday = await one(
    "SELECT count(DISTINCT subject)::int AS n FROM runs WHERE day = $1 AND status = 'submitted' AND verified",
    [today],
  );
  const ubiTotal = await one("SELECT count(*)::int AS n FROM ubi_claims");
  const ubiToday = await one("SELECT count(*)::int AS n FROM ubi_claims WHERE day = $1", [today]);
  const engagement = await one("SELECT count(*)::int AS n FROM engagement_claims");
  const issued = await one("SELECT COALESCE(sum(amount::numeric), 0)::text AS t FROM spoils");
  const paid = await one("SELECT COALESCE(sum(amount::numeric), 0)::text AS t FROM spoil_claims");
  const shop = await one("SELECT count(*)::int AS n, COALESCE(sum(amount::numeric), 0)::text AS t FROM purchases");
  const runRows = await q(
    "SELECT day, count(*)::int AS runs, count(DISTINCT subject)::int AS active FROM runs WHERE day >= $1 AND status = 'submitted' GROUP BY day",
    [days[0]],
  );
  const ubiRows = await q("SELECT day, count(*)::int AS n FROM ubi_claims WHERE day >= $1 GROUP BY day", [days[0]]);

  return {
    verifiedPlayers: verified.n,
    walletsConnected: wallets.n,
    runsToday: runsToday.n,
    activeToday: activeToday.n,
    verifiedActiveToday: verifiedActiveToday.n,
    ubiClaimsTotal: ubiTotal.n,
    ubiClaimsToday: ubiToday.n,
    engagementClaims: engagement.n,
    spoilsIssuedG: formatUnits(BigInt(issued.t.split(".")[0]), 18),
    spoilsPaidG: formatUnits(BigInt(paid.t.split(".")[0]), 18),
    shopPurchases: shop.n,
    shopSpentG: formatUnits(BigInt(shop.t.split(".")[0]), 18),
    series: days.map((day) => ({
      day,
      runs: runRows.find((r) => r.day === day)?.runs ?? 0,
      active: runRows.find((r) => r.day === day)?.active ?? 0,
      ubiClaims: ubiRows.find((r) => r.day === day)?.n ?? 0,
    })),
    updatedAt: new Date(now).toISOString(),
  };
}

export function statsRoutes(ctx) {
  const r = express.Router();
  let cache = null;
  r.get("/stats", ah(async (_req, res) => {
    if (!cache || ctx.now() - cache.at > CACHE_MS) cache = { at: ctx.now(), data: await compute(ctx) };
    res.json(cache.data);
  }));
  return r;
}
