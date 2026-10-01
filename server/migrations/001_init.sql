CREATE TABLE nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE TABLE users (
  subject text PRIMARY KEY,
  root text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  address text PRIMARY KEY,
  subject text NOT NULL,
  host text NOT NULL DEFAULT 'browser',
  verified boolean NOT NULL DEFAULT false,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallets_subject ON wallets(subject);

CREATE TABLE runs (
  run_id text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  verified boolean NOT NULL,
  mode text NOT NULL CHECK (mode IN ('TRIAL','STORY')),
  chapter integer,
  seed text NOT NULL,
  day text NOT NULL,
  started_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','void')),
  submitted_at timestamptz,
  score integer,
  kills integer,
  shards integer,
  duration_ms integer,
  boss_cleared boolean NOT NULL DEFAULT false,
  ranked_ok boolean NOT NULL DEFAULT false,
  flags text NOT NULL DEFAULT ''
);
CREATE INDEX runs_open ON runs(subject, mode) WHERE status = 'open';

CREATE TABLE run_checkpoints (
  run_id text NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  seq integer NOT NULL,
  t_ms integer NOT NULL,
  score integer NOT NULL,
  kills integer NOT NULL,
  shards integer NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE scores (
  day text NOT NULL,
  subject text NOT NULL,
  wallet text NOT NULL,
  verified boolean NOT NULL,
  ranked_ok boolean NOT NULL,
  score integer NOT NULL,
  kills integer NOT NULL,
  duration_ms integer NOT NULL,
  run_id text NOT NULL,
  PRIMARY KEY (day, subject)
);

CREATE TABLE shard_days (
  day text NOT NULL,
  subject text NOT NULL,
  shards integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject)
);

CREATE TABLE settled_days (
  day text PRIMARY KEY,
  settled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE spoils (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('TRIAL_PRIZE','SHARD_HARVEST')),
  day text NOT NULL,
  subject text NOT NULL,
  amount text NOT NULL,
  rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, day, subject)
);

CREATE TABLE spoil_claims (
  tx_hash text PRIMARY KEY,
  spoil_id text NOT NULL,
  subject text NOT NULL,
  amount text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ubi_claims (
  tx_hash text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  day text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blessings (
  subject text NOT NULL,
  day text NOT NULL,
  PRIMARY KEY (subject, day)
);

CREATE TABLE engagement_claims (
  tx_hash text PRIMARY KEY,
  subject text NOT NULL,
  wallet text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
