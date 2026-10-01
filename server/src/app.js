import express from "express";
import cors from "cors";
import { formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GAME } from "../config.js";
import { errorHandler } from "./http.js";
import { createIdentityResolver } from "./identity.js";

/**
 * @param {{db: any, chain: any, config: any, now?: () => number}} deps
 */
export function createApp({ db, chain, config, now = Date.now }) {
  const app = express();
  app.use(cors({ origin: config.corsOrigins === "*" ? true : config.corsOrigins }));
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
  // ROUTES: later tasks mount their routers here.
  app.use("/api", api);

  app.use(errorHandler);
  return { app, ctx, api };
}
