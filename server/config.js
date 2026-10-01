import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });

const env = process.env;
const num = (v, d) => (v == null || v === "" ? d : Number(v));
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const G = (n) => BigInt(n) * 10n ** 18n;

/**
 * TRUST_PROXY -> what Express's "trust proxy" setting expects: a hop count (default 1: one reverse proxy
 * in front of the API), a boolean, or a comma-separated address/subnet list. The raw string "1" would be
 * read by Express as an IP address, so counts must become numbers. Never use `true` in production: it
 * trusts the left-most X-Forwarded-For entry, which any client can set to dodge the rate limiter.
 */
export function parseTrustProxy(v) {
  if (v == null || String(v).trim() === "") return 1;
  const s = String(v).trim();
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

export const JWT_TTL_SEC = 12 * 60 * 60;
export const NONCE_TTL_MS = 5 * 60_000;
export const IDENTITY_TTL_MS = 5 * 60_000;
export const IDENTITY_CACHE_MAX = 5_000;

/** Game-design tunables. Amounts are wei of G$ (18 decimals). */
export const GAME = {
  TICKET_MAX_AGE_MS: 40 * 60_000,
  MIN_DURATION_MS: 5_000,
  CLOCK_TOLERANCE_MS: 5_000,
  MAX_PTS_PER_SEC: 1_500,
  MAX_KILLS_PER_SEC: 12,
  MAX_SCORE: 100_000_000,
  MAX_CHECKPOINTS: 400,
  CHECKPOINT_SLACK_PTS: 300,
  MIN_COVERAGE_RANKED: 0.5,
  MIN_COVERAGE_BOSS: 0.8,
  SHARDS_PER_KILL: 2,
  SHARDS_BASE_ALLOWANCE: 20,
  MAX_SHARDS_PER_RUN: 60,
  DAILY_SHARD_CAP: 50,
  SHARD_RATE: G(2),
  PRIZES: [G(1000), G(600), G(300)],
  VOUCHER_TTL_SEC: 7 * 24 * 3600,
  BOSS_MIN: { durationMs: 30_000, kills: 3 },
  ENGAGEMENT_BLOCK_WINDOW: 300n,
  ATTEST_MAX_AGE_MS: 24 * 3600_000,
  ENGAGEMENT_REWARD_G: "5000", // informational: what the protocol pool pays today (read on-chain 2026-10-01)
};

export const config = {
  port: num(env.PORT, 3001),
  jwtSecret: env.JWT_SECRET || "",
  corsOrigins: list(env.CORS_ORIGINS) || "*",
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  /** Per-IP request budgets: `general` for all of /api, `auth` (additionally) for /api/auth/*. */
  rateLimit: { enabled: true, windowMs: 60_000, general: 300, auth: 30 },
  databaseUrl: env.DATABASE_URL || "",
  rpcUrl: env.CELO_RPC_URL || "https://forno.celo.org",
  chainId: num(env.CHAIN_ID, 42220),
  contracts: {
    identity: env.IDENTITY_ADDRESS || "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
    ubi: env.UBI_ADDRESS || "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1",
    token: env.GD_TOKEN_ADDRESS || "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    engagement: env.ENGAGEMENT_ADDRESS || "0x25db74CF4E7BA120526fd87e159CF656d94bAE43",
    vault: env.VAULT_ADDRESS || "",
  },
  voucherSignerKey: env.VOUCHER_SIGNER_KEY || "",
  appSignerKey: env.APP_SIGNER_KEY || "",
};
