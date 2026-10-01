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

/* ---- the safety net: a device that cannot keep up gets a smaller buffer ---- */

import { adaptRenderScale } from '../../src/engine/renderScale.js';

test('a healthy frame rate changes nothing and clears earlier bad samples', () => {
  assert.deepEqual(adaptRenderScale({ fps: 60, scale: 5, strikes: 2 }), { scale: 5, strikes: 0, changed: false });
});

test('a few slow samples are tolerated, a sustained run of them steps the buffer down one notch', () => {
  let state = { scale: 5, strikes: 0 };
  for (let i = 0; i < 3; i++) {
    state = adaptRenderScale({ fps: 22, ...state });
    assert.equal(state.changed, false);
  }
  state = adaptRenderScale({ fps: 22, ...state });
  assert.deepEqual(state, { scale: 4, strikes: 0, changed: true });
});

test('it never goes below the floor, so a device that is slow at 1x is left alone', () => {
  const state = adaptRenderScale({ fps: 10, scale: 1, strikes: 99 });
  assert.equal(state.scale, 1);
  assert.equal(state.changed, false);
  assert.equal(adaptRenderScale({ fps: 10, scale: 2, strikes: 99 }, { floor: 2 }).scale, 2);
});

test('a missing or nonsensical frame rate is ignored rather than counted against the device', () => {
  for (const fps of [undefined, NaN, 0, -5]) {
    assert.deepEqual(adaptRenderScale({ fps, scale: 5, strikes: 2 }), { scale: 5, strikes: 2, changed: false });
  }
});
