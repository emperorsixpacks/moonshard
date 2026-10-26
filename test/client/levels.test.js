import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GAME_CONFIG } from '../../src/config.js';
import { generateDailySurvivalSpec } from '../../src/engine/PRNG.js';
import {
  BEASTS, BLADE_TIERS, LANES, REALMS, bladeGoal, cumulativeFoes, foesIn, isBossLevel, levelClearBonus, levelClearBonusMax,
  levelHpMul, levelMaterials, levelPlan, levelSpeedMul, realmOf,
} from '../../src/engine/levels.js';

/*
 * Endless as a ladder of levels (src/engine/levels.js): the first five are the hand-built waves exactly as they were, every one
 * after them is built from its number alone, gets a little tougher, brings its own beasts, and every fifth is a boss. These
 * are the rules the game and the server's score ceiling lean on, so each one is pinned here.
 */

const LV = GAME_CONFIG.SURVIVAL.LEVELS;
const MOBS = GAME_CONFIG.MOBS;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const types = (plan) => [...new Set(plan.spawns.map((s) => s.type))].sort();
const hpOf = (type) => (type === 'boss_gorgok' ? MOBS.BOSS_GORGOK.HP : MOBS[type.toUpperCase()].HP);

// ---- the hand-built waves --------------------------------------------------------------------------------------------

test('levels 1 to 5 are the hand-built waves, foe for foe', () => {
  const waves = generateDailySurvivalSpec().waves;
  assert.equal(LV.SCRIPTED, waves.length);
  for (const n of range(1, 5)) {
    const plan = levelPlan(n);
    assert.deepEqual(plan.spawns.map(({ type, x, y }) => [type, x, y]), waves[n - 1].spawns.map(({ type, x, y }) => [type, x, y]), `level ${n}`);
    assert.equal(plan.foes, waves[n - 1].spawns.length);
  }
  assert.deepEqual(range(1, 5).map(foesIn), [15, 18, 22, 25, 17]);
});

test('the hand-built waves keep their pace: HP, speed, foes at once, names', () => {
  assert.deepEqual(range(1, 5).map(levelHpMul), [1, 1.3, 1.6, 1.9, 2.2]);
  assert.deepEqual(range(1, 5).map(levelSpeedMul), [1, 1.05, 1.1, 1.15, 1.2]); // five percent a wave, as the scene always had
  assert.deepEqual(range(1, 5).map((n) => levelPlan(n).maxConcurrent), [2, 3, 3, 4, 4]);
  assert.deepEqual(range(1, 5).map((n) => levelPlan(n).name), ['Forest Incursion', 'Airborne Ambush', 'Toxic Spores', 'The Frenzied Stampede', "The Chieftain's Wrath"]);
  assert.equal(LV.SCRIPTED_CONCURRENT.length, LV.SCRIPTED);
});

test('their spawns are handed out fresh: changing one does not change the level', () => {
  const plan = levelPlan(3);
  plan.spawns[0].x = 9999;
  plan.spawns.pop();
  assert.notEqual(levelPlan(3).spawns[0].x, 9999);
  assert.equal(levelPlan(3).spawns.length, 22);
});

// ---- how the levels grow ---------------------------------------------------------------------------------------------

test('foe HP only ever goes up, by a step a level, to a cap', () => {
  const hp = range(1, 200).map(levelHpMul);
  for (let i = 1; i < hp.length; i++) {
    assert.ok(hp[i] >= hp[i - 1], `level ${i + 1} is tougher than level ${i}`);
    assert.ok(hp[i] - hp[i - 1] <= (i + 1 <= LV.SCRIPTED ? 0.3 : LV.HP_STEP) + 1e-9, `level ${i + 1} is not a leap`);
  }
  assert.equal(levelHpMul(6), 2.3);
  assert.equal(levelHpMul(10), 2.7);
  assert.equal(levelHpMul(42), 5.9);
  assert.equal(levelHpMul(43), LV.HP_CAP);
  assert.equal(levelHpMul(100_000), LV.HP_CAP);
});

test('walkers get a little faster a level, up to a cap, and the plan says so', () => {
  const speed = range(1, 200).map(levelSpeedMul);
  for (let i = 1; i < speed.length; i++) assert.ok(speed[i] >= speed[i - 1], `level ${i + 1} is not slower than level ${i}`);
  assert.equal(levelSpeedMul(9), LV.SPEED_CAP);
  assert.equal(levelSpeedMul(100_000), LV.SPEED_CAP);
  assert.ok(LV.SPEED_CAP <= 1.5, 'a faster foe, not an unfair one');
  for (const n of [1, 5, 6, 9, 10, 77]) assert.equal(levelPlan(n).speedMul, levelSpeedMul(n), `level ${n}`);
});

test('built levels have 20 to 34 foes, one more every other level, and the plan holds that many', () => {
  assert.deepEqual([6, 7, 8, 9, 34, 35, 1000].map(foesIn), [20, 20, 21, 21, 34, 34, 34]);
  let last = 0;
  for (const n of range(6, 300)) {
    const plan = levelPlan(n);
    assert.equal(plan.spawns.length, plan.foes, `level ${n}`);
    assert.equal(plan.foes, foesIn(n));
    assert.ok(plan.foes >= LV.FOES_BASE && plan.foes <= LV.FOES_CAP, `level ${n} has ${plan.foes} foes`);
    assert.ok(plan.foes >= last, `level ${n} does not have fewer foes than the one before`);
    last = plan.foes;
  }
});

test('the arena never holds more than four foes at once', () => {
  for (const n of range(1, 100)) {
    const { maxConcurrent } = levelPlan(n);
    assert.ok(maxConcurrent >= 2 && maxConcurrent <= LV.MAX_CONCURRENT, `level ${n}`);
  }
  assert.equal(levelPlan(6).maxConcurrent, 4);
});

test('foes in levels 1 to n together', () => {
  let sum = 0;
  for (const n of range(1, 120)) {
    sum += foesIn(n);
    assert.equal(cumulativeFoes(n), sum, `to level ${n}`);
  }
  assert.equal(cumulativeFoes(0), 0, 'before level 1 there is nothing to have killed');
  assert.equal(cumulativeFoes(1), 15);
  assert.equal(cumulativeFoes(5), 97);
  assert.equal(cumulativeFoes(100_000), cumulativeFoes(34) + 34 * (100_000 - 34));
});

test('a level is a little harder than the one before it, never a wall', () => {
  const total = (n) => { const p = levelPlan(n); return p.spawns.reduce((a, s) => a + hpOf(s.type) * p.hpMul, 0); };
  for (const n of range(7, 120)) assert.ok(total(n) <= 1.5 * total(n - 1), `level ${n} is not much more than level ${n - 1}`);
  // by the realm: the average of five levels climbs, from the hand-built waves up to the cap, and does not fall away after it
  const block = (from) => range(from, from + 4).reduce((a, n) => a + total(n), 0) / 5;
  const blocks = range(0, 7).map((i) => block(1 + 5 * i));
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i] >= blocks[i - 1] * 0.95, `levels ${1 + 5 * i}-${5 + 5 * i} are not an easier stretch than the five before`);
});

test('the same level is the same for everyone, however they got to it', () => {
  for (const n of range(1, 80)) assert.deepEqual(levelPlan(n), levelPlan(n), `level ${n}`);
  const forwards = range(1, 40).map((n) => JSON.stringify(levelPlan(n)));
  const backwards = range(1, 40).reverse().map((n) => JSON.stringify(levelPlan(n))).reverse();
  assert.deepEqual(forwards, backwards);
});

test('a level number that is not a whole number above 0 is read as the nearest level', () => {
  assert.equal(levelPlan(0).level, 1);
  assert.equal(levelPlan(-5).level, 1);
  assert.equal(levelPlan(NaN).level, 1);
  assert.equal(levelPlan(undefined).level, 1);
  assert.equal(levelPlan('7').level, 7);
  assert.equal(levelPlan(7.9).level, 7);
});

// ---- the beasts ------------------------------------------------------------------------------------------------------

test('every beast the game has is in the table, with a lane that suits how it moves', () => {
  const mobs = Object.keys(MOBS).filter((k) => !k.startsWith('BOSS_')).map((k) => k.toLowerCase()).sort();
  assert.deepEqual(Object.keys(BEASTS).sort(), mobs);
  const lanes = { walker: ['ground', 'shooter'], flyer: ['air'], floater: ['float'] };
  for (const [type, beast] of Object.entries(BEASTS)) {
    assert.ok(beast.name, type);
    assert.ok(lanes[beast.kind]?.includes(beast.lane), `${type}: a ${beast.kind} in the ${beast.lane} lane`);
    assert.ok(LANES[beast.lane], `${type}: the ${beast.lane} lane exists`);
  }
});

test('every spawn is a known beast or the boss, and every beast shows up within the first lap of the realms', () => {
  const seen = new Set();
  for (const n of range(1, 300)) {
    for (const spawn of levelPlan(n).spawns) {
      assert.ok(spawn.type in BEASTS || spawn.type === 'boss_gorgok', `level ${n}: ${spawn.type}`);
      if (n <= LV.SCRIPTED + LV.BOSS_EVERY * 4) seen.add(spawn.type);
    }
  }
  assert.deepEqual([...seen].sort(), [...Object.keys(BEASTS), 'boss_gorgok'].sort());
});

test('built levels bring their beasts in where that kind of beast belongs', () => {
  for (const n of range(6, 120)) {
    const plan = levelPlan(n);
    plan.spawns.filter((s) => s.type !== 'boss_gorgok').forEach((spawn, i) => {
      const lane = LANES[BEASTS[spawn.type].lane];
      const where = `level ${n}: ${spawn.type} at ${spawn.x},${spawn.y}`;
      assert.ok(spawn.x >= 60 && spawn.x <= 740, where);
      if (BEASTS[spawn.type].lane === 'shooter') {
        assert.ok([...lane.left, ...lane.right].some((p) => p.x === spawn.x && p.y === spawn.y), where);
      } else {
        const [low, high] = Array.isArray(lane.y) ? lane.y : [lane.y, lane.y];
        assert.ok(spawn.y >= low && spawn.y <= high, where);
      }
      // they alternate sides, so the first foes to come out do not all come from one (the terrace is in the middle)
      if (spawn.x !== 400) assert.equal(spawn.x < 400, i % 2 === 0, where);
    });
  }
});

/** The beasts that make up the bulk of a level (a fifth of its foes or more): what it feels like to play. */
function bulk(n) {
  const minions = levelPlan(n).spawns.filter((s) => s.type !== 'boss_gorgok');
  const counts = {};
  for (const { type } of minions) counts[type] = (counts[type] ?? 0) + 1;
  return Object.keys(counts).filter((type) => counts[type] >= 0.2 * minions.length).sort();
}

test('no two levels in a row feel alike, from level 6: not the same beasts, and not the same bulk of them', () => {
  // the first time round the realms each level has beasts of its own...
  for (const n of range(7, 25)) assert.notDeepEqual(types(levelPlan(n)), types(levelPlan(n - 1)), `levels ${n - 1} and ${n}`);
  // ...and after that the tough beasts of the other realms are in every level, but the bulk of the level still changes
  for (const n of range(7, 250)) assert.notDeepEqual(bulk(n), bulk(n - 1), `levels ${n - 1} and ${n}`);
});

test('new beasts are announced once, in the level they first come in', () => {
  const introduced = range(1, 60).flatMap((n) => levelPlan(n).introduces.map((type) => [n, type]));
  assert.deepEqual(introduced, [
    [2, 'flying_eye'], [2, 'goblin'], [6, 'hornet_guard'], [11, 'skeleton_warrior'], [12, 'crypt_wraith'], [13, 'dread_bat'],
    [14, 'bog_lurker'], [14, 'mirelurker'], [16, 'cinder_drake'], [17, 'basalt_golem'], [21, 'astral_shade'], [22, 'void_stalker'],
  ].map(([n, type]) => [n, type]));
  assert.deepEqual(levelPlan(1).introduces, []);
  assert.deepEqual(levelPlan(5).introduces, [], 'the boss is announced on its own');
  const everyone = new Set([...introduced.map(([, t]) => t), ...types(levelPlan(1))]);
  assert.deepEqual([...everyone].sort(), Object.keys(BEASTS).sort());
  for (const n of range(1, 80)) {
    for (const type of levelPlan(n).introduces) assert.ok(levelPlan(n).spawns.some((s) => s.type === type), `level ${n} has the ${type} it introduces`);
  }
});

test('a realm that comes round again has tough beasts from elsewhere in it, more each lap', () => {
  const laps = [1, 2, 3, 4];
  for (const lap of laps) {
    const share = Math.min(LV.ELITE_SHARE_MAX, LV.ELITE_SHARE_PER_LAP * lap);
    for (const slot of range(0, 19)) {
      const n = 6 + slot + 20 * lap;
      const first = new Set(types(levelPlan(6 + slot)));
      const plan = levelPlan(n);
      const minions = plan.spawns.filter((s) => s.type !== 'boss_gorgok');
      const strangers = minions.filter((s) => !first.has(s.type));
      assert.equal(strangers.length, Math.round(minions.length * share), `level ${n}, lap ${lap}`);
      assert.deepEqual(types(levelPlan(6 + slot)).filter((t) => !types(plan).includes(t) && t !== 'boss_gorgok'), [], `level ${n} still has its own beasts`);
    }
  }
  for (const n of range(6, 25)) {
    const own = new Set(types(levelPlan(n)));
    assert.ok([...own].every((t) => t in BEASTS || t === 'boss_gorgok'), `level ${n}`);
  }
});

// ---- the realms and their bosses -------------------------------------------------------------------------------------

test('five levels to a realm, the realms come round in order, and a lap shows in the name', () => {
  const names = (from) => range(from, from + 4).map((n) => realmOf(n).name);
  assert.deepEqual(names(1), Array(5).fill('The High Forest'));
  assert.deepEqual(names(6), Array(5).fill('The Hive Canopy'));
  assert.deepEqual(names(11), Array(5).fill('The Sunken Ruins'));
  assert.deepEqual(names(16), Array(5).fill('The Obsidian Caldera'));
  assert.deepEqual(names(21), Array(5).fill('The Lunar Spire'));
  assert.deepEqual(names(26), Array(5).fill('The Hive Canopy II'));
  assert.equal(realmOf(46).name, 'The Hive Canopy III');
  assert.equal(realmOf(86).name, 'The Hive Canopy V');
  assert.equal(realmOf(46).lap, 2);
  assert.equal(realmOf(66).lap, 3);
  assert.deepEqual(range(1, 60).filter((n) => levelPlan(n).newRealm), [6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56]);
});

test('a boss on every fifth level, first in line, in the coat of the realm it ends', () => {
  for (const n of range(1, 200)) {
    const plan = levelPlan(n);
    assert.equal(isBossLevel(n), n % 5 === 0);
    assert.equal(plan.boss !== null, n % 5 === 0, `level ${n}`);
    const bosses = plan.spawns.filter((s) => s.type === 'boss_gorgok');
    assert.equal(bosses.length, n % 5 === 0 ? 1 : 0, `level ${n}`);
    if (plan.boss) {
      assert.equal(plan.spawns[0].type, 'boss_gorgok', 'the boss is the first to come out');
      assert.deepEqual([plan.spawns[0].x, plan.spawns[0].y], [620, 270]);
      assert.equal(plan.spawns[0].variant, plan.boss);
    }
  }
  assert.deepEqual([5, 10, 15, 20, 25, 30].map((n) => levelPlan(n).boss.name), [
    'GORGOK, FOREST CHIEFTAIN', 'THE HIVE TYRANT', 'THE BONE WARDEN', 'THE CINDER LORD', 'MOONBORN, THE PALE KING', 'THE HIVE TYRANT',
  ]);
  assert.equal(levelPlan(5).boss.tint, null, 'the first boss is the one the game always had');
  assert.equal(levelPlan(5).boss.summon, 'boar');
  for (const [key, realm] of Object.entries(REALMS)) {
    assert.ok(BEASTS[realm.boss.summon], `${key}'s boss calls on a beast the game has`);
    assert.equal(realm.boss.name, realm.boss.name.toUpperCase());
  }
  assert.throws(() => { 'use strict'; REALMS.hive.boss.name = 'x'; }, TypeError);
});

test('a boss level has as many foes as any other built level, the boss one of them', () => {
  for (const n of [10, 15, 20, 25, 30, 100]) assert.equal(levelPlan(n).spawns.length, foesIn(n));
});

test('every backdrop, tree and bush a realm wears is one the game loads', () => {
  const boot = fs.readFileSync(new URL('../../src/scenes/BootScene.js', import.meta.url), 'utf8');
  const loaded = (key) => boot.includes(`this.load.image('${key}'`);
  for (const [key, realm] of Object.entries(REALMS)) {
    if (!realm.theme) { assert.equal(key, 'woods', 'only the forest the scene builds itself has no theme'); continue; }
    for (const texture of [realm.theme.sky, realm.theme.bush, ...realm.theme.trees].filter(Boolean)) assert.ok(loaded(texture), `${key}: ${texture}`);
    assert.equal(typeof realm.theme.tint, 'number');
    assert.equal(typeof realm.theme.ground, 'number');
    assert.equal(typeof realm.theme.mote, 'number');
    assert.equal(typeof realm.theme.hills, 'boolean');
  }
});

// ---- what clearing a level pays ---------------------------------------------------------------------------------------

test('the hand-built waves pay what they always paid, so the score the server expects from them has not moved', () => {
  assert.deepEqual(range(1, 5).map(levelClearBonusMax), [680, 930, 1180, 1430, 1680]);
  assert.equal(range(1, 5).reduce((a, n) => a + levelClearBonusMax(n), 0), 5_900);
  // wave 1: 100 base, par 30 s at 20 a second, 25 for a slow clear
  assert.equal(levelClearBonus(1, 20).total, 300);
  assert.equal(levelClearBonus(1, 31).total, 125);
  assert.equal(levelClearBonus(1, 30).total, 125);
  assert.equal(levelClearBonus(5, 40).total, 300 + 30 * 20);
});

test('a built level pays a base that climbs and stops, and a speed bonus on a par that grows with its foes', () => {
  const six = levelClearBonus(6, 40);
  assert.deepEqual([six.base, six.par, six.speed, six.total, six.fast], [350, 48, 80, 430, true]);
  assert.equal(levelClearBonus(6, 48).total, 350 + 25);
  assert.equal(levelClearBonus(6, 500).total, 375);
  assert.equal(levelClearBonus(11, 500).base, 600);
  assert.equal(levelClearBonus(1000, 500).base, 600, 'the base stops climbing');
});

test('a faster clear never pays less than a slower one, and no clear pays more than the level\'s most', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 10, 25, 60]) {
    let before = 0;
    for (const seconds of range(1, 250).reverse()) {
      const { total } = levelClearBonus(n, seconds);
      assert.ok(total >= before, `level ${n}: ${seconds}s pays at least what ${seconds + 1}s does`);
      before = total;
    }
    assert.equal(levelClearBonus(n, 1).total, levelClearBonusMax(n));
  }
  assert.equal(levelClearBonus(3, 0).seconds, 1, 'never fewer than one second');
  assert.equal(levelClearBonus(3, NaN).seconds, 1);
});

test('no built level can pay more than the dearest of the hand-built ones, and the most a level pays is 1,390', () => {
  const dearest = Math.max(...range(1, 5).map(levelClearBonusMax));
  const max = Math.max(...range(6, 400).map(levelClearBonusMax));
  assert.ok(max <= dearest);
  assert.equal(max, 1_390);
});

// ---- what a level drops ----------------------------------------------------------------------------------------------

test('a level drops forest materials, and a boss level drops more', () => {
  assert.deepEqual(levelMaterials(1), { bark: 1, amber: 0, iron: 0 });
  assert.deepEqual(levelMaterials(2), { bark: 1, amber: 1, iron: 0 });
  assert.deepEqual(levelMaterials(3), { bark: 1, amber: 0, iron: 1 });
  assert.deepEqual(levelMaterials(5), { bark: 1, amber: 2, iron: 2 });
  assert.deepEqual(levelMaterials(6), { bark: 2, amber: 1, iron: 1 });
  assert.deepEqual(levelMaterials(10), { bark: 2, amber: 3, iron: 2 });
  assert.deepEqual(levelMaterials(15), { bark: 2, amber: 2, iron: 3 });
});

test('the blades past the Glaive are within reach of what the levels drop, but not handed out', () => {
  const dropsBy = (m) => range(1, m).reduce((sum, n) => {
    const d = levelMaterials(n);
    return { bark: sum.bark + d.bark, amber: sum.amber + d.amber, iron: sum.iron + d.iron };
  }, { bark: 0, amber: 0, iron: 0 });
  const levelsToAfford = (cost) => range(1, 200).find((m) => { const d = dropsBy(m); return d.bark >= cost.bark && d.amber >= cost.amber && d.iron >= cost.iron; });
  const needed = BLADE_TIERS.map((tier) => levelsToAfford(tier.cost));
  for (const m of needed) assert.ok(m >= 8 && m <= 40, `${m} levels of drops`);
  assert.deepEqual([...needed].sort((a, b) => a - b), needed, 'each blade takes more levels than the one before');
});

// ---- the blades the levels lead to -----------------------------------------------------------------------------------

test('the blades past the Glaive come in order, each needing the one before and a level reached', () => {
  assert.deepEqual(BLADE_TIERS.map((t) => [t.id, t.requires, t.minLevel]), [
    ['moonsteel_blade', 'forest_glaive', 8], ['starforged_edge', 'moonsteel_blade', 15], ['cinderbrand', 'starforged_edge', 20], ['voidglass_reaver', 'cinderbrand', 25],
  ]);
  for (const tier of BLADE_TIERS) assert.ok(GAME_CONFIG.WEAPONS.FOREST_GLAIVE.damageMul < tier.damageMul);
  assert.deepEqual(BLADE_TIERS.map((t) => t.damageMul), [...BLADE_TIERS.map((t) => t.damageMul)].sort((a, b) => a - b));
  assert.ok(BLADE_TIERS.every((t) => t.cost.bark > 0 && t.cost.iron > 0 && t.cost.amber > 0));
});

test('the results screen\'s next goal: the first blade not yet forged, once the one before it is', () => {
  assert.equal(bladeGoal({ reached: 30, owned: [] }), null, 'the Glaive comes first');
  assert.equal(bladeGoal({ reached: 30, owned: ['iron_starter', 'iron_broadsword'] }), null);
  assert.deepEqual(bladeGoal({ reached: 3, owned: ['forest_glaive'] }), { id: 'moonsteel_blade', name: 'Moonsteel Blade', minLevel: 8, unlocked: false });
  assert.equal(bladeGoal({ reached: 8, owned: ['forest_glaive'] }).unlocked, true);
  assert.equal(bladeGoal({ reached: 8, owned: ['forest_glaive', 'moonsteel_blade'] }).id, 'starforged_edge');
  assert.equal(bladeGoal({ reached: 8, owned: ['forest_glaive', 'moonsteel_blade'] }).unlocked, false);
  assert.equal(bladeGoal({ reached: 15, owned: ['forest_glaive', 'moonsteel_blade', 'starforged_edge'] }).id, 'cinderbrand');
  assert.equal(bladeGoal({ reached: 25, owned: new Set(['forest_glaive', 'moonsteel_blade', 'starforged_edge', 'cinderbrand']) }).id, 'voidglass_reaver');
  assert.equal(bladeGoal({ reached: 99, owned: ['forest_glaive', 'moonsteel_blade', 'starforged_edge', 'cinderbrand', 'voidglass_reaver'] }), null);
  assert.equal(bladeGoal(), null);
});
