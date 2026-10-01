import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

export const T0 = Date.parse("2026-10-05T12:00:00.000Z");
export const UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
export const ENGAGEMENT = "0x25db74CF4E7BA120526fd87e159CF656d94bAE43";
export const VAULT = "0x" + "0".repeat(35) + "ba5e1"; // lowercase: mixed case would trigger checksum validation

export function fakeClock(start = T0) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; return t; };
  fn.set = (ms) => { t = ms; };
  return fn;
}

export function fakeChain() {
  const state = {
    roots: new Map(),
    txs: new Map(),
    claimedIds: new Set(),
    engagement: { ok: true, reason: null },
    block: 1_000n,
    calls: { identity: 0 },
  };
  const chain = {
    state,
    whitelist(address, root = address, expiresAt = null) {
      state.roots.set(address.toLowerCase(), { root: root.toLowerCase(), expiresAt });
    },
    async identity(address) {
      state.calls.identity++;
      const hit = state.roots.get(address.toLowerCase());
      if (!hit) return { isWhitelisted: false, root: null, expiresAt: null, expired: false };
      return { isWhitelisted: true, root: hit.root, expiresAt: hit.expiresAt, expired: false };
    },
    verifySignature: (address, message, signature) => verifyMessage({ address, message, signature }),
    async getTx(hash) { return state.txs.get(hash) ?? null; },
    async blockNumber() { return state.block; },
    async canClaimEngagement() { return { ...state.engagement }; },
    async voucherClaimed(id) { return state.claimedIds.has(String(id)); },
  };
  return chain;
}

export async function makeHarness(opts = {}) {
  const clock = opts.clock ?? fakeClock();
  const chain = opts.chain ?? fakeChain();
  const db = await createDb("");
  const config = {
    port: 0,
    jwtSecret: "test-secret",
    corsOrigins: "*",
    databaseUrl: "",
    rpcUrl: "http://unused",
    chainId: 42220,
    contracts: {
      identity: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
      ubi: UBI,
      token: "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
      engagement: ENGAGEMENT,
      vault: VAULT,
    },
    voucherSignerKey: generatePrivateKey(),
    appSignerKey: generatePrivateKey(),
    ...opts.config,
  };
  const { app, ctx } = createApp({ db, chain, config, now: clock });
  const server = await new Promise((resolve) => {
    const s = createServer(app).listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }
  const api = {
    get: (p, o) => call("GET", p, o),
    post: (p, body, o = {}) => call("POST", p, { ...o, body }),
  };

  /** Log in a fresh wallet. Requires the auth routes from Task 4. */
  async function newPlayer({ verified = false, root, host = "browser" } = {}) {
    const { loginMessage } = await import("../src/auth.js");
    const account = privateKeyToAccount(generatePrivateKey());
    if (verified) chain.whitelist(account.address, root ?? account.address);
    const n = await api.get("/auth/nonce");
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const r = await api.post("/auth/verify", { address: account.address, message, signature, host });
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
    return { account, token: r.body.token, address: account.address.toLowerCase(), login: r.body };
  }

  return {
    api, ctx, chain, clock, db, config, newPlayer,
    base,
    close: async () => {
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
