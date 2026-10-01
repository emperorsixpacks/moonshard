import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { makeHarness } from "./helpers.js";
import { loginMessage } from "../src/auth.js";

async function signLogin(h, account, mutate = (m) => m) {
  const n = await h.api.get("/auth/nonce");
  const message = mutate(loginMessage(n.body.nonce, n.body.issuedAt), n.body);
  const signature = await account.signMessage({ message });
  return { n: n.body, message, signature };
}

test("login succeeds and returns a usable session", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal(p.login.verified, false);
    assert.equal(p.login.status, "unverified");
    const me = await h.api.get("/me", { token: p.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.address, p.address);
    assert.equal(me.body.subject, p.address);
  } finally { await h.close(); }
});

test("whitelisted wallet is verified and subject is its root", async () => {
  const h = await makeHarness();
  try {
    const root = privateKeyToAccount(generatePrivateKey()).address;
    const p = await h.newPlayer({ verified: true, root });
    assert.equal(p.login.verified, true);
    const me = await h.api.get("/me", { token: p.token });
    assert.equal(me.body.subject, root.toLowerCase());
    assert.equal(me.body.status, "verified");
  } finally { await h.close(); }
});

test("a nonce cannot be replayed", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLogin(h, account);
    const body = { address: account.address, message, signature };
    assert.equal((await h.api.post("/auth/verify", body)).status, 200);
    const again = await h.api.post("/auth/verify", body);
    assert.equal(again.status, 401);
    assert.equal(again.body.error, "invalid_nonce");
  } finally { await h.close(); }
});

test("unknown nonce, tampered message and bad signature are rejected", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());

    const fake = loginMessage("a".repeat(64), new Date(h.clock()).toISOString());
    const sigFake = await account.signMessage({ message: fake });
    const r1 = await h.api.post("/auth/verify", { address: account.address, message: fake, signature: sigFake });
    assert.equal(r1.body.error, "invalid_nonce");

    const bad = await signLogin(h, account, (m) => m + "\nExtra: 1");
    const r2 = await h.api.post("/auth/verify", { address: account.address, message: bad.message, signature: bad.signature });
    assert.equal(r2.body.error, "message_mismatch");

    const other = privateKeyToAccount(generatePrivateKey());
    const good = await signLogin(h, account);
    const wrongSig = await other.signMessage({ message: good.message });
    const r3 = await h.api.post("/auth/verify", { address: account.address, message: good.message, signature: wrongSig });
    assert.equal(r3.status, 401);
    assert.equal(r3.body.error, "invalid_signature");

    const r4 = await h.api.post("/auth/verify", { address: "not-an-address", message: good.message, signature: good.signature });
    assert.equal(r4.body.error, "bad_address");
  } finally { await h.close(); }
});

test("a stale issuedAt is rejected even with a valid nonce", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    const n = await h.api.get("/auth/nonce");
    const old = new Date(h.clock() - 10 * 60_000).toISOString();
    const message = loginMessage(n.body.nonce, old);
    const signature = await account.signMessage({ message });
    const r = await h.api.post("/auth/verify", { address: account.address, message, signature });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "stale_message");
  } finally { await h.close(); }
});

test("protected routes need a valid bearer token", async () => {
  const h = await makeHarness();
  try {
    assert.equal((await h.api.get("/me")).body.error, "unauthorized");
    assert.equal((await h.api.get("/me", { token: "garbage" })).body.error, "invalid_session");
  } finally { await h.close(); }
});

test("identity lookups are cached for 5 minutes then refreshed", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const afterLogin = h.chain.state.calls.identity;
    await h.api.get("/me", { token: p.token });
    await h.api.get("/me", { token: p.token });
    assert.equal(h.chain.state.calls.identity, afterLogin);
    h.clock.advance(5 * 60_000 + 1);
    await h.api.get("/me", { token: p.token });
    assert.equal(h.chain.state.calls.identity, afterLogin + 1);
  } finally { await h.close(); }
});

test("/me/refresh sees a fresh verification immediately, but is rate limited", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    h.chain.whitelist(p.account.address); // verified on-chain after login (e.g. just finished face scan)
    const stale = await h.api.get("/me", { token: p.token });
    assert.equal(stale.body.verified, false); // still inside the 5-minute cache
    h.clock.advance(6_000);
    const fresh = await h.api.post("/me/refresh", {}, { token: p.token });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.verified, true);
    assert.equal(fresh.body.status, "verified");
    const again = await h.api.post("/me/refresh", {}, { token: p.token });
    assert.equal(again.status, 429);
    assert.equal(again.body.error, "slow_down");
  } finally { await h.close(); }
});

test("an identity that expires mid-session stops being verified", async () => {
  const h = await makeHarness();
  try {
    const account = privateKeyToAccount(generatePrivateKey());
    h.chain.whitelist(account.address, account.address, h.clock() + 60 * 60_000);
    const p = await h.newPlayer({ verified: false });
    // log the whitelisted account in directly
    const n = await h.api.get("/auth/nonce");
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const login = await h.api.post("/auth/verify", { address: account.address, message, signature });
    assert.equal(login.body.verified, true);
    h.clock.advance(2 * 60 * 60_000);
    const me = await h.api.get("/me", { token: login.body.token });
    assert.equal(me.body.verified, false);
    assert.equal(me.body.status, "expired");
    assert.ok(p.token);
  } finally { await h.close(); }
});

test("RPC outage at login is a 503, and stale cache keeps an existing session alive", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer({ verified: true });
    h.chain.identity = async () => { throw new Error("rpc down"); };
    h.clock.advance(10 * 60_000);
    const me = await h.api.get("/me", { token: p.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.verified, true);

    const fresh = privateKeyToAccount(generatePrivateKey());
    const { message, signature } = await signLogin(h, fresh);
    const r = await h.api.post("/auth/verify", { address: fresh.address, message, signature });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "chain_unavailable");
  } finally { await h.close(); }
});
