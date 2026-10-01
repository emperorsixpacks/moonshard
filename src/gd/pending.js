import { apiFetch } from './api.js';
import { getToken } from './session.js';

const KEY = 'moonshard.pending.v1';
const MAX_ITEMS = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
 * Failed confirmations are remembered (localStorage) and retried after sign-in and on refresh.
 */
export function createPendingConfirms({
  api = apiFetch,
  tokenFn = getToken,
  now = () => Date.now(),
  storage = defaultStorage(),
} = {}) {
  let running = null;

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

  function add(kind, txHash) {
    if (!items.some((x) => x.txHash.toLowerCase() === String(txHash).toLowerCase())) {
      items.push({ kind, txHash, at: now() });
      persist();
    }
  }

  function remove(txHash) {
    items = items.filter((x) => x.txHash.toLowerCase() !== String(txHash).toLowerCase());
    persist();
  }

  async function attempt(kind, txHash) {
    try {
      const response = await api(PATHS[kind], { method: 'POST', token: tokenFn(), body: { txHash } });
      return { ok: true, response };
    } catch (err) {
      return { ok: false, retryable: isRetryable(err), error: err?.message || 'confirm_failed' };
    }
  }

  async function confirm(kind, txHash) {
    if (!tokenFn()) {
      add(kind, txHash);
      return { confirmed: false, queued: true, error: 'unauthorized' };
    }
    const r = await attempt(kind, txHash);
    if (r.ok) {
      remove(txHash);
      return { confirmed: true, queued: false, response: r.response };
    }
    if (r.retryable) {
      add(kind, txHash);
      return { confirmed: false, queued: true, error: r.error };
    }
    remove(txHash);
    return { confirmed: false, queued: false, error: r.error };
  }

  function retryAll() {
    if (running) return running;
    running = (async () => {
      if (!tokenFn()) return 0;
      const cutoff = now() - MAX_AGE_MS;
      items = items.filter((x) => x.at >= cutoff);
      persist();
      let confirmed = 0;
      for (const item of [...items]) {
        const r = await attempt(item.kind, item.txHash);
        if (r.ok) {
          confirmed++;
          remove(item.txHash);
        } else if (!r.retryable) {
          remove(item.txHash);
        }
      }
      return confirmed;
    })().finally(() => { running = null; });
    return running;
  }

  return { list: () => items.map((x) => ({ ...x })), add, remove, confirm, retryAll };
}

export const pending = createPendingConfirms();
