import test from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, formatUnits, getAddress, keccak256, parseAbiParameters, verifyTypedData, zeroAddress } from "viem";
import { makeHarness, playTrial, VAULT } from "./helpers.js";
import { settleDay, settleDue, spoilId, spoilTypes } from "../src/spoils.js";
import { vaultAbi } from "../src/chain.js";
import { dayKey } from "../src/time.js";

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

    // The failed read comes first: a `true` answer is remembered for ever (claimed is monotonic), so once the
    // spoil is known to be redeemed a later outage can no longer show up as claimed:null.
    const real = h.chain.voucherClaimed;
    h.chain.voucherClaimed = async () => { throw new Error("rpc down"); };
    const down = (await h.api.get("/spoils", { token: p.token })).body.spoils[0];
    assert.equal(down.claimed, null);
    assert.equal(down.voucher, null);

    h.chain.voucherClaimed = real;
    h.chain.state.claimedIds.add(id);
    const done = (await h.api.get("/spoils", { token: p.token })).body.spoils[0];
    assert.equal(done.claimed, true);
    assert.equal(done.voucher, null);
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

// ---------------------------------------------------------------------------------------------------------------
// GET /spoils reads each spoil's redeemed status from the chain: cached, and not one call after another.
// Break caught: up to 30 sequential eth_calls per request (and a dead RPC meant 30 timeouts in a row).
// ---------------------------------------------------------------------------------------------------------------

async function seedSpoils(h, p, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const day = dayKey(Date.UTC(2026, 7, 1 + i));
    const id = spoilId(VAULT, "SHARD_HARVEST", day, p.address).toString();
    await h.db.query("INSERT INTO spoils(id, kind, day, subject, amount) VALUES ($1,'SHARD_HARVEST',$2,$3,$4)", [id, day, p.address, "2000000000000000000"]);
    ids.push(id);
  }
  return ids;
}

/** Replaces the fake chain's voucherClaimed with one that counts calls, tracks how many overlap, and takes a moment. */
function watchClaimedReads(h, delayMs = 5) {
  const real = h.chain.voucherClaimed.bind(h.chain);
  const seen = { calls: 0, inflight: 0, maxInflight: 0, ids: [] };
  h.chain.voucherClaimed = async (id) => {
    seen.calls += 1;
    seen.ids.push(String(id));
    seen.inflight += 1;
    seen.maxInflight = Math.max(seen.maxInflight, seen.inflight);
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      return await real(id);
    } finally { seen.inflight -= 1; }
  };
  return seen;
}

test("GET /spoils reads the uncached statuses in parallel, five at a time", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await seedSpoils(h, p, 12);
    const seen = watchClaimedReads(h);
    const res = await h.api.get("/spoils", { token: p.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.spoils.length, 12);
    assert.ok(res.body.spoils.every((s) => s.claimed === false && s.voucher), "every unredeemed spoil still gets its voucher");
    assert.equal(seen.calls, 12);
    assert.ok(seen.maxInflight > 1, `reads overlap (max in flight ${seen.maxInflight})`);
    assert.ok(seen.maxInflight <= 5, `at most 5 reads at once (max in flight ${seen.maxInflight})`);
  } finally { await h.close(); }
});

test("a redeemed spoil is remembered for ever, an unredeemed one for 10 s", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const ids = await seedSpoils(h, p, 4);
    h.chain.state.claimedIds.add(ids[0]);
    h.chain.state.claimedIds.add(ids[1]);
    const seen = watchClaimedReads(h, 0);
    const get = async () => (await h.api.get("/spoils", { token: p.token })).body.spoils;
    const byId = (list) => Object.fromEntries(list.map((s) => [s.id, s.claimed]));

    assert.deepEqual(byId(await get()), { [ids[0]]: true, [ids[1]]: true, [ids[2]]: false, [ids[3]]: false });
    assert.equal(seen.calls, 4);

    h.clock.advance(9_000);
    await get();
    assert.equal(seen.calls, 4, "inside 10 s nothing is read again");

    h.clock.advance(1_001);
    await get();
    assert.equal(seen.calls, 6, "after 10 s only the two unredeemed spoils are read again");
    assert.deepEqual(seen.ids.slice(4).sort(), [ids[2], ids[3]].sort());

    // spoil 2 is redeemed on-chain: the next read after the 10 s window sees it, and from then on it is never read again
    h.chain.state.claimedIds.add(ids[2]);
    h.clock.advance(10_001);
    assert.equal(byId(await get())[ids[2]], true);
    assert.equal(seen.calls, 8);
    h.clock.advance(24 * 3600_000);
    await get();
    assert.equal(seen.calls, 9, "a day later only the one unredeemed spoil is read");
    assert.equal(seen.ids.at(-1), ids[3]);
  } finally { await h.close(); }
});

test("a failed status read is not remembered, and the rest of the batch is not attempted after it", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await seedSpoils(h, p, 20);
    let calls = 0;
    h.chain.voucherClaimed = async () => { calls += 1; throw new Error("rpc down"); };
    const down = await h.api.get("/spoils", { token: p.token });
    assert.equal(down.status, 200);
    assert.ok(down.body.spoils.every((s) => s.claimed === null && s.voucher === null));
    assert.ok(calls <= 5, `a dead RPC costs at most one round of 5 parallel reads, not 20 (made ${calls})`);

    // the outage ends: the very next request reads again (nothing was cached) and gets vouchers
    h.chain.voucherClaimed = async () => false;
    const up = await h.api.get("/spoils", { token: p.token });
    assert.ok(up.body.spoils.every((s) => s.claimed === false && s.voucher));
  } finally { await h.close(); }
});

test("the claimed-status cache is bounded: the oldest entry goes first", async () => {
  const { createClaimedReader } = await import("../src/spoils.js");
  const calls = [];
  const reader = createClaimedReader({ read: async (id) => { calls.push(id); return id === "a"; }, now: () => 0, maxEntries: 3, falseTtlMs: 10_000 });
  await reader.read(["a", "b", "c"]);
  assert.deepEqual(calls, ["a", "b", "c"]);
  await reader.read(["a", "b", "c"]);
  assert.equal(calls.length, 3, "all three are cached");
  await reader.read(["d"]); // a fourth entry pushes the oldest ("a") out
  await reader.read(["b", "c", "d"]);
  assert.equal(calls.length, 4, "b, c and d are still cached");
  assert.equal((await reader.read(["a"])).get("a"), true);
  assert.equal(calls.length, 5, "a was evicted, so it is read again");
});

test("/spoils/confirm marks the redeemed spoils claimed at once, even inside the 10 s window of an earlier read", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    await playTrial(h, a, { score: 500 });
    h.clock.set(NEXT_DAY_SETTLEABLE);
    await settleDue(h.ctx);
    const seen = watchClaimedReads(h, 0);
    const before = (await h.api.get("/spoils", { token: a.token })).body.spoils[0];
    assert.equal(before.claimed, false);
    assert.ok(before.voucher);
    assert.equal(seen.calls, 1);

    const id = spoilId(VAULT, "TRIAL_PRIZE", "2026-10-05", a.address);
    const hash = "0x" + "ac".repeat(32);
    h.chain.state.txs.set(hash, {
      tx: { from: a.account.address, to: VAULT, input: "0x" },
      receipt: { status: "success", logs: [{
        address: VAULT,
        topics: encodeEventTopics({ abi: vaultAbi, eventName: "Claimed", args: { id, to: a.account.address } }),
        data: encodeAbiParameters([{ type: "uint256" }], [G(1000)]),
        logIndex: 0, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: hash, transactionIndex: 0, removed: false,
      }] },
      timestamp: Math.floor(h.clock() / 1000),
    });
    h.chain.state.claimedIds.add(id.toString());
    assert.deepEqual((await h.api.post("/spoils/confirm", { txHash: hash }, { token: a.token })).body.recorded, [id.toString()]);

    h.clock.advance(1_000); // well inside the 10 s the earlier `false` would be believed
    const after = (await h.api.get("/spoils", { token: a.token })).body.spoils[0];
    assert.equal(after.claimed, true);
    assert.equal(after.voucher, null);
    assert.equal(seen.calls, 1, "the receipt of the redemption was the proof: no new chain read");
  } finally { await h.close(); }
});
