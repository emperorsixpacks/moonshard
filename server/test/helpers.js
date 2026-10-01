import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, encodeEventTopics, parseAbi, verifyMessage } from "viem";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";

export const T0 = Date.parse("2026-10-05T12:00:00.000Z");
export const UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
export const ENGAGEMENT = "0x25db74CF4E7BA120526fd87e159CF656d94bAE43";
export const VAULT = "0x" + "0".repeat(35) + "ba5e1"; // lowercase: mixed case would trigger checksum validation

// The UBI scheme's claim event, declared here on purpose instead of imported from the server: fixtures
// built from the server's own ABI would stay self-consistent even if that ABI had a typo.
const ubiEvents = parseAbi(["event UBIClaimed(address indexed claimer, uint256 amount)"]);

/**
 * A receipt log shaped like viem's, as the UBI scheme emits it on a real claim:
 * UBIClaimed(address indexed claimer, uint256 amount). `address` is the emitting contract.
 */
export function ubiClaimedLog({ claimer, amount = 1_000_000n, address = UBI, hash = "0x" + "11".repeat(32), logIndex = 0 }) {
  return {
    address,
    topics: encodeEventTopics({ abi: ubiEvents, eventName: "UBIClaimed", args: { claimer } }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    logIndex,
    blockNumber: 1n,
    blockHash: "0x" + "00".repeat(32),
    transactionHash: hash,
    transactionIndex: 0,
    removed: false,
  };
}

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
    trustProxy: 1,
    // Off by default so tests that fire many requests are unaffected; hardening2.test.js turns it on.
    rateLimit: { enabled: false, windowMs: 60_000, general: 300, auth: 30 },
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

/**
 * Plays one honest-looking Daily Shard Trial: start, post checkpoints covering ~70% of the run,
 * then submit. Advances the fake clock. Returns the submit response ({status, body}).
 */
export async function playTrial(h, p, { score = 1000, kills = 20, shards = 0, durationMs = 60_000 } = {}) {
  const run = (await h.api.post("/runs/start", { mode: "TRIAL" }, { token: p.token })).body;
  const first = Math.round(durationMs * 0.7);
  h.clock.advance(first);
  const points = [];
  for (let t = 10_000; t <= first; t += 10_000) {
    const f = t / durationMs;
    points.push({ t, score: Math.floor(score * f), kills: Math.floor(kills * f), shards: Math.floor(shards * f) });
  }
  if (points.length) await h.api.post(`/runs/${run.runId}/checkpoints`, { points }, { token: p.token });
  h.clock.advance(durationMs - first + 500);
  return h.api.post(
    `/runs/${run.runId}/submit`,
    { ticket: run.ticket, score, kills, shards, durationMs },
    { token: p.token },
  );
}
