import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletManager, normalizeError } from '../../src/gd/wallet.js';

const CELO = '0xa4ec'; // 42220
const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

function stub({ chainId = CELO, accounts = [ADDR], rejectConnect = false, switchOk = true, switch4902 = false } = {}) {
  const listeners = {};
  const p = {
    chainId, calls: [], addCalled: false,
    on: (e, fn) => { (listeners[e] ||= []).push(fn); },
    emit: (e, ...a) => (listeners[e] || []).forEach((fn) => fn(...a)),
    async request({ method, params }) {
      p.calls.push(method);
      if (method === 'eth_requestAccounts') {
        if (rejectConnect) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        return accounts;
      }
      if (method === 'eth_accounts') return accounts;
      if (method === 'eth_chainId') return p.chainId;
      if (method === 'wallet_switchEthereumChain') {
        if (switch4902 && !p.addCalled) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        if (!switchOk) throw Object.assign(new Error('User rejected'), { code: 4001 });
        p.chainId = params[0].chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') { p.addCalled = true; return null; }
      if (method === 'personal_sign') return '0x' + 'ab'.repeat(65);
      throw new Error(`unexpected ${method}`);
    },
  };
  return p;
}

test('no wallet installed: connect reports no_wallet instead of throwing (Safari/Firefox)', async () => {
  const w = createWalletManager({ getProvider: () => undefined });
  assert.deepEqual(await w.connect(), { ok: false, reason: 'no_wallet' });
  assert.equal(w.getState().connected, false);
  assert.throws(() => w.clients(), /no_wallet/);
});

test('no injected wallet but a WalletConnect-style fallback provider -> connects through it', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => undefined, getFallbackProvider: async () => p });
  const r = await w.connect();
  assert.equal(r.ok, true);
  assert.equal(w.getState().address, ADDR.toLowerCase());
  assert.doesNotThrow(() => w.clients());
});

test('fallback provider that fails or is dismissed does not crash connect', async () => {
  const closed = createWalletManager({
    getProvider: () => undefined,
    getFallbackProvider: async () => { throw Object.assign(new Error('Connection request reset'), { code: 4001 }); },
  });
  assert.equal((await closed.connect()).reason, 'rejected');
  const none = createWalletManager({ getProvider: () => undefined, getFallbackProvider: async () => null });
  assert.equal((await none.connect()).reason, 'no_wallet');
});

test('user rejects the connect prompt', async () => {
  const w = createWalletManager({ getProvider: () => stub({ rejectConnect: true }) });
  assert.equal((await w.connect()).reason, 'rejected');
});

test('wallet with no accounts', async () => {
  const w = createWalletManager({ getProvider: () => stub({ accounts: [] }) });
  assert.equal((await w.connect()).reason, 'no_account');
});

test('already on Celo: connected, lowercase address, not wrong chain', async () => {
  const w = createWalletManager({ getProvider: () => stub() });
  const r = await w.connect();
  assert.equal(r.ok, true);
  assert.equal(r.wrongChain, false);
  assert.equal(w.getState().address, ADDR.toLowerCase());
  assert.doesNotThrow(() => w.clients());
});

test('wrong chain + switch accepted -> ends on Celo', async () => {
  const p = stub({ chainId: '0x1' });
  const w = createWalletManager({ getProvider: () => p });
  const r = await w.connect();
  assert.equal(r.wrongChain, false);
  assert.ok(p.calls.includes('wallet_switchEthereumChain'));
});

test('wrong chain + switch refused -> stays connected, wrongChain flagged, clients() blocked (no crash)', async () => {
  const p = stub({ chainId: '0x1', switchOk: false });
  const w = createWalletManager({ getProvider: () => p });
  const r = await w.connect();
  assert.equal(r.ok, true);
  assert.equal(r.wrongChain, true);
  assert.equal(w.getState().wrongChain, true);
  assert.throws(() => w.clients(), /wrong_chain/);
});

test('unknown chain (4902) falls back to wallet_addEthereumChain', async () => {
  const p = stub({ chainId: '0x1', switch4902: true });
  const w = createWalletManager({ getProvider: () => p });
  await w.connect();
  assert.equal(p.addCalled, true);
});

test('accountsChanged to empty disconnects; chainChanged updates wrongChain', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => p });
  const seen = [];
  w.subscribe((s) => seen.push(s));
  await w.connect();
  p.emit('chainChanged', '0x1');
  assert.equal(w.getState().wrongChain, true);
  p.emit('chainChanged', CELO);
  assert.equal(w.getState().wrongChain, false);
  p.emit('accountsChanged', []);
  assert.equal(w.getState().connected, false);
  assert.ok(seen.length >= 3);
});

test('restore() reconnects silently only when the same account is still exposed', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => p });
  assert.equal(await w.restore('0x0000000000000000000000000000000000000001'), false);
  assert.equal(await w.restore(ADDR.toLowerCase()), true);
  assert.equal(w.getState().connected, true);
  assert.ok(!p.calls.includes('eth_requestAccounts'));
});

test('signMessage uses personal_sign and maps rejection to Error(rejected)', async () => {
  const p = stub();
  const w = createWalletManager({ getProvider: () => p });
  await w.connect();
  assert.match(await w.signMessage('hello'), /^0x/);
  p.request = async () => { throw Object.assign(new Error('User denied message signature'), { code: 4001 }); };
  await assert.rejects(w.signMessage('hello'), /rejected/);
});

test('normalizeError turns wallet rejections into a stable code', () => {
  assert.equal(normalizeError(Object.assign(new Error('x'), { code: 4001 })).message, 'rejected');
  assert.equal(normalizeError(new Error('boom')).message, 'boom');
});
