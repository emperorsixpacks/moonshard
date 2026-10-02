import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, T0 } from "./helpers.js";

const start = async (h, p, mode = "TRIAL", chapter) => {
  const r = await h.api.post("/runs/start", { mode, chapter }, { token: p.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const submit = (h, p, run, over = {}) =>
  h.api.post(
    `/runs/${run.runId}/submit`,
    { ticket: run.ticket, score: 1000, kills: 20, shards: 5, durationMs: 60_000, ...over },
    { token: p.token },
  );

test("start returns a ticket, seed = UTC day, and voids the previous open run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const a = await start(h, p);
    assert.equal(a.seed, "2026-10-05");
    assert.match(a.ticket, /^[0-9a-f]{64}$/);
    h.clock.advance(10_000); // a Trial start waits 10 s after the previous one (see runs.limits.test.js)
    const b = await start(h, p);
    h.clock.advance(60_000);
    const stale = await submit(h, p, a);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "run_void");
    assert.equal((await submit(h, p, b)).status, 200);
  } finally { await h.close(); }
});

test("bad mode / chapter are rejected; STORY needs a chapter 1-5", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await h.api.post("/runs/start", { mode: "NOPE" }, { token: p.token })).body.error, "bad_mode");
    assert.equal((await h.api.post("/runs/start", { mode: "STORY" }, { token: p.token })).body.error, "bad_chapter");
    assert.equal((await h.api.post("/runs/start", { mode: "STORY", chapter: 6 }, { token: p.token })).body.error, "bad_chapter");
    assert.equal((await h.api.post("/runs/start", { mode: "STORY", chapter: 3 }, { token: p.token })).status, 200);
  } finally { await h.close(); }
});

test("valid submit succeeds once; second submit is 409", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(61_000);
    const ok = await submit(h, p, run);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.isNewBest, true);
    assert.equal(ok.body.rankedOk, false); // unverified
    assert.equal(ok.body.rank.open, 1);
    const again = await submit(h, p, run);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_submitted");
  } finally { await h.close(); }
});

test("ticket tampering and other players' runs are refused", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const q = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(61_000);
    assert.equal((await submit(h, p, { ...run, ticket: "0".repeat(64) })).body.error, "bad_ticket");
    assert.equal((await submit(h, p, { ...run, ticket: "zz" })).body.error, "bad_ticket");
    assert.equal((await submit(h, q, run)).status, 404);
  } finally { await h.close(); }
});

test("server clock wins: duration cannot exceed elapsed time; tickets expire", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    const early = await submit(h, p, run, { durationMs: 60_000 });
    assert.equal(early.body.error, "duration_exceeds_elapsed");
    h.clock.advance(41 * 60_000);
    const late = await submit(h, p, run, { durationMs: 60_000 });
    assert.equal(late.status, 410);
    assert.equal(late.body.error, "ticket_expired");
  } finally { await h.close(); }
});

test("impossible rates and malformed numbers are rejected", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(61_000);
    assert.equal((await submit(h, p, run, { score: 10_000_000 })).body.error, "invalid_score_rate");
    assert.equal((await submit(h, p, run, { kills: 2_000 })).body.error, "invalid_kill_rate");
    assert.equal((await submit(h, p, run, { kills: 20, shards: 61 })).body.error, "shard_count_anomaly");
    assert.equal((await submit(h, p, run, { kills: 0, shards: 21 })).body.error, "shard_count_anomaly");
    assert.equal((await submit(h, p, run, { score: -1 })).body.error, "invalid_numbers");
    assert.equal((await submit(h, p, run, { score: "abc" })).body.error, "invalid_numbers");
    assert.equal((await submit(h, p, run, { durationMs: 1_000 })).body.error, "invalid_duration");
    assert.equal((await submit(h, p, run, { score: 200_000_000 })).body.error, "invalid_score");
  } finally { await h.close(); }
});

test("honest verified run with checkpoints is ranked-eligible; no checkpoints is open-board only", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    const ranked = await playTrial(h, a, { score: 3000 });
    assert.equal(ranked.status, 200);
    assert.equal(ranked.body.rankedOk, true);
    assert.equal(ranked.body.rank.ranked, 1);

    const run = await start(h, b);
    h.clock.advance(61_000);
    const bare = await submit(h, b, run, { score: 9000 });
    assert.equal(bare.body.rankedOk, false);
    const open = await h.api.get("/leaderboard/daily?view=open");
    assert.equal(open.body.entries[0].score, 9000);
    const rk = await h.api.get("/leaderboard/daily?view=ranked");
    assert.deepEqual(rk.body.entries.map((e) => e.score), [3000]);
  } finally { await h.close(); }
});

test("a bad checkpoint flags the run: score still counts on the open board, never ranked", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(40_000);
    const good = await h.api.post(`/runs/${run.runId}/checkpoints`, { points: [{ t: 10_000, score: 100, kills: 2, shards: 0 }] }, { token: p.token });
    assert.equal(good.status, 200);
    const bad = await h.api.post(`/runs/${run.runId}/checkpoints`, { points: [{ t: 20_000, score: 50, kills: 2, shards: 0 }] }, { token: p.token });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error, "bad_checkpoint");
    assert.ok(bad.body.reason.includes("cp_regress"));
    h.clock.advance(21_000);
    const res = await submit(h, p, run, { score: 500, kills: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.rankedOk, false);
    assert.ok(res.body.flags.includes("cp_regress"));
  } finally { await h.close(); }
});

test("checkpoint rules: time must increase, cannot be in the future, score rate capped", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = await start(h, p);
    h.clock.advance(20_000);
    const post = (points) => h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
    assert.ok((await post([{ t: 10_000, score: 100, kills: 1, shards: 0 }])).body.ok);
    assert.ok((await post([{ t: 10_000, score: 120, kills: 1, shards: 0 }])).body.reason.includes("cp_time"));
    assert.ok((await post([{ t: 600_000, score: 200, kills: 1, shards: 0 }])).body.reason.includes("cp_future"));
    assert.ok((await post([{ t: 15_000, score: 900_000, kills: 1, shards: 0 }])).body.reason.includes("cp_score_rate"));
    assert.equal((await post([])).body.error, "bad_points");
  } finally { await h.close(); }
});

test("two wallets of one human share one daily slot", async () => {
  const h = await makeHarness();
  try {
    const first = await h.newPlayer({ verified: true });
    const second = await h.newPlayer({ verified: true, root: first.address });
    await playTrial(h, first, { score: 2000 });
    const r2 = await playTrial(h, second, { score: 2500 });
    assert.equal(r2.body.isNewBest, true);
    const rows = await h.db.query("SELECT count(*)::int AS n FROM scores");
    assert.equal(rows.rows[0].n, 1);
    const board = await h.api.get("/leaderboard/daily?view=ranked");
    assert.equal(board.body.entries.length, 1);
    assert.equal(board.body.entries[0].score, 2500);
  } finally { await h.close(); }
});

test("best-of-day: a lower later score does not replace; ranked beats unranked", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 4000 });
    const lower = await playTrial(h, p, { score: 1000 });
    assert.equal(lower.body.isNewBest, false);
    const run = await start(h, p);
    h.clock.advance(61_000);
    const unrankedHigh = await submit(h, p, run, { score: 9000 }); // no checkpoints => unranked
    assert.equal(unrankedHigh.body.isNewBest, false);
    const board = await h.api.get("/leaderboard/daily?view=open");
    assert.equal(board.body.entries[0].score, 4000);
  } finally { await h.close(); }
});

test("UTC midnight: a run started 23:55 and submitted 00:03 counts for the start day", async () => {
  const h = await makeHarness();
  try {
    h.clock.set(Date.parse("2026-10-05T23:55:00.000Z"));
    const p = await h.newPlayer();
    const run = await start(h, p);
    assert.equal(run.seed, "2026-10-05");
    h.clock.set(Date.parse("2026-10-06T00:03:00.000Z"));
    const res = await submit(h, p, run, { durationMs: 60_000 });
    assert.equal(res.status, 200);
    const d5 = await h.api.get("/leaderboard/daily?view=open");
    assert.equal(d5.body.day, "2026-10-06");
    assert.equal(d5.body.entries.length, 0);
    const row = await h.db.query("SELECT day FROM scores");
    assert.equal(row.rows[0].day, "2026-10-05");
  } finally { await h.close(); }
});

test("STORY boss clear needs telemetry and checkpoint coverage; TRIAL cannot claim a boss", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });

    const trial = await start(h, p, "TRIAL");
    h.clock.advance(61_000);
    assert.equal((await submit(h, p, trial, { bossCleared: true })).body.error, "boss_requires_story");

    const short = await start(h, p, "STORY", 1);
    h.clock.advance(10_000);
    assert.equal((await submit(h, p, short, { durationMs: 8_000, kills: 5, bossCleared: true })).body.error, "boss_telemetry_insufficient");

    const lowCov = await start(h, p, "STORY", 1);
    h.clock.advance(60_000);
    const lc = await submit(h, p, lowCov, { score: 0, kills: 10, durationMs: 60_000, bossCleared: true });
    assert.equal(lc.status, 200);
    assert.equal(lc.body.bossCleared, false);
    assert.ok(lc.body.flags.includes("boss_low_coverage"));

    const good = await start(h, p, "STORY", 1);
    h.clock.advance(50_000);
    const pts = [10_000, 20_000, 30_000, 40_000, 50_000].map((t) => ({ t, score: 0, kills: t / 10_000 * 2, shards: 0 }));
    assert.equal((await h.api.post(`/runs/${good.runId}/checkpoints`, { points: pts }, { token: p.token })).status, 200);
    h.clock.advance(10_500);
    const ok = await submit(h, p, good, { score: 0, kills: 12, durationMs: 60_000, bossCleared: true });
    assert.equal(ok.body.bossCleared, true);
  } finally { await h.close(); }
});

test("shards only accrue for verified players", async () => {
  const h = await makeHarness();
  try {
    const v = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    await playTrial(h, v, { kills: 20, shards: 10 });
    await playTrial(h, u, { kills: 20, shards: 10 });
    const rows = await h.db.query("SELECT subject, shards FROM shard_days");
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].subject, v.address);
    assert.equal(rows.rows[0].shards, 10);
  } finally { await h.close(); }
});

test("all-time board keeps each human's best day", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 2000 });
    h.clock.set(T0 + 24 * 3600_000);
    await playTrial(h, p, { score: 3500 });
    h.clock.set(T0 + 48 * 3600_000);
    await playTrial(h, p, { score: 500 });
    const all = await h.api.get("/leaderboard/alltime?view=ranked");
    assert.equal(all.body.entries.length, 1);
    assert.equal(all.body.entries[0].score, 3500);
    assert.equal(all.body.entries[0].day, "2026-10-06");
  } finally { await h.close(); }
});
