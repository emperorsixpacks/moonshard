import { apiFetch } from './api.js';
import { getToken } from './session.js';

/**
 * Tracks one server-ticketed run. Anonymous / offline runs are simply unticketed: every method is
 * a safe no-op, so gameplay never depends on the API being reachable.
 */
export class RunTracker {
  constructor({
    api = apiFetch,
    getToken: tokenFn = getToken,
    now = () => Date.now(),
    intervalMs = 10_000,
    timers = { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },
  } = {}) {
    this.api = api;
    this.getToken = tokenFn;
    this.now = now;
    this.intervalMs = intervalMs;
    this.timers = timers;
    this.run = null;
    this.timer = null;
    this.counters = { score: 0, kills: 0, shards: 0 };
    this.pending = [];
    this.inflight = null;
    // Bumped by stop(). Scenes call start() without awaiting it, so its response can arrive after the
    // scene shut down or a newer start(); such a stale response must not install a run or a timer.
    this.epoch = 0;
  }

  async start({ mode, chapter }) {
    this.stop();
    const epoch = this.epoch;
    const token = this.getToken();
    if (!token) return null;
    this.counters = { score: 0, kills: 0, shards: 0 };
    this.pending = [];
    const sentAt = this.now(); // measured from request time so server-side `t <= elapsed + tolerance` holds
    try {
      const run = await this.api('/runs/start', { method: 'POST', token, body: { mode, ...(chapter ? { chapter } : {}) } });
      if (epoch !== this.epoch) return null; // stopped or superseded while the request was in flight
      this.run = { ...run, token, startedLocal: sentAt };
      this.timer = this.timers.setInterval(() => this.flush(), this.intervalMs);
      return run;
    } catch {
      return null; // this.run is already null (stop() ran first); a stale failure must not touch a newer run
    }
  }

  update(patch) {
    if (patch) Object.assign(this.counters, patch);
  }

  sample() {
    if (!this.run) return;
    this.pending.push({ t: this.now() - this.run.startedLocal, ...this.counters });
  }

  async flush() {
    if (!this.run) return;
    if (this.inflight) return this.inflight;
    this.sample();
    const run = this.run;
    const points = this.pending.splice(0, 50);
    if (!points.length) return;
    this.inflight = this.api(`/runs/${run.runId}/checkpoints`, { method: 'POST', token: run.token, body: { points } })
      .catch(() => {
        // Deliberately not re-queued: a failed post may still have been processed, and the server flags a
        // repeated or non-increasing `t` (cp_time), which forfeits ranking and the boss bounty. The next
        // sample carries cumulative counters and the closing checkpoint restores coverage, so nothing is lost.
      })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async finish({ score, kills, shards, durationMs, bossCleared = false }) {
    if (!this.run) {
      this.stop(); // also drops a start() still in flight, so it cannot revive a run after the fact
      return { ticketed: false };
    }
    const run = this.run;
    this.update({ score, kills, shards });
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;
    if (this.inflight) await this.inflight;
    // `run` may have been stopped or replaced while we waited; never touch a newer run's state.
    if (this.run === run) await this.flush(); // closing checkpoint
    if (this.run === run) this.run = null;
    try {
      const res = await this.api(`/runs/${run.runId}/submit`, {
        method: 'POST',
        token: run.token,
        body: { ticket: run.ticket, score, kills, shards, durationMs: Math.round(durationMs), bossCleared },
      });
      return { ticketed: true, ...res };
    } catch (err) {
      return { ticketed: true, error: err?.message || 'submit_failed', status: err?.status };
    }
  }

  stop() {
    this.epoch += 1;
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.run = null;
    this.pending = [];
  }
}

export const runs = new RunTracker();
