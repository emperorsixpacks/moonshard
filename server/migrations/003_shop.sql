-- The Moon Shop (server/src/shop.js). One row per confirmed purchase: a G$ transfer from the player's wallet to the prize
-- vault whose calldata names the item. A transaction names one item, so the transaction is the key: confirming it again
-- records nothing. `amount` is what the vault received (wei of G$, as text like the other tables).
CREATE TABLE IF NOT EXISTS purchases (
  tx_hash text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  item_id text NOT NULL,
  amount text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- What a player owns (GET /rewards/status, POST /runs/start): WHERE subject = $1.
CREATE INDEX IF NOT EXISTS purchases_subject
  ON purchases (subject, item_id);

-- What a player's wallets bought (ownedItems: wallet IN (that player's wallets)).
CREATE INDEX IF NOT EXISTS purchases_wallet
  ON purchases (wallet);
