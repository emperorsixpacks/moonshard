import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../../src/gd/runs.js';

/*
 * The server paces /runs/start per player and mode (429 slow_down, and how long to wait). A restart can land inside that
 * wait, and a run without a ticket is not ranked, so the tracker waits the pace out once, in the background (the scenes do
 * not await start()), and starts the run then. Anything it cannot trust, it does not retry.
 */

const settle = () => new Promise((resolve) => setImmediate(resolve));

const slowDown = (retryAfterMs) => Object.assign(new Error('slow_down'), { status: 429, body: { error: 'slow_down', ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } });

function harness({ starts }) {
  const calls = [];
  const timers = {
    fns: [],
    timeouts: [],
    setInterval(fn) { this.fns.push(fn); return this.fns.length; },
    clearInterval(id) { this.fns[id - 1] = null; },
    setTimeout(fn, ms) { const slot = { fn, ms, live: true }; this.timeouts.push(slot); return slot; },
    clearTimeout(slot) { slot.live = false; },
  };
  const queue = [...starts];
  const api = async (path, opts = {}) => {
    calls.push({ path, body: opts.body });
    if (path === '/runs/start') {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }
    return { ok: true };
  };
  const tracker = new RunTracker({ api, getToken: () => 'tok', now: () => 1_000_000, intervalMs: 10_000, timers });
  const startCalls = () => calls.filter((c) => c.path === '/runs/start').length;
  /** The waits the tracker asked for that have not yet passed. */
  const waits = () => timers.timeouts.filter((slot) => slot.live);
  /** Let the oldest live wait pass. */
  const pass = () => { const slot = waits()[0]; slot.live = false; slot.fn(); };
  return { tracker, calls, timers, startCalls, waits, pass };
}

const RUN = { runId: 'r1', ticket: 'tk', seed: 's' };

test('a start refused with a wait is made again once that wait has passed, and the run is then ticketed', async () => {
  const h = harness({ starts: [slowDown(4_000), RUN] });
  const pending = h.tracker.start({ mode: 'STORY', chapter: 1 });
  await settle();
  assert.equal(h.startCalls(), 1, 'one request so far');
  assert.deepEqual(h.waits().map((w) => w.ms), [4_000], 'it waits exactly what the server said');

  h.pass();
  assert.deepEqual(await pending, RUN);
  assert.equal(h.startCalls(), 2);
  assert.deepEqual(h.calls.filter((c) => c.path === '/runs/start').map((c) => c.body), [{ mode: 'STORY', chapter: 1 }, { mode: 'STORY', chapter: 1 }], 'the same request');
  const done = await h.tracker.finish({ score: 5, kills: 1, shards: 0, durationMs: 9_000 });
  assert.equal(done.ticketed, true);
});

test('while it waits the run is simply "starting": ending the run then settles nothing, sends nothing and leaves no timer behind', async () => {
  const h = harness({ starts: [slowDown(4_000), RUN] });
  const pending = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 9_000 }), { ticketed: false, reason: 'starting' });
  assert.equal(await pending, null, 'the start that was waiting gives up at once');
  assert.equal(h.startCalls(), 1, 'the run that already ended is not started after the fact');
  assert.equal(h.waits().length, 0, 'and the wait was cancelled, not left to run out');
});

test('leaving the scene during the wait drops the second request and the wait', async () => {
  const h = harness({ starts: [slowDown(4_000), RUN] });
  const pending = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  h.tracker.stop();
  assert.equal(await pending, null);
  assert.equal(h.startCalls(), 1);
  assert.equal(h.waits().length, 0, 'no timer is left running');
  assert.equal(h.timers.fns.filter(Boolean).length, 0, 'no run, so no checkpoint timer');
});

test('a newer start during the wait wins: the old one never makes its second request', async () => {
  const h = harness({ starts: [slowDown(4_000), RUN, { runId: 'r2', ticket: 'tk2', seed: 's' }] });
  const first = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  const second = h.tracker.start({ mode: 'TRIAL' }); // the player restarted again
  assert.deepEqual(await second, RUN);
  assert.equal(await first, null, 'the first start has been superseded');
  assert.equal(h.startCalls(), 2, 'one request each, not three');
  assert.equal(h.waits().length, 0);
});

test('refused again after the wait, the run is unticketed and the reason is the pace', async () => {
  const h = harness({ starts: [slowDown(4_000), slowDown(2_000)] });
  const pending = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  h.pass();
  assert.equal(await pending, null);
  assert.equal(h.startCalls(), 2, 'it asks twice, never more');
  assert.equal(h.waits().length, 0);
  assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 9_000 }), { ticketed: false, reason: 'rate_limited' });
});

test('a refusal that names no wait, or an absurd one, is not retried', async () => {
  for (const retryAfterMs of [undefined, 'soon', -5, Number.NaN, 60_000]) {
    const h = harness({ starts: [slowDown(retryAfterMs), RUN] });
    assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null, String(retryAfterMs));
    assert.equal(h.startCalls(), 1, String(retryAfterMs));
    assert.equal(h.waits().length, 0, String(retryAfterMs));
    assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 9_000 }), { ticketed: false, reason: 'rate_limited' }, String(retryAfterMs));
  }
});

test('only the pace refusal is waited out: a general rate limit, an outage and a bad request are not', async () => {
  const cases = [
    [Object.assign(new Error('rate_limited'), { status: 429, body: { error: 'rate_limited', retryAfterMs: 3_000 } }), 'rate_limited'],
    [Object.assign(new Error('internal_error'), { status: 500, body: { retryAfterMs: 3_000 } }), 'server_error'],
    [Object.assign(new Error('bad_mode'), { status: 400, body: { retryAfterMs: 3_000 } }), 'rejected'],
    [Object.assign(new Error('network_error'), { status: 0 }), 'offline'],
  ];
  for (const [err, reason] of cases) {
    const h = harness({ starts: [err, RUN] });
    assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null, err.message);
    assert.equal(h.startCalls(), 1, err.message);
    assert.deepEqual(await h.tracker.finish({ score: 1, kills: 1, shards: 0, durationMs: 9_000 }), { ticketed: false, reason }, err.message);
  }
});

test('the wait is as long as the server said, up to a cap, and a short one is honoured exactly', async () => {
  for (const ms of [1, 3_000, 10_000, 15_000]) {
    const h = harness({ starts: [slowDown(ms), RUN] });
    const pending = h.tracker.start({ mode: 'TRIAL' });
    await settle();
    assert.deepEqual(h.waits().map((w) => w.ms), [ms]);
    h.pass();
    assert.deepEqual(await pending, RUN, `${ms} ms`);
  }
});
