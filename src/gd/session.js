const KEY = 'moonshard.session.v1';
const TTL_MS = 12 * 60 * 60 * 1000;
const memory = new Map();

function store() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked storage (private mode / webview) */ }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}

export function saveSession({ token, address, host, unsigned = false }) {
  const session = { token, address: String(address).toLowerCase(), host, unsigned: Boolean(unsigned), expiresAt: Date.now() + TTL_MS };
  try { store().setItem(KEY, JSON.stringify(session)); } catch { memory.set(KEY, JSON.stringify(session)); }
  return session;
}

export function loadSession() {
  try {
    // `memory` also holds the session when localStorage exists but rejected the write (quota / restricted storage).
    const raw = store().getItem(KEY) ?? memory.get(KEY) ?? null;
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.token || !s.address || !Number.isFinite(s.expiresAt) || s.expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
    return { ...s, unsigned: Boolean(s.unsigned) };
  } catch {
    return null;
  }
}

export function clearSession() {
  memory.delete(KEY);
  try { store().removeItem(KEY); } catch { /* ignore */ }
}

export const getToken = () => loadSession()?.token || null;
export const getAddress = () => loadSession()?.address || null;
