import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, chapterRows, chipModel, playModel } from '../../src/ui/menuModel.js';

/*
 * The menu has two things that change with the player: the wallet chip, and the one big button. They follow the same five
 * steps the verified-human gate uses, so a visitor is never invited to play by a game that will not let them in yet.
 */

const SHOP = { enabled: true, items: [{ id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null }] };
const status = (over = {}) => ({
  connected: true, verified: true, status: 'verified', offline: false, shortAddress: '0x12ab…ef90', balance: null, ubi: null, shop: SHOP, owned: ['iron_starter'], ...over,
});
const visitor = () => status({ connected: false, verified: false, status: 'anonymous', shortAddress: '' });
const DONE = { tutorialDone: true, furthest: 1 };

// ---- the chip ------------------------------------------------------------------------------------------------------------

test('a visitor sees a quiet "Connect" chip', () => {
  assert.deepEqual(chipModel(visitor()), { text: 'Connect', dim: true, verified: false, claimReady: false });
  assert.equal(chipModel(undefined).text, 'Connect');
});

test('a connected player who is not verified sees their address, with no tick', () => {
  const chip = chipModel(status({ verified: false, status: 'unverified' }));
  assert.equal(chip.text, '0x12ab…ef90');
  assert.equal(chip.verified, false);
  assert.equal(chip.dim, false);
});

test('a verified player sees their balance rounded down, so a shown 20 can always pay 20', () => {
  assert.equal(chipModel(status({ balance: 216.779 })).text, '216.77 G$');
  assert.equal(chipModel(status({ balance: 19.999 })).text, '19.99 G$');
  assert.equal(chipModel(status({ balance: 1234.5 })).text, '1,234.5 G$');
  assert.equal(chipModel(status({ balance: 216.77 })).verified, true);
});

test('until the balance is known the chip says only G$', () => {
  assert.equal(chipModel(status({ balance: null })).text, 'G$');
});

test('the daily claim is signalled only to a verified player who can claim', () => {
  assert.equal(chipModel(status({ ubi: { canClaim: true } })).claimReady, true);
  assert.equal(chipModel(status({ ubi: { canClaim: false } })).claimReady, false);
  assert.equal(chipModel(status({ verified: false, status: 'unverified', ubi: { canClaim: true } })).claimReady, false);
});

// ---- the big button ------------------------------------------------------------------------------------------------------

test('a player who has not done the tutorial goes there first, and no wallet is needed', () => {
  for (const s of [visitor(), status(), status({ owned: [] })]) {
    const play = playModel(s, { tutorialDone: false, furthest: 1 });
    assert.equal(play.action, 'tutorial');
    assert.match(play.sub, /No wallet needed/);
  }
});

test('after the tutorial a visitor is told to connect, and the button opens the gate', () => {
  const play = playModel(visitor(), DONE);
  assert.equal(play.action, 'gate');
  assert.match(play.sub, /Connect/);
});

test('a connected player who is not verified is told to verify; an expired verification asks for a new one, not a first one', () => {
  assert.match(playModel(status({ verified: false, status: 'unverified' }), DONE).sub, /face scan/);
  assert.match(playModel(status({ verified: false, status: 'expired' }), DONE).sub, /Verify again/);
  assert.doesNotMatch(playModel(status({ verified: false, status: 'unverified' }), DONE).sub, /again/);
});

test('while the server is still answering the button says so, and if it never answers, that it cannot reach it', () => {
  assert.match(playModel(status({ verified: false, status: 'unknown' }), DONE).sub, /Checking/);
  const offline = playModel(status({ verified: false, status: 'unknown', offline: true }), DONE);
  assert.match(offline.sub, /server/i);
  assert.doesNotMatch(offline.sub, /face scan/, 'we do not know that they are unverified');
});

test('a verified human with no blade is told to buy it, with its price in G$', () => {
  const play = playModel(status({ owned: [] }), DONE);
  assert.equal(play.action, 'gate');
  assert.match(play.sub, /blade/);
  assert.match(play.sub, /20 G\$/);
  assert.match(playModel(status({ owned: null }), DONE).sub, /Checking your blade/);
});

test('a player who is all the way in is sent to the story: Play the first time, Continue after', () => {
  const first = playModel(status(), DONE);
  assert.deepEqual([first.title, first.action, first.sub], ['Play', 'story', 'Chapter 1: Whispering Woods']);
  const later = playModel(status(), { tutorialDone: true, furthest: 3 });
  assert.deepEqual([later.title, later.action, later.sub], ['Continue', 'story', 'Chapter 3: The Sunken Ruins']);
});

test('a verified player who is offline is still sent to the story (they can play; only the checks are stale)', () => {
  assert.equal(playModel(status({ offline: true }), DONE).action, 'story');
});

test('every line fits the big button on the narrowest phone', () => {
  const cases = [
    visitor(),
    status({ verified: false, status: 'unverified' }),
    status({ verified: false, status: 'expired' }),
    status({ verified: false, status: 'unknown' }),
    status({ verified: false, status: 'unknown', offline: true }),
    status({ owned: [] }),
    status({ owned: [], shop: { ...SHOP, items: [{ ...SHOP.items[0], priceG: '1500' }] } }),
    status({ owned: null }),
  ];
  for (const s of cases) {
    const { sub } = playModel(s, DONE);
    assert.ok(sub.length <= 36, `${sub} (${sub.length} characters)`);
  }
  for (const c of CHAPTERS.slice(1)) {
    const { sub } = playModel(status(), { tutorialDone: true, furthest: c.n });
    assert.ok(sub.length <= 36, `${sub} (${sub.length} characters)`);
  }
});

test('a chapter that does not exist is clamped, never undefined', () => {
  assert.equal(playModel(status(), { tutorialDone: true, furthest: 9 }).sub, 'Chapter 5: The Lunar Spire');
  assert.equal(playModel(status(), { tutorialDone: true, furthest: 0 }).sub, 'Chapter 1: Whispering Woods');
});

// ---- the chapter list ----------------------------------------------------------------------------------------------------

test('the Prologue and the first chapter are always open; the others open one after another', () => {
  const rows = chapterRows((n) => n <= 2);
  assert.deepEqual(rows.map((r) => r.open), [true, true, true, false, false, false]);
  assert.equal(rows[3].note, 'Finish chapter 2 to unlock');
  assert.equal(rows[1].note, CHAPTERS[1].desc);
});
