import express from "express";
import { createPublicClient, http, parseAbi, parseEventLogs, zeroAddress } from "viem";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { engagementAbi } from "./chain.js";
import { assertRunId } from "./runs.js";

const appClaimTypes = {
  AppClaim: [
    { name: "app", type: "address" },
    { name: "user", type: "address" },
    { name: "validUntilBlock", type: "uint256" },
  ],
};

/** The caller's newest cleared boss run that can still be attested, with when it was submitted; null when there is none. */
export async function pendingBossRunInfo(ctx, subject) {
  const since = new Date(ctx.now() - GAME.ATTEST_MAX_AGE_MS);
  const { rows } = await ctx.db.query(
    `SELECT run_id, submitted_at FROM runs WHERE subject = $1 AND mode = 'STORY' AND status = 'submitted'
        AND boss_cleared AND submitted_at > $2 ORDER BY submitted_at DESC LIMIT 1`,
    [subject, since],
  );
  return rows[0] ? { runId: rows[0].run_id, submittedAt: new Date(rows[0].submitted_at).getTime() } : null;
}

export async function pendingBossRun(ctx, subject) {
  return (await pendingBossRunInfo(ctx, subject))?.runId ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// What the first-boss bounty is worth to the player
//
// EngagementRewards pays `rewardAmount` out in three parts (see _sendReward in the contract):
//   userAndInviter = rewardAmount * userAndInviterPercentage / 100
//   user           = userAndInviter * userPercentage / 100            <- what the player receives
//   app            = rewardAmount - userAndInviter, plus the inviter's part when there is no inviter
// Moonshard is registered at 80 / 60 (scripts/register-engagement-app.mjs) and attests with no inviter, so of the
// pool's headline 5,000 G$ the player gets 2,400 G$. The UI must promise that number, so it is read from the chain
// (reward amount and this app's own percentages) rather than written down here where it would go stale.
// ---------------------------------------------------------------------------------------------------------------

const engagementTermsAbi = parseAbi([
  "function rewardAmount() view returns (uint96)",
  // Only the leading fields, which are all fixed-size: the strings (description, url, email) that follow them in the
  // deployed struct are dynamic, so their offsets sit after these in the ABI head and are never needed here.
  "function registeredApps(address) view returns (address owner, address rewardReceiver, uint96 totalRewardsClaimed, uint32 registeredAt, uint32 lastResetAt, uint8 userAndInviterPercentage, uint8 userPercentage, bool isRegistered, bool isApproved)",
]);

/** A read of the terms is believed this long. */
export const ENGAGEMENT_REWARD_TTL_MS = 5 * 60_000;
/** After a failed read, the chain is not asked again for this long. */
export const ENGAGEMENT_REWARD_ERROR_RETRY_MS = 30_000;
/** While the chain cannot be read, the last good value is still shown for this long after it was read. */
export const ENGAGEMENT_REWARD_STALE_MS = 60 * 60_000;

/** The player's share in wei of G$, with the contract's own integer arithmetic. */
export function playerShareWei({ rewardAmount, userAndInviterPercentage, userPercentage }) {
  const userAndInviter = (BigInt(rewardAmount) * BigInt(userAndInviterPercentage)) / 100n;
  return (userAndInviter * BigInt(userPercentage)) / 100n;
}

const wholeG = (wei) => (wei / 10n ** 18n).toString();

/**
 * The player's share of the bounty as a string of whole G$ ("2400"), or null when the app is not registered and
 * approved, or the chain cannot be read. Cached (see the TTL constants above); requests that arrive together share one read.
 *
 * @param {{ client: { readContract: Function }, address: string, app: string, now: () => number,
 *           ttlMs?: number, errorRetryMs?: number, staleMs?: number }} opts
 *   `address` is the EngagementRewards contract and `app` the registered app (the address of APP_SIGNER_KEY).
 */
export function createEngagementReward({
  client, address, app, now,
  ttlMs = ENGAGEMENT_REWARD_TTL_MS,
  errorRetryMs = ENGAGEMENT_REWARD_ERROR_RETRY_MS,
  staleMs = ENGAGEMENT_REWARD_STALE_MS,
}) {
  let good = null; // the last successful read: { value, at }
  let failedAt = null; // when the latest read failed; cleared by a success
  let inflight = null;

  const stale = () => (good && now() - good.at < staleMs ? good.value : null);

  async function read() {
    const [rewardAmount, registered] = await Promise.all([
      client.readContract({ address, abi: engagementTermsAbi, functionName: "rewardAmount" }),
      client.readContract({ address, abi: engagementTermsAbi, functionName: "registeredApps", args: [app] }),
    ]);
    const [, , , , , userAndInviterPercentage, userPercentage, isRegistered, isApproved] = registered;
    // an app GoodDollar has not approved yet cannot pay a claim, so there is no amount to promise
    return isRegistered && isApproved ? wholeG(playerShareWei({ rewardAmount, userAndInviterPercentage, userPercentage })) : null;
  }

  return {
    async get() {
      if (good && now() - good.at < ttlMs) return good.value;
      if (failedAt !== null && now() - failedAt < errorRetryMs) return stale();
      inflight ??= (async () => {
        try {
          const value = await read();
          good = { value, at: now() };
          failedAt = null;
          return value;
        } catch {
          failedAt = now();
          return stale();
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
  };
}

/**
 * What the first-boss bounty pays the player, as whole G$ in a string, or null when unknown (no app signer, app not
 * registered, chain unreadable). Built on first use from the server's config, or injected as `ctx.engagementReward`.
 */
export function engagementRewardG(ctx) {
  if (!ctx.appAccount) return Promise.resolve(null);
  ctx.engagementReward ??= createEngagementReward({
    // one attempt with a short timeout: this is read while a player waits for a status screen
    client: createPublicClient({ transport: http(ctx.config.rpcUrl, { timeout: 5_000, retryCount: 0 }) }),
    address: ctx.config.contracts.engagement,
    app: ctx.appAccount.address,
    now: () => ctx.now(),
  });
  return ctx.engagementReward.get();
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
    const [pending, rewardG] = await Promise.all([pendingBossRunInfo(ctx, p.subject), engagementRewardG(ctx)]);
    res.json({
      configured: Boolean(ctx.appAccount),
      app: ctx.appAccount?.address ?? null,
      claimedHere,
      canClaim: can ? can.ok : null,
      reason: can?.reason ?? null,
      pendingRunId: pending?.runId ?? null,
      // when the pending run stops being attestable, so the client can show a countdown
      attestExpiresAt: pending ? new Date(pending.submittedAt + GAME.ATTEST_MAX_AGE_MS).toISOString() : null,
      // what the player will receive (not the pool's headline reward), whole G$ as a string; null when unknown
      rewardG,
    });
  }));

  r.post("/engagement/attest", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!ctx.appAccount) throw new HttpError(503, "engagement_not_configured");
    if (!p.verified) throw new HttpError(403, "verification_required");

    const runId = assertRunId(req.body?.runId);
    const { rows } = await ctx.db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
    const run = rows[0];
    if (!run || run.subject !== p.subject || run.mode !== "STORY" || run.status !== "submitted" || !run.boss_cleared) {
      throw new HttpError(403, "boss_not_cleared");
    }
    if (ctx.now() - new Date(run.submitted_at).getTime() > GAME.ATTEST_MAX_AGE_MS) throw new HttpError(410, "run_too_old");
    if (await hasEngagementClaim(ctx, p.subject)) throw new HttpError(409, "already_claimed");

    const can = await ctx.chain.canClaimEngagement(ctx.appAccount.address, p.root);
    if (can.ok === null) throw new HttpError(503, "chain_unavailable"); // the node did not answer: not a "no", try again
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
