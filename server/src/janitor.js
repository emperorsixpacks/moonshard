import { GAME } from "../config.js";
import { DAY_MS } from "./time.js";

/** A void run, or an open one whose ticket has expired, is deleted this long after it started. */
export const VOID_RUN_RETENTION_MS = DAY_MS;
/** A submitted run's checkpoints are deleted this long after the run was submitted (the run row itself stays). */
export const SUBMITTED_CHECKPOINT_RETENTION_MS = 2 * DAY_MS;
export const JANITOR_INTERVAL_MS = 60 * 60_000;

/**
 * Deletes what no one can use any more. Without it every run a player ever started stayed in `runs`, with every
 * checkpoint posted for it, for ever.
 *
 *  - void runs (a newer start of the same mode replaced them) and open runs whose ticket has expired can never be
 *    submitted: deleted a day after they started, their checkpoints with them (ON DELETE CASCADE);
 *  - the checkpoints of a submitted run are only read while the run is being submitted: deleted two days after the
 *    submit, and only once the run's UTC day is settled. The run row stays: it is the history behind the stats and
 *    the boss attestation.
 *
 * Settlement reads `scores`, `shard_days` and `settled_days`, and the player endpoints read `spoils`, `spoil_claims`,
 * `engagement_claims` and `ubi_claims`; none of those is touched. Idempotent: a second pass finds nothing. Everything
 * happens in one transaction, so a failure part-way deletes nothing.
 *
 * @param {{ db: any, now: () => number }} ctx
 * @param {{ now?: () => number }} [opts] a clock to use instead of ctx.now
 * @returns {Promise<{ voidRuns: number, openRuns: number, checkpoints: number }>} what was deleted. `checkpoints` counts
 *   the checkpoints of submitted runs; those that went with a deleted run are not counted.
 */
export async function runJanitor(ctx, { now = ctx.now } = {}) {
  const t = now();
  const voidCutoff = new Date(t - VOID_RUN_RETENTION_MS);
  // An open run is only expired once its ticket is: never delete a run that could still be submitted.
  const openCutoff = new Date(t - Math.max(VOID_RUN_RETENTION_MS, GAME.TICKET_MAX_AGE_MS + 60_000));
  const checkpointCutoff = new Date(t - SUBMITTED_CHECKPOINT_RETENTION_MS);

  return ctx.db.tx(async (tx) => {
    const swept = await tx.query(
      `WITH gone AS (
         DELETE FROM runs
          WHERE (status = 'void' AND started_at < $1) OR (status = 'open' AND started_at < $2)
         RETURNING status
       ) SELECT status, count(*)::int AS n FROM gone GROUP BY status`,
      [voidCutoff, openCutoff],
    );
    const trimmed = await tx.query(
      `WITH gone AS (
         DELETE FROM run_checkpoints
          WHERE run_id IN (
            SELECT run_id FROM runs
             WHERE status = 'submitted' AND submitted_at < $1 AND day IN (SELECT day FROM settled_days)
          )
         RETURNING 1
       ) SELECT count(*)::int AS n FROM gone`,
      [checkpointCutoff],
    );
    const by = (status) => swept.rows.find((r) => r.status === status)?.n ?? 0;
    return { voidRuns: by("void"), openRuns: by("open"), checkpoints: trimmed.rows[0]?.n ?? 0 };
  });
}
