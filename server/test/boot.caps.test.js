import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { encodeAbiParameters } from "viem";
import { GAME } from "../config.js";
import { checkVaultCaps } from "../src/boot.js";
import { startSettlementCron } from "../src/cron.js";
import { VAULT } from "./helpers.js";

// The vault refuses any voucher above maxPerVoucher and any day's claims above dailyCap, but nothing used to compare
// those caps with the prizes this server signs. Prizes larger than the caps are signed, shown to the winner, and revert
// on-chain (OverVoucherCap / OverDailyCap): a winner who can never be paid. The server now checks at boot and says so.

const G = (n) => BigInt(n) * 10n ** 18n;
const PRIZES = [G(1000), G(600), G(300)]; // what GAME.PRIZES says today; the sum is 1,900 G$

const logger = () => {
  const lines = { info: [], warn: [], error: [] };
  return { lines, info: (...a) => lines.info.push(a.join(" ")), warn: (...a) => lines.warn.push(a.join(" ")), error: (...a) => lines.error.push(a.join(" ")) };
};
const reader = (values) => async ({ functionName }) => values[functionName];
const config = (over = {}) => ({ rpcUrl: "http://unused", contracts: { vault: VAULT }, ...over });

test("premise: GAME.PRIZES is 1000 / 600 / 300 G$ (1,900 G$ a day), so these tests mean what they say", () => {
  assert.deepEqual(GAME.PRIZES, PRIZES);
});

test("caps that cover the prizes: no warning, and the numbers are logged", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: reader({ maxPerVoucher: G(1000), dailyCap: G(5000) }) });
  assert.equal(out.checked, true);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(log.lines.warn, []);
  assert.equal(log.lines.info.length, 1);
  assert.match(log.lines.info[0], /maxPerVoucher 1000 G\$/);
  assert.match(log.lines.info[0], /dailyCap 5000 G\$/);
  assert.match(log.lines.info[0], /31 full shard harvests/, "(5000 - 1900) / 100 players' worth of harvest");
});

test("exactly equal to the prizes is fine (the vault refuses only amounts above the cap)", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: reader({ maxPerVoucher: G(1000), dailyCap: G(1900) }) });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(log.lines.warn, []);
});

test("maxPerVoucher below the first prize: a loud warning with both numbers", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: reader({ maxPerVoucher: G(500), dailyCap: G(5000) }) });
  assert.deepEqual(out.problems.map((p) => p.code), ["max_per_voucher"]);
  assert.equal(log.lines.warn.length, 1);
  assert.match(log.lines.warn[0], /WARNING/);
  assert.match(log.lines.warn[0], /1000 G\$/, "the prize");
  assert.match(log.lines.warn[0], /500 G\$/, "the cap");
  assert.match(log.lines.warn[0], /maxPerVoucher/);
  assert.match(log.lines.warn[0], /setCaps/, "and how to fix it");
});

test("a shard harvest voucher (50 shards x 2 G$ = 100 G$) above maxPerVoucher is caught too", async () => {
  const log = logger();
  const prizes = [G(40), G(30), G(20)]; // prizes fit; the 100 G$ harvest does not
  const out = await checkVaultCaps({ config: config(), log, prizes, read: reader({ maxPerVoucher: G(50), dailyCap: G(5000) }) });
  assert.deepEqual(out.problems.map((p) => p.code), ["max_per_voucher"]);
  assert.match(log.lines.warn[0], /100 G\$/);
  assert.match(log.lines.warn[0], /50 G\$/);
});

test("dailyCap below the sum of the daily prizes: a loud warning with the numbers and the rule of thumb", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: reader({ maxPerVoucher: G(1000), dailyCap: G(1500) }) });
  assert.deepEqual(out.problems.map((p) => p.code), ["daily_cap"]);
  assert.match(log.lines.warn[0], /WARNING/);
  assert.match(log.lines.warn[0], /1900 G\$/, "the prizes of one day");
  assert.match(log.lines.warn[0], /1500 G\$/, "the cap");
  assert.match(log.lines.warn[0], /1900 \+ 100/, "dailyCap >= 1,900 + 100 x verified players");
});

test("both caps too low: two warnings", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: reader({ maxPerVoucher: G(10), dailyCap: G(10) }) });
  assert.deepEqual(out.problems.map((p) => p.code), ["max_per_voucher", "daily_cap"]);
  assert.equal(log.lines.warn.length, 2);
});

test("a dailyCap that covers the prizes but little more is reported as room for a few players, not as an error", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: reader({ maxPerVoucher: G(1000), dailyCap: G(2050) }) });
  assert.deepEqual(out.problems, []);
  assert.match(log.lines.info[0], /1 full shard harvest\b/);
});

test("no vault configured: nothing to check, nothing read", async () => {
  const log = logger();
  let reads = 0;
  const out = await checkVaultCaps({ config: config({ contracts: { vault: "" } }), log, read: async () => { reads += 1; return 0n; } });
  assert.deepEqual(out, { checked: false, reason: "no_vault" });
  assert.equal(reads, 0);
  assert.deepEqual(log.lines.warn, []);
});

test("an RPC error never throws and never blocks boot: one note, no false alarm", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, read: async () => { throw new Error("rpc down"); } });
  assert.deepEqual(out, { checked: false, reason: "rpc_error" });
  assert.equal(log.lines.warn.length, 1);
  assert.match(log.lines.warn[0], /could not read the vault caps/);
  assert.match(log.lines.warn[0], /rpc down/);
  assert.doesNotMatch(log.lines.warn[0], /WARNING: prize/);
});

test("a hanging RPC is given up on after the timeout instead of holding boot", async () => {
  const log = logger();
  const out = await checkVaultCaps({ config: config(), log, timeoutMs: 20, read: () => new Promise(() => {}) });
  assert.deepEqual(out, { checked: false, reason: "rpc_error" });
  assert.match(log.lines.warn[0], /timed out/);
});

// --- the real read path: viem + the two selectors, against a local JSON-RPC endpoint ----------------------------

// The selectors of MoonshardVault.maxPerVoucher() and dailyCap(), written out (from `cast sig`) so that they do not
// depend on the code under test.
const MAX_PER_VOUCHER_SELECTOR = "0x96c991c8";
const DAILY_CAP_SELECTOR = "0xeb339391";

async function fakeRpc(values) {
  const selectors = {
    [MAX_PER_VOUCHER_SELECTOR]: values.maxPerVoucher,
    [DAILY_CAP_SELECTOR]: values.dailyCap,
  };
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const rpc = JSON.parse(body);
      const reply = (result) => res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      if (rpc.method !== "eth_call") return reply("0x");
      const { to, data } = rpc.params[0];
      seen.push({ to: to.toLowerCase(), selector: data.slice(0, 10) });
      const value = selectors[data.slice(0, 10)];
      reply(value === undefined ? "0x" : encodeAbiParameters([{ type: "uint256" }], [value]));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test("the default reader asks the vault for maxPerVoucher() and dailyCap() over JSON-RPC", async () => {
  const rpc = await fakeRpc({ maxPerVoucher: G(1000), dailyCap: G(1000) });
  try {
    const log = logger();
    const out = await checkVaultCaps({ config: config({ rpcUrl: rpc.url }), log });
    assert.equal(out.checked, true);
    assert.equal(out.maxPerVoucher, G(1000));
    assert.equal(out.dailyCap, G(1000));
    assert.deepEqual(out.problems.map((p) => p.code), ["daily_cap"], "1000 < 1900");
    assert.deepEqual(rpc.seen.map((s) => s.to), [VAULT, VAULT]);
    assert.deepEqual(rpc.seen.map((s) => s.selector).sort(), [MAX_PER_VOUCHER_SELECTOR, DAILY_CAP_SELECTOR].sort());
  } finally { await rpc.close(); }
});

test("the default reader on a dead endpoint reports rpc_error and returns", async () => {
  const rpc = await fakeRpc({});
  await rpc.close(); // nothing listens on this port any more
  const log = logger();
  const out = await checkVaultCaps({ config: config({ rpcUrl: rpc.url }), log, timeoutMs: 3_000 });
  assert.deepEqual(out, { checked: false, reason: "rpc_error" });
});

// --- it actually runs at boot ------------------------------------------------------------------------------------

test("startSettlementCron runs the cap check once at start-up, without awaiting it", async () => {
  const calls = [];
  const stop = startSettlementCron(
    { config: config(), now: () => 0, db: { query: async () => ({ rows: [] }), tx: async () => ({}) } },
    3_600_000,
    {
      janitorIntervalMs: 3_600_000,
      checkCaps: (args) => { calls.push(args); return new Promise(() => {}); }, // never settles: boot must not wait for it
    },
  );
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].config.contracts.vault, VAULT);
  } finally { stop(); }
});

test("startSettlementCron survives a cap check that rejects", async () => {
  const stop = startSettlementCron(
    { config: config(), now: () => 0, db: { query: async () => ({ rows: [] }), tx: async () => ({}) } },
    3_600_000,
    { janitorIntervalMs: 3_600_000, checkCaps: () => Promise.reject(new Error("boom")) },
  );
  await new Promise((r) => setTimeout(r, 20));
  stop();
});
