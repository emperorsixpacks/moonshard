import test from 'node:test';
import assert from 'node:assert/strict';
import { GD } from '../../src/gd/config.js';
import { ADDR, ADDR2, H1, H2, H3, deferred, reply, serverStub, startService, stubLoaders, until, walletStub } from './helpers/service.js';

/*
 * Paid actions and wallet events in the GdService (findings M9, H3, L1 and the L8 items of the independent client
 * review): the wallet's account can change under a signed-in session, a sent transaction must never be reported as
 * a failure, and a hung wallet prompt must not freeze the panel.
 */

const connected = (t, over = {}) => startService(t, { wallet: walletStub(), server: serverStub({ verified: true }), connect: true, ...over });
const A = ADDR.toLowerCase();
const B = ADDR2.toLowerCase();

/* ---- the wallet's account changes under a signed-in session (M9) ---- */

test('switching the wallet to another account marks the session for reconnect and hides that account\'s UBI', async (t) => {
  const wallet = walletStub();
  const { gd } = await connected(t, { wallet });
  assert.equal(gd.getStatus().ubi?.canClaim, true);

  wallet.emit('accountsChanged', [ADDR2]);
  const s = gd.getStatus();
  assert.equal(s.connected, true, 'the server session still belongs to the first account');
  assert.equal(s.needsReconnect, true);
  assert.equal(s.ubi, null);
  assert.equal((await gd.claimUbi()).error, 'wallet_mismatch');
});

test('a locked or disconnected wallet (no accounts) needs a reconnect too', async (t) => {
  const wallet = walletStub();
  const { gd } = await connected(t, { wallet });
  wallet.emit('accountsChanged', []);
  const s = gd.getStatus();
  assert.equal(s.needsReconnect, true);
  assert.equal(s.ubi, null);
});

test('while the wallet shows another account nothing is read for it; switching back clears the notice and reloads', async (t) => {
  const wallet = walletStub();
  const { gd } = await connected(t, { wallet });
  const read = [];
  gd.loaders = stubLoaders({ ubi: { prepareUbi: async (w) => { read.push(w.getState().address); return { account: w.getState().address }; } } });

  wallet.emit('accountsChanged', [ADDR2]);
  await gd.refreshAll(); // e.g. the panel is opened while the wallet shows the other account
  assert.deepEqual(read, [], 'the other account\'s entitlement is never read');
  assert.equal(gd.getStatus().ubi, null);

  wallet.emit('accountsChanged', [ADDR]);
  await gd.lastRefresh;
  const s = gd.getStatus();
  assert.equal(s.needsReconnect, false);
  assert.equal(s.ubi?.canClaim, true);
  assert.deepEqual(read, [A]);
});

test('the UBI claim always uses an SDK built for the signed-in account, even after the wallet visited another one', async (t) => {
  const wallet = walletStub();
  const { gd } = await connected(t, { wallet });
  const built = [];
  const claim = [];
  gd.loaders = stubLoaders({
    ubi: {
      prepareUbi: async (w) => { built.push(w.getState().address); return { account: w.getState().address }; },
      claimUbi: async ({ claimSDK }) => { claim.push({ account: claimSDK.account, builtSoFar: built.length }); return { hash: H1 }; },
    },
  });

  wallet.emit('accountsChanged', [ADDR2]);
  await gd.refreshAll();
  wallet.emit('accountsChanged', [ADDR]);
  await gd.lastRefresh;
  built.length = 0;

  const res = await gd.claimUbi();
  assert.equal(res.ok, true);
  assert.deepEqual(claim, [{ account: A, builtSoFar: 1 }], 'a fresh SDK, for the signed-in account, was built for this very claim');
});

test('an account switch while a UBI read is in flight cannot publish the other account\'s entitlement', async (t) => {
  const wallet = walletStub();
  const { gd } = await connected(t, { wallet });
  const slow = deferred();
  const started = deferred();
  gd.loaders = stubLoaders({
    ubi: {
      prepareUbi: async () => { started.resolve(); await slow.promise; return { account: A }; },
      ubiStatus: async () => ({ entitlementG: '999', canClaim: true, nextClaimAt: null }),
    },
  });

  const refresh = gd.refreshAll();
  await started.promise;
  wallet.emit('accountsChanged', [ADDR2]);
  slow.resolve();
  await refresh;
  assert.equal(gd.getStatus().ubi, null);
  assert.equal(gd.getStatus().needsReconnect, true);
});

/* ---- a sent transaction is never reported as a failure (H3) ---- */

test('the hash is queued the moment the wallet sends the transaction, before anything waits for the receipt', async (t) => {
  const { gd } = await connected(t);
  const mined = deferred();
  gd.loaders = stubLoaders({ ubi: { claimUbi: async ({ onHash }) => { onHash(H1); return mined.promise; } } });

  const claim = gd.claimUbi();
  await until(() => gd.pending.list().length === 1, { label: 'the hash to be persisted' });
  assert.equal(gd.pending.list()[0].txHash, H1);

  mined.resolve({ hash: H1 });
  assert.equal((await claim).ok, true);
  assert.equal(gd.pending.list().length, 0, 'confirmed, so the entry is gone');
});

test('a claim whose receipt wait failed is "submitted": confirmed later, and not repeatable meanwhile', async (t) => {
  const { gd, server } = await connected(t);
  let sent = 0;
  gd.loaders = stubLoaders({ ubi: { claimUbi: async ({ onHash }) => { sent++; onHash(H1); return { hash: H1, unconfirmed: true }; } } });
  server.handlers['/ubi/confirm'] = () => reply({ error: 'tx_not_found' }, 404); // the server cannot see it yet

  const res = await gd.claimUbi();
  assert.deepEqual(
    { ok: res.ok, submitted: res.submitted, hash: res.hash, confirmPending: res.confirmPending },
    { ok: true, submitted: true, hash: H1, confirmPending: true },
  );
  assert.equal(gd.getStatus().awaiting.ubi, H1);
  assert.equal(gd.getStatus().pendingCount, 1);

  const again = await gd.claimUbi();
  assert.equal(again.ok, false);
  assert.equal(again.error, 'already_submitted');
  assert.match(again.message, /still confirming/i);
  assert.equal(sent, 1, 'no second transaction was sent');

  delete server.handlers['/ubi/confirm']; // the network caught up and the server can see the transaction
  await gd.refreshAll();
  assert.deepEqual(server.confirmed, [`/ubi/confirm:${H1}`]);
  assert.equal(gd.getStatus().awaiting.ubi, null);
  assert.equal(gd.getStatus().blessing, true);
});

test('the bounty and Spoils redemptions get the same treatment', async (t) => {
  const { gd, server } = await connected(t);
  gd.loaders = stubLoaders({
    engagement: { claimBounty: async ({ onHash }) => { onHash(H2); return { hash: H2, unconfirmed: true }; } },
    spoils: { redeemSpoil: async ({ onHash }) => { onHash(H3); return { hash: H3, unconfirmed: true }; } },
  });
  for (const path of ['/engagement/confirm', '/spoils/confirm']) server.handlers[path] = () => reply({ error: 'tx_not_found' }, 404);

  const bounty = await gd.claimBounty();
  assert.deepEqual({ ok: bounty.ok, submitted: bounty.submitted, hash: bounty.hash }, { ok: true, submitted: true, hash: H2 });
  const redeem = await gd.redeem('7');
  assert.deepEqual({ ok: redeem.ok, submitted: redeem.submitted, hash: redeem.hash }, { ok: true, submitted: true, hash: H3 });

  const s = gd.getStatus();
  assert.equal(s.awaiting.bounty, H2);
  assert.equal(s.awaiting.spoils['7'], H3);
  assert.equal((await gd.claimBounty()).error, 'already_submitted');
  assert.equal((await gd.redeem('7')).error, 'already_submitted');
});

test('a claim that was sent and mined is not "submitted" and leaves nothing waiting', async (t) => {
  const { gd } = await connected(t);
  const res = await gd.claimUbi();
  assert.equal(res.submitted, false);
  assert.equal(gd.getStatus().awaiting.ubi, null);
});

/* ---- what happened to the server confirmation (L1) ---- */

test('every outcome of the confirmation is reported separately', async (t) => {
  const { gd, server } = await connected(t);
  const outcome = (r) => ({ confirmed: r.confirmed, confirmPending: r.confirmPending, confirmRejected: r.confirmRejected, reconnectNeeded: r.reconnectNeeded });

  assert.deepEqual(outcome(await gd.claimUbi()), { confirmed: true, confirmPending: false, confirmRejected: null, reconnectNeeded: false });

  server.confirmStatus = 503;
  assert.deepEqual(outcome(await gd.claimBounty()), { confirmed: false, confirmPending: true, confirmRejected: null, reconnectNeeded: false });

  server.confirmStatus = 422;
  assert.deepEqual(outcome(await gd.redeem('7')), { confirmed: false, confirmPending: false, confirmRejected: 'tx_not_today', reconnectNeeded: false });
});

test('a payment the server has not recorded yet cannot be repeated, even if it was mined', async (t) => {
  const { gd, server } = await connected(t);
  let sent = 0;
  gd.loaders = stubLoaders({ ubi: { claimUbi: async () => { sent++; return { hash: H1 }; } } });
  server.confirmStatus = 503; // paid on-chain, but the server could not record it

  assert.equal((await gd.claimUbi()).confirmPending, true);
  const again = await gd.claimUbi();
  assert.deepEqual({ ok: again.ok, error: again.error }, { ok: false, error: 'already_submitted' });
  assert.equal(sent, 1);
});

/* ---- verification is re-checked before a claim can send the player off to the face scan ---- */

test('a UBI claim re-checks verification first: a lapsed verification never sends the player off mid-claim', async (t) => {
  const { gd, server } = await connected(t);
  let sent = 0;
  gd.loaders = stubLoaders({ ubi: { claimUbi: async () => { sent++; return { hash: H1 }; } } });
  server.verified = false; // verification lapsed since the server last looked

  const res = await gd.claimUbi();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'verification_required');
  assert.equal(sent, 0);
  assert.ok(server.calls.includes('POST /me/refresh'));
  assert.equal(gd.getStatus().verified, false);
});

test('a rate-limited re-check uses the cached answer, and an unreachable server does not block a claim the chain will vouch for', async (t) => {
  const { gd, server } = await connected(t);

  server.handlers['/me/refresh'] = () => reply({ error: 'slow_down' }, 429);
  assert.equal((await gd.claimUbi()).ok, true);

  server.handlers['/me/refresh'] = () => { throw new TypeError('Failed to fetch'); };
  assert.equal((await gd.claimUbi()).ok, true);
});

/* ---- a wallet prompt that never answers ---- */

test('a wallet prompt that never answers frees the panel, and a second attempt is refused while the first is open', async (t) => {
  const { gd } = await connected(t);
  gd.timeouts = { wallet: 25, tx: 25 };
  gd.loaders = stubLoaders({ ubi: { claimUbi: () => new Promise(() => {}) } });

  const res = await gd.claimUbi();
  assert.deepEqual({ ok: res.ok, error: res.error }, { ok: false, error: 'wallet_timeout' });
  assert.equal(gd.getStatus().busy, null);

  const again = await gd.claimUbi();
  assert.deepEqual({ ok: again.ok, error: again.error }, { ok: false, error: 'wallet_busy' });
  assert.match(again.message, /wallet/i);
});

test('an answer that arrives after the timeout is still recorded', async (t) => {
  const { gd, server } = await connected(t);
  gd.timeouts = { wallet: 25, tx: 25 };
  const late = deferred();
  gd.loaders = stubLoaders({ ubi: { claimUbi: () => late.promise } });

  assert.equal((await gd.claimUbi()).error, 'wallet_timeout');
  late.resolve({ hash: H1 });
  await until(() => server.confirmed.length === 1, { label: 'the late confirmation' });
  assert.deepEqual(server.confirmed, [`/ubi/confirm:${H1}`]);
});

/* ---- "check again" says what happened ---- */

test('"check again" tells the player when it could not check, and what it found when it could', async (t) => {
  const { gd, server } = await startService(t, { wallet: walletStub(), server: serverStub({ verified: false }), connect: true });

  server.handlers['/me/refresh'] = () => reply({ error: 'slow_down' }, 429);
  let r = await gd.recheck();
  assert.deepEqual({ ok: r.ok, error: r.error }, { ok: false, error: 'slow_down' });

  server.handlers['/me/refresh'] = () => { throw new TypeError('Failed to fetch'); };
  r = await gd.recheck();
  assert.equal(r.ok, false);
  assert.match(r.message, /reach|connection/i);

  server.handlers = {};
  r = await gd.recheck();
  assert.deepEqual({ ok: r.ok, verified: r.verified }, { ok: true, verified: false });

  server.verified = true;
  r = await gd.recheck();
  assert.deepEqual({ ok: r.ok, verified: r.verified }, { ok: true, verified: true });
  assert.equal(gd.getStatus().status, 'verified');
});

/* ---- the vault address is pinned by the build (defence in depth) ---- */

test('redeem refuses a vault address that differs from the one this build was configured with', async (t) => {
  const { gd } = await connected(t);
  let sent = 0;
  gd.loaders = stubLoaders({ spoils: { redeemSpoil: async () => { sent++; return { hash: H3 }; } } });
  t.after(() => { GD.vault = ''; });

  GD.vault = '0x1111111111111111111111111111111111111111';
  const res = await gd.redeem('7');
  assert.deepEqual({ ok: res.ok, error: res.error }, { ok: false, error: 'vault_mismatch' });
  assert.equal(sent, 0);

  GD.vault = '0x00000000000000000000000000000000000BA5E1'; // same address, different case
  assert.equal((await gd.redeem('7')).ok, true);
  assert.equal(sent, 1);
});
