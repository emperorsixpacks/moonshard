import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeHarness } from "./helpers.js";

// Run ids are UUIDs the server issued. Anything else is refused before it reaches the database.
// Break caught: a NUL byte in a run id ("%00" in the path, "\u0000" in the attest body) is not valid text for
// Postgres, so the lookup threw and the player got a 500 and an error in the log instead of a plain refusal.

const BAD_IDS = [
  ["a NUL byte", "abc\u0000def"],
  ["a NUL byte percent-encoded", "abc%00def"],
  ["plain text", "nope"],
  ["a UUID with a character too many", `${crypto.randomUUID()}0`],
  ["a UUID with a character too few", crypto.randomUUID().slice(0, -1)],
  ["a UUID in capitals", crypto.randomUUID().toUpperCase()],
  ["a UUID with braces", `{${crypto.randomUUID()}}`],
  ["an SQL fragment", "' OR '1'='1"],
  ["a number", "12345"],
];

async function post(h, path, token, body) {
  const res = await fetch(`${h.base}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("a malformed run id in the path is 400 bad_run_id on both run routes, never a 500", async () => {
  const h = await makeHarness();
  const errors = [];
  const log = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const p = await h.newPlayer({ verified: true });
    for (const [label, id] of BAD_IDS) {
      // percent-encode so the id reaches Express as the path segment it is (a NUL cannot travel raw)
      const seg = id.includes("%") ? id : encodeURIComponent(id);
      const cp = await post(h, `/runs/${seg}/checkpoints`, p.token, { points: [{ t: 1000, score: 0, kills: 0, shards: 0 }] });
      assert.deepEqual([cp.status, cp.body.error], [400, "bad_run_id"], `checkpoints, ${label}`);
      const sub = await post(h, `/runs/${seg}/submit`, p.token, { ticket: "x", score: 0, kills: 0, durationMs: 60_000 });
      assert.deepEqual([sub.status, sub.body.error], [400, "bad_run_id"], `submit, ${label}`);
    }
    assert.deepEqual(errors, [], "nothing was logged as an unexpected error");
  } finally { console.error = log; await h.close(); }
});

test("a well-formed run id nobody issued is still 404 run_not_found, and a real one still works", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const nobody = crypto.randomUUID();
    assert.deepEqual((await post(h, `/runs/${nobody}/checkpoints`, p.token, { points: [{ t: 1000, score: 0, kills: 0, shards: 0 }] })).body, { error: "run_not_found" });
    assert.equal((await post(h, `/runs/${nobody}/submit`, p.token, { ticket: "x", score: 0, kills: 0, durationMs: 60_000 })).status, 404);

    const run = (await post(h, "/runs/start", p.token, { mode: "TRIAL" })).body;
    assert.match(run.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "the ids the server issues are the ones it accepts");
    h.clock.advance(20_000);
    const ok = await post(h, `/runs/${run.runId}/checkpoints`, p.token, { points: [{ t: 10_000, score: 0, kills: 0, shards: 0 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally { await h.close(); }
});

test("a malformed runId in the attest body is 400 bad_run_id, after the checks that do not depend on it", async () => {
  const h = await makeHarness();
  const errors = [];
  const log = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const p = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    for (const [label, id] of BAD_IDS) {
      const r = await post(h, "/engagement/attest", p.token, { runId: id });
      assert.deepEqual([r.status, r.body.error], [400, "bad_run_id"], label);
    }
    for (const [label, runId] of [["missing", undefined], ["null", null], ["a number", 7], ["an object", { a: 1 }], ["an array", ["x"]]]) {
      const r = await post(h, "/engagement/attest", p.token, { runId });
      assert.deepEqual([r.status, r.body.error], [400, "bad_run_id"], label);
    }
    // an unverified player is told so before anything about the id
    assert.equal((await post(h, "/engagement/attest", u.token, { runId: "nope" })).body.error, "verification_required");
    // a well-formed id that is not a cleared boss run keeps its answer
    const r = await post(h, "/engagement/attest", p.token, { runId: crypto.randomUUID() });
    assert.deepEqual([r.status, r.body.error], [403, "boss_not_cleared"]);
    assert.deepEqual(errors, [], "nothing was logged as an unexpected error");
  } finally { console.error = log; await h.close(); }
});
