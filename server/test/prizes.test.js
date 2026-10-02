import test from "node:test";
import assert from "node:assert/strict";
import { parsePrizesEnabled } from "../config.js";
import { assertSecureConfig, checkVaultCaps } from "../src/boot.js";
import { settleDue } from "../src/spoils.js";
import { makeHarness, playTrial, VAULT } from "./helpers.js";

/*
 * Owner decision (2026-10-02): no prizes until the game has players. With PRIZES_ENABLED off (the default), the game pays
 * out nothing from the vault: no daily prizes, no Shard Harvest, no vouchers, and nothing promises them. The daily G$
 * claim (GoodDollar's), the first-boss bounty (GoodDollar's pool) and the Moon Shop (payments INTO the vault) are not prizes
 * and keep working. A day played while prizes are off is closed with nothing owed, so turning them on later never pays it.
 */

const off = (over = {}) => makeHarness({ ...over, config: { prizesEnabled: false, ...over.config } });

test("PRIZES_ENABLED: off unless it says so", () => {
  for (const v of [undefined, "", "false", "0", "no", "off", "nonsense"]) assert.equal(parsePrizesEnabled(v), false, String(v));
  for (const v of ["true", "1", "yes", "on", "TRUE", " on "]) assert.equal(parsePrizesEnabled(v), true, v);
});

test("with prizes off, /config says so and promises no amounts", async () => {
  const h = await off();
  try {
    const cfg = (await h.api.get("/config")).body;
    assert.equal(cfg.prizesEnabled, false);
    assert.deepEqual(cfg.prizesG, []);
    assert.equal(cfg.shardRateG, "0");
    assert.equal(cfg.dailyShardCap, 0);
    const daily = (await h.api.get("/leaderboard/daily")).body;
    assert.deepEqual(daily.prizesG, [], "the daily board names no prizes");
  } finally { await h.close(); }
});

test("with prizes off, a player's status shows no harvest", async () => {
  const h = await off();
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { kills: 40, shards: 30 });
    const st = (await h.api.get("/rewards/status", { token: p.token })).body;
    assert.equal(st.prizesEnabled, false);
    assert.deepEqual(
      { gdEarned: st.crystalStatus.gdEarned, dailyCapGd: st.crystalStatus.dailyCapGd, rateGd: st.crystalStatus.rateGd, isCapped: st.crystalStatus.isCapped },
      { gdEarned: 0, dailyCapGd: 0, rateGd: 0, isCapped: false },
    );
  } finally { await h.close(); }
});

test("with prizes off, a played day is closed with nothing owed, and turning prizes on later does not pay it", async () => {
  const h = await off();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await playTrial(h, p, { score: 5000, kills: 40, shards: 30 });
    assert.equal(run.body.rankedOk, true, "the run is ranked: there is a winner to pay, if prizes were on");
    h.clock.advance(27 * 3600_000);
    const settled = await settleDue(h.ctx);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].settled, true);
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM spoils")).rows[0].n, 0, "no prize, no harvest");
    assert.deepEqual((await h.api.get("/spoils", { token: p.token })).body.spoils, []);

    h.ctx.config.prizesEnabled = true; // the owner turns prizes on
    assert.deepEqual(await settleDue(h.ctx), [], "the day is closed: nothing is settled again");
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM spoils")).rows[0].n, 0);
  } finally { await h.close(); }
});

test("prizes on (as before): the same day pays its winner and the harvest", async () => {
  const h = await makeHarness(); // the harness turns prizes on, as the tests of prizes need
  try {
    const p = await h.newPlayer({ verified: true });
    await playTrial(h, p, { score: 5000, kills: 40, shards: 30 });
    h.clock.advance(27 * 3600_000);
    await settleDue(h.ctx);
    const kinds = (await h.db.query("SELECT kind FROM spoils ORDER BY kind")).rows.map((r) => r.kind);
    assert.deepEqual(kinds, ["SHARD_HARVEST", "TRIAL_PRIZE"]);
  } finally { await h.close(); }
});

test("with prizes off, the shop and its vault need no voucher signer, and the vault's caps are not checked", async () => {
  const production = { NODE_ENV: "production" };
  const base = { jwtSecret: "a-long-random-looking-secret-0123456789abcdef", databaseUrl: "postgres://u:p@db.example/m?sslmode=require", contracts: { vault: VAULT }, voucherSignerKey: "" };
  assert.doesNotThrow(() => assertSecureConfig({ ...base, prizesEnabled: false }, { env: production, warn() {} }));
  assert.throws(() => assertSecureConfig({ ...base, prizesEnabled: true }, { env: production }), /VOUCHER_SIGNER_KEY/);

  const lines = [];
  let reads = 0;
  const out = await checkVaultCaps({
    config: { rpcUrl: "http://unused", contracts: { vault: VAULT }, prizesEnabled: false },
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) },
    read: async () => { reads += 1; return 0n; },
  });
  assert.equal(reads, 0, "nothing is read");
  assert.equal(out.checked, false);
  assert.match(lines.join(" "), /prizes are off/i);
});
