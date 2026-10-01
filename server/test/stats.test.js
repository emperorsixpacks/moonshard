import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, UBI, ubiClaimedLog } from "./helpers.js";

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
