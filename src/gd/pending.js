import { apiFetch } from './api.js';
import { getAddress, getToken } from './session.js';

const KEY = 'moonshard.pending.v1';
const MAX_ITEMS = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 5000; // short, and retries run in parallel, so a dead API delays a refresh by 5 s at most
const PATHS = { ubi: '/ubi/confirm', engagement: '/engagement/confirm', spoil: '/spoils/confirm' };
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const memory = new Map();

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked storage (private mode / webview) */ }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}

/**
 * Errors worth retrying later: network/timeout (0), server trouble (5xx), throttling (429), an expired
 * session (401) and 404 (the server's RPC node may not see the tx yet). Anything else (400/403/409/422)
 * is a final answer and the entry is dropped.
 */
const isRetryable = (err) =>
  err?.status === 0 || err?.status === 401 || err?.status === 404 || err?.status === 429 || err?.status >= 500;

/**
 * The on-chain action already happened when we get here (the player was paid), so the server confirmation is
 * best-effort bookkeeping that must not be lost: it grants the daily blessing and feeds the public stats.
 * Failed confirmations are remembered (localStorage) and retried after sign-in and on refresh. Each entry
 * remembers which account made it, so a different account signing in neither retries nor loses it.
 */
export function createPendingConfirms({
  api = apiFetch,
  tokenFn = getToken,
  addressFn = getAddress,
  now = () => Date.now(),
  storage = defaultStorage(),
} = {}) {
  let running = null;
  const sessionListeners = new Set();

  function read() {
    try {
      const raw = JSON.parse(storage.getItem(KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((x) => x && PATHS[x.kind] && TX_HASH.test(x.txHash || '') && Number.isFinite(x.at));
    } catch {
      return [];
    }
  }

  let items = read();

  function persist() {
    items = items.slice(-MAX_ITEMS);
    try { storage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full or blocked: the in-memory copy still retries */ }
  }

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const owner = () => (addressFn() ? String(addressFn()).toLowerCase() : null);
  const isMine = (item) => !item.address || !owner() || item.address === owner();

  function add(kind, txHash) {
    if (!PATHS[kind] || !TX_HASH.test(String(txHash || ''))) return false;
    if (!items.some((x) => same(x.txHash, txHash))) {
      items.push({ kind, txHash, at: now(), address: owner() });
      persist();
    }
    return true;
  }

  function remove(txHash) {
    items = items.filter((x) => !same(x.txHash, txHash));
    persist();
  }

  async function attempt(kind, txHash) {
    const token = tokenFn();
    try {
      const response = await api(PATHS[kind], { method: 'POST', token, body: { txHash }, timeoutMs: CONFIRM_TIMEOUT_MS });
      return { ok: true, response, token };
    } catch (err) {
      return { ok: false, retryable: isRetryable(err), error: err?.message || 'confirm_failed', status: err?.status, token };
    }
  }

  async function confirm(kind, txHash) {
    if (!add(kind, txHash)) return { confirmed: false, queued: false, error: 'bad_tx' };
    remove(txHash); // add() was only the validity check; the entry is (re)queued below if it has to wait
    if (!tokenFn()) {
      add(kind, txHash);
      return { confirmed: false, queued: true, error: 'unauthorized' };
    }
    const r = await attempt(kind, txHash);
    if (r.ok) return { confirmed: true, queued: false, response: r.response };
    if (r.retryable) {
      add(kind, txHash);
      return { confirmed: false, queued: true, error: r.error, status: r.status };
    }
    return { confirmed: false, queued: false, error: r.error, status: r.status };
  }

  /**
   * Retries every queued confirmation that belongs to the signed-in account. `onUnauthorized(token)` is called once
   * if the server says that session is dead: the entries stay queued, but the caller can tell the player to reconnect.
   */
  function retryAll({ onUnauthorized } = {}) {
    if (onUnauthorized) sessionListeners.add(onUnauthorized);
    if (running) return running;
    running = (async () => {
      if (!tokenFn()) return 0;
      const cutoff = now() - MAX_AGE_MS;
      items = items.filter((x) => x.at >= cutoff);
      persist();
      const mine = items.filter(isMine);
      const results = await Promise.all(mine.map((item) => attempt(item.kind, item.txHash).then((r) => ({ item, r }))));
      let confirmed = 0;
      for (const { item, r } of results) {
        if (r.ok) {
          confirmed++;
          remove(item.txHash);
        } else if (!r.retryable) {
          remove(item.txHash);
        }
      }
      const dead = results.find(({ r }) => !r.ok && r.status === 401);
      if (dead) {
        for (const fn of sessionListeners) {
          try { fn(dead.r.token); } catch { /* a listener must not break the retry loop */ }
        }
      }
      return confirmed;
    })().finally(() => { running = null; sessionListeners.clear(); });
    return running;
  }

  return { list: () => items.map((x) => ({ ...x })), size: () => items.length, add, remove, confirm, retryAll };
}

export const pending = createPendingConfirms();
