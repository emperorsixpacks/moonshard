import test from 'node:test';
import assert from 'node:assert/strict';
import { GATED_SCENES, blocksStart, canPlay, gateLabel, gateStep } from '../../src/engine/playGateRules.js';

/*
 * Owner decision: a player must be a verified human (GoodDollar face verification, one human per slot) BEFORE they can
 * start playing. The rules for that, as pure functions of the wallet service's status.
 */

const status = (over = {}) => ({ connected: true, verified: true, status: 'verified', offline: false, ...over });

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

test('a verified human is through', () => {
  assert.equal(gateStep(status()), 'ready');
  assert.equal(canPlay(status()), true);
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
