import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../../src/gd/runs.js';

/*
 * The scenes call `runs.start()` without awaiting it and `runs.stop()` on shutdown, and the server
 * flags a run on any non-increasing checkpoint time. These tests interleave slow network calls by
 * hand to pin down that behaviour.
 */

const settle = () => new Promise((resolve) => setImmediate(resolve));

function manualHarness({ holdCheckpoints = 0 } = {}) {
  let t = 1_000_000;
  const calls = [];
  const held = { start: [], checkpoints: [] };
  const timers = {
    fns: [],
    timeouts: [],
    setInterval(fn) { this.fns.push(fn); return this.fns.length; },
    clearInterval(id) { this.fns[id - 1] = null; },
    setTimeout(fn) { const slot = { fn, live: true }; this.timeouts.push(slot); return slot; },
    clearTimeout(slot) { slot.live = false; },
  };
  const hold = (queue) => new Promise((resolve, reject) => queue.push({ resolve, reject }));
  const api = (path, opts = {}) => {
    calls.push({ path, body: opts.body });
    if (path === '/runs/start') return hold(held.start);
    if (path.endsWith('/checkpoints') && held.checkpoints.length < holdCheckpoints) return hold(held.checkpoints);
    if (path.endsWith('/submit')) return Promise.resolve({ ok: true });
    return Promise.resolve({ ok: true });
  };
  const tracker = new RunTracker({ api, getToken: () => 'tok', now: () => t, intervalMs: 10_000, timers });
  return {
    tracker, calls, timers,
    advance: (ms) => { t += ms; },
    tick: async () => { for (const fn of timers.fns) if (fn) await fn(); },
    liveTimers: () => timers.fns.filter(Boolean).length,
    // The 4 s cap on start() waiting for the previous finish() passes.
    expireWait: () => { for (const slot of timers.timeouts) if (slot.live) { slot.live = false; slot.fn(); } },
    resolve: (kind, index, value) => held[kind][index].resolve(value),
    reject: (kind, index, err) => held[kind][index].reject(err),
  };
}

const failure = (status) => Object.assign(new Error(status === 0 ? 'network_error' : 'bad_checkpoint'), { status });

test('a start() answered after stop() installs nothing: no zombie run, no leaked timer', async () => {
  const h = manualHarness();
  const pending = h.tracker.start({ mode: 'TRIAL' });
  h.tracker.stop(); // scene shut down while the request was in flight
  h.resolve('start', 0, { runId: 'stale', ticket: 'tk', seed: 's' });
  assert.equal(await pending, null);
  assert.equal(h.liveTimers(), 0);
  assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 9000 }), { ticketed: false, reason: 'no_run' });
  assert.deepEqual(h.calls.map((c) => c.path), ['/runs/start']);
});

test('finish() before the start response arrives drops that response instead of reviving a run', async () => {
  const h = manualHarness();
  const pending = h.tracker.start({ mode: 'TRIAL' });
  assert.deepEqual(await h.tracker.finish({ score: 1, kills: 0, shards: 0, durationMs: 9000 }), { ticketed: false, reason: 'starting' });
  h.resolve('start', 0, { runId: 'late', ticket: 'tk', seed: 's' });
  assert.equal(await pending, null);
  assert.equal(h.liveTimers(), 0);
});

test('out-of-order start responses: the abandoned request cannot replace the newer run', async () => {
  const h = manualHarness();
  const first = h.tracker.start({ mode: 'TRIAL' });
  const second = h.tracker.start({ mode: 'STORY', chapter: 1 }); // supersedes the first
  h.resolve('start', 1, { runId: 'new', ticket: 'tk-new', seed: 's2' });
  assert.equal((await second).runId, 'new');
  h.resolve('start', 0, { runId: 'old', ticket: 'tk-old', seed: 's1' }); // late answer of the abandoned request
  assert.equal(await first, null);
  assert.equal(h.liveTimers(), 1);

  const res = await h.tracker.finish({ score: 0, kills: 4, shards: 0, durationMs: 30_000 });
  assert.equal(res.ticketed, true);
  const submit = h.calls.find((c) => c.path.endsWith('/submit'));
  assert.equal(submit.path, '/runs/new/submit');
  assert.equal(submit.body.ticket, 'tk-new');
  assert.equal(h.liveTimers(), 0);
});

test('an abandoned start that fails late does not wipe the newer run', async () => {
  const h = manualHarness();
  const first = h.tracker.start({ mode: 'TRIAL' });
  const second = h.tracker.start({ mode: 'TRIAL' });
  h.resolve('start', 1, { runId: 'new', ticket: 'tk-new', seed: 's' });
  await second;
  h.reject('start', 0, failure(0));
  assert.equal(await first, null);
  const res = await h.tracker.finish({ score: 0, kills: 1, shards: 0, durationMs: 9000 });
  assert.equal(res.ticketed, true);
});

test('a slow finish() of the old run cannot null the run that started meanwhile (the start waited for it, then gave up at the cap)', async () => {
  const h = manualHarness({ holdCheckpoints: 1 });
  const a = h.tracker.start({ mode: 'STORY', chapter: 1 });
  h.resolve('start', 0, { runId: 'A', ticket: 'tkA', seed: 'sA' });
  await a;

  const finishA = h.tracker.finish({ score: 0, kills: 5, shards: 0, durationMs: 60_000, bossCleared: true });
  await settle(); // finish(A) is now waiting on its closing checkpoint
  const b = h.tracker.start({ mode: 'STORY', chapter: 2 }); // next chapter begins while A is still settling
  await settle();
  assert.equal(h.calls.filter((c) => c.path === '/runs/start').length, 1, 'B waits for A to settle before it voids it');
  h.expireWait(); // A is stuck for longer than the cap: B goes ahead
  await settle();
  h.resolve('start', 1, { runId: 'B', ticket: 'tkB', seed: 'sB' });
  await b;
  h.resolve('checkpoints', 0, { ok: true }); // A's closing checkpoint finally returns

  const resA = await finishA;
  assert.equal(resA.ticketed, true);
  assert.equal(h.calls.find((c) => c.path === '/runs/A/submit').body.ticket, 'tkA');

  // run B is still live, so it is ticketed too
  const resB = await h.tracker.finish({ score: 0, kills: 3, shards: 0, durationMs: 20_000 });
  assert.equal(resB.ticketed, true);
  assert.equal(h.calls.find((c) => c.path === '/runs/B/submit').body.ticket, 'tkB');
  assert.equal(h.liveTimers(), 0);
});

test('an old finish() waiting on an in-flight checkpoint sends its closing checkpoint to its own run, never the new one', async () => {
  const h = manualHarness({ holdCheckpoints: 1 });
  const a = h.tracker.start({ mode: 'TRIAL' });
  h.resolve('start', 0, { runId: 'A', ticket: 'tkA', seed: 'sA' });
  await a;
  h.advance(10_000);
  h.timers.fns[0](); // A's interval fires; its periodic checkpoint is now in flight (held)
  await settle();

  const finishA = h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 12_000 });
  await settle(); // finish(A) waits for the in-flight checkpoint
  const b = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  h.expireWait(); // the wait for A's settlement ends at its cap
  await settle();
  h.resolve('start', 1, { runId: 'B', ticket: 'tkB', seed: 'sB' });
  await b;
  h.resolve('checkpoints', 0, { ok: true });
  await finishA;

  assert.equal(h.calls.filter((c) => c.path === '/runs/B/checkpoints').length, 0);
  assert.equal(h.calls.filter((c) => c.path === '/runs/A/checkpoints').length, 2, 'A got its periodic and its closing checkpoint');
  assert.equal(h.calls.filter((c) => c.path === '/runs/A/submit').length, 1);
  assert.equal(h.liveTimers(), 1); // B is alive and still has its timer
});

test('a failed checkpoint batch is not re-sent: the server flags repeated or non-increasing times', async () => {
  for (const status of [0, 422, 500]) {
    let fail = true;
    const posted = [];
    const timers = { fns: [], setInterval(fn) { this.fns.push(fn); return this.fns.length; }, clearInterval(id) { this.fns[id - 1] = null; } };
    let t = 1_000_000;
    const api = async (path, opts = {}) => {
      if (path === '/runs/start') return { runId: 'r1', ticket: 'tk', seed: 's' };
      if (path.endsWith('/checkpoints')) {
        posted.push(...opts.body.points);
        if (fail) throw failure(status);
        return { ok: true };
      }
      return { ok: true };
    };
    const tracker = new RunTracker({ api, getToken: () => 'tok', now: () => t, intervalMs: 10_000, timers });
    await tracker.start({ mode: 'STORY', chapter: 1 });

    t += 10_000;
    tracker.update({ score: 0, kills: 2, shards: 0 });
    for (const fn of timers.fns) if (fn) await fn(); // fails
    fail = false;
    t += 10_000;
    tracker.update({ score: 0, kills: 4, shards: 0 });
    for (const fn of timers.fns) if (fn) await fn(); // succeeds
    t += 5_000;
    await tracker.finish({ score: 0, kills: 5, shards: 0, durationMs: 25_000 });

    const times = posted.map((p) => p.t);
    assert.deepEqual(times, [10_000, 20_000, 25_000], `status ${status}: each sample is sent at most once`);
    assert.equal(new Set(times).size, times.length);
  }
});
