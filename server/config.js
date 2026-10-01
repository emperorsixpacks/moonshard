import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"), quiet: true });

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

/**
 * How many points a human can score, derived from the game's own tables (src/config.js: MOBS, SURVIVAL; and
 * src/scenes/SurvivalScene.js) so that the server's ceiling is a number anyone can recompute, not a guess. Every input
 * is the worst case, all at once, which no real run comes near; server/test/runs.plausibility.test.js reads the client's
 * tables and fails when one of them grows past the value copied here, so the ceiling cannot silently go stale.
 *
 *   per kill, at most   (85 + 40) x 4.0 = 500
 *     85   BASALT_GOLEM, the most valuable regular mob (a boss is a one-off, below).
 *     40   the largest bonus on one kill: a deflected-projectile kill (+40). A snail's ricochet is +50, but a snail
 *          is worth 25, so 25 + 50 stays below 85 + 40. Backstab and stomp add 25, a counter 20.
 *     4.0  MAX_COMBO. The multiplier applies to base + bonus and is reached after 15 kills in a row.
 *   kills a second     2
 *     The arena holds at most 4 foes at once (getMaxConcurrentForWave) and the endless spawner refills it once every
 *     2 s, so over any stretch of time no more than 2 foes a second exist to be killed. (The 12 kills a second in
 *     MAX_KILLS_PER_SEC is the looser limit on a bare count, which Story needs: its foes are placed, not spawned.)
 *   time               + 10 a second (PTS_PER_SECOND)
 *   => 2 x 500 + 10 = 1,010 points a second, sustained. The blanket limit it replaces was 1,500.
 *
 * One-off points that are not part of that rate, allowed once per run (SCORE_BURST_PTS):
 *   - the wave-clear bonus of each of the 5 scripted waves: 100 + 50 x wave + 20 x (30 + 10 x wave - 1) at best
 *     (the speed bonus for clearing in 1 s), 5,900 in all;
 *   - the Survival boss (BOSS_GORGOK, 500 points) killed at the 4.0 combo: (500 + 40) x 4 = 2,160.
 */
const BOSS_PTS = 500;
export const SCORE_MODEL = Object.freeze({
  KILLS_PER_SEC: 2,
  KILL_BASE_PTS_MAX: 85,
  KILL_BONUS_PTS_MAX: 40,
  COMBO_MAX: 4.0,
  TIME_PTS_PER_SEC: 10,
  WAVE_BONUS_PTS_MAX: [0, 1, 2, 3, 4].reduce((sum, wave) => sum + 100 + 50 * wave + 20 * (30 + 10 * wave - 1), 0),
  BOSS_KILL_PTS_MAX: (BOSS_PTS + 40) * 4.0,
});

/** Game-design tunables. Amounts are wei of G$ (18 decimals). */
export const GAME = {
  TICKET_MAX_AGE_MS: 40 * 60_000,
  /** A submit shorter than this is refused outright (invalid_duration). */
  MIN_DURATION_MS: 5_000,
  /**
   * A run is ranked, and credits Shards, only after this much play: on the server's own clock since /runs/start AND in
   * the duration the client claims. Both, so that waiting 30 s and then claiming 5 s of play (or the reverse) counts for
   * nothing. A run under it is accepted onto the open board, unflagged, just not ranked or paid.
   */
  MIN_RANKED_ELAPSED_MS: 30_000,
  /**
   * How far a checkpoint time or a claimed duration may run ahead of the server's clock. An honest client never does:
   * it starts counting when the /runs/start response arrives, after the server handled the request. This only absorbs
   * rounding and clock-rate drift, so it is small: it was 5 s, equal to the old minimum run, which excluded nothing.
   */
  CLOCK_TOLERANCE_MS: 2_000,
  /** Checkpoints are at least this far apart, except for MAX_SHORT_CHECKPOINT_GAPS of them per run (the closing one). */
  MIN_CHECKPOINT_GAP_MS: 2_000,
  MAX_SHORT_CHECKPOINT_GAPS: 1,
  /**
   * The wait between two /runs/start of one player and mode (429 slow_down). Trial: 10 s, because nobody dies in the
   * first 10 s of the arena and a restart is a menu round trip. Story: 3 s, because a hazard at the start can end a
   * life in 3-4 s and the player retries at once; the server cannot tell a death from a restart.
   */
  START_GAP_MS: { TRIAL: 10_000, STORY: 3_000 },
  MAX_PTS_PER_SEC: SCORE_MODEL.KILLS_PER_SEC * (SCORE_MODEL.KILL_BASE_PTS_MAX + SCORE_MODEL.KILL_BONUS_PTS_MAX) * SCORE_MODEL.COMBO_MAX
    + SCORE_MODEL.TIME_PTS_PER_SEC,
  SCORE_BURST_PTS: SCORE_MODEL.WAVE_BONUS_PTS_MAX + SCORE_MODEL.BOSS_KILL_PTS_MAX,
  MAX_KILLS_PER_SEC: 12,
  KILLS_SLACK: 5,
  MAX_SCORE: 100_000_000,
  MAX_CHECKPOINTS: 400,
  MIN_COVERAGE_RANKED: 0.5,
  MIN_COVERAGE_BOSS: 0.8,
  SHARDS_PER_KILL: 2,
  SHARDS_BASE_ALLOWANCE: 20,
  MAX_SHARDS_PER_RUN: 60,
  DAILY_SHARD_CAP: 50,
  SHARD_RATE: G(2),
  PRIZES: [G(1000), G(600), G(300)],
  VOUCHER_TTL_SEC: 7 * 24 * 3600,
  /**
   * What a boss clear needs, in play time (claimed) AND server time. The chapter-1 boss arena opens only after every foe
   * on the level is dead (StoryScene.unsealBossArena) and its gate is 2,310 px from the start at a run speed of 155 px/s:
   * 14.9 s of unobstructed running, before 16 foes and 240 HP of boss. No real clear is under about 40 s, so 30 s is a
   * floor beneath all of them and every legitimate clear stays possible.
   */
  BOSS_MIN: { durationMs: 30_000, kills: 3 },
  ENGAGEMENT_BLOCK_WINDOW: 300n,
  ATTEST_MAX_AGE_MS: 24 * 3600_000,
  // The first-boss bounty is not a constant here: the pool's reward and this app's share of it are read from the
  // chain (see engagement.js), so the UI promises what the player will actually receive.
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
