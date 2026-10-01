import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness, playTrial, UBI } from "./helpers.js";

const HASH = "0x" + "11".repeat(32);

function setClaimTx(h, p, over = {}) {
  h.chain.state.txs.set(HASH, {
    tx: { from: p.account.address, to: UBI, input: "0x4e71d92d" },
    receipt: { status: "success", logs: [] },
    timestamp: Math.floor(h.clock() / 1000),
    ...over,
  });
}

test("confirming a real claim() tx grants today's blessing and is idempotent", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    setClaimTx(h, p);
    const r = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: p.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.blessing, true);
    assert.equal(r.body.recorded, true);
    const again = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: p.token });
    assert.equal(again.body.recorded, false);
    const st = await h.api.get("/rewards/status", { token: p.token });
    assert.equal(st.body.blessing, true);
  } finally { await h.close(); }
});

test("rejects wrong contract, wrong method, failed tx, someone else's tx, stale tx, unverified caller", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const other = await h.newPlayer({ verified: true });
    const call = () => h.api.post("/ubi/confirm", { txHash: HASH }, { token: p.token });

    setClaimTx(h, p, { tx: { from: p.account.address, to: "0x0000000000000000000000000000000000000001", input: "0x4e71d92d" } });
    assert.equal((await call()).body.error, "wrong_contract");
    setClaimTx(h, p, { tx: { from: p.account.address, to: UBI, input: "0xa9059cbb" } });
    assert.equal((await call()).body.error, "wrong_method");
    setClaimTx(h, p, { receipt: { status: "reverted", logs: [] } });
    assert.equal((await call()).body.error, "tx_failed");
    setClaimTx(h, other);
    const theirs = await call();
    assert.equal(theirs.status, 403);
    assert.equal(theirs.body.error, "not_your_tx");
    setClaimTx(h, p, { timestamp: Math.floor(h.clock() / 1000) - 2 * 86400 });
    assert.equal((await call()).body.error, "tx_not_today");

    const u = await h.newPlayer();
    setClaimTx(h, u);
    const nv = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: u.token });
    assert.equal(nv.status, 403);
    assert.equal(nv.body.error, "verification_required");
    assert.equal((await h.api.post("/ubi/confirm", { txHash: "bad" }, { token: p.token })).body.error, "bad_tx");
    assert.equal((await h.api.post("/ubi/confirm", { txHash: "0x" + "22".repeat(32) }, { token: p.token })).status, 404);
  } finally { await h.close(); }
});

test("a linked second wallet of the same human may confirm the claim", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true, root: a.address });
    setClaimTx(h, a);
    const r = await h.api.post("/ubi/confirm", { txHash: HASH }, { token: b.token });
    assert.equal(r.status, 200);
  } finally { await h.close(); }
});

test("rewards status reports pending harvest and the cap in G$", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { kills: 40, shards: 30 });
    const st = (await h.api.get("/rewards/status", { token: p.token })).body;
    assert.equal(st.verified, true);
    assert.equal(st.crystalStatus.shards, 30);
    assert.equal(st.crystalStatus.gdEarned, 60);
    assert.equal(st.crystalStatus.dailyCapGd, 100);
    assert.equal(st.crystalStatus.isCapped, false);
    assert.equal(st.crystalStatus.rateGd, 2);
    await playTrial(h, p, { kills: 40, shards: 30 });
    const capped = (await h.api.get("/rewards/status", { token: p.token })).body;
    assert.equal(capped.crystalStatus.isCapped, true);
    assert.equal(capped.crystalStatus.gdEarned, 100);
    assert.equal(capped.firstBossClaimed, false);
  } finally { await h.close(); }
});
