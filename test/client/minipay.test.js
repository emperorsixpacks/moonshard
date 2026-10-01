import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGwei } from 'viem';
import { canSignMessages, detectHost } from '../../src/gd/host.js';
import { clearSession, getToken, loadSession, saveSession } from '../../src/gd/session.js';
import { signIn } from '../../src/gd/auth.js';
import { createWalletManager, legacyProvider } from '../../src/gd/wallet.js';
import { setBlessed } from '../../src/gd/blessing.js';
import { explainError } from '../../src/gd/format.js';

/*
 * MiniPay (Opera's Celo wallet) cannot sign messages and its review rules forbid asking users to sign in order to
 * log in; it also requires legacy (non-EIP-1559) transactions and auto-connects without a "connect" button.
 * Sources: docs.minipay.xyz best-practices ("Do not prompt users to sign a message to access your site or to
 * authenticate.") and Celo's MiniPay integration guide (message signing: not supported; legacy tx only).
 */

const ADDR = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

test('MiniPay is the only host that cannot sign', () => {
  assert.equal(canSignMessages('minipay'), false);
  assert.equal(canSignMessages('browser'), true);
  assert.equal(canSignMessages('goodwallet'), true);
  assert.equal(detectHost({ ethereum: { isMiniPay: true } }), 'minipay');
});

test('signing-free sign-in: never asks the wallet to sign, uses /auth/unsigned, remembers it is unsigned', async () => {
  clearSession();
  const calls = [];
  const api = async (path, opts = {}) => {
    calls.push([path, opts.body]);
    return { token: 'jwt-unsigned', address: ADDR.toLowerCase(), verified: true, status: 'verified', unsigned: true };
  };
  const wallet = {
    getState: () => ({ address: ADDR.toLowerCase() }),
    signMessage: async () => { throw new Error('the wallet must not be asked to sign in MiniPay'); },
  };
  const res = await signIn({ wallet, host: 'minipay', api });
  assert.equal(res.unsigned, true);
  assert.deepEqual(calls, [['/auth/unsigned', { address: ADDR.toLowerCase(), host: 'minipay' }]]);
  assert.equal(getToken(), 'jwt-unsigned');
  assert.equal(loadSession().unsigned, true);
  clearSession();
});

test('other hosts still sign in with a signature (and are not marked unsigned)', async () => {
  clearSession();
  let signed = 0;
  const api = async (path) => (path === '/auth/nonce'
    ? { nonce: 'ab'.repeat(32), issuedAt: '2026-10-05T12:00:00.000Z' }
    : { token: 'jwt', address: ADDR.toLowerCase(), verified: false, status: 'unverified' });
  const wallet = { getState: () => ({ address: ADDR.toLowerCase() }), signMessage: async () => { signed++; return '0xsig'; } };
  await signIn({ wallet, host: 'browser', api });
  assert.equal(signed, 1);
  assert.equal(loadSession().unsigned, false);
  clearSession();
});

test('the server may refuse signing-free sessions; the error surfaces and nothing is stored', async () => {
  clearSession();
  const api = async () => { throw Object.assign(new Error('unsigned_disabled'), { status: 403 }); };
  const wallet = { getState: () => ({ address: ADDR.toLowerCase() }), signMessage: async () => '0x' };
  await assert.rejects(signIn({ wallet, host: 'minipay', api }), /unsigned_disabled/);
  assert.equal(getToken(), null);
});

test('session round-trips the unsigned flag; sessions saved without it read as signed', () => {
  clearSession();
  saveSession({ token: 't', address: ADDR, host: 'minipay', unsigned: true });
  assert.equal(loadSession().unsigned, true);
  saveSession({ token: 't', address: ADDR, host: 'browser' });
  assert.equal(loadSession().unsigned, false);
  clearSession();
});

test('legacyProvider strips EIP-1559 fee fields (MiniPay only accepts legacy transactions) and keeps everything else', async () => {
  const seen = [];
  const provider = { request: async (args) => { seen.push(args); return '0xhash'; }, on() {} };
  const legacy = legacyProvider(provider);
  await legacy.request({
    method: 'eth_sendTransaction',
    params: [{ from: ADDR, to: ADDR, data: '0x1234', gas: '0x5208', gasPrice: '0x3b9aca00', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', type: '0x2' }],
  });
  assert.deepEqual(seen[0].params[0], { from: ADDR, to: ADDR, data: '0x1234', gas: '0x5208', gasPrice: '0x3b9aca00' });
  await legacy.request({ method: 'eth_chainId' });
  assert.deepEqual(seen[1], { method: 'eth_chainId' });
});

test('with legacyTx on, a viem wallet client sends no 1559 fields; with it off, they pass through', async () => {
  const sent = [];
  const stub = {
    async request({ method, params }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
      if (method === 'eth_chainId') return '0xa4ec';
      if (method === 'eth_sendTransaction') { sent.push(params[0]); return `0x${'ab'.repeat(32)}`; }
      throw new Error(`unexpected ${method}`);
    },
    on() {},
  };
  for (const legacyTx of [true, false]) {
    sent.length = 0;
    const w = createWalletManager({ getProvider: () => stub, legacyTx });
    await w.connect();
    const { walletClient } = w.clients();
    await walletClient.sendTransaction({ to: ADDR.toLowerCase(), data: '0x', maxFeePerGas: parseGwei('5'), maxPriorityFeePerGas: parseGwei('1') });
    assert.equal('maxFeePerGas' in sent[0], !legacyTx, `legacyTx=${legacyTx}`);
    assert.equal('maxPriorityFeePerGas' in sent[0], !legacyTx, `legacyTx=${legacyTx}`);
  }
});

test('the bounty message for non-signing wallets is human', () => {
  assert.match(explainError('signature_required'), /MiniPay|sign/i);
});

test.after(() => setBlessed(false));
