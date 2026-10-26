-- Endless levels (server/src/levels.js). The level an Endless run ended on, as the client reports it and the server bounds it
-- by the kills the run claims. Null on Story runs, and on every run from before Endless had levels.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS level integer;

-- The deepest level a player has reached (bestLevel: GET /rewards/status, and the blades that ask for a level in shop.js):
-- the highest `level` over their RANKED runs, by player (subject) or by any of their wallets, as ownedItems reads purchases.
-- Partial, so each index holds only the runs that can count: a few rows per player, not every run ever played.
CREATE INDEX IF NOT EXISTS runs_subject_level
  ON runs (subject, level) WHERE ranked_ok AND level IS NOT NULL;
CREATE INDEX IF NOT EXISTS runs_wallet_level
  ON runs (wallet, level) WHERE ranked_ok AND level IS NOT NULL;
