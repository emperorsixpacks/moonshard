import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureReferral, claimStashedReferral, fetchReferrals, forgetRefCode, normalizeRefCode, referralLink, stashedRefCode,
} from '../../src/gd/referral.js';

/*
 * The player's side of referrals: the code a visitor arrives with is kept until they sign in and then claimed once, and a
 * player's own invite link is the site's address with their code on it. Nothing here may fail or hold up a sign-in.
 */

const CODE = 'K7M2QX9A';
const DAY = 86_400_000;

/** A storage that behaves like localStorage, and can be made to refuse writes (private mode, a full disk). */
function fakeStore({ refuseWrites = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { if (refuseWrites) throw new Error('QuotaExceededError'); map.set(k, v); },
    removeItem: (k) => map.delete(k),
  };
}

/** A window at `href`, remembering what the page's address was changed to. */
function fakeWindow(href) {
  const win = { location: { href }, replaced: [], history: { replaceState: (_s, _t, url) => win.replaced.push(String(url)) } };
  return win;
}

test.afterEach(() => forgetRefCode({ store: fakeStore() }));

test('a code is found whatever its case and spacing, and anything that cannot be one is not', () => {
  assert.equal(normalizeRefCode('k7m2qx9a'), CODE);
  assert.equal(normalizeRefCode(`  ${CODE}\n`), CODE);
  for (const bad of ['', null, undefined, 'K7M2QX9', 'K7M2QX9AA', 'K7M2QX9I', 'K7M2QX90', 'K7M2 QX9A', 12345678, {}]) {
    assert.equal(normalizeRefCode(bad), null, `${JSON.stringify(bad)} is not a code`);
  }
});

test('the invite link is the site\'s address with the code on it', () => {
  assert.equal(referralLink(CODE, { base: '', origin: 'https://playmoonshard.xyz' }), `https://playmoonshard.xyz/?ref=${CODE}`);
  assert.equal(referralLink(CODE, { base: 'https://playmoonshard.xyz/', origin: 'http://localhost:5173' }), `https://playmoonshard.xyz/?ref=${CODE}`, 'a pinned address wins, and its trailing slash is not doubled');
  assert.equal(referralLink(CODE, { base: '', origin: 'https://moonshard-git-x.vercel.app///' }), `https://moonshard-git-x.vercel.app/?ref=${CODE}`);
});

test('a visitor who arrives through an invite link keeps the code, and the address bar loses it', () => {
  const store = fakeStore();
  const win = fakeWindow(`https://playmoonshard.xyz/?ref=${CODE}&utm_source=x#top`);
  assert.equal(captureReferral({ win, store, now: 1000 }), CODE);
  assert.equal(stashedRefCode({ store, now: 1000 }), CODE);
  assert.deepEqual(win.replaced, ['https://playmoonshard.xyz/?utm_source=x#top'], 'only the invitation leaves the address; the rest stays');
});

test('a lower-case code in the address is kept as the code it is', () => {
  const store = fakeStore();
  assert.equal(captureReferral({ win: fakeWindow('https://playmoonshard.xyz/?ref=k7m2qx9a'), store }), CODE);
  assert.equal(stashedRefCode({ store }), CODE);
});

test('an address with nothing to keep is left alone', () => {
  const store = fakeStore();
  const win = fakeWindow('https://playmoonshard.xyz/?gdfv=1');
  assert.equal(captureReferral({ win, store }), null);
  assert.deepEqual(win.replaced, [], 'the address is not touched');
  assert.equal(stashedRefCode({ store }), null);
});

test('a code that cannot be one is not kept, but still leaves the address', () => {
  const store = fakeStore();
  const win = fakeWindow('https://playmoonshard.xyz/?ref=<script>');
  assert.equal(captureReferral({ win, store }), null);
  assert.equal(stashedRefCode({ store }), null);
  assert.deepEqual(win.replaced, ['https://playmoonshard.xyz/']);
});

test('the newest link wins until a claim is made', () => {
  const store = fakeStore();
  captureReferral({ win: fakeWindow('https://x.test/?ref=AAAAAAAA'), store });
  captureReferral({ win: fakeWindow('https://x.test/?ref=BBBBBBBB'), store });
  assert.equal(stashedRefCode({ store }), 'BBBBBBBB');
});

test('a code nobody used in thirty days is forgotten', () => {
  const store = fakeStore();
  captureReferral({ win: fakeWindow(`https://x.test/?ref=${CODE}`), store, now: 0 });
  assert.equal(stashedRefCode({ store, now: 29 * DAY }), CODE);
  assert.equal(stashedRefCode({ store, now: 31 * DAY }), null);
  assert.equal(store.map.size, 0, 'and it is removed, not just ignored');
});

test('storage that refuses writes still keeps the code for this visit', () => {
  const store = fakeStore({ refuseWrites: true });
  assert.equal(captureReferral({ win: fakeWindow(`https://x.test/?ref=${CODE}`), store }), CODE);
  assert.equal(stashedRefCode({ store }), CODE, 'held in memory instead');
});

test('with no usable storage at all (a blocked webview) the code is still kept for this visit', () => {
  // no store given: the module falls back to its own, as it does when localStorage is missing or throws on access
  assert.equal(captureReferral({ win: fakeWindow(`https://x.test/?ref=${CODE}`) }), CODE);
  assert.equal(stashedRefCode(), CODE);
  forgetRefCode();
  assert.equal(stashedRefCode(), null);
});

test('capturing never throws, whatever the page looks like', () => {
  assert.equal(captureReferral({ win: undefined, store: fakeStore() }), null);
  assert.equal(captureReferral({ win: {}, store: fakeStore() }), null);
  assert.equal(captureReferral({ win: { location: { href: 'not a url' } }, store: fakeStore() }), null);
});

/* ---- the claim, after a sign-in ---- */

const apiThat = (outcome) => {
  const calls = [];
  const api = async (path, opts) => {
    calls.push({ path, ...opts });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { api, calls };
};
const failure = (message, status) => Object.assign(new Error(message), { status });
const arrived = (store) => captureReferral({ win: fakeWindow(`https://x.test/?ref=${CODE}`), store });

test('a signed-in friend tells the server who sent them, and the code is spent', async () => {
  const store = fakeStore();
  arrived(store);
  const { api, calls } = apiThat({ ok: true });
  const r = await claimStashedReferral({ token: 'jwt', api, store });
  assert.deepEqual(r, { claimed: true });
  assert.deepEqual(calls, [{ path: '/referrals/claim', method: 'POST', token: 'jwt', body: { code: CODE } }]);
  assert.equal(stashedRefCode({ store }), null);
});

test('nothing is sent without a code, or without a session', async () => {
  const store = fakeStore();
  const { api, calls } = apiThat({ ok: true });
  assert.deepEqual(await claimStashedReferral({ token: 'jwt', api, store }), { claimed: false, reason: 'none' });
  arrived(store);
  assert.deepEqual(await claimStashedReferral({ token: null, api, store }), { claimed: false, reason: 'none' });
  assert.deepEqual(calls, []);
  assert.equal(stashedRefCode({ store }), CODE, 'and the code waits for a sign-in');
});

for (const [status, message] of [[404, 'unknown_code'], [400, 'bad_code'], [409, 'own_code'], [409, 'already_referred'], [409, 'not_new']]) {
  test(`a refusal the server would always repeat (${message}) forgets the code`, async () => {
    const store = fakeStore();
    arrived(store);
    const r = await claimStashedReferral({ token: 'jwt', api: apiThat(failure(message, status)).api, store });
    assert.deepEqual(r, { claimed: false, reason: message });
    assert.equal(stashedRefCode({ store }), null);
  });
}

for (const [status, message, why] of [
  [0, 'network_error', 'the player is offline'],
  [0, 'timeout', 'the server is slow'],
  [500, 'internal_error', 'the server fails'],
  [503, 'chain_unavailable', 'the server is busy'],
  [429, 'rate_limited', 'the player is throttled'],
  [404, 'api_error', 'the server is an older one without referrals (its 404 is not an answer about this code)'],
  [401, 'invalid_session', 'the session ended'],
]) {
  test(`the code is kept for the next sign-in when ${why}`, async () => {
    const store = fakeStore();
    arrived(store);
    const r = await claimStashedReferral({ token: 'jwt', api: apiThat(failure(message, status)).api, store });
    assert.deepEqual(r, { claimed: false, reason: 'retry' });
    assert.equal(stashedRefCode({ store }), CODE);
  });
}

test('the player\'s own referrals are read with their session', async () => {
  const { api, calls } = apiThat({ code: CODE, joined: 0, verified: 0, playing: 0, friends: [] });
  const me = await fetchReferrals({ token: 'jwt', api });
  assert.equal(me.code, CODE);
  assert.deepEqual(calls, [{ path: '/referrals/me', token: 'jwt' }]);
});
