import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../../src/engine/Storage.js';
import { setBlessed } from '../../src/gd/blessing.js';

test('without a blessing materials are added 1:1', () => {
  setBlessed(false);
  const before = { ...storage.getMaterials() };
  storage.addMaterials({ bark: 3, amber: 1, iron: 2 });
  const after = storage.getMaterials();
  assert.equal(after.bark - before.bark, 3);
  assert.equal(after.amber - before.amber, 1);
  assert.equal(after.iron - before.iron, 2);
});

test('with the Citizen\'s Blessing drops are +25% with fractional carry (4 single drops -> 5)', () => {
  setBlessed(true);
  const before = storage.getMaterials().bark;
  for (let i = 0; i < 4; i++) storage.addMaterials({ bark: 1 });
  assert.equal(storage.getMaterials().bark - before, 5);
  setBlessed(false);
});

test('the deepest Endless level is remembered, only ever deeper, and a save from before it reads as none', (t) => {
  t.mock.method(console, 'warn', () => {}); // no localStorage under Node: the save warns
  delete storage.data.bestLevel;
  assert.equal(storage.getBestLevel(), 0);
  storage.recordBestLevel(4);
  storage.recordBestLevel(9);
  storage.recordBestLevel(6);
  assert.equal(storage.getBestLevel(), 9);
  storage.recordBestLevel(9);
  assert.equal(storage.getBestLevel(), 9);
});

test('a level that is not a whole number is not remembered', (t) => {
  t.mock.method(console, 'warn', () => {});
  storage.data.bestLevel = 3;
  for (const junk of [NaN, Infinity, 7.5, '12', null, undefined, -2, {}]) storage.recordBestLevel(junk);
  assert.equal(storage.getBestLevel(), 3);
});

// ---- armour, and what the shop says is owned ---------------------------------------------------------------------------

/** Puts the device back as a first visit has it, for what these tests touch (the save is shared between the tests of this file). */
function freshDevice(t) {
  t.mock.method(console, 'warn', () => {}); // no localStorage under Node: the save warns
  Object.assign(storage.data, {
    unlockedWeapons: ['iron_starter'], equippedWeapon: 'iron_starter', unlockedArmour: [], equippedHelm: null, equippedShield: null,
    satchelUnlocked: false, companionEquipped: false,
  });
}

test('a piece of armour is owned once, only if it is a piece there is, and is worn only when owned', (t) => {
  freshDevice(t);
  storage.unlockArmour('chitin_helm');
  storage.unlockArmour('chitin_helm');
  storage.unlockArmour('no_such_piece');
  assert.deepEqual(storage.data.unlockedArmour, ['chitin_helm']);
  assert.equal(storage.isArmourUnlocked('chitin_helm'), true);
  assert.equal(storage.isArmourUnlocked('leather_cap'), false);
  assert.equal(storage.equipArmour('leather_cap'), false, 'not owned: not worn');
  assert.deepEqual(storage.getEquippedArmour(), { helm: null, shield: null });
  assert.equal(storage.equipArmour('chitin_helm'), true);
  assert.deepEqual(storage.getEquippedArmour(), { helm: 'chitin_helm', shield: null }, 'a helm goes on the head');
});

test('each slot has one piece on, a shield goes on the arm, and a slot can be emptied', (t) => {
  freshDevice(t);
  for (const id of ['leather_cap', 'chitin_helm', 'oak_buckler']) storage.unlockArmour(id);
  storage.equipArmour('chitin_helm');
  storage.equipArmour('oak_buckler');
  storage.equipArmour('leather_cap');
  assert.deepEqual(storage.getEquippedArmour(), { helm: 'leather_cap', shield: 'oak_buckler' }, 'a second helm replaces the first, the shield stays');
  assert.equal(storage.unequipArmour('helm'), true);
  assert.deepEqual(storage.getEquippedArmour(), { helm: null, shield: 'oak_buckler' });
  assert.equal(storage.unequipArmour('cloak'), false);
});

test('a save from before armour has none, and wears none', (t) => {
  freshDevice(t);
  delete storage.data.unlockedArmour;
  delete storage.data.equippedHelm;
  delete storage.data.equippedShield;
  assert.equal(storage.isArmourUnlocked('leather_cap'), false);
  assert.deepEqual(storage.getEquippedArmour(), { helm: null, shield: null });
  storage.unlockArmour('leather_cap');
  assert.deepEqual(storage.data.unlockedArmour, ['leather_cap']);
});

test('tidying puts on the best piece owned in a bare slot, takes off what is no longer owned, and leaves what is worn alone', (t) => {
  freshDevice(t);
  storage.data.unlockedArmour = ['leather_cap', 'chitin_helm', 'oak_buckler'];
  storage.tidyArmour();
  assert.deepEqual(storage.getEquippedArmour(), { helm: 'chitin_helm', shield: 'oak_buckler' }, 'the best of each');

  storage.data.equippedHelm = 'leather_cap'; // chosen by the player: the weaker one
  storage.tidyArmour();
  assert.equal(storage.getEquippedArmour().helm, 'leather_cap', 'what the player chose stays');

  storage.data.unlockedArmour = ['oak_buckler'];
  storage.tidyArmour();
  assert.deepEqual(storage.getEquippedArmour(), { helm: null, shield: 'oak_buckler' }, 'a helm that is no longer owned comes off, and there is none to replace it');
});

test('the shop says what is owned: what it sells is owned exactly when it is listed, anything else is left alone', (t) => {
  freshDevice(t);
  storage.data.unlockedWeapons = ['iron_starter', 'iron_broadsword', 'moonsteel_blade'];
  storage.data.equippedWeapon = 'moonsteel_blade';
  const sold = ['iron_starter', 'iron_broadsword', 'forest_glaive', 'leather_cap', 'chitin_helm', 'oak_buckler', 'satchel_pet'];
  // the player owns the starter and the cap and the buckler; the broadsword is gone from the list; the Moonsteel Blade is not sold here
  storage.applyShopOwnership(sold, ['iron_starter', 'leather_cap', 'oak_buckler']);
  assert.deepEqual(storage.data.unlockedWeapons, ['moonsteel_blade', 'iron_starter'], 'the broadsword goes; the unsold Moonsteel Blade is left alone');
  assert.deepEqual(storage.data.unlockedArmour, ['leather_cap', 'oak_buckler']);
  assert.equal(storage.data.equippedWeapon, 'moonsteel_blade', 'a worn blade that is still owned stays worn');
  assert.deepEqual(storage.getEquippedArmour(), { helm: 'leather_cap', shield: 'oak_buckler' }, 'armour owned is put on where the slot is bare');
});

test('a worn blade the shop no longer lists as owned is put away for the first one', (t) => {
  freshDevice(t);
  storage.data.unlockedWeapons = ['iron_starter', 'iron_broadsword'];
  storage.data.equippedWeapon = 'iron_broadsword';
  storage.applyShopOwnership(['iron_starter', 'iron_broadsword'], ['iron_starter']);
  assert.equal(storage.data.equippedWeapon, 'iron_starter');
});

test('a newly owned armour piece is not put on over the one the player wears; a piece that is lost comes off', (t) => {
  freshDevice(t);
  storage.data.unlockedArmour = ['leather_cap'];
  storage.data.equippedHelm = 'leather_cap';
  storage.applyShopOwnership(['leather_cap', 'chitin_helm'], ['leather_cap', 'chitin_helm']);
  assert.equal(storage.getEquippedArmour().helm, 'leather_cap', 'bought, not yet chosen: the game puts it on after a purchase, not on every sync');
  storage.applyShopOwnership(['leather_cap', 'chitin_helm'], ['chitin_helm']);
  assert.equal(storage.getEquippedArmour().helm, 'chitin_helm', 'the cap is no longer owned: the best owned helm takes its place');
});

test('the Moon Sprite satchel follows the shop: a pet bought comes out, a pet lost goes', (t) => {
  freshDevice(t);
  storage.applyShopOwnership(['satchel_pet'], ['satchel_pet']);
  assert.deepEqual([storage.data.satchelUnlocked, storage.isCompanionActive()], [true, true]);
  storage.toggleCompanion();
  assert.equal(storage.isCompanionActive(), false);
  storage.applyShopOwnership(['satchel_pet'], ['satchel_pet']);
  assert.equal(storage.isCompanionActive(), false, 'a sync does not put away a pet the player took off');
  storage.applyShopOwnership(['satchel_pet'], []);
  assert.deepEqual([storage.data.satchelUnlocked, storage.isCompanionActive()], [false, false]);
});

test('with no shop on the server the first blade is free', (t) => {
  freshDevice(t);
  storage.data.unlockedWeapons = [];
  storage.applyShopClosed();
  assert.deepEqual(storage.data.unlockedWeapons, ['iron_starter']);
});
