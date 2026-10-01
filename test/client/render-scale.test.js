import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRenderScale, pixelBudget, MAX_RENDER_SCALE } from '../../src/engine/renderScale.js';

/*
 * The game world is 480 x 270 (or 480 x 440 in portrait). The drawing buffer is rendered N times larger so text and
 * art are sharp on the player's real screen. N must be big enough that the browser only ever scales the picture
 * DOWN, and small enough that a phone keeps its frame rate.
 */

const LANDSCAPE = { baseWidth: 480, baseHeight: 270 };
const PORTRAIT = { baseWidth: 480, baseHeight: 440 };
const desktop = pixelBudget(false);
const phone = pixelBudget(true);

test('a laptop window at 2x density gets a buffer that covers every device pixel', () => {
  // 1000 CSS px x 2 = 2000 device px -> 4.17x -> 5x
  assert.equal(chooseRenderScale({ cssWidth: 1000, dpr: 2, ...LANDSCAPE, budgetPixels: desktop }), 5);
});

test('an exact multiple does not round up', () => {
  assert.equal(chooseRenderScale({ cssWidth: 1440, dpr: 1, ...LANDSCAPE, budgetPixels: desktop }), 3);
  assert.equal(chooseRenderScale({ cssWidth: 480, dpr: 1, ...LANDSCAPE, budgetPixels: desktop }), 1);
});

test('a small window at 1x stays at 1x', () => {
  assert.equal(chooseRenderScale({ cssWidth: 400, dpr: 1, ...LANDSCAPE, budgetPixels: desktop }), 1);
});

test('a portrait phone (the canvas is narrower than the logical width) still gets a sharp buffer', () => {
  // 390 CSS px at 3x = 1170 device px -> 2.44x -> 3x; 1440 x 1320 is well inside the budget
  assert.equal(chooseRenderScale({ cssWidth: 390, dpr: 3, ...PORTRAIT, budgetPixels: phone }), 3);
});

test('a landscape phone is held to the pixel budget instead of rendering millions of extra pixels', () => {
  // 693 CSS px at 3x = 2079 device px would want 5x (2400 x 1350 = 3.2 MP); the budget settles on 4x
  const s = chooseRenderScale({ cssWidth: 693, dpr: 3, ...LANDSCAPE, budgetPixels: phone });
  assert.equal(s, 4);
  assert.ok(480 * s * 270 * s <= phone);
});

test('huge screens are capped', () => {
  const s = chooseRenderScale({ cssWidth: 2560, dpr: 2, ...LANDSCAPE, budgetPixels: desktop });
  assert.ok(s <= MAX_RENDER_SCALE);
  assert.ok(480 * s * 270 * s <= desktop);
});

test('missing or nonsensical measurements fall back to 1x instead of NaN', () => {
  for (const cssWidth of [0, NaN, undefined, -5]) {
    assert.equal(chooseRenderScale({ cssWidth, dpr: 2, ...LANDSCAPE, budgetPixels: desktop }), 1);
  }
  assert.equal(chooseRenderScale({ cssWidth: 800, dpr: undefined, ...LANDSCAPE, budgetPixels: desktop }), 2);
});

test('phones get a smaller pixel budget than desktops', () => {
  assert.ok(pixelBudget(true) < pixelBudget(false));
});
