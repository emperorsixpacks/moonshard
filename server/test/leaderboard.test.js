import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, T0 } from "./helpers.js";
import { BOARD_CACHE_MS, MAX_BOARD_LIMIT, allTimeBoard, createTtlCache } from "../src/leaderboard.js";

// Finding 2: GET /leaderboard/alltime used to run DISTINCT ON over the whole scores table, ship every subject to
// Node and apply `limit` after sorting in JS, uncached. Now the top-N is cut in SQL and the page is cached for 30 s.

const addr = (n) => "0x" + n.toString(16).padStart(40, "0");

/** Inserts score rows directly: [{ day, n (subject number), rankedOk, score, kills, durationMs, runId }]. */
async function seed(db, rows) {
  for (const r of rows) {
    await db.query(
      `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8)`,
      [r.day, addr(r.n), Boolean(r.rankedOk), Boolean(r.rankedOk), r.score, r.kills ?? 10, r.durationMs ?? 60_000, r.runId],
    );
  }
}

/** Records every query and how many rows it handed back to Node. */
function spyOnQueries(db) {
  const real = db.query;
  const log = [];
  db.query = async (sql, params) => {
    const result = await real(sql, params);
    log.push({ sql, rows: result.rows.length });
    return result;
  };
  return {
    log,
    restore: () => { db.query = real; },
    boardQueries: () => log.filter((q) => /FROM scores/i.test(q.sql) && /DISTINCT ON/i.test(q.sql)),
  };
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** The old implementation, kept here as the reference: best row per subject in JS, then the same four-key sort. */
function legacyAllTime(rows, view, limit) {
  const ahead = (a, b) => b.score - a.score || a.duration_ms - b.duration_ms || b.kills - a.kills || (a.run_id < b.run_id ? -1 : 1);
  const best = new Map();
  for (const r of rows) {
    if (view === "ranked" && !r.ranked_ok) continue;
    const cur = best.get(r.subject);
    if (!cur || ahead(r, cur) < 0) best.set(r.subject, r);
  }
  return [...best.values()].sort(ahead).slice(0, limit);
}

const shape = (e) => [e.rank, e.wallet, e.score, e.kills, e.durationMs, e.day, e.verified, e.rankedOk];
const shapeRow = (r, i) => [i + 1, r.wallet, r.score, r.kills, r.duration_ms, r.day, r.verified, r.ranked_ok];

test("all-time board: only the requested page leaves the database", async () => {
  const h = await makeHarness();
  const spy = spyOnQueries(h.db);
  try {
    await h.db.query(
      `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
       SELECT '2026-09-01', '0x' || lpad(to_hex(g), 40, '0'), '0x' || lpad(to_hex(g), 40, '0'), false, false, g, 10, 60000, 'run-' || g
         FROM generate_series(1, 400) g`,
    );
    const res = await h.api.get("/leaderboard/alltime?view=open");
    assert.equal(res.status, 200);
    assert.equal(res.body.entries.length, 50);
    assert.equal(res.body.entries[0].score, 400);
    const board = spy.boardQueries();
    assert.equal(board.length, 1, "one board query");
    assert.ok(board[0].rows <= 50, `the database returned ${board[0].rows} rows for a page of 50`);
  } finally { spy.restore(); await h.close(); }
});

test("all-time board: same entries in the same order as the old JS implementation, ties included", async () => {
  const h = await makeHarness();
  try {
    const rnd = lcg(20261001);
    const order = Array.from({ length: 1000 }, (_, i) => i).sort(() => rnd() - 0.5); // run ids not in insertion order
    const rows = [];
    for (let n = 1; n <= 150; n++) {
      const days = 1 + Math.floor(rnd() * 4);
      for (let d = 0; d < days; d++) {
        const rankedOk = rnd() < 0.5;
        rows.push({
          day: `2026-09-${String(1 + d * 2 + Math.floor(rnd() * 2)).padStart(2, "0")}`, n, rankedOk,
          score: Math.floor(rnd() * 10) * 100, // 10 distinct scores for 150 subjects: lots of ties
          kills: [10, 20, 30][Math.floor(rnd() * 3)],
          durationMs: 60_000 + Math.floor(rnd() * 3) * 1000,
          runId: `run-${String(order[rows.length]).padStart(4, "0")}`,
        });
      }
    }
    // one subject can only have one row per day
    const unique = new Map(rows.map((r) => [`${r.day}|${r.n}`, r]));
    await seed(h.db, [...unique.values()]);
    const all = (await h.db.query("SELECT * FROM scores")).rows;
    assert.ok(all.length > 200, "premise: several rows per subject");

    for (const view of ["open", "ranked"]) {
      for (const limit of [1, 7, 50, 100]) {
        const want = legacyAllTime(all, view, limit).map(shapeRow);
        const res = await h.api.get(`/leaderboard/alltime?view=${view}&limit=${limit}`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.entries.map(shape), want, `view=${view} limit=${limit}`);
        h.clock.advance(BOARD_CACHE_MS); // never read an earlier iteration back from the cache
      }
    }
  } finally { await h.close(); }
});

test("all-time board: the page size is capped at 100, and a bad limit falls back to 50", async () => {
  const h = await makeHarness();
  try {
    await h.db.query(
      `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
       SELECT '2026-09-01', '0x' || lpad(to_hex(g), 40, '0'), '0x' || lpad(to_hex(g), 40, '0'), false, false, g, 10, 60000, 'run-' || g
         FROM generate_series(1, 250) g`,
    );
    const n = async (query) => (await h.api.get(`/leaderboard/alltime?view=open${query}`)).body.entries.length;
    assert.equal(MAX_BOARD_LIMIT, 100);
    assert.equal(await n(""), 50);
    assert.equal(await n("&limit=10"), 10);
    assert.equal(await n("&limit=100"), 100);
    assert.equal(await n("&limit=101"), 100);
    assert.equal(await n("&limit=100000"), 100);
    for (const bad of ["0", "-5", "abc", "1.5", "", "10abc", "1e3"]) assert.equal(await n(`&limit=${bad}`), 50, `limit=${bad}`);
    // the cap holds for callers that do not go through HTTP, too
    const ctx = { db: h.db, now: h.clock };
    assert.equal((await allTimeBoard(ctx, "open", 10_000)).length, 100);
    assert.equal((await allTimeBoard(ctx, "open", 0)).length, 50);
  } finally { await h.close(); }
});

test("daily board takes the same limit, capped at 100", async () => {
  const h = await makeHarness();
  try {
    await h.db.query(
      `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
       SELECT '2026-10-05', '0x' || lpad(to_hex(g), 40, '0'), '0x' || lpad(to_hex(g), 40, '0'), false, false, g, 10, 60000, 'run-' || g
         FROM generate_series(1, 150) g`,
    );
    const n = async (query) => (await h.api.get(`/leaderboard/daily?view=open${query}`)).body.entries.length;
    assert.equal(await n(""), 50);
    assert.equal(await n("&limit=5"), 5);
    assert.equal(await n("&limit=5000"), 100);
  } finally { await h.close(); }
});

test("all-time board is cached for 30 s; the daily board is not", async () => {
  const h = await makeHarness();
  const spy = spyOnQueries(h.db);
  try {
    assert.equal(BOARD_CACHE_MS, 30_000);
    await seed(h.db, [{ day: "2026-10-05", n: 1, rankedOk: true, score: 500, runId: "run-1" }]);
    const first = await h.api.get("/leaderboard/alltime?view=ranked");
    assert.deepEqual(first.body.entries.map((e) => e.score), [500]);
    assert.equal(spy.boardQueries().length, 1);

    await seed(h.db, [{ day: "2026-10-05", n: 2, rankedOk: true, score: 900, runId: "run-2" }]);
    h.clock.advance(BOARD_CACHE_MS - 1);
    const cached = await h.api.get("/leaderboard/alltime?view=ranked");
    assert.deepEqual(cached.body.entries.map((e) => e.score), [500], "still the cached page 1 ms before it expires");
    assert.equal(spy.boardQueries().length, 1, "served without touching the database");

    h.clock.advance(1);
    const fresh = await h.api.get("/leaderboard/alltime?view=ranked");
    assert.deepEqual(fresh.body.entries.map((e) => e.score), [900, 500], "30 s later the board is recomputed");
    assert.equal(spy.boardQueries().length, 2);

    // a player who just finished a run must see it on today's board at once
    await seed(h.db, [{ day: "2026-10-05", n: 3, rankedOk: true, score: 700, runId: "run-3" }]);
    const daily = await h.api.get("/leaderboard/daily?view=ranked");
    assert.deepEqual(daily.body.entries.map((e) => e.score), [900, 700, 500]);
  } finally { spy.restore(); await h.close(); }
});

test("all-time cache never serves the ranked view to the open view or the other way round", async () => {
  const h = await makeHarness();
  try {
    await seed(h.db, [
      { day: "2026-10-05", n: 1, rankedOk: true, score: 500, runId: "run-1" },
      { day: "2026-10-05", n: 2, rankedOk: false, score: 900, runId: "run-2" }, // open board only
    ]);
    const scores = async (view) => (await h.api.get(`/leaderboard/alltime?view=${view}`)).body.entries.map((e) => e.score);
    for (const [first, second] of [["ranked", "open"], ["open", "ranked"]]) {
      h.clock.advance(BOARD_CACHE_MS);
      assert.deepEqual(await scores(first), first === "ranked" ? [500] : [900, 500], `${first} first`);
      assert.deepEqual(await scores(second), second === "ranked" ? [500] : [900, 500], `${second} second, with ${first} cached`);
      assert.deepEqual(await scores(first), first === "ranked" ? [500] : [900, 500], `${first} again`);
    }
    const body = (await h.api.get("/leaderboard/alltime?view=ranked")).body;
    assert.equal(body.view, "ranked");
    assert.equal((await h.api.get("/leaderboard/alltime?view=open")).body.view, "open");
    assert.equal((await h.api.get("/leaderboard/alltime?view=nonsense")).body.view, "ranked", "an unknown view is the ranked board");
  } finally { await h.close(); }
});

test("all-time cache is keyed by page size too", async () => {
  const h = await makeHarness();
  try {
    await h.db.query(
      `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
       SELECT '2026-09-01', '0x' || lpad(to_hex(g), 40, '0'), '0x' || lpad(to_hex(g), 40, '0'), false, false, g, 10, 60000, 'run-' || g
         FROM generate_series(1, 30) g`,
    );
    const n = async (limit) => (await h.api.get(`/leaderboard/alltime?view=open&limit=${limit}`)).body.entries.length;
    assert.equal(await n(3), 3);
    assert.equal(await n(20), 20);
    assert.equal(await n(3), 3);
  } finally { await h.close(); }
});

test("concurrent cold requests share one board query", async () => {
  const h = await makeHarness();
  const spy = spyOnQueries(h.db);
  try {
    await seed(h.db, [{ day: "2026-10-05", n: 1, rankedOk: true, score: 500, runId: "run-1" }]);
    const responses = await Promise.all(Array.from({ length: 8 }, () => h.api.get("/leaderboard/alltime?view=open")));
    assert.deepEqual(responses.map((r) => r.status), Array(8).fill(200));
    assert.equal(spy.boardQueries().length, 1);
  } finally { spy.restore(); await h.close(); }
});

test("a failed board query is not cached: the next request tries again", async () => {
  const h = await makeHarness();
  const realError = console.error;
  try {
    await seed(h.db, [{ day: "2026-10-05", n: 1, rankedOk: true, score: 500, runId: "run-1" }]);
    const real = h.db.query;
    let fail = true;
    h.db.query = (sql, params) => (fail && /DISTINCT ON/.test(sql) ? Promise.reject(new Error("db blip")) : real(sql, params));
    console.error = () => {}; // the 500 logs its error
    const down = await h.api.get("/leaderboard/alltime?view=open");
    assert.equal(down.status, 500);
    fail = false;
    const up = await h.api.get("/leaderboard/alltime?view=open");
    assert.equal(up.status, 200);
    assert.deepEqual(up.body.entries.map((e) => e.score), [500]);
  } finally { console.error = realError; await h.close(); }
});

test("the board cache is bounded", async () => {
  const h = await makeHarness();
  try {
    assert.ok(h.ctx.leaderboardCache, "the cache is reachable for inspection");
    await seed(h.db, [{ day: "2026-10-05", n: 1, rankedOk: true, score: 500, runId: "run-1" }]);
    for (let limit = 1; limit <= 100; limit++) await h.api.get(`/leaderboard/alltime?view=open&limit=${limit}`);
    for (let limit = 1; limit <= 100; limit++) await h.api.get(`/leaderboard/alltime?view=ranked&limit=${limit}`);
    assert.ok(h.ctx.leaderboardCache.size <= 64, `${h.ctx.leaderboardCache.size} cached pages`);
  } finally { await h.close(); }
});

test("createTtlCache: fresh while younger than the ttl, evicts the oldest entry past maxEntries, forgets failures", async () => {
  let t = T0;
  const cache = createTtlCache({ now: () => t, ttlMs: 1_000, maxEntries: 3 });
  let loads = 0;
  const load = (v) => async () => { loads += 1; return v; };

  assert.equal(await cache.get("a", load("A1")), "A1");
  t += 999;
  assert.equal(await cache.get("a", load("A2")), "A1", "999 ms old: cached");
  t += 1;
  assert.equal(await cache.get("a", load("A2")), "A2", "1000 ms old: reloaded");
  assert.equal(loads, 2);

  for (const k of ["b", "c", "d"]) await cache.get(k, load(k));
  assert.equal(cache.size, 3, "a was the oldest and went");
  const before = loads;
  await cache.get("c", load("again"));
  await cache.get("d", load("again"));
  assert.equal(loads, before, "c and d are still cached");
  await cache.get("a", load("A3"));
  assert.equal(loads, before + 1, "a was evicted, so it loads again");

  let calls = 0;
  const flaky = async () => { calls += 1; if (calls === 1) throw new Error("boom"); return "ok"; };
  await assert.rejects(cache.get("f", flaky), /boom/);
  assert.equal(await cache.get("f", flaky), "ok", "the failure was not kept");

  let release;
  const gate = new Promise((r) => { release = r; });
  let slowLoads = 0;
  const slow = async () => { slowLoads += 1; await gate; return "slow"; };
  const both = Promise.all([cache.get("s", slow), cache.get("s", slow)]);
  release();
  assert.deepEqual(await both, ["slow", "slow"]);
  assert.equal(slowLoads, 1, "concurrent callers share one load");
});

// ---------------------------------------------------------------------------------------------
// Indexes (migration 002). Each index is here because a query in the API needs it; the lab behind these
// choices is in the report. `enable_seqscan = off` makes the planner use any index that can serve the query,
// so these tests fail when a column order or a partial-index predicate stops matching the SQL.
// ---------------------------------------------------------------------------------------------

const planOf = async (db, sql, params = []) =>
  (await db.query(`EXPLAIN (COSTS OFF) ${sql}`, params)).rows.map((r) => r["QUERY PLAN"]).join("\n");

async function withoutSeqScan(db, fn) {
  await db.exec("SET enable_seqscan = off");
  try { return await fn(); } finally { await db.exec("RESET enable_seqscan"); }
}

const RANKING = "score DESC, duration_ms ASC, kills DESC, run_id ASC";

test("002_indexes: the board, settlement, run and spoil lookups each have an index that fits their SQL", async () => {
  const h = await makeHarness();
  try {
    const cases = [
      ["daily board, open", `SELECT * FROM scores WHERE day = $1 ORDER BY ${RANKING} LIMIT 50`, ["2026-10-05"], "scores_day_rank"],
      ["daily board, ranked", `SELECT * FROM scores WHERE day = $1 AND ranked_ok ORDER BY ${RANKING} LIMIT 50`, ["2026-10-05"], "scores_day_rank_ranked"],
      ["settlement top 3", `SELECT subject FROM scores WHERE day = $1 AND ranked_ok AND verified ORDER BY ${RANKING} LIMIT 3`, ["2026-10-05"], "scores_day_rank_ranked"],
      ["all-time, open", `SELECT DISTINCT ON (subject) * FROM scores ORDER BY subject, ${RANKING}`, [], "scores_subject_rank"],
      ["all-time, ranked", `SELECT DISTINCT ON (subject) * FROM scores WHERE ranked_ok ORDER BY subject, ${RANKING}`, [], "scores_subject_rank_ranked"],
      ["pendingBossRun", `SELECT run_id FROM runs WHERE subject = $1 AND mode = 'STORY' AND status = 'submitted' AND boss_cleared AND submitted_at > $2 ORDER BY submitted_at DESC LIMIT 1`, [addr(1), new Date(T0)], "runs_subject_mode_status"],
      ["GET /spoils", `SELECT id, kind, day, amount, rank FROM spoils WHERE subject = $1 ORDER BY day DESC, kind LIMIT 30`, [addr(1)], "spoils_subject"],
      ["hasEngagementClaim", `SELECT 1 FROM engagement_claims WHERE subject = $1 LIMIT 1`, [addr(1)], "engagement_claims_subject"],
      ["stats: runs today", `SELECT count(*) FROM runs WHERE day = $1 AND status = 'submitted'`, ["2026-10-05"], "runs_day_status"],
      ["stats: ubi claims today", `SELECT count(*) FROM ubi_claims WHERE day = $1`, ["2026-10-05"], "ubi_claims_day"],
      ["nonce cleanup", `DELETE FROM nonces WHERE expires_at < $1`, [new Date(T0)], "nonces_expires_at"],
    ];
    await withoutSeqScan(h.db, async () => {
      for (const [name, sql, params, index] of cases) {
        const plan = await planOf(h.db, sql, params);
        assert.ok(plan.includes(index), `${name} should use ${index}; plan:\n${plan}`);
      }
    });
  } finally { await h.close(); }
});

test("002_indexes: with real volume the planner picks the day index for the daily board, with no sort", async () => {
  const h = await makeHarness();
  try {
    await h.db.query(
      `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
       SELECT to_char(date '2026-09-01' + (g % 20), 'YYYY-MM-DD'), '0x' || lpad(to_hex(g), 40, '0'), '0x' || lpad(to_hex(g), 40, '0'),
              g % 10 = 0, g % 10 = 0, (g * 7919) % 100000, g % 50, 60000 + (g % 7) * 1000, 'run-' || g
         FROM generate_series(1, 20000) g`,
    );
    await h.db.exec("ANALYZE scores");
    for (const [filter, index] of [["", "scores_day_rank"], ["AND ranked_ok", "scores_day_rank_ranked"]]) {
      const plan = await planOf(h.db, `SELECT * FROM scores WHERE day = $1 ${filter} ORDER BY ${RANKING} LIMIT 50`, ["2026-09-07"]);
      assert.ok(plan.includes(index), plan);
      assert.ok(!/\bSort\b/.test(plan), `the index already delivers the ranking order:\n${plan}`);
    }
  } finally { await h.close(); }
});
