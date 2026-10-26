import test from 'node:test';
import assert from 'node:assert/strict';
import { RunTracker } from '../../src/gd/runs.js';

function harness({ token = 'tok', failStart = false, failCheckpoint = false, submitReply = {} } = {}) {
  let t = 1_000_000;
  const calls = [];
  const timers = { fns: [], setInterval(fn) { this.fns.push(fn); return this.fns.length; }, clearInterval(id) { this.fns[id - 1] = null; } };
  const api = async (path, opts = {}) => {
    calls.push({ path, body: opts.body });
    if (path === '/runs/start') {
      if (failStart) throw Object.assign(new Error('network_error'), { status: 0 });
      return { runId: 'r1', ticket: 'tk', seed: '2026-10-05' };
    }
    if (path.endsWith('/checkpoints') && failCheckpoint) throw Object.assign(new Error('network_error'), { status: 0 });
    if (path.endsWith('/submit')) return { ok: true, rankedOk: true, rank: { open: 1, ranked: 1 }, ...submitReply };
    return { ok: true };
  };
  const tracker = new RunTracker({ api, getToken: () => token, now: () => t, intervalMs: 10_000, timers });
  return { tracker, calls, timers, advance: (ms) => { t += ms; }, tick: async () => { for (const fn of timers.fns) if (fn) await fn(); } };
}

test('anonymous players get no ticket and every call is a safe no-op', async () => {
  const h = harness({ token: null });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  h.tracker.update({ score: 5 });
  assert.deepEqual(await h.tracker.finish({ score: 5, kills: 1, shards: 0, durationMs: 9000 }), { ticketed: false, reason: 'not_connected' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});

test('server unreachable at start: unticketed offline run, no throw, no timer', async () => {
  const h = harness({ failStart: true });
  assert.equal(await h.tracker.start({ mode: 'TRIAL' }), null);
  h.tracker.update({ score: 5 });
  assert.deepEqual(await h.tracker.finish({ score: 5, kills: 1, shards: 0, durationMs: 9000 }), { ticketed: false, reason: 'offline' });
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});

test('ticketed run: checkpoints carry elapsed time + latest counters, finish submits with the ticket', async () => {
  const h = harness();
  const run = await h.tracker.start({ mode: 'STORY', chapter: 2 });
  assert.equal(run.runId, 'r1');
  assert.deepEqual(h.calls[0].body, { mode: 'STORY', chapter: 2 });

  h.advance(10_000);
  h.tracker.update({ score: 120, kills: 4, shards: 1 });
  await h.tick();
  const cp = h.calls.find((c) => c.path === '/runs/r1/checkpoints');
  assert.deepEqual(cp.body.points, [{ t: 10_000, score: 120, kills: 4, shards: 1 }]);

  h.advance(7_000);
  const res = await h.tracker.finish({ score: 200, kills: 6, shards: 2, durationMs: 17_000, bossCleared: true });
  assert.equal(res.ticketed, true);
  assert.equal(res.rankedOk, true);
  const final = h.calls.filter((c) => c.path === '/runs/r1/checkpoints').pop();
  assert.equal(final.body.points.at(-1).t, 17_000); // closing checkpoint so coverage ~100%
  assert.equal(final.body.points.at(-1).score, 200);
  const submit = h.calls.find((c) => c.path === '/runs/r1/submit');
  assert.deepEqual(submit.body, { ticket: 'tk', score: 200, kills: 6, shards: 2, durationMs: 17_000, bossCleared: true });
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});

test('an Endless run sends the level it ended on with its submit, and the answer says the best level', async () => {
  const h = harness({ submitReply: { level: 9, bestLevel: 12 } });
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(40_000);
  const res = await h.tracker.finish({ score: 900, kills: 120, shards: 4, durationMs: 40_000, level: 9 });
  const submit = h.calls.find((c) => c.path === '/runs/r1/submit');
  assert.deepEqual(submit.body, { ticket: 'tk', score: 900, kills: 120, shards: 4, durationMs: 40_000, bossCleared: false, level: 9 });
  assert.deepEqual([res.level, res.bestLevel], [9, 12], 'what the server answered reaches the end screen and the Forge');
});

test('a level that is not a whole number from 1 is not sent: the run is submitted as it always was', async () => {
  for (const level of [undefined, null, 0, -2, NaN, Infinity, '7', {}]) {
    const h = harness();
    await h.tracker.start({ mode: 'TRIAL' });
    h.advance(20_000);
    await h.tracker.finish({ score: 50, kills: 3, shards: 0, durationMs: 20_000, level });
    const submit = h.calls.find((c) => c.path === '/runs/r1/submit');
    assert.ok(!('level' in submit.body), `level ${String(level)} is left out`);
    assert.deepEqual(Object.keys(submit.body).sort(), ['bossCleared', 'durationMs', 'kills', 'score', 'shards', 'ticket']);
  }
  const h = harness();
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(20_000);
  await h.tracker.finish({ score: 50, kills: 3, shards: 0, durationMs: 20_000, level: 7.9 });
  assert.equal(h.calls.find((c) => c.path === '/runs/r1/submit').body.level, 7, 'a fraction is cut down, like the other counts');
});

test('failed checkpoint posts are retried, and finish still submits', async () => {
  const h = harness({ failCheckpoint: true });
  await h.tracker.start({ mode: 'TRIAL' });
  h.advance(10_000);
  await h.tick();
  h.advance(10_000);
  const res = await h.tracker.finish({ score: 10, kills: 1, shards: 0, durationMs: 20_000 });
  assert.equal(res.ticketed, true);
  assert.ok(h.calls.some((c) => c.path === '/runs/r1/submit'));
});

test('starting a new run stops the previous timer', async () => {
  const h = harness();
  await h.tracker.start({ mode: 'TRIAL' });
  await h.tracker.start({ mode: 'TRIAL' });
  assert.equal(h.timers.fns.filter(Boolean).length, 1);
  h.tracker.stop();
  assert.equal(h.timers.fns.filter(Boolean).length, 0);
});
