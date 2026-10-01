import express from "express";
import { parseEventLogs, zeroAddress } from "viem";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { engagementAbi } from "./chain.js";

const appClaimTypes = {
  AppClaim: [
    { name: "app", type: "address" },
    { name: "user", type: "address" },
    { name: "validUntilBlock", type: "uint256" },
  ],
};

export async function pendingBossRun(ctx, subject) {
  const since = new Date(ctx.now() - GAME.ATTEST_MAX_AGE_MS);
  const { rows } = await ctx.db.query(
    `SELECT run_id FROM runs WHERE subject = $1 AND mode = 'STORY' AND status = 'submitted'
        AND boss_cleared AND submitted_at > $2 ORDER BY submitted_at DESC LIMIT 1`,
    [subject, since],
  );
  return rows[0]?.run_id ?? null;
}

export async function hasEngagementClaim(ctx, subject) {
  const { rows } = await ctx.db.query("SELECT 1 FROM engagement_claims WHERE subject = $1 LIMIT 1", [subject]);
  return rows.length > 0;
}

export function engagementRoutes(ctx) {
  const r = express.Router();

  r.get("/engagement/status", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const claimedHere = await hasEngagementClaim(ctx, p.subject);
    let can = null;
    if (ctx.appAccount && p.verified && !claimedHere) can = await ctx.chain.canClaimEngagement(ctx.appAccount.address, p.root);
    res.json({
      configured: Boolean(ctx.appAccount),
      app: ctx.appAccount?.address ?? null,
      claimedHere,
      canClaim: can ? can.ok : null,
      reason: can?.reason ?? null,
      pendingRunId: await pendingBossRun(ctx, p.subject),
      rewardG: GAME.ENGAGEMENT_REWARD_G,
    });
  }));

  r.post("/engagement/attest", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!ctx.appAccount) throw new HttpError(503, "engagement_not_configured");
    if (!p.verified) throw new HttpError(403, "verification_required");

    const runId = String(req.body?.runId || "");
    const { rows } = await ctx.db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
    const run = rows[0];
    if (!run || run.subject !== p.subject || run.mode !== "STORY" || run.status !== "submitted" || !run.boss_cleared) {
      throw new HttpError(403, "boss_not_cleared");
    }
    if (ctx.now() - new Date(run.submitted_at).getTime() > GAME.ATTEST_MAX_AGE_MS) throw new HttpError(410, "run_too_old");
    if (await hasEngagementClaim(ctx, p.subject)) throw new HttpError(409, "already_claimed");

    const can = await ctx.chain.canClaimEngagement(ctx.appAccount.address, p.root);
    if (!can.ok) throw new HttpError(409, "not_claimable", { reason: can.reason });

    const validUntilBlock = (await ctx.chain.blockNumber()) + GAME.ENGAGEMENT_BLOCK_WINDOW;
    const appSignature = await ctx.appAccount.signTypedData({
      domain: {
        name: "EngagementRewards",
        version: "1.0",
        chainId: ctx.config.chainId,
        verifyingContract: ctx.config.contracts.engagement,
      },
      types: appClaimTypes,
      primaryType: "AppClaim",
      message: { app: ctx.appAccount.address, user: p.wallet, validUntilBlock },
    });
    res.json({
      app: ctx.appAccount.address,
      user: p.wallet,
      inviter: zeroAddress,
      validUntilBlock: validUntilBlock.toString(),
      appSignature,
    });
  }));

  r.post("/engagement/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!ctx.appAccount) throw new HttpError(503, "engagement_not_configured");
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");
    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    if (found.receipt.status !== "success") throw new HttpError(422, "tx_failed");

    const engagement = ctx.config.contracts.engagement.toLowerCase();
    const logs = parseEventLogs({ abi: engagementAbi, eventName: "RewardClaimed", logs: found.receipt.logs })
      .filter((l) => l.address.toLowerCase() === engagement && l.args.app.toLowerCase() === ctx.appAccount.address.toLowerCase());
    let recorded = false;
    for (const log of logs) {
      const user = log.args.user.toLowerCase();
      const own = await ctx.db.query("SELECT 1 FROM wallets WHERE address = $1 AND subject = $2", [user, p.subject]);
      if (own.rows.length === 0) continue;
      const ins = await ctx.db.query(
        "INSERT INTO engagement_claims(tx_hash, subject, wallet) VALUES ($1,$2,$3) ON CONFLICT (tx_hash) DO NOTHING RETURNING tx_hash",
        [hash, p.subject, user],
      );
      recorded = recorded || ins.rows.length > 0;
    }
    res.json({ ok: true, recorded });
  }));

  return r;
}
