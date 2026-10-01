import { GD } from './config.js';

/**
 * Fetch JSON from the Moonshard API. Errors are `Error(code)` with `.status` (0 for network/timeout)
 * and `.body` (parsed JSON, when present).
 */
export async function apiFetch(path, {
  method = 'GET', token, body, base = GD.apiUrl, fetchImpl = globalThis.fetch, timeoutMs = 9000,
} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(String(json.error || 'api_error'));
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } catch (err) {
    if (err?.status !== undefined) throw err;
    const wrapped = new Error(err?.name === 'AbortError' ? 'timeout' : 'network_error');
    wrapped.status = 0;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}
