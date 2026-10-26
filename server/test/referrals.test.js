import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAME } from "../config.js";
import { normalizeCode, maskWallet } from "../src/referrals.js";
import { makeHarness, TOKEN } from "./helpers.js";

/*
 * Referrals. A player's invite link carries a code; a friend who signs in through it is recorded once, and the inviter sees
 * how far each friend got: joined (signed in), verified (a real person, per the identity contract) and playing (they own the
 * blade). People are counted once: two wallets of one person are one verified friend, and the inviter's own second wallet is
 * not a friend at all. Tracking only: nothing here pays anything.
 */

const CODE = /^[A-HJKMNP-Z2-9]{8}$/;
const me = (h, p) => h.api.get("/referrals/me", { token: p.token });
const claim = (h, p, code) => h.api.post("/referrals/claim", { code }, { token: p.token });
/** A player who has just signed in and has bought nothing: the only kind of player a link can bring in. */
const fresh = (h, opts = {}) => h.newPlayer({ blade: false, ...opts });
const giveBlade = (h, p) => h.db.query(
  "INSERT INTO purchases(tx_hash, subject, wallet, item_id, amount) VALUES ($1, $2, $3, 'iron_starter', '1')",
  ["0x" + randomBytes(32).toString("hex"), p.address, p.address],
);
/** The identity contract vouches for `p` (under `root`) and the server notices, as after a face scan and "check again". */
async function verifyLater(h, p, root = p.address) {
  h.chain.whitelist(p.address, root);
  h.clock.advance(6_000); // past the refresh cooldown
  const r = await h.api.post("/me/refresh", {}, { token: p.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.verified, true);
}
const counts = (body) => ({ joined: body.joined, verified: body.verified, playing: body.playing });

test("codes: any case and stray spaces are fine, anything that cannot be a code is not", () => {
  assert.equal(normalizeCode("k7m2qx9a"), "K7M2QX9A");
  assert.equal(normalizeCode("  K7M2QX9A\n"), "K7M2QX9A");
  for (const bad of ["", null, undefined, "K7M2QX9", "K7M2QX9AA", "K7M2QX9I", "K7M2QX90", "K7M2 QX9A", 12345678, {}]) {
    assert.equal(normalizeCode(bad), null, `${JSON.stringify(bad)} is not a code`);
  }
});

// the client's copy of the rule is read only where the client source sits next to the server (a server-only checkout has none)
const clientReferral = new URL("../../src/gd/referral.js", import.meta.url);
const hasClient = existsSync(fileURLToPath(clientReferral));

test("the game and the server agree on what a code is", { skip: hasClient ? false : "the client source (src/gd/referral.js) is not next to the server" }, async () => {
  // the game keeps its own copy of the rule (src/gd/referral.js): a code the game sends that the server would refuse, or the
  // other way round, would silently drop invitations
  const { normalizeRefCode } = await import(clientReferral.href);
  const inputs = ["k7m2qx9a", "  K7M2QX9A\n", "K7M2QX9A", "", "nope", "K7M2QX9I", "K7M2QX90", "K7M2QX9", "K7M2QX9AA", "K7M2 QX9A", "ABCDEFGH", "22222222", null, undefined, 42];
  for (const input of inputs) assert.equal(normalizeRefCode(input), normalizeCode(input), JSON.stringify(input));
});

test("a friend's wallet is masked: enough to recognise, not enough to copy", () => {
  assert.equal(maskWallet("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
});

test("GET /referrals/me needs a signed-in player", async () => {
  const h = await makeHarness();
  try {
    assert.equal((await h.api.get("/referrals/me")).status, 401);
    assert.equal((await h.api.post("/referrals/claim", { code: "K7M2QX9A" })).status, 401);
  } finally { await h.close(); }
});

test("every player has one code, the same each time, and no two players share one", async () => {
  const h = await makeHarness();
  try {
    const a = await fresh(h);
    const b = await fresh(h);
    const first = (await me(h, a)).body;
    assert.match(first.code, CODE);
    assert.equal((await me(h, a)).body.code, first.code, "asking again gives the same code");
    assert.notEqual((await me(h, b)).body.code, first.code);
    assert.deepEqual(counts(first), { joined: 0, verified: 0, playing: 0 });
    assert.deepEqual(first.friends, []);
  } finally { await h.close(); }
});

test("two asks at once draw one code", async () => {
  const h = await makeHarness();
  try {
    const a = await fresh(h);
    const [x, y] = await Promise.all([me(h, a), me(h, a)]);
    assert.equal(x.status, 200);
    assert.equal(y.status, 200);
    assert.equal(x.body.code, y.body.code);
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM referral_codes WHERE wallet = $1", [a.address])).rows[0].n, 1);
  } finally { await h.close(); }
});

test("a friend who signs in through a link is recorded, and the inviter sees them join", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const friend = await fresh(h);
    const { code } = (await me(h, boss)).body;
    const r = await claim(h, friend, code);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    const seen = (await me(h, boss)).body;
    assert.deepEqual(counts(seen), { joined: 1, verified: 0, playing: 0 });
    assert.equal(seen.friends.length, 1);
    assert.equal(seen.friends[0].status, "joined");
    assert.equal(seen.friends[0].who, maskWallet(friend.address), "the inviter sees a masked wallet, never the whole address");
    assert.ok(Number.isFinite(Date.parse(seen.friends[0].joinedAt)));
    assert.deepEqual(counts((await me(h, friend)).body), { joined: 0, verified: 0, playing: 0 }, "the friend's own list is their own");
  } finally { await h.close(); }
});

test("a friend moves from joined to verified to playing, and the inviter sees each step", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const friend = await fresh(h);
    await claim(h, friend, (await me(h, boss)).body.code);

    await verifyLater(h, friend);
    let seen = (await me(h, boss)).body;
    assert.deepEqual(counts(seen), { joined: 1, verified: 1, playing: 0 });
    assert.equal(seen.friends[0].status, "verified");

    await giveBlade(h, friend);
    seen = (await me(h, boss)).body;
    assert.deepEqual(counts(seen), { joined: 1, verified: 1, playing: 1 });
    assert.equal(seen.friends[0].status, "playing");
  } finally { await h.close(); }
});

test("a blade without verification is not 'playing': only real people count past 'joined'", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const friend = await fresh(h);
    await claim(h, friend, (await me(h, boss)).body.code);
    await giveBlade(h, friend);
    const seen = (await me(h, boss)).body;
    assert.deepEqual(counts(seen), { joined: 1, verified: 0, playing: 0 });
    assert.equal(seen.friends[0].status, "joined");
  } finally { await h.close(); }
});

test("where there is no shop, 'playing' means the friend has started a run", async () => {
  const h = await makeHarness({ config: { contracts: { identity: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42", ubi: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1", token: TOKEN, engagement: "0x25db74CF4E7BA120526fd87e159CF656d94bAE43", vault: "" } } });
  try {
    const boss = await fresh(h);
    const friend = await fresh(h, { verified: true });
    await claim(h, friend, (await me(h, boss)).body.code);
    assert.deepEqual(counts((await me(h, boss)).body), { joined: 1, verified: 1, playing: 0 });
    assert.equal((await h.api.post("/runs/start", { mode: "TRIAL" }, { token: friend.token })).status, 200);
    assert.deepEqual(counts((await me(h, boss)).body), { joined: 1, verified: 1, playing: 1 });
  } finally { await h.close(); }
});

test("a person is counted once, however many wallets they bring", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const code = (await me(h, boss)).body.code;
    const a = await fresh(h);
    const b = await fresh(h);
    assert.equal((await claim(h, a, code)).status, 200);
    assert.equal((await claim(h, b, code)).status, 200, "two unverified wallets are two strangers as far as the server can tell");
    assert.deepEqual(counts((await me(h, boss)).body), { joined: 2, verified: 0, playing: 0 });

    // the face scan links both wallets to one root: now they are one person
    await verifyLater(h, a, a.address);
    await verifyLater(h, b, a.address);
    await giveBlade(h, b);
    const seen = (await me(h, boss)).body;
    assert.deepEqual(counts(seen), { joined: 2, verified: 1, playing: 1 });
  } finally { await h.close(); }
});

test("the inviter's own second wallet is not a friend", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const second = await fresh(h);
    await claim(h, second, (await me(h, boss)).body.code);
    assert.deepEqual(counts((await me(h, boss)).body), { joined: 1, verified: 0, playing: 0 });
    // both wallets turn out to belong to one person
    await verifyLater(h, boss, boss.address);
    await verifyLater(h, second, boss.address);
    const seen = (await me(h, boss)).body;
    assert.deepEqual(counts(seen), { joined: 0, verified: 0, playing: 0 });
    assert.deepEqual(seen.friends, []);
  } finally { await h.close(); }
});

test("a player cannot use their own code, or the code of their own other wallet", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h, { verified: true });
    const code = (await me(h, boss)).body.code;
    let r = await claim(h, boss, code);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "own_code");

    const sameRoot = await fresh(h, { verified: true, root: boss.address });
    r = await claim(h, sameRoot, code);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "own_code");
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM referrals")).rows[0].n, 0);
  } finally { await h.close(); }
});

test("the first code wins: another code is refused, the same one again is not an error", async () => {
  const h = await makeHarness();
  try {
    const first = await fresh(h);
    const second = await fresh(h);
    const friend = await fresh(h);
    const code1 = (await me(h, first)).body.code;
    const code2 = (await me(h, second)).body.code;
    assert.equal((await claim(h, friend, code1)).status, 200);
    const again = await claim(h, friend, code1);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { ok: true, already: true });
    const other = await claim(h, friend, code2);
    assert.equal(other.status, 409);
    assert.equal(other.body.error, "already_referred");
    assert.equal((await me(h, first)).body.joined, 1);
    assert.equal((await me(h, second)).body.joined, 0);
  } finally { await h.close(); }
});

test("a person who came in through one wallet cannot come in again through another wallet of theirs", async () => {
  const h = await makeHarness();
  try {
    const first = await fresh(h);
    const second = await fresh(h);
    const a = await fresh(h, { verified: true });
    const b = await fresh(h, { verified: true, root: a.address });
    assert.equal((await claim(h, a, (await me(h, first)).body.code)).status, 200);
    const r = await claim(h, b, (await me(h, second)).body.code);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "already_referred");
    assert.equal((await claim(h, b, (await me(h, first)).body.code)).body.already, true);
  } finally { await h.close(); }
});

test("a player who is already playing cannot be claimed", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const code = (await me(h, boss)).body.code;

    const withBlade = await h.newPlayer(); // bought the blade already
    let r = await claim(h, withBlade, code);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "not_new");

    const old = await fresh(h);
    await h.db.query("UPDATE wallets SET first_seen = now() - interval '30 days' WHERE address = $1", [old.address]);
    r = await claim(h, old, code);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "not_new");

    const justUnderTheLimit = await fresh(h);
    await h.db.query("UPDATE wallets SET first_seen = now() - interval '6 days' WHERE address = $1", [justUnderTheLimit.address]);
    assert.equal((await claim(h, justUnderTheLimit, code)).status, 200);
    assert.equal((await me(h, boss)).body.joined, 1);
  } finally { await h.close(); }
});

test("a player who has started a run is not new, even with no purchase on record", async () => {
  const h = await makeHarness({ config: { contracts: { identity: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42", ubi: "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1", token: TOKEN, engagement: "0x25db74CF4E7BA120526fd87e159CF656d94bAE43", vault: "" } } });
  try {
    const boss = await fresh(h);
    const friend = await fresh(h);
    assert.equal((await h.api.post("/runs/start", { mode: "TRIAL" }, { token: friend.token })).status, 200);
    const r = await claim(h, friend, (await me(h, boss)).body.code);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "not_new");
  } finally { await h.close(); }
});

test("a code nobody has, and a string that is not a code", async () => {
  const h = await makeHarness();
  try {
    const friend = await fresh(h);
    let r = await claim(h, friend, "ZZZZZZZZ");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "unknown_code");
    for (const bad of ["", "nope", "K7M2QX9I", null, 42, undefined]) {
      r = await claim(h, friend, bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error, "bad_code");
    }
  } finally { await h.close(); }
});

test("a code is found whatever its case and spacing", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const friend = await fresh(h);
    const { code } = (await me(h, boss)).body;
    assert.equal((await claim(h, friend, `  ${code.toLowerCase()} `)).status, 200);
    assert.equal((await me(h, boss)).body.joined, 1);
  } finally { await h.close(); }
});

test("one wallet claiming twice at once is recorded once", async () => {
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const friend = await fresh(h);
    const { code } = (await me(h, boss)).body;
    const [x, y] = await Promise.all([claim(h, friend, code), claim(h, friend, code)]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.equal((await h.db.query("SELECT count(*)::int AS n FROM referrals")).rows[0].n, 1);
  } finally { await h.close(); }
});

test("the inviter's list is the latest friends, newest first; the counts cover all of them", async (t) => {
  const saved = GAME.REFERRALS.RECENT_LIMIT;
  GAME.REFERRALS.RECENT_LIMIT = 2;
  t.after(() => { GAME.REFERRALS.RECENT_LIMIT = saved; });
  const h = await makeHarness();
  try {
    const boss = await fresh(h);
    const { code } = (await me(h, boss)).body;
    const friends = [];
    for (let i = 0; i < 3; i++) {
      const f = await fresh(h);
      assert.equal((await claim(h, f, code)).status, 200);
      friends.push(f);
    }
    const seen = (await me(h, boss)).body;
    assert.equal(seen.joined, 3);
    assert.deepEqual(seen.friends.map((f) => f.who), [friends[2], friends[1]].map((f) => maskWallet(f.address)));
  } finally { await h.close(); }
});

test("an inviter's wallets are added up: signing in with another wallet of theirs shows the same friends", async () => {
  const h = await makeHarness();
  try {
    const w1 = await fresh(h);
    const w2 = await fresh(h);
    const friend = await fresh(h);
    const code1 = (await me(h, w1)).body.code;
    await claim(h, friend, code1);
    // the face scan links both wallets to one root: they are one person now
    await verifyLater(h, w1, w1.address);
    await verifyLater(h, w2, w1.address);
    const fromW2 = (await me(h, w2)).body;
    assert.equal(fromW2.joined, 1, "the friend that came in through the other wallet's code is theirs too");
    assert.notEqual(fromW2.code, code1, "each wallet keeps its own code, and both keep working");
    assert.equal((await me(h, w1)).body.code, code1);
  } finally { await h.close(); }
});

test("/stats reports the program's totals: friends invited, real people among them, and how many invited them", async () => {
  const h = await makeHarness();
  try {
    const a = await fresh(h);
    const b = await fresh(h);
    const codeA = (await me(h, a)).body.code;
    const codeB = (await me(h, b)).body.code;
    const f1 = await fresh(h);
    const f2 = await fresh(h);
    const f3 = await fresh(h);
    await claim(h, f1, codeA);
    await claim(h, f2, codeA);
    await claim(h, f3, codeB);
    await verifyLater(h, f1);
    await verifyLater(h, f3);
    const stats = (await h.api.get("/stats")).body;
    assert.equal(stats.referralsInvited, 3);
    assert.equal(stats.referralsVerified, 2);
    assert.equal(stats.referrers, 2);
  } finally { await h.close(); }
});
