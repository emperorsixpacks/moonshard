import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_CONFIG } from '../../src/config.js';
import { BEASTS, REALM_ORDER } from '../../src/engine/levels.js';
import {
  ARMOUR, SLOTS, armourById, armourEffect, armourFor, baneLine, baneMul, beastsList, cutFor, cutLabel, gearStrip, homeOf, kitSummary, takenDamage,
} from '../../src/engine/gear.js';

/*
 * What the hero wears and wields, as numbers: a helmet turns aside blows from foes, a shield what they throw, and a blade made
 * for a realm hits that realm's beasts harder. The scenes ask these functions and the shop writes their answers in words.
 */

const W = GAME_CONFIG.WEAPONS;
const A = GAME_CONFIG.ARMOUR;

// ---- the table of armour ---------------------------------------------------------------------------------------------

test('there are ten pieces, five helms then five shields, and each slot gets stronger tier by tier', () => {
  assert.deepEqual(SLOTS, ['helm', 'shield']);
  assert.equal(ARMOUR.length, 10);
  assert.deepEqual(ARMOUR.map((p) => p.slot), [...Array(5).fill('helm'), ...Array(5).fill('shield')]);
  for (const slot of SLOTS) {
    const chain = armourFor(slot);
    assert.equal(chain.length, 5);
    assert.deepEqual(chain.map((p) => p.cut), [...chain.map((p) => p.cut)].sort((a, b) => a - b), `${slot} cuts rise`);
    assert.deepEqual(chain.map((p) => p.tier), ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5']);
    assert.deepEqual(chain.map((p) => p.realm), REALM_ORDER, `${slot}: one tier for each realm, in the order the levels lead there`);
  }
  assert.equal(armourById('chitin_helm'), A.CHITIN_HELM);
  assert.equal(armourById('nothing'), null);
  assert.equal(armourById(null), null);
});

test('each piece after the first needs the one before it and an Endless level; the first needs neither', () => {
  for (const slot of SLOTS) {
    const chain = armourFor(slot);
    assert.equal(chain[0].requires, undefined);
    assert.equal(chain[0].minLevel, undefined);
    chain.slice(1).forEach((piece, i) => {
      assert.equal(piece.requires, chain[i].id, `${piece.id} needs ${chain[i].id}`);
      assert.ok(piece.minLevel > (chain[i].minLevel ?? 0), `${piece.id} asks for a deeper level than the piece before it`);
    });
  }
});

test('a piece asks for the level its realm\'s blade asks for, and costs forest materials that rise with its tier', () => {
  const bladeLevels = { hive: W.MOONSTEEL_BLADE.minLevel, ruins: W.STARFORGED_EDGE.minLevel, caldera: W.CINDERBRAND.minLevel, spire: W.VOIDGLASS_REAVER.minLevel };
  for (const piece of ARMOUR) if (bladeLevels[piece.realm]) assert.equal(piece.minLevel, bladeLevels[piece.realm], piece.id);
  for (const slot of SLOTS) {
    const costs = armourFor(slot).map((p) => p.cost.bark + p.cost.amber + p.cost.iron);
    assert.deepEqual(costs, [...costs].sort((a, b) => a - b), `${slot} materials rise`);
  }
  assert.ok(ARMOUR.every((p) => p.cost.bark > 0), 'every piece needs forest materials: G$ alone buys none');
});

// ---- what armour takes off a hit -------------------------------------------------------------------------------------

test('a helmet turns aside blows and a shield what is thrown: each only its own kind', () => {
  const worn = { helm: A.CHITIN_HELM, shield: A.OAK_BUCKLER };
  assert.equal(cutFor(worn, 'contact'), 0.14);
  assert.equal(cutFor(worn, 'ranged'), 0.12);
  assert.equal(cutFor({ helm: A.CHITIN_HELM }, 'ranged'), 0, 'no shield: nothing off what is thrown');
  assert.equal(cutFor({ shield: A.OAK_BUCKLER }, 'contact'), 0, 'no helm: nothing off blows');
  assert.equal(cutFor({}, 'contact'), 0);
  assert.equal(cutFor(undefined), 0);
  assert.equal(cutFor(worn, 'fall'), 0, 'a kind of hit that is neither');
  assert.equal(cutFor(worn), 0.14, 'a hit is a blow unless it says otherwise');
});

test('a cut is a share between 0 and 90%, whatever a piece says', () => {
  assert.equal(cutFor({ helm: { cut: 5 } }, 'contact'), 0.9);
  assert.equal(cutFor({ helm: { cut: -1 } }, 'contact'), 0);
  assert.equal(cutFor({ helm: { cut: NaN } }, 'contact'), 0);
  assert.equal(cutFor({ shield: { cut: 'a lot' } }, 'ranged'), 0);
});

test('the best armour takes off about half of what is thrown, and the best helm a third of blows: never all of it', () => {
  assert.equal(A.LUNAR_BASTION.cut, 0.52);
  assert.equal(A.MOONBORN_CROWN.cut, 0.32);
  assert.ok(ARMOUR.every((p) => p.cut < 0.6));
});

test('a hit costs whole points through a cut, and never fewer than one', () => {
  assert.equal(takenDamage(20, 0), 20);
  assert.equal(takenDamage(20, 0.14), 17); // 17.2
  assert.equal(takenDamage(20, 0.52), 10); // 9.6
  assert.equal(takenDamage(100, 0.32), 68);
  assert.equal(takenDamage(1, 0.52), 1, 'armour thins a blow, it does not stop one');
  assert.equal(takenDamage(2, 0.9), 1);
  assert.equal(takenDamage(0, 0.5), 0);
  assert.equal(takenDamage(-4, 0.5), 0);
  assert.equal(takenDamage('abc', 0.5), 0);
  assert.equal(takenDamage(18), 18, 'no cut given: the whole hit');
  assert.equal(takenDamage(18.6, 0), 18.6, 'with no cut the amount is left exactly as it came');
});

// ---- banes ---------------------------------------------------------------------------------------------------------------

test('every beast belongs to a realm, and every realm has beasts', () => {
  for (const [type, beast] of Object.entries(BEASTS)) assert.ok(REALM_ORDER.includes(beast.home), `${type} lives in a realm`);
  for (const realm of REALM_ORDER) assert.ok(Object.values(BEASTS).some((b) => b.home === realm), `${realm} has beasts`);
});

test('a foe\'s realm is its own, and a boss belongs to the realm of the level it came in', () => {
  assert.equal(homeOf('boar'), 'woods');
  assert.equal(homeOf('bee'), 'hive');
  assert.equal(homeOf('dread_bat'), 'ruins', 'a bat lives in the ruins, not the hive');
  assert.equal(homeOf('cinder_drake'), 'caldera');
  assert.equal(homeOf('astral_shade'), 'spire');
  assert.equal(homeOf('boss_gorgok', 'caldera'), 'caldera');
  assert.equal(homeOf('boss_demon', 'spire'), 'spire');
  assert.equal(homeOf('boss_gorgok'), null, 'a boss with no level to say where is of no realm');
  assert.equal(homeOf('ghost'), null);
});

test('a blade hits the beasts of its own realm harder, and every other beast as it always did', () => {
  const moonsteel = W.MOONSTEEL_BLADE;
  assert.equal(baneMul(moonsteel, 'bee'), 1.3);
  assert.equal(baneMul(moonsteel, 'hornet_guard'), 1.3);
  assert.equal(baneMul(moonsteel, 'boar'), 1);
  assert.equal(baneMul(moonsteel, 'dread_bat'), 1);
  assert.equal(baneMul(W.STARTER, 'bee'), 1, 'the Rusted Shortsword has no bane');
  assert.equal(baneMul(W.IRON_BROADSWORD, 'boar'), 1);
  assert.equal(baneMul(W.FOREST_GLAIVE, 'goblin'), 1.3, 'the Glaive is the woods\' bane');
  assert.equal(baneMul(null, 'boar'), 1);
  assert.equal(baneMul(moonsteel, undefined), 1);
});

test('a boss takes the bane of the realm it came in', () => {
  assert.equal(baneMul(W.CINDERBRAND, 'boss_gorgok', 'caldera'), 1.3);
  assert.equal(baneMul(W.CINDERBRAND, 'boss_gorgok', 'hive'), 1);
  assert.equal(baneMul(W.CINDERBRAND, 'boss_gorgok'), 1);
});

test('every realm has a blade that is its bane, each stronger than the one before', () => {
  const banes = Object.values(W).filter((w) => w.bane && !w.isSkin && w.tier !== 'Celestial Blade');
  assert.deepEqual(banes.map((w) => w.bane.realm), REALM_ORDER);
  assert.deepEqual(banes.map((w) => w.damageMul), [...banes.map((w) => w.damageMul)].sort((a, b) => a - b));
  assert.ok(banes.every((w) => w.bane.mul > 1 && w.bane.mul <= 1.5), 'a bane is a boost, not a one-hit kill');
});

test('a look never trades power for style: the Celestial blades have the Glaive\'s damage, reach and bane', () => {
  for (const look of [W.GOLDEN_ALBATROSS, W.CORRUPTED_VOID]) {
    assert.deepEqual([look.damageMul, look.rangeMul, look.bane], [W.FOREST_GLAIVE.damageMul, W.FOREST_GLAIVE.rangeMul, W.FOREST_GLAIVE.bane]);
  }
  for (const skin of Object.values(W).filter((w) => w.isSkin)) {
    assert.equal(skin.damageMul, 1, `${skin.id} is only a look`);
    assert.equal(skin.bane, undefined);
  }
});

// ---- in words ------------------------------------------------------------------------------------------------------------

test('a bane in words, and the beasts it names', () => {
  assert.equal(beastsList('woods'), 'boars, snails, mushrooms and goblins');
  assert.equal(beastsList('hive'), 'bees, flying eyes and hornet guards');
  assert.equal(beastsList('caldera'), 'basalt golems and cinder drakes');
  assert.equal(beastsList('nowhere'), 'its beasts');
  assert.equal(baneLine(W.MOONSTEEL_BLADE), '+30% against bees, flying eyes and hornet guards');
  assert.equal(baneLine(W.VOIDGLASS_REAVER), '+30% against void stalkers and astral shades');
  assert.equal(baneLine(W.STARTER), null);
  assert.equal(baneLine(undefined), null);
});

test('a piece of armour in words, and a cut as a label', () => {
  assert.equal(armourEffect(A.CHITIN_HELM), 'Takes 14% off blows from foes');
  assert.equal(armourEffect(A.HONEYCOMB_SHIELD), 'Takes 22% off what foes throw');
  assert.equal(cutLabel(0.14), '-14%');
  assert.equal(cutLabel(0.5), '-50%');
});

test('the strip in the HUD says what is worn, and nothing for a hero in no armour', () => {
  assert.equal(gearStrip({ helm: A.CHITIN_HELM, shield: A.OAK_BUCKLER }), '⛑ -14%  🛡 -12%');
  assert.equal(gearStrip({ helm: A.CHITIN_HELM }), '⛑ -14%');
  assert.equal(gearStrip({ shield: A.OAK_BUCKLER }), '🛡 -12%');
  assert.equal(gearStrip({}), '');
  assert.equal(gearStrip(), '');
});

test('the kit summary of the shop: blade damage and what the helm and the shield take off', () => {
  assert.deepEqual(kitSummary({ weapon: W.MOONSTEEL_BLADE, helm: A.CHITIN_HELM, shield: A.OAK_BUCKLER }), { damage: 'x1.8', contact: '-14%', ranged: '-12%' });
  assert.deepEqual(kitSummary({ weapon: W.STARTER }), { damage: 'x1', contact: 'none', ranged: 'none' });
  assert.deepEqual(kitSummary(), { damage: 'x1', contact: 'none', ranged: 'none' });
});
