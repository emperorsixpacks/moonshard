import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSession, saveSession } from '../../src/gd/session.js';
import { setBlessed } from '../../src/gd/blessing.js';
import { createPendingConfirms } from '../../src/gd/pending.js';

/*
 * Money-path behaviour: the on-chain action has succeeded (the player was paid) but the server confirmation
 * fails. The player must see success, and the confirmation must be retried until the server records it.
 */

const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const H1 = `0x${'11'.repeat(32)}`;
const H2 = `0x${'22'.repeat(32)}`;
const H3 = `0x${'33'.repeat(32)}`;
let copy = 0;

function walletStub() {
  return {
    on() {},
    async request({ method }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
      if (method === 'eth_chainId') return '0xa4ec';
      if (method === 'personal_sign') return `0x${'ab'.repeat(65)}`;
      throw new Error(`unexpected wallet method ${method}`);
    },
  };
}

function serverStub() {
  const server = { confirmStatus: 503, confirmed: [], blessed: false, calls: [] };
  server.fetch = async (url, init = {}) => {
    const path = new URL(url, 'http://api.test').pathname.replace(/^\/api/, '');
    server.calls.push(`${init.method || 'GET'} ${path}`);
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const identity = { address: ADDR.toLowerCase(), verified: true, status: 'verified' };
    switch (path) {
      case '/auth/nonce': return reply({ nonce: 'cd'.repeat(32), issuedAt: new Date().toISOString() });
      case '/auth/verify': return reply({ token: 'jwt', ...identity });
      case '/me': case '/me/refresh': return reply(identity);
      case '/rewards/status': return reply({ blessing: server.blessed, crystalStatus: { gdEarned: 0, dailyCapGd: 100, isCapped: false } });
      case '/engagement/status': return reply({ configured: true, canClaim: true, pendingRunId: 'run-1', rewardG: 5000 });
      case '/spoils':
        return reply({
          vault: { address: '0x00000000000000000000000000000000000ba5e1' },
          spoils: [{ id: '7', kind: 'TRIAL_PRIZE', day: '2026-10-05', rank: 1, amount: '1', amountG: '1', claimed: false, voucher: { to: ADDR, id: '7', amount: '1', deadline: '9', signature: '0x00' } }],
        });
      case '/ubi/confirm': case '/engagement/confirm': case '/spoils/confirm': {
        if (server.confirmStatus !== 200) return reply({ error: server.confirmStatus === 503 ? 'chain_unavailable' : 'tx_not_today' }, server.confirmStatus);
        server.confirmed.push(`${path}:${JSON.parse(init.body).txHash}`);
        if (path === '/ubi/confirm') server.blessed = true;
        return reply({ ok: true, recorded: true });
      }
      default: return reply({ error: 'not_found' }, 404);
    }
  };
  return server;
}

async function startConnected(t, { preload } = {}) {
  t.mock.method(console, 'warn', () => {});
  clearSession();
  const server = serverStub();
  globalThis.window = {
    location: { origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' },
    navigator: { language: 'en-US', userAgent: 'node-test' },
    history: { replaceState() {} },
    ethereum: walletStub(),
  };
  globalThis.fetch = server.fetch;
  t.after(() => {
    delete globalThis.window;
    delete globalThis.fetch;
    clearSession();
    setBlessed(false);
  });
  if (preload) {
    const { pending } = await import('../../src/gd/pending.js');
    preload(pending);
    saveSession({ token: 'jwt', address: ADDR, host: 'browser' });
  }
  const { gdService } = await import(`../../src/engine/GdService.js?copy=${++copy}`);
  await gdService.ready;
  // fresh queue per test so the shared singleton never leaks between tests
  if (!preload) gdService.pending = createPendingConfirms({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  gdService.loaders = {
    ubi: async () => ({
      prepareUbi: async () => ({}),
      ubiStatus: async () => ({ entitlementG: '114', canClaim: true, nextClaimAt: null }),
      claimUbi: async () => ({ hash: H1 }),
    }),
    identity: async () => ({ faceVerificationLink: async () => 'http://fv.test' }),
    engagement: async () => ({ claimBounty: async () => ({ hash: H2 }) }),
    spoils: async () => ({ redeemSpoil: async () => ({ hash: H3 }) }),
  };
  if (!preload) {
    const res = await gdService.connect();
    assert.equal(res.ok, true);
  }
  return { gd: gdService, server };
}

test('UBI claim paid on-chain but the server confirmation is down: success is reported, and the blessing arrives on the next refresh', async (t) => {
  const { gd, server } = await startConnected(t);
  const res = await gd.claimUbi();
  assert.equal(res.ok, true);
  assert.equal(res.hash, H1);
  assert.equal(res.confirmPending, true);
  assert.equal(gd.pending.list().length, 1);
  assert.equal(gd.getStatus().blessing, false);

  server.confirmStatus = 200; // the API is back
  await gd.refreshAll();
  assert.equal(gd.pending.list().length, 0);
  assert.deepEqual(server.confirmed, [`/ubi/confirm:${H1}`]);
  assert.equal(gd.getStatus().blessing, true);
});

test('UBI claim with a healthy server confirms immediately and queues nothing', async (t) => {
  const { gd, server } = await startConnected(t);
  server.confirmStatus = 200;
  const res = await gd.claimUbi();
  assert.deepEqual({ ok: res.ok, confirmPending: res.confirmPending }, { ok: true, confirmPending: false });
  assert.equal(gd.pending.list().length, 0);
  assert.equal(gd.getStatus().blessing, true);
});

test('a final rejection from the server (e.g. tx not from today) is not retried forever, and the player still sees the claim succeed', async (t) => {
  const { gd, server } = await startConnected(t);
  server.confirmStatus = 422;
  const res = await gd.claimUbi();
  assert.equal(res.ok, true);
  assert.equal(res.confirmPending, false);
  assert.equal(gd.pending.list().length, 0);
});

test('bounty paid on-chain with the server down is still a success and is confirmed later', async (t) => {
  const { gd, server } = await startConnected(t);
  const res = await gd.claimBounty();
  assert.equal(res.ok, true);
  assert.equal(res.hash, H2);
  assert.equal(gd.pending.list().length, 1);
  server.confirmStatus = 200;
  await gd.refreshAll();
  assert.deepEqual(server.confirmed, [`/engagement/confirm:${H2}`]);
});

test('Spoils redeemed on-chain with the server down: success, confirmed later', async (t) => {
  const { gd, server } = await startConnected(t);
  const res = await gd.redeem('7');
  assert.equal(res.ok, true);
  assert.equal(res.hash, H3);
  server.confirmStatus = 200;
  await gd.refreshAll();
  assert.deepEqual(server.confirmed, [`/spoils/confirm:${H3}`]);
  assert.equal(gd.pending.list().length, 0);
});

test('confirmations left over from a previous visit are retried at start-up', async (t) => {
  const { gd, server } = await startConnected(t, { preload: (pending) => pending.add('ubi', H1) });
  assert.equal(gd.getStatus().connected, true);
  // server was returning 503 during init, so it stays queued...
  assert.equal(gd.pending.list().length, 1);
  server.confirmStatus = 200;
  await gd.refreshAll();
  assert.equal(gd.pending.list().length, 0);
  assert.equal(gd.getStatus().blessing, true);
});

test('a failure BEFORE the chain action (e.g. wallet rejects) is still an error and queues nothing', async (t) => {
  const { gd } = await startConnected(t);
  gd.loaders.ubi = async () => ({
    prepareUbi: async () => ({}),
    ubiStatus: async () => ({ entitlementG: '1', canClaim: true, nextClaimAt: null }),
    claimUbi: async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); },
  });
  const res = await gd.claimUbi();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'rejected');
  assert.equal(gd.pending.list().length, 0);
});
