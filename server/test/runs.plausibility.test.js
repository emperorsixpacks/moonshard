import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOSS_LEVEL_PTS_PER_SEC, GAME, LEVEL_PTS_PER_SEC, SCORE_MODEL } from "../config.js";
import { levelCeiling } from "../src/levels.js";
import { makeHarness, playTrial } from "./helpers.js";

// Run plausibility: what makes a run count as ranked, credit Shards, or clear a boss.
// Breaks caught (reviewer PoC 1 and 2):
//   PoC 1  a verified wallet banked the full 50-Shard cap and a "ranked" Trial entry with no waiting at all: the
//          5 s minimum run equalled the 5 s clock tolerance, so it excluded nothing, and one zero checkpoint at the
//          end of the run was "full coverage" because the final totals were only compared with it using >=.
//   PoC 2  a scripted 39-minute run at ~1,450 points a second took rank 1 over an honest ten-minute run, because the
//          only ceiling was a blanket 1,500 points a second.

const start = (h, p, mode = "TRIAL", chapter) => h.api.post("/runs/start", { mode, ...(chapter ? { chapter } : {}) }, { token: p.token });
const post = (h, p, run, points) => h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
const submit = (h, p, run, body) => h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, ...body }, { token: p.token });
const pt = (t, score = 0, kills = 0, shards = 0) => ({ t, score, kills, shards });
const shardRows = async (h) => (await h.db.query("SELECT subject, shards FROM shard_days ORDER BY subject")).rows;

/** Posts checkpoints every `step` ms up to `to`, growing linearly towards `totals` at `total` ms. Asserts each is accepted. */
async function postLinear(h, p, run, { to, total, score = 0, kills = 0, shards = 0, step = 10_000 }) {
  const points = [];
  for (let t = step; t <= to; t += step) {
    const f = t / total;
    points.push(pt(t, Math.floor(score * f), Math.floor(kills * f), Math.floor(shards * f)));
  }
  for (let i = 0; i < points.length; i += 50) {
    const res = await post(h, p, run, points.slice(i, i + 50));
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  return points.at(-1);
}

// ---------------------------------------------------------------------------------------------------------------
// (a) the clock tolerance is 2 s
// ---------------------------------------------------------------------------------------------------------------

test("the clock tolerance is 2 s: a checkpoint 2,000 ms ahead of the server clock passes, 2,001 ms does not", async () => {
  assert.equal(GAME.CLOCK_TOLERANCE_MS, 2_000);
  const h = await makeHarness();
  try {
    const a = await h.newPlayer();
    const b = await h.newPlayer();
    const runA = (await start(h, a)).body;
    const runB = (await start(h, b)).body;
    h.clock.advance(20_000);
    assert.equal((await post(h, a, runA, [pt(22_000)])).status, 200);
    const late = await post(h, b, runB, [pt(22_001)]);
    assert.deepEqual([late.status, late.body.reason], [422, ["cp_future"]]);
  } finally { await h.close(); }
});

test("the clock tolerance is 2 s: a duration 2,000 ms longer than the server's elapsed time passes, 2,001 ms does not", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    h.clock.advance(40_000);
    const over = await submit(h, p, run, { score: 1000, kills: 20, shards: 0, durationMs: 42_001 });
    assert.deepEqual([over.status, over.body.error], [400, "duration_exceeds_elapsed"]);
    assert.equal((await submit(h, p, run, { score: 1000, kills: 20, shards: 0, durationMs: 42_000 })).status, 200);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// PoC 1: no waiting, no ranking and no Shards
// ---------------------------------------------------------------------------------------------------------------

test("PoC 1: start, one zero checkpoint, submit with no time passing: the checkpoint and the submit are both refused", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = (await start(h, p)).body; // the clock does not move: elapsed is 0 ms
    const cp = await post(h, p, run, [pt(5_000)]);
    assert.deepEqual([cp.status, cp.body.reason], [422, ["cp_future"]]);
    const sub = await submit(h, p, run, { score: 7_500, kills: 60, shards: 60, durationMs: 5_000 });
    assert.deepEqual([sub.status, sub.body.error], [400, "duration_exceeds_elapsed"]);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// (b) ranked / Shards need 30 s of server-measured time, and 30 s of claimed play
// ---------------------------------------------------------------------------------------------------------------

/**
 * An honest-looking verified Trial, as the client plays it: a checkpoint every 10 s of wall time, a closing one when the
 * run ends (carrying the totals the submit carries), then the submit. `durationMs` is the play time the client claims,
 * which is shorter than `elapsedMs` when the player paused.
 */
async function trialOf(h, p, { elapsedMs, durationMs, score = 900, kills = 15, shards = 6 }) {
  const run = (await start(h, p)).body;
  h.clock.advance(elapsedMs);
  for (let t = 10_000; t < elapsedMs - 2_000; t += 10_000) {
    const f = t / elapsedMs;
    assert.equal((await post(h, p, run, [pt(t, Math.floor(score * f), Math.floor(kills * f), Math.floor(shards * f))])).status, 200);
  }
  assert.equal((await post(h, p, run, [pt(elapsedMs, score, kills, shards)])).status, 200);
  return submit(h, p, run, { score, kills, shards, durationMs });
}

/** A run played start to finish with a checkpoint every 10 s (batched as the server allows), closing checkpoint and submit. */
async function playThrough(h, p, { durationMs, score, kills, shards }) {
  const run = (await start(h, p)).body;
  h.clock.advance(durationMs + 500);
  await postLinear(h, p, run, { to: durationMs - 10_000, total: durationMs, score, kills, shards });
  assert.equal((await post(h, p, run, [pt(durationMs, score, kills, shards)])).status, 200);
  return submit(h, p, run, { score, kills, shards, durationMs });
}

test("a Trial counts only from 30 s of server-measured time: 29,999 ms is open-board only and banks no Shards, 30,000 ms ranks", async () => {
  assert.equal(GAME.MIN_RANKED_ELAPSED_MS, 30_000);
  const h = await makeHarness();
  try {
    const short = await h.newPlayer({ verified: true });
    const enough = await h.newPlayer({ verified: true });
    const a = await trialOf(h, short, { elapsedMs: 29_999, durationMs: 29_999 });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(a.body.flags, [], "a short run is not a flagged run");
    assert.equal(a.body.rankedOk, false);
    assert.deepEqual(await shardRows(h), []);

    const b = await trialOf(h, enough, { elapsedMs: 30_000, durationMs: 30_000 });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.rankedOk, true);
    assert.deepEqual(await shardRows(h), [{ subject: enough.address, shards: 6 }]);
  } finally { await h.close(); }
});

test("the answer states what the end screen needs: whether the Shards were credited, and whether the run was too short to count", async () => {
  const h = await makeHarness();
  try {
    const short = await trialOf(h, await h.newPlayer({ verified: true }), { elapsedMs: 20_000, durationMs: 20_000 });
    assert.equal(short.status, 200, JSON.stringify(short.body));
    assert.deepEqual(
      { flags: short.body.flags, shardsCredited: short.body.shardsCredited, tooShort: short.body.tooShort, minPlayMs: short.body.minPlayMs },
      { flags: [], shardsCredited: false, tooShort: true, minPlayMs: 30_000 },
      "an honest run that ended early is too short, not flagged",
    );

    const long = await trialOf(h, await h.newPlayer({ verified: true }), { elapsedMs: 40_000, durationMs: 40_000 });
    assert.deepEqual(
      { shardsCredited: long.body.shardsCredited, tooShort: long.body.tooShort, minPlayMs: long.body.minPlayMs },
      { shardsCredited: true, tooShort: false, minPlayMs: 30_000 },
    );

    // long enough but flagged: its totals are far above anything its last checkpoint allows
    const flaggedPlayer = await h.newPlayer({ verified: true });
    const run = (await start(h, flaggedPlayer)).body;
    h.clock.advance(40_000);
    assert.equal((await post(h, flaggedPlayer, run, [pt(40_000)])).status, 200);
    const flagged = await submit(h, flaggedPlayer, run, { score: 30_000, kills: 60, shards: 40, durationMs: 40_000 });
    assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
    assert.ok(flagged.body.flags.length > 0, "the run is flagged");
    assert.deepEqual({ shardsCredited: flagged.body.shardsCredited, tooShort: flagged.body.tooShort }, { shardsCredited: false, tooShort: false });

    // an unverified wallet's run is never credited, however long
    const unverified = await trialOf(h, await h.newPlayer({ verified: false }), { elapsedMs: 40_000, durationMs: 40_000 });
    assert.deepEqual({ shardsCredited: unverified.body.shardsCredited, tooShort: unverified.body.tooShort }, { shardsCredited: false, tooShort: false });

    // the answer agrees with what was actually banked
    assert.deepEqual((await shardRows(h)).map((row) => row.shards), [6], "only the long, clean, verified run banked Shards");
  } finally { await h.close(); }
});

test("waiting is not enough: 40 s on the server's clock but only 25 s of claimed play is not ranked and banks nothing", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await trialOf(h, p, { elapsedMs: 40_000, durationMs: 25_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rankedOk, false);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("claiming is not enough: 30 s claimed after 28 s on the server's clock (inside the tolerance) is not ranked and banks nothing", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await trialOf(h, p, { elapsedMs: 28_000, durationMs: 30_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rankedOk, false);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("a Story life shorter than 30 s is not ranked and banks no Shards either", async () => {
  const h = await makeHarness();
  try {
    const short = await h.newPlayer({ verified: true });
    const long = await h.newPlayer({ verified: true });
    const mk = async (p, elapsedMs) => {
      const run = (await start(h, p, "STORY", 1)).body;
      h.clock.advance(elapsedMs);
      await post(h, p, run, [pt(elapsedMs - 500, 0, 3, 2)]);
      return submit(h, p, run, { score: 0, kills: 3, shards: 2, durationMs: elapsedMs - 500 });
    };
    const a = await mk(short, 20_000);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.rankedOk, false);
    const b = await mk(long, 31_000);
    assert.equal(b.body.rankedOk, true);
    assert.deepEqual(await shardRows(h), [{ subject: long.address, shards: 2 }]);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Boss clears. Chapter 1 opens its boss arena only after every foe on the level is dead, and the gate is 2,310 px from
// the start at a run speed of 155 px/s: 15 s of pure running, then ~40 swings for 16 foes and the boss's 240 HP. On
// paper nothing clears faster than ~35 s, so 30 s of play AND of server time (BOSS_MIN) leaves every real clear possible.
// ---------------------------------------------------------------------------------------------------------------

async function storyBoss(h, p, { elapsedMs, durationMs, kills = 14 }) {
  const run = (await start(h, p, "STORY", 1)).body;
  h.clock.advance(elapsedMs);
  for (let t = 10_000; t < elapsedMs - 2_000; t += 10_000) {
    assert.equal((await post(h, p, run, [pt(t, 0, Math.floor((kills * t) / elapsedMs))])).status, 200);
  }
  assert.equal((await post(h, p, run, [pt(elapsedMs, 0, kills)])).status, 200);
  return submit(h, p, run, { score: 0, kills, shards: 0, durationMs, bossCleared: true });
}

test("a boss clear needs 30 s of server-measured time as well as 30 s claimed", async () => {
  assert.deepEqual(GAME.BOSS_MIN, { durationMs: 30_000, kills: 3 });
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const claimed = await storyBoss(h, p, { elapsedMs: 28_500, durationMs: 30_000 });
    assert.deepEqual([claimed.status, claimed.body.error], [400, "boss_telemetry_insufficient"]);
    h.clock.advance(10_000);
    const real = await storyBoss(h, p, { elapsedMs: 30_000, durationMs: 30_000 });
    assert.equal(real.status, 200, JSON.stringify(real.body));
    assert.equal(real.body.bossCleared, true);
  } finally { await h.close(); }
});

test("a boss clear with a paused run still works: 30 s of play inside 90 s of wall time", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await storyBoss(h, p, { elapsedMs: 90_000, durationMs: 30_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.bossCleared, true);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// (c) the final totals are bounded by what could have happened since the last checkpoint
// ---------------------------------------------------------------------------------------------------------------

test("one zero checkpoint just before the end no longer covers a whole run's totals: flagged, not ranked, no Shards", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = (await start(h, p)).body;
    h.clock.advance(31_000);
    assert.equal((await post(h, p, run, [pt(30_000)])).status, 200); // nothing at all, at the very end of the run
    const res = await submit(h, p, run, { score: 30_000, kills: 60, shards: 40, durationMs: 31_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.flags.includes("totals_above_checkpoint"), JSON.stringify(res.body));
    assert.equal(res.body.rankedOk, false);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("the same for kills alone, and for Shards that kills do not account for", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    const runA = (await start(h, a)).body;
    const runB = (await start(h, b)).body;
    h.clock.advance(31_000);
    await post(h, a, runA, [pt(30_000, 0, 0, 0)]);
    await post(h, b, runB, [pt(30_000, 0, 20, 0)]);
    const kills = await submit(h, a, runA, { score: 0, kills: 100, shards: 0, durationMs: 31_000 }); // 3.2 kills/s: fine overall, not in the last 3 s
    assert.ok(kills.body.flags.includes("totals_above_checkpoint"), JSON.stringify(kills.body));
    const shards = await submit(h, b, runB, { score: 0, kills: 20, shards: 30, durationMs: 31_000 }); // 30 Shards from no kills at all
    assert.ok(shards.body.flags.includes("totals_above_checkpoint"), JSON.stringify(shards.body));
  } finally { await h.close(); }
});

test("honest closings are never flagged: totals equal to the closing checkpoint, or a lost closing checkpoint, or a paused run", async () => {
  const h = await makeHarness();
  try {
    // 1. the client's usual: the closing checkpoint carries the totals the submit carries
    const a = await h.newPlayer({ verified: true });
    const ra = await trialOf(h, a, { elapsedMs: 60_500, durationMs: 60_000, score: 3_000, kills: 40, shards: 12 });
    assert.deepEqual(ra.body.flags, []);
    assert.equal(ra.body.rankedOk, true);

    // 2. the closing checkpoint was lost: the last periodic one is 10 s old, and 10 s of play are in the totals
    const b = await h.newPlayer({ verified: true });
    const runB = (await start(h, b)).body;
    h.clock.advance(60_500);
    await postLinear(h, b, runB, { to: 50_000, total: 60_000, score: 3_000, kills: 40, shards: 12 });
    const rb = await submit(h, b, runB, { score: 3_000, kills: 40, shards: 12, durationMs: 60_000 });
    assert.deepEqual(rb.body.flags, []);
    assert.equal(rb.body.rankedOk, true);

    // 3. paused for 50 s of a 90 s sitting: the claimed play time (40 s) is SHORTER than the last checkpoint's time (80 s)
    const c = await h.newPlayer({ verified: true });
    const runC = (await start(h, c)).body;
    h.clock.advance(90_000);
    await postLinear(h, c, runC, { to: 80_000, total: 80_000, score: 4_000, kills: 50, shards: 10 });
    const rc = await submit(h, c, runC, { score: 4_000, kills: 50, shards: 10, durationMs: 40_000 });
    assert.equal(rc.status, 200, JSON.stringify(rc.body));
    assert.deepEqual(rc.body.flags, []);
    assert.equal(rc.body.rankedOk, true);
  } finally { await h.close(); }
});

test("a boss kill with its wave bonus right before the run ends is not mistaken for forging (a 1.5 s closing checkpoint)", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = (await start(h, p)).body;
    h.clock.advance(101_000);
    await postLinear(h, p, run, { to: 90_000, total: 90_000, score: 9_000, kills: 70, shards: 5 });
    // the boss falls (x4.0 combo: 2,160 points) and the last wave's bonus lands (1,680): 3,840 points in 1.5 s
    assert.equal((await post(h, p, run, [pt(91_500, 12_840, 72, 5)])).status, 200);
    const res = await submit(h, p, run, { score: 12_840, kills: 72, shards: 5, durationMs: 100_500 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.flags, []);
    assert.equal(res.body.rankedOk, true);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// (d) the score ceiling is derived from the game tables
// ---------------------------------------------------------------------------------------------------------------

test("the ceiling: 2 kills a second x (85 + 40) points x 4.0 combo + 10 points a second + the levels' share = 1,183", () => {
  // kills and time: 2 x 500 + 10
  assert.equal(SCORE_MODEL.KILLS_PER_SEC * (SCORE_MODEL.KILL_BASE_PTS_MAX + SCORE_MODEL.KILL_BONUS_PTS_MAX) * SCORE_MODEL.COMBO_MAX + SCORE_MODEL.TIME_PTS_PER_SEC, 1_010);
  // Endless levels after the scripted waves: at most 1,390 for a clear, in at least 20 foes / 2 a second = 10 s; and a boss
  // (2,160 where the rate allows 500) in the at least 5 x 10 s that five levels take
  assert.equal(SCORE_MODEL.LEVEL_CLEAR_PTS_MAX, 1_390);
  assert.equal(LEVEL_PTS_PER_SEC, 139);
  assert.equal(BOSS_LEVEL_PTS_PER_SEC, 34);
  assert.equal(GAME.MAX_PTS_PER_SEC, 1_010 + 139 + 34);
  assert.equal(GAME.MAX_PTS_PER_SEC, 1_183);
  assert.ok(GAME.MAX_PTS_PER_SEC < 1_500, "tighter than the blanket 1,500 it replaces");
  // one-off points that are not part of the sustained rate: five waves' clear bonuses (5,900) and a boss kill at x4.0 (2,160)
  assert.equal(GAME.SCORE_BURST_PTS, 5_900 + 2_160);
});

test("PoC 2: a series at ~1,450 points a second is refused at its first checkpoint, and the submit of 3.49 million is refused", async () => {
  const h = await makeHarness();
  try {
    const forger = await h.newPlayer({ verified: true });
    const run = (await start(h, forger)).body;
    h.clock.advance(2_345_500); // waits out 39 minutes of the 40 the ticket allows
    const first = await post(h, forger, run, [pt(10_000, 14_500, 20)]);
    assert.deepEqual([first.status, first.body.reason], [422, ["cp_score_total"]]);
    const sub = await submit(h, forger, run, { score: 3_490_000, kills: 4_680, shards: 60, durationMs: 2_345_000 });
    assert.deepEqual([sub.status, sub.body.error], [400, "invalid_score_rate"]);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("the ceiling is exact: 1,183 points a second over a checkpoint's whole run passes, one point more does not", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer();
    const b = await h.newPlayer();
    const runA = (await start(h, a)).body;
    const runB = (await start(h, b)).body;
    h.clock.advance(60_000);
    assert.equal((await post(h, a, runA, [pt(10_000, 11_830, 20)])).status, 200);
    assert.deepEqual((await post(h, b, runB, [pt(10_000, 11_831, 20)])).body.reason, ["cp_score_total"]);
    const ok = await submit(h, a, runA, { score: 70_980, kills: 100, shards: 0, durationMs: 60_000 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const over = await submit(h, b, runB, { score: 70_981, kills: 100, shards: 0, durationMs: 60_000 });
    assert.deepEqual([over.status, over.body.error], [400, "invalid_score_rate"]);
  } finally { await h.close(); }
});

test("a burst inside the allowance is accepted; a jump beyond rate x time + burst is not", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer();
    const b = await h.newPlayer();
    const runA = (await start(h, a)).body;
    const runB = (await start(h, b)).body;
    h.clock.advance(120_000);
    await post(h, a, runA, [pt(60_000, 12_000, 90)]);
    await post(h, b, runB, [pt(60_000, 12_000, 90)]);
    assert.equal((await post(h, a, runA, [pt(62_000, 12_000 + 2_000 + 8_060, 92)])).status, 200, "rate x 2 s + the burst allowance");
    const jump = await post(h, b, runB, [pt(62_000, 12_000 + 2_366 + 8_060 + 1, 92)]);
    assert.deepEqual(jump.body.reason, ["cp_score_rate"]);
  } finally { await h.close(); }
});

test("honest runs pass: ten minutes at 30,000 points, and a strong twenty-minute run of 150,000 points and 900 kills", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const slow = await playThrough(h, a, { durationMs: 600_000, score: 30_000, kills: 150, shards: 20 });
    assert.equal(slow.status, 200, JSON.stringify(slow.body));
    assert.deepEqual(slow.body.flags, []);
    assert.equal(slow.body.rankedOk, true);

    const b = await h.newPlayer({ verified: true });
    const strong = await playThrough(h, b, { durationMs: 1_200_000, score: 150_000, kills: 900, shards: 45 });
    assert.equal(strong.status, 200, JSON.stringify(strong.body));
    assert.deepEqual(strong.body.flags, []);
    assert.equal(strong.body.rankedOk, true);
  } finally { await h.close(); }
});

test("the allowances are not re-usable at every checkpoint: kills and points are also bounded cumulatively", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer();
    const b = await h.newPlayer();
    const runA = (await start(h, a)).body;
    const runB = (await start(h, b)).body;
    h.clock.advance(60_000);
    // Each step is inside the per-interval rule (12 kills a second x 2 s + 5 = 29), but two of them are 58 kills in 4 s
    const kills = await post(h, a, runA, [pt(2_000, 0, 29), pt(4_000, 0, 58)]);
    assert.deepEqual([kills.status, kills.body.accepted, kills.body.reason], [422, 1, ["cp_kill_rate"]]);
    // Likewise points: 2,366 in the first 2 s is exactly the rate, then rate x 2 s + the whole burst allowance again
    const points = await post(h, b, runB, [pt(2_000, 2_366), pt(4_000, 2_366 + 2_366 + 8_060)]);
    assert.deepEqual([points.status, points.body.accepted, points.body.reason], [422, 1, ["cp_score_total"]]);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// The ceiling must keep covering the game. Its inputs are copied out of the client's tables (src/config.js); this
// fails when a designer changes a table past them, so the server is revisited instead of silently flagging honest play.
// ---------------------------------------------------------------------------------------------------------------

const clientConfig = new URL("../../src/config.js", import.meta.url);
const hasClient = existsSync(fileURLToPath(clientConfig));

test("the score ceiling still covers the client's game tables", { skip: hasClient ? false : "the client source (src/config.js) is not next to the server" }, async () => {
  const { GAME_CONFIG } = await import(clientConfig.href);
  const regular = Object.entries(GAME_CONFIG.MOBS).filter(([name]) => !name.startsWith("BOSS_"));
  const best = Math.max(...regular.map(([, mob]) => mob.PTS));
  assert.ok(SCORE_MODEL.KILL_BASE_PTS_MAX >= best, `a regular mob is worth ${best}, the model allows ${SCORE_MODEL.KILL_BASE_PTS_MAX}`);

  const snail = GAME_CONFIG.MOBS.SNAIL;
  assert.ok(SCORE_MODEL.KILL_BASE_PTS_MAX + SCORE_MODEL.KILL_BONUS_PTS_MAX >= snail.PTS + snail.RICOCHET_BONUS_PTS, "a ricochet kill of a snail");
  assert.ok(SCORE_MODEL.KILL_BONUS_PTS_MAX >= 40, "the deflect-kill bonus, written in SurvivalScene.js");

  const s = GAME_CONFIG.SURVIVAL;
  assert.ok(SCORE_MODEL.COMBO_MAX >= s.MAX_COMBO, "combo cap");
  assert.ok(SCORE_MODEL.TIME_PTS_PER_SEC >= s.PTS_PER_SECOND, "points for time survived");
  assert.equal(s.WAVE_CLEAR_BONUS, 100, "the wave bonus the one-off allowance was computed with");

  const boss = GAME_CONFIG.MOBS.BOSS_GORGOK; // the Survival boss
  assert.ok(SCORE_MODEL.BOSS_KILL_PTS_MAX >= (boss.PTS + SCORE_MODEL.KILL_BONUS_PTS_MAX) * s.MAX_COMBO, "a boss kill at the combo cap");

  const fromTables = Math.ceil(SCORE_MODEL.KILLS_PER_SEC * (best + SCORE_MODEL.KILL_BONUS_PTS_MAX) * s.MAX_COMBO + s.PTS_PER_SECOND);
  assert.ok(GAME.MAX_PTS_PER_SEC >= fromTables, `the tables now allow ${fromTables} points a second, the server ${GAME.MAX_PTS_PER_SEC}`);
});

const clientLevels = new URL("../../src/engine/levels.js", import.meta.url);

test("the level terms of the ceiling still cover the client's ladder of levels", { skip: hasClient ? false : "the client source (src/config.js) is not next to the server" }, async () => {
  const { GAME_CONFIG } = await import(clientConfig.href);
  const levels = await import(clientLevels.href);
  const s = GAME_CONFIG.SURVIVAL;
  const LV = s.LEVELS;
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const built = range(LV.SCRIPTED + 1, 3_000); // far deeper than anyone plays: every level the caps have settled for

  // the fewest foes a built level has, and the dearest clear: the two inputs of the levels' share of the rate
  const minFoes = Math.min(...built.map(levels.foesIn));
  const dearest = Math.max(...built.map(levels.levelClearBonusMax));
  assert.ok(SCORE_MODEL.LEVEL_MIN_FOES <= minFoes, `a built level has ${minFoes} foes, the model counts on ${SCORE_MODEL.LEVEL_MIN_FOES}`);
  assert.ok(SCORE_MODEL.LEVEL_CLEAR_PTS_MAX >= dearest, `a built level pays up to ${dearest}, the model allows ${SCORE_MODEL.LEVEL_CLEAR_PTS_MAX}`);
  assert.ok(SCORE_MODEL.BOSS_EVERY <= LV.BOSS_EVERY, `a boss every ${LV.BOSS_EVERY} levels, the model allows for one every ${SCORE_MODEL.BOSS_EVERY}`);
  assert.deepEqual(range(1, 3_000).filter(levels.isBossLevel).slice(0, 3), [5, 10, 15]);
  assert.ok(Math.max(LV.MAX_CONCURRENT, ...LV.SCRIPTED_CONCURRENT) <= 4, "the arena holds at most 4 foes at once, which the kill rate leans on");

  // the first five levels are the one-off allowance: their clears add up to what it was computed with
  const scripted = range(1, LV.SCRIPTED).reduce((sum, n) => sum + levels.levelClearBonusMax(n), 0);
  assert.equal(scripted, SCORE_MODEL.WAVE_BONUS_PTS_MAX, "the five hand-built waves' clear bonuses");
  assert.ok(SCORE_MODEL.WAVE_BONUS_PTS_MAX <= GAME.SCORE_BURST_PTS);

  // the level check of runs.js: no level, hand-built ones included, has fewer foes than it divides the kills by
  const fewest = Math.min(...range(1, 3_000).map(levels.foesIn));
  assert.ok(GAME.LEVELS.MIN_FOES_PER_LEVEL <= fewest, `the fewest foes in any level is ${fewest}, the server divides by ${GAME.LEVELS.MIN_FOES_PER_LEVEL}`);
  for (const n of range(1, 400)) {
    // a player who is in level n has killed every foe of the levels before it: the most levels the server allows for that many kills
    const needed = levels.cumulativeFoes(n - 1);
    const allowed = levelCeiling(needed);
    assert.ok(allowed >= n, `a run that killed all ${needed} foes before level ${n} is inside the server's level ceiling (${allowed})`);
    // and still inside it when those kills came as fast as the model allows (SCORE_MODEL.KILLS_PER_SEC): an honest run is never flagged for its time
    const fastest = needed / SCORE_MODEL.KILLS_PER_SEC;
    assert.ok(levelCeiling(needed, fastest) >= n, `...and when it took ${fastest} s, a kill every ${1 / SCORE_MODEL.KILLS_PER_SEC} s`);
  }

  // the whole rate again, from the client's own tables
  const regular = Object.entries(GAME_CONFIG.MOBS).filter(([name]) => !name.startsWith("BOSS_"));
  const best = Math.max(...regular.map(([, mob]) => mob.PTS));
  const killMax = (best + SCORE_MODEL.KILL_BONUS_PTS_MAX) * s.MAX_COMBO;
  const minSeconds = minFoes / SCORE_MODEL.KILLS_PER_SEC;
  const bossKill = (GAME_CONFIG.MOBS.BOSS_GORGOK.PTS + SCORE_MODEL.KILL_BONUS_PTS_MAX) * s.MAX_COMBO;
  const fromTables = Math.ceil(SCORE_MODEL.KILLS_PER_SEC * killMax + s.PTS_PER_SECOND + Math.ceil(dearest / minSeconds) + Math.ceil((bossKill - killMax) / (LV.BOSS_EVERY * minSeconds)));
  assert.ok(GAME.MAX_PTS_PER_SEC >= fromTables, `the tables now allow ${fromTables} points a second, the server ${GAME.MAX_PTS_PER_SEC}`);
});

test("the shop's gated blades and armour are the client's: same ids, order, prerequisites and levels", { skip: hasClient ? false : "the client source (src/config.js) is not next to the server" }, async () => {
  const { GAME_CONFIG } = await import(clientConfig.href);
  const { BLADE_TIERS } = await import(clientLevels.href);
  const armour = Object.values(GAME_CONFIG.ARMOUR);
  const armourIds = new Set(armour.map((a) => a.id));
  const gated = GAME.SHOP.filter((item) => item.minLevel);
  const blades = gated.filter((i) => !armourIds.has(i.id));
  assert.deepEqual(blades.map((i) => [i.id, i.name, i.requires, i.minLevel]), BLADE_TIERS.map((t) => [t.id, t.name, t.requires, t.minLevel]));
  assert.ok(gated.every((i) => i.kind === "forge"), "forged, not cosmetic: they add power");
  // each is listed after the item it requires, and forging one costs a fee that rises with it
  const ids = GAME.SHOP.map((i) => i.id);
  for (const item of gated) assert.ok(ids.indexOf(item.requires) < ids.indexOf(item.id), `${item.requires} is listed before ${item.id}`);
  assert.deepEqual(blades.map((i) => i.price), [...blades.map((i) => i.price)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  // and the client has a weapon of that id for each blade, stronger than the Glaive
  for (const item of blades) {
    const weapon = Object.values(GAME_CONFIG.WEAPONS).find((w) => w.id === item.id);
    assert.ok(weapon && weapon.damageMul > GAME_CONFIG.WEAPONS.FOREST_GLAIVE.damageMul, item.id);
  }
  // the armour: every piece the client wears is sold, as the same kind of item, in the same chain and at the same levels
  assert.equal(GAME.SHOP.filter((i) => armourIds.has(i.id)).length, armour.length, "every piece is in the shop, once");
  for (const piece of armour) {
    const item = GAME.SHOP.find((i) => i.id === piece.id);
    assert.ok(item, `${piece.id} is sold`);
    assert.deepEqual([item.name, item.kind, item.requires ?? null, item.minLevel ?? null], [piece.name, "forge", piece.requires ?? null, piece.minLevel ?? null], piece.id);
  }
  // each slot's fees rise with its tiers, and the first piece of a slot has no level to reach
  for (const slot of ["helm", "shield"]) {
    const chain = armour.filter((a) => a.slot === slot).map((a) => GAME.SHOP.find((i) => i.id === a.id));
    assert.deepEqual(chain.map((i) => i.price), [...chain.map((i) => i.price)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), `${slot} fees rise`);
    assert.equal(chain[0].minLevel, undefined, `the first ${slot} asks for no level`);
  }
});
