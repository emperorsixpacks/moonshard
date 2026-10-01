import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSession, getToken } from '../../src/gd/session.js';
import { setBlessed } from '../../src/gd/blessing.js';

/*
 * Inside MiniPay the player must be signed in automatically (no connect button, no signature prompt) and the game
 * must be honest about what a non-signing wallet cannot do (the Engagement Rewards bounty needs an EIP-712 signature).
 */

const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
let copy = 0;

function miniPayWallet({ reject = false } = {}) {
  const calls = [];
  const p = {
    isMiniPay: true,
    calls,
    on() {},
    async request({ method }) {
      calls.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        if (reject) throw Object.assign(new Error('User rejected'), { code: 4001 });
        return [ADDR];
      }
      if (method === 'eth_chainId') return '0xa4ec';
      if (method === 'personal_sign' || method === 'eth_signTypedData_v4') throw new Error('MiniPay cannot sign');
      throw new Error(`unexpected wallet method ${method}`);
    },
  };
  return p;
}

function serverStub({ unsignedStatus = 200 } = {}) {
  const server = { calls: [], unsignedStatus };
  server.fetch = async (url, init = {}) => {
    const path = new URL(url, 'http://api.test').pathname.replace(/^\/api/, '');
    server.calls.push(`${init.method || 'GET'} ${path}`);
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const identity = { address: ADDR.toLowerCase(), verified: true, status: 'verified', unsigned: true };
    switch (path) {
      case '/auth/unsigned':
        return server.unsignedStatus === 200 ? reply({ token: 'jwt-unsigned', ...identity }) : reply({ error: 'unsigned_disabled' }, server.unsignedStatus);
      case '/me': case '/me/refresh': return reply(identity);
      case '/rewards/status': return reply({ blessing: false, crystalStatus: { gdEarned: 0, dailyCapGd: 100, isCapped: false } });
      case '/engagement/status': return reply({ configured: true, needsSignature: true, canClaim: null, pendingRunId: 'run-1', rewardG: 5000 });
      case '/spoils': return reply({ vault: null, spoils: [] });
      default: return reply({ error: 'not_found' }, 404);
    }
  };
  return server;
}

async function startInMiniPay(t, { wallet = miniPayWallet(), server = serverStub() } = {}) {
  t.mock.method(console, 'warn', () => {});
  clearSession();
  globalThis.window = {
    location: { origin: 'http://localhost', pathname: '/', search: '', href: 'http://localhost/' },
    navigator: { language: 'en-US', userAgent: 'node-test' },
    history: { replaceState() {} },
    ethereum: wallet,
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
  gdService.loaders.ubi = async () => ({
    prepareUbi: async () => ({}),
    ubiStatus: async () => ({ entitlementG: '114', canClaim: true, nextClaimAt: null }),
    claimUbi: async () => ({ hash: `0x${'11'.repeat(32)}` }),
  });
  return { gd: gdService, wallet, server };
}

test('inside MiniPay the player is signed in on load: no click, no signature request, session marked unsigned', async (t) => {
  const { gd, wallet, server } = await startInMiniPay(t);
  const s = gd.getStatus();
  assert.deepEqual(
    { connected: s.connected, verified: s.verified, unsigned: s.unsigned, autoConnect: s.autoConnect, host: s.host },
    { connected: true, verified: true, unsigned: true, autoConnect: true, host: 'minipay' },
  );
  assert.ok(server.calls.includes('POST /auth/unsigned'));
  assert.ok(!server.calls.includes('GET /auth/nonce'));
  assert.ok(!wallet.calls.includes('personal_sign'));
  assert.ok(!wallet.calls.includes('eth_signTypedData_v4'));
  assert.equal(getToken(), 'jwt-unsigned');
});

test('the boss bounty explains itself instead of prompting a signature MiniPay cannot produce', async (t) => {
  const { gd, wallet } = await startInMiniPay(t);
  const res = await gd.claimBounty();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'signature_required');
  assert.match(res.message, /MiniPay|sign/i);
  assert.ok(!wallet.calls.includes('eth_signTypedData_v4'));
});

test('MiniPay still gets the daily UBI claim and Spoils redemption (plain transactions)', async (t) => {
  const { gd, server } = await startInMiniPay(t);
  const res = await gd.claimUbi();
  assert.equal(res.ok, true);
  assert.equal(res.hash, `0x${'11'.repeat(32)}`);
  assert.ok(server.calls.includes('POST /ubi/confirm'));
});

test('if MiniPay refuses to expose an account, the game stays playable and nothing throws', async (t) => {
  const { gd, server } = await startInMiniPay(t, { wallet: miniPayWallet({ reject: true }) });
  const s = gd.getStatus();
  assert.deepEqual({ connected: s.connected, status: s.status, busy: s.busy }, { connected: false, status: 'anonymous', busy: null });
  assert.ok(!server.calls.includes('POST /auth/unsigned'));
});

test('if the server turns signing-free sessions off, MiniPay players are simply anonymous (no crash, no signature prompt)', async (t) => {
  const { gd, wallet } = await startInMiniPay(t, { server: serverStub({ unsignedStatus: 403 }) });
  assert.equal(gd.getStatus().connected, false);
  assert.ok(!wallet.calls.includes('personal_sign'));
});
