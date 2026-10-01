import express from "express";
import { parseEventLogs, toFunctionSelector } from "viem";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";
import { ubiAbi } from "./chain.js";

const CLAIM_SELECTOR = toFunctionSelector("claim()"); // 0x4e71d92d

export function ubiRoutes(ctx) {
  const r = express.Router();

  r.post("/ubi/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    if (!p.verified) throw new HttpError(403, "verification_required");
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");

    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    const { tx, receipt, timestamp } = found;
    const ubi = ctx.config.contracts.ubi.toLowerCase();
    if (receipt.status !== "success") throw new HttpError(422, "tx_failed");
    if (String(tx.to || "").toLowerCase() !== ubi) throw new HttpError(422, "wrong_contract");
    if (String(tx.input || "").toLowerCase().slice(0, 10) !== CLAIM_SELECTOR) throw new HttpError(422, "wrong_method");

    const from = String(tx.from).toLowerCase();
    const own = await ctx.db.query("SELECT 1 FROM wallets WHERE address = $1 AND subject = $2", [from, p.subject]);
    if (own.rows.length === 0) throw new HttpError(403, "not_your_tx");

    const day = dayKey(timestamp * 1000);
    if (day !== dayKey(ctx.now())) throw new HttpError(422, "tx_not_today");

    // claim() returns false instead of reverting when there is nothing to claim, so a successful tx proves
    // nothing. The scheme emits UBIClaimed(claimer, amount) only when it actually pays out; the claimer is the
    // whitelisted root, which is the tx sender unless the sender is one of the human's linked wallets.
    const claimers = new Set([from, p.subject]);
    const paidOut = parseEventLogs({ abi: ubiAbi, eventName: "UBIClaimed", logs: receipt.logs ?? [] })
      .some((l) => l.address.toLowerCase() === ubi && claimers.has(l.args.claimer.toLowerCase()));
    if (!paidOut) throw new HttpError(422, "no_claim_event");

    const ins = await ctx.db.query(
      "INSERT INTO ubi_claims(tx_hash, subject, wallet, day) VALUES ($1,$2,$3,$4) ON CONFLICT (tx_hash) DO NOTHING RETURNING tx_hash",
      [hash, p.subject, from, day],
    );
    await ctx.db.query("INSERT INTO blessings(subject, day) VALUES ($1,$2) ON CONFLICT DO NOTHING", [p.subject, day]);
    res.json({ ok: true, blessing: true, day, recorded: ins.rows.length > 0 });
  }));

  return r;
}
