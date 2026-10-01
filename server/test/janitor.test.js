import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { makeHarness, T0 } from "./helpers.js";
import { runJanitor, JANITOR_INTERVAL_MS, VOID_RUN_RETENTION_MS, SUBMITTED_CHECKPOINT_RETENTION_MS } from "../src/janitor.js";
import { startSettlementCron } from "../src/cron.js";

// Nothing used to be deleted: every run a player started stayed in `runs`, with all its checkpoints, for ever. A run
// that is voided by the next start, or whose ticket expires, can never be submitted; a submitted run's checkpoints
// are only read while the run is being submitted. The janitor removes both once they are of no use to anyone.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const agoMs = (now, ms) => new Date(now - ms);

async function insertRun(h, { id, subject = "0xaa", status, startedAgo, submittedAgo = null, day = "2026-10-03", checkpoints = 0 }) {
  const now = h.clock();
  await h.db.query(
    `INSERT INTO runs(run_id, subject, wallet, verified, mode, chapter, seed, day, started_at, status, submitted_at)
     VALUES ($1,$2,$2,false,'TRIAL',NULL,$3,$4,$5,$6,$7)`,
    [id, subject + id, day, day, agoMs(now, startedAgo), status, submittedAgo == null ? null : agoMs(now, submittedAgo)],
  );
  for (let i = 1; i <= checkpoints; i++) {
    await h.db.query("INSERT INTO run_checkpoints(run_id, seq, t_ms, score, kills, shards) VALUES ($1,$2,$3,0,0,0)", [id, i, i * 10_000]);
  }
}
const runIds = async (h) => (await h.db.query("SELECT run_id FROM runs ORDER BY run_id")).rows.map((r) => r.run_id);
const checkpointCounts = async (h) =>
  Object.fromEntries((await h.db.query("SELECT run_id, count(*)::int AS n FROM run_checkpoints GROUP BY run_id ORDER BY run_id")).rows.map((r) => [r.run_id, r.n]));
const count = async (h, table) => (await h.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

test("the policy: void and expired-open runs go after a day, a submitted run's checkpoints after two", () => {
  assert.equal(VOID_RUN_RETENTION_MS, DAY);
  assert.equal(SUBMITTED_CHECKPOINT_RETENTION_MS, 2 * DAY);
  assert.equal(JANITOR_INTERVAL_MS, HOUR);
});

test("deletes void and expired-open runs older than a day (checkpoints with them) and keeps everything else", async () => {
  const h = await makeHarness();
  try {
    await h.db.query("INSERT INTO settled_days(day) VALUES ('2026-10-01'), ('2026-10-02'), ('2026-10-03')");
    await insertRun(h, { id: "void-old", status: "void", startedAgo: DAY + HOUR, checkpoints: 3 });
    await insertRun(h, { id: "void-new", status: "void", startedAgo: 12 * HOUR, checkpoints: 2 });
    await insertRun(h, { id: "open-old", status: "open", startedAgo: 2 * DAY, checkpoints: 4 });
    await insertRun(h, { id: "open-mid", status: "open", startedAgo: 6 * HOUR, checkpoints: 1 }); // ticket long gone, but under a day
    await insertRun(h, { id: "open-live", status: "open", startedAgo: 5 * 60_000, checkpoints: 1 });
    await insertRun(h, { id: "done-old", status: "submitted", startedAgo: 3 * DAY + 60_000, submittedAgo: 3 * DAY, checkpoints: 5 });

    const out = await runJanitor(h.ctx);
    assert.equal(out.voidRuns, 1);
    assert.equal(out.openRuns, 1);

    assert.deepEqual(await runIds(h), ["done-old", "open-live", "open-mid", "void-new"], "a submitted run itself is never deleted");
    assert.deepEqual(await checkpointCounts(h), { "open-live": 1, "open-mid": 1, "void-new": 2 }, "done-old lost its checkpoints; the deleted runs' went with them");
  } finally { await h.close(); }
});

test("deletes the checkpoints of submitted runs older than two days, once their day is settled", async () => {
  const h = await makeHarness();
  try {
    await h.db.query("INSERT INTO settled_days(day) VALUES ('2026-10-01'), ('2026-10-02')");
    await insertRun(h, { id: "s-old", status: "submitted", startedAgo: 3 * DAY, submittedAgo: 3 * DAY - 60_000, day: "2026-10-01", checkpoints: 4 });
    await insertRun(h, { id: "s-recent", status: "submitted", startedAgo: DAY + HOUR, submittedAgo: DAY, day: "2026-10-02", checkpoints: 4 });
    // two days old, but its day has not been settled (the server was down, or no vault was configured): kept
    await insertRun(h, { id: "s-unsettled", status: "submitted", startedAgo: 3 * DAY, submittedAgo: 3 * DAY - 60_000, day: "2026-09-28", checkpoints: 4 });

    const out = await runJanitor(h.ctx);
    assert.equal(out.checkpoints, 4);
    assert.deepEqual(await checkpointCounts(h), { "s-recent": 4, "s-unsettled": 4 });
    assert.equal(await count(h, "runs"), 3, "no run row is removed");
  } finally { await h.close(); }
});

test("the cutoffs are strict: exactly a day old stays, a millisecond older goes", async () => {
  const h = await makeHarness();
  try {
    await h.db.query("INSERT INTO settled_days(day) VALUES ('2026-10-03')");
    await insertRun(h, { id: "void-edge", status: "void", startedAgo: DAY });
    await insertRun(h, { id: "void-over", status: "void", startedAgo: DAY + 1 });
    await insertRun(h, { id: "open-edge", status: "open", startedAgo: DAY });
    await insertRun(h, { id: "open-over", status: "open", startedAgo: DAY + 1 });
    await insertRun(h, { id: "sub-edge", status: "submitted", startedAgo: 3 * DAY, submittedAgo: 2 * DAY, checkpoints: 1 });
    await insertRun(h, { id: "sub-over", status: "submitted", startedAgo: 3 * DAY, submittedAgo: 2 * DAY + 1, checkpoints: 1 });
    await runJanitor(h.ctx);
    assert.deepEqual(await runIds(h), ["open-edge", "sub-edge", "sub-over", "void-edge"]);
    assert.deepEqual(await checkpointCounts(h), { "sub-edge": 1 });
  } finally { await h.close(); }
});

test("it follows the clock it is given: the same data is kept now and deleted a day later", async () => {
  const h = await makeHarness();
  try {
    await insertRun(h, { id: "void-1", status: "void", startedAgo: 20 * HOUR, checkpoints: 2 });
    assert.deepEqual(await runJanitor(h.ctx), { voidRuns: 0, openRuns: 0, checkpoints: 0 });
    assert.equal(await count(h, "runs"), 1);
    h.clock.advance(5 * HOUR);
    assert.equal((await runJanitor(h.ctx)).voidRuns, 1);
    assert.equal(await count(h, "runs"), 0);
    assert.equal(await count(h, "run_checkpoints"), 0);

    // and an explicit clock overrides ctx.now
    await insertRun(h, { id: "void-2", status: "void", startedAgo: HOUR });
    assert.equal((await runJanitor(h.ctx, { now: () => h.clock() + 2 * DAY })).voidRuns, 1);
  } finally { await h.close(); }
});

test("it is idempotent: a second pass finds nothing, and what it must never touch is untouched", async () => {
  const h = await makeHarness();
  try {
    await h.db.query("INSERT INTO settled_days(day) VALUES ('2026-10-01')");
    await insertRun(h, { id: "void-old", status: "void", startedAgo: 2 * DAY, checkpoints: 2 });
    await insertRun(h, { id: "done-old", status: "submitted", startedAgo: 4 * DAY, submittedAgo: 4 * DAY, day: "2026-10-01", checkpoints: 2 });
    // what settlement and the player-facing endpoints read
    await h.db.query("INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id) VALUES ('2026-10-01','0xaa','0xaa',true,true,5,1,60000,'done-old')");
    await h.db.query("INSERT INTO shard_days(day, subject, shards) VALUES ('2026-10-01','0xaa',9)");
    await h.db.query("INSERT INTO spoils(id, kind, day, subject, amount) VALUES ('1','SHARD_HARVEST','2026-10-01','0xaa','2')");
    await h.db.query("INSERT INTO spoil_claims(tx_hash, spoil_id, subject, amount) VALUES ('0x1','1','0xaa','2')");
    await h.db.query("INSERT INTO engagement_claims(tx_hash, subject, wallet) VALUES ('0x2','0xaa','0xaa')");
    await h.db.query("INSERT INTO ubi_claims(tx_hash, subject, wallet, day) VALUES ('0x3','0xaa','0xaa','2026-10-01')");
    const tables = ["scores", "shard_days", "settled_days", "spoils", "spoil_claims", "engagement_claims", "ubi_claims", "users", "wallets"];
    const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(h, t)])));

    const first = await runJanitor(h.ctx);
    assert.deepEqual(first, { voidRuns: 1, openRuns: 0, checkpoints: 2 });
    const snapshot = JSON.stringify([await runIds(h), await checkpointCounts(h)]);
    assert.deepEqual(await runJanitor(h.ctx), { voidRuns: 0, openRuns: 0, checkpoints: 0 });
    assert.equal(JSON.stringify([await runIds(h), await checkpointCounts(h)]), snapshot);
    const after = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(h, t)])));
    assert.deepEqual(after, before);
  } finally { await h.close(); }
});

test("a pending settlement still gets what it needs: a day whose runs were swept settles exactly as before", async () => {
  const { playTrial } = await import("./helpers.js");
  const { settleDue } = await import("../src/spoils.js");
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500, kills: 40, shards: 30 });
    // the day is not settled yet (the server was down for three days), so the janitor's first pass finds a run
    // older than two days whose checkpoints it must leave alone
    h.clock.set(Date.parse("2026-10-08T12:00:00.000Z"));
    const out = await runJanitor(h.ctx);
    assert.equal(out.checkpoints, 0, "the day is not settled, so its checkpoints stay");
    assert.ok(await count(h, "run_checkpoints") > 0);
    const settled = await settleDue(h.ctx);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].prizes, 1);
    assert.equal(settled[0].harvests, 1);
    // and now that it is settled, the next pass removes the checkpoints
    assert.ok((await runJanitor(h.ctx)).checkpoints > 0);
    assert.equal(await count(h, "run_checkpoints"), 0);
    assert.equal((await h.api.get("/spoils", { token: p.token })).body.spoils.length, 2, "prize and harvest are still redeemable");
  } finally { await h.close(); }
});

test("it runs in one transaction: a failure part-way leaves nothing deleted", async () => {
  const h = await makeHarness();
  try {
    await h.db.query("INSERT INTO settled_days(day) VALUES ('2026-10-01')");
    await insertRun(h, { id: "void-old", status: "void", startedAgo: 2 * DAY, checkpoints: 2 });
    await insertRun(h, { id: "done-old", status: "submitted", startedAgo: 4 * DAY, submittedAgo: 4 * DAY, day: "2026-10-01", checkpoints: 3 });

    const txs = [];
    const realTx = h.db.tx.bind(h.db);
    const realQuery = h.db.query.bind(h.db);
    let outside = 0;
    h.db.query = (sql, params) => { if (/DELETE FROM/.test(sql)) outside += 1; return realQuery(sql, params); };
    h.db.tx = (fn) => realTx((t) => {
      const log = [];
      txs.push(log);
      return fn({
        query: async (sql, params) => {
          log.push(sql);
          const out = await t.query(sql, params);
          if (log.filter((s) => /DELETE FROM/.test(s)).length === 1 && txs.failOnSecond) throw new Error("disk full");
          return out;
        },
      });
    });

    txs.failOnSecond = true;
    await assert.rejects(runJanitor(h.ctx), /disk full/);
    h.db.query = realQuery;
    assert.equal(txs.length, 1, "one transaction");
    assert.equal(outside, 0, "no DELETE ran outside it");
    assert.deepEqual(await runIds(h), ["done-old", "void-old"]);
    assert.deepEqual(await checkpointCounts(h), { "done-old": 3, "void-old": 2 }, "rolled back as a whole");

    txs.failOnSecond = false;
    const out = await runJanitor(h.ctx);
    assert.equal(txs.length, 2);
    assert.deepEqual(out, { voidRuns: 1, openRuns: 0, checkpoints: 3 });
  } finally { await h.close(); }
});

test("the cron runs the janitor once at start-up and then every hour, next to settlement", async () => {
  const h = await makeHarness();
  mock.timers.enable({ apis: ["setInterval"] });
  let stop;
  try {
    await insertRun(h, { id: "void-old", status: "void", startedAgo: 2 * DAY });
    const sweeps = [];
    const realTx = h.db.tx.bind(h.db);
    h.db.tx = (fn) => realTx((t) => fn({ query: (sql, params) => { if (/DELETE FROM runs/.test(sql)) sweeps.push(h.clock()); return t.query(sql, params); } }));

    stop = startSettlementCron(h.ctx, 60_000, { checkCaps: async () => ({ checked: false }) });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50)); // let the first pass finish (real timers still back setTimeout here)
    assert.equal(sweeps.length, 1, "once at start-up");
    assert.deepEqual(await runIds(h), []);

    mock.timers.tick(30 * 60_000);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sweeps.length, 1, "not before the hour is up");
    mock.timers.tick(30 * 60_000);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sweeps.length, 2, "again after an hour");

    stop();
    stop = null;
    mock.timers.tick(5 * HOUR);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sweeps.length, 2, "the stop function stops the janitor as well");
  } finally {
    stop?.();
    mock.timers.reset();
    await h.close();
  }
});

test("a janitor that fails is logged and does not stop the cron", async () => {
  const h = await makeHarness();
  mock.timers.enable({ apis: ["setInterval"] });
  const errors = [];
  let stop;
  try {
    h.db.tx = async () => { throw new Error("db gone"); };
    stop = startSettlementCron(h.ctx, 60_000, { checkCaps: async () => ({ checked: false }), log: { error: (...a) => errors.push(a.join(" ")), warn() {}, info() {} } });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(errors.some((e) => /janitor failed/.test(e) && /db gone/.test(e)), JSON.stringify(errors));
    mock.timers.tick(HOUR);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(errors.filter((e) => /janitor failed/.test(e)).length >= 2, "it tried again on the next tick");
  } finally {
    stop?.();
    mock.timers.reset();
    await h.close();
  }
});
