import { IDENTITY_CACHE_MAX, IDENTITY_TTL_MS } from "../config.js";

/**
 * How long the last answer may be served when the chain cannot be read. Beyond this a lapsed or revoked
 * verification could stay "verified" for as long as an RPC outage lasts.
 */
export const IDENTITY_STALE_MAX_MS = 30 * 60_000;

/**
 * Maps a wallet to its "subject": the whitelisted root when verified (one human, one slot even
 * across linked wallets), else the wallet itself. Results are cached for `ttlMs`, and at most
 * `maxEntries` wallets are kept: past that, the entry fetched longest ago is dropped.
 *
 * Whether a wallet is verified is the chain's answer and nothing else: `chain.identity()` reports
 * `isWhitelisted` from getWhitelistedRoot(), which the contract only answers for an account that is inside its
 * own re-verification window (reverifyDaysOptions[authCount] days, 1 / 7 / 180 with the default schedule). The
 * `expiresAt` it also carries is our estimate from the LONGEST step, so it can lie far in the future of the real
 * expiry; it is passed on for information and is never an input to `verified`.
 */
export function createIdentityResolver({
  chain,
  db,
  now,
  ttlMs = IDENTITY_TTL_MS,
  maxEntries = IDENTITY_CACHE_MAX,
  staleMaxMs = IDENTITY_STALE_MAX_MS,
}) {
  const cache = new Map();

  function remember(key, info) {
    // A Map iterates in insertion order. Deleting first moves a refreshed key to the back, so the
    // front is always the entry fetched longest ago.
    cache.delete(key);
    cache.set(key, { at: now(), info });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  async function lookup(key) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.info;
    try {
      const info = await chain.identity(key);
      remember(key, info);
      return info;
    } catch (cause) {
      // Serve the last answer rather than lock players out during an RPC blip, but only while it is recent.
      // `hit.at` is when the chain last answered; a failed attempt does not renew it.
      if (hit && now() - hit.at < staleMaxMs) return hit.info;
      const err = new Error("chain unavailable", { cause });
      err.code = "CHAIN_UNAVAILABLE";
      throw err;
    }
  }

  return {
    async resolve(wallet, host) {
      const key = String(wallet).toLowerCase();
      const info = await lookup(key);
      const verified = Boolean(info.isWhitelisted && info.root);
      const subject = verified ? info.root : key;
      const status = verified ? "verified" : info.expired ? "expired" : "unverified";
      await db.query(
        `INSERT INTO users(subject, root) VALUES ($1, $2)
         ON CONFLICT (subject) DO UPDATE SET last_seen = now(), root = COALESCE(EXCLUDED.root, users.root)`,
        [subject, verified ? subject : null],
      );
      await db.query(
        `INSERT INTO wallets(address, subject, host, verified) VALUES ($1, $2, COALESCE($3::text, 'browser'), $4)
         ON CONFLICT (address) DO UPDATE SET subject = $2, host = COALESCE($3::text, wallets.host), verified = $4, last_seen = now()`,
        [key, subject, host ?? null, verified],
      );
      return { wallet: key, subject, verified, root: verified ? subject : null, status, expiresAt: info.expiresAt ?? null };
    },
    invalidate(wallet) {
      cache.delete(String(wallet).toLowerCase());
    },
  };
}
