import express from "express";
import { formatUnits } from "viem";
import { GAME } from "../config.js";
import { ah } from "./http.js";
import { dayKey } from "./time.js";

const ORDER = "score DESC, duration_ms ASC, kills DESC, run_id ASC";

export const DEFAULT_BOARD_LIMIT = 50;
/** No board returns more than this many entries, whatever the caller asks for. */
export const MAX_BOARD_LIMIT = 100;
/** How long an all-time page is served from memory before it is computed again. */
export const BOARD_CACHE_MS = 30_000;
export const BOARD_CACHE_MAX_ENTRIES = 64;

/** A page size as the API takes it: a positive integer, at most MAX_BOARD_LIMIT. Anything else is the default page. */
export function pageSize(raw) {
  const n = typeof raw === "number" ? raw : /^\d+$/.test(String(raw ?? "")) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) return DEFAULT_BOARD_LIMIT;
  return Math.min(n, MAX_BOARD_LIMIT);
}

/**
 * Small in-memory cache with a time-to-live, a bound on the number of entries, and one load per key at a time:
 * callers that arrive while a load is running share it. A failed load is not kept, so the next call tries again.
 * `now` is injectable (the tests drive it with a fake clock).
 */
export function createTtlCache({ now, ttlMs, maxEntries }) {
  const entries = new Map(); // key -> { at, pending, promise }, oldest load first
  return {
    get size() { return entries.size; },
    clear() { entries.clear(); },
    get(key, load) {
      const t = now();
      const hit = entries.get(key);
      if (hit && (hit.pending || t - hit.at < ttlMs)) return hit.promise;
      const entry = { at: t, pending: true, promise: null };
      entry.promise = Promise.resolve().then(load).then(
        (value) => { entry.pending = false; return value; },
        (err) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw err;
        },
      );
      // Delete first so a refreshed key moves to the back: the front is always the entry loaded longest ago.
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
  };
}

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

export async function dailyBoard(ctx, day, view = "ranked", limit = DEFAULT_BOARD_LIMIT) {
  return (await dailyRows(ctx, day, view, pageSize(limit))).map(toEntry);
}

/**
 * Each subject's best row, ranked, first `limit` of them (at most MAX_BOARD_LIMIT). The cut is made in SQL, so
 * only the page leaves the database: the inner query keeps one row per subject (their best, in ranking order), the
 * outer one orders those rows by the same ranking and limits. Uncached; the HTTP route caches it.
 */
export async function allTimeBoard(ctx, view = "ranked", limit = DEFAULT_BOARD_LIMIT) {
  const filter = view === "ranked" ? "WHERE ranked_ok" : "";
  const { rows } = await ctx.db.query(
    `SELECT subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id, day FROM (
       SELECT DISTINCT ON (subject) subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id, day
         FROM scores ${filter} ORDER BY subject, ${ORDER}
     ) best ORDER BY ${ORDER} LIMIT $1`,
    [pageSize(limit)],
  );
  return rows.map(toEntry);
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
  // The all-time board is the one expensive read: it looks at every subject's rows. It is public, so it must cost
  // the database the same whether it is asked for once or a thousand times in 30 s. The key holds the view, so the
  // ranked board can never be answered with the open one. The daily board is not cached: an index cuts it, and a
  // player who has just finished a run expects to find the score on it.
  const cache = createTtlCache({ now: () => ctx.now(), ttlMs: BOARD_CACHE_MS, maxEntries: BOARD_CACHE_MAX_ENTRIES });
  ctx.leaderboardCache = cache;

  r.get("/leaderboard/daily", ah(async (req, res) => {
    const day = dayKey(ctx.now());
    const view = viewOf(req);
    res.json({
      day,
      view,
      entries: await dailyBoard(ctx, day, view, pageSize(req.query.limit)),
      prizesG: GAME.PRIZES.map((p) => formatUnits(p, 18)),
    });
  }));

  r.get("/leaderboard/alltime", ah(async (req, res) => {
    const view = viewOf(req);
    const limit = pageSize(req.query.limit);
    res.json({ view, entries: await cache.get(`alltime|${view}|${limit}`, () => allTimeBoard(ctx, view, limit)) });
  }));

  return r;
}
