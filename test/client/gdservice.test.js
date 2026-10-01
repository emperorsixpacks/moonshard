import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSession, getToken, saveSession } from '../../src/gd/session.js';
import { setBlessed } from '../../src/gd/blessing.js';

/*
 * Service-level behaviour behind the Review Focus list: no wallet, wrong chain, API down or slow.
 * `gdService` is a singleton that starts itself on import, so every test imports a fresh copy
 * (cache-busting query) after stubbing `window` and `fetch`.
 */

const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const CELO = '0xa4ec';
let copy = 0;

function walletStub({ chainId = CELO, switchOk = true } = {}) {
  const p = {
    chainId,
    on() {},
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
      if (method === 'eth_chainId') return p.chainId;
      if (method === 'wallet_switchEthereumChain') {
        if (!switchOk) throw Object.assign(new Error('User rejected'), { code: 4001 });
        p.chainId = params[0].chainId;
        return null;
      }
      if (method === 'personal_sign') return `0x${'ab'.repeat(65)}`;
      throw new Error(`unexpected wallet method ${method}`);
    },
  };
  return p;
}

function serverStub(initial = {}) {
  const server = { down: false, unauthorized: false, verified: false, calls: [], ...initial };
  server.fetch = async (url, init = {}) => {
    const path = new URL(url, 'http://api.test').pathname.replace(/^\/api/, '');
    server.calls.push(`${init.method || 'GET'} ${path}`);
    if (server.down) throw new TypeError('Failed to fetch');
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const identity = { address: ADDR.toLowerCase(), verified: server.verified, status: server.verified ? 'verified' : 'unverified' };
    if (server.unauthorized && !path.startsWith('/auth/')) return reply({ error: 'invalid_session' }, 401);
    switch (path) {
      case '/auth/nonce': return reply({ nonce: 'cd'.repeat(32), issuedAt: new Date().toISOString() });
      case '/auth/verify': return reply({ token: 'jwt', ...identity });
      case '/me': case '/me/refresh': return reply(identity);
      case '/rewards/status': return reply({ blessing: true, crystalStatus: { gdEarned: 4, dailyCapGd: 100, isCapped: false } });
      case '/engagement/status': return reply({ configured: true, canClaim: true, pendingRunId: 'r9', rewardG: 5000 });
      case '/spoils': return reply({ vault: null, spoils: [] });
      default: return reply({ error: 'not_found' }, 404);
    }
  };
  return server;
}

async function startService(t, { wallet, server = serverStub(), session = null } = {}) {
  t.mock.method(console, 'warn', () => {}); // Storage warns about the missing localStorage under Node
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
  const { gdService } = await import(`../../src/engine/GdService.js?copy=${++copy}`);
  await gdService.ready;
  return gdService;
}

test('no wallet (Safari/Firefox): Connect explains it, nothing throws, the game stays playable', async (t) => {
  const gd = await startService(t);
  assert.deepEqual(
    { connected: gd.getStatus().connected, status: gd.getStatus().status, hasWallet: gd.getStatus().hasWallet },
    { connected: false, status: 'anonymous', hasWallet: false },
  );
  const res = await gd.connect();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'no_wallet');
  assert.match(res.message, /No wallet found/);
  assert.equal(gd.getStatus().busy, null);
  for (const result of [await gd.claimUbi(), await gd.claimBounty(), await gd.verifyHuman(), await gd.redeem('1')]) {
    assert.equal(result.ok, false);
    assert.equal(typeof result.message, 'string');
  }
});

test('a wallet that fails the connect prompt (e.g. -32002 request already pending) gets a readable message, not a raw code', async (t) => {
  const busy = {
    ...walletStub(),
    async request() { throw Object.assign(new Error('Already processing eth_requestAccounts. Please wait.'), { code: -32002 }); },
  };
  const gd = await startService(t, { wallet: busy });
  const res = await gd.connect();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'wallet_error');
  assert.notEqual(res.message, 'wallet_error');
  assert.match(res.message, /wallet/i);
  assert.equal(gd.getStatus().connected, false);
});

test('connect with an unverified wallet: signed in, verified-only endpoints untouched, disconnect resets everything', async (t) => {
  const server = serverStub({ verified: false });
  const gd = await startService(t, { wallet: walletStub(), server });
  const res = await gd.connect();
  assert.equal(res.ok, true);
  const s = gd.getStatus();
  assert.deepEqual(
    { connected: s.connected, status: s.status, verified: s.verified, wrongChain: s.wrongChain, address: s.address },
    { connected: true, status: 'unverified', verified: false, wrongChain: false, address: ADDR.toLowerCase() },
  );
  assert.equal(s.blessing, true);
  assert.equal(getToken(), 'jwt');
  assert.ok(!server.calls.includes('GET /engagement/status'));
  assert.ok(!server.calls.includes('GET /spoils'));

  gd.disconnect();
  const d = gd.getStatus();
  assert.deepEqual({ connected: d.connected, status: d.status, blessing: d.blessing }, { connected: false, status: 'anonymous', blessing: false });
  assert.equal(getToken(), null);
});

test('wrong chain and the player refuses to switch: stays connected, flagged, chain actions explain themselves', async (t) => {
  const gd = await startService(t, { wallet: walletStub({ chainId: '0x1', switchOk: false }), server: serverStub({ verified: true }) });
  assert.equal((await gd.connect()).ok, true);
  const s = gd.getStatus();
  assert.equal(s.connected, true);
  assert.equal(s.wrongChain, true);
  assert.equal(s.ubi, null);
  const sw = await gd.switchToCelo();
  assert.equal(sw.ok, false);
  assert.equal(sw.error, 'wrong_chain');
  assert.match(sw.message, /Celo/);
});

test('API unreachable at start-up: flagged offline, no throw; the next refresh recovers on its own', async (t) => {
  const server = serverStub({ down: true });
  const gd = await startService(t, { wallet: walletStub(), server, session: { token: 'jwt', address: ADDR, host: 'browser' } });
  assert.equal(gd.getStatus().offline, true);
  assert.equal(gd.getStatus().connected, true);

  server.down = false; // the API is back; the panel opens (or a run ends) and calls refreshAll()
  await gd.refreshAll();
  const s = gd.getStatus();
  assert.equal(s.offline, false);
  assert.equal(s.status, 'unverified');
});

test('a stale token at start-up is dropped instead of leaving a half-signed-in state', async (t) => {
  const gd = await startService(t, {
    wallet: walletStub(),
    server: serverStub({ unauthorized: true }),
    session: { token: 'old', address: ADDR, host: 'browser' },
  });
  assert.equal(gd.getStatus().connected, false);
  assert.equal(getToken(), null);
});

test('a token that dies while offline is dropped by the recovery refresh', async (t) => {
  const server = serverStub({ down: true });
  const gd = await startService(t, { wallet: walletStub(), server, session: { token: 'jwt', address: ADDR, host: 'browser' } });
  assert.equal(gd.getStatus().offline, true);
  server.down = false;
  server.unauthorized = true;
  await gd.refreshAll();
  assert.equal(gd.getStatus().connected, false);
  assert.equal(getToken(), null);
});
