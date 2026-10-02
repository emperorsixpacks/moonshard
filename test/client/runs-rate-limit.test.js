import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../../src/gd/runs.js';

/*
 * The server limits requests per IP address (429 rate_limited, and in the body how long until the window ends). Players behind
 * one public address (a mobile carrier, a school) share that budget, so an honest player can be refused at the worst moment:
 * when their finished run is being sent. A finished run is worth holding on to: the tracker waits the time the server named
 * and sends it again, once, and keeps doing so even if the player has left the scene meanwhile.
 */

const settle = () => new Promise((resolve) => setImmediate(resolve));
const rateLimited = (retryAfterMs) => Object.assign(new Error('rate_limited'), {
  status: 429, body: { error: 'rate_limited', ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
});
const RUN = { runId: 'r1', ticket: 'tk', seed: 's' };
const RANKED = { ok: true, isNewBest: true, rankedOk: true, bossCleared: false, flags: [], rank: { open: 1, ranked: 1 } };

/** `script[kind]` lists what each successive request of that kind gets (an Error is thrown); once it runs out, requests succeed. */
function harness(script = {}) {
  let t = 1_000_000;
  const calls = [];
  const timers = {
    fns: [],
    timeouts: [],
    setInterval(fn) { this.fns.push(fn); return this.fns.length; },
    clearInterval(id) { this.fns[id - 1] = null; },
    setTimeout(fn, ms) { const slot = { fn, ms, live: true }; this.timeouts.push(slot); return slot; },
    clearTimeout(slot) { slot.live = false; },
  };
  const queues = { start: [...(script.start || [])], checkpoints: [...(script.checkpoints || [])], submit: [...(script.submit || [])] };
  const api = async (path, opts = {}) => {
    calls.push(path);
    const kind = path === '/runs/start' ? 'start' : path.endsWith('/checkpoints') ? 'checkpoints' : 'submit';
    const next = queues[kind].shift();
    if (next instanceof Error) throw next;
    if (next !== undefined) return next;
    return kind === 'start' ? RUN : kind === 'submit' ? RANKED : { ok: true };
  };
  const tracker = new RunTracker({ api, getToken: () => 'tok', now: () => t, intervalMs: 10_000, timers });
  return {
    tracker,
    advance: (ms) => { t += ms; },
    callsTo: (re) => calls.filter((c) => re.test(c)).length,
    waits: () => timers.timeouts.filter((slot) => slot.live),
    pass: () => { const slot = timers.timeouts.find((s) => s.live); slot.live = false; slot.fn(); },
  };
}

const finish = (h) => h.tracker.finish({ score: 100, kills: 5, shards: 1, durationMs: 40_000 });
async function startAndPlay(h) {
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(40_000);
}

test('a closing checkpoint the limiter refused is sent again once the time it named has passed', async () => {
  const h = harness({ checkpoints: [rateLimited(5_000)] });
  await startAndPlay(h);
  const done = finish(h);
  await settle();
  assert.deepEqual(h.waits().map((w) => w.ms), [5_000], 'it waits exactly what the server said');
  assert.equal(h.callsTo(/submit/), 0, 'and does not submit a run the server has not seen the end of');
  h.pass();
  const result = await done;
  assert.equal(result.ticketed, true);
  assert.equal(result.rankedOk, true);
  assert.equal(result.checkpointFailed, undefined, 'the server did get the closing checkpoint');
  assert.equal(h.callsTo(/checkpoints/), 2, 'the same batch, once more');
});

test('a submit the limiter refused is sent again once the time it named has passed, and the run is recorded', async () => {
  const h = harness({ submit: [rateLimited(8_000)] });
  await startAndPlay(h);
  const done = finish(h);
  await settle();
  assert.deepEqual(h.waits().map((w) => w.ms), [8_000]);
  h.pass();
  const result = await done;
  assert.deepEqual({ ticketed: result.ticketed, rankedOk: result.rankedOk, error: result.error }, { ticketed: true, rankedOk: true, error: undefined });
  assert.equal(h.callsTo(/submit/), 2);
});

test('both the closing checkpoint and the submit can be refused, and both are waited out', async () => {
  const h = harness({ checkpoints: [rateLimited(3_000)], submit: [rateLimited(4_000)] });
  await startAndPlay(h);
  const done = finish(h);
  await settle();
  h.pass();
  await settle();
  assert.deepEqual(h.waits().map((w) => w.ms), [4_000], 'the second wait is the submit\'s');
  h.pass();
  assert.equal((await done).rankedOk, true);
});

test('leaving the scene does not abandon a finished run that is waiting to be sent', async () => {
  const h = harness({ submit: [rateLimited(6_000)] });
  await startAndPlay(h);
  const done = finish(h);
  await settle();
  h.tracker.stop(); // the player went back to the menu
  assert.equal(h.waits().length, 1, 'the wait is not cancelled with the scene');
  h.pass();
  assert.equal((await done).rankedOk, true);
  assert.equal(h.callsTo(/submit/), 2);
});

test('refused again after the wait, the run is reported as not recorded because the server is busy; no third attempt', async () => {
  const h = harness({ submit: [rateLimited(2_000), rateLimited(2_000), RANKED] });
  await startAndPlay(h);
  const done = finish(h);
  await settle();
  h.pass();
  const result = await done;
  assert.deepEqual({ error: result.error, reason: result.reason, status: result.status }, { error: 'rate_limited', reason: 'rate_limited', status: 429 });
  assert.equal(h.callsTo(/submit/), 2);
  assert.equal(h.waits().length, 0);
});

test('a refusal that names no wait, or one longer than a whole window, is not retried', async () => {
  for (const wait of [undefined, 'soon', -1, Number.NaN, 120_000]) {
    const h = harness({ checkpoints: [rateLimited(wait)], submit: [rateLimited(wait)] });
    await startAndPlay(h);
    const result = await finish(h);
    assert.equal(h.waits().length, 0, String(wait));
    assert.equal(h.callsTo(/checkpoints/), 1, `checkpoint, wait ${wait}`);
    assert.equal(h.callsTo(/submit/), 1, `submit, wait ${wait}`);
    assert.deepEqual({ reason: result.reason, checkpointFailed: result.checkpointFailed }, { reason: 'rate_limited', checkpointFailed: true }, String(wait));
  }
});

test('the server\'s pace refusal (slow_down) is a start-only matter: it is never waited out on a checkpoint or a submit', async () => {
  const slowDown = Object.assign(new Error('slow_down'), { status: 429, body: { error: 'slow_down', retryAfterMs: 3_000 } });
  const h = harness({ submit: [slowDown] });
  await startAndPlay(h);
  const result = await finish(h);
  assert.equal(h.waits().length, 0);
  assert.equal(h.callsTo(/submit/), 1);
  assert.equal(result.reason, 'rate_limited');
});

test('network trouble is still retried at once, with no wait', async () => {
  const offline = Object.assign(new Error('network_error'), { status: 0 });
  const h = harness({ checkpoints: [offline], submit: [offline] });
  await startAndPlay(h);
  const result = await finish(h);
  assert.equal(h.waits().length, 0);
  assert.equal(result.rankedOk, true);
  assert.equal(h.callsTo(/checkpoints/), 2);
  assert.equal(h.callsTo(/submit/), 2);
});

test('a ticket refused by the per-IP limiter is asked for again after the wait, like the pace refusal', async () => {
  const h = harness({ start: [rateLimited(4_000)] });
  const pending = h.tracker.start({ mode: 'TRIAL' });
  await settle();
  assert.deepEqual(h.waits().map((w) => w.ms), [4_000]);
  h.pass();
  assert.deepEqual(await pending, RUN);
  assert.equal(h.callsTo(/start/), 2);
});

test('...but not for longer than a start is worth waiting', async () => {
  const h = harness({ start: [rateLimited(40_000), RUN] });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  assert.equal(h.waits().length, 0);
  assert.equal(h.callsTo(/start/), 1);
});
