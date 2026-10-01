import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTextStyle, PIXEL_FONT, BODY_FONT } from '../../src/engine/typography.js';

/*
 * The game's scenes write their text styles for a tiny canvas (`fontFamily: 'Press Start 2P'`, 4.5px ... 14px).
 * A canvas silently IGNORES a font whose family is not quoted, which turned every text in the game into 10px
 * sans-serif. This is the one place that turns what a scene asks for into a font the canvas will actually use.
 */

test('a family with spaces and a digit is quoted, so the canvas accepts it', () => {
  const out = resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: '13px' });
  assert.equal(out.fontFamily, PIXEL_FONT);
  assert.match(out.fontFamily, /^"Press Start 2P"/);
  assert.equal(out.fontSize, '13px');
});

test('headings keep the pixel font at the size the scene asked for', () => {
  for (const size of ['8px', '10px', '11px', '14px', '20px']) {
    const out = resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: size });
    assert.equal(out.fontFamily, PIXEL_FONT, size);
    assert.equal(out.fontSize, size, size);
  }
});

test('captions too small for the pixel font to stay legible use the readable small font instead', () => {
  for (const size of ['4px', '4.5px', '5px', '5.5px', '6px']) {
    const out = resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: size });
    assert.equal(out.fontFamily, BODY_FONT, size);
    assert.ok(parseFloat(out.fontSize) > parseFloat(size) * 1.8, `${size} -> ${out.fontSize}`);
  }
});

test('the bigger a caption was meant to be, the bigger it stays (hierarchy is preserved)', () => {
  const sizes = ['4px', '4.5px', '5px', '5.5px', '6px', '6.5px'].map((s) => parseFloat(resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: s }).fontSize));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], sizes.join(','));
});

test('a numeric size, a missing size and odd input are handled', () => {
  assert.equal(resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: 12 }).fontSize, '12px');
  assert.equal(resolveTextStyle({ fontFamily: 'Press Start 2P' }).fontFamily, PIXEL_FONT);
  assert.deepEqual(resolveTextStyle(undefined), {});
  assert.deepEqual(resolveTextStyle('nonsense'), {});
  assert.equal(resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: 'big' }).fontFamily, PIXEL_FONT);
});

test('other families are quoted when they need it and otherwise left alone', () => {
  assert.equal(resolveTextStyle({ fontFamily: 'Arial', fontSize: '9px' }).fontFamily, 'Arial');
  assert.equal(resolveTextStyle({ fontFamily: 'Comic Sans MS', fontSize: '9px' }).fontFamily, '"Comic Sans MS"');
  assert.equal(resolveTextStyle({ fontFamily: '"Press Start 2P", monospace', fontSize: '9px' }).fontFamily, PIXEL_FONT);
  assert.equal(resolveTextStyle({ fontFamily: "'VT323', monospace", fontSize: '12px' }).fontFamily, "'VT323', monospace");
});

test('resolving twice gives the same answer as resolving once', () => {
  for (const size of ['4.5px', '7px', '13px']) {
    const once = resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: size });
    assert.deepEqual(resolveTextStyle(once), once, size);
  }
});

test('an outline is never allowed to swallow small letters', () => {
  const heavy = resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: '4.5px', stroke: '#000', strokeThickness: 3 });
  assert.ok(heavy.strokeThickness <= parseFloat(heavy.fontSize) * 0.25 + 1e-9, `${heavy.strokeThickness} on ${heavy.fontSize}`);
  const fine = resolveTextStyle({ fontFamily: 'Press Start 2P', fontSize: '14px', stroke: '#000', strokeThickness: 3 });
  assert.equal(fine.strokeThickness, 3);
});

test('everything else in the style passes through untouched', () => {
  const style = { fontFamily: 'Press Start 2P', fontSize: '7px', color: '#fff', align: 'center', wordWrap: { width: 120 }, lineSpacing: 3, letterSpacing: 2 };
  const out = resolveTextStyle(style);
  for (const key of ['color', 'align', 'wordWrap', 'lineSpacing', 'letterSpacing']) assert.deepEqual(out[key], style[key], key);
  assert.equal(style.fontSize, '7px', 'the caller\'s object is not mutated');
});
