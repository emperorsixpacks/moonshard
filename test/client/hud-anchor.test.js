import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAnchor } from '../../src/engine/HudAnchor.js';

/*
 * The wallet, timer and pause buttons are page elements that float over the game. They should sit against the game
 * picture (not the window edge) and, during a level, below the in-game HUD bar so they never cover its counters.
 */

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('a picture that fills the window anchors to the window corner', () => {
  const a = computeAnchor({ canvasRect: rect(0, 0, 1000, 563), viewportWidth: 1000, gameWidth: 480 });
  assert.deepEqual({ top: a.top, right: a.right }, { top: 0, right: 0 });
  assert.equal(a.unit.toFixed(3), (1000 / 480).toFixed(3));
});

test('a letterboxed picture anchors to the picture, not to the black bar', () => {
  // an 844 px wide window showing a 693 px wide picture centred: 75.5 px bars each side
  const a = computeAnchor({ canvasRect: rect(75.5, 0, 693, 390), viewportWidth: 844, gameWidth: 480 });
  assert.equal(a.right, 75.5);
  assert.equal(a.top, 0);
  assert.equal(a.unit.toFixed(3), (693 / 480).toFixed(3));
});

test('a picture lower in the window (bars above) anchors lower', () => {
  const a = computeAnchor({ canvasRect: rect(0, 10, 1000, 563), viewportWidth: 1000, gameWidth: 480 });
  assert.equal(a.top, 10);
});

test('missing or empty geometry gives harmless defaults', () => {
  for (const input of [undefined, {}, { canvasRect: rect(0, 0, 0, 0), viewportWidth: 800, gameWidth: 480 }]) {
    const a = computeAnchor(input);
    assert.deepEqual({ top: a.top, right: a.right, unit: a.unit }, { top: 0, right: 0, unit: 1 });
  }
});

test('a picture wider than the window never reports a negative gap', () => {
  const a = computeAnchor({ canvasRect: rect(-20, 0, 1040, 585), viewportWidth: 1000, gameWidth: 480 });
  assert.equal(a.right, 0);
});
