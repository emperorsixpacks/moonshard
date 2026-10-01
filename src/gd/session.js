const KEY = 'moonshard.session.v1';
const TTL_MS = 12 * 60 * 60 * 1000;
const memory = new Map();

function store() {
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

export function saveSession({ token, address, host }) {
  const session = { token, address: String(address).toLowerCase(), host, expiresAt: Date.now() + TTL_MS };
  const json = JSON.stringify(session);
  try {
    const target = store();
    target.setItem(KEY, json);
    if (!target.isMemory) memory.delete(KEY); // a real store took the write: it is the single source of truth again
  } catch {
    memory.set(KEY, json); // storage rejected the write; this copy must beat any older value still stored
  }
  return session;
}

export function loadSession() {
  try {
    // `memory` holds the newest session when localStorage exists but rejected the write (quota / restricted
    // storage), so it is read first: whatever storage still holds is older.
    const raw = memory.get(KEY) ?? store().getItem(KEY) ?? null;
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.token || !s.address || !Number.isFinite(s.expiresAt) || s.expiresAt <= Date.now()) {
      clearSession();
      return null;
    }
    return s;
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
