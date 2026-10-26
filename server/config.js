import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"), quiet: true });

const env = process.env;
const num = (v, d) => (v == null || v === "" ? d : Number(v));
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);

/**
 * CORS_ORIGINS -> the origins allowed to read the API's answers. A browser sends Origin without a trailing slash, so
 * "https://site.example/" pasted from an address bar would match nothing and silently block the whole site.
 */
export function parseCorsOrigins(v) {
  return list(v)?.map((origin) => origin.replace(/\/+$/, "")) ?? null;
}
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

/**
 * RATE_LIMIT_PER_MIN -> the per-IP request budget for /api. Players behind one public address (a mobile carrier, a school, a
 * household) share it, and one active player costs about 14 requests a minute, so a launch with shared addresses may need
 * more than the default. Anything that is not a number of at least 1 keeps the default.
 */
export function parseRateLimitPerMinute(v, fallback = 300) {
  const n = num(v, fallback);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/**
 * PRIZES_ENABLED -> whether the game pays prizes from the vault: the daily top 3 and the Shard Harvest. Off unless it says
 * so ("true", "1", "yes" or "on"): the owner's decision (2026-10-02) is no prizes until the game has players, and paying
 * them needs a funded vault (docs/DEPLOY.md). The daily G$ claim (GoodDollar's), the first-boss bounty (GoodDollar's pool)
 * and the Moon Shop (payments INTO the vault) are not prizes and work either way.
 */
export function parsePrizesEnabled(v) {
  return /^(true|1|yes|on)$/i.test(String(v ?? "").trim());
}

/** Whether this server pays prizes. A config object that does not say (one built by hand, in a test) pays them. */
export const prizesOn = (config) => config?.prizesEnabled !== false;

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
 *     The arena holds at most 4 foes at once (SURVIVAL.LEVELS.MAX_CONCURRENT) and refills only as they die: a replacement
 *     appears after a 0.35 s warning, a swing takes 0.32 s, and a foe takes more than one. No human sustains more than 2
 *     kills a second. (The 12 kills a second in MAX_KILLS_PER_SEC is the looser limit on a bare count, which Story needs:
 *     its foes are placed, not spawned.)
 *   time               + 10 a second (PTS_PER_SECOND)
 *   level clears       + 139 a second
 *     Endless is a ladder of levels (src/engine/levels.js): after the 5 scripted waves each level pays for clearing it, at
 *     most 100 + 50 x 10 as the base, which stops climbing at the 10th step, and 10 for each of the 79 seconds a clear can
 *     beat the longest par time (80 s) by: 1,390. A level has at least 20 foes, so at 2 kills a second it takes at least
 *     10 s, and 1,390 / 10 = 139 a second.
 *   boss levels        + 34 a second
 *     Every 5th level has a boss, a kill worth (500 + 40) x 4.0 = 2,160 at the 4.0 combo. The kill rate above already
 *     allows 500 for any kill, so a boss adds 1,660, once in the at least 5 x 10 = 50 s that 5 levels take: 33.2 a second.
 *   => 2 x 500 + 10 + 139 + 34 = 1,183 points a second, sustained. The blanket limit it replaces was 1,500.
 *
 * One-off points that are not part of that rate, allowed once per run (SCORE_BURST_PTS):
 *   - the wave-clear bonus of each of the 5 scripted waves: 100 + 50 x wave + 20 x (30 + 10 x wave - 1) at best
 *     (the speed bonus for clearing in 1 s), 5,900 in all;
 *   - the Survival boss (BOSS_GORGOK, 500 points) killed at the 4.0 combo: (500 + 40) x 4 = 2,160.
 * Those are the first five levels and the first boss. The levels and bosses after them are inside the rate above.
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
  // Endless levels after the scripted waves. Inputs copied from src/config.js SURVIVAL.LEVELS and src/engine/levels.js.
  LEVEL_MIN_FOES: 20,
  LEVEL_CLEAR_PTS_MAX: 100 + 50 * 10 + (80 - 1) * 10,
  BOSS_EVERY: 5,
});

/** The most a kill is worth: SCORE_MODEL.KILL_*_PTS_MAX at the top combo. */
const KILL_PTS_MAX = (SCORE_MODEL.KILL_BASE_PTS_MAX + SCORE_MODEL.KILL_BONUS_PTS_MAX) * SCORE_MODEL.COMBO_MAX;
/** The least time a built level takes: its fewest foes at the most kills a second. */
const LEVEL_MIN_SECONDS = SCORE_MODEL.LEVEL_MIN_FOES / SCORE_MODEL.KILLS_PER_SEC;
/** What the level terms add to the sustained rate, a second (see above), rounded up. */
export const LEVEL_PTS_PER_SEC = Math.ceil(SCORE_MODEL.LEVEL_CLEAR_PTS_MAX / LEVEL_MIN_SECONDS);
export const BOSS_LEVEL_PTS_PER_SEC = Math.ceil((SCORE_MODEL.BOSS_KILL_PTS_MAX - KILL_PTS_MAX) / (SCORE_MODEL.BOSS_EVERY * LEVEL_MIN_SECONDS));

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
   * The wait between two /runs/start of one player and mode (429 slow_down); the server cannot tell a death from a
   * restart, so each wait is the shortest one that no honest restart is shorter than.
   *   Trial 10 s. A Survival run ends at the first death and an idle player is not first hit before about 6 s (the
   *   boars of wave 1 charge from 3.2 s) and needs five hits, 1.2 s apart, to die: no Trial ends before about 10 s,
   *   and the next one is a menu round trip further on.
   *   Story 3 s. A Story life can end within seconds (a fall or a hazard near the start) and the player retries at
   *   once, so it is shorter than any life that gets as far as the 5 s a submit needs. It still caps starts at 20 a
   *   minute per player.
   */
  START_GAP_MS: { TRIAL: 10_000, STORY: 3_000 },
  MAX_PTS_PER_SEC: SCORE_MODEL.KILLS_PER_SEC * KILL_PTS_MAX + SCORE_MODEL.TIME_PTS_PER_SEC + LEVEL_PTS_PER_SEC + BOSS_LEVEL_PTS_PER_SEC,
  SCORE_BURST_PTS: SCORE_MODEL.WAVE_BONUS_PTS_MAX + SCORE_MODEL.BOSS_KILL_PTS_MAX,
  MAX_KILLS_PER_SEC: 12,
  KILLS_SLACK: 5,
  /**
   * Endless levels (levels.js). A run reports the level it ended on, 1 to MAX; it cannot be deeper than the kills allow, at
   * MIN_FOES_PER_LEVEL a level (the hand-built first wave has 15 foes, no level after it has fewer), and the kills it can count
   * are bounded by its time (SCORE_MODEL.KILLS_PER_SEC a second). That makes a made-up level cost real waiting, not impossible.
   */
  LEVELS: { MAX: 1_000, MIN_FOES_PER_LEVEL: 15 },
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
   * 14.9 s of unobstructed running, then about forty swings (320 ms each) for sixteen foes, seven more for the boss's
   * 240 HP and its intro. On paper nothing clears faster than about 35 s and real play is slower, so 30 s is a floor
   * beneath every legitimate clear: they all stay possible, and the figure is the one already in force.
   */
  BOSS_MIN: { durationMs: 30_000, kills: 3 },
  ENGAGEMENT_BLOCK_WINDOW: 300n,
  ATTEST_MAX_AGE_MS: 24 * 3600_000,
  // The first-boss bounty is not a constant here: the pool's reward and this app's share of it are read from the
  // chain (see engagement.js), so the UI promises what the player will actually receive.
  /**
   * The Moon Shop: what G$ buys. Every purchase is a G$ transfer from the player to the prize vault, so what players spend
   * goes back to the players who top the leaderboard. Open only when VAULT_ADDRESS is set (see shop.js).
   *   blade     the blade a hero fights with. No run starts without it: buying it is the last step before play.
   *   forge     the fee for forging a stronger blade, or a piece of armour. Its forest materials are earned in play: G$ alone
   *             forges nothing.
   *   cosmetic  looks only. A Celestial blade has exactly the Glaive's power and needs the Glaive first, so it is a new
   *             look for power already earned; skins and the pet change nothing in a fight.
   * `requires`: an item that must be owned first. Listed before the items that require it.
   * `minLevel`: the Endless level that must have been reached first, in a ranked run (levels.js bestLevel). The blades past
   *             the Glaive, and every piece of armour past the first tier, ask for one, so they are earned in the arena as well
   *             as paid for: G$ cannot buy the way past a level.
   *             Paying early loses nothing: the payment is kept and counts once the level is reached, as with `requires`.
   *             The prices are the owner's to set; the materials and levels are src/config.js WEAPONS and ARMOUR (an agreement
   *             test keeps the two in step).
   */
  SHOP: [
    { id: "iron_starter", name: "Rusted Shortsword", kind: "blade", price: G(20) },
    { id: "iron_broadsword", name: "Iron Broadsword", kind: "forge", price: G(30) },
    { id: "forest_glaive", name: "Forest Glaive", kind: "forge", price: G(60) },
    { id: "moonsteel_blade", name: "Moonsteel Blade", kind: "forge", price: G(100), requires: "forest_glaive", minLevel: 8 },
    { id: "starforged_edge", name: "Starforged Edge", kind: "forge", price: G(160), requires: "moonsteel_blade", minLevel: 15 },
    { id: "cinderbrand", name: "Cinderbrand", kind: "forge", price: G(200), requires: "starforged_edge", minLevel: 20 },
    { id: "voidglass_reaver", name: "Voidglass Reaver", kind: "forge", price: G(240), requires: "cinderbrand", minLevel: 25 },
    { id: "leather_cap", name: "Leather Cap", kind: "forge", price: G(15) },
    { id: "chitin_helm", name: "Chitin Helm", kind: "forge", price: G(50), requires: "leather_cap", minLevel: 8 },
    { id: "wardens_helm", name: "Warden's Helm", kind: "forge", price: G(80), requires: "chitin_helm", minLevel: 15 },
    { id: "cinder_helm", name: "Cinder Helm", kind: "forge", price: G(100), requires: "wardens_helm", minLevel: 20 },
    { id: "moonborn_crown", name: "Moonborn Crown", kind: "forge", price: G(120), requires: "cinder_helm", minLevel: 25 },
    { id: "oak_buckler", name: "Oak Buckler", kind: "forge", price: G(15) },
    { id: "honeycomb_shield", name: "Honeycomb Shield", kind: "forge", price: G(50), requires: "oak_buckler", minLevel: 8 },
    { id: "bone_bulwark", name: "Bone Bulwark", kind: "forge", price: G(80), requires: "honeycomb_shield", minLevel: 15 },
    { id: "obsidian_aegis", name: "Obsidian Aegis", kind: "forge", price: G(100), requires: "bone_bulwark", minLevel: 20 },
    { id: "lunar_bastion", name: "Lunar Bastion", kind: "forge", price: G(120), requires: "obsidian_aegis", minLevel: 25 },
    { id: "golden_albatross", name: "Golden Solar Blade", kind: "cosmetic", price: G(150), requires: "forest_glaive" },
    { id: "corrupted_void", name: "Corrupted Void Edge", kind: "cosmetic", price: G(150), requires: "forest_glaive" },
    { id: "skin_flame", name: "Crimson Flame Katana", kind: "cosmetic", price: G(100) },
    { id: "skin_frost", name: "Frostmoon Crystal Saber", kind: "cosmetic", price: G(100) },
    { id: "skin_verdant", name: "Verdant Jade Rapier", kind: "cosmetic", price: G(100) },
    { id: "satchel_pet", name: "Moon Sprite", kind: "cosmetic", price: G(80) },
  ],
  /**
   * Referrals (referrals.js). A friend is recorded as invited only while they are new: first seen by this server within
   * NEW_PLAYER_DAYS, with no blade bought and no run started, so a link cannot claim someone who is already playing.
   * A referrer's list shows their latest RECENT_LIMIT friends; the counts above it cover all of them.
   */
  REFERRALS: { NEW_PLAYER_DAYS: 7, RECENT_LIMIT: 50 },
};

export const config = {
  port: num(env.PORT, 3001),
  jwtSecret: env.JWT_SECRET || "",
  corsOrigins: parseCorsOrigins(env.CORS_ORIGINS) || "*",
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  /** Per-IP request budgets: `general` for all of /api, `auth` (additionally) for /api/auth/*. */
  rateLimit: { enabled: true, windowMs: 60_000, general: parseRateLimitPerMinute(env.RATE_LIMIT_PER_MIN), auth: 30 },
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
  prizesEnabled: parsePrizesEnabled(env.PRIZES_ENABLED),
};
