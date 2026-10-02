// The client's RunTracker against the REAL run rules: the server's own Express app and database (the hermetic harness of
// server/test), reached over HTTP through the client's real apiFetch. Nothing about the server is simulated here, so this
// is the check that the closing-batch retry really is harmless, that response-arrival timing really avoids cp_future, and
// that a run is no longer voided by its successor.
//   node test/client/integration/runs-vs-real-server.mjs        (needs server/node_modules; not part of `npm test`)
// RUNS_MODULE=<path> runs the same scenarios against another version of the tracker and only prints what it did.
import assert from 'node:assert/strict';
import { makeHarness } from '../../../server/test/helpers.js';
import { apiFetch } from '../../../src/gd/api.js';

const modulePath = process.env.RUNS_MODULE || '../../../src/gd/runs.js';
const { RunTracker } = await import(modulePath);
const observe = Boolean(process.env.RUNS_MODULE); // another version: report, do not assert
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (ok, message) => {
  if (observe) { log(`   ${ok ? '·' : '✗'} ${message}`); return; }
  if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log('   ✓', message);
};

const h = await makeHarness();
const rows = async () => (await h.db.query('SELECT run_id, mode, status, flags, boss_cleared, ranked_ok, duration_ms FROM runs ORDER BY started_at, run_id')).rows;
const rowOf = async (runId) => (await rows()).find((r) => r.run_id === runId);
const lastCheckpoint = async (runId) => (await h.db.query('SELECT t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq DESC LIMIT 1', [runId])).rows[0];

/** A tracker on the real server. `wrap(path, opts, real)` can delay, drop or alter a request. */
function trackerFor(player, { wrap, token = player.token, pause } = {}) {
  const timers = { fns: [], setInterval(fn) { this.fns.push(fn); return this.fns.length; }, clearInterval(id) { this.fns[id - 1] = null; } };
  // `pause(ms)` stands in for the wait the tracker sits out (it moves the server's clock instead of sleeping)
  if (pause) Object.assign(timers, { setTimeout(fn, ms) { pause(ms); queueMicrotask(fn); return 0; }, clearTimeout() {} });
  const real = (path, opts) => apiFetch(path, { ...opts, base: h.base });
  const api = wrap ? (path, opts) => wrap(path, opts, real) : real;
  const tracker = new RunTracker({ api, getToken: () => token, now: () => h.clock(), timers, intervalMs: 10_000 });
  tracker.tick = async () => { for (const fn of timers.fns) if (fn) await fn(); };
  return tracker;
}

/** Play `seconds` of a run in 10 s steps, counters growing evenly, with the periodic checkpoints in between. */
async function play(tracker, seconds, { score = 0, kills = 0, shards = 0 } = {}) {
  const steps = Math.floor(seconds / 10);
  for (let i = 1; i <= steps; i += 1) {
    h.clock.advance(10_000);
    tracker.update({ score: Math.floor((score * i) / steps), kills: Math.floor((kills * i) / steps), shards: Math.floor((shards * i) / steps) });
    await tracker.tick();
  }
  h.clock.advance(seconds - steps * 10 > 0 ? (seconds - steps * 10) * 1000 : 0);
}

try {
  log('▶ an honest, verified Daily Shard Trial of 55 s');
  {
    const p = await h.newPlayer({ verified: true });
    const t = trackerFor(p);
    const run = await t.start({ mode: 'TRIAL' });
    await play(t, 55, { score: 1_800, kills: 16, shards: 3 });
    const res = await t.finish({ score: 1_800, kills: 16, shards: 3, durationMs: 55_000 });
    const row = await rowOf(run.runId);
    check(res.ticketed && res.rankedOk === true && res.flags.length === 0, `ranked, unflagged (${JSON.stringify({ rankedOk: res.rankedOk, flags: res.flags })})`);
    check(res.coverage >= 1, `the server has seen the whole run (coverage ${res.coverage})`);
    check(row.status === 'submitted' && row.flags === '', `server row: ${row.status}, flags "${row.flags}"`);
    const credited = (await h.db.query('SELECT shards FROM shard_days WHERE subject = $1', [(await h.ctx.db.query('SELECT subject FROM runs WHERE run_id = $1', [run.runId])).rows[0].subject])).rows[0];
    check(credited?.shards === 3, `the 3 Shards were credited (${credited?.shards})`);
  }

  log('▶ L7: a cold start, the server handles /runs/start 6 s after the client sent it');
  {
    const p = await h.newPlayer({ verified: true });
    const t = trackerFor(p, {
      wrap: async (path, opts, real) => {
        if (path === '/runs/start') h.clock.advance(6_000); // the request sits in a queue; the server starts the run late
        return real(path, opts);
      },
    });
    const run = await t.start({ mode: 'TRIAL' });
    await play(t, 40, { score: 1_000, kills: 10, shards: 0 });
    const res = await t.finish({ score: 1_000, kills: 10, shards: 0, durationMs: 40_000 });
    const row = await rowOf(run.runId);
    check(row.flags === '', `no cp_future / duration flag (flags "${row.flags}")`);
    check(res.ticketed && !res.error && res.rankedOk === true, `ranked (${JSON.stringify({ rankedOk: res.rankedOk, error: res.error })})`);
  }

  // The reviewer's numbers: a 40 s boss fight, periodic checkpoints at 10, 20 and 30 s, the closing checkpoint at 40 s.
  // A boss clear needs the server to have seen 80% of the run, so without the closing checkpoint (30/40 = 75%) it is flagged.
  for (const [label, handledFirst] of [['never reached the server', false], ['was handled but its answer was lost', true]]) {
    log(`▶ M6: Story boss clear whose closing checkpoint ${label}`);
    const p = await h.newPlayer({ verified: true });
    let loseNext = false;
    const t = trackerFor(p, {
      wrap: async (path, opts, real) => {
        if (loseNext && /\/checkpoints$/.test(path)) {
          loseNext = false;
          if (handledFirst) await real(path, opts);
          throw Object.assign(new Error('timeout'), { status: 0 });
        }
        return real(path, opts);
      },
    });
    const run = await t.start({ mode: 'STORY', chapter: 1 });
    await play(t, 30, { kills: 9, shards: 2 });
    h.clock.advance(10_000); // the last ten seconds, with no periodic checkpoint before the end
    t.update({ score: 0, kills: 12, shards: 2 });
    loseNext = true;
    const res = await t.finish({ score: 0, kills: 12, shards: 2, durationMs: 40_000, bossCleared: true });
    const row = await rowOf(run.runId);
    const last = await lastCheckpoint(run.runId);
    check(row.flags === '', `not flagged (flags "${row.flags}")`);
    check(res.bossCleared === true && row.boss_cleared === true, `boss clear accepted (bossCleared ${res.bossCleared})`);
    check(res.checkpointFailed === undefined, 'and the retry counted as delivered');
    check(last.t_ms >= 40_000 * 0.8 && last.kills === 12, `closing checkpoint stored: t ${last.t_ms}, kills ${last.kills}`);
  }

  log('▶ M5: the submit was handled but its answer was lost; the retry meets the real 409');
  {
    const p = await h.newPlayer({ verified: true });
    let lose = true;
    const t = trackerFor(p, {
      wrap: async (path, opts, real) => {
        const out = await real(path, opts);
        if (lose && /\/submit$/.test(path)) { lose = false; throw Object.assign(new Error('timeout'), { status: 0 }); }
        return out;
      },
    });
    const run = await t.start({ mode: 'TRIAL' });
    await play(t, 30, { score: 500, kills: 5, shards: 0 });
    const res = await t.finish({ score: 500, kills: 5, shards: 0, durationMs: 30_000 });
    check(res.ticketed && res.alreadySubmitted === true && !res.error, `recorded, not offline (${JSON.stringify({ alreadySubmitted: res.alreadySubmitted, error: res.error, reason: res.reason })})`);
    check((await rowOf(run.runId)).status === 'submitted', 'server row is submitted');
  }

  log('▶ M4: the next life starts at once, while the submit of the one that just ended is still travelling');
  {
    const p = await h.newPlayer({ verified: true });
    const t = trackerFor(p, {
      wrap: async (path, opts, real) => {
        if (/\/submit$/.test(path)) await sleep(400); // a slow link: the submit reaches the server 400 ms late
        return real(path, opts);
      },
    });
    const a = await t.start({ mode: 'STORY', chapter: 1 });
    await play(t, 30, { kills: 6 });
    const finishing = t.finish({ score: 0, kills: 6, shards: 0, durationMs: 30_000, bossCleared: false });
    const b = await t.start({ mode: 'STORY', chapter: 1 }); // retry, straight away
    const res = await finishing;
    const rowA = await rowOf(a.runId);
    const rowB = await rowOf(b.runId);
    check(rowA.status === 'submitted' && res.ticketed && !res.error, `the first life was recorded (server: ${rowA.status}${res.error ? `, client: ${res.error}` : ''})`);
    check(rowB.status === 'open', `and the second life is the open one (${rowB.status})`);
    await t.finish({ score: 0, kills: 1, shards: 0, durationMs: 5_000 });
  }

  log('▶ M6: a run that another start voided reports why');
  {
    const p = await h.newPlayer({ verified: true });
    const t = trackerFor(p);
    await t.start({ mode: 'TRIAL' });
    await play(t, 30, { score: 500, kills: 5 });
    await h.api.post('/runs/start', { mode: 'TRIAL' }, { token: p.token }); // another tab starts a run: the server voids this one
    const res = await t.finish({ score: 500, kills: 5, shards: 0, durationMs: 30_000 });
    check(res.ticketed && res.error === 'run_void' && res.reason === 'superseded', `${JSON.stringify({ error: res.error, reason: res.reason })}`);
  }

  log('▶ M6: a session the server no longer accepts');
  {
    const p = await h.newPlayer({ verified: true });
    const seen = [];
    const t = trackerFor(p, { token: 'not-a-valid-session' });
    t.setAuthLostHandler?.((info) => seen.push(info));
    const run = await t.start({ mode: 'TRIAL' });
    const res = await t.finish({ score: 1, kills: 0, shards: 0, durationMs: 9_000 });
    check(run === null && res.reason === 'signed_out', `the real 401 is read as signed out (${JSON.stringify(res)})`);
    check(seen.length === 1 && seen[0].status === 401, `and reported once (${JSON.stringify(seen)})`);
  }

  log('▶ a restart inside the server\'s pace: the refusal names the wait, and the run is ticketed when it is over');
  {
    const p = await h.newPlayer({ verified: true });
    await trackerFor(p).start({ mode: 'TRIAL' }); // accepted: the pace for this player's Trial starts now
    h.clock.advance(4_000);
    const waits = [];
    const t = trackerFor(p, { pause: (ms) => { waits.push(ms); h.clock.advance(ms); } });
    const run = await t.start({ mode: 'TRIAL' });
    check(waits.length === 1 && waits[0] === 6_000, `it waited the 6 s the real server named (${JSON.stringify(waits)})`);
    check(Boolean(run?.runId), 'and then got its ticket');
    await play(t, 40, { score: 900, kills: 9, shards: 0 });
    const res = await t.finish({ score: 900, kills: 9, shards: 0, durationMs: 40_000 });
    check(res.ticketed && res.rankedOk === true && res.flags.length === 0, `the run is ranked, unflagged (${JSON.stringify({ rankedOk: res.rankedOk, flags: res.flags })})`);
  }

  if (!observe) {
    assert.deepEqual(failures, [], `${failures.length} check(s) failed`);
    log('\n✅ the tracker and the real server agree');
  }
} catch (err) {
  console.error('\n❌ failed:', err.message, failures.length ? `\n - ${failures.join('\n - ')}` : '');
  process.exitCode = 1;
} finally {
  await h.close();
}
