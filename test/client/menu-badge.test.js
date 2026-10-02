import test from 'node:test';
import assert from 'node:assert/strict';
import { menuBadgeText } from '../../src/ui/menuBadge.js';

/*
 * The line under the title on the menu says where the player stands on the way into the game (the same five steps the
 * verified-human gate uses), so a visitor is not invited to "earn G$" by a game that will not let them in yet.
 */

const SHOP = { enabled: true, items: [{ id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null }] };
const status = (over = {}) => ({
  connected: true, verified: true, status: 'verified', offline: false, shortAddress: '0x12ab…ef90', ubi: null, shop: SHOP, owned: ['iron_starter'], ...over,
});

test('a visitor is told to connect and verify in order to play', () => {
  const text = menuBadgeText(status({ connected: false, verified: false, status: 'anonymous', shortAddress: '' }));
  assert.match(text, /CONNECT/);
  assert.match(text, /VERIFY/);
  assert.match(text, /PLAY/);
});

test('a connected player who is not verified is told to verify to play', () => {
  const text = menuBadgeText(status({ verified: false, status: 'unverified' }));
  assert.match(text, /VERIFY/);
  assert.match(text, /PLAY/);
  assert.doesNotMatch(text, /CONNECT/, 'they are connected already');
});

test('an expired verification asks for a new one, not a first one', () => {
  assert.match(menuBadgeText(status({ verified: false, status: 'expired' })), /RE-VERIFY/);
  assert.doesNotMatch(menuBadgeText(status({ verified: false, status: 'unverified' })), /RE-VERIFY/);
});

test('while the server is still answering the badge says it is checking, and if it never answers, that it cannot reach it', () => {
  assert.match(menuBadgeText(status({ verified: false, status: 'unknown' })), /CHECKING/);
  const text = menuBadgeText(status({ verified: false, status: 'unknown', offline: true }));
  assert.match(text, /SERVER/);
  assert.doesNotMatch(text, /VERIFY YOU ARE HUMAN/, 'we do not know that they are unverified');
});

test('a verified human sees their address, or that the daily G$ can be claimed', () => {
  assert.equal(menuBadgeText(status()), '✔ VERIFIED • 0x12ab…ef90');
  assert.match(menuBadgeText(status({ ubi: { canClaim: true } })), /DAILY G\$ READY/);
  assert.doesNotMatch(menuBadgeText(status({ ubi: { canClaim: false } })), /DAILY G\$ READY/);
});

test('a verified human with no blade yet is told to buy it, with its price in G$', () => {
  const text = menuBadgeText(status({ owned: [] }));
  assert.match(text, /BLADE/);
  assert.match(text, /20 G\$/);
  assert.match(menuBadgeText(status({ owned: null })), /CHECKING YOUR BLADE/);
});

test('a verified player who is offline still sees the verified line (they can play; only the checks are stale)', () => {
  assert.match(menuBadgeText(status({ offline: true })), /VERIFIED/);
});

test('every line fits the title banner on the narrowest canvas', () => {
  const cases = [
    status({ connected: false, verified: false, status: 'anonymous', shortAddress: '' }),
    status({ verified: false, status: 'unverified' }),
    status({ verified: false, status: 'expired' }),
    status({ verified: false, status: 'unknown' }),
    status({ verified: false, status: 'unknown', offline: true }),
    status(),
    status({ ubi: { canClaim: true } }),
    status({ owned: [] }),
    status({ owned: [], shop: { ...SHOP, items: [{ ...SHOP.items[0], priceG: '1500' }] } }),
    status({ owned: null }),
  ];
  for (const s of cases) {
    const text = menuBadgeText(s);
    assert.ok(text.length <= 40, `${text} (${text.length} characters)`);
  }
});
