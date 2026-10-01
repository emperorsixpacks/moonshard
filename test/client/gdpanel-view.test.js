import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPanelHtml } from '../../src/ui/gdPanelView.js';

/* The wallet panel as a pure function of the service status: what the player sees in every state. */

const ADDR = '0xabcdef0123456789abcdef0123456789abcdef01';
const spoil = (over = {}) => ({ id: '7', kind: 'TRIAL_PRIZE', day: '2026-10-05', rank: 1, amountG: '1000', claimed: false, voucher: { to: ADDR }, ...over });

const status = (over = {}) => ({
  connected: true, address: ADDR, shortAddress: '0xabcd…ef01', status: 'verified', verified: true, wrongChain: false,
  hasWallet: true, needsReconnect: false, offline: false, sessionExpired: false, busy: null, host: 'browser', language: 'en',
  rewards: { blessing: false, crystalStatus: { gdEarned: 4, dailyCapGd: 100, isCapped: false } },
  ubi: { entitlementG: '114.5', canClaim: true, nextClaimAt: null },
  bounty: { configured: true, canClaim: true, claimedHere: false, pendingRunId: 'run-1', rewardG: '2400' },
  spoils: [spoil()], vault: { address: '0x00000000000000000000000000000000000ba5e1' },
  stale: { rewards: false, bounty: false, spoils: false, ubi: false },
  pendingCount: 0, awaiting: { ubi: null, bounty: null, spoils: {} }, blessing: false,
  ...over,
});

const html = (over) => renderPanelHtml(status(over), 0);

test('a verified player sees the daily claim, the bounty and the Spoils', () => {
  const h = html();
  assert.match(h, /VERIFIED HUMAN/);
  assert.match(h, /CLAIM DAILY G\$/);
  assert.match(h, /CLAIM 2,400 G\$ BOUNTY/);
  assert.match(h, /data-act="redeem" data-id="7"/);
});

test('an ended session says so and offers to connect; it does not ask to verify', () => {
  const h = html({ connected: false, status: 'anonymous', verified: false, sessionExpired: true, ubi: null, bounty: null, spoils: [] });
  assert.match(h, /session ended/i);
  assert.match(h, /data-act="connect"/);
  assert.doesNotMatch(h, /PROVE YOU/);
});

test('a connected player whose server cannot be reached is not asked to verify', () => {
  const h = html({ status: 'unknown', verified: false, offline: true, ubi: null, bounty: null, spoils: [] });
  assert.match(h, /SERVER OFFLINE/);
  assert.match(h, /data-act="recheck"/);
  assert.doesNotMatch(h, /VERIFY \(FACE SCAN\)/);
  assert.doesNotMatch(h, /PROVE YOU/);
});

test('Spoils that could not be loaded say "unavailable", not "none yet"', () => {
  const h = html({ spoils: [], stale: { rewards: false, bounty: false, spoils: true, ubi: false } });
  assert.match(h, /Spoils.*unavailable|unavailable.*Spoils/i);
  assert.doesNotMatch(h, /No Spoils yet/);
});

test('Spoils that are known but could not be refreshed stay visible, with a note', () => {
  const h = html({ stale: { rewards: false, bounty: false, spoils: true, ubi: false } });
  assert.match(h, /data-act="redeem"/);
  assert.match(h, /could not be refreshed|last known/i);
});

test('a bounty that could not be loaded says so instead of "coming soon"', () => {
  const h = html({ bounty: null, stale: { rewards: false, bounty: true, spoils: false, ubi: false } });
  assert.match(h, /bounty.*unavailable|unavailable.*bounty/i);
  assert.doesNotMatch(h, /coming soon/i);
});

test('a bounty amount the server did not give is not invented', () => {
  const h = html({ bounty: { configured: true, canClaim: true, pendingRunId: 'run-1', rewardG: null } });
  assert.doesNotMatch(h, /5,?000/);
  assert.doesNotMatch(h, /null|undefined|NaN/);
  assert.match(h, /data-act="bounty"/);
  const waiting = html({ bounty: { configured: true, pendingRunId: null, rewardG: null } });
  assert.doesNotMatch(waiting, /null|undefined|NaN/);
});

test('a server reason is shown as words, never as a code', () => {
  const code = html({ bounty: { configured: true, canClaim: false, pendingRunId: 'run-1', reason: 'not_claimable', rewardG: '2400' } });
  assert.doesNotMatch(code, /not_claimable/);
  assert.match(code, /not claimable right now/i);
  const sentence = html({ bounty: { configured: true, canClaim: false, pendingRunId: 'run-1', reason: 'Already claimed in this app', rewardG: '2400' } });
  assert.match(sentence, /Already claimed in this app/);
});

test('a payment that is sent but not recorded replaces the claim button with a note', () => {
  const h = html({
    awaiting: { ubi: '0x' + '11'.repeat(32), bounty: '0x' + '22'.repeat(32), spoils: { 7: '0x' + '33'.repeat(32) } },
  });
  assert.doesNotMatch(h, /data-act="ubi"/);
  assert.doesNotMatch(h, /data-act="bounty"/);
  assert.doesNotMatch(h, /data-act="redeem"/);
  assert.equal((h.match(/waiting for the network|being recorded|confirming/gi) || []).length >= 3, true);
});

test('unrecorded payments are counted', () => {
  assert.match(html({ pendingCount: 2 }), /2 payments? waiting to be recorded/);
  assert.doesNotMatch(html({ pendingCount: 0 }), /waiting to be recorded/);
});

test('nothing from the server or the wallet is put into the markup unescaped', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const h = html({
    spoils: [spoil({ id: evil, day: '<b>boom</b>' })],
    bounty: { configured: true, canClaim: false, pendingRunId: 'r', reason: '<i>x</i> is not allowed here', rewardG: '2400' },
    shortAddress: '<s>addr</s>',
  });
  assert.doesNotMatch(h, /<img|<b>boom|<i>x|<s>addr/);
});

test('a reconnect notice disables the on-chain buttons', () => {
  const h = html({ needsReconnect: true });
  assert.match(h, /data-act="reconnect"/);
  assert.match(h, /data-act="ubi"[^>]*disabled/);
});

test('a daily claim that is done with no countdown known just says claimed', () => {
  const h = html({ ubi: { entitlementG: '0', canClaim: false, nextClaimAt: null } });
  assert.match(h, /Claimed today/);
  assert.doesNotMatch(h, /in now/);
});

test('with the server unreachable but data known, the data stays and the notice is shown', () => {
  const h = html({ offline: true });
  assert.match(h, /Server unreachable/);
  assert.match(h, /CLAIM DAILY G\$/);
});
