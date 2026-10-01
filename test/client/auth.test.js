import test from 'node:test';
import assert from 'node:assert/strict';
import { loginMessage, signIn } from '../../src/gd/auth.js';
import { clearSession, getToken, getAddress } from '../../src/gd/session.js';

test('login message is exactly what the server parses', () => {
  assert.equal(
    loginMessage('ab'.repeat(32), '2026-10-05T12:00:00.000Z'),
    `Moonshard login\nNonce: ${'ab'.repeat(32)}\nIssued: 2026-10-05T12:00:00.000Z`,
  );
});

test('signIn fetches a nonce, signs the message, verifies and stores the session', async () => {
  clearSession();
  const calls = [];
  const api = async (path, opts = {}) => {
    calls.push([path, opts.body]);
    if (path === '/auth/nonce') return { nonce: 'cd'.repeat(32), issuedAt: '2026-10-05T12:00:00.000Z' };
    return { token: 'jwt', address: '0xabc', verified: true, status: 'verified' };
  };
  const wallet = {
    getState: () => ({ address: '0xabc' }),
    signMessage: async (m) => `sig(${m.length})`,
  };
  const res = await signIn({ wallet, host: 'goodwallet', api });
  assert.equal(res.verified, true);
  assert.equal(calls[1][1].host, 'goodwallet');
  assert.equal(calls[1][1].address, '0xabc');
  assert.equal(calls[1][1].message, loginMessage('cd'.repeat(32), '2026-10-05T12:00:00.000Z'));
  assert.equal(getToken(), 'jwt');
  assert.equal(getAddress(), '0xabc');
  clearSession();
  assert.equal(getToken(), null);
});

test('a rejected signature surfaces and stores nothing', async () => {
  clearSession();
  const api = async () => ({ nonce: 'ef'.repeat(32), issuedAt: 'x' });
  const wallet = { getState: () => ({ address: '0xabc' }), signMessage: async () => { throw new Error('rejected'); } };
  await assert.rejects(signIn({ wallet, host: 'browser', api }), /rejected/);
  assert.equal(getToken(), null);
});
