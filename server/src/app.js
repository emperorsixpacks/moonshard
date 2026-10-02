import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GAME } from "../config.js";
import { errorHandler } from "./http.js";
import { createIdentityResolver } from "./identity.js";
import { authRoutes, makeRequireAuth } from "./auth.js";
import { runRoutes } from "./runs.js";
import { leaderboardRoutes } from "./leaderboard.js";
import { spoilsRoutes } from "./spoils.js";
import { ubiRoutes } from "./ubi.js";
import { engagementRoutes } from "./engagement.js";
import { rewardsRoutes } from "./rewards.js";
import { statsRoutes } from "./stats.js";

const perIpLimiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // The wait is in the body, not only in Retry-After: a page on another origin cannot read that header unless it is
    // exposed, and a client that is submitting a finished run needs to know how long to hold on to it.
    handler: (req, res) => {
      const resetAt = req.rateLimit?.resetTime;
      const retryAfterMs = resetAt ? Math.max(1, Math.ceil(resetAt.getTime() - Date.now())) : windowMs;
      res.status(429).json({ error: "rate_limited", retryAfterMs });
    },
  });

/**
 * Which cross-origin callers the browser may let read our responses.
 *  - CORS_ORIGINS set to a list: exactly those origins, in every environment.
 *  - CORS_ORIGINS unset (or containing "*"): in development any origin is reflected, which is what a dev server on
 *    another port needs. With NODE_ENV=production nothing is allowed (no CORS headers at all) rather than every origin
 *    being reflected, and a warning at start-up says to set CORS_ORIGINS.
 * Returns the options for the cors middleware, or null for "no CORS middleware".
 */
function corsOptions(corsOrigins, production) {
  const list = Array.isArray(corsOrigins) ? corsOrigins : [];
  const named = list.filter((origin) => origin !== "*");
  const wildcard = corsOrigins === "*" || list.includes("*");
  if (!production) return { origin: wildcard ? true : named };
  if (named.length > 0) return { origin: named };
  console.warn("[moonshard] CORS_ORIGINS is not set: in production no origin is allowed, so browsers cannot call this API from your site. Set CORS_ORIGINS to your site's origin (comma-separated for several).");
  return null;
}

/**
 * @param {{db: any, chain: any, config: any, now?: () => number, env?: Record<string, string | undefined>}} deps
 *   `env` is where NODE_ENV is read from (process.env by default).
 */
export function createApp({ db, chain, config, now = Date.now, env = process.env }) {
  const app = express();
  app.disable("x-powered-by"); // do not announce the framework
  // Behind N reverse proxies, req.ip is only the real client when Express knows to read it from
  // X-Forwarded-For; otherwise every player shares the proxy's address and the per-IP limiters below
  // would behave as one global limit.
  app.set("trust proxy", config.trustProxy ?? false);
  const corsOpts = corsOptions(config.corsOrigins, env.NODE_ENV === "production");
  if (corsOpts) app.use(cors(corsOpts));
  // After CORS (so a 429 stays readable to a cross-origin page; preflights are answered above and never
  // counted) and before the body parser (so a throttled client costs no JSON parsing).
  if (config.rateLimit?.enabled) {
    const { windowMs, general, auth } = config.rateLimit;
    app.use("/api", perIpLimiter(windowMs, general));
    app.use("/api/auth", perIpLimiter(windowMs, auth));
  }
  app.use(express.json({ limit: "64kb" }));

  const ctx = {
    db,
    chain,
    config,
    now,
    identity: createIdentityResolver({ chain, db, now }),
    voucherAccount: config.voucherSignerKey ? privateKeyToAccount(config.voucherSignerKey) : null,
    appAccount: config.appSignerKey ? privateKeyToAccount(config.appSignerKey) : null,
    requireAuth: null, // set by auth routes (Task 4)
  };

  app.get("/health", (_req, res) => res.json({ ok: true, app: "Moonshard", chainId: config.chainId }));

  const api = express.Router();
  api.get("/config", (_req, res) => {
    res.json({
      appName: "Moonshard",
      chainId: config.chainId,
      token: config.contracts.token,
      ubi: config.contracts.ubi,
      vault: config.contracts.vault || null,
      engagement: { address: config.contracts.engagement, app: ctx.appAccount?.address ?? null },
      prizesG: GAME.PRIZES.map((p) => formatUnits(p, 18)),
      shardRateG: formatUnits(GAME.SHARD_RATE, 18),
      dailyShardCap: GAME.DAILY_SHARD_CAP,
    });
  });
  ctx.requireAuth = makeRequireAuth(ctx);
  api.use(authRoutes(ctx));
  api.use(runRoutes(ctx));
  api.use(leaderboardRoutes(ctx));
  api.use(spoilsRoutes(ctx));
  api.use(ubiRoutes(ctx));
  api.use(engagementRoutes(ctx));
  api.use(rewardsRoutes(ctx));
  api.use(statsRoutes(ctx));
  // ROUTES: later tasks mount their routers here.
  app.use("/api", api);

  app.use(errorHandler);
  return { app, ctx, api };
}
