/**
 * API base + fetch helpers.
 * In dev the SPA and API share an origin via the Vite `/api` proxy.
 */
export const API_URL = import.meta.env.VITE_API_URL || "";

/**
 * Fallback used when the relative `/api` base is unreachable — e.g. a static
 * frontend host (Vercel) that has no API proxy and no VITE_API_URL set. Keeps
 * the leaderboard/rewards working against the API without extra config.
 */
const FALLBACK_API_URL = "https://moonshard-api.onrender.com";

export function apiUrl(path, base = API_URL || "") {
  return `${base}${path}`;
}

async function fetchOnce(path, opts) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(apiUrl(path, opts.base), { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(String(body.error || "api_error"));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function apiFetch(path, opts = {}) {
  const { token, base, ...rest } = opts;
  const merged = { ...rest, token, base };
  if (merged.base || API_URL) return fetchOnce(path, merged);
  // No explicit base: try the same-origin `/api` proxy first (dev via Vite),
  // then fall back to the hosted API so a static deploy still works.
  try {
    return await fetchOnce(path, { ...merged, base: "" });
  } catch (err) {
    return fetchOnce(path, { ...merged, base: FALLBACK_API_URL });
  }
}