import express from "express";
import { toFunctionSelector } from "viem";
import { HttpError, ah } from "./http.js";
import { dayKey } from "./time.js";

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
    if (receipt.status !== "success") throw new HttpError(422, "tx_failed");
    if (String(tx.to || "").toLowerCase() !== ctx.config.contracts.ubi.toLowerCase()) throw new HttpError(422, "wrong_contract");
    if (String(tx.input || "").toLowerCase().slice(0, 10) !== CLAIM_SELECTOR) throw new HttpError(422, "wrong_method");

    const from = String(tx.from).toLowerCase();
    const own = await ctx.db.query("SELECT 1 FROM wallets WHERE address = $1 AND subject = $2", [from, p.subject]);
    if (own.rows.length === 0) throw new HttpError(403, "not_your_tx");

    const day = dayKey(timestamp * 1000);
    if (day !== dayKey(ctx.now())) throw new HttpError(422, "tx_not_today");

    const ins = await ctx.db.query(
      "INSERT INTO ubi_claims(tx_hash, subject, wallet, day) VALUES ($1,$2,$3,$4) ON CONFLICT (tx_hash) DO NOTHING RETURNING tx_hash",
      [hash, p.subject, from, day],
    );
    await ctx.db.query("INSERT INTO blessings(subject, day) VALUES ($1,$2) ON CONFLICT DO NOTHING", [p.subject, day]);
    res.json({ ok: true, blessing: true, day, recorded: ins.rows.length > 0 });
  }));

  return r;
}
