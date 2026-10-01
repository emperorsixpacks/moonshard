import { clearSession, saveSession } from '../../../src/gd/session.js';
import { setBlessed } from '../../../src/gd/blessing.js';
import { createPendingConfirms } from '../../../src/gd/pending.js';

/**
 * Shared harness for GdService tests: a scriptable wallet (EIP-1193), a scriptable API (fetch), and a fresh
 * GdService copy per test (the service is a singleton that starts itself on import).
 */
export const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
export const ADDR2 = '0x1234567890123456789012345678901234567890';
export const H1 = `0x${'11'.repeat(32)}`;
export const H2 = `0x${'22'.repeat(32)}`;
export const H3 = `0x${'33'.repeat(32)}`;
const CELO = '0xa4ec';
let copy = 0;

export function walletStub({ accounts = [ADDR], chainId = CELO } = {}) {
  const handlers = {};
  const p = {
    accounts,
    chainId,
    calls: [],
    on(e, fn) { (handlers[e] ||= []).push(fn); },
    emit(e, ...a) { (handlers[e] || []).forEach((fn) => fn(...a)); },
    async request({ method, params }) {
      p.calls.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return p.accounts;
      if (method === 'eth_chainId') return p.chainId;
      if (method === 'wallet_switchEthereumChain') { p.chainId = params[0].chainId; return null; }
      if (method === 'personal_sign') return `0x${'ab'.repeat(65)}`;
      throw new Error(`unexpected wallet method ${method}`);
    },
  };
  return p;
}

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/**
 * `handlers[path]` may replace any default answer: `(ctx) => reply(...)` or a plain object / Promise of one,
 * where ctx = { token, body, n } (n = how many times this path was called).
 */
export function serverStub(opts = {}) {
  const server = {
    calls: [],
    counts: {},
    verified: true,
    nextToken: 'jwt',
    tokenOk: () => true,
    blessed: false,
    confirmStatus: 200,
    confirmed: [],
    handlers: {},
    down: false,
    ...opts,
  };
  server.fetch = async (url, init = {}) => {
    const path = new URL(url, 'http://api.test').pathname.replace(/^\/api/, '');
    const token = (init.headers?.Authorization || '').replace('Bearer ', '') || null;
    const body = init.body ? JSON.parse(init.body) : undefined;
    server.counts[path] = (server.counts[path] || 0) + 1;
    server.calls.push(`${init.method || 'GET'} ${path}`);
    if (server.down) throw new TypeError('Failed to fetch');
    const ctx = { token, body, n: server.counts[path] };
    if (server.handlers[path]) {
      const out = await (typeof server.handlers[path] === 'function' ? server.handlers[path](ctx) : server.handlers[path]);
      if (out !== undefined) return out; // a handler that returns nothing falls through to the default answer
    }
    const identity = { address: ADDR.toLowerCase(), verified: server.verified, status: server.verified ? 'verified' : 'unverified' };
    const authed = !path.startsWith('/auth/') && path !== '/config';
    if (authed && !server.tokenOk(token)) return reply({ error: 'invalid_session' }, 401);
    switch (path) {
      case '/auth/nonce': return reply({ nonce: 'cd'.repeat(32), issuedAt: new Date().toISOString() });
      case '/auth/verify': return reply({ token: server.nextToken, ...identity });
      case '/me': case '/me/refresh': return reply(identity);
      case '/rewards/status': return reply({ blessing: server.blessed, firstBossPrizeG: 2400, crystalStatus: { gdEarned: 0, dailyCapGd: 100, isCapped: false } });
      case '/engagement/status': return reply({ configured: true, canClaim: true, pendingRunId: 'run-1', rewardG: 2400 });
      case '/spoils':
        return reply({
          vault: { address: '0x00000000000000000000000000000000000ba5e1' },
          spoils: [{ id: '7', kind: 'TRIAL_PRIZE', day: '2026-10-05', rank: 1, amount: '1', amountG: '1', claimed: false, voucher: { to: ADDR, id: '7', amount: '1', deadline: '9', signature: '0x00' } }],
        });
      case '/ubi/confirm': case '/engagement/confirm': case '/spoils/confirm': {
        if (server.confirmStatus !== 200) return reply({ error: server.confirmStatus === 503 ? 'chain_unavailable' : server.confirmStatus === 401 ? 'invalid_session' : 'tx_not_today' }, server.confirmStatus);
        server.confirmed.push(`${path}:${body.txHash}`);
        if (path === '/ubi/confirm') server.blessed = true;
        return reply({ ok: true, recorded: true });
      }
      default: return reply({ error: 'not_found' }, 404);
    }
  };
  return server;
}

export const stubLoaders = (over = {}) => ({
  ubi: async () => ({
    prepareUbi: async () => ({ account: ADDR.toLowerCase() }),
    ubiStatus: async () => ({ entitlementG: '114', canClaim: true, nextClaimAt: null }),
    claimUbi: async () => ({ hash: H1 }),
    ...over.ubi,
  }),
  identity: async () => ({ faceVerificationLink: async () => 'http://fv.test' }),
  engagement: async () => ({ claimBounty: async () => ({ hash: H2 }), ...over.engagement }),
  spoils: async () => ({ redeemSpoil: async () => ({ hash: H3 }), ...over.spoils }),
});

/**
 * Boots a fresh GdService. `session` pre-seeds a stored session (so init() restores it);
 * `awaitReady: false` returns before init() has finished (for race tests).
 */
export async function startService(t, { wallet, server = serverStub(), session = null, awaitReady = true, connect = false } = {}) {
  t.mock.method(console, 'warn', () => {});
  clearSession();
  if (session) saveSession(session);
  globalThis.window = {
    location: { origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' },
    navigator: { language: 'en-US', userAgent: 'node-test' },
    history: { replaceState() {} },
    ...(wallet ? { ethereum: wallet } : {}),
  };
  globalThis.fetch = server.fetch;
  t.after(() => {
    delete globalThis.window;
    delete globalThis.fetch;
    clearSession();
    setBlessed(false);
  });
  const { gdService } = await import(`../../../src/engine/GdService.js?copy=${++copy}`);
  if (awaitReady) await gdService.ready;
  gdService.pending = createPendingConfirms({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  gdService.loaders = stubLoaders();
  if (connect) {
    const res = await gdService.connect();
    if (!res.ok) throw new Error(`test setup: connect failed ${JSON.stringify(res)}`);
  }
  return { gd: gdService, server, wallet };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** Polls until `check()` is truthy (no arbitrary sleeps in the tests that wait for background work). */
export async function until(check, { timeoutMs = 1500, label = 'condition' } = {}) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(2);
  }
}

export { reply };
