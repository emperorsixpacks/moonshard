import { apiFetch } from './api.js';
import { getToken } from './session.js';

/** The server takes at most this many checkpoint points per request. */
const POINTS_PER_POST = 50;

/** Monotonic where the platform has it: Date.now() can step backwards (NTP, manual change) and would make `t` negative. */
const monotonicNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** A whole, non-negative count, or 0 for anything else. */
const toCount = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * Why a run was not recorded, as a stable code (the scenes turn it into text with `failureText`):
 *   offline       network error or timeout          server_error  HTTP 5xx
 *   signed_out    HTTP 401 (session gone)           rate_limited  HTTP 429
 *   superseded    409 run_void: a newer run began   expired       410: the ticket is older than the server allows
 *   rejected      any other refusal by the server   not_connected no session token when the run began
 *   starting      the run ended before /runs/start answered
 *   no_run        finish() with no run to settle
 */
export function reasonFor(err) {
  const status = Number.isInteger(err?.status) ? err.status : 0;
  const code = err?.message;
  if (status === 0) return 'offline';
  if (status === 401) return code === 'bad_ticket' ? 'rejected' : 'signed_out';
  if (status === 429) return 'rate_limited';
  if (status === 409) return code === 'run_void' ? 'superseded' : 'rejected';
  if (status === 410) return 'expired';
  if (status >= 500) return 'server_error';
  return 'rejected';
}

/** Network trouble or a server hiccup: the request may not have been handled, so asking again is safe and useful. */
const isTransient = (err) => !Number.isInteger(err?.status) || err.status === 0 || err.status >= 500;

/**
 * Tracks one server-ticketed run. Anonymous / offline runs are simply unticketed: every method is
 * a safe no-op, so gameplay never depends on the API being reachable.
 *
 * Settling a run is a single, repeatable operation: `finish()` posts the closing checkpoint and the submit once
 * per run, however often it is called, and `start()` of the next run of the same mode waits (bounded) for that
 * settlement, because the server voids a player's previous open run of a mode the moment a new one starts.
 *
 * Time is measured from the moment the /runs/start response arrived: the server's own clock for the run begins
 * when it handles the request, which is never later than that, so `t <= elapsed` holds however slow the start was.
 */
export class RunTracker {
  constructor({
    api = apiFetch,
    getToken: tokenFn = getToken,
    now = monotonicNow,
    intervalMs = 10_000,
    settleWaitMs = 4_000,
    timers = {
      setInterval: (...a) => setInterval(...a),
      clearInterval: (...a) => clearInterval(...a),
      setTimeout: (...a) => setTimeout(...a),
      clearTimeout: (...a) => clearTimeout(...a),
    },
  } = {}) {
    this.api = api;
    this.getToken = tokenFn;
    this.now = now;
    this.intervalMs = intervalMs;
    this.settleWaitMs = settleWaitMs;
    this.timers = timers;
    this.run = null;
    this.timer = null;
    this.counters = { score: 0, kills: 0, shards: 0 };
    // Bumped by stop(). Scenes call start() without awaiting it, so its response can arrive after the
    // scene shut down or a newer start(); such a stale response must not install a run or a timer.
    this.epoch = 0;
    // Set by finish() and cleared by start(): after the closing totals are chosen, update() changes nothing.
    this.closed = false;
    // The settlement of the current run, so a second finish() gets the same answer instead of a second submit.
    this.finishing = null;
    // The latest settlement and its mode, which the next start() of that mode waits for. Survives stop().
    this.settling = null;
    // Why there is no live run (see reasonFor), for finish() to report.
    this.noRunReason = null;
    // The most recent failed request: { where: 'start' | 'checkpoint' | 'submit', status, code, at }.
    this.lastError = null;
    this.authLostHandler = null;
    this.authLostSent = false;
  }

  /**
   * `fn({ status, code, where })` is called when the server answers 401 (once per run), so the session layer can
   * drop a session the server no longer accepts. A 401 `bad_ticket` is about the run, not the session, and is not reported.
   */
  setAuthLostHandler(fn) {
    this.authLostHandler = typeof fn === 'function' ? fn : null;
  }

  async start({ mode, chapter }) {
    this.stop();
    const epoch = this.epoch;
    this.finishing = null;
    this.closed = false;
    this.authLostSent = false;
    this.lastError = null;
    this.counters = { score: 0, kills: 0, shards: 0 };
    this.noRunReason = 'starting';
    const token = this.getToken();
    if (!token) {
      this.noRunReason = 'not_connected';
      return null;
    }
    // The server voids this player's previous open run of this mode as soon as it handles /runs/start. If that run
    // is still being submitted, let the submit land first (bounded: a stuck API must not hold the next run back).
    const previous = this.settling && this.settling.mode === mode ? this.settling.promise : null;
    if (previous) {
      await this._waitFor(previous, this.settleWaitMs);
      if (epoch !== this.epoch) return null; // stopped, finished or superseded while waiting
    }
    try {
      const res = await this.api('/runs/start', { method: 'POST', token, body: { mode, ...(chapter ? { chapter } : {}) } });
      if (epoch !== this.epoch) return null; // stopped or superseded while the request was in flight
      if (!res?.runId || !res?.ticket) {
        this.noRunReason = 'rejected';
        return null;
      }
      this.run = { ...res, mode, token, startedLocal: this.now(), pending: [], inflight: null, lastT: 0, ackedT: 0 };
      this.noRunReason = null;
      this.timer = this.timers.setInterval(() => this.flush(), this.intervalMs);
      return res;
    } catch (err) {
      // A stale failure must not touch a newer run: this.run is already null (stop() ran first) and the state below is the new start's.
      if (epoch === this.epoch) {
        this.noRunReason = reasonFor(err);
        this._noteError('start', err);
      }
      return null;
    }
  }

  /** Latest cumulative counters. Counters never go down (the server flags a regression) and are frozen once finish() begins. */
  update(patch) {
    if (!patch || this.closed) return;
    for (const key of ['score', 'kills', 'shards']) {
      if (key in patch) this.counters[key] = Math.max(this.counters[key], toCount(patch[key]));
    }
  }

  /** Queue a checkpoint of the current counters. `t` is whole milliseconds, strictly above every earlier `t` of the run. */
  sample(run = this.run) {
    if (!run) return;
    run.pending.push({ t: this._stamp(run), ...this.counters });
  }

  async flush() {
    const run = this.run;
    if (!run || this.closed) return;
    if (run.inflight) return run.inflight;
    this.sample(run);
    const points = run.pending.splice(0, POINTS_PER_POST);
    if (!points.length) return;
    // A failed periodic batch is not re-queued: the next sample carries the cumulative counters, and the closing
    // checkpoint (which is retried) restores coverage, so nothing is lost by moving on.
    run.inflight = this._post(run, points).then((res) => {
      run.inflight = null;
      return res;
    });
    return run.inflight;
  }

  /**
   * Settle the run: closing checkpoint, then submit. Safe to call any number of times and from any code path
   * (victory, death, a stray hazard after the boss fell): the first call decides the outcome and every call
   * returns that one settlement. Resolves, never rejects:
   *   { ticketed: false, reason }                      nothing to settle (see reasonFor)
   *   { ticketed: true, ...serverResponse }            recorded; `coverage` is the share of the run the server has seen
   *   { ticketed: true, alreadySubmitted: true }       the server already holds this run (a retry whose first answer was lost)
   *   { ticketed: true, error, status, reason }        the submit failed
   * plus `checkpointFailed: true` when the closing checkpoint could not be delivered.
   */
  finish({ score, kills, shards, durationMs, bossCleared = false } = {}) {
    if (this.finishing) return this.finishing;
    const run = this.run;
    if (!run) {
      const reason = this.noRunReason || 'no_run';
      this.stop(); // also drops a start() still in flight, so it cannot revive a run after the fact
      return Promise.resolve({ ticketed: false, reason });
    }
    this.closed = true;
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;

    // The closing point and the submit carry these totals and nothing else; the scene's update() can no longer change them.
    const totals = {
      score: Math.max(toCount(score), this.counters.score),
      kills: Math.max(toCount(kills), this.counters.kills),
      shards: Math.max(toCount(shards), this.counters.shards),
    };
    const finishedAt = this.now();
    const sinceStart = Math.max(1, Math.round(finishedAt - run.startedLocal));
    // A scene clock can have started before the start response; the server only knows the time since it handled the start.
    const claimed = Number.isFinite(durationMs) && durationMs >= 1 ? Math.round(durationMs) : sinceStart;
    const closing = { t: this._stamp(run, finishedAt), ...totals };

    const settlement = this._settle(run, { totals, closing, durationMs: Math.min(claimed, sinceStart), bossCleared })
      .catch((err) => ({ ticketed: true, error: err?.message || 'submit_failed', status: err?.status, reason: reasonFor(err) }));
    this.finishing = settlement;
    const slot = { mode: run.mode, promise: settlement };
    this.settling = slot;
    settlement.then(() => {
      if (this.settling === slot) this.settling = null;
    });
    return settlement;
  }

  stop() {
    this.epoch += 1;
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.run = null; // a settlement in progress keeps its own reference to the run and carries on
    this.noRunReason = null;
  }

  // ------------------------------------------------------------------------------------------------ internals

  async _settle(run, { totals, closing, durationMs, bossCleared }) {
    try {
      // The server handles one checkpoint post per run at a time and wants strictly increasing times, so a periodic post
      // still in flight goes first.
      if (run.inflight) await run.inflight;
      const batch = [...run.pending.splice(0), closing].slice(-POINTS_PER_POST);
      let sent = await this._post(run, batch);
      // Coverage decides ranking and the boss bounty, so the closing batch gets one more try. The server skips points it
      // already stored, so repeating the identical batch is safe even if the first attempt was handled.
      if (!sent.ok && sent.transient) sent = await this._post(run, batch);

      const body = { ticket: run.ticket, ...totals, durationMs, bossCleared };
      const outcome = await this._submit(run, body);
      const extras = {
        coverage: Math.round((run.ackedT / durationMs) * 1000) / 1000,
        ...(sent.ok ? {} : { checkpointFailed: true }),
      };
      if (outcome.ok) return { ticketed: true, ...outcome.res, ...extras };
      const err = outcome.err;
      if (err?.status === 409 && err?.message === 'already_submitted') return { ticketed: true, alreadySubmitted: true, ...extras };
      return { ticketed: true, error: err?.message || 'submit_failed', status: err?.status, reason: reasonFor(err), ...extras };
    } finally {
      if (this.run === run) this.run = null;
    }
  }

  /** POST one batch of checkpoints. Never rejects; failures are recorded in `lastError`. */
  async _post(run, points) {
    try {
      await this.api(`/runs/${run.runId}/checkpoints`, { method: 'POST', token: run.token, body: { points } });
      run.ackedT = Math.max(run.ackedT, points[points.length - 1].t);
      return { ok: true };
    } catch (err) {
      this._noteError('checkpoint', err);
      return { ok: false, transient: isTransient(err) };
    }
  }

  /** POST the submit, once more if the first attempt hit network trouble. Never rejects: { ok: true, res } or { ok: false, err }. */
  async _submit(run, body) {
    const attempt = () => this.api(`/runs/${run.runId}/submit`, { method: 'POST', token: run.token, body });
    let last;
    for (let tries = 0; tries < 2; tries += 1) {
      try {
        return { ok: true, res: await attempt() };
      } catch (err) {
        last = err;
        this._noteError('submit', err);
        // 409 already_submitted: the first attempt did land. Anything the server refused on purpose is final.
        if (!isTransient(err)) break;
      }
    }
    return { ok: false, err: last };
  }

  _stamp(run, at = this.now()) {
    const t = Math.max(Math.round(at - run.startedLocal), run.lastT + 1);
    run.lastT = t;
    return t;
  }

  _noteError(where, err) {
    const status = Number.isInteger(err?.status) ? err.status : 0;
    const code = String(err?.message || 'error');
    this.lastError = { where, status, code, at: this.now() };
    if (status === 401 && code !== 'bad_ticket' && !this.authLostSent) {
      this.authLostSent = true;
      try {
        this.authLostHandler?.({ status, code, where });
      } catch { /* the session layer must not be able to break a run */ }
    }
  }

  /** Resolves when `promise` settles or after `ms`, whichever comes first; the timer never outlives the wait. */
  _waitFor(promise, ms) {
    return new Promise((resolve) => {
      const id = typeof this.timers.setTimeout === 'function' ? this.timers.setTimeout(resolve, ms) : setTimeout(resolve, ms);
      const done = () => {
        if (typeof this.timers.clearTimeout === 'function') this.timers.clearTimeout(id);
        else clearTimeout(id);
        resolve();
      };
      promise.then(done, done);
    });
  }
}

export const runs = new RunTracker();
