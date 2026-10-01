import express from "express";
import { formatUnits } from "viem";
import { GAME } from "../config.js";
import { ah } from "./http.js";
import { dayKey } from "./time.js";

const ORDER = "score DESC, duration_ms ASC, kills DESC, run_id ASC";
const toEntry = (r, i) => ({
  rank: i + 1,
  wallet: r.wallet,
  verified: r.verified,
  rankedOk: r.ranked_ok,
  score: r.score,
  kills: r.kills,
  durationMs: r.duration_ms,
  ...(r.day ? { day: r.day } : {}),
});

/** Raw board rows, `subject` included. Internal: HTTP entries are built with toEntry, which leaves it out. */
async function dailyRows(ctx, day, view, limit) {
  const filter = view === "ranked" ? "AND ranked_ok" : "";
  const { rows } = await ctx.db.query(
    `SELECT subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id
       FROM scores WHERE day = $1 ${filter} ORDER BY ${ORDER} LIMIT $2`,
    [day, limit],
  );
  return rows;
}

export async function dailyBoard(ctx, day, view = "ranked", limit = 50) {
  return (await dailyRows(ctx, day, view, limit)).map(toEntry);
}

export async function allTimeBoard(ctx, view = "ranked", limit = 50) {
  const filter = view === "ranked" ? "WHERE ranked_ok" : "";
  const { rows } = await ctx.db.query(
    `SELECT DISTINCT ON (subject) subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id, day
       FROM scores ${filter} ORDER BY subject, ${ORDER}`,
  );
  rows.sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms || b.kills - a.kills || (a.run_id < b.run_id ? -1 : 1));
  return rows.slice(0, limit).map(toEntry);
}

/**
 * 1-based position of `subject` on the day's board, or null if it is not within the first 1000 rows.
 * Matched on subject, not wallet: one wallet can own two rows in a day (played unverified as itself,
 * then as the root it was later linked to).
 */
export async function rankOf(ctx, day, subject, view) {
  const rows = await dailyRows(ctx, day, view, 1000);
  const idx = rows.findIndex((r) => r.subject === subject);
  return idx === -1 ? null : idx + 1;
}

export function leaderboardRoutes(ctx) {
  const r = express.Router();
  const viewOf = (req) => (req.query.view === "open" ? "open" : "ranked");

  r.get("/leaderboard/daily", ah(async (req, res) => {
    const day = dayKey(ctx.now());
    const view = viewOf(req);
    res.json({
      day,
      view,
      entries: await dailyBoard(ctx, day, view),
      prizesG: GAME.PRIZES.map((p) => formatUnits(p, 18)),
    });
  }));

  r.get("/leaderboard/alltime", ah(async (req, res) => {
    const view = viewOf(req);
    res.json({ view, entries: await allTimeBoard(ctx, view) });
  }));

  return r;
}
