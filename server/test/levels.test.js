import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME } from "../config.js";
import { bestLevel, levelCeiling } from "../src/levels.js";
import { makeHarness, playTrial, TOKEN, transferCalldata, transferLog, VAULT } from "./helpers.js";

/*
 * Endless levels, the server's side. A run reports the level it ended on; the server bounds it by the kills the run claims,
 * stores it, and keeps the deepest level of each player's ranked runs. That level opens the blades that ask for one
 * (the Moonsteel Blade at 8, the Starforged Edge at 15, the Cinderbrand at 20, the Voidglass Reaver at 25) and the armour
 * tiers that ask for one (the same four levels, a helm and a shield each), on top of their price and their forest
 * materials: G$ cannot buy the way past a level.
 */

const G = (n) => BigInt(n) * 10n ** 18n;
const status = async (h, p) => (await h.api.get("/rewards/status", { token: p.token })).body;
const owned = async (h, p) => (await status(h, p)).owned;

/**
 * Plays a ranked-looking Trial that ends on `level` having killed `kills` (enough for it unless a test says otherwise), for as long
 * as those kills take at two a second plus a margin: the server bounds a level by the kills AND by the time they could have taken.
 */
const reach = (h, p, level, { kills = 15 * level + 30, durationMs = 20_000 + Math.ceil(kills / 2) * 1_000, ...rest } = {}) =>
  playTrial(h, p, { score: 5_000, kills, level, durationMs, ...rest });

let hashes = 0;
/** Pays for `item` on the fake chain and confirms it, as the game's shop does. */
async function buy(h, p, item, value = GAME.SHOP.find((i) => i.id === item).price) {
  const hash = "0x" + (++hashes).toString(16).padStart(64, "0");
  h.chain.state.txs.set(hash, {
    tx: { from: p.account.address, to: TOKEN, input: transferCalldata(VAULT, value, `moonshard:${item}`) },
    receipt: { status: "success", logs: [transferLog({ from: p.account.address, to: VAULT, value, hash })] },
    timestamp: Math.floor(h.clock() / 1000),
  });
  return h.api.post("/shop/confirm", { txHash: hash }, { token: p.token });
}

// ---- what a run reports -----------------------------------------------------------------------------------------------

test("the most levels a run's kills allow: every level before it has at least 15 foes, and five kills may have gone uncounted", () => {
  assert.deepEqual([0, 9, 10, 24, 25, 55, 100].map((kills) => levelCeiling(kills)), [1, 1, 2, 2, 3, 5, 8]);
  assert.equal(GAME.LEVELS.MIN_FOES_PER_LEVEL, 15);
  assert.equal(GAME.LEVELS.MAX, 1_000);
});

test("and the time they take: no human kills more than two foes a second for long, so kills claimed beyond that buy no depth", () => {
  // 30 s allow 2 x 30 + 10 = 70 kills: a script claiming 360 (12 a second, the looser limit on a bare count) is held to level 6
  assert.equal(levelCeiling(360, 30), 6);
  assert.equal(levelCeiling(360), 25, "without a time only the kills count");
  // the time it takes to be credited with a level is the point: about 45 s for level 8, about three minutes for level 25
  const secondsFor = (level) => { let s = 0; while (levelCeiling(15 * level, s) < level) s += 0.5; return s; };
  assert.deepEqual([8, 15, 20, 25].map(secondsFor), [45, 97.5, 135, 172.5]);
  // an honest player is slower than that: fewer kills than the time allows leave the kills as the bound
  assert.equal(levelCeiling(100, 600), levelCeiling(100));
});

test("a Trial keeps the level it ended on, and the answer says it and the player's best", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await reach(h, p, 6);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.level, res.body.bestLevel, res.body.rankedOk, res.body.flags], [6, 6, true, []]);
    assert.equal((await h.db.query("SELECT level FROM runs WHERE run_id = (SELECT run_id FROM runs ORDER BY submitted_at DESC LIMIT 1)")).rows[0].level, 6);
    assert.equal((await status(h, p)).bestLevel, 6);
  } finally { await h.close(); }
});

test("a run that reports no level (a client from before levels) is accepted as it always was, and has none", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await playTrial(h, p, { score: 5_000, kills: 60 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.level, res.body.bestLevel, res.body.rankedOk], [null, 0, true]);
    assert.equal((await status(h, p)).bestLevel, 0);
  } finally { await h.close(); }
});

test("a level that is not a number from 1 to 1,000 is refused, and the ticket is not spent by it", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = (await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token })).body;
    h.clock.advance(60_500);
    const send = (level) => h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, score: 5_000, kills: 80, shards: 0, durationMs: 60_000, level }, { token: p.token });
    for (const bad of [0, -3, 1_001, "deep", true, [], {}]) { // (NaN and Infinity cannot be sent: JSON turns them into null, which is no level)
      const res = await send(bad);
      assert.deepEqual([res.status, res.body.error], [400, "invalid_level"], `level ${JSON.stringify(bad)}`);
    }
    const ok = await send(5);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.level, 5);
  } finally { await h.close(); }
});

test("a level may be sent as a number string, like the other numbers of a run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await reach(h, p, "7");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.level, 7);
  } finally { await h.close(); }
});

test("a level the claimed kills could not have reached is flagged, stored as the deepest they allow, and not ranked", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    // 20 kills: at most level 2 (1 + (20 + 5) / 15 = 2)
    const res = await reach(h, p, 50, { kills: 20 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.flags, ["level_implausible"]);
    assert.deepEqual([res.body.rankedOk, res.body.level, res.body.bestLevel], [false, 2, 0]);
    assert.equal((await status(h, p)).bestLevel, 0, "a flagged run opens nothing");
  } finally { await h.close(); }
});

test("the level a run may claim is exactly what its kills allow: one kill short is flagged, one level fewer is not", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    // level 9 needs 1 + (kills + 5) / 15 >= 9, so kills >= 115
    const fits = await reach(h, a, 9, { kills: 115 });
    assert.deepEqual([fits.body.flags, fits.body.level, fits.body.rankedOk], [[], 9, true]);
    const short = await reach(h, b, 9, { kills: 114 });
    assert.deepEqual([short.body.flags, short.body.level, short.body.rankedOk], [["level_implausible"], 8, false]);
  } finally { await h.close(); }
});

test("a level is also bounded by the time: 360 kills in 30 s is flagged and held to level 6, and the same kills over 173 s are not", async () => {
  const h = await makeHarness();
  try {
    const script = await h.newPlayer({ verified: true });
    const near = await h.newPlayer({ verified: true });
    const player = await h.newPlayer({ verified: true });
    // 360 kills in 30 s is exactly the 12 a second that the bare kill rate lets through: it used to claim level 25 and open every depth gate
    const forged = await reach(h, script, 25, { kills: 360, durationMs: 30_000 });
    assert.equal(forged.status, 200, JSON.stringify(forged.body));
    assert.deepEqual([forged.body.flags, forged.body.level, forged.body.rankedOk, forged.body.bestLevel], [["level_implausible"], 6, false, 0]);
    assert.equal((await status(h, script)).bestLevel, 0, "a forged run opens nothing");
    // level 25 needs 355 kills and 2 x t + 10 >= 355: 172.5 s. At 172 s it is one kill short, at 173 s it stands.
    const short = await reach(h, near, 25, { kills: 355, durationMs: 172_000 });
    assert.deepEqual([short.body.flags, short.body.level], [["level_implausible"], 24]);
    const fits = await reach(h, player, 25, { kills: 355, durationMs: 173_000 });
    assert.deepEqual([fits.body.flags, fits.body.level, fits.body.rankedOk, fits.body.bestLevel], [[], 25, true, 25]);
  } finally { await h.close(); }
});

test("a Story run has no level, whatever it sends", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = (await h.api.post("/runs/start", { mode: "STORY", chapter: 1 }, { token: p.token })).body;
    h.clock.advance(60_500);
    const res = await h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, score: 2_000, kills: 30, shards: 0, durationMs: 60_000, level: 40 }, { token: p.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.level, res.body.bestLevel, res.body.flags], [null, null, []]);
    assert.equal((await status(h, p)).bestLevel, 0);
  } finally { await h.close(); }
});

// ---- the best level ---------------------------------------------------------------------------------------------------

test("only a ranked run counts: an unverified player's, a run that did not play long enough, and a flagged one do not", async () => {
  const h = await makeHarness();
  try {
    const free = await h.newPlayer(); // not verified: runs are never ranked
    assert.equal((await reach(h, free, 12)).body.rankedOk, false);
    assert.equal((await status(h, free)).bestLevel, 0);

    const quick = await h.newPlayer({ verified: true });
    // under 30 s: on the open board, not ranked (level 4 is the deepest that 20 s of kills can honestly reach: deeper is flagged)
    const short = await reach(h, quick, 4, { durationMs: 20_000 });
    assert.deepEqual([short.body.flags, short.body.rankedOk, short.body.tooShort, short.body.level], [[], false, true, 4], "the level is kept, as the run is");
    assert.equal((await status(h, quick)).bestLevel, 0);
  } finally { await h.close(); }
});

test("the best level is the deepest of all their runs, not the latest, and a deeper one raises it", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    assert.equal((await status(h, p)).bestLevel, 0);
    assert.equal((await reach(h, p, 9)).body.bestLevel, 9);
    assert.equal((await reach(h, p, 3)).body.bestLevel, 9, "a shallower run later does not lower it");
    assert.equal((await reach(h, p, 14)).body.bestLevel, 14);
    assert.equal((await status(h, p)).bestLevel, 14);
    assert.equal(await bestLevel(h.ctx, p.address), 14);
    assert.equal(await bestLevel(h.ctx, "0x" + "0".repeat(40)), 0, "nobody's, nothing");
  } finally { await h.close(); }
});

test("a person's best level is across their wallets: a second wallet's runs, and runs made before it was linked", async () => {
  const h = await makeHarness();
  try {
    const root = await h.newPlayer({ verified: true });
    const second = await h.newPlayer({ verified: true, root: root.address });
    assert.equal((await reach(h, second, 11)).body.bestLevel, 11);
    assert.equal((await status(h, root)).bestLevel, 11, "the person's, from either wallet");

    const w = await h.newPlayer({ verified: true }); // its own person, for now
    await reach(h, w, 16);
    h.chain.whitelist(w.account.address, root.address); // later verified as another wallet of `root`
    h.ctx.identity.invalidate(w.address);
    assert.equal((await status(h, w)).bestLevel, 16);
    assert.equal((await status(h, root)).bestLevel, 16, "what the wallet reached before it was linked is the person's now");
  } finally { await h.close(); }
});

// ---- the blades that ask for a level ------------------------------------------------------------------------------------

test("GET /shop lists the level a blade or a piece of armour asks for, and only the ones that ask", async () => {
  const h = await makeHarness();
  try {
    const items = (await h.api.get("/shop")).body.items;
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    assert.deepEqual(byId.moonsteel_blade, { id: "moonsteel_blade", name: "Moonsteel Blade", kind: "forge", priceG: "100", requires: "forest_glaive", minLevel: 8 });
    assert.deepEqual(byId.starforged_edge, { id: "starforged_edge", name: "Starforged Edge", kind: "forge", priceG: "160", requires: "moonsteel_blade", minLevel: 15 });
    assert.deepEqual(byId.cinderbrand, { id: "cinderbrand", name: "Cinderbrand", kind: "forge", priceG: "200", requires: "starforged_edge", minLevel: 20 });
    assert.deepEqual(byId.voidglass_reaver, { id: "voidglass_reaver", name: "Voidglass Reaver", kind: "forge", priceG: "240", requires: "cinderbrand", minLevel: 25 });
    assert.deepEqual(byId.chitin_helm, { id: "chitin_helm", name: "Chitin Helm", kind: "forge", priceG: "50", requires: "leather_cap", minLevel: 8 });
    assert.deepEqual(byId.lunar_bastion, { id: "lunar_bastion", name: "Lunar Bastion", kind: "forge", priceG: "120", requires: "obsidian_aegis", minLevel: 25 });
    assert.deepEqual(items.filter((i) => "minLevel" in i).map((i) => i.id), [
      "moonsteel_blade", "starforged_edge", "cinderbrand", "voidglass_reaver",
      "chitin_helm", "wardens_helm", "cinder_helm", "moonborn_crown",
      "honeycomb_shield", "bone_bulwark", "obsidian_aegis", "lunar_bastion",
    ]);
    assert.deepEqual(byId.forest_glaive, { id: "forest_glaive", name: "Forest Glaive", kind: "forge", priceG: "60", requires: null });
    // the first piece of each slot has no level and no requirement: it is where the chain starts
    assert.deepEqual(byId.leather_cap, { id: "leather_cap", name: "Leather Cap", kind: "forge", priceG: "15", requires: null });
    assert.deepEqual(byId.oak_buckler, { id: "oak_buckler", name: "Oak Buckler", kind: "forge", priceG: "15", requires: null });
  } finally { await h.close(); }
});

test("a blade that asks for a level: paying early is kept, and it is owned once the level is reached", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    assert.equal((await buy(h, p, "forest_glaive")).status, 200);

    const early = await buy(h, p, "moonsteel_blade"); // level 0: a client that checks first never sends this
    assert.equal(early.status, 200, JSON.stringify(early.body));
    assert.deepEqual([early.body.recorded, early.body.alreadyOwned], [true, false]);
    assert.ok(!early.body.owned.includes("moonsteel_blade"), "paid for, not owned yet");
    assert.ok(!(await owned(h, p)).includes("moonsteel_blade"));

    assert.equal((await reach(h, p, 7)).body.bestLevel, 7);
    assert.ok(!(await owned(h, p)).includes("moonsteel_blade"), "one level short");

    assert.equal((await reach(h, p, 8)).body.bestLevel, 8);
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade"], "owned as the level is reached, with nothing to pay again");
  } finally { await h.close(); }
});

test("each blade past the Glaive needs the one before it as well as its level", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await reach(h, p, 30); // deep enough for all four
    assert.equal((await status(h, p)).bestLevel, 30);

    await buy(h, p, "voidglass_reaver"); // skipping the ones before it
    await buy(h, p, "starforged_edge");
    assert.deepEqual(await owned(h, p), ["iron_starter"], "nothing is reached by skipping a step");

    await buy(h, p, "forest_glaive");
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive"], "the Glaive alone opens none of the others");
    await buy(h, p, "moonsteel_blade");
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade", "starforged_edge"], "each earlier payment counts the moment its requirement is met, as far as the chain is paid");
    await buy(h, p, "cinderbrand");
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade", "starforged_edge", "cinderbrand", "voidglass_reaver"], "and the Voidglass Reaver, paid for long before, is the last link");
  } finally { await h.close(); }
});

test("a blade past the Glaive needs its own level, not just any: 14 is not 15", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    for (const item of ["forest_glaive", "moonsteel_blade", "starforged_edge"]) await buy(h, p, item);
    await reach(h, p, 14);
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade"]);
    await reach(h, p, 15);
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade", "starforged_edge"]);
  } finally { await h.close(); }
});

test("armour is forged tier by tier: each piece needs the one before it in its own slot, and its level", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await reach(h, p, 30);
    for (const item of ["moonborn_crown", "wardens_helm", "chitin_helm"]) await buy(h, p, item); // out of order, the helm's start unpaid
    assert.deepEqual(await owned(h, p), ["iron_starter"], "nothing is reached by skipping the first piece");

    await buy(h, p, "leather_cap");
    assert.deepEqual(await owned(h, p), ["iron_starter", "leather_cap", "chitin_helm", "wardens_helm"], "the Cap opens the chain as far as it is paid");
    await buy(h, p, "oak_buckler");
    assert.deepEqual(await owned(h, p), ["iron_starter", "leather_cap", "chitin_helm", "wardens_helm", "oak_buckler"], "the helm's chain is not the shield's: the Buckler opens none of the shield tiers");
    await buy(h, p, "cinder_helm");
    assert.deepEqual((await owned(h, p)).filter((id) => /helm|crown/.test(id)), ["chitin_helm", "wardens_helm", "cinder_helm", "moonborn_crown"]);
  } finally { await h.close(); }
});

test("a piece of armour needs its own level: 7 is not 8, and paying early is kept", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    for (const item of ["leather_cap", "chitin_helm"]) assert.equal((await buy(h, p, item)).status, 200);
    await reach(h, p, 7);
    assert.deepEqual(await owned(h, p), ["iron_starter", "leather_cap"], "one level short of the Chitin Helm");
    await reach(h, p, 8);
    assert.deepEqual(await owned(h, p), ["iron_starter", "leather_cap", "chitin_helm"], "owned as the level is reached, with nothing to pay again");
  } finally { await h.close(); }
});

test("the first piece of armour needs no level (a new player can put on a Cap and a Buckler) and it counts in the stats of what G$ bought", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await buy(h, p, "leather_cap");
    await buy(h, p, "oak_buckler");
    assert.deepEqual(await owned(h, p), ["iron_starter", "leather_cap", "oak_buckler"]);
    const s = (await h.api.get("/stats")).body;
    assert.equal(s.shopSpentG, "50", "the blade 20, the Cap 15 and the Buckler 15");
  } finally { await h.close(); }
});

test("a level reached by a flagged or unranked run opens nothing, even a deep one", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    for (const item of ["forest_glaive", "moonsteel_blade"]) await buy(h, p, item);
    await reach(h, p, 40, { kills: 20 }); // flagged: the kills cannot have got that far
    await reach(h, p, 4, { durationMs: 20_000 }); // too short to rank (and no deeper than 20 s of kills reach)
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive"]);
    await reach(h, p, 8);
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade"]);
  } finally { await h.close(); }
});

test("the blades are the shop's, so they also count for the stats of what G$ bought", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true, blade: false });
    await buy(h, p, "forest_glaive");
    await buy(h, p, "moonsteel_blade");
    const s = (await h.api.get("/stats")).body;
    assert.equal(s.shopSpentG, "160", "60 + 100, whether or not the level has been reached yet");
    assert.equal(s.shopPurchases, 2);
  } finally { await h.close(); }
});

test("a Trial's start still asks only for the entry blade, however deep the player is", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await reach(h, p, 20);
    assert.equal((await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token })).status, 200);
  } finally { await h.close(); }
});

/** Runs `fn` and returns every SQL text the server sent the database meanwhile. */
async function sqlDuring(h, fn) {
  const seen = [];
  const query = h.db.query;
  h.db.query = (sql, params) => { seen.push(String(sql)); return query.call(h.db, sql, params); };
  try { await fn(); } finally { h.db.query = query; }
  return seen;
}
const readsBestLevel = (sql) => /level IS NOT NULL/.test(sql);

test("starting a Trial does not read the player's depth, however many gated items they own: it asks about the entry blade alone", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await reach(h, p, 8);
    await buy(h, p, "forest_glaive");
    await buy(h, p, "moonsteel_blade"); // paid for and gated: what used to make every run start look the depth up
    assert.deepEqual(await owned(h, p), ["iron_starter", "forest_glaive", "moonsteel_blade"]);
    h.clock.advance(11_000); // the wait between two starts
    let started;
    const sql = await sqlDuring(h, async () => { started = await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token }); });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.ok(sql.length > 0, "the start did read the database");
    assert.equal(sql.filter(readsBestLevel).length, 0, "and none of it was the look-up of the best level");
  } finally { await h.close(); }
});

test("the rewards status reads the best level once, for the field and for what it opens", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    await reach(h, p, 8);
    await buy(h, p, "forest_glaive");
    await buy(h, p, "moonsteel_blade");
    let body;
    const sql = await sqlDuring(h, async () => { body = await status(h, p); });
    assert.deepEqual([body.bestLevel, body.owned.includes("moonsteel_blade")], [8, true]);
    assert.equal(sql.filter(readsBestLevel).length, 1);
  } finally { await h.close(); }
});

// ---- the migrations -----------------------------------------------------------------------------------------------------

test("the runs migrations: the column is added alone, quickly, and the indexes are built in the file after it", async () => {
  // ALTER TABLE keeps its ACCESS EXCLUSIVE lock until its transaction ends: an index built in the same file would hold every
  // read of `runs` through the build. So 005 holds the column only, with a lock_timeout so it cannot queue behind a long query.
  const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
  const column = migration("005_levels.sql");
  assert.match(column, /SET LOCAL lock_timeout/);
  assert.match(column, /ALTER TABLE runs ADD COLUMN IF NOT EXISTS level integer/);
  assert.doesNotMatch(column, /CREATE INDEX/i, "an index built here would hold the table's exclusive lock through the build");
  assert.doesNotMatch(migration("006_run_indexes.sql"), /ALTER TABLE/i, "and the index file takes only the lock that blocks writes");

  const h = await makeHarness();
  try {
    const { rows } = await h.db.query("SELECT indexname FROM pg_indexes WHERE tablename = 'runs' AND indexname IN ('runs_subject_level', 'runs_wallet_level', 'runs_wallet') ORDER BY 1");
    assert.deepEqual(rows.map((r) => r.indexname), ["runs_subject_level", "runs_wallet", "runs_wallet_level"]);
    const done = (await h.db.query("SELECT name FROM _migrations WHERE name LIKE '005%' OR name LIKE '006%' ORDER BY 1")).rows.map((r) => r.name);
    assert.deepEqual(done, ["005_levels.sql", "006_run_indexes.sql"]);
  } finally { await h.close(); }
});
