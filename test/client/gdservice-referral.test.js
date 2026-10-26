import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReferral, forgetRefCode, stashedRefCode } from '../../src/gd/referral.js';
import { ADDR, reply, serverStub, startService, until, walletStub } from './helpers/service.js';

/*
 * A friend who arrived through an invite link tells the server who sent them when they sign in. It happens in the
 * background: whatever the server says (or does not), the sign-in itself is unaffected.
 */

const CODE = 'K7M2QX9A';
const arrive = () => captureReferral({ win: { location: { href: `https://playmoonshard.xyz/?ref=${CODE}` }, history: { replaceState() {} } } });
const claims = (server) => server.calls.filter((c) => c === 'POST /referrals/claim').length;

test.beforeEach(() => forgetRefCode());
test.afterEach(() => forgetRefCode());

const connected = (t, server) => startService(t, { wallet: walletStub(), server, connect: true });

test('signing in with a code waiting sends it once, with the new session, and spends it', async (t) => {
  const server = serverStub({ verified: true });
  const seen = [];
  server.handlers['/referrals/claim'] = (ctx) => { seen.push(ctx); return reply({ ok: true }); };
  arrive();
  await connected(t, server);
  await until(() => seen.length === 1, { label: 'the claim' });
  assert.deepEqual(seen[0].body, { code: CODE });
  assert.equal(seen[0].token, 'jwt', 'the session the sign-in just made');
  await until(() => stashedRefCode() === null, { label: 'the code to be spent' });
  assert.equal(claims(server), 1);
});

test('no code waiting: nothing is asked of the server', async (t) => {
  const server = serverStub({ verified: true });
  await connected(t, server);
  assert.equal(claims(server), 0);
});

test('a refusal the server will always repeat is not retried: the code is forgotten and the sign-in is fine', async (t) => {
  const server = serverStub({ verified: true });
  server.handlers['/referrals/claim'] = () => reply({ error: 'not_new' }, 409);
  arrive();
  const { gd } = await connected(t, server);
  await until(() => stashedRefCode() === null, { label: 'the code to be forgotten' });
  assert.equal(gd.getStatus().connected, true);
});

test('a server that fails keeps the code for the next sign-in, and the sign-in is fine', async (t) => {
  const server = serverStub({ verified: true });
  server.handlers['/referrals/claim'] = () => reply({ error: 'internal_error' }, 500);
  arrive();
  const { gd } = await connected(t, server);
  await until(() => claims(server) === 1, { label: 'the claim' });
  assert.equal(gd.getStatus().connected, true);
  assert.equal(stashedRefCode(), CODE);
});

test('an older server that has no referrals yet (a plain 404) keeps the code too', async (t) => {
  const server = serverStub({ verified: true }); // the stub answers an unknown path with 404 not_found
  arrive();
  const { gd } = await connected(t, server);
  await until(() => claims(server) === 1, { label: 'the claim' });
  assert.equal(gd.getStatus().connected, true);
  assert.equal(stashedRefCode(), CODE, 'a 404 from a server that has never heard of the route says nothing about the code');
});

test('a claim that hangs does not hold up the sign-in', async (t) => {
  const server = serverStub({ verified: true });
  server.handlers['/referrals/claim'] = () => new Promise(() => {}); // never answers
  arrive();
  const { gd } = await connected(t, server); // resolves: connect() does not wait for the claim
  assert.equal(gd.getStatus().connected, true);
  assert.equal(gd.getStatus().status, 'verified');
});

test('a session restored when the page opens claims the code too', async (t) => {
  const server = serverStub({ verified: true });
  const seen = [];
  server.handlers['/referrals/claim'] = (ctx) => { seen.push(ctx); return reply({ ok: true }); };
  arrive();
  await startService(t, { wallet: walletStub(), server, session: { token: 'restored', address: ADDR, host: 'browser' } });
  await until(() => seen.length === 1, { label: 'the claim' });
  assert.equal(seen[0].token, 'restored');
  assert.deepEqual(seen[0].body, { code: CODE });
});
