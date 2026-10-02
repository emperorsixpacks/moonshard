import test from 'node:test';
import assert from 'node:assert/strict';
import { GATED_SCENES, blocksStart, canPlay, entryBlade, gateLabel, gateStep, resumesAfterScan } from '../../src/engine/playGateRules.js';

/*
 * Owner decisions: a player must be a verified human (GoodDollar face verification, one human per slot) BEFORE they can
 * start playing, and the blade their hero fights with is paid for in G$. The rules for that, as pure functions of the wallet
 * service's status.
 */

const BLADE = { id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null };
const SHOP = { enabled: true, token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', vault: '0x00000000000000000000000000000000000ba5e1', items: [
  BLADE, { id: 'skin_flame', name: 'Crimson Flame Katana', kind: 'cosmetic', priceG: '100', requires: null },
] };
const status = (over = {}) => ({ connected: true, verified: true, status: 'verified', offline: false, shop: SHOP, owned: ['iron_starter'], ...over });

test('an anonymous visitor is at step one: connect', () => {
  assert.equal(gateStep(status({ connected: false, verified: false, status: 'anonymous' })), 'connect');
  assert.equal(gateStep(status({ connected: false, verified: false, status: 'anonymous', sessionExpired: true })), 'connect');
  assert.equal(gateStep(undefined), 'connect');
});

test('a connected player who is not verified is at step two: verify', () => {
  assert.equal(gateStep(status({ verified: false, status: 'unverified' })), 'verify');
  assert.equal(gateStep(status({ verified: false, status: 'expired' })), 'verify');
});

test('while the server is still answering the player is told we are checking, and if it never answers, that we cannot reach it', () => {
  assert.equal(gateStep(status({ verified: false, status: 'unknown' })), 'checking');
  assert.equal(gateStep(status({ verified: false, status: 'unknown', offline: true })), 'unreachable');
});

test('a verified human with a blade is through', () => {
  assert.equal(gateStep(status()), 'ready');
  assert.equal(canPlay(status()), true);
});

test('a verified human without a blade is at step three: get the blade, which is paid for in G$', () => {
  for (const owned of [[], ['skin_flame']]) {
    const s = status({ owned });
    assert.equal(gateStep(s), 'blade', JSON.stringify(owned));
    assert.equal(canPlay(s), false);
    assert.equal(blocksStart('SurvivalScene', s), true);
    assert.equal(blocksStart('TutorialScene', s), true, 'the tutorial too');
  }
  assert.deepEqual(entryBlade(SHOP), BLADE);
});

test('on a server with no shop the first blade is free; a shop that sells no blade asks for none', () => {
  assert.equal(gateStep(status({ shop: { enabled: false, token: SHOP.token, vault: null, items: [] }, owned: [] })), 'ready');
  assert.equal(gateStep(status({ shop: { ...SHOP, items: [SHOP.items[1]] }, owned: [] })), 'ready');
  assert.equal(entryBlade({ ...SHOP, items: [] }), null);
});

test('until the shop and what the player owns are known, the blade is being checked; with the server unreachable, it says so', () => {
  assert.equal(gateStep(status({ shop: null })), 'checking');
  assert.equal(gateStep(status({ owned: null })), 'checking');
  assert.equal(gateStep(status({ shop: null, offline: true })), 'unreachable');
  assert.equal(gateStep(status({ owned: null, offline: true })), 'unreachable');
  assert.equal(gateStep(status({ offline: true })), 'ready', 'a known blade stays known while the server is away');
});

test('only a verified human can play; everyone else cannot', () => {
  for (const s of [
    status({ connected: false, verified: false, status: 'anonymous' }),
    status({ verified: false, status: 'unverified' }),
    status({ verified: false, status: 'expired' }),
    status({ verified: false, status: 'unknown' }),
    status({ verified: false, status: 'unknown', offline: true }),
  ]) {
    assert.equal(canPlay(s), false, JSON.stringify(s));
  }
});

test('every way into play is covered, and the places that are not play are not', () => {
  for (const key of ['StoryScene', 'StoryIntroScene', 'TutorialScene', 'SurvivalScene']) assert.ok(GATED_SCENES.has(key), key);
  for (const key of ['MenuScene', 'ForgeScene', 'LeaderboardScene', 'BootScene', 'StoryEndingScene']) assert.equal(GATED_SCENES.has(key), false, key);
});

test('starting a play scene is blocked until verified; other scenes always start', () => {
  const anon = status({ connected: false, verified: false, status: 'anonymous' });
  assert.equal(blocksStart('SurvivalScene', anon), true);
  assert.equal(blocksStart('TutorialScene', anon), true);
  assert.equal(blocksStart('StoryScene', status({ verified: false, status: 'unverified' })), true);
  assert.equal(blocksStart('LeaderboardScene', anon), false);
  assert.equal(blocksStart('ForgeScene', anon), false);
  assert.equal(blocksStart('MenuScene', anon), false);
  assert.equal(blocksStart('SurvivalScene', status()), false);
});

test('the development bypass lets test tooling start scenes, and only that', () => {
  const anon = status({ connected: false, verified: false, status: 'anonymous' });
  assert.equal(blocksStart('SurvivalScene', anon, { bypass: true }), false);
  assert.equal(blocksStart('SurvivalScene', anon, { bypass: false }), true);
});

test('each mode has a name the gate can show', () => {
  assert.equal(gateLabel('SurvivalScene'), 'ENDLESS MODE');
  assert.equal(gateLabel('StoryScene'), 'STORY MODE');
  assert.equal(gateLabel('StoryIntroScene'), 'STORY MODE');
  assert.equal(gateLabel('TutorialScene'), 'THE TUTORIAL');
  assert.equal(gateLabel('SomethingElse'), 'THE GAME');
});

test('back from the face scan as a verified human, the mode they asked for is offered again: to play, or to buy the blade first', () => {
  assert.equal(resumesAfterScan(status()), true);
  assert.equal(resumesAfterScan(status({ owned: [] })), true, 'the blade step picks up where the scan left off');
  assert.equal(resumesAfterScan(status({ verified: false, status: 'unverified' })), false, 'the scan did not go through');
  assert.equal(resumesAfterScan(status({ owned: null })), false, 'not while it is still being checked');
  assert.equal(resumesAfterScan(status({ connected: false, verified: false, status: 'anonymous' })), false);
});
