-- Referrals (server/src/referrals.js). A player's invite link carries a code; a friend who signs in through it is recorded
-- once, against the wallet they signed in with.
--
-- Keyed by WALLET, not by subject: a player's subject changes the day they pass face verification (it becomes their
-- whitelisted root), so a row keyed by subject would stop pointing at them. Who counts as "a real person" is worked out
-- when the numbers are read, from wallets.subject / wallets.verified, which is what keeps one human to one referral.

-- One code per wallet, drawn at random the first time its owner asks for it.
CREATE TABLE IF NOT EXISTS referral_codes (
  wallet text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who invited whom. A wallet is invited at most once (the first code it used wins), and never by itself.
CREATE TABLE IF NOT EXISTS referrals (
  referred_wallet text PRIMARY KEY,
  referrer_wallet text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referred_wallet <> referrer_wallet)
);

-- GET /referrals/me and /stats: everything one referrer's wallets brought in.
CREATE INDEX IF NOT EXISTS referrals_referrer
  ON referrals (referrer_wallet);
