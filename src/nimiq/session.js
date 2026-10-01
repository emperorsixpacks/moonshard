import { APP_NAME } from "./auth.js";

const SESSION_KEY = "moonshard.session.v1";

let cached = null;

export function loadSession() {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.token || !data.address || !Number.isFinite(data.expiresAt)) return null;
    if (data.expiresAt <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    cached = data;
    return cached;
  } catch {
    return null;
  }
}

export function saveSession({ token, address }) {
  cached = { token, address, expiresAt: Date.now() + 12 * 60 * 60 * 1000, appName: APP_NAME };
  localStorage.setItem(SESSION_KEY, JSON.stringify(cached));
  return cached;
}

export function clearSession() {
  cached = null;
  localStorage.removeItem(SESSION_KEY);
}

export function getSession() {
  return loadSession();
}

export function getToken() {
  return loadSession()?.token || null;
}

export function getAddress() {
  return loadSession()?.address || null;
}

export function isConnected() {
  return Boolean(loadSession());
}