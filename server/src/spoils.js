import express from "express";
import { encodeAbiParameters, formatUnits, keccak256, parseAbiParameters, parseEventLogs } from "viem";
import { GAME, prizesOn } from "../config.js";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";
import { vaultAbi } from "./chain.js";

/** Most recent spoils returned by GET /spoils. */
export const MAX_SPOILS_LISTED = 30;

export const spoilTypes = {
  Spoil: [
    { name: "to", type: "address" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

const spoilIdParams = parseAbiParameters("address vault, string kind, string day, address subject");

/**
 * The vault's voucher id: uint256(keccak256(abi.encode(vault, kind, day, subject))).
 *
 * The vault address is part of the preimage so that an id is unique per vault. Without it the id depended only on
 * (kind, day, subject), and after a vault redeploy every spoil the old vault had already paid would be signed again for
 * the new one, whose `claimed` set is empty. ABI encoding (typed, length-prefixed) leaves no two tuples with the same
 * preimage, whatever the strings contain. The vault contract is unchanged: it only ever sees an opaque `id`.
 */
export const spoilId = (vault, kind, day, subject) =>
  BigInt(keccak256(encodeAbiParameters(spoilIdParams, [String(vault).toLowerCase(), kind, day, subject])));

/** A spoil row belongs to `vault` when its stored id is the one that vault would derive for it. */
const boundToVault = (vault, row, subject) => spoilId(vault, row.kind, row.day, subject).toString() === row.id;

/** How long an "unredeemed" answer is believed. A redeemed one never changes back, so it is believed for ever. */
export const CLAIMED_FALSE_TTL_MS = 10_000;
/** At most this many spoil ids are remembered; past that the one remembered longest ago is dropped. */
export const CLAIMED_CACHE_MAX = 2_000;
/** Chain reads in flight at once for one request. */
export const CLAIMED_READ_CONCURRENCY = 5;

/**
 * Reads "has the vault paid this spoil?" for many ids, remembering the answers.
 *
 * `claimed` only ever goes false -> true, so `true` is kept for as long as the entry lives; `false` is believed for
 * `falseTtlMs` and then asked again. A failed read is not remembered. The ids it is asked about are vault-bound (see
 * spoilId), so an answer cannot leak from one vault to another. The uncached ids are read `concurrency` at a time, and
 * the first failure ends the batch: a dead RPC would otherwise cost one timeout per id.
 *
 * `read(id)` resolves to a boolean. `read(ids)` below resolves to a Map of id -> true | false | null (null: not known).
 */
export function createClaimedReader({
  read,
  now,
  falseTtlMs = CLAIMED_FALSE_TTL_MS,
  maxEntries = CLAIMED_CACHE_MAX,
  concurrency = CLAIMED_READ_CONCURRENCY,
}) {
  const cache = new Map();

  function remember(id, claimed) {
    // A Map iterates in insertion order: deleting first moves a refreshed id to the back, so the front is the oldest.
    cache.delete(id);
    cache.set(id, { claimed, at: now() });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  return {
    /** The chain itself proved this id redeemed (a Claimed event in a confirmed receipt). */
    markClaimed: (id) => remember(String(id), true),

    async read(ids) {
      const out = new Map();
      const todo = [];
      for (const id of ids) {
        const hit = cache.get(id);
        if (hit && (hit.claimed || now() - hit.at < falseTtlMs)) out.set(id, hit.claimed);
        else todo.push(id);
      }
      let failed = false;
      let next = 0;
      const worker = async () => {
        while (!failed && next < todo.length) {
          const id = todo[next++];
          try {
            const claimed = (await read(id)) === true;
            remember(id, claimed);
            out.set(id, claimed);
          } catch {
            failed = true;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
      for (const id of todo) if (!out.has(id)) out.set(id, null);
      return out;
    },
  };
}

/**
 * Settle one UTC day into `spoils` rows. Safe to call repeatedly.
 * Ids are bound to the configured vault, so a day is only settled while there is one: spoils settled without a
 * vault would be bound to nothing and could never be redeemed from a vault deployed later. The day stays open
 * (no `settled_days` marker) and settles, bound to the right vault, once VAULT_ADDRESS is set.
 */
export async function settleDay(ctx, day) {
  // Prizes off: the day is closed with nothing owed, so turning prizes on later never pays a day played without them.
  if (!prizesOn(ctx.config)) {
    const marker = await ctx.db.query("INSERT INTO settled_days(day) VALUES ($1) ON CONFLICT DO NOTHING RETURNING day", [day]);
    return { day, settled: marker.rows.length > 0, prizes: 0, harvests: 0, reason: "prizes_off" };
  }
  const vault = ctx.config.contracts.vault;
  if (!vault) return { day, settled: false, reason: "no_vault" };
  return ctx.db.tx(async (t) => {
    const marker = await t.query("INSERT INTO settled_days(day) VALUES ($1) ON CONFLICT DO NOTHING RETURNING day", [day]);
    if (marker.rows.length === 0) return { day, settled: false };

    const top = await t.query(
      `SELECT subject FROM scores WHERE day = $1 AND ranked_ok AND verified
         ORDER BY score DESC, duration_ms ASC, kills DESC, run_id ASC LIMIT $2`,
      [day, GAME.PRIZES.length],
    );
    for (let i = 0; i < top.rows.length; i++) {
      const subject = top.rows[i].subject;
      await t.query(
        `INSERT INTO spoils(id, kind, day, subject, amount, rank) VALUES ($1,'TRIAL_PRIZE',$2,$3,$4,$5)
         ON CONFLICT (kind, day, subject) DO NOTHING`,
        [spoilId(vault, "TRIAL_PRIZE", day, subject).toString(), day, subject, GAME.PRIZES[i].toString(), i + 1],
      );
    }

    const harvest = await t.query("SELECT subject, shards FROM shard_days WHERE day = $1 AND shards > 0", [day]);
    for (const row of harvest.rows) {
      const amount = BigInt(Math.min(row.shards, GAME.DAILY_SHARD_CAP)) * GAME.SHARD_RATE;
      await t.query(
        `INSERT INTO spoils(id, kind, day, subject, amount) VALUES ($1,'SHARD_HARVEST',$2,$3,$4)
         ON CONFLICT (kind, day, subject) DO NOTHING`,
        [spoilId(vault, "SHARD_HARVEST", day, row.subject).toString(), day, row.subject, amount.toString()],
      );
    }
    return { day, settled: true, prizes: top.rows.length, harvests: harvest.rows.length };
  });
}

/** Settle every day that can no longer receive submissions (ticket window + 1 min passed). */
export async function settleDue(ctx) {
  if (prizesOn(ctx.config) && !ctx.config.contracts.vault) return []; // see settleDay
  const cutoff = dayKey(ctx.now() - GAME.TICKET_MAX_AGE_MS - 60_000);
  const { rows } = await ctx.db.query(
    `SELECT day FROM (SELECT day FROM scores UNION SELECT day FROM shard_days) d
      WHERE day < $1 AND day NOT IN (SELECT day FROM settled_days) ORDER BY day`,
    [cutoff],
  );
  const out = [];
  for (const r of rows) out.push(await settleDay(ctx, r.day));
  return out;
}

export function spoilsRoutes(ctx) {
  const r = express.Router();
  // The chain function is looked up on every read, not captured: it is the live ctx.chain.
  const claimedStatus = createClaimedReader({ read: (id) => ctx.chain.voucherClaimed(id), now: () => ctx.now() });

  r.get("/spoils", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    // Each listed spoil costs a chain lookup and, when unredeemed, a signature: bound the work per request.
    const all = (await ctx.db.query(
      "SELECT id, kind, day, amount, rank FROM spoils WHERE subject = $1 ORDER BY day DESC, kind LIMIT $2",
      [p.subject, MAX_SPOILS_LISTED],
    )).rows;
    const vault = ctx.config.contracts.vault;
    // A row settled under another vault (VAULT_ADDRESS was changed since) is not this vault's to pay: the old vault
    // may have paid it already, and this one cannot know. Signing it would pay it a second time.
    const rows = vault ? all.filter((row) => boundToVault(vault, row, p.subject)) : all;
    const deadline = BigInt(Math.floor(ctx.now() / 1000) + GAME.VOUCHER_TTL_SEC);
    const claimedById = await claimedStatus.read(rows.map((row) => row.id));
    const spoils = [];
    for (const s of rows) {
      const claimed = claimedById.get(s.id) ?? null;
      let voucher = null;
      if (claimed === false && p.verified && vault && ctx.voucherAccount) {
        const message = { to: p.wallet, id: BigInt(s.id), amount: BigInt(s.amount), deadline };
        const signature = await ctx.voucherAccount.signTypedData({
          domain: { name: "MoonshardVault", version: "1", chainId: ctx.config.chainId, verifyingContract: vault },
          types: spoilTypes,
          primaryType: "Spoil",
          message,
        });
        voucher = { to: p.wallet, id: s.id, amount: s.amount, deadline: deadline.toString(), signature };
      }
      spoils.push({
        id: s.id, kind: s.kind, day: s.day, rank: s.rank,
        amount: s.amount, amountG: formatUnits(BigInt(s.amount), 18),
        claimed, voucher,
      });
    }
    res.json({ vault: vault ? { address: vault, chainId: ctx.config.chainId } : null, spoils });
  }));

  r.post("/spoils/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");
    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    if (found.receipt.status !== "success") throw new HttpError(422, "tx_failed");

    const vault = String(ctx.config.contracts.vault || "").toLowerCase();
    const logs = parseEventLogs({ abi: vaultAbi, eventName: "Claimed", logs: found.receipt.logs })
      .filter((l) => l.address.toLowerCase() === vault);
    const recorded = [];
    for (const log of logs) {
      const id = log.args.id.toString();
      claimedStatus.markClaimed(id); // the receipt is proof that the vault paid it, whoever the spoil belongs to
      const mine = await ctx.db.query("SELECT amount FROM spoils WHERE id = $1 AND subject = $2", [id, p.subject]);
      if (mine.rows.length === 0) continue;
      const ins = await ctx.db.query(
        `INSERT INTO spoil_claims(tx_hash, spoil_id, subject, amount) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tx_hash, spoil_id) DO NOTHING RETURNING spoil_id`,
        [hash, id, p.subject, mine.rows[0].amount],
      );
      if (ins.rows.length) recorded.push(id);
    }
    res.json({ ok: true, recorded });
  }));

  return r;
}
