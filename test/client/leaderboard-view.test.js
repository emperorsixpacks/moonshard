import test from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardHtml, leaderboardModel, loadErrorText, spoilsSheetHtml } from '../../src/ui/leaderboardView.js';

/* The leaderboard, as pure functions of what the server sent and who the player is: what the screen shows in every state. */

const ME = '0x1111111111111111111111111111111111111111';
const A = '0xb2d6a1f0c4e8b3a597d2c1e0f4a8b6c3d9e7b1c7';
const B = '0x7a3f9c2e1d4b6a8c0e5f7a9b1c3d5e7f9a1b3c5d';
const entry = (rank, wallet, score = 1000, durationMs = 60_000) => ({ rank, wallet, score, durationMs });
const BOARD = [entry(1, A, 3206, 186_000), entry(2, B, 2840, 171_000), entry(3, ME, 2410, 150_000), entry(4, '0xc4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7', 1980, 128_000)];

const base = (over = {}) => ({
  tab: 'alltime', view: 'ranked', load: { state: 'ready' },
  alltime: { entries: BOARD }, daily: { entries: BOARD.slice(0, 3), prizesG: ['1000', '600', '300'] },
  cfg: { prizesEnabled: true, prizesG: ['1000', '600', '300'] }, rewards: null,
  status: { verified: true, shortAddress: '0x11…1111' }, myWallet: ME, prizesOn: true,
  ...over,
});
const model = (over) => leaderboardModel(base(over));
const html = (over) => leaderboardHtml(model(over));

test('one row for each player, in the server\'s order, with the words the screen shows', () => {
  const { rows } = model();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    rank: 1, wallet: A, name: '0xb2…b1c7', time: '186s', score: 3206, honors: { medal: 'gold', amount: null }, isPlayer: false,
  });
  assert.equal(rows[2].isPlayer, true, 'the player\'s own row is marked');
  assert.equal(rows.filter((r) => r.isPlayer).length, 1);
});

test('a medal for the top three, none for the rest', () => {
  const { rows } = model();
  assert.deepEqual(rows.map((r) => r.honors?.medal ?? null), ['gold', 'silver', 'bronze', null]);
  const h = html();
  assert.equal((h.match(/<span class="hn"><svg/g) || []).length, 3, 'three medals');
  assert.equal((h.match(/class="hn none"/g) || []).length, 1);
});

test('the daily board names each prize beside its medal, as the server sent it', () => {
  const { rows, prizes, honorsHead } = model({ tab: 'daily' });
  assert.deepEqual(rows.map((r) => r.honors?.amount), ['1000', '600', '300']);
  assert.deepEqual(prizes, ['1000', '600', '300']);
  assert.equal(honorsHead, 'Honors');
  assert.equal(model().honorsHead, 'Legend');
  assert.match(html({ tab: 'daily' }), /Daily prizes: 1st 1000 · 2nd 600 · 3rd 300 G\$\. Verified humans only\./);
  assert.match(html({ tab: 'daily' }), /<small>1000<\/small>/);
});

test('no prize amount is shown that the server did not send, nor on the open board', () => {
  const none = model({ tab: 'daily', cfg: null, daily: { entries: BOARD.slice(0, 3) } });
  assert.equal(none.prizes, null);
  assert.deepEqual(none.rows.map((r) => r.honors.amount), [null, null, null]);
  assert.doesNotMatch(leaderboardHtml(none), /Daily prizes/);
  const open = model({ tab: 'daily', view: 'open' });
  assert.deepEqual(open.rows.map((r) => r.honors.amount), [null, null, null], 'the open board is not the one prizes are paid from');
});

test('the view switch says which board it is, and what it would change to is the other', () => {
  assert.equal(model().viewText, 'View: Verified');
  assert.equal(model({ view: 'open' }).viewText, 'View: Open');
  assert.match(html(), /data-act="view"/);
});

test('both boards are one tap apart, and the one showing is marked', () => {
  const h = html({ tab: 'daily' });
  assert.match(h, /data-act="tab" data-tab="alltime"/);
  assert.match(h, /class="lb-tab on" aria-selected="true" data-act="tab" data-tab="daily"/);
  assert.match(h, /class="lb-tab" aria-selected="false" data-act="tab" data-tab="alltime"/);
});

test('while loading there is a note and no table; when it failed it says why and offers another try', () => {
  const loading = html({ load: { state: 'loading' } });
  assert.match(loading, /Loading scores…/);
  assert.doesNotMatch(loading, /lb-cols|lb-rows/);
  const failed = html({ load: { state: 'error', error: loadErrorText({ status: 0 }) } });
  assert.match(failed, /Can&#39;t reach the server\. The boards are unavailable right now\./);
  assert.match(failed, /data-act="retry"/);
  assert.equal(loadErrorText({ status: 500 }), 'The boards are unavailable right now. Try again in a moment.');
  assert.equal(loadErrorText(undefined), 'The boards are unavailable right now. Try again in a moment.');
});

test('an empty board says so in words that fit the board and the view', () => {
  assert.match(html({ alltime: { entries: [] } }), /No verified runs yet/);
  assert.match(html({ tab: 'daily', daily: { entries: [] } }), /No verified runs today/);
  assert.match(html({ alltime: { entries: [] }, view: 'open' }), /No runs yet/);
  assert.match(html({ alltime: { entries: [] } }), /Play a Trial and your verified score appears here\./);
  assert.doesNotMatch(html({ alltime: { entries: [] } }), /lb-cols/, 'no column heads over nothing');
});

test('the status line follows the player: not connected, not verified, verified and ranked, verified and not on the board', () => {
  assert.match(model({ myWallet: null }).statusLine.text, /Not connected\. Tap to connect a wallet and join the board\./);
  const unverified = model({ status: { verified: false, shortAddress: '0x11…1111' } }).statusLine;
  assert.match(unverified.text, /verify you are human to compete for G\$ prizes/);
  assert.equal(unverified.tone, 'warn');
  assert.match(model().statusLine.text, /0x11…1111: you are rank #3/);
  const off = model({ alltime: { entries: BOARD.filter((e) => e.wallet !== ME) } }).statusLine;
  assert.match(off.text, /verified\. Play a Trial to claim a spot\./);
  assert.match(html(), /data-act="wallet"/, 'the line opens the wallet');
});

test('the player\'s rewards are shown only when they are connected and the server sent them', () => {
  const rewards = { firstBossClaimed: false, firstBossPrizeG: 2400, crystalStatus: { gdEarned: 4, dailyCapGd: 100, isCapped: false } };
  assert.deepEqual(model({ rewards }).rewards, { boss: 'First boss: unclaimed (2400 G$)', harvest: 'Harvest today: 4 / 100 G$' });
  assert.equal(model({ rewards, myWallet: null }).rewards, null);
  assert.equal(model({ rewards: null }).rewards, null);
  assert.match(html({ rewards }), /First boss: unclaimed \(2400 G\$\)<br>Harvest today: 4 \/ 100 G\$/);
});

test('the Spoils note and button exist only while the server pays prizes', () => {
  assert.match(html(), /data-act="spoils"/);
  assert.match(html(), /Spoils settle after UTC midnight/);
  assert.doesNotMatch(html({ prizesOn: false }), /data-act="spoils"|Spoils settle/);
  const sheet = spoilsSheetHtml(model());
  assert.match(sheet, /win 1000\/600\/300 G\$ at UTC midnight/);
  assert.equal((sheet.match(/<p class="lead">/g) || []).length, 3, 'one paragraph for each line');
});

test('the way out is always there: Menu and Play Endless', () => {
  for (const state of ['loading', 'ready', 'error']) {
    const h = html({ load: { state, error: 'x' } });
    assert.match(h, /data-act="menu">Menu</, state);
    assert.match(h, /data-act="endless">Play Endless</, state);
  }
});

test('whatever comes from the server or the wallet is text, never markup', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const h = html({
    alltime: { entries: [{ rank: 1, wallet: evil, score: '<b>9</b>', durationMs: 'abc' }] },
    status: { verified: true, shortAddress: evil },
    myWallet: evil,
    load: { state: 'ready' },
  });
  assert.doesNotMatch(h, /<img src=x/, 'no tag made from an address');
  assert.doesNotMatch(h, /<b>9<\/b>/, 'a score is a number');
  assert.match(h, /0 ?<small>pts<\/small>|>0<small>pts/, 'a score that is not a number is 0');
  const failed = html({ load: { state: 'error', error: evil } });
  assert.doesNotMatch(failed, /<img src=x/);
});
