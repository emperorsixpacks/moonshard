import { RunTracker } from '../../../src/gd/runs.js';

/**
 * Hand-driven environment for RunTracker tests: a manual clock, interval and timeout timers that only fire when
 * a test says so, and an API whose calls can be answered immediately, held until the test releases them, or
 * failed on demand. Every call is recorded in `calls` in the order it was made.
 */

export const settle = () => new Promise((resolve) => setImmediate(resolve));

export const apiError = (status, code) => Object.assign(new Error(code || (status === 0 ? 'network_error' : 'api_error')), { status });

export function makeHarness({ token = 'tok', intervalMs = 10_000, settleWaitMs, tracker: trackerOptions = {} } = {}) {
  let t = 1_000_000;
  const calls = [];
  const rules = []; // { match(path, call), left, handler(call) } consulted before the default answers
  const held = []; // calls whose answer the test controls: { call, resolve, reject }

  const timers = {
    fns: [],
    timeouts: [],
    setInterval(fn) { this.fns.push(fn); return this.fns.length; },
    clearInterval(id) { this.fns[id - 1] = null; },
    setTimeout(fn, ms) { const slot = { fn, ms, live: true }; this.timeouts.push(slot); return slot; },
    clearTimeout(slot) { if (slot) slot.live = false; },
  };

  const defaults = (path) => {
    if (path === '/runs/start') return { runId: `r${calls.filter((c) => c.path === '/runs/start').length}`, ticket: 'tk', seed: 's' };
    if (path.endsWith('/submit')) return { ok: true, rankedOk: true, bossCleared: false, flags: [], rank: { open: 1, ranked: 1 } };
    return { ok: true, accepted: 1, duplicates: 0 };
  };

  const api = (path, opts = {}) => {
    const call = { path, body: opts.body, token: opts.token, method: opts.method, at: t, index: calls.length };
    calls.push(call);
    const rule = rules.find((r) => r.left > 0 && r.match(path, call));
    if (rule) {
      rule.left -= 1;
      return Promise.resolve().then(() => rule.handler(call));
    }
    return Promise.resolve(defaults(path, call));
  };

  const tracker = new RunTracker({
    api, getToken: () => token, now: () => t, intervalMs, timers,
    ...(settleWaitMs === undefined ? {} : { settleWaitMs }),
    ...trackerOptions,
  });

  const matcher = (m) => (typeof m === 'function' ? m : (path) => (m instanceof RegExp ? m.test(path) : path === m || path.endsWith(m)));

  return {
    tracker, calls, timers,
    advance: (ms) => { t += ms; },
    now: () => t,
    tick: async () => { for (const fn of timers.fns) if (fn) await fn(); },
    liveIntervals: () => timers.fns.filter(Boolean).length,
    pathsOf: (re) => calls.filter((c) => re.test(c.path)),
    /** Answer the next `times` calls matching `match` with `handler(call)` (return a value or throw / reject). */
    on(match, handler, times = 1) { rules.push({ match: matcher(match), left: times, handler }); },
    /** Fail the next `times` calls matching `match` with an API error of the given status. */
    failNext(match, status, code, times = 1) { this.on(match, () => { throw apiError(status, code); }, times); },
    /** Hold the next `times` calls matching `match`; the test releases them with `release(i, value)` / `fail(i, err)`. */
    hold(match, times = 1) {
      for (let i = 0; i < times; i += 1) {
        rules.push({
          match: matcher(match),
          left: 1,
          handler: (call) => new Promise((resolve, reject) => { held.push({ call, resolve, reject }); }),
        });
      }
    },
    held,
    release: (i, value) => held[i].resolve(value ?? defaults(held[i].call.path, held[i].call)),
    fail: (i, err) => held[i].reject(err),
    /** Fire every live setTimeout (the settle-wait cap), as if its delay had passed. */
    expireTimeouts() { for (const slot of timers.timeouts) if (slot.live) { slot.live = false; slot.fn(); } },
  };
}
