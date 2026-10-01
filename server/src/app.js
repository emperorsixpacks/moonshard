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
    handler: (_req, res) => res.status(429).json({ error: "rate_limited" }),
  });

/**
 * @param {{db: any, chain: any, config: any, now?: () => number}} deps
 */
export function createApp({ db, chain, config, now = Date.now }) {
  const app = express();
  // Behind N reverse proxies, req.ip is only the real client when Express knows to read it from
  // X-Forwarded-For; otherwise every player shares the proxy's address and the per-IP limiters below
  // would behave as one global limit.
  app.set("trust proxy", config.trustProxy ?? false);
  app.use(cors({ origin: config.corsOrigins === "*" ? true : config.corsOrigins }));
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
