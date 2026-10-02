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
  const root = String(base).replace(/\/+$/, ''); // "https://api.example/" would otherwise ask for //api/...
  try {
    const res = await fetchImpl(`${root}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const body = json ?? {};
      const err = new Error(String(body.error || 'api_error'));
      err.status = res.status;
      err.body = body;
      throw err;
    }
    if (json === null) {
      // 2xx with a body that is not JSON: an SPA fallback page, a captive portal or a proxy error page
      const err = new Error('bad_response');
      err.status = res.status;
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
