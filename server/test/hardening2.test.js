import test from "node:test";
import assert from "node:assert/strict";
import { fakeChain, fakeClock, makeHarness, playTrial } from "./helpers.js";
import { createDb } from "../src/db.js";
import { createIdentityResolver } from "../src/identity.js";
import { dayKey } from "../src/time.js";
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
