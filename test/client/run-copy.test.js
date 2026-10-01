import test from 'node:test';
import assert from 'node:assert/strict';
import { bossLine, notRecordedWhy, shardVerdict, shardsLine, survivalLabel } from '../../src/gd/runs.js';

/*
 * What the end screens may promise. The server credits Shards only to verified, unflagged runs with checkpoint coverage
 * of at least 0.5, and pays the boss bounty only for a run it accepted as a boss clear (server/src/runs.js). The
 * copy must follow what the server said, not what the player did.
 */

const ME = { connected: true, verified: true };
const ANON = { connected: false, verified: false };
const UNVERIFIED = { connected: true, verified: false };

const ok = { ticketed: true, ok: true, rankedOk: true, bossCleared: true, flags: [], rank: { open: 3, ranked: 2 }, coverage: 1, isNewBest: false };
const flagged = { ...ok, rankedOk: false, bossCleared: false, flags: ['boss_low_coverage'], coverage: 0.75 };
const offline = { ticketed: true, error: 'timeout', status: 0, reason: 'offline' };
const unticketed = { ticketed: false, reason: 'not_connected' };

// ----------------------------------------------------------------------------------------- shardVerdict

test('shardVerdict: only a verified, unflagged, recorded run credits Shards', () => {
  assert.equal(shardVerdict(ok, ME), 'credited');
  assert.equal(shardVerdict({ ...ok, bossCleared: false }, ME), 'credited', 'a death is credited too');
  assert.equal(shardVerdict(ok, ANON), 'not_credited');
  assert.equal(shardVerdict(ok, UNVERIFIED), 'not_credited');
  assert.equal(shardVerdict(undefined, ME), 'not_credited');
  assert.equal(shardVerdict(unticketed, ME), 'not_credited');
  assert.equal(shardVerdict(offline, ME), 'not_credited');
  assert.equal(shardVerdict(flagged, ME), 'not_credited');
  assert.equal(shardVerdict({ ...ok, flags: ['cp_regress'], rankedOk: false }, ME), 'not_credited');
});

test('shardVerdict: rankedOk false means the server saw an unverified or flagged run', () => {
  assert.equal(shardVerdict({ ...ok, rankedOk: false }, ME), 'not_credited');
});

test('shardVerdict: coverage under one half is not credited even when nothing was flagged (Story ignores coverage for ranking)', () => {
  assert.equal(shardVerdict({ ...ok, coverage: 0.49 }, ME), 'not_credited');
  assert.equal(shardVerdict({ ...ok, coverage: 0.5 }, ME), 'credited');
});

test('shardVerdict: a run the server already holds cannot be judged from here', () => {
  assert.equal(shardVerdict({ ticketed: true, alreadySubmitted: true, coverage: 1 }, ME), 'unknown');
});

// ----------------------------------------------------------------------------------------- shardsLine

const line = (over) => shardsLine({ shards: 3, rateG: 2, ...ME, result: ok, ...over });

test('shardsLine: pending G$ only for a credited run', () => {
  assert.match(line().text, /\+6 G\$ pending \(3 Shards\)/i);
  assert.equal(line().tone, 'shard');
});

test('shardsLine: while the run is still being saved it promises nothing', () => {
  const l = line({ result: undefined });
  assert.doesNotMatch(l.text, /G\$ pending/i);
  assert.match(l.text, /saving/i);
});

test('shardsLine: anonymous and unverified players are told what it takes', () => {
  assert.match(line({ ...ANON, result: unticketed }).text, /connect/i);
  assert.doesNotMatch(line({ ...ANON, result: unticketed }).text, /pending/i);
  assert.match(line({ ...UNVERIFIED, result: ok }).text, /verify/i);
  assert.doesNotMatch(line({ ...UNVERIFIED, result: ok }).text, /pending/i);
});

test('shardsLine: a failed or flagged submit says the Shards were not banked, and why', () => {
  const off = line({ result: offline });
  assert.match(off.text, /not banked/i);
  assert.match(off.text, /offline/i);
  assert.doesNotMatch(off.text, /G\$ pending/i);
  const fl = line({ result: flagged });
  assert.match(fl.text, /not banked/i);
  assert.match(fl.text, /flagged/i);
  const connectedMidRun = line({ result: unticketed });
  assert.match(connectedMidRun.text, /not banked/i);
  const short = line({ result: { ...ok, coverage: 0.2 } });
  assert.match(short.text, /not banked/i);
});

test('shardsLine: brief leaves out the reason, for a screen that already gives it', () => {
  assert.equal(line({ result: offline, brief: true }).text, '3 Shards not banked');
  assert.match(line({ result: offline }).text, /offline/i);
  assert.match(line({ result: ok, brief: true }).text, /\+6 G\$ pending/, 'brief changes nothing for an accepted run');
});

test('shardsLine: a run the server already holds does not claim pending G$', () => {
  const l = line({ result: { ticketed: true, alreadySubmitted: true, coverage: 1 } });
  assert.doesNotMatch(l.text, /G\$ pending/i);
  assert.match(l.text, /wallet/i);
});

test('shardsLine: no Shards collected', () => {
  assert.equal(line({ shards: 0 }).text, 'Shard Harvest: 0 Shards');
  assert.match(line({ shards: 0, ...ANON, result: unticketed }).text, /connect/i);
  assert.match(line({ shards: 0, ...UNVERIFIED }).text, /verify/i);
});

test('shardsLine: rate and count are used as given', () => {
  assert.match(line({ shards: 7, rateG: 3 }).text, /\+21 G\$/);
});

// ----------------------------------------------------------------------------------------- bossLine

const boss = (over) => bossLine({ ...ME, result: ok, alreadyClaimed: false, rewardG: undefined, ...over });

test('bossLine: anonymous players get no number and no promise about this run', () => {
  const l = boss({ ...ANON, result: unticketed });
  assert.equal(l.text, 'Connect & verify to earn boss bounties in future runs');
  assert.doesNotMatch(l.text, /\d/);
});

test('bossLine: the amount is printed only when the server provided it, and never as the literal 5000', () => {
  const none = boss({});
  assert.match(none.text, /boss slain/i);
  assert.doesNotMatch(none.text, /\d/);
  assert.doesNotMatch(none.text, /5000|5,000/);
  const some = boss({ rewardG: '2400' });
  assert.match(some.text, /claim 2,400 G\$/i);
  assert.equal(some.tone, 'good');
  assert.doesNotMatch(boss({ rewardG: 0 }).text, /\d/);
  assert.doesNotMatch(boss({ rewardG: null }).text, /\d/);
  assert.doesNotMatch(boss({ rewardG: 'lots' }).text, /lots|NaN/);
});

test('bossLine: while the run is being saved it only says so', () => {
  const l = boss({ result: undefined });
  assert.match(l.text, /saving/i);
  assert.doesNotMatch(l.text, /claim/i);
});

test('bossLine: a boss kill whose submit failed says the bounty was not recorded, with the reason', () => {
  for (const [result, why] of [[offline, /offline/i], [{ ticketed: true, error: 'invalid_session', status: 401, reason: 'signed_out' }, /signed out/i], [unticketed, /connected mid-run/i]]) {
    const l = boss({ result });
    assert.match(l.text, /bounty not recorded/i);
    assert.match(l.text, why);
    assert.doesNotMatch(l.text, /claim your/i);
    assert.notEqual(l.tone, 'good');
  }
});

test('bossLine: a boss kill the server flagged is not a bounty', () => {
  const l = boss({ result: flagged });
  assert.match(l.text, /bounty not recorded/i);
  assert.doesNotMatch(l.text, /claim/i);
});

test('bossLine: recorded as cleared: verified players claim, unverified players are told to verify', () => {
  assert.match(boss({}).text, /claim/i);
  assert.match(boss({ ...UNVERIFIED }).text, /verify you are human/i);
  assert.doesNotMatch(boss({ ...UNVERIFIED }).text, /claim your/i);
});

test('bossLine: a one-time bounty already claimed is reported as such, whatever happened to this run', () => {
  assert.match(boss({ alreadyClaimed: true }).text, /already claimed/i);
  assert.match(boss({ alreadyClaimed: true, result: offline }).text, /already claimed/i);
});

test('bossLine: a run the server already holds points to the wallet instead of promising', () => {
  const l = boss({ result: { ticketed: true, alreadySubmitted: true } });
  assert.match(l.text, /wallet/i);
  assert.doesNotMatch(l.text, /boss slain/i);
});

// ----------------------------------------------------------------------------------------- survivalLabel

const label = (over) => survivalLabel({ ...ME, result: ok, ...over });

test('survivalLabel: not connected keeps the existing invitation', () => {
  assert.equal(label({ ...ANON, result: undefined }), 'Not Ranked — Connect Wallet to Compete');
});

test('survivalLabel: before the answer it says Submitting, never Offline', () => {
  assert.equal(label({ result: undefined }), 'Submitting run...');
});

test('survivalLabel: after a long wait it says so and points to the board', () => {
  assert.equal(label({ result: undefined, slow: true }), 'Still submitting — check the Leaderboard shortly');
  assert.equal(label({ result: ok, slow: true }), 'Ranked — #2', 'an answer wins over the notice');
});

test('survivalLabel: ranked, new best and open-board wording is unchanged', () => {
  assert.equal(label({}), 'Ranked — #2');
  assert.equal(label({ result: { ...ok, isNewBest: true } }), 'Ranked — #2 (New Best)');
  assert.equal(label({ result: { ...ok, rankedOk: false, flags: [] } }), 'Open Board #3 — run not ranked');
  assert.equal(label({ ...UNVERIFIED, result: { ...ok, rankedOk: false, flags: [] } }), 'Open Board #3 — verify to compete for G$');
});

test('survivalLabel: failures say why, using the reason from the tracker', () => {
  assert.equal(label({ result: offline }), 'Run Not Recorded (Offline)');
  assert.equal(label({ result: { ticketed: true, error: 'x', status: 503, reason: 'server_error' } }), 'Run Not Recorded (Server Error)');
  assert.equal(label({ result: { ticketed: true, error: 'invalid_session', status: 401, reason: 'signed_out' } }), 'Run Not Recorded (Signed Out)');
  assert.equal(label({ result: { ticketed: true, error: 'rate_limited', status: 429, reason: 'rate_limited' } }), 'Run Not Recorded (Server Busy)');
  assert.equal(label({ result: unticketed }), 'Run Not Recorded (Wallet Connected Mid-Run)');
  assert.equal(label({ result: { ticketed: true, error: 'invalid_duration', status: 400, reason: 'rejected' } }), 'Run Not Recorded (Run Too Short)');
  assert.equal(label({ result: { ticketed: true, error: 'invalid_score_rate', status: 400, reason: 'rejected' } }), 'Run Not Recorded (invalid_score_rate)');
});

test('survivalLabel: a run the server already holds is not labelled Offline', () => {
  assert.equal(label({ result: { ticketed: true, alreadySubmitted: true } }), 'Run Recorded — open the Leaderboard for your rank');
});

test('survivalLabel: flagged runs and interrupted uploads are named', () => {
  assert.equal(label({ result: { ...ok, rankedOk: false, flags: ['cp_regress'] } }), 'Open Board #3 — run flagged, not ranked');
  assert.equal(label({ result: { ...ok, rankedOk: false, flags: [], checkpointFailed: true } }), 'Open Board #3 — not ranked (upload was interrupted)');
});

// ----------------------------------------------------------------------------------------- notRecordedWhy

test('notRecordedWhy: every reason the tracker can give has words', () => {
  for (const reason of ['offline', 'server_error', 'signed_out', 'rate_limited', 'superseded', 'expired', 'starting', 'not_connected', 'no_run', 'rejected']) {
    const why = notRecordedWhy({ ticketed: false, reason });
    assert.ok(why && typeof why === 'string' && why.length < 40, `${reason}: ${why}`);
  }
  assert.equal(notRecordedWhy({ ticketed: true, error: 'timeout', status: 0 }), 'Offline', 'results without a reason fall back on the status');
  assert.equal(notRecordedWhy(undefined), 'Unknown');
});
