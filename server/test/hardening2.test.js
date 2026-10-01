import test from "node:test";
import assert from "node:assert/strict";
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

// Second hardening pass (H1-H8). Existing test files stay as they were, except for the fixtures
// that an item explicitly changes. Each section names the break it guards against.

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
  const cp = await postPoints(h, p, run, [{ t: cpT, score: 100, kills: 2, shards: 1 }]);
  assert.equal(cp.status, 200, JSON.stringify(cp.body));
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

test("H2: /api is limited per IP, /api/auth more strictly, with a JSON 429 that browsers can read", async () => {
  const h = await makeHarness({ config: limited(6, 2) });
  try {
    assert.equal((await h.api.get("/auth/nonce")).status, 200);
    assert.equal((await h.api.get("/auth/nonce")).status, 200);
    const strict = await h.api.get("/auth/nonce"); // 3rd auth hit: over the auth budget of 2
    assert.equal(strict.status, 429);
    assert.deepEqual(strict.body, { error: "rate_limited" });

    // 3 of the general budget of 6 are used up by the auth calls above (the limiters stack)
    for (let i = 0; i < 3; i++) assert.equal((await h.api.get("/config")).status, 200);
    const general = await h.api.get("/config");
    assert.equal(general.status, 429);
    assert.deepEqual(general.body, { error: "rate_limited" });

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
        [String(1000 + i), day, p.address, "2000000000000000000"],
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
    const aPrize = spoilId("TRIAL_PRIZE", day, a.address);
    const aHarvest = spoilId("SHARD_HARVEST", day, a.address);
    const bPrize = spoilId("TRIAL_PRIZE", day, b.address);

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

test("H6: two starts racing at READ COMMITTED both succeed and leave exactly one open run", async () => {
  const h = await makeHarness();
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
  const h = await makeHarness();
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
