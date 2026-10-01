import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, formatUnits, getAddress, keccak256, parseAbiParameters, verifyTypedData, zeroAddress } from "viem";
import { makeHarness, playTrial, VAULT } from "./helpers.js";
import { settleDay, settleDue, spoilId, spoilTypes } from "../src/spoils.js";
import { vaultAbi } from "../src/chain.js";

const G = (n) => BigInt(n) * 10n ** 18n;
const NEXT_DAY_SETTLEABLE = Date.parse("2026-10-06T00:42:00.000Z");

async function spoilRows(h) {
  return (await h.db.query("SELECT kind, subject, amount, rank FROM spoils ORDER BY kind, rank NULLS LAST, subject")).rows;
}

test("top-3 verified, ranked players win 1000/600/300 G$; unverified never do", async () => {
  const h = await makeHarness();
  try {
    const v = [];
    for (let i = 0; i < 4; i++) v.push(await h.newPlayer({ verified: true }));
    const cheater = await h.newPlayer();
    await playTrial(h, v[0], { score: 500 });
    await playTrial(h, v[1], { score: 400 });
    await playTrial(h, v[2], { score: 300 });
    await playTrial(h, v[3], { score: 200 });
    await playTrial(h, cheater, { score: 9000 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    const out = await settleDue(h.ctx);
    assert.equal(out.length, 1);
    assert.equal(out[0].prizes, 3);
    const prizes = (await spoilRows(h)).filter((r) => r.kind === "TRIAL_PRIZE");
    assert.deepEqual(prizes.map((r) => r.subject), [v[0].address, v[1].address, v[2].address]);
    assert.deepEqual(prizes.map((r) => r.amount), [G(1000), G(600), G(300)].map(String));
    assert.ok(!prizes.some((r) => r.subject === cheater.address));
  } finally { await h.close(); }
});

test("settlement is idempotent", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    assert.equal((await settleDue(h.ctx)).length, 1);
    assert.equal((await settleDue(h.ctx)).length, 0);
    const again = await settleDay(h.ctx, "2026-10-05");
    assert.equal(again.settled, false);
    assert.equal((await spoilRows(h)).length, 1);
  } finally { await h.close(); }
});

test("a day is not settled until the ticket window has passed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(Date.parse("2026-10-06T00:10:00.000Z"));
    assert.equal((await settleDue(h.ctx)).length, 0);
    h.clock.set(Date.parse("2026-10-06T00:42:00.000Z"));
    assert.equal((await settleDue(h.ctx)).length, 1);
  } finally { await h.close(); }
});

test("shard harvest pays 2 G$ per shard, capped at 50 shards/day, verified only", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    await playTrial(h, p, { kills: 40, shards: 30, score: 100 });
    await playTrial(h, p, { kills: 40, shards: 30, score: 100 });
    await playTrial(h, u, { kills: 40, shards: 30, score: 100 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const harvest = (await spoilRows(h)).filter((r) => r.kind === "SHARD_HARVEST");
    assert.equal(harvest.length, 1);
    assert.equal(harvest[0].subject, p.address);
    assert.equal(harvest[0].amount, String(G(100))); // min(60, 50) * 2 G$
  } finally { await h.close(); }
});

test("two wallets of one human get one prize and share one shard cap", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true, root: a.address });
    await playTrial(h, a, { score: 800, kills: 40, shards: 30 });
    await playTrial(h, b, { score: 900, kills: 40, shards: 30 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const rows = await spoilRows(h);
    assert.equal(rows.filter((r) => r.kind === "TRIAL_PRIZE").length, 1);
    const harvest = rows.find((r) => r.kind === "SHARD_HARVEST");
    assert.equal(harvest.amount, String(G(100)));
  } finally { await h.close(); }
});

test("GET /spoils returns a voucher the vault would accept, to the session wallet", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const res = await h.api.get("/spoils", { token: p.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.vault.address, VAULT);
    const s = res.body.spoils[0];
    assert.equal(s.kind, "TRIAL_PRIZE");
    assert.equal(s.amountG, "1000");
    assert.equal(s.claimed, false);
    assert.equal(s.voucher.to.toLowerCase(), p.address);
    assert.equal(BigInt(s.voucher.id), spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", p.address));
    const ok = await verifyTypedData({
      address: h.ctx.voucherAccount.address,
      domain: { name: "MoonshardVault", version: "1", chainId: 42220, verifyingContract: VAULT },
      types: spoilTypes,
      primaryType: "Spoil",
      message: {
        to: s.voucher.to,
        id: BigInt(s.voucher.id),
        amount: BigInt(s.voucher.amount),
        deadline: BigInt(s.voucher.deadline),
      },
      signature: s.voucher.signature,
    });
    assert.equal(ok, true);
    assert.equal(BigInt(s.voucher.deadline), BigInt(Math.floor(h.clock() / 1000) + 7 * 24 * 3600));
  } finally { await h.close(); }
});

test("already-redeemed spoils get no voucher; an RPC failure reports claimed:null and no voucher", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const id = spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", p.address).toString();
    h.chain.state.claimedIds.add(id);
    const done = (await h.api.get("/spoils", { token: p.token })).body.spoils[0];
    assert.equal(done.claimed, true);
    assert.equal(done.voucher, null);

    h.chain.voucherClaimed = async () => { throw new Error("rpc down"); };
    const down = (await h.api.get("/spoils", { token: p.token })).body.spoils[0];
    assert.equal(down.claimed, null);
    assert.equal(down.voucher, null);
  } finally { await h.close(); }
});

test("players only ever see their own spoils; unverified see none", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    const u = await h.newPlayer();
    await playTrial(h, a, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    assert.equal((await h.api.get("/spoils", { token: a.token })).body.spoils.length, 1);
    assert.equal((await h.api.get("/spoils", { token: b.token })).body.spoils.length, 0);
    assert.equal((await h.api.get("/spoils", { token: u.token })).body.spoils.length, 0);
  } finally { await h.close(); }
});

test("/spoils/confirm records redemptions of the caller's own vouchers only", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    await playTrial(h, a, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const id = spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", a.address);
    const topics = encodeEventTopics({ abi: vaultAbi, eventName: "Claimed", args: { id, to: a.account.address } });
    const data = encodeAbiParameters([{ type: "uint256" }], [G(1000)]);
    const hash = "0x" + "ab".repeat(32);
    h.chain.state.txs.set(hash, {
      tx: { from: a.account.address, to: VAULT, input: "0x" },
      receipt: { status: "success", logs: [{ address: VAULT, topics, data, logIndex: 0, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: hash, transactionIndex: 0, removed: false }] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    const theirs = await h.api.post("/spoils/confirm", { txHash: hash }, { token: b.token });
    assert.deepEqual(theirs.body.recorded, []);
    const mine = await h.api.post("/spoils/confirm", { txHash: hash }, { token: a.token });
    assert.deepEqual(mine.body.recorded, [id.toString()]);
    const again = await h.api.post("/spoils/confirm", { txHash: hash }, { token: a.token });
    assert.deepEqual(again.body.recorded, []);
    assert.equal((await h.api.post("/spoils/confirm", { txHash: "nope" }, { token: a.token })).body.error, "bad_tx");
    assert.equal((await h.api.post("/spoils/confirm", { txHash: "0x" + "cd".repeat(32) }, { token: a.token })).status, 404);
    assert.equal(formatUnits(G(1000), 18), "1000");
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Spoil ids are bound to the vault they are paid from.
// Break caught: id = keccak256(kind, day, subject) did not depend on the vault, so after a vault redeploy every spoil
// the old vault had already paid was signed again for the new vault (whose `claimed` set is empty) and paid twice.
// ---------------------------------------------------------------------------------------------------------------

const VAULT_B = "0x" + "0".repeat(35) + "b0b1b"; // a second vault: lowercase, 40 hex digits
const SUBJECT = "0x" + "0".repeat(35) + "5eed1";

test("spoil id: the same spoil has a different id on every vault, and the preimage is abi.encode(vault, kind, day, subject)", () => {
  const ids = [VAULT, VAULT_B, zeroAddress].map((v) => spoilId(v, "TRIAL_PRIZE", "2026-10-05", SUBJECT));
  assert.equal(new Set(ids).size, 3, "three vaults, three ids");
  assert.notEqual(spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", SUBJECT), spoilId(VAULT, "SHARD_HARVEST", "2026-10-05", SUBJECT));
  assert.notEqual(spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", SUBJECT), spoilId(VAULT, "TRIAL_PRIZE", "2026-10-06", SUBJECT));

  // The layout is pinned: a typed, length-prefixed encoding, so no two (vault, kind, day, subject) tuples can share a preimage.
  const preimage = encodeAbiParameters(parseAbiParameters("address, string, string, address"), [VAULT, "TRIAL_PRIZE", "2026-10-05", SUBJECT]);
  assert.equal(spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", SUBJECT), BigInt(keccak256(preimage)));

  // the address is the same address however it is cased (config holds whatever the operator pasted)
  assert.equal(spoilId(getAddress(VAULT), "TRIAL_PRIZE", "2026-10-05", SUBJECT), spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", SUBJECT));
});

test("settlement stores ids bound to the configured vault", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500, kills: 40, shards: 30 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const ids = (await h.db.query("SELECT kind, id FROM spoils ORDER BY kind")).rows;
    assert.deepEqual(ids, [
      { kind: "SHARD_HARVEST", id: spoilId(VAULT, "SHARD_HARVEST", "2026-10-05", p.address).toString() },
      { kind: "TRIAL_PRIZE", id: spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", p.address).toString() },
    ]);
    for (const { id } of ids) assert.notEqual(id, spoilId(VAULT_B, "TRIAL_PRIZE", "2026-10-05", p.address).toString());
  } finally { await h.close(); }
});

test("after a vault redeploy, spoils settled under the old vault get no voucher; new days are bound to the new vault", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const oldId = spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", p.address);
    const before = (await h.api.get("/spoils", { token: p.token })).body.spoils;
    assert.deepEqual(before.map((s) => s.voucher?.id), [oldId.toString()]);

    // The old vault pays it. The operator then redeploys: VAULT_ADDRESS now names a fresh vault whose `claimed` set is empty.
    h.chain.state.claimedIds.add(oldId.toString());
    h.config.contracts.vault = VAULT_B;
    h.chain.state.claimedIds.clear();

    const after = await h.api.get("/spoils", { token: p.token });
    assert.equal(after.status, 200);
    assert.equal(after.body.vault.address, VAULT_B);
    assert.deepEqual(after.body.spoils, [], "a spoil of the old vault is not this vault's to pay: a voucher would pay it a second time");

    // A day settled after the redeploy is bound to the new vault and redeemable there.
    h.clock.set(Date.parse("2026-10-06T12:00:00.000Z"));
    await playTrial(h, p, { score: 600 });
    h.clock.set(Date.parse("2026-10-07T00:42:00.000Z"));
    await settleDue(h.ctx);
    const fresh = (await h.api.get("/spoils", { token: p.token })).body.spoils;
    const newId = spoilId(VAULT_B, "TRIAL_PRIZE", "2026-10-06", p.address);
    assert.deepEqual(fresh.map((s) => [s.day, s.voucher?.id]), [["2026-10-06", newId.toString()]]);
    assert.notEqual(newId, oldId);
    const ok = await verifyTypedData({
      address: h.ctx.voucherAccount.address,
      domain: { name: "MoonshardVault", version: "1", chainId: 42220, verifyingContract: VAULT_B },
      types: spoilTypes,
      primaryType: "Spoil",
      message: { to: fresh[0].voucher.to, id: BigInt(fresh[0].voucher.id), amount: BigInt(fresh[0].voucher.amount), deadline: BigInt(fresh[0].voucher.deadline) },
      signature: fresh[0].voucher.signature,
    });
    assert.equal(ok, true);
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM spoils")).rows[0].n, 2, "the old row is kept, only never signed again");
  } finally { await h.close(); }
});

test("with no vault configured nothing is settled, so no spoil is bound to a vault that does not exist yet", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 500 });
    h.config.contracts.vault = "";
    h.clock.set(NEXT_DAY_SETTLEABLE);
    assert.deepEqual(await settleDue(h.ctx), []);
    assert.deepEqual(await settleDay(h.ctx, "2026-10-05"), { day: "2026-10-05", settled: false, reason: "no_vault" });
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM spoils")).rows[0].n, 0);
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM settled_days")).rows[0].n, 0, "the day stays open for settlement");

    // The operator fixes VAULT_ADDRESS: the day settles, bound to that vault.
    h.config.contracts.vault = VAULT;
    const out = await settleDue(h.ctx);
    assert.equal(out.length, 1);
    assert.deepEqual((await h.db.query("SELECT id FROM spoils")).rows.map((r) => r.id), [spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", p.address).toString()]);
  } finally { await h.close(); }
});
