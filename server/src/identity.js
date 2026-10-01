import { IDENTITY_TTL_MS } from "../config.js";

/**
 * Maps a wallet to its "subject": the whitelisted root when verified (one human, one slot even
 * across linked wallets), else the wallet itself. Results are cached for `ttlMs`.
 */
export function createIdentityResolver({ chain, db, now, ttlMs = IDENTITY_TTL_MS }) {
  const cache = new Map();

  async function lookup(key) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.info;
    try {
      const info = await chain.identity(key);
      cache.set(key, { at: now(), info });
      return info;
    } catch (cause) {
      if (hit) return hit.info; // serve stale rather than lock players out during an RPC blip
      const err = new Error("chain unavailable", { cause });
      err.code = "CHAIN_UNAVAILABLE";
      throw err;
    }
  }

  return {
    async resolve(wallet, host) {
      const key = String(wallet).toLowerCase();
      const info = await lookup(key);
      const live = info.isWhitelisted && (info.expiresAt == null || info.expiresAt > now());
      const verified = Boolean(live && info.root);
      const subject = verified ? info.root : key;
      const status = verified ? "verified" : info.expired || (info.isWhitelisted && !live) ? "expired" : "unverified";
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
