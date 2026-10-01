import test from 'node:test';
import assert from 'node:assert/strict';
import { cssPerUnitOf, legibleSizeFor, isTallCanvas } from '../../src/engine/uiScale.js';

/*
 * The game is drawn in game units (480 wide). How big a unit looks depends on the screen: about 2-3 CSS pixels on a
 * desktop, 1.4 on a phone held sideways, 0.8 on a phone held upright. Text sized in units alone is therefore
 * comfortable on a desktop and too small to read on an upright phone.
 */

const scene = (displayWidth, gameWidth, gameHeight) => ({
  scale: { displaySize: { width: displayWidth }, gameSize: { width: gameWidth, height: gameHeight }, height: gameHeight },
});

test('CSS pixels per game unit follow the size the canvas is shown at', () => {
  assert.equal(cssPerUnitOf(scene(1000, 480, 270)).toFixed(2), '2.08');
  assert.equal(cssPerUnitOf(scene(693, 480, 270)).toFixed(2), '1.44');
  assert.equal(cssPerUnitOf(scene(390, 480, 440)).toFixed(2), '0.81');
});

test('a missing or zero size falls back to 1 instead of dividing by zero', () => {
  assert.equal(cssPerUnitOf(undefined), 1);
  assert.equal(cssPerUnitOf({}), 1);
  assert.equal(cssPerUnitOf(scene(0, 480, 270)), 1);
  assert.equal(cssPerUnitOf(scene(NaN, 480, 270)), 1);
});

test('a size that is already big enough on screen is left alone', () => {
  assert.equal(legibleSizeFor(10, 2.08, 9), 10);
  assert.equal(legibleSizeFor(12, 0.81, 9), 12);
});

test('a size too small to read on screen is raised just enough', () => {
  // 7 units on an upright phone is 5.7 CSS px: it needs 9 / 0.813 = 11.07 units
  assert.equal(legibleSizeFor(7, 0.813, 9).toFixed(1), '11.1');
  assert.equal(legibleSizeFor(4.5, 1.44, 9).toFixed(2), '6.25');
});

test('the boost is capped so a layout is never asked to grow without limit', () => {
  assert.equal(legibleSizeFor(5, 0.3, 9, { maxBoost: 1.6 }), 8);
  assert.equal(legibleSizeFor(5, 0.3, 9), 5 * 2);
});

test('sizes come back rounded to half a unit so text stays crisp', () => {
  assert.equal(legibleSizeFor(7, 0.813, 9, { round: true }), 11);
  assert.equal(legibleSizeFor(7, 0.7, 9, { round: true }), 13);
});

test('the tall (portrait) canvas is recognised by its height', () => {
  assert.equal(isTallCanvas(scene(390, 480, 440)), true);
  assert.equal(isTallCanvas(scene(1000, 480, 270)), false);
  assert.equal(isTallCanvas(undefined), false);
});
