import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, T0, UBI, ubiClaimedLog } from "./helpers.js";

test("stats count verified players, runs, claims and cache for 60s", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    await h.newPlayer();
    await playTrial(h, a, { score: 500 });
    const hash = "0x" + "44".repeat(32);
    h.chain.state.txs.set(hash, {
      tx: { from: a.account.address, to: UBI, input: "0x4e71d92d" },
      receipt: { status: "success", logs: [ubiClaimedLog({ claimer: a.account.address, hash })] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    await h.api.post("/ubi/confirm", { txHash: hash }, { token: a.token });

    const s = (await h.api.get("/stats")).body;
    assert.equal(s.verifiedPlayers, 1);
    assert.equal(s.walletsConnected, 2);
    assert.equal(s.runsToday, 1);
    assert.equal(s.activeToday, 1);
    assert.equal(s.ubiClaimsTotal, 1);
    assert.equal(s.ubiClaimsToday, 1);
    assert.equal(s.engagementClaims, 0);
    assert.equal(s.series.length, 7);
    assert.equal(s.series[6].day, "2026-10-05");
    assert.equal(s.series[6].runs, 1);

    await h.newPlayer({ verified: true });
    assert.equal((await h.api.get("/stats")).body.verifiedPlayers, 1); // cached
    h.clock.advance(61_000);
    assert.equal((await h.api.get("/stats")).body.verifiedPlayers, 2);
  } finally { await h.close(); }
});

// Finding 12. walletsConnected, runsToday and activeToday include free unverified wallets (anyone can make a wallet and
// sign in), and verifiedPlayers counts users.root IS NOT NULL, which is never cleared: "ever verified". verifiedActiveToday
// is the honest "real people playing today": distinct verified subjects with a finished run today.

test("stats: verifiedActiveToday counts distinct verified players with a finished run today, free wallets excluded", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const a2 = await h.newPlayer({ verified: true, root: a.address }); // a second wallet of the same human
    const b = await h.newPlayer({ verified: true }); // starts a run and walks away
    const c = await h.newPlayer(); // a free wallet that plays
    await h.newPlayer(); // a free wallet that only signed in

    await playTrial(h, a, { score: 500 });
    await playTrial(h, a2, { score: 600 }); // same human, same subject: still one
    await h.api.post("/runs/start", { mode: "TRIAL" }, { token: b.token });
    await playTrial(h, c, { score: 400 });

    const s = (await h.api.get("/stats")).body;
    assert.equal(s.verifiedActiveToday, 1, "only a's human finished a run as a verified player");
    // the existing counters keep their meaning, free wallets included
    assert.equal(s.walletsConnected, 5);
    assert.equal(s.runsToday, 3, "a twice and c once");
    assert.equal(s.activeToday, 3, "a, b (an unfinished run counts) and c");
    assert.equal(s.verifiedPlayers, 2, "a's human and b");
  } finally { await h.close(); }
});

test("stats: yesterday's verified players are not active today", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    await playTrial(h, a, { score: 500 });
    assert.equal((await h.api.get("/stats")).body.verifiedActiveToday, 1);
    h.clock.set(T0 + 24 * 3600_000);
    const next = (await h.api.get("/stats")).body;
    assert.equal(next.verifiedActiveToday, 0);
    assert.equal(next.verifiedPlayers, 1);
  } finally { await h.close(); }
});

test("stats: verifiedPlayers is 'ever verified'; verifiedActiveToday only counts runs played while verified", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    h.chain.whitelist(p.address, p.address, h.clock() + 3600_000); // verification lapses after an hour
    h.ctx.identity.invalidate(p.address);
    assert.equal((await playTrial(h, p, { score: 500 })).status, 200);
    let s = (await h.api.get("/stats")).body;
    assert.equal(s.verifiedActiveToday, 1);
    assert.equal(s.verifiedPlayers, 1);

    h.clock.set(T0 + 2 * 24 * 3600_000); // two days on, the chain no longer vouches for p
    assert.equal((await playTrial(h, p, { score: 500 })).status, 200);
    s = (await h.api.get("/stats")).body;
    assert.equal(s.runsToday, 1, "p did play today ...");
    assert.equal(s.activeToday, 1);
    assert.equal(s.verifiedActiveToday, 0, "... but not as a verified player");
    assert.equal(s.verifiedPlayers, 1, "users.root is never cleared, so this stays 'ever verified'");
  } finally { await h.close(); }
});
