import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { useTestWallet, walletShim } from '../../scripts/local-dev/plugin.mjs';

/*
 * The local test launcher gives the page a test wallet. A wallet extension in the person's browser (MetaMask, Rabby, ...)
 * owns window.ethereum and cannot be dislodged, so the launcher must not depend on it: the game is handed the test wallet
 * directly, and if that ever stopped being possible it must fail loudly rather than ask a real wallet to sign.
 */

// the shim runs in its own VM realm, whose arrays are not this realm's: compare plain copies
const plain = (value) => JSON.parse(JSON.stringify(value));

const HELPER = 'http://127.0.0.1:5999';
const ADDRESS = '0xa9a7a0c07Fc9B699745905Eb25068F2F24961eF6';

/** Run the shim in a fake browser. `locked` makes window.ethereum a wallet extension's non-configurable property. */
function runShim({ locked = false, stored = {}, sessionId = 'session-2', answer = { result: '0xsigned' } } = {}) {
  const calls = [];
  const local = new Map(Object.entries(stored));
  const session = new Map([['moonshard.gate.v1', 'remembered']]);
  const storage = (map) => ({ getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) });
  const window = {};
  const listeners = {};
  const extension = { isRabby: true, request: async () => { throw new Error('the extension must not be used'); } };
  if (locked) Object.defineProperty(window, 'ethereum', { value: extension, configurable: false, writable: false });
  const sandbox = {
    window,
    document: { addEventListener: (type, fn) => { listeners[type] = fn; }, createElement: () => ({ style: {} }), body: { appendChild: (el) => { sandbox.appended = el; } } },
    localStorage: storage(local),
    sessionStorage: storage(session),
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { json: async () => answer }; },
  };
  vm.runInNewContext(walletShim({ helper: HELPER, address: ADDRESS, sessionId }), sandbox);
  return { window, local, session, calls, extension, listeners, sandbox };
}

test('the shim is valid JavaScript for a page', () => {
  assert.doesNotThrow(() => new vm.Script(walletShim({ helper: HELPER, address: ADDRESS, sessionId: 's' })));
});

test('the test wallet answers for the test player, on Celo, and sends everything else to the launcher', async () => {
  const { window, calls } = runShim();
  const wallet = window.__MS_LOCAL_DEV.provider;
  assert.deepEqual(plain(await wallet.request({ method: 'eth_accounts' })), [ADDRESS]);
  assert.deepEqual(plain(await wallet.request({ method: 'eth_requestAccounts' })), [ADDRESS]);
  assert.equal(await wallet.request({ method: 'eth_chainId' }), '0xa4ec');
  assert.equal(await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4ec' }] }), null);
  assert.equal(calls.length, 0, 'none of those needed the launcher');

  assert.equal(await wallet.request({ method: 'personal_sign', params: ['0x00', ADDRESS] }), '0xsigned');
  assert.deepEqual(plain(calls), [{ url: `${HELPER}/wallet`, body: { method: 'personal_sign', params: ['0x00', ADDRESS] } }]);
});

test('an error from the launcher reaches the game as an error with its code', async () => {
  const { window } = runShim({ answer: { error: { code: -32000, message: 'insufficient funds' } } });
  await assert.rejects(window.__MS_LOCAL_DEV.provider.request({ method: 'eth_sendTransaction', params: [{}] }), (err) => err.code === -32000 && /insufficient funds/.test(err.message));
});

test('with no wallet extension the page also gets the test wallet as window.ethereum', () => {
  const { window } = runShim();
  assert.equal(window.ethereum, window.__MS_LOCAL_DEV.provider);
  assert.equal(window.ethereum.isMoonshardLocalDev, true);
});

test('a wallet extension that owns window.ethereum is left alone, and the test wallet is still there for the game to use', async () => {
  const { window, extension } = runShim({ locked: true });
  assert.equal(window.ethereum, extension, 'the extension keeps its property: the shim does not fight it');
  assert.equal(window.__MS_LOCAL_DEV.provider.isMoonshardLocalDev, true);
  assert.deepEqual(plain(await window.__MS_LOCAL_DEV.provider.request({ method: 'eth_accounts' })), [ADDRESS]);
});

test('a new launch clears the last launch\'s login and queued confirmations, and keeps everything else', () => {
  const stored = {
    'moonshard.session.v1': '{"token":"old"}',
    'moonshard.pending.v1': '[{"hash":"0x1"}]',
    'moonshard.render.cap.v1': '2',
    'moonshard.localdev.session': 'session-1',
  };
  const { local, session } = runShim({ stored, sessionId: 'session-2' });
  assert.equal(local.has('moonshard.session.v1'), false);
  assert.equal(local.has('moonshard.pending.v1'), false);
  assert.equal(session.has('moonshard.gate.v1'), false);
  assert.equal(local.get('moonshard.render.cap.v1'), '2', 'the display setting is the person\'s, not the chain\'s');
  assert.equal(local.get('moonshard.localdev.session'), 'session-2');
});

test('reloading inside the same launch keeps the login', () => {
  const stored = { 'moonshard.session.v1': '{"token":"mine"}', 'moonshard.localdev.session': 'session-2' };
  const { local, session } = runShim({ stored, sessionId: 'session-2' });
  assert.equal(local.get('moonshard.session.v1'), '{"token":"mine"}');
  assert.equal(session.get('moonshard.gate.v1'), 'remembered');
});

test('the page says it is a local test', () => {
  const { listeners, sandbox } = runShim();
  listeners.DOMContentLoaded();
  assert.match(sandbox.appended.textContent, /LOCAL TEST/);
  assert.equal(sandbox.appended.href, `${HELPER}/dev`);
});

// ---- handing the game the test wallet ------------------------------------------------------------------------------

test('the real wallet module is rewritten to read the test wallet first', () => {
  const real = readFileSync(new URL('../../src/gd/wallet.js', import.meta.url), 'utf8');
  const changed = useTestWallet(real);
  assert.match(changed, /getProvider: getInjected = \(\) => \(globalThis\.window\?\.__MS_LOCAL_DEV\?\.provider \?\? globalThis\.window\?\.ethereum\),/);
  assert.equal(changed.split('globalThis.window?.ethereum').length - 1, 1, 'the extension is only the fallback');
  assert.match(changed, /const OFFER_ANNOUNCED_WALLETS = false;/, 'wallets that announce themselves (EIP-6963) are not offered');
  assert.doesNotMatch(changed, /const OFFER_ANNOUNCED_WALLETS = true;/);
  const grew = '(globalThis.window?.__MS_LOCAL_DEV?.provider ?? globalThis.window?.ethereum)'.length - 'globalThis.window?.ethereum'.length + 'false'.length - 'true'.length;
  assert.equal(changed.length - real.length, grew, 'nothing else changed');
});

test('if the wallet module stops offering announced wallets the expected way, the launcher refuses to run', () => {
  assert.throws(() => useTestWallet('getProvider = () => globalThis.window?.ethereum;'), /OFFER_ANNOUNCED_WALLETS/);
  assert.throws(() => useTestWallet('const OFFER_ANNOUNCED_WALLETS = true; const OFFER_ANNOUNCED_WALLETS = true; x = globalThis.window?.ethereum;'), /OFFER_ANNOUNCED_WALLETS/);
});

test('if the wallet module stops reading the wallet the expected way, the launcher refuses to run rather than let a real wallet sign', () => {
  assert.throws(() => useTestWallet('const provider = window.ethereum;'), /exactly one place/);
  assert.throws(() => useTestWallet('a = globalThis.window?.ethereum; b = globalThis.window?.ethereum;'), /exactly one place/);
});
