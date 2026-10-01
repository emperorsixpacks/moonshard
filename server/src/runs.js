import crypto from "node:crypto";
import express from "express";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";
import { rankOf } from "./leaderboard.js";

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

async function loadOwnedRun(ctx, req) {
  const { rows } = await ctx.db.query("SELECT * FROM runs WHERE run_id = $1", [req.params.id]);
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
const addFlag = (ctx, runId, flags) =>
  ctx.db.query(
    "UPDATE runs SET flags = CASE WHEN flags = '' THEN $2 ELSE flags || ',' || $2 END WHERE run_id = $1",
    [runId, flags.join(",")],
  );

export function runRoutes(ctx) {
  const r = express.Router();

  r.post("/runs/start", ctx.requireAuth, ah(async (req, res) => {
    const { mode, chapter } = req.body || {};
    if (mode !== "TRIAL" && mode !== "STORY") throw new HttpError(400, "bad_mode");
    let ch = null;
    if (mode === "STORY") {
      ch = Number(chapter);
      if (!Number.isInteger(ch) || ch < 1 || ch > 5) throw new HttpError(400, "bad_chapter");
    }
    const now = ctx.now();
    const day = dayKey(now);
    const seed = mode === "TRIAL" ? day : `story-${ch}`;
    const runId = crypto.randomUUID();
    const p = req.player;
    await ctx.db.tx(async (t) => {
      await t.query("UPDATE runs SET status = 'void' WHERE subject = $1 AND mode = $2 AND status = 'open'", [p.subject, mode]);
      await t.query(
        `INSERT INTO runs(run_id, subject, wallet, verified, mode, chapter, seed, day, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [runId, p.subject, p.wallet, p.verified, mode, ch, seed, day, new Date(now)],
      );
    });
    const ticket = ticketFor(ctx, { run_id: runId, subject: p.subject, mode, seed, started_at: new Date(now) });
    res.json({ runId, seed, mode, chapter: ch, startedAt: new Date(now).toISOString(), ticket });
  }));

  r.post("/runs/:id/checkpoints", ctx.requireAuth, ah(async (req, res) => {
    const run = await loadOwnedRun(ctx, req);
    assertOpen(ctx, run);
    const points = req.body?.points;
    if (!Array.isArray(points) || points.length === 0 || points.length > 50) throw new HttpError(400, "bad_points");

    const elapsed = ctx.now() - new Date(run.started_at).getTime();
    const lastRow = (
      await ctx.db.query(
        "SELECT seq, t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq DESC LIMIT 1",
        [run.run_id],
      )
    ).rows[0];
    let seq = lastRow ? lastRow.seq : 0;
    let prev = lastRow || { t_ms: 0, score: 0, kills: 0, shards: 0 };
    const accepted = [];
    const reason = new Set();

    for (const pt of points) {
      const t = int(pt?.t), score = int(pt?.score), kills = int(pt?.kills), shards = int(pt?.shards ?? 0);
      if ([t, score, kills, shards].some((x) => !Number.isInteger(x) || x < 0)) { reason.add("cp_malformed"); break; }
      if (t <= prev.t_ms) { reason.add("cp_time"); break; }
      if (t > elapsed + GAME.CLOCK_TOLERANCE_MS) { reason.add("cp_future"); break; }
      if (score < prev.score || kills < prev.kills || shards < prev.shards) { reason.add("cp_regress"); break; }
      // No run can ever bank more than this, and an unbounded value would overflow the integer column.
      if (shards > GAME.MAX_SHARDS_PER_RUN) { reason.add("cp_shards"); break; }
      const dt = (t - prev.t_ms) / 1000;
      if (score - prev.score > GAME.MAX_PTS_PER_SEC * dt + GAME.CHECKPOINT_SLACK_PTS) { reason.add("cp_score_rate"); break; }
      if (kills - prev.kills > GAME.MAX_KILLS_PER_SEC * dt + 5) { reason.add("cp_kill_rate"); break; }
      if (seq + 1 > GAME.MAX_CHECKPOINTS) { reason.add("cp_limit"); break; }
      seq += 1;
      accepted.push([run.run_id, seq, t, score, kills, shards]);
      prev = { t_ms: t, score, kills, shards };
    }

    for (const row of accepted) {
      await ctx.db.query(
        "INSERT INTO run_checkpoints(run_id, seq, t_ms, score, kills, shards) VALUES ($1,$2,$3,$4,$5,$6)",
        row,
      );
    }
    if (reason.size) {
      await addFlag(ctx, run.run_id, [...reason]);
      return res.status(422).json({ error: "bad_checkpoint", reason: [...reason], accepted: accepted.length });
    }
    res.json({ ok: true, accepted: accepted.length });
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
    if (wantsBoss && (durationMs < GAME.BOSS_MIN.durationMs || kills < GAME.BOSS_MIN.kills)) {
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
    if (last && (score < last.score || kills < last.kills || shards < last.shards)) flags.push("totals_below_checkpoint");
    if (wantsBoss && coverage < GAME.MIN_COVERAGE_BOSS) flags.push("boss_low_coverage");

    const bossCleared = wantsBoss && flags.length === 0;
    const rankedOk = Boolean(run.verified) && flags.length === 0 && (run.mode === "STORY" || coverage >= GAME.MIN_COVERAGE_RANKED);

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
      if (shards > 0 && run.verified) {
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
    res.json({ ok: true, isNewBest, rankedOk, bossCleared, flags, rank });
  }));

  return r;
}
