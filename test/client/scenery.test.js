import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BEASTS, REALM_ORDER, REALMS, levelPlan } from '../../src/engine/levels.js';
import {
  GRADE_ALPHA_MAX, MOOD_NAMES, PLATFORM_TEXTURES, WEATHER_KINDS, WOODS_LOOK, platformLift, sceneFor, sceneSwap,
} from '../../src/engine/scenery.js';

/*
 * What Endless looks like, level by level: every level has a scene of its own (pictures, a colour over the screen, weather), the
 * same level looks the same for everyone, and the first level is the forest as it always was. The scene (SurvivalScene) only
 * puts a scene on; these are the scenes themselves.
 */

const LEVELS = Array.from({ length: 300 }, (_, i) => i + 1);
const scenes = LEVELS.map((n) => levelPlan(n).scene);
const sourceOf = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the first level is the forest as it always was: no colour over it, no weather', () => {
  const first = levelPlan(1).scene;
  assert.equal(first.key, 'woods:0:0');
  assert.equal(first.name, 'Morning');
  assert.equal(first.grade.alpha, 0);
  assert.deepEqual(first.weather, { kind: 'none', intensity: 0, lightning: false });
  assert.equal(first.look.sky, WOODS_LOOK.sky);
  assert.equal(first.look.tint, null);
  assert.equal(first.look.skyTint, null);
  assert.equal(first.look.ground, 0xffffff);
  assert.equal(first.look.platform, 'plat_wood');
});

test('every level has a scene, and a level always has the same one', () => {
  for (const n of LEVELS) {
    const scene = levelPlan(n).scene;
    assert.ok(scene && scene.name && scene.key, `level ${n}`);
    assert.deepEqual(levelPlan(n).scene, scene, `level ${n} looks the same each time it is asked`);
  }
});

test('no two levels of the first lap look alike, and the level after any level never looks the same as it', () => {
  const lap0 = scenes.slice(0, 25);
  assert.equal(new Set(lap0.map((s) => s.key)).size, 25);
  assert.equal(new Set(lap0.map((s) => s.name)).size, 25, 'each has a name of its own');
  for (let i = 0; i + 1 < scenes.length; i++) {
    const swap = sceneSwap(scenes[i], scenes[i + 1]);
    assert.ok(swap.pictures || swap.colours || swap.weather, `level ${i + 1} to ${i + 2} is a change of scene`);
  }
});

test('a realm has five scenes, in the order its levels come, and its fifth is the boss\'s', () => {
  assert.deepEqual(Object.keys(MOOD_NAMES), REALM_ORDER);
  for (const realm of REALM_ORDER) {
    assert.equal(MOOD_NAMES[realm].length, 5, realm);
    assert.equal(new Set(MOOD_NAMES[realm]).size, 5, `${realm}: five different names`);
    assert.ok(MOOD_NAMES[realm].every((name) => name.length > 2));
    const slots = [0, 1, 2, 3, 4].map((slot) => sceneFor({ realm, slot, theme: REALMS[realm].theme }));
    assert.deepEqual(slots.map((s) => s.boss), [false, false, false, false, true]);
    assert.deepEqual(slots.map((s) => s.name), MOOD_NAMES[realm]);
  }
  // and the levels walk through them: the boss's level has the boss's scene
  for (const n of LEVELS) assert.equal(levelPlan(n).scene.boss, levelPlan(n).boss !== null && levelPlan(n).boss !== undefined, `level ${n}`);
});

test('a realm opens clear and its boss is the darkest it gets', () => {
  for (const realm of REALM_ORDER) {
    const slots = [0, 1, 2, 3, 4].map((slot) => sceneFor({ realm, slot, theme: REALMS[realm].theme }));
    assert.equal(slots[0].grade.alpha, 0, `${realm} opens with nothing over the screen`);
    const alphas = slots.map((s) => s.grade.alpha);
    assert.equal(alphas[4], Math.max(...alphas), `${realm}'s boss scene is among its darkest`);
  }
  for (const realm of REALM_ORDER.slice(1)) {
    assert.ok(sceneFor({ realm, slot: 4, theme: REALMS[realm].theme }).grade.pulse > 0, `${realm}'s boss scene pulses`);
  }
});

test('the weather is one of the known kinds, from 0 to 1, and none has no strength', () => {
  for (const scene of scenes) {
    const { kind, intensity, lightning } = scene.weather;
    assert.ok(WEATHER_KINDS.includes(kind), `${scene.key}: ${kind}`);
    assert.ok(intensity >= 0 && intensity <= 1, scene.key);
    if (kind === 'none') assert.equal(intensity, 0);
    else assert.ok(intensity > 0, `${scene.key}: some weather has some strength`);
    if (lightning) assert.equal(kind, 'rain', 'only rain has lightning');
  }
  assert.ok(WEATHER_KINDS.every((kind) => kind === 'none' || scenes.some((s) => s.weather.kind === kind)), 'every kind of weather is used somewhere');
  assert.ok(scenes.some((s) => s.weather.lightning), 'the storm has its lightning');
});

test('the colour over the screen never gets so dark the foes cannot be seen', () => {
  for (const scene of scenes) {
    const { color, alpha, pulse } = scene.grade;
    assert.ok(alpha >= 0 && alpha <= GRADE_ALPHA_MAX, `${scene.key}: ${alpha}`);
    assert.ok(Number.isInteger(color) && color >= 0 && color <= 0xffffff, scene.key);
    assert.ok(pulse >= 0 && pulse <= 0.1, `${scene.key}: a pulse is a small swing`);
  }
  assert.ok(GRADE_ALPHA_MAX <= 0.4);
});

test('coming round to a realm again it is darker and the weather heavier, a little more each lap, up to a limit', () => {
  for (const realm of REALM_ORDER) {
    for (const slot of [0, 1, 2, 3, 4]) {
      const at = (lap) => sceneFor({ realm, slot, lap, theme: REALMS[realm].theme });
      const [first, second, third, hundredth] = [at(0), at(1), at(2), at(100)];
      assert.ok(second.grade.alpha > first.grade.alpha || second.grade.alpha === GRADE_ALPHA_MAX, `${realm}:${slot} darker on lap 1`);
      assert.ok(third.grade.alpha >= second.grade.alpha, `${realm}:${slot} never lighter`);
      assert.equal(hundredth.grade.alpha, GRADE_ALPHA_MAX, `${realm}:${slot} stops at the limit`);
      assert.ok(second.weather.intensity >= first.weather.intensity && third.weather.intensity >= second.weather.intensity);
      if (first.weather.kind === 'none') assert.equal(hundredth.weather.kind, 'none', 'a lap does not make weather out of nothing');
      assert.deepEqual(second.look, first.look, 'the pictures and their tints are the same on every lap');
      assert.notEqual(second.key, first.key, 'but it is not the same scene');
    }
  }
});

test('the key of a scene names the realm, the lap and the place in it', () => {
  assert.equal(sceneFor({ realm: 'hive', slot: 2, lap: 3 }).key, 'hive:3:2');
  assert.equal(levelPlan(5).scene.key, 'woods:0:4');
  assert.equal(levelPlan(6).scene.key, 'hive:0:0');
  assert.equal(levelPlan(25).scene.key, 'spire:0:4');
  assert.equal(levelPlan(26).scene.key, 'hive:1:0', 'the second lap comes back to the hive');
  assert.notEqual(levelPlan(6).scene.key, levelPlan(26).scene.key);
});

test('a place past the end, below the start, or in a realm that is not known is the nearest real one, never a crash', () => {
  assert.equal(sceneFor({ realm: 'hive', slot: 99 }).slot, 4);
  assert.equal(sceneFor({ realm: 'hive', slot: -3 }).slot, 0);
  assert.equal(sceneFor({ realm: 'hive', slot: 'x' }).slot, 0);
  assert.equal(sceneFor({ realm: 'hive', slot: 1.9 }).slot, 1);
  assert.equal(sceneFor({ realm: 'nowhere', slot: 1 }).name, MOOD_NAMES.woods[1]);
  assert.equal(sceneFor({ realm: 'hive', slot: 1, lap: -2 }).lap, 0);
  assert.equal(sceneFor({ realm: 'hive', slot: 1, lap: NaN }).lap, 0);
});

test('only the woods\' sky is coloured by the hour; the other realms\' skies are painted for the place', () => {
  const woods = [0, 1, 2, 3, 4].map((slot) => sceneFor({ realm: 'woods', slot }));
  assert.equal(woods[0].look.skyTint, null);
  assert.ok(woods.slice(1).every((s) => s.look.skyTint !== null), 'mist, storm, dusk and night colour the sky');
  for (const realm of REALM_ORDER.slice(1)) {
    for (const slot of [0, 1, 2, 3, 4]) assert.equal(sceneFor({ realm, slot, theme: REALMS[realm].theme }).look.skyTint, null, `${realm}:${slot}`);
  }
});

// ---- the pictures --------------------------------------------------------------------------------------------------------

test('each realm\'s arena has its own platforms, and a branch is drawn a little higher', () => {
  assert.deepEqual(Object.keys(PLATFORM_TEXTURES), REALM_ORDER);
  assert.equal(new Set(Object.values(PLATFORM_TEXTURES)).size, 5, 'five realms, five kinds of platform');
  for (const n of LEVELS) assert.equal(levelPlan(n).scene.look.platform, PLATFORM_TEXTURES[levelPlan(n).realm], `level ${n}`);
  assert.equal(platformLift('plat_branch'), -2);
  assert.equal(platformLift('plat_stone'), 0);
});

test('every picture a scene asks for is loaded by the boot scene, and its file is there', () => {
  const boot = sourceOf('src/scenes/BootScene.js');
  const names = new Set([WOODS_LOOK.sky, WOODS_LOOK.bush, ...Object.values(PLATFORM_TEXTURES)]);
  for (const realm of REALM_ORDER.slice(1)) {
    const theme = REALMS[realm].theme;
    names.add(theme.sky);
    if (theme.bush) names.add(theme.bush);
    for (const tree of theme.trees ?? []) names.add(tree);
  }
  assert.ok(names.size >= 14);
  for (const name of names) {
    const loaded = boot.match(new RegExp(`this\\.load\\.image\\('${name}', '([^']+)'\\)`));
    assert.ok(loaded, `${name} is loaded in BootScene`);
    assert.ok(fs.existsSync(new URL(`../../public/${loaded[1]}`, import.meta.url)), `${loaded[1]} exists`);
  }
  assert.match(boot, /generateTexture\('mist_puff'/, 'the mist is a texture the boot scene makes');
});

test('every beast lives in a realm that has scenes, so the places and the foes agree', () => {
  for (const beast of Object.values(BEASTS)) assert.ok(MOOD_NAMES[beast.home], beast.name);
});

// ---- changing from one scene to the next --------------------------------------------------------------------------------

test('the first scene of a run puts everything on', () => {
  assert.deepEqual(sceneSwap(null, levelPlan(1).scene), { pictures: true, colours: true, weather: true });
  assert.deepEqual(sceneSwap(undefined, levelPlan(9).scene), { pictures: true, colours: true, weather: true });
});

test('the same scene changes nothing', () => {
  for (const n of [1, 5, 6, 17, 25, 26, 99]) assert.deepEqual(sceneSwap(levelPlan(n).scene, levelPlan(n).scene), { pictures: false, colours: false, weather: false });
});

test('a change of hour in a realm is colour and weather, cut to under no curtain: the pictures stay', () => {
  const swap = sceneSwap(levelPlan(1).scene, levelPlan(2).scene); // Morning to Drifting Mist
  assert.deepEqual(swap, { pictures: false, colours: true, weather: true });
  assert.deepEqual(sceneSwap(levelPlan(7).scene, levelPlan(8).scene).pictures, false, 'hive to hive');
});

test('a new realm is a new picture: the sky, the platforms and what grows are cut to under the curtain', () => {
  assert.equal(sceneSwap(levelPlan(5).scene, levelPlan(6).scene).pictures, true, 'woods to hive');
  assert.equal(sceneSwap(levelPlan(10).scene, levelPlan(11).scene).pictures, true, 'hive to ruins');
  assert.equal(sceneSwap(levelPlan(25).scene, levelPlan(26).scene).pictures, true, 'spire to the hive again');
  for (let n = 5; n < 25; n += 5) assert.equal(sceneSwap(levelPlan(n).scene, levelPlan(n + 1).scene).pictures, true, `level ${n} to ${n + 1}`);
});

test('a lap on its own is a change of colour and weather, not of picture', () => {
  const [a, b] = [sceneFor({ realm: 'hive', slot: 2, lap: 0, theme: REALMS.hive.theme }), sceneFor({ realm: 'hive', slot: 2, lap: 1, theme: REALMS.hive.theme })];
  const swap = sceneSwap(a, b);
  assert.equal(swap.pictures, false);
  assert.equal(swap.colours, true);
});
