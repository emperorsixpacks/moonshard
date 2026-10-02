import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness } from "./helpers.js";

// Limits that keep one wallet from growing the database: a wait between run starts, and a minimum spacing between
// checkpoints.
// Break caught (PoC 9): a free wallet stored ~400 checkpoint rows per 9 requests (checkpoint times 1, 2, 3, ... ms with
// zero deltas pass every other rule at elapsed ~0), about 4 GB a day from one IP, and nothing was ever deleted.

const start = (h, p, mode = "TRIAL", chapter) => h.api.post("/runs/start", { mode, ...(chapter ? { chapter } : {}) }, { token: p.token });
const post = (h, p, run, points) => h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
const pt = (t, score = 0, kills = 0, shards = 0) => ({ t, score, kills, shards });
const storedTimes = async (h, run) =>
  (await h.db.query("SELECT t_ms FROM run_checkpoints WHERE run_id = $1 ORDER BY seq", [run.runId])).rows.map((r) => r.t_ms);
const flagsOf = async (h, run) => (await h.db.query("SELECT flags FROM runs WHERE run_id = $1", [run.runId])).rows[0].flags;
const count = async (h, table) => (await h.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

// ---------------------------------------------------------------------------------------------------------------
// POST /runs/start waits: 10 s between Trials, 3 s between Story starts, per player and mode.
//   Trial: a Survival run ends at the first death, and an idle player is not first hit before ~6 s (the wave-1 boars
//   charge from 3.2 s) and needs five hits 1.2 s apart to die, so no Trial ends before ~10 s, and the next start is a
//   menu round trip further on: 10 s costs an honest player nothing.
//   Story: a life can end within seconds (a fall or a hazard near the start) and the player presses retry at once, so
//   the wait is only 3 s, shorter than any life that reaches the 5 s minimum a submit needs. The server cannot tell a
//   death from a restart; this is the shortest wait that still caps starts at 20 a minute per player and mode.
// ---------------------------------------------------------------------------------------------------------------

test("a Trial start less than 10 s after the previous one is 429 slow_down; at exactly 10 s it is allowed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await start(h, p)).status, 200);
    h.clock.advance(9_999);
    const refused = await start(h, p);
    assert.deepEqual([refused.status, refused.body], [429, { error: "slow_down", retryAfterMs: 1 }]);
    h.clock.advance(1); // 10,000 ms after the start that was accepted: the refusal above did not restart the wait
    assert.equal((await start(h, p)).status, 200);
  } finally { await h.close(); }
});

test("a refused start says how long to wait, counted from the start that was accepted", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await start(h, p)).status, 200);
    h.clock.advance(4_000);
    assert.deepEqual((await start(h, p)).body, { error: "slow_down", retryAfterMs: 6_000 });
    h.clock.advance(1_000);
    assert.deepEqual((await start(h, p)).body, { error: "slow_down", retryAfterMs: 5_000 }, "the refusal in between did not move it");
    h.clock.advance(5_000);
    assert.equal((await start(h, p)).status, 200, "waiting exactly that long is enough");
  } finally { await h.close(); }
});

test("a refused start changes nothing: the player's open run stays open and can still be submitted", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    h.clock.advance(5_000);
    assert.equal((await start(h, p)).status, 429);
    assert.equal(await count(h, "runs"), 1);
    assert.equal((await h.db.query("SELECT status FROM runs")).rows[0].status, "open");
    h.clock.advance(56_000);
    const sub = await h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, score: 100, kills: 5, shards: 0, durationMs: 60_000 }, { token: p.token });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
  } finally { await h.close(); }
});

test("a Story start waits only 3 s, whichever chapter it is for", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
    h.clock.advance(2_999);
    assert.deepEqual((await start(h, p, "STORY", 2)).body, { error: "slow_down", retryAfterMs: 1 });
    h.clock.advance(1);
    assert.equal((await start(h, p, "STORY", 2)).status, 200);
  } finally { await h.close(); }
});

test("an honest quick retry after an early Story death still works", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
    h.clock.advance(4_000); // died in the first lava pit; the run is too short to submit (a submit needs 5 s)
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
    h.clock.advance(4_500);
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
  } finally { await h.close(); }
});

test("the wait is per player and per mode", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const q = await h.newPlayer();
    assert.equal((await start(h, p, "TRIAL")).status, 200);
    assert.equal((await start(h, p, "STORY", 1)).status, 200, "another mode");
    assert.equal((await start(h, q, "TRIAL")).status, 200, "another player");
    assert.equal((await start(h, q, "STORY", 1)).status, 200);
  } finally { await h.close(); }
});

test("two wallets of one verified human share one wait (their runs have one subject)", async () => {
  const h = await makeHarness();
  try {
    const first = await h.newPlayer({ verified: true });
    const second = await h.newPlayer({ verified: true, root: first.address });
    assert.equal((await start(h, first)).status, 200);
    assert.equal((await start(h, second)).status, 429);
  } finally { await h.close(); }
});

test("requests that are refused as invalid do not use up the wait", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await h.api.post("/runs/start", { mode: "NOPE" }, { token: p.token })).status, 400);
    assert.equal((await h.api.post("/runs/start", { mode: "STORY", chapter: 9 }, { token: p.token })).status, 400);
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
  } finally { await h.close(); }
});

test("two starts racing for one player: one wins, one is told to slow down, and only one run exists", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const [a, b] = await Promise.all([start(h, p), start(h, p)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 429]);
    assert.equal(await count(h, "runs"), 1);
  } finally { await h.close(); }
});

test("the wait is a config knob (startGapMs), which the start-race tests turn off", async () => {
  const h = await makeHarness({ config: { startGapMs: { TRIAL: 0, STORY: 0 } } });
  try {
    const p = await h.newPlayer();
    assert.equal((await start(h, p)).status, 200);
    assert.equal((await start(h, p)).status, 200);
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
    assert.equal((await start(h, p, "STORY", 1)).status, 200);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Checkpoints are at least 2 s apart. The honest client posts one every 10 s, plus the closing one when the run ends,
// which can land a moment after the last periodic one. So the rule has exactly one allowance per run: a single
// checkpoint may follow its predecessor more closely (it is stored with its real time, and the run is not flagged).
// Rows per run are therefore at most elapsed / 2 s + 2, however they are posted.
// ---------------------------------------------------------------------------------------------------------------

test("checkpoints 2 s or more apart are accepted, measured from the previous stored point", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    h.clock.advance(30_000);
    const res = await post(h, p, run, [pt(2_000), pt(4_000), pt(6_000), pt(8_000), pt(20_000), pt(22_000)]);
    assert.deepEqual(res.body, { ok: true, accepted: 6, duplicates: 0 });
    assert.equal(await flagsOf(h, run), "");
  } finally { await h.close(); }
});

test("one checkpoint per run may come sooner than 2 s after the last; the next such one is refused with cp_gap", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    h.clock.advance(60_000);
    assert.equal((await post(h, p, run, [pt(10_000), pt(20_000)])).status, 200);
    const closing = await post(h, p, run, [pt(20_500)]); // the allowance: 500 ms after the last
    assert.deepEqual(closing.body, { ok: true, accepted: 1, duplicates: 0 });
    assert.equal(await flagsOf(h, run), "");

    const second = await post(h, p, run, [pt(21_999), pt(30_000)]); // 1,499 ms after the last: the allowance is spent
    assert.equal(second.status, 422);
    assert.equal(second.body.error, "bad_checkpoint");
    assert.deepEqual(second.body.reason, ["cp_gap"]);
    assert.equal(second.body.accepted, 0, "nothing at or after the offending point is stored");
    assert.deepEqual(await storedTimes(h, run), [10_000, 20_000, 20_500]);
    assert.equal(await flagsOf(h, run), "cp_gap");

    // a point that respects the spacing is still welcome afterwards (the run is flagged, but the data is not rejected)
    assert.equal((await post(h, p, run, [pt(22_500)])).status, 200);
  } finally { await h.close(); }
});

test("the spacing is exactly 2,000 ms: 1,999 ms is the allowance, 2,000 ms is not", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer();
    const b = await h.newPlayer();
    const runA = (await start(h, a)).body;
    const runB = (await start(h, b)).body;
    h.clock.advance(60_000);
    // A: 2,000 ms gaps never touch the allowance, so a 1,999 ms one and only then a 1,000 ms one
    assert.equal((await post(h, a, runA, [pt(2_000), pt(4_000), pt(6_000), pt(7_999)])).body.accepted, 4);
    assert.deepEqual((await post(h, a, runA, [pt(8_999)])).body.reason, ["cp_gap"]);
    // B: the allowance used on the first point, measured from time zero
    assert.equal((await post(h, b, runB, [pt(1_999)])).status, 200);
    assert.deepEqual((await post(h, b, runB, [pt(3_998)])).body.reason, ["cp_gap"], "1,999 ms after the first point is short too");
    assert.equal((await post(h, b, runB, [pt(3_999)])).status, 200, "2,000 ms after it is not");
  } finally { await h.close(); }
});

test("an honest client's cadence is never refused: every 10 s, and the closing point a moment after the last periodic one", async () => {
  for (const closingAfter of [1, 500, 1_999, 2_000, 6_000, 9_999]) {
    const h = await makeHarness();
    try {
      const p = await h.newPlayer({ verified: true });
      const run = (await start(h, p)).body;
      h.clock.advance(31_000 + closingAfter);
      assert.equal((await post(h, p, run, [pt(10_000, 300, 5, 1)])).status, 200);
      assert.equal((await post(h, p, run, [pt(20_000, 600, 10, 2)])).status, 200);
      assert.equal((await post(h, p, run, [pt(30_000, 900, 15, 3)])).status, 200);
      const closing = await post(h, p, run, [pt(30_000 + closingAfter, 900, 15, 3)]);
      assert.equal(closing.status, 200, `closing ${closingAfter} ms after the last periodic point: ${JSON.stringify(closing.body)}`);
      assert.equal(await flagsOf(h, run), "");
    } finally { await h.close(); }
  }
});

test("re-sending a processed batch that held the closing point is still idempotent", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    h.clock.advance(30_000);
    const batch = [pt(10_000, 100, 2), pt(10_400, 120, 3)]; // the second is the allowance
    assert.deepEqual((await post(h, p, run, batch)).body, { ok: true, accepted: 2, duplicates: 0 });
    assert.deepEqual((await post(h, p, run, batch)).body, { ok: true, accepted: 0, duplicates: 2 });
    assert.deepEqual((await post(h, p, run, [batch[1]])).body, { ok: true, accepted: 0, duplicates: 1 });
    assert.equal(await flagsOf(h, run), "");
    assert.deepEqual(await storedTimes(h, run), [10_000, 10_400]);
  } finally { await h.close(); }
});

test("PoC 9: 400 zero-delta checkpoints at 1, 2, 3 ... ms store one row, not 400, and flag the run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    let refused = 0;
    for (let b = 0; b < 8; b++) {
      const res = await post(h, p, run, Array.from({ length: 50 }, (_, i) => pt(b * 50 + i + 1)));
      if (res.status !== 200) refused += 1;
    }
    assert.equal(refused, 8);
    assert.deepEqual(await storedTimes(h, run), [1]);
    assert.equal(await flagsOf(h, run), "cp_gap");
  } finally { await h.close(); }
});

test("PoC 9 at scale: 60 start-and-flood cycles from one wallet add at most one checkpoint row per run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const CYCLES = 60;
    for (let c = 0; c < CYCLES; c++) {
      const run = (await start(h, p)).body;
      for (let b = 0; b < 8; b++) await post(h, p, run, Array.from({ length: 50 }, (_, i) => pt(b * 50 + i + 1)));
      h.clock.advance(10_000); // the wait before the next start
    }
    assert.equal(await count(h, "runs"), CYCLES);
    assert.ok((await count(h, "run_checkpoints")) <= CYCLES, `${await count(h, "run_checkpoints")} rows for ${CYCLES} runs (it was ${CYCLES * 400})`);
  } finally { await h.close(); }
});

test("however it is posted, a run holds at most elapsed / 2 s + 2 checkpoint rows", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const run = (await start(h, p)).body;
    h.clock.advance(100_000);
    // the densest legal stream: 2 s apart, as far ahead as the clock tolerance allows (t <= elapsed + 2 s)
    for (let t = 2_000; t <= 102_000; t += 2_000) {
      const res = await post(h, p, run, [pt(t)]);
      assert.equal(res.status, 200, `t=${t}: ${JSON.stringify(res.body)}`);
    }
    assert.equal((await storedTimes(h, run)).length, 51);

    // Denser than that is refused: the one allowance takes a single extra row, then nothing more fits.
    h.clock.advance(10_000); // so that the time of the next points is not what stops them
    assert.equal((await post(h, p, run, [pt(102_500)])).status, 200, "the allowance");
    for (const t of [103_000, 103_001, 103_499]) assert.deepEqual((await post(h, p, run, [pt(t)])).body.reason, ["cp_gap"], `t=${t}`);
    const rows = (await storedTimes(h, run)).length;
    assert.equal(rows, 52);
    assert.ok(rows <= 110_000 / 2_000 + 2, "rows <= elapsed / 2 s + 2");
  } finally { await h.close(); }
});
