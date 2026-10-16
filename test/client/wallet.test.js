import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletManager, discoverWallets, normalizeError } from '../../src/gd/wallet.js';

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

/* ---- several wallet extensions at once (EIP-6963) ---- */

/**
 * A page where wallet extensions announce themselves (EIP-6963), as MetaMask and Rabby do: each answers a request for
 * providers with its own. `ethereum` is window.ethereum, which two extensions fighting over it can leave broken.
 */
function pageWith(wallets, { ethereum } = {}) {
  const target = new EventTarget();
  target.addEventListener('eip6963:requestProvider', () => {
    for (const w of wallets) target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: w.info, provider: w.provider }) }));
  });
  return {
    ethereum,
    addEventListener: (...a) => target.addEventListener(...a),
    removeEventListener: (...a) => target.removeEventListener(...a),
    dispatchEvent: (e) => target.dispatchEvent(e),
    announceLater: (w) => target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: w.info, provider: w.provider }) })),
  };
}
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const broken = { request: async () => { throw new Error('two extensions fought over window.ethereum'); }, on() {} };
const metamask = () => ({ info: { uuid: 'u-1', name: 'MetaMask', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.metamask' }, provider: stub() });
const rabby = () => ({ info: { uuid: 'u-2', name: 'Rabby Wallet', icon: 'https://tracker.example/rabby.png', rdns: 'io.rabby' }, provider: stub() });

test('every wallet that announces itself is found, with its name and a safe icon; malformed announcements are ignored', () => {
  const m = metamask();
  const r = rabby();
  const page = pageWith([m, r, { info: { name: 'No id' }, provider: stub() }, { info: { rdns: 'x.no.provider', name: 'X' }, provider: {} }]);
  const found = discoverWallets(page).list();
  assert.deepEqual(found.map(({ id, name, icon }) => ({ id, name, icon })), [
    { id: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { id: 'io.rabby', name: 'Rabby Wallet', icon: null }, // only an image in the page itself is shown, never a remote one
  ]);
  assert.equal(found[0].provider, m.provider);
  const late = discoverWallets(pageWith([]));
  assert.equal(late.list().length, 0);
});

test('a wallet that announces itself after the page started is found too', () => {
  const page = pageWith([]);
  const seen = [];
  const found = discoverWallets(page, () => seen.push('changed'));
  page.announceLater(metamask());
  assert.equal(found.list().length, 1);
  assert.deepEqual(seen, ['changed']);
});

test('with two wallets installed, connecting asks which one, then talks to that one only: not to a broken window.ethereum', async () => {
  const m = metamask();
  const r = rabby();
  const w = createWalletManager({ page: pageWith([m, r], { ethereum: broken }), getProvider: () => broken, storage: memoryStorage() });
  assert.deepEqual(w.getState().wallets.map((x) => x.id), ['io.metamask', 'io.rabby']);
  assert.deepEqual(await w.connect(), { ok: false, reason: 'choose_wallet' });
  const done = await w.connect('io.rabby');
  assert.equal(done.ok, true);
  assert.ok(r.provider.calls.includes('eth_requestAccounts'));
  assert.deepEqual(m.provider.calls, [], 'MetaMask was never asked');
  assert.equal(w.getState().address, ADDR.toLowerCase());
  assert.doesNotThrow(() => w.clients());
});

test('with one wallet installed, connecting uses it straight away', async () => {
  const m = metamask();
  const w = createWalletManager({ page: pageWith([m], { ethereum: broken }), storage: memoryStorage() });
  assert.equal((await w.connect()).ok, true);
  assert.ok(m.provider.calls.includes('eth_requestAccounts'));
});

test('a wallet that does not announce itself is still reached through window.ethereum, as before', async () => {
  const legacy = stub();
  // on a real page `page` is window and the injected wallet is window.ethereum: here both are handed in
  const w = createWalletManager({ page: pageWith([], { ethereum: legacy }), getProvider: () => legacy, storage: memoryStorage() });
  assert.deepEqual(w.getState().wallets, []);
  assert.equal((await w.connect()).ok, true);
  assert.ok(legacy.calls.includes('eth_requestAccounts'));
});

test('an unknown wallet id is refused, not guessed', async () => {
  const w = createWalletManager({ page: pageWith([metamask(), rabby()]), storage: memoryStorage() });
  assert.deepEqual(await w.connect('io.unknown'), { ok: false, reason: 'no_wallet' });
});

test('the wallet picked is remembered: after a reload the session is restored from that same wallet', async () => {
  const storage = memoryStorage();
  const first = createWalletManager({ page: pageWith([metamask(), rabby()], { ethereum: broken }), storage });
  await first.connect('io.rabby');
  const m = metamask();
  const r = rabby();
  const again = createWalletManager({ page: pageWith([m, r], { ethereum: broken }), storage });
  assert.equal(await again.restore(ADDR), true);
  assert.ok(r.provider.calls.includes('eth_accounts'));
  assert.deepEqual(m.provider.calls, []);
  const later = createWalletManager({ page: pageWith([metamask(), rabby()]), storage });
  assert.equal((await later.connect()).ok, true, 'connecting again needs no choice: the remembered wallet is used');
});

test('a session that turns announced wallets off (the local test launcher) only ever uses its own wallet', async () => {
  const m = metamask();
  const own = stub();
  const w = createWalletManager({ page: pageWith([m, rabby()]), getProvider: () => own, offerAnnounced: false, storage: memoryStorage() });
  assert.deepEqual(w.getState().wallets, []);
  assert.equal((await w.connect('io.metamask')).ok, true, 'even when a wallet is named');
  assert.ok(own.calls.includes('eth_requestAccounts'));
  assert.deepEqual(m.provider.calls, [], 'the real wallet extension was never asked');
});

// ---- signing in with an email (gd/magic.js) ---------------------------------------------------------------------------------

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; };
/** A stand-in for the email sign-in: `provider` is what a signed-in player has, null before they sign in. */
const emailStub = ({ provider = null, available = true } = {}) => {
  const e = { available, provider: provider, logouts: 0 };
  e.provider = async () => e.signedIn;
  e.signedIn = provider;
  e.logout = async () => { e.logouts += 1; e.signedIn = null; };
  return e;
};
const manager = (email, storage = memory(), extra = {}) => createWalletManager({ getProvider: () => undefined, offerAnnounced: false, storage, email, ...extra });

test('email: not offered unless the game has a key', () => {
  assert.equal(manager(null).getState().emailAvailable, false);
  assert.equal(manager(emailStub({ available: false })).getState().emailAvailable, false);
  assert.equal(manager(emailStub()).getState().emailAvailable, true);
});

test('email: connecting before signing in says so, and connects after', async () => {
  const e = emailStub();
  const w = manager(e);
  assert.deepEqual(await w.connect('email'), { ok: false, reason: 'not_signed_in' });
  assert.equal(w.getState().connected, false);
  e.signedIn = stub();
  const r = await w.connect('email');
  assert.equal(r.ok, true);
  assert.equal(w.getState().address, ADDR.toLowerCase());
  assert.doesNotThrow(() => w.clients());
});

test('email: a failure while looking for the signed-in wallet does not throw', async () => {
  const e = emailStub();
  e.provider = async () => { throw new Error('Magic is unreachable'); };
  assert.equal((await manager(e).connect('email')).reason, 'wallet_error');
});

test('email: a signature and the chain come from the email wallet like from any other', async () => {
  const w = manager(emailStub({ provider: stub() }));
  await w.connect('email');
  assert.equal(w.getState().wrongChain, false);
  assert.match(await w.signMessage('Moonshard login'), /^0x[0-9a-f]+$/);
});

test('email: the wallet is remembered, and a reload reconnects to it without a prompt', async () => {
  const storage = memory();
  const e = emailStub({ provider: stub() });
  await manager(e, storage).connect('email');
  const reloaded = manager(e, storage);
  assert.equal(await reloaded.restore(ADDR), true);
  assert.equal(reloaded.getState().connected, true);
  // an account Magic does not hold any more is not restored
  const other = manager(emailStub({ provider: stub({ accounts: ['0x0000000000000000000000000000000000000001'] }) }), storage);
  assert.equal(await other.restore(ADDR), false);
});

test('email: after a sign-out elsewhere the reload finds nothing to restore', async () => {
  const storage = memory();
  const e = emailStub({ provider: stub() });
  await manager(e, storage).connect('email');
  e.signedIn = null; // Magic says the player is no longer signed in
  assert.equal(await manager(e, storage).restore(ADDR), false);
});

test('email: "reconnect" with no wallet chosen reuses the remembered email wallet', async () => {
  const storage = memory();
  const e = emailStub({ provider: stub() });
  await manager(e, storage).connect('email');
  const again = manager(e, storage);
  assert.equal((await again.connect()).ok, true);
});

test('email: disconnecting signs out of Magic and forgets the wallet, so a reload does not sign back in', async () => {
  const storage = memory();
  const e = emailStub({ provider: stub() });
  const w = manager(e, storage);
  await w.connect('email');
  w.disconnect();
  await new Promise((r) => setImmediate(r));
  assert.equal(e.logouts, 1);
  assert.equal(w.getState().connected, false);
  assert.equal(storage.has('moonshard.wallet.v1'), false);
  assert.equal(await manager(e, storage).restore(ADDR), false);
});

test('email: a failed sign-out still disconnects', async () => {
  const e = emailStub({ provider: stub() });
  e.logout = async () => { throw new Error('offline'); };
  const w = manager(e);
  await w.connect('email');
  w.disconnect();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.getState().connected, false);
});

test('email: disconnecting a browser wallet leaves Magic alone', async () => {
  const e = emailStub({ provider: stub() });
  const w = createWalletManager({ getProvider: () => stub(), offerAnnounced: false, storage: memory(), email: e });
  await w.connect();
  w.disconnect();
  await new Promise((r) => setImmediate(r));
  assert.equal(e.logouts, 0);
});
