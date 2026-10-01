import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial } from "./helpers.js";

// Second hardening pass (H1-H8). Existing test files stay as they were, except for the fixtures
// that an item explicitly changes. Each section names the break it guards against.

const start = async (h, p, mode = "TRIAL") => {
  const r = await h.api.post("/runs/start", { mode }, { token: p.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const postPoints = (h, p, run, points) =>
  h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
const submitRun = (h, p, run, body) =>
  h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, ...body }, { token: p.token });

// ---------------------------------------------------------------------------------------------
// H1. Shards are credited only for clean runs with checkpoint coverage.
//     Break caught: a forged 5-second ticketed run (start, wait, submit) banking up to 60 shards.
// ---------------------------------------------------------------------------------------------

const shardRows = async (h) => (await h.db.query("SELECT subject, shards FROM shard_days ORDER BY subject")).rows;

/** Starts a TRIAL, posts one valid checkpoint at `cpT`, then submits a run of `durationMs`. */
async function runWithOneCheckpoint(h, p, cpT, { shards = 10, kills = 20, durationMs = 60_000 } = {}) {
  const run = await start(h, p);
  h.clock.advance(cpT + 1_000);
  const cp = await postPoints(h, p, run, [{ t: cpT, score: 100, kills: 2, shards: 1 }]);
  assert.equal(cp.status, 200, JSON.stringify(cp.body));
  h.clock.advance(durationMs - cpT + 500);
  return submitRun(h, p, run, { score: 1000, kills, shards, durationMs });
}

test("H1: an honest verified run with checkpoint coverage banks its shards", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await playTrial(h, p, { kills: 20, shards: 10 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await shardRows(h), [{ subject: p.address, shards: 10 }]);
  } finally { await h.close(); }
});

test("H1: a forged 5-second run with no checkpoints is accepted (200) but banks no shards", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(6_000);
    const res = await submitRun(h, p, run, { score: 100, kills: 50, shards: 50, durationMs: 5_500 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rankedOk, false);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("H1: a flagged run banks no shards even when its checkpoints cover the whole run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(45_000);
    const good = [10_000, 20_000, 30_000, 40_000].map((t, i) => ({ t, score: (i + 1) * 100, kills: (i + 1) * 5, shards: (i + 1) * 2 }));
    assert.equal((await postPoints(h, p, run, good)).status, 200);
    const bad = await postPoints(h, p, run, [{ t: 41_000, score: 10, kills: 20, shards: 8 }]); // score goes backwards
    assert.equal(bad.status, 422);
    assert.ok(bad.body.reason.includes("cp_regress"));
    h.clock.advance(16_000);
    // last stored checkpoint is at 40s of 60s (coverage 0.67), so only the flag can block the credit
    const res = await submitRun(h, p, run, { score: 600, kills: 25, shards: 10, durationMs: 60_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.flags.includes("cp_regress"));
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("H1: checkpoint coverage must reach half the run: 49% banks nothing, exactly 50% banks", async () => {
  const h = await makeHarness();
  try {
    const under = await h.newPlayer({ verified: true });
    const exact = await h.newPlayer({ verified: true });
    const a = await runWithOneCheckpoint(h, under, 29_000); // 29s of 60s = 0.483
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await runWithOneCheckpoint(h, exact, 30_000); // 30s of 60s = 0.5
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(await shardRows(h), [{ subject: exact.address, shards: 10 }]);
  } finally { await h.close(); }
});
