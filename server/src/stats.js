import express from "express";
import { formatUnits } from "viem";
import { ah } from "./http.js";
import { DAY_MS, dayKey } from "./time.js";

const CACHE_MS = 60_000;

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
  const ubiTotal = await one("SELECT count(*)::int AS n FROM ubi_claims");
  const ubiToday = await one("SELECT count(*)::int AS n FROM ubi_claims WHERE day = $1", [today]);
  const engagement = await one("SELECT count(*)::int AS n FROM engagement_claims");
  const issued = await one("SELECT COALESCE(sum(amount::numeric), 0)::text AS t FROM spoils");
  const paid = await one("SELECT COALESCE(sum(amount::numeric), 0)::text AS t FROM spoil_claims");
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
    ubiClaimsTotal: ubiTotal.n,
    ubiClaimsToday: ubiToday.n,
    engagementClaims: engagement.n,
    spoilsIssuedG: formatUnits(BigInt(issued.t.split(".")[0]), 18),
    spoilsPaidG: formatUnits(BigInt(paid.t.split(".")[0]), 18),
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
