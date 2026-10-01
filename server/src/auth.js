import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { isAddress } from "viem";
import { JWT_TTL_SEC, NONCE_TTL_MS } from "../config.js";
import { HttpError, ah } from "./http.js";

export const loginMessage = (nonce, issuedAt) => `Moonshard login\nNonce: ${nonce}\nIssued: ${issuedAt}`;

const MESSAGE_RE = /^Moonshard login\nNonce: ([0-9a-f]{64})\nIssued: (\S+)$/;
const HOSTS = new Set(["goodwallet", "browser"]);

export const REFRESH_COOLDOWN_MS = 5_000;
export const REFRESH_COOLDOWN_MAX_ENTRIES = 1_000;

/**
 * Per-key cooldown with bounded memory (used by /me/refresh). `tryAcquire(key)` admits the call and
 * starts the key's cooldown, unless the key was admitted less than `cooldownMs` ago.
 *
 * An entry only matters for `cooldownMs`, so once the map holds more than `maxEntries` the expired
 * ones are swept. Entries still inside their window are never dropped: they are what enforces the
 * cooldown. `store` is injectable so a test can look at it.
 */
export function createRefreshCooldown({
  now,
  cooldownMs = REFRESH_COOLDOWN_MS,
  maxEntries = REFRESH_COOLDOWN_MAX_ENTRIES,
  store = new Map(),
}) {
  return {
    tryAcquire(key) {
      const t = now();
      const last = store.get(key);
      if (last !== undefined && t - last < cooldownMs) return false;
      // Delete first so the Map's insertion order is admission order, oldest first ...
      store.delete(key);
      store.set(key, t);
      if (store.size > maxEntries) {
        // ... which lets the sweep stop at the first entry that is still inside its window.
        for (const [k, at] of store) {
          if (t - at < cooldownMs) break;
          store.delete(k);
        }
      }
      return true;
    },
  };
}

export function makeRequireAuth(ctx) {
  return ah(async (req, _res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new HttpError(401, "unauthorized");
    let claims;
    try {
      claims = jwt.verify(token, ctx.config.jwtSecret);
    } catch {
      throw new HttpError(401, "invalid_session");
    }
    req.player = await ctx.identity.resolve(claims.sub, claims.host);
    next();
  });
}

export function authRoutes(ctx) {
  const r = express.Router();

  r.get("/auth/nonce", ah(async (_req, res) => {
    const nonce = crypto.randomBytes(32).toString("hex");
    const now = ctx.now();
    await ctx.db.query("DELETE FROM nonces WHERE expires_at < $1", [new Date(now)]);
    await ctx.db.query("INSERT INTO nonces(nonce, expires_at) VALUES ($1, $2)", [nonce, new Date(now + NONCE_TTL_MS)]);
    res.json({ nonce, issuedAt: new Date(now).toISOString(), expiresAt: now + NONCE_TTL_MS });
  }));

  r.post("/auth/verify", ah(async (req, res) => {
    const { address, message, signature } = req.body || {};
    const host = HOSTS.has(req.body?.host) ? req.body.host : "browser";
    if (typeof address !== "string" || !isAddress(address)) throw new HttpError(400, "bad_address");

    const m = MESSAGE_RE.exec(String(message || ""));
    if (!m) throw new HttpError(401, "message_mismatch");
    const [, nonce, issuedAt] = m;

    const used = await ctx.db.query(
      "DELETE FROM nonces WHERE nonce = $1 AND expires_at > $2 RETURNING nonce",
      [nonce, new Date(ctx.now())],
    );
    if (used.rows.length === 0) throw new HttpError(401, "invalid_nonce");

    const issued = Date.parse(issuedAt);
    const age = ctx.now() - issued;
    if (!Number.isFinite(issued) || age > NONCE_TTL_MS || age < -60_000) throw new HttpError(401, "stale_message");

    let ok = false;
    try {
      ok = await ctx.chain.verifySignature(address, message, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(401, "invalid_signature");

    const player = await ctx.identity.resolve(address, host);
    const token = jwt.sign({ sub: player.wallet, host }, ctx.config.jwtSecret, { expiresIn: JWT_TTL_SEC });
    res.json({
      token,
      address: player.wallet,
      verified: player.verified,
      status: player.status,
      expiresAt: player.expiresAt,
    });
  }));

  const meShape = (p) => ({ address: p.wallet, subject: p.subject, verified: p.verified, status: p.status, expiresAt: p.expiresAt });

  r.get("/me", ctx.requireAuth, (req, res) => res.json(meShape(req.player)));

  // Drops the identity cache so a player who just finished face verification is recognised at once.
  const refreshCooldown = createRefreshCooldown({ now: () => ctx.now() });
  r.post("/me/refresh", ctx.requireAuth, ah(async (req, res) => {
    const wallet = req.player.wallet;
    if (!refreshCooldown.tryAcquire(wallet)) throw new HttpError(429, "slow_down");
    ctx.identity.invalidate(wallet);
    res.json(meShape(await ctx.identity.resolve(wallet)));
  }));

  return r;
}
