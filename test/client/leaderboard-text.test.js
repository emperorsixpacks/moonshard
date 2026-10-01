import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveNumber, prizeLabel, rewardsPillText, secondsLabel, shortAddress, spoilsPanelDetail } from '../../src/ui/leaderboardText.js';

/*
 * What the leaderboard screen says in words, as plain functions of what the server sent. The rule for every amount: it
 * comes from the server or it is left out. Nothing is filled in from a guess, because a number on a reward screen is a
 * promise.
 */

/* ---- positiveNumber ---- */

test('a positive number, or a numeric string, is accepted', () => {
  assert.equal(positiveNumber(2400), 2400);
  assert.equal(positiveNumber('2400'), 2400);
  assert.equal(positiveNumber('0.5'), 0.5);
});

test('anything else is "no amount"', () => {
  for (const v of [undefined, null, 0, -5, 'abc', '', '   ', NaN, Infinity, {}, [], false, true, '0', '-1']) {
    assert.equal(positiveNumber(v), null, String(JSON.stringify(v)));
  }
});

/* ---- the rewards pill ---- */

const rewards = (over = {}) => ({
  firstBossClaimed: false, firstBossPrizeG: 2400,
  crystalStatus: { gdEarned: 4, dailyCapGd: 100, isCapped: false },
  ...over,
});

test('the pill shows the bounty and the day\'s Shard Harvest', () => {
  assert.equal(rewardsPillText(rewards()), '🏆 1st Boss: UNCLAIMED (2400 G$)  |  💎 Harvest: 4 / 100 G$');
  assert.equal(rewardsPillText(rewards({ firstBossClaimed: true })), '🏆 1st Boss: CLAIMED (+2400 G$)  |  💎 Harvest: 4 / 100 G$');
});

test('a bounty amount the server did not send is left out, whatever else it sent', () => {
  for (const v of [undefined, null, 0, -5, 'abc', '', NaN, {}, false, true]) {
    const text = rewardsPillText(rewards({ firstBossPrizeG: v }));
    assert.match(text, /1st Boss: UNCLAIMED  \|/, `prize ${JSON.stringify(v)}`);
    assert.doesNotMatch(text, /UNCLAIMED \(/, `prize ${JSON.stringify(v)}`);
  }
  assert.match(rewardsPillText(rewards({ firstBossClaimed: true, firstBossPrizeG: null })), /1st Boss: CLAIMED  \|/);
});

test('the harvest cap is the server\'s, and when it sent none the pill does not invent one', () => {
  assert.match(rewardsPillText(rewards({ crystalStatus: { gdEarned: 7, dailyCapGd: 40, isCapped: false } })), /Harvest: 7 \/ 40 G\$/);
  for (const dailyCapGd of [undefined, null, 0, 'abc']) {
    const text = rewardsPillText(rewards({ crystalStatus: { gdEarned: 7, dailyCapGd, isCapped: false } }));
    assert.match(text, /Harvest: 7 G\$$/, `cap ${JSON.stringify(dailyCapGd)}`);
    assert.doesNotMatch(text, /100/);
  }
  assert.match(rewardsPillText(rewards({ crystalStatus: undefined })), /Harvest: 0 G\$$/);
});

test('a capped harvest says so', () => {
  assert.match(rewardsPillText(rewards({ crystalStatus: { gdEarned: 100, dailyCapGd: 100, isCapped: true } })), /Harvest: 100 \/ 100 G\$ \(MAX 🔒\)/);
});

/* ---- the Spoils explanation ---- */

test('the Spoils panel states the prizes and the shard cap it was given', () => {
  const text = spoilsPanelDetail({ prizes: ['500', '300', '100'], shardCapG: 40 });
  assert.match(text, /win 500\/300\/100 G\$ at UTC midnight/);
  assert.match(text, /up to 40 G\$\/day/);
  assert.match(text, /redeem your Spoils/);
});

test('with no prize amounts or no cap it says what it knows and no more', () => {
  const none = spoilsPanelDetail({ prizes: null, shardCapG: null });
  assert.match(none, /Top-3 verified daily runs win G\$ at UTC midnight\./);
  assert.match(none, /Shards you collect are paid as G\$ too\./);
  assert.doesNotMatch(none.replace('Top-3', 'Top'), /\d/, 'no amount at all when the server gave none');
});

/* ---- small labels ---- */

test('prize labels: a medal and the amount for the top three, a tree for everyone else', () => {
  assert.equal(prizeLabel(0, '1000'), '🥇 1000 G$');
  assert.equal(prizeLabel(1, '600'), '🥈 600 G$');
  assert.equal(prizeLabel(2, '300'), '🥉 300 G$');
  assert.equal(prizeLabel(0, null), '🥇');
  assert.equal(prizeLabel(2, undefined), '🥉');
  assert.equal(prizeLabel(3, '10'), '🌲');
  assert.equal(prizeLabel(40, null), '🌲');
});

test('times and addresses', () => {
  assert.equal(secondsLabel(65_400), '65s');
  assert.equal(secondsLabel('abc'), '0s');
  assert.equal(secondsLabel(undefined), '0s');
  assert.equal(shortAddress('0x1111111111111111111111111111111111111111'), '0x11…1111');
  assert.equal(shortAddress('abc'), 'abc');
  assert.equal(shortAddress(undefined), '');
});
