import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPrizeAmounts, honorsFor, positiveNumber, rewardsFacts, rewardsLine, secondsLabel, shortAddress, spoilsPanelDetail } from '../../src/ui/leaderboardText.js';

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

/* ---- the rewards line ---- */

const rewards = (over = {}) => ({
  firstBossClaimed: false, firstBossPrizeG: 2400,
  crystalStatus: { gdEarned: 4, dailyCapGd: 100, isCapped: false },
  ...over,
});

test('the line shows the bounty and the day\'s Shard Harvest', () => {
  assert.deepEqual(rewardsLine(rewards()), { boss: 'First boss: unclaimed (2400 G$)', harvest: 'Harvest today: 4 / 100 G$' });
  assert.deepEqual(rewardsLine(rewards({ firstBossClaimed: true })), { boss: 'First boss: claimed (+2400 G$)', harvest: 'Harvest today: 4 / 100 G$' });
});

test('a bounty amount the server did not send is left out, whatever else it sent', () => {
  for (const v of [undefined, null, 0, -5, 'abc', '', NaN, {}, false, true]) {
    const { boss } = rewardsLine(rewards({ firstBossPrizeG: v }));
    assert.equal(boss, 'First boss: unclaimed', `prize ${JSON.stringify(v)}`);
  }
  assert.equal(rewardsLine(rewards({ firstBossClaimed: true, firstBossPrizeG: null })).boss, 'First boss: claimed');
});

test('the harvest cap is the server\'s, and when it sent none the line does not invent one', () => {
  assert.equal(rewardsLine(rewards({ crystalStatus: { gdEarned: 7, dailyCapGd: 40, isCapped: false } })).harvest, 'Harvest today: 7 / 40 G$');
  for (const dailyCapGd of [undefined, null, 0, 'abc']) {
    const { harvest } = rewardsLine(rewards({ crystalStatus: { gdEarned: 7, dailyCapGd, isCapped: false } }));
    assert.equal(harvest, 'Harvest today: 7 G$', `cap ${JSON.stringify(dailyCapGd)}`);
  }
  assert.equal(rewardsLine(rewards({ crystalStatus: undefined })).harvest, 'Harvest today: 0 G$');
});

test('a capped harvest says so', () => {
  assert.equal(rewardsLine(rewards({ crystalStatus: { gdEarned: 100, dailyCapGd: 100, isCapped: true } })).harvest, 'Harvest today: 100 / 100 G$ (full)');
});

test('with prizes off the line names the boss bounty and no Shard Harvest', () => {
  const line = rewardsLine({
    prizesEnabled: false, firstBossClaimed: false, firstBossPrizeG: 2400,
    crystalStatus: { gdEarned: 0, dailyCapGd: 0, isCapped: false, shards: 12, rateGd: 0 },
  });
  assert.deepEqual(line, { boss: 'First boss: unclaimed (2400 G$)', harvest: null });
  assert.equal(rewardsFacts({ prizesEnabled: false }).harvest, null);
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

test('honors: a medal for the top three, with the daily prize amount when the server named one; nothing for the rest', () => {
  assert.deepEqual(honorsFor(0, '1000'), { medal: 'gold', amount: '1000' });
  assert.deepEqual(honorsFor(1, 600), { medal: 'silver', amount: '600' });
  assert.deepEqual(honorsFor(2, '300'), { medal: 'bronze', amount: '300' });
  assert.deepEqual(honorsFor(0, null), { medal: 'gold', amount: null });
  assert.deepEqual(honorsFor(2, undefined), { medal: 'bronze', amount: null });
  for (const bad of ['abc', 0, -1, '']) assert.equal(honorsFor(0, bad).amount, null, `amount ${JSON.stringify(bad)}`);
  assert.equal(honorsFor(3, '10'), null);
  assert.equal(honorsFor(40, null), null);
});

test('the three daily prizes: from the config, else from the daily board, else none', () => {
  assert.deepEqual(dailyPrizeAmounts({ prizesG: ['1000', '600', '300'] }, null), ['1000', '600', '300']);
  assert.deepEqual(dailyPrizeAmounts(null, { prizesG: [500, 300, 100] }), ['500', '300', '100']);
  assert.deepEqual(dailyPrizeAmounts({ prizesG: [] }, { prizesG: ['9', '8', '7'] }), ['9', '8', '7'], 'the config had none, the board has');
  assert.equal(dailyPrizeAmounts({ prizesG: ['1', '2'] }, { prizesG: ['1', 'x', '3'] }), null, 'short, or with an amount that is not one');
  assert.equal(dailyPrizeAmounts(null, null), null);
  assert.equal(dailyPrizeAmounts(undefined, {}), null);
});

test('times and addresses', () => {
  assert.equal(secondsLabel(65_400), '65s');
  assert.equal(secondsLabel('abc'), '0s');
  assert.equal(secondsLabel(undefined), '0s');
  assert.equal(shortAddress('0x1111111111111111111111111111111111111111'), '0x11…1111');
  assert.equal(shortAddress('abc'), 'abc');
  assert.equal(shortAddress(undefined), '');
});
