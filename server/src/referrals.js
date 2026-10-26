import crypto from "node:crypto";
import express from "express";
import { GAME } from "../config.js";
import { HttpError, ah } from "./http.js";
import { shopOpen } from "./shop.js";

const UNIQUE_VIOLATION = "23505"; // Postgres SQLSTATE, same code from pg and PGlite

/** No I, L, O, 0 or 1: a code read off a screenshot, or said aloud, cannot be mistaken for another. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
const CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/; // the ALPHABET, CODE_LENGTH times

/** A code as a player may have typed or pasted it (any case, stray spaces), or null when it cannot be a code. */
export function normalizeCode(raw) {
  const code = String(raw ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

const newCode = () => Array.from({ length: CODE_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

/** A friend's wallet as their inviter sees it: enough to recognise it, not enough to copy it. */
export const maskWallet = (wallet) => `${String(wallet).slice(0, 6)}…${String(wallet).slice(-4)}`;

/**
 * The code of `wallet`, drawn the first time it is asked for. A code is not a secret (it only lets a friend say who sent
 * them), so it is random but not signed. Two wallets drawing the same code is a unique violation: draw again.
 */
export async function codeFor(ctx, wallet) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const have = (await ctx.db.query("SELECT code FROM referral_codes WHERE wallet = $1", [wallet])).rows[0];
    if (have) return have.code;
    try {
      const made = await ctx.db.query(
        "INSERT INTO referral_codes(wallet, code) VALUES ($1, $2) ON CONFLICT (wallet) DO NOTHING RETURNING code",
        [wallet, newCode()],
      );
      if (made.rows[0]) return made.rows[0].code;
    } catch (err) {
      if (err?.code !== UNIQUE_VIOLATION) throw err;
    }
  }
  throw new Error("could not draw a referral code");
}

/** The blades a hero starts with, bought with G$: owning one is what "playing" means. None on a server with no shop. */
const bladeIds = (ctx) => (shopOpen(ctx) ? GAME.SHOP.filter((item) => item.kind === "blade").map((item) => item.id) : []);

/**
 * One row per friend that a person's wallets invited, as things stand now (SQL for a WITH clause):
 *   human     who the friend is: their whitelisted root once verified, else their wallet. Two wallets of one person share it,
 *             so one person is counted once however many wallets they brought along.
 *   verified  the identity contract vouched for them the last time they signed in.
 *   playing   they own the entry blade (or, where there is no shop to buy one in, they have started a run).
 * A friend who turns out to be the inviter's own second wallet (the same root) is left out.
 * Parameters: $1 the inviter's subject, $2 the wallet they are signed in with, then one for each blade id.
 */
function factsSql(blades) {
  const playing = blades.length
    ? `EXISTS (SELECT 1 FROM purchases p WHERE p.item_id IN (${blades.map((_, i) => `$${3 + i}`).join(", ")})
         AND (p.subject = dw.subject OR p.wallet IN (SELECT address FROM wallets WHERE subject = dw.subject)))`
    : "EXISTS (SELECT 1 FROM runs u WHERE u.subject = dw.subject OR u.wallet = r.referred_wallet)";
  return `WITH mine AS (SELECT address FROM wallets WHERE subject = $1 UNION SELECT $2::text),
    facts AS (
      SELECT r.referred_wallet, r.created_at, dw.verified, dw.subject AS human, ${playing} AS playing
        FROM referrals r JOIN wallets dw ON dw.address = r.referred_wallet
       WHERE r.referrer_wallet IN (SELECT address FROM mine)
         AND NOT (dw.verified AND dw.subject = $1)
    )`;
}

/**
 * What a player's invite link has brought in. `joined` counts the wallets that signed in through it; `verified` and `playing`
 * count people, each once: a friend is verified when the identity contract vouches for them, and playing once they also
 * own the blade. `friends` is the latest few, newest first.
 */
export async function referralStats(ctx, player) {
  const blades = bladeIds(ctx);
  const params = [player.subject, player.wallet, ...blades];
  const facts = factsSql(blades);
  const counts = (await ctx.db.query(
    `${facts}
     SELECT count(*)::int AS joined,
            count(DISTINCT human) FILTER (WHERE verified)::int AS verified,
            count(DISTINCT human) FILTER (WHERE verified AND playing)::int AS playing
       FROM facts`,
    params,
  )).rows[0];
  const recent = (await ctx.db.query(
    `${facts}
     SELECT referred_wallet, created_at, verified, playing FROM facts
      ORDER BY created_at DESC, referred_wallet LIMIT $${params.length + 1}`,
    [...params, GAME.REFERRALS.RECENT_LIMIT],
  )).rows;
  return {
    joined: counts.joined,
    verified: counts.verified,
    playing: counts.playing,
    friends: recent.map((row) => ({
      who: maskWallet(row.referred_wallet),
      status: !row.verified ? "joined" : row.playing ? "playing" : "verified",
      joinedAt: new Date(row.created_at).toISOString(),
    })),
  };
}

/** Whether the server has seen anything of this player yet beyond signing in: a purchase or a run means they are already playing. */
async function isNewPlayer(ctx, player) {
  const { rows } = await ctx.db.query(
    `SELECT (SELECT first_seen > now() - ($3::int * interval '1 day') FROM wallets WHERE address = $2) AS fresh,
            EXISTS (SELECT 1 FROM runs WHERE subject = $1 OR wallet = $2)
              OR EXISTS (SELECT 1 FROM purchases WHERE subject = $1 OR wallet = $2) AS played`,
    [player.subject, player.wallet, GAME.REFERRALS.NEW_PLAYER_DAYS],
  );
  return Boolean(rows[0].fresh) && !rows[0].played;
}

/**
 * Records that `player` came in through `code`.
 *  - 404 unknown_code: no wallet has that code.
 *  - 409 own_code: the code is the player's own, or belongs to another wallet of the same person.
 *  - 409 already_referred: they, or another wallet of theirs, came in through someone else's code before: the first one wins.
 *  - 409 not_new: they are already playing, so nobody can claim to have brought them.
 * Using the code that already brought them is not an error: the client may repeat the call.
 */
export async function attribute(ctx, player, code) {
  const owner = (await ctx.db.query("SELECT wallet FROM referral_codes WHERE code = $1", [code])).rows[0];
  if (!owner) throw new HttpError(404, "unknown_code");

  const ownerSubject = (await ctx.db.query("SELECT subject FROM wallets WHERE address = $1", [owner.wallet])).rows[0]?.subject;
  if (owner.wallet === player.wallet || ownerSubject === player.subject) throw new HttpError(409, "own_code");

  // Any wallet of this person that already came in through a code (the join is on the shared subject).
  const earlier = (await ctx.db.query(
    `SELECT r.referrer_wallet FROM referrals r JOIN wallets w ON w.address = r.referred_wallet
      WHERE r.referred_wallet = $1 OR w.subject = $2 LIMIT 1`,
    [player.wallet, player.subject],
  )).rows[0];
  if (earlier) {
    if (earlier.referrer_wallet === owner.wallet) return { ok: true, already: true };
    throw new HttpError(409, "already_referred");
  }

  if (!(await isNewPlayer(ctx, player))) throw new HttpError(409, "not_new");

  const made = await ctx.db.query(
    "INSERT INTO referrals(referred_wallet, referrer_wallet, code) VALUES ($1, $2, $3) ON CONFLICT (referred_wallet) DO NOTHING RETURNING referred_wallet",
    [player.wallet, owner.wallet, code],
  );
  if (made.rows.length === 0) {
    // two calls raced and the other one won: say what the first answer would have said
    const won = (await ctx.db.query("SELECT referrer_wallet FROM referrals WHERE referred_wallet = $1", [player.wallet])).rows[0];
    if (won?.referrer_wallet === owner.wallet) return { ok: true, already: true };
    throw new HttpError(409, "already_referred");
  }
  return { ok: true };
}

/** Totals for the public stats page: friends invited, and the real people among them. */
export async function referralTotals(ctx) {
  const { rows } = await ctx.db.query(
    `SELECT count(*) FILTER (WHERE NOT (dw.verified AND dw.subject = rw.subject))::int AS invited,
            count(DISTINCT dw.subject) FILTER (WHERE dw.verified AND dw.subject <> rw.subject)::int AS verified,
            count(DISTINCT rw.subject) FILTER (WHERE dw.verified AND dw.subject <> rw.subject)::int AS referrers
       FROM referrals r
       JOIN wallets dw ON dw.address = r.referred_wallet
       JOIN wallets rw ON rw.address = r.referrer_wallet`,
  );
  return rows[0];
}

export function referralRoutes(ctx) {
  const r = express.Router();

  r.get("/referrals/me", ctx.requireAuth, ah(async (req, res) => {
    const p = req.player;
    res.json({ code: await codeFor(ctx, p.wallet), ...(await referralStats(ctx, p)) });
  }));

  r.post("/referrals/claim", ctx.requireAuth, ah(async (req, res) => {
    const code = normalizeCode(req.body?.code);
    if (!code) throw new HttpError(400, "bad_code");
    res.json(await attribute(ctx, req.player, code));
  }));

  return r;
}
