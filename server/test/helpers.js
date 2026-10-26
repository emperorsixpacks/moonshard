import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient, custom, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, parseAbi,
  verifyMessage, zeroAddress,
} from "viem";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { createEngagementReward } from "../src/engagement.js";

export const T0 = Date.parse("2026-10-05T12:00:00.000Z");
export const UBI = "0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1";
export const ENGAGEMENT = "0x25db74CF4E7BA120526fd87e159CF656d94bAE43";
export const TOKEN = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
export const VAULT = "0x" + "0".repeat(35) + "ba5e1"; // lowercase: mixed case would trigger checksum validation

// The UBI scheme's claim event, declared here on purpose instead of imported from the server: fixtures
// built from the server's own ABI would stay self-consistent even if that ABI had a typo.
const ubiEvents = parseAbi(["event UBIClaimed(address indexed claimer, uint256 amount)"]);
// The G$ token's transfer, declared here for the same reason.
const tokenAbi = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** A receipt log shaped like viem's: Transfer(from, to, value) emitted by `address` (the G$ token by default). */
export function transferLog({ from, to, value, address = TOKEN, hash = "0x" + "11".repeat(32), logIndex = 0 }) {
  return {
    address,
    topics: encodeEventTopics({ abi: tokenAbi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex,
    blockNumber: 1n,
    blockHash: "0x" + "00".repeat(32),
    transactionHash: hash,
    transactionIndex: 0,
    removed: false,
  };
}

/** The calldata of transfer(to, value), followed by `tag` (UTF-8) when one is given: how the game names what a payment buys. */
export function transferCalldata(to, value, tag) {
  const call = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [to, value] });
  return tag === undefined ? call : call + Buffer.from(tag, "utf8").toString("hex");
}

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

// The EngagementRewards getters the server reads, declared here on purpose in their FULL deployed shape (the SDK's ABI
// of 0x25db...AE43), not imported from the server: the server decodes only the first nine fields of registeredApps,
// and a fixture built from the server's own ABI could not show that this is enough.
const engagementFixtureAbi = parseAbi([
  "function rewardAmount() view returns (uint96)",
  "function registeredApps(address) view returns (address owner, address rewardReceiver, uint96 totalRewardsClaimed, uint32 registeredAt, uint32 lastResetAt, uint8 userAndInviterPercentage, uint8 userPercentage, bool isRegistered, bool isApproved, string description, string url, string email, address app, address signer)",
]);

/**
 * A viem client whose JSON-RPC is a fake EngagementRewards contract. `state` is live: change the reward, the app's
 * percentages, `isRegistered` or `fail` between requests, and read `reads` / `appsAsked` to see what the server asked.
 * Calls to any other contract, or any other method, throw.
 */
export function fakeEngagementRpc(initial = {}) {
  const state = {
    rewardAmount: 5000n * 10n ** 18n,
    userAndInviterPercentage: 80,
    userPercentage: 60,
    isRegistered: true,
    isApproved: true,
    fail: false,
    reads: { rewardAmount: 0, registeredApps: 0 },
    appsAsked: [],
    ...initial,
  };
  // retryCount 0: viem would otherwise retry a failed request in the background (150 ms, 300 ms, 600 ms), long enough
  // for a test to flip `fail` back and see a "failed" call succeed behind its back.
  const client = createPublicClient({
    transport: custom({
      async request({ method, params }) {
        if (method !== "eth_call") throw new Error(`unexpected rpc method ${method}`);
        const { to, data } = params[0];
        if (to.toLowerCase() !== ENGAGEMENT.toLowerCase()) throw new Error(`call to an unexpected contract ${to}`);
        if (state.fail) throw new Error("rpc down");
        const { functionName, args } = decodeFunctionData({ abi: engagementFixtureAbi, data });
        state.reads[functionName] += 1;
        if (functionName === "rewardAmount") return encodeFunctionResult({ abi: engagementFixtureAbi, functionName, result: state.rewardAmount });
        state.appsAsked.push(args[0].toLowerCase());
        // an unknown app reads back as all zeros, as a Solidity mapping getter does
        const on = state.isRegistered;
        return encodeFunctionResult({
          abi: engagementFixtureAbi,
          functionName,
          result: [
            on ? args[0] : zeroAddress, on ? args[0] : zeroAddress, 0n, on ? 1_700_000_000 : 0, 0,
            on ? state.userAndInviterPercentage : 0, on ? state.userPercentage : 0, on, on && state.isApproved,
            on ? "Moonshard" : "", on ? "https://moonshard.example" : "", on ? "ops@moonshard.example" : "", on ? args[0] : zeroAddress, zeroAddress,
          ],
        });
      },
    }, { retryCount: 0 }),
  });
  return { state, client };
}

export function fakeClock(start = T0) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms) => { t += ms; return t; };
  fn.set = (ms) => { t = ms; };
  return fn;
}

/**
 * A chain with no network. Given a `clock`, an identity whitelisted with an `expiresAt` stops being whitelisted once
 * that time has passed, which is what the identity contract does (getWhitelistedRoot() returns 0 after the account's
 * re-verification date). Without a clock it answers the same thing forever.
 */
export function fakeChain(clock) {
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
      if (clock && hit.expiresAt != null && hit.expiresAt <= clock()) {
        return { isWhitelisted: false, root: null, expiresAt: null, expired: true };
      }
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
  const chain = opts.chain ?? fakeChain(clock);
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
      token: TOKEN,
      engagement: ENGAGEMENT,
      vault: VAULT,
    },
    voucherSignerKey: generatePrivateKey(),
    appSignerKey: generatePrivateKey(),
    prizesEnabled: true, // prizes off is the deployed default; most tests here are about prizes (prizes.test.js covers off)
    ...opts.config,
  };
  // `opts.env` stands in for process.env (NODE_ENV and friends), so a test can build a "production" app and the suite
  // does not change behaviour when it is run with NODE_ENV=production in the shell.
  const { app, ctx } = createApp({ db, chain, config, now: clock, env: opts.env ?? { NODE_ENV: "test" } });
  // The server reads the protocol's reward terms with its own RPC client (built from config.rpcUrl, which no test has).
  // Give every harness a fake EngagementRewards instead; `engagementReader: "real"` leaves the server's own in place.
  const engagementRpc = opts.engagementRpc ?? fakeEngagementRpc();
  if (opts.engagementReader !== "real") {
    ctx.engagementReward = createEngagementReward({ client: engagementRpc.client, address: ENGAGEMENT, app: ctx.appAccount?.address, now: clock });
  }
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

  /**
   * Log in a fresh wallet. Requires the auth routes from Task 4.
   * `blade` (default true): the player has bought the blade a run needs (see shop.js), as everyone who plays has. It is
   * written straight into the database, as a purchase with a made-up transaction; shop.test.js buys it for real.
   */
  async function newPlayer({ verified = false, root, host = "browser", blade = true } = {}) {
    const { loginMessage } = await import("../src/auth.js");
    const account = privateKeyToAccount(generatePrivateKey());
    if (verified) chain.whitelist(account.address, root ?? account.address);
    const n = await api.get("/auth/nonce");
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const r = await api.post("/auth/verify", { address: account.address, message, signature, host });
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
    const address = account.address.toLowerCase();
    if (blade) {
      const subject = verified ? String(root ?? account.address).toLowerCase() : address;
      await db.query(
        "INSERT INTO purchases(tx_hash, subject, wallet, item_id, amount) VALUES ($1,$2,$3,$4,$5)",
        [generatePrivateKey(), subject, address, "iron_starter", (20n * 10n ** 18n).toString()],
      );
    }
    return { account, token: r.body.token, address, login: r.body };
  }

  return {
    api, ctx, chain, clock, db, config, newPlayer, engagementRpc,
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
 * `level`: the Endless level the run reports; left out of the submit when it is not given, like a client from before levels.
 */
export async function playTrial(h, p, { score = 1000, kills = 20, shards = 0, durationMs = 60_000, level } = {}) {
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
    { ticket: run.ticket, score, kills, shards, durationMs, ...(level === undefined ? {} : { level }) },
    { token: p.token },
  );
}
