import test from "node:test";
import assert from "node:assert/strict";
import { GAME } from "../config.js";
import { makeHarness, TOKEN, transferCalldata, transferLog, VAULT } from "./helpers.js";

/*
 * The Moon Shop. A purchase is a G$ transfer from the player's wallet to the prize vault, and the game names what it buys in
 * the transfer itself ("moonshard:<item>" after the transfer's arguments), so the transaction alone is the whole record.
 * The server unlocks an item only once the token's own Transfer event shows the vault was paid at least its price.
 */

const G = (n) => BigInt(n) * 10n ** 18n;
const HASH = "0x" + "a1".repeat(32);
const OTHER = "0x" + "0".repeat(39) + "7";

/** Puts a purchase on the fake chain: `from` pays `value` to `to`, naming `tag` (null: names nothing). Any field can be overridden. */
function setPurchase(h, p, { tag = "moonshard:iron_starter", value = G(20), to = VAULT, hash = HASH, txTo = TOKEN, input, logs, status = "success", from } = {}) {
  const sender = from ?? p.account.address;
  h.chain.state.txs.set(hash, {
    tx: { from: sender, to: txTo, input: input ?? transferCalldata(to, value, tag ?? undefined) },
    receipt: { status, logs: logs ?? [transferLog({ from: sender, to, value, hash })] },
    timestamp: Math.floor(h.clock() / 1000),
  });
  return hash;
}
const buy = (h, p, hash = HASH) => h.api.post("/shop/confirm", { txHash: hash }, { token: p.token });
const owned = async (h, p) => (await h.api.get("/rewards/status", { token: p.token })).body.owned;

test("GET /shop: what G$ buys, its price in G$, and where the G$ goes", async () => {
  const h = await makeHarness();
  try {
    const r = await h.api.get("/shop");
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, true);
    assert.equal(r.body.token.toLowerCase(), TOKEN.toLowerCase());
    assert.equal(r.body.vault, VAULT);
    const byId = Object.fromEntries(r.body.items.map((i) => [i.id, i]));
    assert.deepEqual(byId.iron_starter, { id: "iron_starter", name: "Rusted Shortsword", kind: "blade", priceG: "20", requires: null });
    assert.equal(byId.iron_broadsword.kind, "forge");
    assert.equal(byId.forest_glaive.kind, "forge");
    assert.equal(byId.golden_albatross.requires, "forest_glaive", "a Celestial blade has the Glaive's power: the Glaive comes first");
    assert.equal(byId.satchel_pet.kind, "cosmetic");
    assert.equal(r.body.items.filter((i) => i.kind === "blade").length, 1, "one entry blade");
    for (const item of r.body.items) assert.ok(Number(item.priceG) > 0, `${item.id} has a price`);
  } finally { await h.close(); }
});

test("a server with no prize vault has no shop: nothing is for sale and no blade is needed to play", async () => {
  const h = await makeHarness({ config: { contracts: { identity: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42", ubi: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1", token: TOKEN, engagement: "0x25db74CF4E7BA120526fd87e159CF656d94bAE43", vault: "" } } });
  try {
    const shop = (await h.api.get("/shop")).body;
    assert.deepEqual({ enabled: shop.enabled, vault: shop.vault, items: shop.items }, { enabled: false, vault: null, items: [] });
    const p = await h.newPlayer({ verified: true, blade: false });
    setPurchase(h, p);
    const r = await buy(h, p);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "shop_closed");
    const run = await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token });
    assert.equal(run.status, 200, "plays without a blade");
  } finally { await h.close(); }
});

test("a shop that sells no blade asks for none: runs start without one", async (t) => {
  const saved = [...GAME.SHOP];
  GAME.SHOP.splice(0, GAME.SHOP.length, ...saved.filter((item) => item.kind !== "blade"));
  t.after(() => GAME.SHOP.splice(0, GAME.SHOP.length, ...saved));
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true, blade: false });
    assert.equal((await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token })).status, 200);
  } finally { await h.close(); }
});

test("a confirmed payment unlocks the item for the player, and confirming it again changes nothing", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true, blade: false });
    assert.deepEqual(await owned(h, p), []);
    setPurchase(h, p);
    const r = await buy(h, p);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, item: "iron_starter", recorded: true, alreadyOwned: false, owned: ["iron_starter"] });
    assert.deepEqual(await owned(h, p), ["iron_starter"]);
    const again = await buy(h, p);
    assert.equal(again.status, 200);
    assert.equal(again.body.recorded, false);
    assert.deepEqual(again.body.owned, ["iron_starter"]);
  } finally { await h.close(); }
});

test("no blade, no run: /runs/start is refused until the blade is bought", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true, blade: false });
    const refused = await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "blade_required");
    const story = await h.api.post("/runs/start", { mode: "STORY", chapter: 1 }, { token: p.token });
    assert.equal(story.body.error, "blade_required");
    setPurchase(h, p);
    assert.equal((await buy(h, p)).status, 200);
    const ok = await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token });
    assert.equal(ok.status, 200, "a refused start did not use up the wait between starts");
  } finally { await h.close(); }
});

test("a payment that does not prove a purchase is refused, and unlocks nothing", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true, blade: false });
    const other = await h.newPlayer({ verified: true, blade: false });
    const refused = async (over, error, status = 422) => {
      h.chain.state.txs.clear();
      setPurchase(h, p, over);
      const r = await buy(h, p);
      assert.equal(r.status, status, `${error}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, error);
    };
    await refused({ status: "reverted", logs: [] }, "tx_failed");
    await refused({ txTo: OTHER }, "wrong_contract");
    await refused({ input: "0x095ea7b3" + transferCalldata(VAULT, G(20), "moonshard:iron_starter").slice(10) }, "wrong_method");
    await refused({ tag: null }, "no_item");
    await refused({ tag: "moonshard:excalibur" }, "unknown_item");
    await refused({ tag: "something else" }, "unknown_item");
    await refused({ to: OTHER }, "not_paid_to_vault");
    await refused({ value: G(19) }, "underpaid");
    // a Transfer event from a contract other than the G$ token proves nothing
    await refused({ logs: [transferLog({ from: p.account.address, to: VAULT, value: G(20), address: OTHER })] }, "not_paid_to_vault");
    // the event must show the G$ leaving the sender's wallet
    await refused({ logs: [transferLog({ from: OTHER, to: VAULT, value: G(20) })] }, "not_paid_to_vault");
    await refused({ from: other.account.address }, "not_your_tx", 403);
    assert.deepEqual(await owned(h, p), []);

    assert.equal((await h.api.post("/shop/confirm", { txHash: "nope" }, { token: p.token })).body.error, "bad_tx");
    assert.equal((await buy(h, p, "0x" + "ee".repeat(32))).status, 404, "a transaction the node does not see yet can be retried");
    assert.equal((await h.api.post("/shop/confirm", { txHash: HASH })).status, 401);
  } finally { await h.close(); }
});

test("paying more than the price is accepted; nobody else can use the transaction", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true, blade: false });
    const b = await h.newPlayer({ verified: true, blade: false });
    setPurchase(h, a, { value: G(25) });
    assert.equal((await buy(h, a)).status, 200);
    // b cannot claim a's transaction
    const theirs = await buy(h, b);
    assert.equal(theirs.status, 403);
    assert.deepEqual(await owned(h, b), []);
  } finally { await h.close(); }
});

test("an item that needs another counts only once that one is bought too; the payment is never lost", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const celestial = setPurchase(h, p, { tag: "moonshard:golden_albatross", value: G(150), hash: "0x" + "c1".repeat(32) });
    const early = await buy(h, p, celestial);
    assert.equal(early.status, 200, "the G$ were paid: the purchase is kept");
    assert.equal(early.body.recorded, true);
    assert.deepEqual(early.body.owned, ["iron_starter"], "but the Celestial blade is not usable without the Glaive");
    const glaive = setPurchase(h, p, { tag: "moonshard:forest_glaive", value: G(60), hash: "0x" + "c2".repeat(32) });
    assert.equal((await buy(h, p, glaive)).status, 200);
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "golden_albatross"]);
  } finally { await h.close(); }
});

test("buying something already owned is recorded (the G$ were spent) and says so", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    setPurchase(h, p);
    const r = await buy(h, p);
    assert.equal(r.status, 200);
    assert.equal(r.body.recorded, true);
    assert.equal(r.body.alreadyOwned, true);
  } finally { await h.close(); }
});

test("what a human bought belongs to the human: a second wallet of the same person owns it too", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true, blade: false });
    const b = await h.newPlayer({ verified: true, root: a.address, blade: false });
    setPurchase(h, b);
    assert.equal((await buy(h, b)).status, 200);
    assert.deepEqual(await owned(h, a), ["iron_starter"]);
    const run = await h.api.post("/runs/start", { mode: "TRIAL" }, { token: a.token });
    assert.equal(run.status, 200);
  } finally { await h.close(); }
});

test("a purchase follows its wallet: bought before the wallet was verified as another person's second wallet, it still counts", async () => {
  const h = await makeHarness();
  try {
    const root = await h.newPlayer({ verified: true, blade: false });
    const w = await h.newPlayer({ blade: false }); // unverified: its own subject
    setPurchase(h, w);
    assert.equal((await buy(h, w)).status, 200);
    h.chain.whitelist(w.account.address, root.address); // later verified, as a second wallet of `root`
    h.ctx.identity.invalidate(w.address);
    assert.deepEqual(await owned(h, w), ["iron_starter"]);
    assert.deepEqual(await owned(h, root), ["iron_starter"], "the person owns what their wallets bought");
    assert.equal((await h.api.post("/runs/start", { mode: "TRIAL" }, { token: w.token })).status, 200);
  } finally { await h.close(); }
});

test("stats: G$ spent in the Moon Shop, from confirmed payments only", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true, blade: false });
    setPurchase(h, p);
    await buy(h, p);
    setPurchase(h, p, { tag: "moonshard:skin_flame", value: G(100), hash: "0x" + "d1".repeat(32) });
    await buy(h, p, "0x" + "d1".repeat(32));
    setPurchase(h, p, { tag: "moonshard:skin_frost", value: G(19), hash: "0x" + "d2".repeat(32) }); // underpaid: refused
    await buy(h, p, "0x" + "d2".repeat(32));
    const s = (await h.api.get("/stats")).body;
    assert.equal(s.shopSpentG, "120");
    assert.equal(s.shopPurchases, 2);
  } finally { await h.close(); }
});
