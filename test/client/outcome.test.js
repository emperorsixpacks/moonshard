import test from 'node:test';
import assert from 'node:assert/strict';
import { describeOutcome } from '../../src/gd/outcome.js';

/* What the player is told after an action must be what actually happened, and nothing more. */

const H = `0x${'ab'.repeat(32)}`;
const paid = (over = {}) => ({
  ok: true, hash: H, confirmed: false, confirmPending: false, confirmRejected: null, reconnectNeeded: false, submitted: false, ...over,
});

test('a confirmed daily claim says the blessing is active only when it really is', () => {
  const yes = describeOutcome('ubi', paid({ confirmed: true }), { blessing: true });
  assert.match(yes.text, /Citizen's Blessing active/);
  assert.equal(yes.type, 'info');

  const no = describeOutcome('ubi', paid({ confirmed: true }), { blessing: false });
  assert.doesNotMatch(no.text, /active/i);
  assert.match(no.text, /G\$ claimed/);
});

test('a confirmation that is only queued promises a retry, not a blessing', () => {
  const r = describeOutcome('ubi', paid({ confirmPending: true }), { blessing: false });
  assert.match(r.text, /retrying automatically/);
  assert.doesNotMatch(r.text, /blessing active/i);
});

test('a confirmation the server refused for good says so, with the reason, and never promises a retry', () => {
  const r = describeOutcome('ubi', paid({ confirmRejected: 'tx_not_today' }), { blessing: false });
  assert.equal(r.type, 'warn');
  assert.match(r.text, /claimed on-chain/i);
  assert.match(r.text, /not made today/i);
  assert.doesNotMatch(r.text, /retry/i);
  assert.doesNotMatch(r.text, /tx_not_today/);
});

test('a paid action with a dead session says to reconnect, and never promises a retry', () => {
  for (const act of ['ubi', 'bounty', 'redeem']) {
    const r = describeOutcome(act, paid({ reconnectNeeded: true }), {});
    assert.equal(r.type, 'warn', act);
    assert.match(r.text, /Reconnect your wallet/, act);
    assert.doesNotMatch(r.text, /retrying automatically/, act);
  }
});

test('a transaction that was sent but not yet seen on the network is "sent", not "claimed"', () => {
  for (const act of ['ubi', 'bounty', 'redeem']) {
    const r = describeOutcome(act, paid({ submitted: true, confirmPending: true }), {});
    assert.match(r.text, /sent/i, act);
    assert.match(r.text, /confirm/i, act);
    assert.match(r.text, /celoscan\.io\/tx\//, act);
  }
});

test('if the server could already see a "sent" transaction, the confirmed wording wins', () => {
  const r = describeOutcome('bounty', paid({ submitted: true, confirmed: true }), {});
  assert.match(r.text, /Bounty claimed!/);
});

test('bounty and Spoils have their own wording and link to the transaction', () => {
  const b = describeOutcome('bounty', paid({ confirmed: true }), {});
  const r = describeOutcome('redeem', paid({ confirmed: true }), {});
  assert.match(b.text, /Bounty claimed/);
  assert.match(r.text, /Spoils redeemed/);
  assert.match(b.text, /celoscan\.io\/tx\/0xabab/);
});

test('a failed action is an error carrying its message', () => {
  assert.deepEqual(describeOutcome('ubi', { ok: false, message: 'Nope.' }, {}), { text: 'Nope.', type: 'error' });
  assert.equal(describeOutcome('ubi', { ok: false }, {}).text, 'Something went wrong. Please try again.');
});

test('"check again" says whether the player is verified yet', () => {
  assert.match(describeOutcome('recheck', { ok: true, verified: true }, {}).text, /Verified/);
  const no = describeOutcome('recheck', { ok: true, verified: false }, {});
  assert.equal(no.type, 'warn');
  assert.match(no.text, /Not verified yet/);
});

test('connecting is acknowledged; silent actions return nothing', () => {
  assert.match(describeOutcome('connect', { ok: true }, {}).text, /connected/);
  assert.match(describeOutcome('reconnect', { ok: true }, {}).text, /reconnected/);
  for (const act of ['disconnect', 'switch', 'verify']) assert.equal(describeOutcome(act, { ok: true }, {}), null, act);
});
