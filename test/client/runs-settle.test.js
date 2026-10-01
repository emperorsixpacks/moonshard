import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../../src/gd/runs.js';
import { makeHarness, settle, apiError } from './helpers/run-harness.js';

/*
 * How a run is settled with the server: one finish per run (M3), the next run's start waits for it (M4),
 * the submit and the closing checkpoint survive one failed attempt (M5, M6), failures carry a reason the
 * scenes can show (M6) and every time sent to the server is measured from the start response (L7).
 */

const STORY_WIN = { score: 0, kills: 5, shards: 1, durationMs: 30_000, bossCleared: true };
const submitsOf = (h) => h.pathsOf(/\/submit$/);
const startsOf = (h) => h.calls.filter((c) => c.path === '/runs/start');
const pointsOf = (h) => h.pathsOf(/\/checkpoints$/).flatMap((c) => c.body.points);

// ---------------------------------------------------------------------------------------------- M3

test('M3a: a second finish() while the first is still settling posts no second submit', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(30_000);
  h.hold(/\/checkpoints$/); // the closing checkpoint of the first finish stays in flight
  const first = h.tracker.finish(STORY_WIN);
  await settle();
  const second = h.tracker.finish({ ...STORY_WIN, bossCleared: false }); // e.g. a stray hazard after the shrine was cleansed
  h.release(0);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(submitsOf(h).length, 1, 'the ticket is submitted once');
  assert.equal(submitsOf(h)[0].body.bossCleared, true, 'the first outcome wins');
  assert.deepEqual(b, a, 'both callers get the same settlement');
});

test('M3a: finish() after the run was already settled returns that settlement and posts nothing', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(30_000);
  const a = await h.tracker.finish(STORY_WIN);
  const calls = h.calls.length;
  const b = await h.tracker.finish({ ...STORY_WIN, bossCleared: false });
  assert.deepEqual(b, a);
  assert.equal(h.calls.length, calls, 'no further request');
});

test('M3b: a kill or shard after finish() cannot raise the closing checkpoint above the submitted totals', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(10_000);
  h.tracker.update({ score: 0, kills: 3, shards: 0 });
  h.hold(/\/checkpoints$/); // the periodic checkpoint is in flight when the shrine is cleansed
  const periodic = h.tick();
  await settle();
  h.advance(10_000);
  const fin = h.tracker.finish({ score: 0, kills: 5, shards: 1, durationMs: 20_000, bossCleared: true });
  h.tracker.update({ score: 0, kills: 9, shards: 4 }); // StoryScene.update() keeps calling runs.update() every frame
  h.release(0);
  await periodic;
  await fin;
  const submit = submitsOf(h)[0].body;
  assert.equal(submit.kills, 5);
  assert.equal(submit.shards, 1);
  for (const p of pointsOf(h)) {
    assert.ok(p.kills <= submit.kills && p.shards <= submit.shards && p.score <= submit.score, `checkpoint ${JSON.stringify(p)} is above the submitted totals`);
  }
  const closing = pointsOf(h).at(-1);
  assert.deepEqual([closing.score, closing.kills, closing.shards], [0, 5, 1], 'the closing checkpoint carries the totals passed to finish()');
});

test('M3b: totals passed to finish() that fall below an earlier sample are raised to it, so the server never sees a regression', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(10_000);
  h.tracker.update({ score: 500, kills: 4, shards: 2 });
  await h.tick();
  h.advance(10_000);
  await h.tracker.finish({ score: 480, kills: 4, shards: 1, durationMs: 20_000 });
  const body = submitsOf(h)[0].body;
  assert.deepEqual([body.score, body.kills, body.shards], [500, 4, 2]);
});

test('M3b: update() after finish() does not leak into the next run', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(20_000);
  await h.tracker.finish(STORY_WIN);
  h.tracker.update({ kills: 40, shards: 9 }); // the dying scene
  await h.tracker.start({ mode: 'STORY', chapter: 2 });
  h.advance(10_000);
  await h.tick();
  const next = h.pathsOf(/\/runs\/r2\/checkpoints$/)[0].body.points[0];
  assert.deepEqual([next.score, next.kills, next.shards], [0, 0, 0]);
});

test('M3: stop() on scene shutdown does not cancel a settlement already under way', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(30_000);
  h.hold(/\/checkpoints$/);
  const fin = h.tracker.finish({ ...STORY_WIN, bossCleared: false }); // death
  await settle();
  h.tracker.stop(); // the retry button restarted the scene 350 ms later
  h.release(0);
  const res = await fin;
  assert.equal(res.ticketed, true);
  assert.deepEqual(submitsOf(h).map((c) => c.path), ['/runs/r1/submit']);
  assert.equal(submitsOf(h)[0].body.ticket, 'tk');
});

test('update() ignores values that are not whole non-negative numbers and never lowers a counter', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.tracker.update({ score: 120.9, kills: 3, shards: 2 });
  h.tracker.update({ score: undefined, kills: NaN, shards: -1 });
  h.tracker.update({ score: 50, kills: 'many', shards: null });
  h.tracker.update(null);
  h.tracker.update(undefined);
  h.advance(10_000);
  await h.tick();
  assert.deepEqual(pointsOf(h)[0], { t: 10_000, score: 120, kills: 3, shards: 2 });
});

test('start() with a response that has no run id or ticket yields no run, with reason rejected', async () => {
  const h = makeHarness();
  h.on('/runs/start', () => ({ ok: true }));
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  assert.equal(h.liveIntervals(), 0);
  assert.deepEqual(await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: 9_000 }), { ticketed: false, reason: 'rejected' });
});

test('M3: with nothing to settle, every finish() gets the same unticketed answer until the next start()', async () => {
  const h = makeHarness({ token: null });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  const first = await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: 9_000 });
  const second = await h.tracker.finish({ score: 2, kills: 1, shards: 0, durationMs: 9_000 });
  assert.deepEqual([first, second], [{ ticketed: false, reason: 'not_connected' }, { ticketed: false, reason: 'not_connected' }]);
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  assert.deepEqual(await h.tracker.finish({}), { ticketed: false, reason: 'not_connected' }, 'a new start() begins a new answer');
});

test('finish() never throws, and a failure of our own is not blamed on the network', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.tracker._post = () => { throw new RangeError('bug in _post'); }; // not an API failure: the API errors are caught inside
  const res = await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: 9_000 });
  assert.deepEqual([res.ticketed, res.error, res.reason], [true, 'bug in _post', 'server_error']);
});

test('finish() never throws, even when the API throws synchronously', async () => {
  const h = makeHarness({ tracker: { api: (path) => { if (path.endsWith('/submit')) throw new TypeError('boom'); return Promise.resolve({ runId: 'r1', ticket: 'tk', seed: 's', ok: true }); } } });
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  const res = await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: 30_000 });
  assert.deepEqual([res.ticketed, res.error, res.reason], [true, 'boom', 'offline']);
});

// ---------------------------------------------------------------------------------------------- M4

test('M4: start() waits for the previous finish() so /runs/start cannot void the run before its submit lands', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(20_000);
  h.hold(/\/submit$/); // slow API: the submit of the first life is still on its way
  const finishA = h.tracker.finish({ ...STORY_WIN, bossCleared: false });
  await settle();
  const startB = h.tracker.start({ mode: 'STORY', chapter: 1 }); // retry, 350 ms after the death
  await settle();
  assert.equal(startsOf(h).length, 1, 'the next run has not been requested yet');
  h.release(0);
  await finishA;
  const runB = await startB;
  assert.equal(runB.runId, 'r2');
  const order = h.calls.map((c) => c.path);
  assert.ok(order.indexOf('/runs/r1/submit') < order.lastIndexOf('/runs/start'), 'submit of run 1 is sent before run 2 starts');
});

test('M4: start() gives up waiting after the cap when the previous finish() is stuck', async () => {
  const h = makeHarness({ settleWaitMs: 4_000 });
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(20_000);
  h.hold(/\/submit$/); // never answers within the test
  const finishA = h.tracker.finish(STORY_WIN);
  await settle();
  const startB = h.tracker.start({ mode: 'STORY', chapter: 2 });
  await settle();
  assert.equal(startsOf(h).length, 1);
  assert.deepEqual(h.timers.timeouts.map((s) => [s.ms, s.live]), [[4_000, true]], 'the wait is capped at 4 s');
  h.expireTimeouts();
  await settle();
  assert.equal(startsOf(h).length, 2, 'the next run starts anyway');
  assert.equal((await startB).runId, 'r2');
  h.release(0); // the old submit finally lands, on its own ticket
  assert.equal((await finishA).ticketed, true);
  assert.equal(submitsOf(h)[0].path, '/runs/r1/submit');
});

test('M4: the wait is capped at 4 s by default, and its timer is cleared when the previous finish() settles first', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(20_000);
  h.hold(/\/submit$/);
  const finishA = h.tracker.finish(STORY_WIN);
  await settle();
  const startB = h.tracker.start({ mode: 'STORY', chapter: 2 });
  await settle();
  assert.deepEqual(h.timers.timeouts.map((slot) => slot.ms), [4_000]);
  h.release(0);
  await finishA;
  await startB;
  assert.equal(h.timers.timeouts.filter((slot) => slot.live).length, 0, 'no timer left running');
});

test('M4: a run of another mode does not wait: the server only voids runs of the same mode', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(20_000);
  h.hold(/\/submit$/);
  const finishA = h.tracker.finish(STORY_WIN);
  await settle();
  await h.tracker.start({ mode: 'TRIAL' });
  assert.equal(startsOf(h).length, 2);
  h.release(0);
  await finishA;
});

test('M4: finish() while the next start is still waiting drops that start and reports why', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(20_000);
  h.hold(/\/submit$/);
  const finishA = h.tracker.finish(STORY_WIN);
  await settle();
  const startB = h.tracker.start({ mode: 'STORY', chapter: 2 });
  await settle();
  const finishB = await h.tracker.finish({ score: 0, kills: 1, shards: 0, durationMs: 9_000 }); // died within the wait
  assert.deepEqual(finishB, { ticketed: false, reason: 'starting' });
  h.release(0);
  await finishA;
  assert.equal(await startB, null);
  assert.equal(startsOf(h).length, 1, 'no orphan run was requested');
  assert.equal(h.liveIntervals(), 0);
});

// ---------------------------------------------------------------------------------------------- M5

test('M5: the submit is retried once when the first attempt times out', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 0, 'timeout');
  const res = await h.tracker.finish({ score: 100, kills: 2, shards: 0, durationMs: 30_000 });
  assert.equal(submitsOf(h).length, 2);
  assert.deepEqual(submitsOf(h)[1].body, submitsOf(h)[0].body, 'the retry is the same submission');
  assert.equal(res.ticketed, true);
  assert.equal(res.rankedOk, true);
  assert.equal(res.error, undefined);
});

test('M5: when the retried submit finds the run already submitted, the run was recorded', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 0, 'timeout'); // the server processed it, but the answer never arrived
  h.failNext(/\/submit$/, 409, 'already_submitted');
  const res = await h.tracker.finish({ score: 100, kills: 2, shards: 0, durationMs: 30_000 });
  assert.equal(res.ticketed, true);
  assert.equal(res.alreadySubmitted, true);
  assert.equal(res.error, undefined, 'not an error');
});

test('M5: 409 already_submitted on the first attempt also counts as recorded', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 409, 'already_submitted');
  const res = await h.tracker.finish({ score: 100, kills: 2, shards: 0, durationMs: 30_000 });
  assert.equal(submitsOf(h).length, 1);
  assert.equal(res.alreadySubmitted, true);
  assert.equal(res.error, undefined);
});

test('M5: a rejected submit (4xx) is final: one attempt, with the server code and a reason', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 400, 'invalid_duration');
  const res = await h.tracker.finish({ score: 100, kills: 2, shards: 0, durationMs: 30_000 });
  assert.equal(submitsOf(h).length, 1);
  assert.deepEqual([res.ticketed, res.error, res.status, res.reason], [true, 'invalid_duration', 400, 'rejected']);
});

test('M5: two failed submits end as an offline result, never as success', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 0, 'timeout', 2);
  const res = await h.tracker.finish({ score: 100, kills: 2, shards: 0, durationMs: 30_000 });
  assert.equal(submitsOf(h).length, 2);
  assert.deepEqual([res.ticketed, res.error, res.status, res.reason], [true, 'timeout', 0, 'offline']);
});

test('M5: a run voided by a newer start is reported as superseded', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 409, 'run_void');
  const res = await h.tracker.finish({ score: 100, kills: 2, shards: 0, durationMs: 30_000 });
  assert.deepEqual([res.ticketed, res.error, res.reason], [true, 'run_void', 'superseded']);
});

// ---------------------------------------------------------------------------------------------- M6

test('M6: a failed closing checkpoint is retried once with the identical batch', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(10_000);
  h.tracker.update({ score: 0, kills: 2, shards: 0 });
  await h.tick(); // first checkpoint at 10 s
  h.advance(30_000);
  h.failNext(/\/checkpoints$/, 0, 'timeout'); // the closing POST fails once
  const res = await h.tracker.finish({ score: 0, kills: 6, shards: 1, durationMs: 40_000, bossCleared: true });
  const cps = h.pathsOf(/\/checkpoints$/);
  assert.equal(cps.length, 3, 'periodic, closing, closing retry');
  assert.deepEqual(cps[2].body, cps[1].body, 'the retry is the identical batch');
  assert.equal(res.checkpointFailed, undefined);
  assert.equal(submitsOf(h).length, 1);
});

test('M6: a closing checkpoint that fails twice is reported, recorded in lastError, and the run is still submitted', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.advance(40_000);
  h.failNext(/\/checkpoints$/, 0, 'timeout', 2);
  const res = await h.tracker.finish({ score: 0, kills: 6, shards: 1, durationMs: 40_000, bossCleared: true });
  assert.equal(h.pathsOf(/\/checkpoints$/).length, 2);
  assert.equal(res.ticketed, true);
  assert.equal(res.checkpointFailed, true);
  assert.equal(submitsOf(h).length, 1);
  assert.deepEqual([h.tracker.lastError.where, h.tracker.lastError.status, h.tracker.lastError.code], ['checkpoint', 0, 'timeout']);
});

test('M6: the boss bounty needs 80% coverage: a 40 s run with checkpoints at 10, 20, 30 s is saved by the retry, and shown as short without it', async () => {
  const run40 = async (failures) => {
    const h = makeHarness();
    await h.tracker.start({ mode: 'STORY', chapter: 1 });
    for (let i = 0; i < 3; i += 1) {
      h.advance(10_000);
      h.tracker.update({ score: 0, kills: i + 2, shards: 0 });
      await h.tick();
    }
    h.advance(10_000);
    if (failures) h.failNext(/\/checkpoints$/, 0, 'timeout', failures);
    const res = await h.tracker.finish({ score: 0, kills: 6, shards: 0, durationMs: 40_000, bossCleared: true });
    return { h, res, lastAcked: Math.max(...pointsOf(h).map((p) => p.t)) };
  };
  const retried = await run40(1);
  assert.equal(retried.res.coverage, 1, 'with the retry the closing checkpoint at 40 s reaches the server: coverage 100%');
  assert.equal(retried.res.checkpointFailed, undefined);
  const lost = await run40(2);
  assert.equal(lost.res.coverage, 0.75, '30 s of 40 s is below the 0.8 the server demands for a boss clear');
  assert.equal(lost.res.checkpointFailed, true, 'and the result says so, so the screen can explain it');
});

test('M6: a closing checkpoint refused by the server (422) is not retried', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(40_000);
  h.failNext(/\/checkpoints$/, 422, 'bad_checkpoint');
  const res = await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 40_000 });
  assert.equal(h.pathsOf(/\/checkpoints$/).length, 1);
  assert.equal(res.checkpointFailed, true);
});

test('M6: the result tells how much of the run the server has seen (coverage)', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(10_000);
  await h.tick();
  h.advance(30_000);
  h.failNext(/\/checkpoints$/, 0, 'timeout', 2);
  const res = await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 40_000 });
  assert.equal(res.coverage, 0.25, 'only the 10 s checkpoint arrived, of 40 s');

  const ok = makeHarness();
  await ok.tracker.start({ mode: 'TRIAL' });
  ok.advance(40_000);
  const full = await ok.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 40_000 });
  assert.ok(full.coverage >= 1);
});

for (const [status, code, reason] of [
  [0, 'network_error', 'offline'],
  [0, 'timeout', 'offline'],
  [503, 'chain_unavailable', 'server_error'],
  [500, 'internal_error', 'server_error'],
  [401, 'invalid_session', 'signed_out'],
  [429, 'rate_limited', 'rate_limited'],
  [400, 'bad_mode', 'rejected'],
]) {
  test(`M6: start() failing with ${status} ${code} becomes finish() -> { ticketed: false, reason: '${reason}' }`, async () => {
    const h = makeHarness();
    h.failNext('/runs/start', status, code);
    assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
    h.advance(30_000);
    assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 30_000 }), { ticketed: false, reason });
    assert.equal(h.tracker.lastError.where, 'start');
    assert.equal(h.tracker.lastError.status, status);
    assert.equal(h.liveIntervals(), 0);
  });
}

test('M6: without a session token the run is unticketed with reason not_connected, also if a token appears later', async () => {
  let token = null;
  const h = makeHarness({ tracker: { getToken: () => token } });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  token = 'tok-from-a-wallet-connected-mid-run';
  assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 9_000 }), { ticketed: false, reason: 'not_connected' });
  assert.equal(h.calls.length, 0);
});

test('M6: HTTP 401 calls the auth-lost handler once per run, wherever it is seen', async () => {
  const h = makeHarness();
  const seen = [];
  h.tracker.setAuthLostHandler((info) => seen.push(info));
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/checkpoints$/, 401, 'invalid_session', 2);
  h.failNext(/\/submit$/, 401, 'invalid_session');
  const res = await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 30_000 });
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].status, seen[0].code, seen[0].where], [401, 'invalid_session', 'checkpoint']);
  assert.deepEqual([res.ticketed, res.reason, res.status], [true, 'signed_out', 401]);

  // a following run can report again
  h.failNext('/runs/start', 401, 'invalid_session');
  await h.tracker.start({ mode: 'TRIAL' });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].where, 'start');
});

test('M6: a 401 bad_ticket is about the ticket, not the session: the auth-lost handler stays quiet', async () => {
  const h = makeHarness();
  const seen = [];
  h.tracker.setAuthLostHandler((info) => seen.push(info));
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(30_000);
  h.failNext(/\/submit$/, 401, 'bad_ticket');
  const res = await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 30_000 });
  assert.equal(seen.length, 0);
  assert.deepEqual([res.reason, res.error], ['rejected', 'bad_ticket']);
});

test('M6: a throwing auth-lost handler cannot break the run', async () => {
  const h = makeHarness();
  h.tracker.setAuthLostHandler(() => { throw new Error('boom'); });
  h.failNext('/runs/start', 401, 'invalid_session');
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  assert.equal((await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: 9_000 })).reason, 'signed_out');
});

test('M6: a failed periodic checkpoint is recorded in lastError but not re-sent', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(10_000);
  h.failNext(/\/checkpoints$/, 500, 'internal_error');
  await h.tick();
  assert.deepEqual([h.tracker.lastError.where, h.tracker.lastError.status, h.tracker.lastError.code], ['checkpoint', 500, 'internal_error']);
  assert.equal(h.pathsOf(/\/checkpoints$/).length, 1);
});

// ---------------------------------------------------------------------------------------------- L7

test('L7: t is measured from the moment the start response arrived, not from the request', async () => {
  const h = makeHarness();
  h.hold('/runs/start');
  const pending = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  h.advance(6_000); // cold start: the server answers 6 s after the request
  h.release(0, { runId: 'r1', ticket: 'tk', seed: 's' });
  await pending;
  h.advance(10_000);
  await h.tick();
  assert.equal(pointsOf(h)[0].t, 10_000, 'the server saw the run start about when the response left, so t cannot be ahead of its clock');
});

test('L7: durationMs is clamped to the time since the run began, so a scene clock that started earlier cannot exceed the server\'s elapsed time', async () => {
  const h = makeHarness();
  h.hold('/runs/start');
  const pending = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  h.advance(6_000);
  h.release(0, { runId: 'r1', ticket: 'tk', seed: 's' });
  await pending;
  h.advance(30_000);
  await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 36_000 }); // the scene counted from before the response
  assert.equal(submitsOf(h)[0].body.durationMs, 30_000);
});

test('L7: durationMs that is not a usable number falls back to the time since the run began', async () => {
  for (const bad of [undefined, NaN, -5, 'soon']) {
    const h = makeHarness();
    await h.tracker.start({ mode: 'TRIAL' });
    h.advance(12_000);
    await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: bad });
    assert.equal(submitsOf(h)[0].body.durationMs, 12_000, String(bad));
  }
});

test('L7: the default clock is monotonic: Date.now() stepping back cannot produce a negative t', async () => {
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const points = [];
    const api = async (path, opts = {}) => {
      if (path === '/runs/start') return { runId: 'r1', ticket: 'tk', seed: 's' };
      if (path.endsWith('/checkpoints')) points.push(...opts.body.points);
      return { ok: true };
    };
    const timers = { fns: [], setInterval(fn) { this.fns.push(fn); return this.fns.length; }, clearInterval() {} };
    const tracker = new RunTracker({ api, getToken: () => 'tok', timers });
    await tracker.start({ mode: 'TRIAL' });
    skew = -3_600_000; // NTP or the user moves the system clock back an hour
    await timers.fns[0]();
    assert.ok(points[0].t >= 1 && points[0].t < 5_000, `t=${points[0].t}`);
    tracker.stop();
  } finally {
    Date.now = realNow;
  }
});

test('L7: every checkpoint time is an integer, at least 1 ms and strictly increasing, even when samples share a millisecond', async () => {
  const h = makeHarness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.tracker.update({ kills: 1 });
  await h.tick(); // the clock has not moved: t would be 0, which the server refuses (t must be > 0)
  h.tracker.update({ kills: 2 });
  await h.tick(); // same millisecond again
  h.advance(10_000);
  h.tracker.update({ kills: 3 });
  await h.tracker.finish({ score: 0, kills: 3, shards: 0, durationMs: 10_000 });
  const ts = pointsOf(h).map((p) => p.t);
  assert.ok(ts.every(Number.isInteger));
  assert.ok(ts[0] >= 1);
  for (let i = 1; i < ts.length; i += 1) assert.ok(ts[i] > ts[i - 1], `t[${i}]=${ts[i]} must be above t[${i - 1}]=${ts[i - 1]}`);
});

test('setAuthLostHandler(null) clears the handler', async () => {
  const h = makeHarness();
  const seen = [];
  h.tracker.setAuthLostHandler((i) => seen.push(i));
  h.tracker.setAuthLostHandler(null);
  h.failNext('/runs/start', 401, 'invalid_session');
  await h.tracker.start({ mode: 'TRIAL' });
  assert.equal(seen.length, 0);
});

test('apiError helper builds errors the way apiFetch does', () => {
  const e = apiError(409, 'run_void');
  assert.deepEqual([e.message, e.status], ['run_void', 409]);
});
