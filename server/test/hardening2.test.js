import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fakeChain, fakeClock, makeHarness, playTrial, UBI, ubiClaimedLog, VAULT } from "./helpers.js";
import { createDb } from "../src/db.js";
import { createIdentityResolver } from "../src/identity.js";
import { dayKey } from "../src/time.js";
import { rankOf } from "../src/leaderboard.js";
import { settleDue, spoilId } from "../src/spoils.js";
import { vaultAbi } from "../src/chain.js";
import * as cfg from "../config.js";
import * as auth from "../src/auth.js";

// Second hardening pass (H1-H8). Each section names the break it guards against.
// Existing tests were only touched where a deliberate behaviour change invalidated their fixture, never
// their assertions: runs.hardening.test.js (H1: its run now has checkpoint coverage, or no shards are
// credited), ubi.test.js and stats.test.js (H3: their claim txs now carry a UBIClaimed log).

const start = async (h, p, mode = "TRIAL") => {
  const r = await h.api.post("/runs/start", { mode }, { token: p.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const postPoints = (h, p, run, points) =>
  h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
const submitRun = (h, p, run, body) =>
  h.api.post(`/runs/${run.runId}/submit`, { ticket: run.ticket, ...body }, { token: p.token });

// ---------------------------------------------------------------------------------------------
// H1. Shards are credited only for clean runs with checkpoint coverage.
//     Break caught: a forged 5-second ticketed run (start, wait, submit) banking up to 60 shards.
// ---------------------------------------------------------------------------------------------

const shardRows = async (h) => (await h.db.query("SELECT subject, shards FROM shard_days ORDER BY subject")).rows;

/** Starts a TRIAL, posts one valid checkpoint at `cpT`, then submits a run of `durationMs`. */
async function runWithOneCheckpoint(h, p, cpT, { shards = 10, kills = 20, durationMs = 60_000 } = {}) {
  const run = await start(h, p);
  h.clock.advance(cpT + 1_000);
  const posted = await postPoints(h, p, run, [{ t: cpT, score: 100, kills: 2, shards: 1 }]);
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  h.clock.advance(durationMs - cpT + 500);
  return submitRun(h, p, run, { score: 1000, kills, shards, durationMs });
}

test("H1: an honest verified run with checkpoint coverage banks its shards", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const res = await playTrial(h, p, { kills: 20, shards: 10 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await shardRows(h), [{ subject: p.address, shards: 10 }]);
  } finally { await h.close(); }
});

test("H1: a forged 5-second run with no checkpoints is accepted (200) but banks no shards", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(6_000);
    const res = await submitRun(h, p, run, { score: 100, kills: 50, shards: 50, durationMs: 5_500 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rankedOk, false);
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("H1: a flagged run banks no shards even when its checkpoints cover the whole run", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(45_000);
    const good = [10_000, 20_000, 30_000, 40_000].map((t, i) => ({ t, score: (i + 1) * 100, kills: (i + 1) * 5, shards: (i + 1) * 2 }));
    assert.equal((await postPoints(h, p, run, good)).status, 200);
    const bad = await postPoints(h, p, run, [{ t: 41_000, score: 10, kills: 20, shards: 8 }]); // score goes backwards
    assert.equal(bad.status, 422);
    assert.ok(bad.body.reason.includes("cp_regress"));
    h.clock.advance(16_000);
    // last stored checkpoint is at 40s of 60s (coverage 0.67), so only the flag can block the credit
    const res = await submitRun(h, p, run, { score: 600, kills: 25, shards: 10, durationMs: 60_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.flags.includes("cp_regress"));
    assert.deepEqual(await shardRows(h), []);
  } finally { await h.close(); }
});

test("H1: checkpoint coverage must reach half the run: 49% banks nothing, exactly 50% banks", async () => {
  const h = await makeHarness();
  try {
    const under = await h.newPlayer({ verified: true });
    const exact = await h.newPlayer({ verified: true });
    const a = await runWithOneCheckpoint(h, under, 29_000); // 29s of 60s = 0.483
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await runWithOneCheckpoint(h, exact, 30_000); // 30s of 60s = 0.5
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(await shardRows(h), [{ subject: exact.address, shards: 10 }]);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------
// H2. Rate limiting and bounded memory.
// ---------------------------------------------------------------------------------------------

const limited = (general, authBudget) => ({ rateLimit: { enabled: true, windowMs: 60_000, general, auth: authBudget } });

/**
 * A 429 says when the client may come back, in the body: a page on another origin (the game on Vercel, the API on Railway)
 * cannot read the Retry-After header unless it is exposed, and a run that is being submitted needs to know how long to wait.
 */
function assertRateLimited(body) {
  assert.equal(body.error, "rate_limited");
  assert.ok(Number.isFinite(body.retryAfterMs) && body.retryAfterMs > 0 && body.retryAfterMs <= 60_000, `retryAfterMs ${body.retryAfterMs}`);
  assert.deepEqual(Object.keys(body).sort(), ["error", "retryAfterMs"]);
}

test("H2: /api is limited per IP, /api/auth more strictly, with a JSON 429 that browsers can read", async () => {
  const h = await makeHarness({ config: limited(6, 2) });
  try {
    assert.equal((await h.api.get("/auth/nonce")).status, 200);
    assert.equal((await h.api.get("/auth/nonce")).status, 200);
    const strict = await h.api.get("/auth/nonce"); // 3rd auth hit: over the auth budget of 2
    assert.equal(strict.status, 429);
    assertRateLimited(strict.body);

    // 3 of the general budget of 6 are used up by the auth calls above (the limiters stack)
    for (let i = 0; i < 3; i++) assert.equal((await h.api.get("/config")).status, 200);
    const general = await h.api.get("/config");
    assert.equal(general.status, 429);
    assertRateLimited(general.body);

    // the limiter sits behind CORS, so a cross-origin page sees the 429 instead of an opaque network error
    const cors = await fetch(`${h.base}/api/config`, { headers: { origin: "http://localhost:5173" } });
    assert.equal(cors.status, 429);
    assert.ok(cors.headers.get("access-control-allow-origin"), "429 must carry CORS headers");
    assert.ok(Number(cors.headers.get("retry-after")) > 0, "429 must say when to come back");

    assert.equal((await fetch(`${h.base}/health`)).status, 200); // health checks are outside /api
  } finally { await h.close(); }
});

test("H2: the limit is per client behind a proxy (trust proxy), and a spoofed X-Forwarded-For prefix does not dodge it", async () => {
  const h = await makeHarness({ config: { trustProxy: 1, ...limited(2, 2) } });
  try {
    const hit = (xff) => fetch(`${h.base}/api/config`, { headers: { "x-forwarded-for": xff } }).then((r) => r.status);
    // the client prepends junk to X-Forwarded-For; the proxy (one hop) appends the address it really saw
    assert.deepEqual(
      [await hit("10.0.0.1, 203.0.113.7"), await hit("10.0.0.2, 203.0.113.7"), await hit("10.0.0.3, 203.0.113.7")],
      [200, 200, 429],
    );
    assert.equal(await hit("198.51.100.9"), 200); // a different client behind the same proxy is unaffected
  } finally { await h.close(); }
});

test("H2: TRUST_PROXY is parsed into what Express expects (a hop count, never the string \"1\")", () => {
  const cases = [
    [undefined, 1], ["", 1], ["1", 1], [" 2 ", 2], ["0", 0],
    ["false", false], ["true", true], ["TRUE", true], [" False ", false],
    ["loopback, 10.0.0.0/8", "loopback, 10.0.0.0/8"],
  ];
  for (const [input, want] of cases) assert.deepEqual(cfg.parseTrustProxy(input), want, `TRUST_PROXY=${JSON.stringify(input)}`);
});

test("H2: the per-IP request budget can be set (RATE_LIMIT_PER_MIN), and a bad value keeps the default", () => {
  const cases = [[undefined, 300], ["", 300], ["600", 600], [" 1200 ", 1200], ["1", 1], ["0", 300], ["-5", 300], ["lots", 300], ["12.7", 12]];
  for (const [input, want] of cases) assert.equal(cfg.parseRateLimitPerMinute(input), want, `RATE_LIMIT_PER_MIN=${JSON.stringify(input)}`);
});

const wallet = (n) => "0x" + n.toString(16).padStart(40, "0");

test("H2: the identity cache evicts its oldest entry once it holds more than maxEntries", async () => {
  const db = await createDb("");
  try {
    const chain = fakeChain();
    const idr = createIdentityResolver({ chain, db, now: fakeClock(), maxEntries: 3 });
    const lookups = () => chain.state.calls.identity;
    for (const n of [1, 2, 3]) await idr.resolve(wallet(n));
    assert.equal(lookups(), 3);
    await idr.resolve(wallet(4)); // a 4th distinct wallet pushes wallet 1 out
    assert.equal(lookups(), 4);
    for (const n of [2, 3, 4]) await idr.resolve(wallet(n));
    assert.equal(lookups(), 4, "wallets 2-4 are still cached");
    await idr.resolve(wallet(1));
    assert.equal(lookups(), 5, "wallet 1 was evicted, so it is looked up again");
  } finally { await db.close(); }
});

test("H2: an identity entry that was just refreshed is the newest, not the next to be evicted", async () => {
  const db = await createDb("");
  try {
    const chain = fakeChain();
    const clock = fakeClock();
    const idr = createIdentityResolver({ chain, db, now: clock, maxEntries: 2 });
    const lookups = () => chain.state.calls.identity;
    await idr.resolve(wallet(1)); // fetched at t=0
    clock.advance(1);
    await idr.resolve(wallet(2)); // fetched at t=1
    clock.advance(cfg.IDENTITY_TTL_MS - 1); // t=TTL: wallet 1 has just gone stale, wallet 2 is still fresh
    await idr.resolve(wallet(1)); // refetched, so it is now the youngest entry
    assert.equal(lookups(), 3);
    await idr.resolve(wallet(3)); // over the bound: the oldest fetch (wallet 2), not wallet 1, must go
    assert.equal(lookups(), 4);
    await idr.resolve(wallet(1));
    assert.equal(lookups(), 4, "wallet 1 survived");
    await idr.resolve(wallet(2)); // would be a fresh cache hit had it not been evicted
    assert.equal(lookups(), 5, "wallet 2 was the one evicted");
  } finally { await db.close(); }
});

test("H2: the /me/refresh cooldown is exactly 5s, keeps live entries, and sweeps expired ones once past maxEntries", () => {
  const store = new Map();
  let t = 1_000;
  const cooldown = auth.createRefreshCooldown({ now: () => t, cooldownMs: 5_000, maxEntries: 3, store });

  // the window is exactly 5s
  assert.equal(cooldown.tryAcquire("a"), true);
  t = 5_999;
  assert.equal(cooldown.tryAcquire("a"), false, "one ms before the window closes");
  t = 6_000;
  assert.equal(cooldown.tryAcquire("a"), true, "the window has closed");

  // Past the bound, entries still inside their window are kept: they are what enforces the cooldown,
  // so dropping them would let a wallet skip it.
  for (const k of ["b", "c", "d"]) assert.equal(cooldown.tryAcquire(k), true);
  assert.equal(store.size, 4);
  for (const k of ["a", "b", "c", "d"]) assert.equal(cooldown.tryAcquire(k), false, `${k} is still cooling down`);

  // Once they have expired, the next insert past the bound sweeps them out.
  t = 20_000;
  assert.equal(cooldown.tryAcquire("e"), true);
  assert.deepEqual([...store.keys()], ["e"]);
});

test("H2: GET /spoils reads at most the 30 most recent spoils (and makes at most 30 chain lookups)", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const days = Array.from({ length: 35 }, (_, i) => dayKey(Date.UTC(2026, 7, 1 + i))); // 2026-08-01 .. 2026-09-04
    for (const [i, day] of days.entries()) {
      await h.db.query(
        "INSERT INTO spoils(id, kind, day, subject, amount) VALUES ($1,'SHARD_HARVEST',$2,$3,$4)",
        [spoilId(VAULT, "SHARD_HARVEST", day, p.address).toString(), day, p.address, "2000000000000000000"], // ids bound to the vault, as settlement stores them
      );
    }
    let lookups = 0;
    const real = h.chain.voucherClaimed;
    h.chain.voucherClaimed = async (id) => { lookups += 1; return real(id); };
    const res = await h.api.get("/spoils", { token: p.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.spoils.map((s) => s.day), days.slice(5).reverse(), "the newest 30 days, newest first");
    assert.equal(lookups, 30);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------
// H3. /ubi/confirm needs the real UBIClaimed event.
//     Break caught: claim() returns false instead of reverting when there is nothing to claim, so a
//     no-op call "succeeds" and used to earn the blessing and inflate the public UBI-claims metric.
// ---------------------------------------------------------------------------------------------

const UBI_TX = "0x" + "55".repeat(32);
const setUbiTx = (h, { hash = UBI_TX, from, logs }) =>
  h.chain.state.txs.set(hash, {
    tx: { from, to: UBI, input: "0x4e71d92d" },
    receipt: { status: "success", logs },
    timestamp: Math.floor(h.clock() / 1000),
  });
const confirmUbi = (h, p, hash = UBI_TX) => h.api.post("/ubi/confirm", { txHash: hash }, { token: p.token });
const ubiRecords = async (h) => ({
  claims: (await h.db.query("SELECT count(*)::int AS n FROM ubi_claims")).rows[0].n,
  blessings: (await h.db.query("SELECT count(*)::int AS n FROM blessings")).rows[0].n,
});
const stranger = () => privateKeyToAccount(generatePrivateKey()).address;

// The three logs of a real claim() on Celo mainnet (tx 0xc89eb824...a596b), copied literally, with the
// claimer's address swapped for the player's. No encoder and no server ABI are involved, so this pins
// the server to what the chain really emits: topic0 0x89ed2473... for UBIClaimed(address,uint256).
const MAINNET_CLAIMER = "1718da2d5eba538b009feafd151edd88201f06a1";
const MAINNET_CLAIM_LOGS = [
  {
    address: "0x43d72ff17701b2da814620735c39c620ce0ea4a1",
    topics: [
      "0x89ed24731df6b066e4c5186901fffdba18cd9a10f07494aff900bdee260d1304",
      "0x000000000000000000000000" + MAINNET_CLAIMER,
    ],
    data: "0x000000000000000000000000000000000000000000000006361c3c2a478040ee",
  },
  {
    address: "0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a",
    topics: [
      "0x06b541ddaa720db2b10a4d0cdac39b8d360425fc073085fac19bc82614677987",
      "0x00000000000000000000000043d72ff17701b2da814620735c39c620ce0ea4a1",
      "0x00000000000000000000000043d72ff17701b2da814620735c39c620ce0ea4a1",
      "0x000000000000000000000000" + MAINNET_CLAIMER,
    ],
    data: "0x000000000000000000000000000000000000000000000006361c3c2a478040ee0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  },
  {
    address: "0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x00000000000000000000000043d72ff17701b2da814620735c39c620ce0ea4a1",
      "0x000000000000000000000000" + MAINNET_CLAIMER,
    ],
    data: "0x000000000000000000000000000000000000000000000006361c3c2a478040ee",
  },
];
const mainnetClaimLogs = (claimer) =>
  MAINNET_CLAIM_LOGS.map((l, i) => ({
    ...l,
    topics: l.topics.map((t) => t.replaceAll(MAINNET_CLAIMER, claimer.slice(2).toLowerCase())),
    logIndex: i, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: UBI_TX, transactionIndex: 0, removed: false,
  }));

test("H3: a claim() that succeeded but emitted no UBIClaimed event earns no blessing and no metric", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    setUbiTx(h, { from: p.account.address, logs: [] });
    const r = await confirmUbi(h, p);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.error, "no_claim_event");
    assert.deepEqual(await ubiRecords(h), { claims: 0, blessings: 0 });
    assert.equal((await h.api.get("/rewards/status", { token: p.token })).body.blessing, false);
  } finally { await h.close(); }
});

test("H3: a UBIClaimed event for someone else does not count", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    setUbiTx(h, { from: p.account.address, logs: [ubiClaimedLog({ claimer: stranger() })] });
    const r = await confirmUbi(h, p);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.error, "no_claim_event");
    assert.deepEqual(await ubiRecords(h), { claims: 0, blessings: 0 });
  } finally { await h.close(); }
});

test("H3: a UBIClaimed event emitted by a contract other than the UBI scheme does not count", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const lookalike = "0x" + "dead".repeat(10);
    setUbiTx(h, { from: p.account.address, logs: [ubiClaimedLog({ claimer: p.account.address, address: lookalike })] });
    const r = await confirmUbi(h, p);
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.error, "no_claim_event");
    assert.deepEqual(await ubiRecords(h), { claims: 0, blessings: 0 });
  } finally { await h.close(); }
});

test("H3: the three logs of a real mainnet claim are accepted (lowercase addresses, unrelated logs ignored)", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    setUbiTx(h, { from: p.account.address, logs: mainnetClaimLogs(p.account.address) });
    const r = await confirmUbi(h, p);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recorded, true);
    assert.deepEqual(await ubiRecords(h), { claims: 1, blessings: 1 });
  } finally { await h.close(); }
});

test("H3: a linked wallet may confirm when the event names the root, or names the wallet that sent the tx", async () => {
  const h = await makeHarness();
  try {
    const root = await h.newPlayer({ verified: true });
    const linked = await h.newPlayer({ verified: true, root: root.address });

    // the linked wallet sends claim(); the scheme credits the root
    setUbiTx(h, { from: linked.account.address, logs: [ubiClaimedLog({ claimer: root.account.address })] });
    const viaRoot = await confirmUbi(h, linked);
    assert.equal(viaRoot.status, 200, JSON.stringify(viaRoot.body));
    assert.equal(viaRoot.body.recorded, true);

    // same wallet, event naming the sender itself
    const second = "0x" + "66".repeat(32);
    setUbiTx(h, { hash: second, from: linked.account.address, logs: [ubiClaimedLog({ claimer: linked.account.address })] });
    const viaSender = await confirmUbi(h, linked, second);
    assert.equal(viaSender.status, 200, JSON.stringify(viaSender.body));
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------
// H4. rankOf matches by subject, not by wallet.
//     Break caught: wallet W plays unverified (subject W), is later whitelisted as a linked wallet of
//     root R and plays again (subject R). Both score rows carry wallet W, so matching on the wallet
//     returned the first row's position for whichever subject was asked about.
// ---------------------------------------------------------------------------------------------

for (const { name, first, second, want } of [
  { name: "the unverified row is ahead", first: 5000, second: 3000, want: { root: 2, wallet: 1 } },
  { name: "the verified row is ahead", first: 2000, second: 4000, want: { root: 1, wallet: 2 } },
]) {
  test(`H4: one wallet with two score rows in a day ranks each subject by its own row (${name})`, async () => {
    const h = await makeHarness();
    try {
      const root = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
      const w = await h.newPlayer(); // unverified at first: plays as subject W
      assert.equal((await playTrial(h, w, { score: first })).status, 200);
      h.chain.whitelist(w.account.address, root); // W becomes a non-root linked wallet of root R ...
      h.ctx.identity.invalidate(w.address);
      const again = await playTrial(h, w, { score: second }); // ... and now plays as subject R
      assert.equal(again.status, 200, JSON.stringify(again.body));

      const rows = (await h.db.query("SELECT subject, wallet FROM scores ORDER BY subject")).rows;
      assert.deepEqual(rows.map((r) => r.wallet), [w.address, w.address], "scenario: two rows, one wallet");
      assert.deepEqual(rows.map((r) => r.subject).sort(), [root, w.address].sort(), "scenario: two subjects");

      assert.equal(again.body.rank.open, want.root, "rank reported by submit");
      assert.equal(again.body.rank.ranked, 1);
      const day = "2026-10-05";
      assert.equal(await rankOf(h.ctx, day, root, "open"), want.root);
      assert.equal(await rankOf(h.ctx, day, w.address, "open"), want.wallet);
      assert.equal(await rankOf(h.ctx, day, root, "ranked"), 1);
      assert.equal(await rankOf(h.ctx, day, w.address, "ranked"), null, "the unverified row is not on the ranked board");

      // the HTTP board never exposes the subject (the root address)
      const board = await h.api.get("/leaderboard/daily?view=open");
      assert.equal(board.body.entries.length, 2);
      for (const e of board.body.entries) assert.equal("subject" in e, false);
      assert.equal(JSON.stringify(board.body).includes(root), false, "the root address must not appear in the public board");
    } finally { await h.close(); }
  });
}

// ---------------------------------------------------------------------------------------------
// H5. A tx with several Claimed events records every one of the caller's spoils.
//     Break caught: spoil_claims was keyed by tx_hash alone, so only the first event of a multi-claim
//     tx was recorded and the rest were silently dropped (under-reporting "Spoils paid").
// ---------------------------------------------------------------------------------------------

const G = (n) => BigInt(n) * 10n ** 18n;
const SETTLEABLE = Date.parse("2026-10-06T00:42:00.000Z");

const claimedLog = (id, to, amount, hash, logIndex) => ({
  address: VAULT,
  topics: encodeEventTopics({ abi: vaultAbi, eventName: "Claimed", args: { id, to } }),
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  logIndex, blockNumber: 1n, blockHash: "0x" + "00".repeat(32), transactionHash: hash, transactionIndex: 0, removed: false,
});

test("H5: one tx redeeming two of the caller's spoils records both; a relayed tx also serves the other winner; replays record nothing", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    await playTrial(h, a, { score: 500, kills: 40, shards: 30 }); // prize (rank 1) + shard harvest
    await playTrial(h, b, { score: 400 }); // prize (rank 2)
    h.clock.set(SETTLEABLE);
    await settleDue(h.ctx);
    const day = "2026-10-05";
    const aPrize = spoilId(VAULT, "TRIAL_PRIZE", day, a.address);
    const aHarvest = spoilId(VAULT, "SHARD_HARVEST", day, a.address);
    const bPrize = spoilId(VAULT, "TRIAL_PRIZE", day, b.address);

    // one relayed tx paying a (two vouchers) and b (one voucher)
    const hash = "0x" + "ee".repeat(32);
    h.chain.state.txs.set(hash, {
      tx: { from: stranger(), to: VAULT, input: "0x" },
      receipt: {
        status: "success",
        logs: [
          claimedLog(aPrize, a.account.address, G(1000), hash, 0),
          claimedLog(aHarvest, a.account.address, G(60), hash, 1),
          claimedLog(bPrize, b.account.address, G(600), hash, 2),
        ],
      },
      timestamp: Math.floor(h.clock() / 1000),
    });
    const confirm = (p) => h.api.post("/spoils/confirm", { txHash: hash }, { token: p.token });
    const ids = (r) => [...r.body.recorded].sort();

    const first = await confirm(a);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(ids(first), [aPrize.toString(), aHarvest.toString()].sort());
    const second = await confirm(b); // the same tx hash, a different winner
    assert.deepEqual(ids(second), [bPrize.toString()]);

    const count = async () => (await h.db.query("SELECT count(*)::int AS n FROM spoil_claims WHERE tx_hash = $1", [hash])).rows[0].n;
    assert.equal(await count(), 3);
    assert.equal((await h.api.get("/stats")).body.spoilsPaidG, "1660"); // 1000 + 60 + 600

    assert.deepEqual((await confirm(a)).body.recorded, []);
    assert.deepEqual((await confirm(b)).body.recorded, []);
    assert.equal(await count(), 3);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------
// H6. One open run per (subject, mode), even when starts race.
//     Break caught: start = "void the open run, then insert", two statements. Two concurrent starts
//     both void nothing, both insert, and the player holds two open tickets (on real Postgres five
//     concurrent starts left three to five open runs).
//     PGlite runs transactions strictly one at a time, so the race is reproduced by hand below.
// ---------------------------------------------------------------------------------------------

const VOID_STATEMENT = /^UPDATE runs SET status = 'void'/;

const openRunsOf = async (h, subject, mode = "TRIAL") =>
  (await h.db.query("SELECT run_id FROM runs WHERE subject = $1 AND mode = $2 AND status = 'open'", [subject, mode])).rows.map((r) => r.run_id);

test("H6: the database allows only one open run per subject and mode", async () => {
  const h = await makeHarness();
  try {
    const insert = (id, subject, mode, status) =>
      h.db.query(
        `INSERT INTO runs(run_id, subject, wallet, verified, mode, chapter, seed, day, started_at, status)
         VALUES ($1,$2,$2,true,$3,NULL,'seed','2026-10-05',now(),$4)`,
        [id, subject, mode, status],
      );
    await insert("r1", "0xaa", "TRIAL", "open");
    await assert.rejects(insert("r2", "0xaa", "TRIAL", "open"), (err) => err.code === "23505");
    // the rule is narrow: another mode, another subject, and closed runs are all unaffected
    await insert("r3", "0xaa", "STORY", "open");
    await insert("r4", "0xbb", "TRIAL", "open");
    await insert("r5", "0xaa", "TRIAL", "void");
    await insert("r6", "0xaa", "TRIAL", "submitted");
  } finally { await h.close(); }
});

test("H6: a start that loses the race for the open slot retries once and takes over", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    // A competing start has committed its open run, but our void-UPDATE ran before it was visible.
    await h.db.query(
      `INSERT INTO runs(run_id, subject, wallet, verified, mode, chapter, seed, day, started_at)
       VALUES ('rival', $1, $1, false, 'TRIAL', NULL, '2026-10-05', '2026-10-05', now())`,
      [p.address],
    );
    const real = h.db.tx.bind(h.db);
    let attempts = 0;
    h.db.tx = (fn) => {
      const first = ++attempts === 1;
      return real((t) => fn({
        query: (sql, params) => (first && VOID_STATEMENT.test(sql) ? Promise.resolve({ rows: [] }) : t.query(sql, params)),
      }));
    };
    const res = await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(attempts, 2, "the first attempt hits the unique index and the whole transaction is retried once");
    assert.deepEqual(await openRunsOf(h, p.address), [res.body.runId]);
    const rival = await h.db.query("SELECT status FROM runs WHERE run_id = 'rival'");
    assert.equal(rival.rows[0].status, "void");
  } finally { await h.close(); }
});

// A start now also waits 10 s (Trial) / 3 s (Story) after the player's previous one, in this process (runs.limits.test.js).
// That wait would answer 429 to the second of two racing starts before either touches the database, so these two tests
// switch it off: what they pin is the database's own protection, which is what still holds when the racing starts are
// handled by different processes, each with a wait of its own.
const NO_START_WAIT = { startGapMs: { TRIAL: 0, STORY: 0 } };

test("H6: two starts racing at READ COMMITTED both succeed and leave exactly one open run", async () => {
  const h = await makeHarness({ config: NO_START_WAIT });
  try {
    const p = await h.newPlayer();
    // Interleave the statements of the two starts as concurrent Postgres transactions can: both void-UPDATEs
    // run (and match nothing) before either INSERT. Only each start's first attempt takes part in the race.
    const query = h.db.query.bind(h.db);
    let attempts = 0;
    let voided = 0;
    let release;
    const bothVoided = new Promise((resolve) => { release = resolve; });
    h.db.tx = async (fn) => {
      const raced = ++attempts <= 2;
      return fn({
        query: async (sql, params) => {
          const out = await query(sql, params);
          if (raced && VOID_STATEMENT.test(sql)) {
            if (++voided === 2) release();
            await bothVoided;
          }
          return out;
        },
      });
    };
    const body = { mode: "TRIAL" };
    const [a, b] = await Promise.all([
      h.api.post("/runs/start", body, { token: p.token }),
      h.api.post("/runs/start", body, { token: p.token }),
    ]);
    assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body]));
    assert.equal(attempts, 3, "exactly one start lost the race and retried");
    const open = await openRunsOf(h, p.address);
    assert.equal(open.length, 1);
    assert.ok([a.body.runId, b.body.runId].includes(open[0]));
  } finally { await h.close(); }
});

// The unique index plus one retry settles a two-way race, but with three or more racing starts a retrying
// loser can collide with another retrying loser again (measured on real Postgres: 5 concurrent starts for one
// player answered 500 to 45 of 100 requests, though the invariant still held). So each start also takes a
// transaction-scoped advisory lock on its (subject, mode) slot before it voids, which queues racing starts
// instead of colliding them. PGlite cannot show lock effects, so this pins the mechanism: a lock taken first,
// keyed on the slot and on nothing broader.
test("H6: a start locks its (subject, mode) slot before it voids the open run", async () => {
  const h = await makeHarness({ config: NO_START_WAIT });
  try {
    const a = await h.newPlayer();
    const b = await h.newPlayer();
    const real = h.db.tx.bind(h.db);
    let seen = [];
    h.db.tx = (fn) => real((t) => fn({ query: (sql, params) => { seen.push({ sql, params }); return t.query(sql, params); } }));

    const lockKeyOf = async (p, mode, chapter) => {
      seen = [];
      const res = await h.api.post("/runs/start", { mode, chapter }, { token: p.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const lockAt = seen.findIndex((s) => /pg_advisory_xact_lock/.test(s.sql));
      const voidAt = seen.findIndex((s) => VOID_STATEMENT.test(s.sql));
      assert.ok(lockAt >= 0, "no advisory lock was taken");
      assert.ok(lockAt < voidAt, "the lock must come before the void-UPDATE");
      return seen[lockAt].params[0];
    };

    const trialA = await lockKeyOf(a, "TRIAL");
    assert.equal(await lockKeyOf(a, "TRIAL"), trialA, "the same slot always maps to the same lock");
    assert.notEqual(await lockKeyOf(a, "STORY", 1), trialA, "another mode is another slot");
    assert.notEqual(await lockKeyOf(b, "TRIAL"), trialA, "another player is another slot");
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------
// H7. Boot safety.
//     Break caught: the API signs sessions and run tickets with JWT_SECRET. Copying .env.example
//     (a 32-character placeholder) or setting a short secret must not produce a running server.
// ---------------------------------------------------------------------------------------------

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_SECRET = /^JWT_SECRET=(.*)$/m.exec(readFileSync(path.join(SERVER_DIR, ".env.example"), "utf8"))[1];
const FIX_COMMAND = "openssl rand -base64 32";

// Every variable config.js reads. Blanked (not deleted) in the child: dotenv never overrides a variable that
// exists, so this also keeps a developer's real server/.env from leaking keys or addresses into the test.
const CONFIG_VARS = [
  "CORS_ORIGINS", "TRUST_PROXY", "DATABASE_URL", "DATABASE_CA", "CELO_RPC_URL", "CHAIN_ID", "IDENTITY_ADDRESS",
  "UBI_ADDRESS", "GD_TOKEN_ADDRESS", "ENGAGEMENT_ADDRESS", "VAULT_ADDRESS", "VOUCHER_SIGNER_KEY", "APP_SIGNER_KEY",
];

function childEnv(extra) {
  const env = { ...process.env, ...Object.fromEntries(CONFIG_VARS.map((k) => [k, ""])), PORT: "0", ...extra };
  delete env.DOTENV_CONFIG_QUIET; // would hide the very output the quiet test looks for
  delete env.NODE_TEST_CONTEXT; // set by `node --test` for its own children; must not leak into ours
  return env;
}

/** Runs node with `args` in server/ and resolves once it exits (killed after `timeoutMs` if it does not). */
function runNode(args, extraEnv, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: SERVER_DIR, env: childEnv(extraEnv), timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.killed ? "still running (killed)" : error.code) : 0, stdout, stderr });
    });
  });
}

test("H7: assertSecureConfig rejects missing, short and placeholder JWT secrets and says how to fix it", async () => {
  const { assertSecureConfig } = await import("../src/boot.js");
  assert.equal(PLACEHOLDER_SECRET.length, 32, "premise: the placeholder is long enough to pass a length-only check");
  const rejected = {
    "missing": undefined,
    "empty": "",
    "short": "short",
    "31 characters": "a".repeat(31),
    "the .env.example placeholder, verbatim": PLACEHOLDER_SECRET,
    "a long secret that still contains the placeholder": "CHANGE_ME_" + "x".repeat(40),
    "the placeholder in lower case": "change_me_" + "x".repeat(40),
  };
  for (const [label, jwtSecret] of Object.entries(rejected)) {
    assert.throws(() => assertSecureConfig({ jwtSecret }), (err) => err.message.includes(FIX_COMMAND), label);
  }
  const accepted = {
    "exactly 32 characters": "a1B2".repeat(8),
    "the shape of `openssl rand -base64 32` output": "q3ZP0m8xWc1vYtL5nJr2KdH7sBfG9aUe4oVi6XyNu3E=",
    "64 hex characters": "0123456789abcdef".repeat(4),
  };
  for (const [label, jwtSecret] of Object.entries(accepted)) assert.doesNotThrow(() => assertSecureConfig({ jwtSecret }), label);
});

test("H7: the server process exits 1 with the fix command on a short or placeholder JWT_SECRET, and never listens", async () => {
  for (const [label, secret] of [["too short", "short"], ["the .env.example placeholder", PLACEHOLDER_SECRET]]) {
    const r = await runNode(["index.js"], { JWT_SECRET: secret }, 6_000);
    assert.equal(r.code, 1, `${label}: ${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes(FIX_COMMAND), `${label}: stderr was ${JSON.stringify(r.stderr)}`);
    assert.ok(!/API on :/.test(r.stdout), `${label}: it must not have started listening`);
  }
});

test("H7: a good JWT_SECRET still boots the real server", async () => {
  const child = spawn(process.execPath, ["index.js"], { cwd: SERVER_DIR, env: childEnv({ JWT_SECRET: "q3ZP0m8xWc1vYtL5nJr2KdH7sBfG9aUe4oVi6XyNu3E=" }) });
  try {
    const out = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error(`no start-up line within 8s; output so far: ${buf}`)), 8_000);
      child.stdout.on("data", (d) => { buf += d; if (/API on :/.test(buf)) { clearTimeout(timer); resolve(buf); } });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`exited with ${code}: ${buf}`)); });
    });
    assert.match(out, /API on :/);
  } finally { child.kill("SIGKILL"); }
});

test("H7: loading the config prints nothing (dotenv runs quiet)", async () => {
  const r = await runNode(["--input-type=module", "-e", "await import('./config.js')"], { JWT_SECRET: "" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "");
});

// ---------------------------------------------------------------------------------------------
// H8. Checkpoint posts are idempotent.
//     Break caught: a client re-sends a batch after a timeout that the server in fact processed. The
//     repeated points hit `t <= previous`, were flagged cp_time, and the run lost its ranking and the
//     boss bounty over a network hiccup.
// ---------------------------------------------------------------------------------------------

const cp = (t, score, kills, shards) => ({ t, score, kills, shards });
const BATCH = [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => cp(t, (i + 1) * 100, (i + 1) * 3, i + 1));
const storedCheckpoints = async (h, runId) =>
  (await h.db.query("SELECT t_ms, score, kills, shards FROM run_checkpoints WHERE run_id = $1 ORDER BY seq", [runId])).rows;
const flagsOf = async (h, runId) => (await h.db.query("SELECT flags FROM runs WHERE run_id = $1", [runId])).rows[0].flags;

test("H8: re-sending a processed batch is 200 with nothing stored twice, no flag, and the run still ranks", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(55_000);
    const first = await postPoints(h, p, run, BATCH);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body, { ok: true, accepted: 5, duplicates: 0 });

    const again = await postPoints(h, p, run, BATCH);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body, { ok: true, accepted: 0, duplicates: 5 });
    assert.equal((await storedCheckpoints(h, run.runId)).length, 5);
    assert.equal(await flagsOf(h, run.runId), "");

    h.clock.advance(10_500);
    const res = await submitRun(h, p, run, { score: 600, kills: 20, shards: 6, durationMs: 60_000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.flags, []);
    assert.equal(res.body.rankedOk, true);
  } finally { await h.close(); }
});

test("H8: a batch that overlaps stored points stores only the new ones, in order", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(55_000);
    assert.equal((await postPoints(h, p, run, BATCH.slice(0, 3))).status, 200);
    // the client never saw that reply, so it re-sends the last two points together with two new ones
    const overlap = await postPoints(h, p, run, BATCH.slice(1));
    assert.equal(overlap.status, 200, JSON.stringify(overlap.body));
    assert.deepEqual(overlap.body, { ok: true, accepted: 2, duplicates: 2 });
    assert.deepEqual((await storedCheckpoints(h, run.runId)).map((c) => c.t_ms), [10_000, 20_000, 30_000, 40_000, 50_000]);
    // an old point on its own (below the latest stored time) is a duplicate too, not a time regression
    const old = await postPoints(h, p, run, [BATCH[0]]);
    assert.deepEqual(old.body, { ok: true, accepted: 0, duplicates: 1 });
    assert.equal(await flagsOf(h, run.runId), "");
  } finally { await h.close(); }
});

test("H8: points that are not exact copies of a stored one are still flagged", async () => {
  const stored = cp(10_000, 100, 3, 1);
  const cases = [
    ["same time, different score", [cp(10_000, 150, 3, 1)], 0],
    ["same time, different kills", [cp(10_000, 100, 4, 1)], 0],
    ["same time, different shards", [cp(10_000, 100, 3, 2)], 0],
    ["an earlier time that was never stored", [cp(5_000, 50, 1, 0)], 0],
    ["the same new point twice in one batch", [cp(20_000, 200, 6, 2), cp(20_000, 200, 6, 2)], 1],
  ];
  for (const [label, points, wantAccepted] of cases) {
    const h = await makeHarness();
    try {
      const p = await h.newPlayer({ verified: true });
      const run = await start(h, p);
      h.clock.advance(30_000);
      assert.equal((await postPoints(h, p, run, [stored])).status, 200);
      const res = await postPoints(h, p, run, points);
      assert.equal(res.status, 422, `${label}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, "bad_checkpoint", label);
      assert.ok(res.body.reason.includes("cp_time"), `${label}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.accepted, wantAccepted, label);
      assert.ok((await flagsOf(h, run.runId)).includes("cp_time"), label);
    } finally { await h.close(); }
  }
});

test("H8: duplicates in a batch are skipped, and a bad point after them is still flagged", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    const run = await start(h, p);
    h.clock.advance(40_000);
    assert.equal((await postPoints(h, p, run, [BATCH[0]])).status, 200);
    // stored copy, a new valid point, then a point whose score goes backwards
    const res = await postPoints(h, p, run, [BATCH[0], BATCH[1], cp(30_000, 50, 9, 2)]);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.ok(res.body.reason.includes("cp_regress"));
    assert.equal(res.body.accepted, 1);
    assert.equal(res.body.duplicates, 1);
    assert.deepEqual((await storedCheckpoints(h, run.runId)).map((c) => c.t_ms), [10_000, 20_000]);
  } finally { await h.close(); }
});

// A retry that arrives while the original post is still being processed (a slow server is why the client
// timed out) would read the same stored points, accept the same batch, and collide with it on the
// (run_id, seq) key: measured on real Postgres, two concurrent posts of one batch answered 500 to a quarter
// of the requests. So reading, validating and writing a batch happen in one transaction behind a per-run
// advisory lock; the second post then sees the first one's points and reports them as duplicates.
// PGlite cannot show lock effects, so this pins the mechanism.
test("H8: a checkpoint post reads, validates and writes inside one transaction, locked per run", async () => {
  const h = await makeHarness();
  try {
    const a = await h.newPlayer({ verified: true });
    const b = await h.newPlayer({ verified: true });
    const runA = await start(h, a);
    const runB = await start(h, b);
    h.clock.advance(55_000);

    const real = h.db.tx.bind(h.db);
    let seen = [];
    h.db.tx = (fn) => real((t) => fn({ query: (sql, params) => { seen.push({ sql, params }); return t.query(sql, params); } }));
    const lockKeyOf = async (player, run, points) => {
      seen = [];
      const res = await postPoints(h, player, run, points);
      assert.ok([200, 422].includes(res.status), JSON.stringify(res.body));
      const lockAt = seen.findIndex((s) => /pg_advisory_xact_lock/.test(s.sql));
      assert.equal(lockAt, 0, "the run's lock must be the transaction's first statement");
      assert.ok(seen.some((s) => /FROM run_checkpoints/.test(s.sql)), "the stored points are read under the lock");
      return seen[lockAt].params[0];
    };

    const keyA = await lockKeyOf(a, runA, [BATCH[0], BATCH[1]]);
    assert.ok(seen.some((s) => /INSERT INTO run_checkpoints/.test(s.sql)), "new points are written under the lock");
    assert.equal(await lockKeyOf(a, runA, [BATCH[0], BATCH[1]]), keyA, "the same run always maps to the same lock");
    assert.notEqual(await lockKeyOf(b, runB, [BATCH[0]]), keyA, "another run is another lock");

    // a flagged batch records its flag in the same transaction, so a checkpoint and its flag land together
    await lockKeyOf(a, runA, [cp(70_000, 900, 30, 9)]); // more than the clock tolerance ahead of the run: cp_future
    assert.ok(seen.some((s) => /UPDATE runs SET flags/.test(s.sql)), "the flag is written under the lock");
  } finally { await h.close(); }
});
