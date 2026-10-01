-- Indexes for the queries the API runs on tables that grow with players and days.
-- Idempotent on purpose (IF NOT EXISTS): re-running this file, or restoring _migrations from a backup, is harmless.
-- Plain CREATE INDEX, not CONCURRENTLY: the migration runs inside a transaction, and it takes a short write lock
-- on the table while the index is built.

-- Boards. Every ranking in the API sorts by (score DESC, duration_ms ASC, kills DESC, run_id ASC): the boards in
-- leaderboard.js and the prize settlement in spoils.js. An index with the same columns and directions hands the rows
-- over already ordered, so a board for one day reads its first N index entries instead of sorting the whole day.

-- Daily board, open view, and rankOf (first 1000 of the day).
CREATE INDEX IF NOT EXISTS scores_day_rank
  ON scores (day, score DESC, duration_ms ASC, kills DESC, run_id ASC);

-- Daily board, ranked view, and the prize settlement (WHERE ranked_ok AND verified ... LIMIT 3). Partial: only ranked
-- rows are in it, so a day with many free unranked wallets does not make the ranked board scan past them.
CREATE INDEX IF NOT EXISTS scores_day_rank_ranked
  ON scores (day, score DESC, duration_ms ASC, kills DESC, run_id ASC)
  WHERE ranked_ok;

-- All-time board: DISTINCT ON (subject) ... ORDER BY subject, <ranking> reads each subject's rows already ordered, so
-- there is no sort of the whole table (which spills to disk once it outgrows work_mem). Also serves WHERE subject = $1.
CREATE INDEX IF NOT EXISTS scores_subject_rank
  ON scores (subject, score DESC, duration_ms ASC, kills DESC, run_id ASC);
CREATE INDEX IF NOT EXISTS scores_subject_rank_ranked
  ON scores (subject, score DESC, duration_ms ASC, kills DESC, run_id ASC)
  WHERE ranked_ok;

-- runs
-- pendingBossRun: WHERE subject = $1 AND mode = 'STORY' AND status = 'submitted' ..., called by /rewards/status and
-- /engagement/status. runs holds one row per run started, so without this every poll scans every run ever played.
CREATE INDEX IF NOT EXISTS runs_subject_mode_status
  ON runs (subject, mode, status);
-- /stats: runs and distinct players of one day, and the 7-day series (WHERE day = $1 / day >= $1 AND status = ...).
CREATE INDEX IF NOT EXISTS runs_day_status
  ON runs (day, status);

-- GET /spoils: WHERE subject = $1 ORDER BY day DESC, kind LIMIT 30. The column order lets the index return the 30 newest.
CREATE INDEX IF NOT EXISTS spoils_subject
  ON spoils (subject, day DESC, kind);

-- hasEngagementClaim: WHERE subject = $1 LIMIT 1, called by /rewards/status, /engagement/status and /engagement/attest.
CREATE INDEX IF NOT EXISTS engagement_claims_subject
  ON engagement_claims (subject);

-- /stats: UBI claims of one day and the 7-day series.
CREATE INDEX IF NOT EXISTS ubi_claims_day
  ON ubi_claims (day);

-- GET /auth/nonce deletes the expired nonces on every call: DELETE ... WHERE expires_at < $1.
CREATE INDEX IF NOT EXISTS nonces_expires_at
  ON nonces (expires_at);
