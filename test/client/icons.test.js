import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, ico, moonSvg } from '../../src/ui/icons.js';

/* The interface's pixel icons are drawn by code: every one must come out as a clean, closed picture. */

test('there is a set of icons, and every one draws as an svg with pixels in it', () => {
  assert.ok(ICON_NAMES.length >= 20);
  for (const name of ICON_NAMES) {
    const svg = ico(name, 24);
    assert.match(svg, /^<svg /, name);
    assert.ok((svg.match(/<rect /g) || []).length > 3, `${name} has pixels`);
    assert.match(svg, /shape-rendering="crispEdges"/, name);
  }
});

test('an icon keeps its proportions at the size asked for', () => {
  const svg = ico('sword', 64);
  assert.match(svg, /width="64\.0" height="64\.0"/);
  const shard = ico('shard', 18); // nine pixels square
  assert.match(shard, /width="18\.0" height="18\.0"/);
});

test('an unknown icon is an error, not a blank', () => {
  assert.throws(() => ico('no-such-icon'), /unknown icon/);
});

test('single-colour glyphs follow the text colour; item icons carry their own colours', () => {
  assert.match(ico('gear'), /fill="currentColor"/);
  assert.doesNotMatch(ico('coin'), /currentColor/);
  assert.match(ico('check'), /#62D6A4/, 'the verified tick is the interface\'s one green');
});

test('the moon is a disc with a gold crack; with rank, every pixel can be revealed in turn', () => {
  const plain = moonSvg(false);
  assert.match(plain, /#FFD97A/);
  assert.doesNotMatch(plain, /data-r/);
  const ranked = moonSvg(true);
  const rects = ranked.match(/<rect /g).length;
  const ranks = [...ranked.matchAll(/data-r="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(ranks.length, rects, 'every pixel has a place in the order');
  assert.ok(ranks.every((r) => r >= 0 && r <= 1));
  assert.ok(ranked.indexOf('#FFD97A') > 0 && ranks.filter((r) => r >= 0.96).length >= 10, 'the crack comes last');
});
