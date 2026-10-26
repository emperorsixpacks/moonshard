import { apiFetch } from './api.js';
import { GD } from './config.js';

/*
 * Referrals, the player's side. A player's invite link is the game's address with their code on it (…/?ref=K7M2QX9A).
 * A friend who opens it keeps the code until they sign in, and the first sign-in tells the server who sent them, once; the
 * server decides whether it counts (server/src/referrals.js). Nothing here can fail a sign-in or hold one up.
 */

const KEY = 'moonshard.ref.v1';
const PARAM = 'ref';
/** A code that was never used by then is forgotten. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/;

/**
 * What the server answers to a claim that can never succeed, however often it is repeated: the code is wrong, it is the
 * player's own, they came in through another one, or they are already playing. Anything else (offline, a server error, a
 * server that does not have referrals yet) is worth another try at the next sign-in.
 */
const FINAL = new Set(['bad_code', 'unknown_code', 'own_code', 'already_referred', 'not_new']);

/** A code as it may arrive in an address or be pasted (any case, stray spaces), or null when it cannot be one. Must match normalizeCode in server/src/referrals.js. */
export function normalizeRefCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The link a player shares: the site's own address (VITE_PUBLIC_URL, when it is pinned) or the page they are on. */
export function referralLink(code, { base = GD.publicUrl, origin = globalThis.window?.location?.origin || '' } = {}) {
  const root = String(base || origin).replace(/\/+$/, '');
  return `${root}/?${PARAM}=${encodeURIComponent(code)}`;
}

/* ---- the code a visitor arrives with, kept until they sign in ---- */

const memory = new Map();

function defaultStore() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked storage (private mode / webview) */ }
  return {
    isMemory: true, // this shim IS the memory map: never clear the memory copy after writing through it
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}

function stash(store, code, now) {
  const json = JSON.stringify({ code, at: now });
  try {
    store.setItem(KEY, json);
    if (!store.isMemory) memory.delete(KEY); // a real store took the write: it is the single source of truth again
  } catch {
    memory.set(KEY, json); // storage rejected the write; this copy must beat any older value still stored
  }
}

/** The code waiting for a sign-in, or null (none, or too old to be worth claiming). */
export function stashedRefCode({ store = defaultStore(), now = Date.now() } = {}) {
  let raw = null;
  try { raw = memory.get(KEY) ?? store.getItem(KEY); } catch { raw = memory.get(KEY) ?? null; }
  if (!raw) return null;
  try {
    const { code, at } = JSON.parse(raw);
    if (Number.isFinite(at) && now - at < TTL_MS) return normalizeRefCode(code);
  } catch { /* unreadable: forgotten below */ }
  forgetRefCode({ store });
  return null;
}

export function forgetRefCode({ store = defaultStore() } = {}) {
  memory.delete(KEY);
  try { store.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Called as the page loads. A visit through an invite link keeps the code until the player signs in, and the code leaves the
 * address bar, so an address copied from it does not pass the invitation on to someone else. The newest link wins until a
 * claim is made. Returns the code, or null when the address carried none.
 */
export function captureReferral({ win = globalThis.window, store = defaultStore(), now = Date.now() } = {}) {
  try {
    const href = win?.location?.href;
    if (!href) return null;
    const url = new URL(href);
    if (!url.searchParams.has(PARAM)) return null;
    const code = normalizeRefCode(url.searchParams.get(PARAM));
    if (code) stash(store, code, now);
    url.searchParams.delete(PARAM);
    win.history?.replaceState?.({}, '', url);
    return code;
  } catch {
    return null;
  }
}

/**
 * Tells the server who sent this player, if a link brought them. Called after a sign-in. Never throws; a refusal the server
 * will always repeat forgets the code, and a hiccup keeps it for the next sign-in.
 * @returns {Promise<{claimed: boolean, reason?: string}>}
 */
export async function claimStashedReferral({ token, api = apiFetch, store = defaultStore(), now = Date.now() } = {}) {
  const code = stashedRefCode({ store, now });
  if (!code || !token) return { claimed: false, reason: 'none' };
  try {
    await api('/referrals/claim', { method: 'POST', token, body: { code } });
    forgetRefCode({ store });
    return { claimed: true };
  } catch (err) {
    if (FINAL.has(err?.message)) {
      forgetRefCode({ store });
      return { claimed: false, reason: err.message };
    }
    return { claimed: false, reason: 'retry' };
  }
}

/** The player's own code, what it has brought in and who: GET /referrals/me. */
export function fetchReferrals({ token, api = apiFetch } = {}) {
  return api('/referrals/me', { token });
}
