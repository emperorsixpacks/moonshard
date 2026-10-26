-- Indexes on `runs` for the Endless best level (server/src/levels.js) and the referral check (server/src/referrals.js).
-- Plain CREATE INDEX, as in 002_indexes.sql: the migration runs inside a transaction, so it cannot be CONCURRENTLY. Each build
-- takes a SHARE lock, which blocks writes to `runs` (a run starting or being submitted) but not reads, for as long as it takes:
-- on a database that already holds a lot of runs, deploy it in a quiet moment.

-- The deepest level a player has reached (bestLevel: GET /rewards/status, and the blades and armour that ask for a level in
-- shop.js): the highest `level` over their RANKED runs, by player (subject) or by any of their wallets, as ownedItems reads
-- purchases. Partial, so each index holds only the runs that can count: a few rows per player, not every run ever played.
CREATE INDEX IF NOT EXISTS runs_subject_level
  ON runs (subject, level) WHERE ranked_ok AND level IS NOT NULL;
CREATE INDEX IF NOT EXISTS runs_wallet_level
  ON runs (wallet, level) WHERE ranked_ok AND level IS NOT NULL;

-- "Has this wallet played yet?" (a referral may only claim a player who is new): runs had an index by subject and none by wallet.
CREATE INDEX IF NOT EXISTS runs_wallet
  ON runs (wallet);
