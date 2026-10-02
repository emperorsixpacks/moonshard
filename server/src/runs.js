import crypto from "node:crypto";
import express from "express";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";
import { rankOf } from "./leaderboard.js";
import { createRefreshCooldown } from "./auth.js";

const UNIQUE_VIOLATION = "23505"; // Postgres SQLSTATE, same code from pg and PGlite

const ticketKey = (ctx) => crypto.createHash("sha256").update(`moonshard-ticket|${ctx.config.jwtSecret}`).digest();

function ticketFor(ctx, run) {
  const started = new Date(run.started_at).getTime();
  return crypto
    .createHmac("sha256", ticketKey(ctx))
    .update(`${run.run_id}|${run.subject}|${run.mode}|${run.seed}|${started}`)
    .digest("hex");
}

function sameTicket(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The ids /runs/start issues: crypto.randomUUID(), lowercase. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Throws 400 bad_run_id unless `id` is a run id the server could have issued. Checked before the id reaches the
 * database: a NUL byte is not valid text for Postgres and used to turn a lookup into a 500.
 * @returns {string} the id
 */
export function assertRunId(id) {
  if (typeof id !== "string" || !RUN_ID.test(id)) throw new HttpError(400, "bad_run_id");
  return id;
}

async function loadOwnedRun(ctx, req) {
  const { rows } = await ctx.db.query("SELECT * FROM runs WHERE run_id = $1", [assertRunId(req.params.id)]);
  const run = rows[0];
  if (!run || run.subject !== req.player.subject) throw new HttpError(404, "run_not_found");
  return run;
}

function assertOpen(ctx, run) {
  if (run.status === "submitted") throw new HttpError(409, "already_submitted");
  if (run.status === "void") throw new HttpError(409, "run_void");
  if (ctx.now() - new Date(run.started_at).getTime() > GAME.TICKET_MAX_AGE_MS) throw new HttpError(410, "ticket_expired");
}

const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" && typeof v !== "boolean" ? Math.trunc(Number(v)) : NaN);

/**
 * Adds each flag to the run, once: a flag already on the run is not appended again, so a client that keeps posting
 * bad checkpoints cannot grow the `flags` column (and rewrite the row every time) without bound.
 * `db` is anything with query(): the pool, or the transaction handle when the flag must commit with other writes.
 */
async function addFlag(db, runId, flags) {
  for (const flag of new Set(flags)) {
    await db.query(
      `UPDATE runs SET flags = CASE WHEN flags = '' THEN $2 ELSE flags || ',' || $2 END
        WHERE run_id = $1 AND position(',' || $2 || ',' IN ',' || flags || ',') = 0`,
      [runId, flag],
    );
  }
}

/**
 * Is `next` more than a player could have scored, killed or collected in the `gapMs` since `last`?
 * Points and kills are allowed their sustained rate over the gap plus a one-off allowance for the events the rate does
 * not model (a boss kill, wave bonuses, a swing that clears the arena); Shards follow the kills.
 */
function jumpedSince(last, next, gapMs) {
  const seconds = gapMs / 1000;
  return (
    next.score - last.score > GAME.MAX_PTS_PER_SEC * seconds + GAME.SCORE_BURST_PTS ||
    next.kills - last.kills > GAME.MAX_KILLS_PER_SEC * seconds + GAME.KILLS_SLACK ||
    next.shards - last.shards > GAME.SHARDS_PER_KILL * Math.max(0, next.kills - last.kills) + GAME.SHARDS_BASE_ALLOWANCE
  );
}

export function runRoutes(ctx) {
  const r = express.Router();

  // One wait per (player, mode) between /runs/start calls (GAME.START_GAP_MS). Kept in this process, like the
  // /me/refresh cooldown: it is abuse control, not an invariant. The invariant (one open run per player and mode) is
  // the database's, and holds across processes. `config.startGapMs` overrides the waits (the start-race tests set 0).
  const gaps = { ...GAME.START_GAP_MS, ...ctx.config.startGapMs };
  const startCooldown = {
    TRIAL: createRefreshCooldown({ now: () => ctx.now(), cooldownMs: gaps.TRIAL }),
    STORY: createRefreshCooldown({ now: () => ctx.now(), cooldownMs: gaps.STORY }),
  };

  r.post("/runs/start", ctx.requireAuth, ah(async (req, res) => {
    const { mode, chapter } = req.body || {};
    if (mode !== "TRIAL" && mode !== "STORY") throw new HttpError(400, "bad_mode");
    let ch = null;
    if (mode === "STORY") {
      ch = Number(chapter);
      if (!Number.isInteger(ch) || ch < 1 || ch > 5) throw new HttpError(400, "bad_chapter");
    }
    const p = req.player;
    // After the request is known to be valid (a refused one must not use up the wait), before any database work.
    // The refusal says how long to wait, so a client that restarts inside the wait can start its run once the wait is over
    // (a run without a ticket is not ranked) instead of guessing.
    if (!startCooldown[mode].tryAcquire(p.subject)) {
      throw new HttpError(429, "slow_down", { retryAfterMs: startCooldown[mode].retryAfterMs(p.subject) });
    }
    const now = ctx.now();
    const day = dayKey(now);
    const seed = mode === "TRIAL" ? day : `story-${ch}`;
    const runId = crypto.randomUUID();
    const voidThenInsert = () => ctx.db.tx(async (t) => {
      // Queue racing starts of this (subject, mode) behind one another until this transaction ends, so that
      // the UPDATE below always sees the previous start's committed run. Without it three or more racing
      // starts keep colliding on the unique index and the losers of the single retry get a 500.
      await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`runs.start|${p.subject}|${mode}`]);
      await t.query("UPDATE runs SET status = 'void' WHERE subject = $1 AND mode = $2 AND status = 'open'", [p.subject, mode]);
      await t.query(
        `INSERT INTO runs(run_id, subject, wallet, verified, mode, chapter, seed, day, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [runId, p.subject, p.wallet, p.verified, mode, ch, seed, day, new Date(now)],
      );
    });
    try {
      await voidThenInsert();
    } catch (err) {
      // Backstop for a writer that does not take the lock: its open run landed between our void and our
      // insert, so the unique index on open runs (subject, mode) refused ours. The transaction rolled
      // back; run it again, and this time the void sees the winner's committed run and takes over its slot.
      if (err?.code !== UNIQUE_VIOLATION) throw err;
      await voidThenInsert();
    }
    const ticket = ticketFor(ctx, { run_id: runId, subject: p.subject, mode, seed, started_at: new Date(now) });
    res.json({ runId, seed, mode, chapter: ch, startedAt: new Date(now).toISOString(), ticket });
  }));

  r.post("/runs/:id/checkpoints", ctx.requireAuth, ah(async (req, res) => {
    const run = await loadOwnedRun(ctx, req);
    assertOpen(ctx, run);
    const points = req.body?.points;
    if (!Array.isArray(points) || points.length === 0 || points.length > 50) throw new HttpError(400, "bad_points");

    const elapsed = ctx.now() - new Date(run.started_at).getTime();
    const { accepted, duplicates, reason } = await ctx.db.tx(async (t) => {
      // One post per run at a time. A retry that arrives while the original is still being processed would
      // otherwise read the same stored points, accept the same batch and collide with it on (run_id, seq).
      // Queued behind the original it sees those points and counts them as duplicates. Inside this
      // transaction use `t` only: a second pool connection could deadlock against the queue of waiters.
      await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`runs.checkpoints|${run.run_id}`]);

      // At most MAX_CHECKPOINTS rows. All of them are needed: a re-sent point can be any stored one.
      const stored = (
        await t.query(
          "SELECT seq, t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq",
          [run.run_id],
        )
      ).rows;
      // A client that timed out may re-send a batch the server already processed. A point that is exactly
      // a stored one is skipped silently; anything else that fails the checks below is still flagged.
      const known = new Set(stored.map((c) => `${c.t_ms}|${c.score}|${c.kills}|${c.shards}`));
      const lastRow = stored[stored.length - 1];
      let seq = lastRow ? lastRow.seq : 0;
      let prev = lastRow || { t_ms: 0, score: 0, kills: 0, shards: 0 };
      const fresh = [];
      const reason = new Set();
      let duplicates = 0;

      // Checkpoints are at least MIN_CHECKPOINT_GAP_MS apart, so a run holds about elapsed / 2 s rows however it is
      // posted. The one exception is the closing checkpoint the honest client sends when the run ends, which can land
      // a moment after its last periodic one: MAX_SHORT_CHECKPOINT_GAPS gaps per run (counted over what is stored,
      // time zero counting as the first predecessor) may be shorter.
      let shortGaps = 0;
      let before = 0;
      for (const c of stored) {
        if (c.t_ms - before < GAME.MIN_CHECKPOINT_GAP_MS) shortGaps += 1;
        before = c.t_ms;
      }

      for (const pt of points) {
        const t = int(pt?.t), score = int(pt?.score), kills = int(pt?.kills), shards = int(pt?.shards ?? 0);
        if ([t, score, kills, shards].some((x) => !Number.isInteger(x) || x < 0)) { reason.add("cp_malformed"); break; }
        if (known.has(`${t}|${score}|${kills}|${shards}`)) { duplicates += 1; continue; }
        if (t <= prev.t_ms) { reason.add("cp_time"); break; }
        const tooClose = t - prev.t_ms < GAME.MIN_CHECKPOINT_GAP_MS;
        if (tooClose && shortGaps >= GAME.MAX_SHORT_CHECKPOINT_GAPS) { reason.add("cp_gap"); break; }
        if (t > elapsed + GAME.CLOCK_TOLERANCE_MS) { reason.add("cp_future"); break; }
        if (score < prev.score || kills < prev.kills || shards < prev.shards) { reason.add("cp_regress"); break; }
        // No run can ever bank more than this, and an unbounded value would overflow the integer column.
        if (shards > GAME.MAX_SHARDS_PER_RUN) { reason.add("cp_shards"); break; }
        const dt = (t - prev.t_ms) / 1000;
        // Since the previous checkpoint: the sustained rate, plus a one-off allowance for events the rate does not model.
        if (score - prev.score > GAME.MAX_PTS_PER_SEC * dt + GAME.SCORE_BURST_PTS) { reason.add("cp_score_rate"); break; }
        if (kills - prev.kills > GAME.MAX_KILLS_PER_SEC * dt + GAME.KILLS_SLACK) { reason.add("cp_kill_rate"); break; }
        // Since the start: the allowances above are not available at every checkpoint, or closely spaced checkpoints
        // would add one each. Honest play stays far below the sustained rate over any stretch from the start.
        if (score > GAME.MAX_PTS_PER_SEC * (t / 1000)) { reason.add("cp_score_total"); break; }
        if (kills > GAME.MAX_KILLS_PER_SEC * (t / 1000) + GAME.KILLS_SLACK) { reason.add("cp_kill_rate"); break; }
        if (seq + 1 > GAME.MAX_CHECKPOINTS) { reason.add("cp_limit"); break; }
        seq += 1;
        fresh.push([run.run_id, seq, t, score, kills, shards]);
        if (tooClose) shortGaps += 1;
        prev = { t_ms: t, score, kills, shards };
      }

      for (const row of fresh) {
        await t.query(
          "INSERT INTO run_checkpoints(run_id, seq, t_ms, score, kills, shards) VALUES ($1,$2,$3,$4,$5,$6)",
          row,
        );
      }
      await addFlag(t, run.run_id, reason);
      return { accepted: fresh.length, duplicates, reason };
    });
    if (reason.size) {
      return res.status(422).json({ error: "bad_checkpoint", reason: [...reason], accepted, duplicates });
    }
    res.json({ ok: true, accepted, duplicates });
  }));

  r.post("/runs/:id/submit", ctx.requireAuth, ah(async (req, res) => {
    const run = await loadOwnedRun(ctx, req);
    if (run.status === "submitted") throw new HttpError(409, "already_submitted");
    if (run.status === "void") throw new HttpError(409, "run_void");
    const b = req.body || {};
    if (!sameTicket(b.ticket, ticketFor(ctx, run))) throw new HttpError(401, "bad_ticket");

    const startedMs = new Date(run.started_at).getTime();
    const elapsed = ctx.now() - startedMs;
    if (elapsed > GAME.TICKET_MAX_AGE_MS) throw new HttpError(410, "ticket_expired");

    const score = int(b.score), kills = int(b.kills), shards = int(b.shards ?? 0), durationMs = int(b.durationMs);
    if ([score, kills, shards, durationMs].some((x) => !Number.isInteger(x) || x < 0)) throw new HttpError(400, "invalid_numbers");
    if (score > GAME.MAX_SCORE) throw new HttpError(400, "invalid_score");
    if (durationMs < GAME.MIN_DURATION_MS) throw new HttpError(400, "invalid_duration");
    if (durationMs > elapsed + GAME.CLOCK_TOLERANCE_MS) throw new HttpError(400, "duration_exceeds_elapsed");
    const seconds = durationMs / 1000;
    if (score / seconds > GAME.MAX_PTS_PER_SEC) throw new HttpError(400, "invalid_score_rate");
    if (kills / seconds > GAME.MAX_KILLS_PER_SEC) throw new HttpError(400, "invalid_kill_rate");
    const shardCeil = Math.min(GAME.SHARDS_PER_KILL * kills + GAME.SHARDS_BASE_ALLOWANCE, GAME.MAX_SHARDS_PER_RUN);
    if (shards > shardCeil) throw new HttpError(400, "shard_count_anomaly");

    const wantsBoss = b.bossCleared === true;
    if (wantsBoss && run.mode !== "STORY") throw new HttpError(400, "boss_requires_story");
    // The boss needs the play time (claimed) and the server's own time (measured): see GAME.BOSS_MIN.
    if (wantsBoss && (durationMs < GAME.BOSS_MIN.durationMs || elapsed < GAME.BOSS_MIN.durationMs || kills < GAME.BOSS_MIN.kills)) {
      throw new HttpError(400, "boss_telemetry_insufficient");
    }

    const last = (
      await ctx.db.query(
        "SELECT t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq DESC LIMIT 1",
        [run.run_id],
      )
    ).rows[0];
    const coverage = last ? last.t_ms / durationMs : 0;
    const flags = run.flags ? run.flags.split(",") : [];
    if (last) {
      const totals = { score, kills, shards };
      if (score < last.score || kills < last.kills || shards < last.shards) flags.push("totals_below_checkpoint");
      // The totals are the run's last point. Whatever they add to the last checkpoint must fit in the time since it,
      // on the server's clock: a checkpoint posted at the very end (zero, say) does not cover the whole run's totals.
      // Elapsed time, not the claimed duration: a run that was paused has less claimed play than wall time, and the
      // client's checkpoints follow the wall clock. Plus the tolerance, for the same reason as everywhere else.
      if (jumpedSince(last, totals, Math.max(0, elapsed - last.t_ms) + GAME.CLOCK_TOLERANCE_MS)) flags.push("totals_above_checkpoint");
    }
    if (wantsBoss && coverage < GAME.MIN_COVERAGE_BOSS) flags.push("boss_low_coverage");

    // Only a run that has been played for a while counts: the server's own clock since /runs/start AND the claimed play
    // time must both reach MIN_RANKED_ELAPSED_MS. Shorter runs are still recorded (open board), unflagged, not ranked.
    const playedLongEnough = elapsed >= GAME.MIN_RANKED_ELAPSED_MS && durationMs >= GAME.MIN_RANKED_ELAPSED_MS;
    const bossCleared = wantsBoss && flags.length === 0;
    const rankedOk = Boolean(run.verified) && flags.length === 0 && playedLongEnough
      && (run.mode === "STORY" || coverage >= GAME.MIN_COVERAGE_RANKED);
    // Shards are paid out in G$, so they need the evidence a ranked score needs: no flags, a run played for a while, and
    // checkpoints covering at least half of it. Without it, start + submit alone would bank a full day's cap.
    const shardsCredited = Boolean(run.verified) && flags.length === 0 && playedLongEnough && coverage >= GAME.MIN_COVERAGE_RANKED;

    let isNewBest = false;
    await ctx.db.tx(async (t) => {
      // The open -> submitted transition is the single point where a ticket is spent. The status
      // check above was read outside this transaction, so repeat it atomically here: of any number
      // of concurrent submits of one ticket, exactly one gets the row back.
      const spent = await t.query(
        `UPDATE runs SET status='submitted', submitted_at=$2, score=$3, kills=$4, shards=$5, duration_ms=$6,
                boss_cleared=$7, ranked_ok=$8, flags=$9 WHERE run_id=$1 AND status='open' RETURNING run_id`,
        [run.run_id, new Date(ctx.now()), score, kills, shards, durationMs, bossCleared, rankedOk, flags.join(",")],
      );
      if (spent.rows.length === 0) {
        const now = await t.query("SELECT status FROM runs WHERE run_id = $1", [run.run_id]);
        throw new HttpError(409, now.rows[0]?.status === "void" ? "run_void" : "already_submitted");
      }
      if (run.mode === "TRIAL") {
        const up = await t.query(
          `INSERT INTO scores(day, subject, wallet, verified, ranked_ok, score, kills, duration_ms, run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (day, subject) DO UPDATE SET wallet=EXCLUDED.wallet, verified=EXCLUDED.verified,
             ranked_ok=EXCLUDED.ranked_ok, score=EXCLUDED.score, kills=EXCLUDED.kills,
             duration_ms=EXCLUDED.duration_ms, run_id=EXCLUDED.run_id
           WHERE (EXCLUDED.ranked_ok AND NOT scores.ranked_ok)
              OR (EXCLUDED.ranked_ok = scores.ranked_ok AND EXCLUDED.score > scores.score)
           RETURNING run_id`,
          [run.day, run.subject, run.wallet, run.verified, rankedOk, score, kills, durationMs, run.run_id],
        );
        isNewBest = up.rows.length > 0;
      }
      if (shards > 0 && shardsCredited) {
        await t.query(
          `INSERT INTO shard_days(day, subject, shards) VALUES ($1,$2,$3)
           ON CONFLICT (day, subject) DO UPDATE SET shards = shard_days.shards + EXCLUDED.shards`,
          [run.day, run.subject, shards],
        );
      }
    });

    const rank = run.mode === "TRIAL"
      ? { open: await rankOf(ctx, run.day, run.subject, "open"), ranked: await rankOf(ctx, run.day, run.subject, "ranked") }
      : null;
    // `shardsCredited` and `tooShort` let the end screen say what happened instead of guessing: a run that ended before
    // `minPlayMs` is not a flagged run, it just did not play long enough to count.
    res.json({ ok: true, isNewBest, rankedOk, bossCleared, flags, rank, shardsCredited, tooShort: !playedLongEnough, minPlayMs: GAME.MIN_RANKED_ELAPSED_MS });
  }));

  return r;
}
