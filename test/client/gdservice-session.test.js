import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSession, getToken } from '../../src/gd/session.js';
import { isBlessed } from '../../src/gd/blessing.js';
import { runs } from '../../src/gd/runs.js';
import { ADDR, ADDR2, H1, deferred, reply, serverStub, startService, stubLoaders, walletStub } from './helpers/service.js';

/*
 * Session and refresh behaviour of the GdService (findings H2, M1, M2 of the independent client review):
 * a dead session must be noticed and said out loud, overlapping refreshes must not overwrite each other,
 * and a failed refresh must not turn known-good data into "nothing".
 */

const verified = () => serverStub({ verified: true });
const connected = (t, over = {}) => startService(t, { wallet: walletStub(), server: verified(), connect: true, ...over });

/* ---- a dead session is noticed (H2) ---- */

test('a token the server stops accepting ends the session instead of silently blanking the panels', async (t) => {
  const { gd, server } = await connected(t);
  assert.equal(gd.getStatus().connected, true);
  assert.equal(gd.getStatus().spoils.length, 1);

  server.tokenOk = () => false; // expired or revoked on the server
  await gd.refreshAll();

  const s = gd.getStatus();
  assert.equal(s.connected, false);
  assert.equal(s.sessionExpired, true);
  assert.equal(getToken(), null);
  assert.deepEqual(s.spoils, []);
  assert.equal(isBlessed(), false);
});

test('the client session running out while the page stays open is noticed straight away, and by the next refresh with no request sent', async (t) => {
  const { gd, server } = await connected(t);
  clearSession(); // what loadSession() does once expiresAt has passed
  assert.equal(gd.getStatus().connected, false, 'status never claims a connection that has no token');

  const before = server.calls.length;
  await gd.refreshAll();
  assert.equal(server.calls.length, before, 'no request is sent without a token');
  assert.equal(gd.getStatus().sessionExpired, true);
  assert.equal(gd.getStatus().status, 'anonymous');
});

for (const [act, call] of [['claimUbi', (gd) => gd.claimUbi()], ['claimBounty', (gd) => gd.claimBounty()], ['redeem', (gd) => gd.redeem('7')]]) {
  test(`${act} on a dead session fails before anything is sent on-chain`, async (t) => {
    const { gd } = await connected(t);
    const sent = [];
    gd.loaders = stubLoaders({
      ubi: { claimUbi: async () => { sent.push('ubi'); return { hash: H1 }; } },
      engagement: { claimBounty: async () => { sent.push('bounty'); return { hash: H1 }; } },
      spoils: { redeemSpoil: async () => { sent.push('spoil'); return { hash: H1 }; } },
    });
    clearSession();
    const res = await call(gd);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_session');
    assert.match(res.message, /session expired/i);
    assert.deepEqual(sent, []);
  });
}

test('paid on-chain while the session was already dead: the player is told to reconnect, the hash waits in the queue, and reconnecting records it', async (t) => {
  const { gd, server } = await connected(t);
  server.handlers['/ubi/confirm'] = () => reply({ error: 'invalid_session' }, 401);

  const res = await gd.claimUbi();
  assert.equal(res.ok, true);
  assert.equal(res.hash, H1);
  assert.equal(res.reconnectNeeded, true);
  assert.equal(res.confirmPending, false, 'a retry cannot succeed until the player reconnects, so it must not be promised');
  assert.equal(gd.pending.list().length, 1);
  assert.equal(gd.pending.list()[0].address, ADDR.toLowerCase(), 'the entry is scoped to the account that was paid');
  assert.equal(gd.getStatus().connected, false);
  assert.equal(gd.getStatus().sessionExpired, true);

  delete server.handlers['/ubi/confirm'];
  assert.equal((await gd.connect()).ok, true);
  assert.equal(gd.pending.list().length, 0);
  assert.deepEqual(server.confirmed, [`/ubi/confirm:${H1}`]);
  assert.equal(gd.getStatus().blessing, true);
  assert.equal(gd.getStatus().sessionExpired, false);
});

test('disconnecting on purpose is not an expired session, and signing in again clears the notice', async (t) => {
  const { gd, server } = await connected(t);
  gd.disconnect();
  assert.equal(gd.getStatus().sessionExpired, false);

  server.tokenOk = () => false;
  await gd.connect().catch(() => {});
  server.tokenOk = () => true;
  assert.equal((await gd.connect()).ok, true);
  assert.equal(gd.getStatus().sessionExpired, false);
});

/* ---- a late answer for an old token must not undo a newer sign-in (M2) ---- */

test('a late 401 for the old token does not wipe the sign-in that happened in the meantime', async (t) => {
  const old = deferred();
  const server = serverStub({ verified: true, nextToken: 'NEW', tokenOk: (tok) => tok === 'NEW' });
  server.handlers['/me/refresh'] = ({ token }) => (token === 'OLD' ? old.promise : undefined);
  const { gd } = await startService(t, {
    wallet: walletStub(), server, session: { token: 'OLD', address: ADDR, host: 'browser' }, awaitReady: false,
  });

  assert.equal((await gd.connect()).ok, true); // init is still waiting for OLD's answer
  assert.equal(getToken(), 'NEW');

  old.resolve(reply({ error: 'invalid_session' }, 401));
  await gd.ready;

  assert.equal(getToken(), 'NEW');
  assert.equal(gd.getStatus().connected, true);
  assert.equal(gd.getStatus().sessionExpired, false);
});

test('a late identity answer for the old token does not overwrite the account that signed in since', async (t) => {
  const old = deferred();
  const server = serverStub({ verified: true, nextToken: 'NEW', tokenOk: (tok) => tok === 'NEW' });
  server.handlers['/me/refresh'] = ({ token }) => (token === 'OLD' ? old.promise : undefined);
  const { gd } = await startService(t, {
    wallet: walletStub(), server, session: { token: 'OLD', address: ADDR2, host: 'browser' }, awaitReady: false,
  });

  assert.equal((await gd.connect()).ok, true);
  old.resolve(reply({ address: ADDR2.toLowerCase(), verified: false, status: 'unverified' }));
  await gd.ready;

  const s = gd.getStatus();
  assert.equal(s.address, ADDR.toLowerCase());
  assert.equal(s.verified, true);
  assert.equal(s.needsReconnect, false);
});

test('an identity request of the old session that fails after a new sign-in does not leave the new session offline', async (t) => {
  const old = deferred();
  const server = serverStub({ verified: true, nextToken: 'NEW', tokenOk: (tok) => tok === 'NEW' });
  server.handlers['/me/refresh'] = ({ token }) => (token === 'OLD' ? old.promise : undefined);
  const { gd } = await startService(t, {
    wallet: walletStub(), server, session: { token: 'OLD', address: ADDR, host: 'browser' }, awaitReady: false,
  });

  assert.equal((await gd.connect()).ok, true);
  old.reject(new TypeError('Failed to fetch')); // the network failed for a request that belonged to the old session
  await gd.ready;

  assert.equal(gd.getStatus().offline, false, 'nothing is wrong with the session in use');
  assert.equal(gd.getStatus().connected, true);
});

/* ---- refreshes: newest wins, failures keep the last good data (M1) ---- */

test('an older refresh that resolves late cannot overwrite what a newer one already showed', async (t) => {
  const { gd, server } = await connected(t);
  server.blessed = true;
  const slow = deferred();
  let calls = 0;
  server.handlers['/rewards/status'] = () => (++calls === 1 ? slow.promise : undefined);

  const first = gd.refreshAll(); // started before the claim: its rewards answer is slow and out of date
  const second = gd.refreshAll(); // started after: sees the blessing
  await second;
  assert.equal(gd.getStatus().blessing, true);

  slow.resolve(reply({ blessing: false, crystalStatus: { gdEarned: 0, dailyCapGd: 100, isCapped: false } }));
  await first;
  assert.equal(gd.getStatus().blessing, true);
  assert.equal(isBlessed(), true);
});

test('a refresh that fails keeps the last good data, marks it stale, and recovers on the next good one', async (t) => {
  const { gd, server } = await connected(t);
  server.blessed = true;
  await gd.refreshAll();
  const good = gd.getStatus();
  assert.equal(good.blessing, true);
  assert.equal(good.spoils.length, 1);
  assert.equal(good.bounty.pendingRunId, 'run-1');
  assert.deepEqual(good.stale, { rewards: false, bounty: false, spoils: false, ubi: false, shop: false, balance: false, config: false });

  for (const path of ['/rewards/status', '/spoils', '/engagement/status']) server.handlers[path] = () => reply({ error: 'boom' }, 500);
  await gd.refreshAll();
  const s = gd.getStatus();
  assert.equal(s.blessing, true, 'a server hiccup must not take today\'s blessing away');
  assert.equal(s.spoils.length, 1, 'unredeemed Spoils must not vanish');
  assert.equal(s.bounty.pendingRunId, 'run-1', 'the bounty button must not disappear inside its 24 h window');
  assert.deepEqual(s.stale, { rewards: true, bounty: true, spoils: true, ubi: false, shop: false, balance: false, config: false });

  server.handlers = {};
  await gd.refreshAll();
  assert.deepEqual(gd.getStatus().stale, { rewards: false, bounty: false, spoils: false, ubi: false, shop: false, balance: false, config: false });
});

test('a refresh still in flight when the player disconnects does not bring the data back', async (t) => {
  const { gd, server } = await connected(t);
  const slow = deferred();
  const issued = deferred();
  server.handlers['/rewards/status'] = () => { issued.resolve(); return slow.promise; };

  const inflight = gd.refreshAll();
  await issued.promise; // the request is really on the wire when the player disconnects
  gd.disconnect();
  slow.resolve(reply({ blessing: true, crystalStatus: { gdEarned: 3, dailyCapGd: 100, isCapped: false } }));
  await inflight;

  const s = gd.getStatus();
  assert.equal(s.rewards, null);
  assert.equal(s.blessing, false);
  assert.equal(isBlessed(), false);
  assert.deepEqual(s.spoils, []);
});

/* ---- offline ---- */

test('the API going away after start-up flags offline and keeps what was shown; it clears when the API is back', async (t) => {
  const { gd, server } = await connected(t);
  assert.equal(gd.getStatus().offline, false);

  server.down = true;
  await gd.refreshAll();
  const s = gd.getStatus();
  assert.equal(s.offline, true);
  assert.equal(s.connected, true);
  assert.equal(s.spoils.length, 1);

  server.down = false;
  await gd.refreshAll();
  assert.equal(gd.getStatus().offline, false);
});

test('a verified player whose API is down at load sees an unknown status, not a prompt to verify', async (t) => {
  const server = serverStub({ verified: true, down: true });
  const { gd } = await startService(t, {
    wallet: walletStub(), server, session: { token: 'jwt', address: ADDR, host: 'browser' },
  });
  let s = gd.getStatus();
  assert.deepEqual({ connected: s.connected, offline: s.offline, status: s.status, verified: s.verified }, { connected: true, offline: true, status: 'unknown', verified: false });

  server.down = false;
  await gd.refreshAll();
  s = gd.getStatus();
  assert.deepEqual({ offline: s.offline, status: s.status, verified: s.verified }, { offline: false, status: 'verified', verified: true });
});

/* ---- a 401 seen while recording a run (finding M6) ---- */

test('a 401 the run tracker saw ends the session, like any other dead-session answer', async (t) => {
  const { gd } = await connected(t);
  runs.authLostHandler({ status: 401, code: 'invalid_session', where: 'submit', token: getToken() });
  const s = gd.getStatus();
  assert.equal(s.connected, false);
  assert.equal(s.sessionExpired, true);
  assert.equal(getToken(), null);
});

test('...but a 401 for an older session does not end the one the player signed in with since', async (t) => {
  const { gd } = await connected(t);
  runs.authLostHandler({ status: 401, code: 'invalid_session', where: 'checkpoint', token: 'OLD-TOKEN' });
  assert.equal(gd.getStatus().connected, true);
  assert.equal(gd.getStatus().sessionExpired, false);
});

/* ---- verification can lapse while the page stays open: the gate must notice ---- */

test('a verification that lapsed on the server since sign-in is noticed by the next refresh', async (t) => {
  const { gd, server } = await connected(t);
  assert.equal(gd.getStatus().verified, true);
  server.verified = false; // the human check expired
  await gd.refreshAll();
  const s = gd.getStatus();
  assert.equal(s.verified, false);
  assert.equal(s.status, 'unverified');
  assert.deepEqual(s.spoils, [], 'nothing that needs a verified human is still offered');
  assert.equal(s.bounty, null);
});
