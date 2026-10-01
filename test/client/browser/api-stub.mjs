// A stand-in for the Moonshard API for browser checks: answers every /api call from the test, so a connected, verified
// player can be simulated (slow submits, refusals, flagged runs) without a server, a database or a chain.
// The page must have been booted with `bootGame({ api: true })` so /api is served from the page origin.

export const ADDRESS = '0x1111111111111111111111111111111111111111';

/** Script that puts a signed-in session in localStorage before the app starts (`bootGame({ init: sessionInit() })`). */
export const sessionInit = (address = ADDRESS) => `
  localStorage.setItem('moonshard.session.v1', JSON.stringify({
    token: 'test-token', address: ${JSON.stringify(address)}, host: 'web', expiresAt: Date.now() + 6 * 3600 * 1000,
  }));
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Install the stub. `api.calls` lists every request in order. `api.handlers[name]` can be replaced per test with
 * `async (req) => ({ status, body, delayMs })`; `hang` never answers. Names: start, checkpoints, submit.
 */
export async function installApi(page, { verified = true, rewardG = '2400', firstBossClaimed = false } = {}) {
  const api = {
    calls: [],
    verified,
    runs: 0,
    handlers: {
      start: async () => ({ body: null }),
      checkpoints: async () => ({ body: { ok: true, accepted: 1, duplicates: 0 } }),
      submit: async () => ({ body: { ok: true, isNewBest: true, rankedOk: true, bossCleared: false, flags: [], rank: { open: 2, ranked: 2 } } }),
    },
    callsTo: (re) => api.calls.filter((c) => re.test(c.path)),
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    let body;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    const call = { method, path, body, at: Date.now() };
    api.calls.push(call);
    const json = (status, payload) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(payload) });

    if (path === '/me' || path === '/me/refresh') return json(200, { address: ADDRESS, status: api.verified ? 'verified' : 'unverified', verified: api.verified });
    if (path === '/rewards/status') {
      return json(200, {
        crystalStatus: { gdEarned: 0, dailyCapGd: 100, isCapped: false }, firstBossClaimed, firstBossPrizeG: 5000, blessing: false,
      });
    }
    if (path === '/engagement/status') return json(200, { configured: true, claimedHere: false, canClaim: true, reason: null, pendingRunId: null, rewardG });
    if (path === '/spoils') return json(200, { spoils: [], vault: null });
    if (path === '/leaderboard' || path.startsWith('/leaderboard')) return json(200, { rows: [], me: null });

    let name;
    if (method === 'POST' && path === '/runs/start') name = 'start';
    else if (method === 'POST' && /^\/runs\/[^/]+\/checkpoints$/.test(path)) name = 'checkpoints';
    else if (method === 'POST' && /^\/runs\/[^/]+\/submit$/.test(path)) name = 'submit';
    if (!name) return json(200, {});

    if (name === 'start') {
      api.runs += 1;
      const runId = `run-${api.runs}`;
      const defaults = { runId, seed: 'seed', mode: body?.mode, chapter: body?.chapter ?? null, startedAt: new Date().toISOString(), ticket: `ticket-${api.runs}` };
      const out = await api.handlers.start({ call, defaults });
      if (out.hang) return new Promise(() => {});
      if (out.delayMs) await sleep(out.delayMs);
      return json(out.status ?? 200, out.body ?? defaults);
    }
    const out = await api.handlers[name]({ call });
    if (out.hang) return new Promise(() => {});
    if (out.delayMs) await sleep(out.delayMs);
    return json(out.status ?? 200, out.body ?? {});
  });
  return api;
}
