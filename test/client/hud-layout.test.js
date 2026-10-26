import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutHud, estimateWidth } from '../../src/ui/hudLayout.js';

/*
 * The in-game HUD bar: what goes where, at which type size, on every screen. The same content has to fit a desktop
 * window, a phone held sideways and a phone held upright without overlapping, and stay readable on each.
 */

const SCREENS = { desktop: 2.08, phoneSideways: 1.44, phoneUpright: 0.813, smallPhoneUpright: 0.75 };
const STORY = {
  title: 'CH.5: The Lunar Spire',
  titleLong: 'CH.1: Whispering Woods',
  objective: 'OBJECTIVE: Cleanse Guardian Obelisk',
  materials: '🌲25 🍯15 ⚙️10',
  harvest: '💎 +100 G$',
};
const SURVIVAL = { mode: 'ENDLESS MODE', score: 'SCORE: 1234567', wave: 'LEVEL 100', foes: 'FOES: 34', harvest: '💎 100 G$ (MAX 🔒)' };

const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The rectangle a text occupies, given the slot it was placed in. */
function textRect(hud, slot, text) {
  const size = parseFloat((slot.face === 'pixel' ? hud.fonts.label : hud.fonts.value).fontSize);
  const w = estimateWidth(text, size, slot.face);
  const x0 = slot.ox === 1 ? slot.x - w : slot.x;
  return { x0, x1: x0 + w, y0: slot.y - size / 2, y1: slot.y + size / 2 };
}

function rectsFor(hud, content) {
  const rects = Object.fromEntries(Object.entries(content).map(([name, text]) => [name, textRect(hud, hud.slots[name], text)]));
  rects.health = {
    x0: hud.health.x - hud.healthW / 2, x1: hud.health.x + hud.healthW / 2,
    y0: hud.health.y - hud.healthH / 2, y1: hud.health.y + hud.healthH / 2,
  };
  return rects;
}

function assertNoCollisions(rects, where, screenWidth = 480) {
  const names = Object.keys(rects);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.equal(overlap(rects[names[i]], rects[names[j]]), false, `${names[i]} overlaps ${names[j]} (${where})`);
    }
    assert.ok(rects[names[i]].x0 >= 0 && rects[names[i]].x1 <= screenWidth, `${names[i]} is inside the screen (${where})`);
  }
}

for (const [name, unit] of Object.entries(SCREENS)) {
  test(`${name}: type is readable and the rows fit inside the bar`, () => {
    const hud = layoutHud({ unit, width: 480 });
    assert.ok(parseFloat(hud.fonts.label.fontSize) * unit >= 9.8, `label ${hud.fonts.label.fontSize} x ${unit}`);
    assert.ok(parseFloat(hud.fonts.value.fontSize) * unit >= 11.9, `value ${hud.fonts.value.fontSize} x ${unit}`);
    assert.ok(hud.rowY[1] + hud.rowH <= hud.barH, 'second row inside the bar');
    assert.ok(hud.barH <= 56, 'the bar does not eat the play field');
  });

  test(`${name}: the story HUD content does not collide`, () => {
    const hud = layoutHud({ unit, width: 480, variant: 'story' });
    for (const title of [STORY.title, STORY.titleLong]) {
      for (const objective of [STORY.objective, 'OBJECTIVE: Defeat Foes (0/16)', 'OBJECTIVE: Defeat Archmage Malakor!']) {
        assertNoCollisions(rectsFor(hud, { title, objective, materials: STORY.materials, harvest: STORY.harvest }), `${name}: ${title} / ${objective}`);
      }
    }
  });

  test(`${name}: the endless HUD content does not collide`, () => {
    const hud = layoutHud({ unit, width: 480, variant: 'survival' });
    assertNoCollisions(rectsFor(hud, SURVIVAL), name);
    assertNoCollisions(rectsFor(hud, { ...SURVIVAL, wave: 'LEVEL 1', harvest: '💎 +0 G$', score: 'SCORE: 0', foes: 'FOES: 0' }), `${name} (short)`);
  });
}

test('a desktop bar stays the compact original height; an upright phone gets a little more room', () => {
  assert.ok(layoutHud({ unit: 2.08, width: 480 }).barH <= 36);
  assert.ok(layoutHud({ unit: 0.813, width: 480, portrait: true }).barH > layoutHud({ unit: 2.08, width: 480 }).barH);
});

test('width estimates follow the two typefaces', () => {
  assert.equal(estimateWidth('ABCDE', 10, 'pixel'), 50);
  assert.ok(Math.abs(estimateWidth('ABCDE', 10, 'body') - 20) < 1e-9);
  assert.ok(estimateWidth('💎 1', 10, 'body') > estimateWidth('x 1', 10, 'body'), 'emoji are wide');
});

// A run held upright is narrower than the other screens (engine/playStage.js): the same content has to fit there too.
for (const width of [360, 400]) {
  const unit = 390 / width; // CSS px per game unit on a 390-wide phone
  test(`a ${width}-wide upright run: the story HUD content does not collide and stays on screen`, () => {
    const hud = layoutHud({ unit, width, variant: 'story' });
    for (const title of [STORY.title, STORY.titleLong]) {
      for (const objective of [STORY.objective, 'OBJECTIVE: Defeat Foes (0/16)', 'OBJECTIVE: Defeat Archmage Malakor!']) {
        assertNoCollisions(rectsFor(hud, { title, objective, materials: STORY.materials, harvest: STORY.harvest }), `${width}: ${title} / ${objective}`, width);
      }
    }
  });

  test(`a ${width}-wide upright run: the endless HUD content does not collide and stays on screen`, () => {
    const hud = layoutHud({ unit, width, variant: 'survival' });
    assertNoCollisions(rectsFor(hud, SURVIVAL), `${width}`, width);
    assertNoCollisions(rectsFor(hud, { ...SURVIVAL, wave: 'LEVEL 1', harvest: '💎 +0 G$', score: 'SCORE: 0', foes: 'FOES: 0' }), `${width} (short)`, width);
  });
}
