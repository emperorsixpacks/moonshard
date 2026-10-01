import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";
import { IDENTITY_STALE_MAX_MS, createIdentityResolver } from "../src/identity.js";
import { fakeChain, fakeClock, makeHarness } from "./helpers.js";

const wallet = "0x" + "ab".repeat(20);

async function resolverFor(chain, clock, opts = {}) {
  const db = await createDb("");
  return { db, idr: createIdentityResolver({ chain, db, now: clock, ...opts }) };
}

// ---------------------------------------------------------------------------------------------
// Finding 10a. When the chain cannot be read, the last answer is served so that an RPC blip does not lock players
// out. That used to have no age limit: a player whose verification lapsed (or was revoked) while the RPC was down
// stayed verified for as long as the outage lasted. It is now capped at 30 minutes.
// ---------------------------------------------------------------------------------------------

test("a stale identity is served through an RPC outage for 30 minutes at most", async () => {
  assert.equal(IDENTITY_STALE_MAX_MS, 30 * 60_000);
  const clock = fakeClock();
  const chain = fakeChain(clock);
  chain.whitelist(wallet);
  const { db, idr } = await resolverFor(chain, clock);
  try {
    assert.equal((await idr.resolve(wallet)).verified, true); // read from the chain at T0
    const working = chain.identity;
    chain.identity = async () => { throw new Error("rpc down"); };

    clock.advance(IDENTITY_STALE_MAX_MS - 1);
    const stale = await idr.resolve(wallet);
    assert.equal(stale.verified, true, "29:59 old: still served");
    assert.equal(stale.status, "verified");

    clock.advance(1);
    await assert.rejects(idr.resolve(wallet), (err) => err.code === "CHAIN_UNAVAILABLE" && err.message === "chain unavailable", "30:00 old: refused");
    clock.advance(60 * 60_000);
    await assert.rejects(idr.resolve(wallet), (err) => err.code === "CHAIN_UNAVAILABLE", "and it stays refused");

    chain.identity = working; // the RPC is back: the identity is read again
    assert.equal((await idr.resolve(wallet)).verified, true);
  } finally { await db.close(); }
});

test("failed refreshes do not make a stale identity any younger", async () => {
  const clock = fakeClock();
  const chain = fakeChain(clock);
  chain.whitelist(wallet);
  const { db, idr } = await resolverFor(chain, clock);
  try {
    await idr.resolve(wallet); // T0
    chain.identity = async () => { throw new Error("rpc down"); };
    for (let i = 0; i < 5; i++) {
      clock.advance(5 * 60_000 + 1); // every call is past the 5-minute cache and fails
      await idr.resolve(wallet).catch(() => {});
    }
    // T0 + 25m05s so far; one more 5-minute step crosses 30 minutes since the last SUCCESSFUL read
    clock.advance(5 * 60_000);
    await assert.rejects(idr.resolve(wallet), (err) => err.code === "CHAIN_UNAVAILABLE");
  } finally { await db.close(); }
});

test("the age limit can be set per resolver", async () => {
  const clock = fakeClock();
  const chain = fakeChain(clock);
  chain.whitelist(wallet);
  const { db, idr } = await resolverFor(chain, clock, { staleMaxMs: 1_000 });
  try {
    await idr.resolve(wallet);
    chain.identity = async () => { throw new Error("rpc down"); };
    clock.advance(5 * 60_000); // past the cache, so the chain is asked and fails
    await assert.rejects(idr.resolve(wallet), (err) => err.code === "CHAIN_UNAVAILABLE", "5 minutes old with a 1 s limit");
  } finally { await db.close(); }
});

test("over HTTP, an outage that outlasts the limit ends sessions with a 503", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    h.chain.identity = async () => { throw new Error("rpc down"); };
    h.clock.advance(20 * 60_000);
    assert.equal((await h.api.get("/me", { token: p.token })).status, 200, "20 minutes into the outage the session still works");
    h.clock.advance(11 * 60_000);
    const down = await h.api.get("/me", { token: p.token });
    assert.equal(down.status, 503);
    assert.equal(down.body.error, "chain_unavailable");
  } finally { await h.close(); }
});

// ---------------------------------------------------------------------------------------------
// Finding 10b. chain.js estimates `expiresAt` from authenticationPeriod() (the LAST, longest reverify step), while
// the contract re-verifies after reverifyDaysOptions[authCount] days (1, 7, then 180 with the default schedule).
// getWhitelistedRoot() already applies the real schedule, so `isWhitelisted` is the only liveness input; the
// estimate is reported for information and never flips `verified`.
// ---------------------------------------------------------------------------------------------

test("verified follows the chain's answer, not our own expiresAt estimate", async () => {
  const clock = fakeClock();
  const chain = fakeChain(); // static: answers exactly what it was told, whatever the time
  chain.whitelist(wallet, wallet, clock() - 24 * 3600_000); // an estimate that is a day in the past
  const { db, idr } = await resolverFor(chain, clock);
  try {
    const who = await idr.resolve(wallet);
    assert.equal(who.verified, true, "the chain says whitelisted");
    assert.equal(who.status, "verified");
    assert.equal(who.subject, wallet);
    assert.equal(who.expiresAt, clock() - 24 * 3600_000, "the estimate is still passed on for information");
  } finally { await db.close(); }
});

test("an account the chain reports as lapsed is expired, one it never knew is unverified", async () => {
  const clock = fakeClock();
  const chain = fakeChain(clock);
  const { db, idr } = await resolverFor(chain, clock);
  try {
    chain.identity = async () => ({ isWhitelisted: false, root: null, expiresAt: null, expired: true });
    const lapsed = await idr.resolve(wallet);
    assert.equal(lapsed.verified, false);
    assert.equal(lapsed.status, "expired");
    assert.equal(lapsed.subject, wallet, "plays as itself");

    idr.invalidate(wallet);
    chain.identity = async () => ({ isWhitelisted: false, root: null, expiresAt: null, expired: false });
    const never = await idr.resolve(wallet);
    assert.equal(never.verified, false);
    assert.equal(never.status, "unverified");
  } finally { await db.close(); }
});

test("a lapsed identity stops being verified at the next chain read (the fake chain now applies expiry the way the contract does)", async () => {
  const clock = fakeClock();
  const chain = fakeChain(clock);
  chain.whitelist(wallet, wallet, clock() + 60 * 60_000);
  const { db, idr } = await resolverFor(chain, clock);
  try {
    assert.equal((await idr.resolve(wallet)).verified, true);
    clock.advance(2 * 60 * 60_000);
    const later = await idr.resolve(wallet);
    assert.equal(later.verified, false);
    assert.equal(later.status, "expired");
  } finally { await db.close(); }
});
