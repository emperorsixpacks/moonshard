// A stand-in for the Moonshard API for browser checks: answers every /api call from the test, so a connected, verified
// player can be simulated (slow submits, refusals, flagged runs) without a server, a database or a chain.
// The page must have been booted with `bootGame({ api: true })` so /api is served from the page origin.
//
// It follows the real server's rules for runs (server/src/runs.js): POST /runs/start voids the player's previous open run
// of that mode, a submit on a void run is 409 run_void, a second submit of a run is 409 already_submitted, and a request
// takes effect when it ARRIVES, `latencyMs` after it was sent, not when its answer is delivered.

import { formatUnits } from 'viem';
import { GAME } from '../../../server/config.js';

export const ADDRESS = '0x1111111111111111111111111111111111111111';
export const VAULT = '0x00000000000000000000000000000000000ba5e1';
/** GET /shop as the real server answers it, from the server's own catalog (server/config.js GAME.SHOP). */
export const SHOP = {
  enabled: true,
  token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A',
  vault: VAULT,
  items: GAME.SHOP.map(({ id, name, kind, price, requires }) => ({ id, name, kind, priceG: formatUnits(price, 18), requires: requires ?? null })),
};

/** Script that puts a signed-in session in localStorage before the app starts (`bootGame({ init: sessionInit() })`). */
export const sessionInit = (address = ADDRESS) => `
  localStorage.setItem('moonshard.session.v1', JSON.stringify({
    token: 'test-token', address: ${JSON.stringify(address)}, host: 'web', expiresAt: Date.now() + 6 * 3600 * 1000,
  }));
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RANKED = { ok: true, isNewBest: true, rankedOk: true, bossCleared: false, flags: [], rank: { open: 2, ranked: 2 } };

/**
 * Install the stub. `api.calls` lists every request (`at`: when it arrived, `answeredAt`: when its answer left) and
 * `api.runs` the server's view of each run. Per-test behaviour: `api.latencyMs`, and `api.handlers[name]` (start,
 * checkpoints, submit) replaced by `async ({ call, run }) => ({ status, body, delayMs, hang })`.
 */
export async function installApi(page, { verified = true, rewardG = '2400', firstBossClaimed = false, owned = ['iron_starter'], shop = SHOP, prizes = true } = {}) {
  const api = {
    calls: [],
    verified,
    // whether the server pays the daily prizes and the Shard Harvest (PRIZES_ENABLED); off is the deployed default
    prizes,
    // the Moon Shop: what GET /shop answers, and what the player owns (a player who plays has bought the blade)
    shop,
    owned: [...owned],
    // what the server says about the first-boss bounty: flip `canClaim` to false (and `rewardG` to null) for an app that
    // GoodDollar has not approved yet
    engagement: { configured: true, canClaim: true, reason: null, rewardG },
    latencyMs: 0,
    runs: new Map(), // runId -> { runId, mode, chapter, status: 'open' | 'void' | 'submitted', submit }
    handlers: {
      start: async () => ({}),
      checkpoints: async () => ({ body: { ok: true, accepted: 1, duplicates: 0 } }),
      submit: async ({ run, call }) => {
        const bossCleared = call.body?.bossCleared === true;
        return { body: { ...RANKED, bossCleared, rankedOk: true, rank: run.mode === 'TRIAL' ? RANKED.rank : null } };
      },
    },
    callsTo: (re) => api.calls.filter((c) => re.test(c.path)),
    runList: () => [...api.runs.values()],
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();
    let body;
    try { body = request.postDataJSON(); } catch { body = undefined; }
    await sleep(api.latencyMs); // the request travels
    const call = { method, path, body, at: Date.now(), answeredAt: null };
    api.calls.push(call);
    const json = async (status, payload) => {
      await sleep(api.latencyMs); // the answer travels
      call.answeredAt = Date.now();
      return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(payload) });
    };

    if (path === '/me' || path === '/me/refresh') return json(200, { address: ADDRESS, status: api.verified ? 'verified' : 'unverified', verified: api.verified });
    if (path === '/rewards/status') {
      return json(200, {
        crystalStatus: { gdEarned: 0, dailyCapGd: 100, isCapped: false },
        firstBossClaimed,
        firstBossPrizeG: api.engagement.rewardG === null ? null : Number(api.engagement.rewardG), // the player's share, as the real server reports it
        blessing: false,
        owned: [...api.owned],
        prizesEnabled: api.prizes,
      });
    }
    if (path === '/shop') return json(200, api.shop);
    if (path === '/engagement/status') {
      const e = api.engagement;
      return json(200, { configured: e.configured, claimedHere: false, canClaim: e.canClaim, reason: e.reason, pendingRunId: null, rewardG: e.rewardG });
    }
    if (path === '/spoils') return json(200, { spoils: [], vault: null });
    // the real shapes: server/src/leaderboard.js and the /config route in server/src/app.js
    if (path === '/leaderboard/daily') return json(200, { day: '2026-10-05', view: 'ranked', entries: [], prizesG: api.prizes ? ['1000', '600', '300'] : [] });
    if (path === '/leaderboard/alltime') return json(200, { view: 'ranked', entries: [] });
    if (path === '/config') {
      return json(200, api.prizes
        ? { appName: 'Moonshard', chainId: 42220, prizesEnabled: true, prizesG: ['1000', '600', '300'], shardRateG: '2', dailyShardCap: 50 }
        : { appName: 'Moonshard', chainId: 42220, prizesEnabled: false, prizesG: [], shardRateG: '0', dailyShardCap: 0 });
    }

    if (method === 'POST' && path === '/runs/start') {
      const id = `run-${api.runs.size + 1}`;
      const defaults = { runId: id, seed: 'seed', mode: body?.mode, chapter: body?.chapter ?? null, startedAt: new Date().toISOString(), ticket: `ticket-${id}` };
      for (const r of api.runs.values()) if (r.mode === body?.mode && r.status === 'open') r.status = 'void'; // the server voids the previous open run
      const run = { runId: id, mode: body?.mode, chapter: body?.chapter ?? null, status: 'open', startedAt: call.at };
      api.runs.set(id, run);
      call.run = id;
      const out = await api.handlers.start({ call, defaults, run });
      if (out.hang) return new Promise(() => {});
      if (out.delayMs) await sleep(out.delayMs);
      return json(out.status ?? 200, out.body ?? defaults);
    }

    const m = /^\/runs\/([^/]+)\/(checkpoints|submit)$/.exec(path);
    if (method === 'POST' && m) {
      const [, id, kind] = m;
      const run = api.runs.get(id);
      call.run = id;
      if (!run) return json(404, { error: 'run_not_found' });
      if (kind === 'submit') {
        // the transition happens now, on arrival, whatever the answer will be
        if (run.status === 'void') return json(409, { error: 'run_void' });
        if (run.status === 'submitted') return json(409, { error: 'already_submitted' });
      }
      const out = await api.handlers[kind]({ call, run });
      if (kind === 'submit' && (out.status ?? 200) < 400) { run.status = 'submitted'; run.submit = call.body; }
      if (out.hang) return new Promise(() => {});
      if (out.delayMs) await sleep(out.delayMs);
      return json(out.status ?? 200, out.body ?? {});
    }
    return json(200, {});
  });
  return api;
}
