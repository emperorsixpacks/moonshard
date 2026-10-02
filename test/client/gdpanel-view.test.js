import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPanelHtml } from '../../src/ui/gdPanelView.js';

/* The wallet panel as a pure function of the service status: what the player sees in every state. */

const ADDR = '0xabcdef0123456789abcdef0123456789abcdef01';
const spoil = (over = {}) => ({ id: '7', kind: 'TRIAL_PRIZE', day: '2026-10-05', rank: 1, amountG: '1000', claimed: false, voucher: { to: ADDR }, ...over });

const BLADE = { id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null };
const SHOP = { enabled: true, token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', vault: '0x00000000000000000000000000000000000ba5e1', items: [BLADE] };
const H = `0x${'ab'.repeat(32)}`;

const status = (over = {}) => ({
  connected: true, address: ADDR, shortAddress: '0xabcd…ef01', status: 'verified', verified: true, wrongChain: false,
  hasWallet: true, needsReconnect: false, offline: false, sessionExpired: false, busy: null, host: 'browser', language: 'en',
  rewards: { blessing: false, crystalStatus: { gdEarned: 4, dailyCapGd: 100, isCapped: false } },
  ubi: { entitlementG: '114.5', canClaim: true, nextClaimAt: null },
  bounty: { configured: true, canClaim: true, claimedHere: false, pendingRunId: 'run-1', rewardG: '2400' },
  spoils: [spoil()], vault: { address: '0x00000000000000000000000000000000000ba5e1' },
  stale: { rewards: false, bounty: false, spoils: false, ubi: false },
  pendingCount: 0, awaiting: { ubi: null, bounty: null, spoils: {}, shop: {} }, blessing: false,
  shop: SHOP, owned: ['iron_starter'], balance: '57.5', prizes: true,
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

test('...and is not told they can still play: the gate holds play until the verification can be checked', () => {
  const h = html({ status: 'unknown', verified: false, offline: true, ubi: null, bounty: null, spoils: [] });
  assert.doesNotMatch(h, /can still play/i);
  assert.match(h, /Server unreachable/);
  assert.match(h, /check your verification/i);
  assert.equal((h.match(/class="gd-warn"/g) || []).length, 1, 'one notice, not the same bad news twice');
});

test('a verified player who cannot claim the bounty is told so up front, and is not promised an amount for beating a boss', () => {
  const h = html({ bounty: { configured: true, canClaim: false, reason: 'not_claimable', claimedHere: false, pendingRunId: null, rewardG: null } });
  assert.match(h, /not claimable right now/i);
  assert.doesNotMatch(h, /unlock a one-time/i);
  assert.doesNotMatch(h, /data-act="bounty"/);
});

test('...while one who can claim it is told what beating a boss unlocks', () => {
  const h = html({ bounty: { configured: true, canClaim: true, claimedHere: false, pendingRunId: null, rewardG: '2400' } });
  assert.match(h, /unlock a one-time bounty of 2,400 G\$/);
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

/* ---- the verified-human gate: shown when the player tries to start a game mode ---- */

const gate = { label: 'ENDLESS MODE' };
const gated = (over) => renderPanelHtml(status(over), 0, { gate });
const anonymous = { connected: false, status: 'anonymous', verified: false, ubi: null, bounty: null, spoils: [], blessing: false };

test('the gate explains the rule and starts at step one for a visitor', () => {
  const h = gated(anonymous);
  assert.match(h, /VERIFIED HUMANS ONLY/);
  assert.match(h, /one human, one slot/i);
  assert.match(h, /data-act="connect"/);
  assert.doesNotMatch(h, /data-act="play"/);
  assert.doesNotMatch(h, /DAILY G\$|FIRST-BOSS BOUNTY|SPOILS/);
  assert.match(h, /gd-step-now[^<]*>[^<]*1\./);
});

test('a connected player who is not verified is sent to the face scan', () => {
  const h = gated({ status: 'unverified', verified: false, ubi: null, bounty: null, spoils: [] });
  assert.match(h, /data-act="verify"/);
  assert.match(h, /data-act="recheck"/);
  assert.doesNotMatch(h, /data-act="play"/);
  assert.match(h, /gd-step-done[^<]*>[^<]*1\./);
  assert.match(h, /gd-step-now[^<]*>[^<]*2\./);
});

test('the gate says when it is still checking, and when it cannot reach the server', () => {
  assert.match(gated({ status: 'unknown', verified: false, offline: false }), /Checking your verification/);
  const off = gated({ status: 'unknown', verified: false, offline: true });
  assert.match(off, /data-act="recheck"/);
  assert.match(off, /reach the server/i);
  assert.doesNotMatch(off, /data-act="play"/);
});

test('a verified human gets a play button that names the mode', () => {
  const h = gated({});
  assert.match(h, /data-act="play"/);
  assert.match(h, /PLAY ENDLESS MODE/);
  assert.match(h, /gd-step-done[^<]*>[^<]*2\./);
});

test('without a gate the panel no longer says the game can be played without a wallet', () => {
  const h = renderPanelHtml(status(anonymous), 0);
  assert.doesNotMatch(h, /play everything without a wallet/i);
  assert.match(h, /verified human/i);
});

/* ---- the 24 h window to claim a boss bounty (finding L8) ---- */

test('a claimable bounty shows how long is left to claim it, when the server says', () => {
  const soon = new Date(23.5 * 3600 * 1000).toISOString(); // `now` is 0 in these tests
  const h = renderPanelHtml(status({ bounty: { configured: true, canClaim: true, pendingRunId: 'r', rewardG: '2400', attestExpiresAt: soon } }), 0);
  assert.match(h, /Claim within 23h 30m/);
  assert.match(h, /data-act="bounty"/);
});

test('...and says so when the window has closed, instead of offering a claim that would be refused', () => {
  const past = new Date(-1000).toISOString();
  const h = renderPanelHtml(status({ bounty: { configured: true, canClaim: true, pendingRunId: 'r', rewardG: '2400', attestExpiresAt: past } }), 0);
  assert.match(h, /window .*closed|too late/i);
  assert.doesNotMatch(h, /data-act="bounty"/);
});

test('without a deadline from the server nothing is invented', () => {
  const h = renderPanelHtml(status(), 0);
  assert.doesNotMatch(h, /Claim within|closed/);
});

test('a visitor with no wallet at all is told how to get in, not just that nothing was found', () => {
  const h = renderPanelHtml(status({ ...anonymous, hasWallet: false }), 0, { gate });
  assert.match(h, /No wallet detected/);
  assert.match(h, /GoodWallet/);
  assert.match(h, /browser wallet/i);
});

/* ---- the blade, paid for in G$: the gate's third step when the server has a Moon Shop ---- */

test('with a Moon Shop the way in has four steps; a verified human without a blade is at step three: buy it with G$', () => {
  const h = gated({ owned: [] });
  assert.match(h, /3\. Buy your blade with G\$/);
  assert.match(h, /4\. Play ENDLESS MODE/);
  assert.match(h, /gd-step-now[^<]*>[^<]*3\./);
  assert.match(h, /data-act="buy" data-id="iron_starter"/);
  assert.match(h, /BUY RUSTED SHORTSWORD — 20 G\$/);
  assert.match(h, /Your G\$: <b>57\.5<\/b>/);
  assert.match(h, /prize vault/i, 'where the G$ goes');
  assert.doesNotMatch(h, /data-act="play"/);
});

test('a player short of G$ is offered today\'s free claim first, not a purchase that would fail', () => {
  const h = gated({ owned: [], balance: '5', ubi: { entitlementG: '114.5', canClaim: true, nextClaimAt: null } });
  assert.match(h, /need 20 G\$/);
  assert.match(h, /data-act="ubi"/);
  assert.doesNotMatch(h, /data-act="buy"/);
});

test('...and once today\'s claim is made, is told when the next one comes', () => {
  const h = gated({ owned: [], balance: '5', ubi: { entitlementG: '0', canClaim: false, nextClaimAt: 90 * 60_000 } });
  assert.doesNotMatch(h, /data-act="buy"|data-act="ubi"/);
  assert.match(h, /next free G\$ .*1h 30m/i);
});

test('a balance that rounds up to the price is still short of it', () => {
  const h = gated({ owned: [], balance: '19.999', ubi: { entitlementG: '0', canClaim: false, nextClaimAt: null } });
  assert.doesNotMatch(h, /data-act="buy"/);
  assert.match(h, /Your G\$: <b>19\.99<\/b>/);
});

test('with the balance unknown the purchase is offered (the wallet checks it before anything is sent)', () => {
  assert.match(gated({ owned: [], balance: null }), /data-act="buy"/);
});

test('a blade payment on its way replaces the buy button', () => {
  const h = gated({ owned: [], awaiting: { ubi: null, bounty: null, spoils: {}, shop: { iron_starter: H } } });
  assert.doesNotMatch(h, /data-act="buy"/);
  assert.match(h, /waiting for the network/i);
  assert.match(h, /VIEW TRANSACTION/);
});

test('a verified human with a blade gets PLAY at step four', () => {
  const h = gated({});
  assert.match(h, /gd-step-done[^<]*>[^<]*3\. Buy your blade/);
  assert.match(h, /gd-step-now[^<]*>[^<]*4\. Play ENDLESS MODE/);
  assert.match(h, /data-act="play"/);
});

test('a server with no Moon Shop keeps the three-step way in: the first blade is free', () => {
  const h = gated({ shop: { enabled: false, token: SHOP.token, vault: null, items: [] }, owned: [] });
  assert.doesNotMatch(h, /Buy your blade/);
  assert.match(h, /3\. Play ENDLESS MODE/);
  assert.match(h, /data-act="play"/);
});

test('while a verified player\'s blade is being looked up, the gate says so', () => {
  assert.match(gated({ owned: null }), /Checking your blade/);
  assert.match(gated({ owned: null }), /gd-step-now[^<]*>[^<]*3\./);
});

test('the item name and price from the server are escaped', () => {
  const h = gated({ owned: [], shop: { ...SHOP, items: [{ ...BLADE, name: '<img src=x>', priceG: '20<b>' }] } });
  assert.doesNotMatch(h, /<img src=x>|20<b>/);
});

test('a verified player sees the G$ in their wallet in the panel', () => {
  assert.match(html(), /Your G\$: <b>57\.5<\/b>/);
});

/* ---- prizes switched off on the server (PRIZES_ENABLED): nothing promises them ---- */

test('with prizes off the panel shows no Shard harvest and no Spoils section', () => {
  for (const prizes of [false, null]) {
    const h = html({ prizes, spoils: [] });
    assert.doesNotMatch(h, /Shards today/, String(prizes));
    assert.doesNotMatch(h, /<h4>SPOILS<\/h4>/, String(prizes));
    assert.doesNotMatch(h, /top 3/i, String(prizes));
    assert.match(h, /CLAIM DAILY G\$/, 'the daily claim is GoodDollar\'s, not a prize: it stays');
    assert.match(h, /FIRST-BOSS BOUNTY/, 'so does the bounty');
  }
});

test('...but Spoils a player already won stay listed, and redeemable', () => {
  const h = html({ prizes: false });
  assert.match(h, /<h4>SPOILS<\/h4>/);
  assert.match(h, /data-act="redeem" data-id="7"/);
});

test('with prizes off the blade step says where the G$ goes without promising daily prizes', () => {
  const h = gated({ prizes: false, owned: [] });
  assert.match(h, /prize vault/i);
  assert.doesNotMatch(h, /daily prizes/i);
  assert.match(gated({ prizes: true, owned: [] }), /daily prizes/i, 'with prizes on, it says what the vault pays');
});
