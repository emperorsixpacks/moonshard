import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { decodeFunctionData, encodeFunctionResult, parseAbi, zeroAddress } from "viem";
import { ENGAGEMENT, fakeEngagementRpc, makeHarness } from "./helpers.js";
import { createEngagementReward, playerShareWei } from "../src/engagement.js";

// The bounty a player is promised is what the player RECEIVES. EngagementRewards pays rewardAmount out three ways:
//   userAndInviter = rewardAmount * userAndInviterPercentage / 100
//   user           = userAndInviter * userPercentage / 100
//   app (the rest, and the inviter's share when there is no inviter)
// This app is registered at 80 / 60 and the pool pays 5,000 G$, so the player gets 2,400 G$, not the headline 5,000.
// Break caught: /engagement/status and /rewards/status both said 5,000 (a constant), so the UI promised more than twice
// what the claim pays.

const G = (n) => BigInt(n) * 10n ** 18n;
const MINUTE = 60_000;

async function clearBoss(h, p) {
  const run = (await h.api.post("/runs/start", { mode: "STORY", chapter: 1 }, { token: p.token })).body;
  h.clock.advance(50_000);
  const pts = [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 }));
  await h.api.post(`/runs/${run.runId}/checkpoints`, { points: pts }, { token: p.token });
  h.clock.advance(10_500);
  const sub = await h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, { token: p.token });
  assert.equal(sub.body.bossCleared, true, JSON.stringify(sub.body));
  return run.runId;
}

// --- the arithmetic ----------------------------------------------------------------------------------------------

test("playerShareWei is the contract's own integer arithmetic", () => {
  const want = (reward, uaip, up) => ((reward * BigInt(uaip)) / 100n * BigInt(up)) / 100n; // _sendReward, line for line
  assert.equal(playerShareWei({ rewardAmount: G(5000), userAndInviterPercentage: 80, userPercentage: 60 }), G(2400));
  for (const [reward, uaip, up] of [
    [12_345_678_901_234_567_890_123n, 80, 60],
    [G(1001), 80, 60],
    [G(5000), 100, 100],
    [G(5000), 100, 0],
    [G(5000), 0, 100],
    [G(5000), 33, 33],
    [1n, 80, 60],
    [0n, 80, 60],
  ]) {
    assert.equal(playerShareWei({ rewardAmount: reward, userAndInviterPercentage: uaip, userPercentage: up }), want(reward, uaip, up), `${reward} ${uaip}/${up}`);
  }
});

// --- what the endpoints say --------------------------------------------------------------------------------------

test("/engagement/status and /rewards/status report the player's share, 2,400 of the 5,000", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal(st.body.rewardG, "2400");
    assert.equal(typeof st.body.rewardG, "string");
    const rw = await h.api.get("/rewards/status", { token: p.token });
    assert.equal(rw.body.firstBossPrizeG, 2400, "the same value, as the number the leaderboard prints");
    // the protocol's headline number is nowhere in either answer
    assert.equal(JSON.stringify([st.body, rw.body]).includes("5000"), false);
  } finally { await h.close(); }
});

test("the terms are read from the chain for THIS app: a different split or reward changes the answer", async () => {
  const h = await makeHarness({ engagementRpc: fakeEngagementRpc({ rewardAmount: G(1000), userAndInviterPercentage: 50, userPercentage: 50 }) });
  try {
    const p = await h.newPlayer({ verified: true });
    assert.equal((await h.api.get("/engagement/status", { token: p.token })).body.rewardG, "250");
    assert.deepEqual(h.engagementRpc.state.appsAsked, [h.ctx.appAccount.address.toLowerCase()], "registeredApps was asked about the app signer");
  } finally { await h.close(); }
});

test("a share with a fraction is floored to whole G$, never rounded up", async () => {
  const h = await makeHarness({ engagementRpc: fakeEngagementRpc({ rewardAmount: G(1001), userAndInviterPercentage: 80, userPercentage: 60 }) });
  try {
    const p = await h.newPlayer({ verified: true });
    assert.equal((await h.api.get("/engagement/status", { token: p.token })).body.rewardG, "480"); // 480.48
  } finally { await h.close(); }
});

test("an app that is not registered has no reward to promise: rewardG and firstBossPrizeG are null", async () => {
  const h = await makeHarness({ engagementRpc: fakeEngagementRpc({ isRegistered: false }) });
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.rewardG, null);
    assert.equal((await h.api.get("/rewards/status", { token: p.token })).body.firstBossPrizeG, null);
  } finally { await h.close(); }
});

test("a registered app that is not approved yet still has a known share (canClaim carries the 'not approved' reason)", async () => {
  const h = await makeHarness({ engagementRpc: fakeEngagementRpc({ isApproved: false }) });
  try {
    const p = await h.newPlayer({ verified: true });
    assert.equal((await h.api.get("/engagement/status", { token: p.token })).body.rewardG, "2400");
  } finally { await h.close(); }
});

test("without an app signer there is no app to ask about: rewardG is null and the chain is not read", async () => {
  const h = await makeHarness({ config: { appSignerKey: "" } });
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.configured, false);
    assert.equal(st.body.rewardG, null);
    assert.equal((await h.api.get("/rewards/status", { token: p.token })).body.firstBossPrizeG, null);
    assert.deepEqual(h.engagementRpc.state.reads, { rewardAmount: 0, registeredApps: 0 });
  } finally { await h.close(); }
});

// --- caching -----------------------------------------------------------------------------------------------------

test("the terms are cached for five minutes, by both endpoints together", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const { state } = h.engagementRpc;
    const both = async () => [
      (await h.api.get("/engagement/status", { token: p.token })).body.rewardG,
      (await h.api.get("/rewards/status", { token: p.token })).body.firstBossPrizeG,
    ];
    assert.deepEqual(await both(), ["2400", 2400]);
    assert.deepEqual(state.reads, { rewardAmount: 1, registeredApps: 1 });

    h.clock.advance(5 * MINUTE - 1);
    await both();
    assert.deepEqual(state.reads, { rewardAmount: 1, registeredApps: 1 }, "still cached a millisecond before five minutes");

    // GoodDollar changes the pool's reward; the new value shows up once the cache has expired, not before
    state.rewardAmount = G(6000);
    assert.deepEqual(await both(), ["2400", 2400]);
    h.clock.advance(1);
    assert.deepEqual(await both(), ["2880", 2880]);
    assert.deepEqual(state.reads, { rewardAmount: 2, registeredApps: 2 });
  } finally { await h.close(); }
});

test("requests that arrive together share one read", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const answers = await Promise.all(Array.from({ length: 8 }, () => h.api.get("/engagement/status", { token: p.token })));
    assert.ok(answers.every((a) => a.body.rewardG === "2400"));
    assert.deepEqual(h.engagementRpc.state.reads, { rewardAmount: 1, registeredApps: 1 });
  } finally { await h.close(); }
});

test("'not registered' is cached too, so a missing app does not cost an RPC call per request", async () => {
  const h = await makeHarness({ engagementRpc: fakeEngagementRpc({ isRegistered: false }) });
  try {
    const p = await h.newPlayer({ verified: true });
    for (let i = 0; i < 5; i++) await h.api.get("/engagement/status", { token: p.token });
    assert.equal(h.engagementRpc.state.reads.registeredApps, 1);
    // the app is registered; it is noticed once the cache expires
    Object.assign(h.engagementRpc.state, { isRegistered: true });
    h.clock.advance(5 * MINUTE);
    assert.equal((await h.api.get("/engagement/status", { token: p.token })).body.rewardG, "2400");
  } finally { await h.close(); }
});

test("an unreadable chain gives null, is retried at most every 30 s, and recovers", async () => {
  const h = await makeHarness({ engagementRpc: fakeEngagementRpc({ fail: true }) });
  try {
    const p = await h.newPlayer({ verified: true });
    const { state } = h.engagementRpc;
    const calls = () => state.reads.rewardAmount + state.reads.registeredApps; // nothing is counted for a failed call
    const status = async () => (await h.api.get("/engagement/status", { token: p.token })).body;

    const down = await status();
    assert.equal(down.rewardG, null);
    assert.equal(down.configured, true, "the rest of the answer is unaffected");
    assert.equal(calls(), 0);

    state.fail = false;
    assert.equal((await status()).rewardG, null, "inside the 30 s the failure is remembered: no new attempt");
    assert.equal(calls(), 0);

    h.clock.advance(30_000);
    assert.equal((await status()).rewardG, "2400", "after 30 s it asks again and gets the answer");
    assert.equal(calls(), 2);
  } finally { await h.close(); }
});

test("a good value is kept while the chain is unreadable, for up to an hour", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const { state } = h.engagementRpc;
    const rewardG = async () => (await h.api.get("/engagement/status", { token: p.token })).body.rewardG;
    assert.equal(await rewardG(), "2400");

    state.fail = true;
    h.clock.advance(6 * MINUTE); // expired: it asks, fails, and keeps the last good value
    assert.equal(await rewardG(), "2400");
    h.clock.advance(30 * MINUTE);
    assert.equal(await rewardG(), "2400", "36 minutes after the last good read");
    h.clock.advance(25 * MINUTE); // 61 minutes since the last good read
    assert.equal(await rewardG(), null, "past an hour a number nobody has confirmed is not shown");

    state.fail = false;
    h.clock.advance(30_000);
    assert.equal(await rewardG(), "2400");
  } finally { await h.close(); }
});

test("createEngagementReward: the cache lifetimes are the ones documented", async () => {
  let t = 0;
  const rpc = fakeEngagementRpc();
  const reader = createEngagementReward({ client: rpc.client, address: ENGAGEMENT, app: "0x" + "ab".repeat(20), now: () => t });
  assert.equal(await reader.get(), "2400");
  t = 5 * MINUTE - 1;
  await reader.get();
  assert.equal(rpc.state.reads.registeredApps, 1);
  t = 5 * MINUTE;
  await reader.get();
  assert.equal(rpc.state.reads.registeredApps, 2);
});

// --- the real read path ------------------------------------------------------------------------------------------

test("without an injected reader the server asks config.rpcUrl: eth_call rewardAmount() and registeredApps(app)", async () => {
  const abi = parseAbi([
    "function rewardAmount() view returns (uint96)",
    "function registeredApps(address) view returns (address owner, address rewardReceiver, uint96 totalRewardsClaimed, uint32 registeredAt, uint32 lastResetAt, uint8 userAndInviterPercentage, uint8 userPercentage, bool isRegistered, bool isApproved, string description, string url, string email, address app, address signer)",
  ]);
  const seen = [];
  const rpc = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      const reply = (result) => res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      if (method !== "eth_call") return reply("0x");
      const { to, data } = params[0];
      const { functionName, args } = decodeFunctionData({ abi, data });
      seen.push({ to: to.toLowerCase(), functionName, args, selector: data.slice(0, 10) });
      if (functionName === "rewardAmount") return reply(encodeFunctionResult({ abi, functionName, result: G(5000) }));
      reply(encodeFunctionResult({
        abi, functionName,
        result: [args[0], args[0], 0n, 1_700_000_000, 0, 80, 60, true, true, "Moonshard", "https://moonshard.example", "ops@moonshard.example", args[0], zeroAddress],
      }));
    });
  });
  await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
  const h = await makeHarness({ engagementReader: "real", config: { rpcUrl: `http://127.0.0.1:${rpc.address().port}` } });
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.body.rewardG, "2400", JSON.stringify(st.body));
    assert.deepEqual(seen.map((s) => [s.to, s.functionName]).sort(), [[ENGAGEMENT.toLowerCase(), "registeredApps"], [ENGAGEMENT.toLowerCase(), "rewardAmount"]]);
    assert.equal(seen.find((s) => s.functionName === "registeredApps").args[0].toLowerCase(), h.ctx.appAccount.address.toLowerCase());
    // the selectors on the wire, written out (from `cast sig`) so they do not depend on the code under test
    assert.deepEqual(seen.map((s) => s.selector).sort(), ["0xa6c4cce9" /* registeredApps(address) */, "0xf7b2a7be" /* rewardAmount() */]);
  } finally { await h.close(); await new Promise((r) => rpc.close(r)); }
});

test("without an injected reader and an RPC that is down, status still answers (rewardG null) instead of failing", async () => {
  const h = await makeHarness({ engagementReader: "real", config: { rpcUrl: "http://127.0.0.1:1" } });
  try {
    const p = await h.newPlayer({ verified: true });
    const st = await h.api.get("/engagement/status", { token: p.token });
    assert.equal(st.status, 200);
    assert.equal(st.body.rewardG, null);
  } finally { await h.close(); }
});

// --- the countdown -----------------------------------------------------------------------------------------------

test("attestExpiresAt is when the pending boss run stops being attestable: submitted_at + 24 h", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const none = (await h.api.get("/engagement/status", { token: p.token })).body;
    assert.equal(none.pendingRunId, null);
    assert.equal(none.attestExpiresAt, null);

    const runId = await clearBoss(h, p);
    const submittedAt = new Date((await h.db.query("SELECT submitted_at FROM runs WHERE run_id = $1", [runId])).rows[0].submitted_at).getTime();
    const st = (await h.api.get("/engagement/status", { token: p.token })).body;
    assert.equal(st.pendingRunId, runId);
    assert.equal(st.attestExpiresAt, new Date(submittedAt + 24 * 3600_000).toISOString());
    assert.match(st.attestExpiresAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

    // and it is true: attest works until then and not after
    h.clock.set(Date.parse(st.attestExpiresAt) - 1_000);
    assert.equal((await h.api.post("/engagement/attest", { runId }, { token: p.token })).status, 200);
    h.clock.set(Date.parse(st.attestExpiresAt) + 1_000);
    const late = await h.api.post("/engagement/attest", { runId }, { token: p.token });
    assert.deepEqual([late.status, late.body.error], [410, "run_too_old"]);
    const after = (await h.api.get("/engagement/status", { token: p.token })).body;
    assert.equal(after.pendingRunId, null);
    assert.equal(after.attestExpiresAt, null);
  } finally { await h.close(); }
});

test("attestExpiresAt follows the newest cleared boss run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const first = await clearBoss(h, p);
    h.clock.advance(2 * 3600_000);
    const second = await clearBoss(h, p);
    const st = (await h.api.get("/engagement/status", { token: p.token })).body;
    assert.equal(st.pendingRunId, second);
    const sub = new Date((await h.db.query("SELECT submitted_at FROM runs WHERE run_id = $1", [second])).rows[0].submitted_at).getTime();
    assert.equal(st.attestExpiresAt, new Date(sub + 24 * 3600_000).toISOString());
    assert.notEqual(first, second);
  } finally { await h.close(); }
});
