import express from "express";
import { formatUnits, hexToString, parseEventLogs, toFunctionSelector } from "viem";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { tokenAbi } from "./chain.js";

const TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)"); // 0xa9059cbb
/** Hex characters of transfer(to, value) after "0x": the selector and two 32-byte words. What follows is the item tag. */
const TRANSFER_CALL_HEX = 8 + 2 * 64;
/** The tag a purchase carries: the UTF-8 text "moonshard:<item id>" after the transfer's arguments. */
const ITEM_TAG = /^moonshard:([a-z0-9_]{1,40})$/;

const catalog = new Map(GAME.SHOP.map((item) => [item.id, item]));

/** The shop is open when there is a prize vault to pay into. */
export const shopOpen = (ctx) => Boolean(ctx.config.contracts.vault);

/**
 * The item a purchase names, read from the calldata after transfer's two arguments. A token ignores calldata past its
 * arguments, so the tag costs the player nothing and makes the transaction say, on its own, what it bought.
 * @returns {string|null} the tag's item id (not checked against the catalog), or null when there is no readable tag
 */
export function itemOf(input) {
  const tail = String(input || "").slice(2 + TRANSFER_CALL_HEX);
  if (!tail || tail.length % 2 || !/^[0-9a-fA-F]+$/.test(tail)) return null;
  let text;
  try { text = hexToString(`0x${tail}`); } catch { return null; }
  return ITEM_TAG.exec(text)?.[1] ?? "";
}

/**
 * What a player owns: every item they paid for whose requirement they own too. A payment for an item whose requirement is
 * missing (only a modified client sends one) is kept, and counts as soon as the requirement is bought: no G$ is lost, and no
 * item is reached by skipping the one before it. Catalog order, which lists a requirement before the items that need it.
 *
 * "They paid for": bought as this player, or bought by one of this player's wallets. A wallet that bought something before
 * it was verified as a second wallet of someone else belongs to that person now (wallets.subject), and so do its purchases.
 */
export async function ownedItems(ctx, subject) {
  const { rows } = await ctx.db.query(
    "SELECT DISTINCT item_id FROM purchases WHERE subject = $1 OR wallet IN (SELECT address FROM wallets WHERE subject = $1)",
    [subject],
  );
  const paid = new Set(rows.map((r) => r.item_id));
  const owned = [];
  for (const item of GAME.SHOP) {
    if (paid.has(item.id) && (!item.requires || owned.includes(item.requires))) owned.push(item.id);
  }
  return owned;
}

/**
 * Whether this player may start a run: they own the entry blade, or there is none to buy (the shop is closed, or sells no
 * blade) and the first blade is free. src/engine/playGateRules.js asks the same on the client.
 */
export async function hasBlade(ctx, subject) {
  if (!shopOpen(ctx)) return true;
  const blades = GAME.SHOP.filter((item) => item.kind === "blade").map((item) => item.id);
  if (blades.length === 0) return true;
  const owned = await ownedItems(ctx, subject);
  return blades.some((id) => owned.includes(id));
}

const publicItem = ({ id, name, kind, price, requires }) => ({ id, name, kind, priceG: formatUnits(price, 18), requires: requires ?? null });

export function shopRoutes(ctx) {
  const r = express.Router();

  r.get("/shop", (_req, res) => {
    const open = shopOpen(ctx);
    res.json({
      enabled: open,
      token: ctx.config.contracts.token,
      vault: open ? ctx.config.contracts.vault : null,
      items: open ? GAME.SHOP.map(publicItem) : [],
    });
  });

  /**
   * Records a purchase from its transaction: a successful transfer() on the G$ token, sent from one of the player's wallets,
   * naming an item, whose Transfer event shows the vault receiving at least the item's price from that wallet.
   */
  r.post("/shop/confirm", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    const hash = String(req.body?.txHash || "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HttpError(400, "bad_tx");
    if (!shopOpen(ctx)) throw new HttpError(409, "shop_closed");

    const found = await ctx.chain.getTx(hash);
    if (!found) throw new HttpError(404, "tx_not_found");
    const { tx, receipt } = found;
    const token = ctx.config.contracts.token.toLowerCase();
    const vault = ctx.config.contracts.vault.toLowerCase();
    if (receipt.status !== "success") throw new HttpError(422, "tx_failed");
    if (String(tx.to || "").toLowerCase() !== token) throw new HttpError(422, "wrong_contract");
    if (String(tx.input || "").toLowerCase().slice(0, 10) !== TRANSFER_SELECTOR) throw new HttpError(422, "wrong_method");

    const from = String(tx.from).toLowerCase();
    const own = await ctx.db.query("SELECT 1 FROM wallets WHERE address = $1 AND subject = $2", [from, p.subject]);
    if (own.rows.length === 0) throw new HttpError(403, "not_your_tx");

    const itemId = itemOf(tx.input);
    if (itemId === null) throw new HttpError(422, "no_item");
    const item = catalog.get(itemId);
    if (!item) throw new HttpError(422, "unknown_item");

    const paid = parseEventLogs({ abi: tokenAbi, eventName: "Transfer", logs: receipt.logs ?? [] })
      .filter((l) => l.address.toLowerCase() === token && l.args.from.toLowerCase() === from && l.args.to.toLowerCase() === vault)
      .reduce((sum, l) => sum + l.args.value, 0n);
    if (paid === 0n) throw new HttpError(422, "not_paid_to_vault");
    if (paid < item.price) throw new HttpError(422, "underpaid");

    const before = await ownedItems(ctx, p.subject);
    const ins = await ctx.db.query(
      `INSERT INTO purchases(tx_hash, subject, wallet, item_id, amount) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tx_hash) DO NOTHING RETURNING tx_hash`,
      [hash.toLowerCase(), p.subject, from, item.id, paid.toString()],
    );
    const recorded = ins.rows.length > 0;
    res.json({ ok: true, item: item.id, recorded, alreadyOwned: recorded && before.includes(item.id), owned: await ownedItems(ctx, p.subject) });
  }));

  return r;
}
