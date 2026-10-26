-- Endless levels (server/src/levels.js). The level an Endless run ended on, as the client reports it and the server bounds it
-- by the kills the run claims and the time those kills take. Null on Story runs, and on every run from before Endless had levels.
--
-- Only the column is added here, and that is quick: a nullable column with no default is a change to the catalog, not a rewrite
-- of the table. But ALTER TABLE takes an ACCESS EXCLUSIVE lock and keeps it until this file's transaction ends, so the indexes
-- the column needs are in 006_run_indexes.sql: built in this transaction, they would hold every read of `runs` until they were done.
--
-- lock_timeout: when a long query already holds the table, give up instead of queueing behind it, because a queued ALTER holds
-- up every query that arrives after it. The new instance then does not start, the old one keeps serving, and the next deploy tries again.
SET LOCAL lock_timeout = '5s';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS level integer;
