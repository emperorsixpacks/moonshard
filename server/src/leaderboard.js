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

export async function dailyBoard(ctx, day, view = "ranked", limit = 50) {
  const filter = view === "ranked" ? "AND ranked_ok" : "";
  const { rows } = await ctx.db.query(
    `SELECT subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id
       FROM scores WHERE day = $1 ${filter} ORDER BY ${ORDER} LIMIT $2`,
    [day, limit],
  );
  return rows.map(toEntry);
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

export async function rankOf(ctx, day, subject, view) {
  const board = await dailyBoard(ctx, day, view, 1000);
  const { rows } = await ctx.db.query("SELECT wallet FROM scores WHERE day = $1 AND subject = $2", [day, subject]);
  if (!rows[0]) return null;
  const idx = board.findIndex((e) => e.wallet === rows[0].wallet);
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
