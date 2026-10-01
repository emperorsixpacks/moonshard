import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, verifyTypedData, zeroAddress } from "viem";
import { makeHarness, ENGAGEMENT } from "./helpers.js";
import { engagementAbi } from "../src/chain.js";

async function clearBoss(h, p) {
  const run = (await h.api.post("/runs/start", { mode: "STORY", chapter: 1 }, { token: p.token })).body;
  h.clock.advance(50_000);
  const pts = [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 }));
  await h.api.post(`/runs/${run.runId}/checkpoints`, { points: pts }, { token: p.token });
  h.clock.advance(10_500);
  const sub = await h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, { token: p.token });
  assert.equal(sub.body.bossCleared, true);
  return run.runId;
}

test("attestation is signed for the right app/user/block and verifies against the contract's domain", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const runId = await clearBoss(h, p);
    const r = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.inviter, zeroAddress);
    assert.equal(r.body.app, h.ctx.appAccount.address);
    assert.equal(BigInt(r.body.validUntilBlock), 1_000n + 300n);
    assert.ok(BigInt(r.body.validUntilBlock) - 1_000n <= 600n);
    const ok = await verifyTypedData({
      address: h.ctx.appAccount.address,
      domain: { name: "EngagementRewards", version: "1.0", chainId: 42220, verifyingContract: ENGAGEMENT },
      types: { AppClaim: [{ name: "app", type: "address" }, { name: "user", type: "address" }, { name: "validUntilBlock", type: "uint256" }] },
      primaryType: "AppClaim",
      message: { app: r.body.app, user: p.account.address, validUntilBlock: BigInt(r.body.validUntilBlock) },
      signature: r.body.appSignature,
    });
    assert.equal(ok, true);
  } finally { await h.close(); }
});

test("no attestation without a cleared boss run, for other players' runs, unverified players, or stale runs", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const q = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    const noRun = await h.api.post("/engagement/attest", { runId: "nope" }, { token: p.token });
    assert.equal(noRun.status, 403);
    assert.equal(noRun.body.error, "boss_not_cleared");

    const runId = await clearBoss(h, p);
    assert.equal((await h.api.post("/engagement/attest", { runId }, { token: q.token })).body.error, "boss_not_cleared");
    assert.equal((await h.api.post("/engagement/attest", { runId }, { token: u.token })).body.error, "verification_required");

    h.clock.advance(25 * 3600_000);
    const stale = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(stale.status, 410);
    assert.equal(stale.body.error, "run_too_old");
  } finally { await h.close(); }
});

test("contract says not claimable (cooldown / unapproved app) -> 409 with the reason, no signature", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const runId = await clearBoss(h, p);
    h.chain.state.engagement = { ok: false, reason: "Claim cooldown not reached" };
    const r = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "not_claimable");
    assert.equal(r.body.reason, "Claim cooldown not reached");
    assert.equal(r.body.appSignature, undefined);
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.canClaim, false);
    assert.equal(st.body.pendingRunId, runId);
  } finally { await h.close(); }
});

test("confirm records a real RewardClaimed event once; a later attest says already_claimed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const runId = await clearBoss(h, p);
    const hash = "0x" + "33".repeat(32);
    const topics = encodeEventTopics({ abi: engagementAbi, eventName: "RewardClaimed", args: { app: h.ctx.appAccount.address, user: p.account.address, inviter: zeroAddress } });
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [1000n, 4000n, 0n]);
    h.chain.state.txs.set(hash, {
      tx: { from: p.account.address, to: ENGAGEMENT, input: "0x" },
      receipt: { status: "success", logs: [{ address: ENGAGEMENT, topics, data, logIndex: 0, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: hash, transactionIndex: 0, removed: false }] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    const r = await h.api.post("/engagement/confirm", { txHash: hash }, { token: p.token });
    assert.equal(r.body.recorded, true);
    assert.equal((await h.api.post("/engagement/confirm", { txHash: hash }, { token: p.token })).body.recorded, false);
    const again = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_claimed");
    const st = await h.api.get("/rewards/status", { token: p.token });
    assert.equal(st.body.firstBossClaimed, true);
  } finally { await h.close(); }
});

test("engagement endpoints degrade cleanly when the app signer is not configured", async () => {
  const h = await makeHarness({ config: { appSignerKey: "" } });
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.configured, false);
    const r = await h.api.post("/engagement/attest", { runId: "x" }, { token: p.token });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "engagement_not_configured");
  } finally { await h.close(); }
});
