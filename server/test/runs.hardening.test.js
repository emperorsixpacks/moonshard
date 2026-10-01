import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness } from "./helpers.js";

// Regression tests for defects found while reviewing the Task 5 implementation.
// They live in their own file so runs.test.js stays exactly as the plan specifies.

const start = async (h, p, mode = "TRIAL") => {
  const r = await h.api.post("/runs/start", { mode }, { token: p.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

/**
 * Forces the worst-case interleaving: `n` concurrent handlers all read the run row (and see
 * status 'open') before any of them is allowed to continue. PGlite queues queries FIFO so a plain
 * Promise.all would not reliably hit this window; a pooled Postgres does.
 */
function holdAfterRunRead(h, n) {
  const original = h.db.query.bind(h.db);
  const waiting = [];
  h.db.query = async (sql, params) => {
    const result = await original(sql, params);
    if (typeof sql === "string" && sql.startsWith("SELECT * FROM runs WHERE run_id")) {
      await new Promise((resolve) => {
        waiting.push(resolve);
        if (waiting.length === n) waiting.forEach((release) => release());
      });
    }
    return result;
  };
}

test("a ticket submitted twice concurrently is recorded once: one 200, one 409, shards credited once", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(61_000);
    holdAfterRunRead(h, 2);
    const body = { ticket: run.ticket, score: 1000, kills: 40, shards: 30, durationMs: 60_000 };
    const [a, b] = await Promise.all([
      h.api.post(`/runs/${run.runId}/submit`, body, { token: p.token }),
      h.api.post(`/runs/${run.runId}/submit`, body, { token: p.token }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    const loser = a.status === 409 ? a : b;
    assert.equal(loser.body.error, "already_submitted");
    const shards = await h.db.query("SELECT shards FROM shard_days");
    assert.equal(shards.rows.length, 1);
    assert.equal(shards.rows[0].shards, 30);
    const runs = await h.db.query("SELECT status FROM runs WHERE run_id = $1", [run.runId]);
    assert.equal(runs.rows[0].status, "submitted");
  } finally { await h.close(); }
});

test("a checkpoint with an absurd shard count is flagged (422), not a 500", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(20_000);
    const post = (points) => h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
    const bad = await post([{ t: 10_000, score: 100, kills: 2, shards: 3_000_000_000 }]);
    assert.equal(bad.status, 422, JSON.stringify(bad.body));
    assert.equal(bad.body.error, "bad_checkpoint");
    assert.ok(bad.body.reason.includes("cp_shards"));
    const stored = await h.db.query("SELECT count(*)::int AS n FROM run_checkpoints WHERE run_id = $1", [run.runId]);
    assert.equal(stored.rows[0].n, 0);
    // a legitimate in-range value is still accepted afterwards
    assert.equal((await post([{ t: 10_000, score: 100, kills: 2, shards: 25 }])).status, 200);
  } finally { await h.close(); }
});
