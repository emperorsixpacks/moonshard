import test from 'node:test';
import assert from 'node:assert/strict';
import { forgeOffer, materialsLabel } from '../../src/ui/forgeOffer.js';

/*
 * What the Forge offers for each item, as a pure function of the item and the wallet service's status. With a Moon Shop on
 * the server: the first blade is bought with G$, stronger blades are forged from forest materials plus a G$ fee, and looks
 * (skins, Celestial blades, the pet) are bought with G$. With no shop, everything is crafted from materials, as before.
 */

const SHOP = {
  enabled: true, token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', vault: '0x00000000000000000000000000000000000ba5e1',
  items: [
    { id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null },
    { id: 'iron_broadsword', name: 'Iron Broadsword', kind: 'forge', priceG: '30', requires: null },
    { id: 'forest_glaive', name: 'Forest Glaive', kind: 'forge', priceG: '60', requires: null },
    { id: 'moonsteel_blade', name: 'Moonsteel Blade', kind: 'forge', priceG: '100', requires: 'forest_glaive', minLevel: 8 },
    { id: 'golden_albatross', name: 'Golden Solar Blade', kind: 'cosmetic', priceG: '150', requires: 'forest_glaive' },
    { id: 'skin_flame', name: 'Crimson Flame Katana', kind: 'cosmetic', priceG: '100', requires: null },
    { id: 'satchel_pet', name: 'Moon Sprite', kind: 'cosmetic', priceG: '80', requires: null },
    { id: 'leather_cap', name: 'Leather Cap', kind: 'forge', priceG: '15', requires: null },
    { id: 'chitin_helm', name: 'Chitin Helm', kind: 'forge', priceG: '50', requires: 'leather_cap', minLevel: 8 },
    { id: 'oak_buckler', name: 'Oak Buckler', kind: 'forge', priceG: '15', requires: null },
  ],
};
const CLOSED = { enabled: false, token: SHOP.token, vault: null, items: [] };
const status = (over = {}) => ({
  connected: true, verified: true, status: 'verified', offline: false, shop: SHOP, owned: ['iron_starter'],
  awaiting: { ubi: null, bounty: null, spoils: {}, shop: {} }, ...over,
});
const item = (over = {}) => ({ id: 'skin_flame', cost: { iron: 10, bark: 6, amber: 4 }, unlocked: false, equipped: false, hasMaterials: true, ...over });

test('materials read as a short label, in a fixed order, without the ones it does not need', () => {
  assert.equal(materialsLabel({ bark: 10, iron: 5, amber: 0 }), '10B/5I');
  assert.equal(materialsLabel({ bark: 15, iron: 8, amber: 10 }), '15B/10A/8I');
  assert.equal(materialsLabel({}), '');
});

test('a look is bought with G$, at the server\'s price', () => {
  assert.deepEqual(forgeOffer(item(), status()), { label: 'BUY\n100 G$', action: 'buy', priceG: '100' });
});

test('a stronger blade is forged from forest materials plus a G$ fee; without the materials it cannot be', () => {
  const broadsword = item({ id: 'iron_broadsword', cost: { bark: 10, iron: 5, amber: 0 } });
  // the fee first and the materials on a line of their own: the longest label still fits the portrait button
  assert.deepEqual(forgeOffer(broadsword, status()), { label: 'FORGE + 30 G$\n10B/5I', action: 'forge', priceG: '30' });
  assert.equal(forgeOffer({ ...broadsword, hasMaterials: false }, status()).action, 'short');
});

test('the first blade is bought with G$ like any other purchase', () => {
  const starter = item({ id: 'iron_starter', cost: undefined });
  assert.deepEqual(forgeOffer(starter, status({ owned: [] })), { label: 'BUY\n20 G$', action: 'buy', priceG: '20' });
});

test('a Celestial blade waits for the Glaive it builds on', () => {
  const golden = item({ id: 'golden_albatross', cost: { amber: 8, iron: 6 } });
  assert.deepEqual(forgeOffer(golden, status()), { label: 'NEEDS\nFOREST GLAIVE', action: 'locked' });
  assert.equal(forgeOffer(golden, status({ owned: ['iron_starter', 'forest_glaive'] })).action, 'buy');
});

test('a blade past the Glaive waits for the Glaive, then for the Endless level it asks for, then it is forged like any other', () => {
  const moonsteel = item({ id: 'moonsteel_blade', cost: { bark: 20, iron: 12, amber: 12 } });
  const glaive = ['iron_starter', 'forest_glaive'];
  assert.deepEqual(forgeOffer(moonsteel, status()), { label: 'NEEDS\nFOREST GLAIVE', action: 'locked' });
  // the Glaive is owned but the player has not been deep enough
  for (const bestLevel of [undefined, null, 0, 7]) {
    assert.deepEqual(forgeOffer(moonsteel, status({ owned: glaive, bestLevel })), { label: 'REACH\nLEVEL 8', action: 'locked' });
  }
  assert.deepEqual(forgeOffer(moonsteel, status({ owned: glaive, bestLevel: 8 })), { label: 'FORGE + 100 G$\n20B/12A/12I', action: 'forge', priceG: '100' });
  assert.equal(forgeOffer(moonsteel, status({ owned: glaive, bestLevel: 30 })).action, 'forge');
  assert.equal(forgeOffer({ ...moonsteel, hasMaterials: false }, status({ owned: glaive, bestLevel: 8 })).action, 'short');
  // buying is still for verified humans, once the level is reached
  assert.equal(forgeOffer(moonsteel, status({ owned: glaive, bestLevel: 8, verified: false, status: 'unverified' })).action, 'wallet');
});

test('a helm or a shield is forged like a blade: the fee and the materials, and the better ones wait for the one below and a level', () => {
  const cap = item({ id: 'leather_cap', cost: { bark: 8, amber: 0, iron: 3 } });
  const chitin = item({ id: 'chitin_helm', cost: { bark: 12, amber: 6, iron: 6 } });
  assert.deepEqual(forgeOffer(cap, status()), { label: 'FORGE + 15 G$\n8B/3I', action: 'forge', priceG: '15' });
  assert.equal(forgeOffer({ ...cap, hasMaterials: false }, status()).action, 'short', 'G$ alone buys no armour');
  assert.deepEqual(forgeOffer(chitin, status()), { label: 'NEEDS\nLEATHER CAP', action: 'locked' });
  const capped = ['iron_starter', 'leather_cap'];
  for (const bestLevel of [undefined, 0, 7]) {
    assert.deepEqual(forgeOffer(chitin, status({ owned: capped, bestLevel })), { label: 'REACH\nLEVEL 8', action: 'locked' });
  }
  assert.deepEqual(forgeOffer(chitin, status({ owned: capped, bestLevel: 8 })), { label: 'FORGE + 50 G$\n12B/6A/6I', action: 'forge', priceG: '50' });
  assert.deepEqual(forgeOffer({ ...cap, unlocked: true }, status()), { label: 'EQUIP', action: 'equip' });
  assert.deepEqual(forgeOffer({ ...cap, unlocked: true, equipped: true }, status()), { label: 'EQUIPPED', action: 'none' });
  assert.deepEqual(forgeOffer(item({ id: 'oak_buckler', cost: { bark: 10, amber: 2, iron: 2 } }), status()), { label: 'FORGE + 15 G$\n10B/2A/2I', action: 'forge', priceG: '15' });
});

test('a payment on its way is shown for a blade that asks for a level too, and one that is owned is equipped', () => {
  const moonsteel = item({ id: 'moonsteel_blade', cost: { bark: 20, iron: 12, amber: 12 } });
  const paying = status({ owned: ['iron_starter'], awaiting: { ubi: null, bounty: null, spoils: {}, shop: { moonsteel_blade: `0x${'cd'.repeat(32)}` } } });
  assert.deepEqual(forgeOffer(moonsteel, paying), { label: 'PAYING…', action: 'wait' });
  assert.deepEqual(forgeOffer({ ...moonsteel, unlocked: true }, status()), { label: 'EQUIP', action: 'equip' });
});

test('with no shop a blade that asks for a level is crafted once this device has seen the level', () => {
  const closed = status({ shop: CLOSED });
  const moonsteel = item({ id: 'moonsteel_blade', cost: { bark: 20, iron: 12, amber: 12 }, minLevel: 8 });
  assert.deepEqual(forgeOffer({ ...moonsteel, levelReached: 7 }, closed), { label: 'REACH\nLEVEL 8', action: 'locked' });
  assert.deepEqual(forgeOffer(moonsteel, closed), { label: 'REACH\nLEVEL 8', action: 'locked' });
  assert.deepEqual(forgeOffer({ ...moonsteel, levelReached: 8 }, closed), { label: 'CRAFT\n(20B/12A/12I)', action: 'craft' });
  assert.equal(forgeOffer({ ...moonsteel, levelReached: 8, hasMaterials: false }, closed).action, 'short');
  // the server's level is not read for an item it does not sell: the device's own is
  assert.equal(forgeOffer(moonsteel, status({ shop: CLOSED, bestLevel: 99 })).action, 'locked');
  // and an item without a level is crafted as it always was
  assert.equal(forgeOffer(item(), status({ shop: CLOSED })).action, 'craft');
});

test('crafted from materials alone the tiers still go in order: a piece waits for the one it needs, before its level', () => {
  const closed = status({ shop: CLOSED });
  const moonsteel = item({ id: 'moonsteel_blade', cost: { bark: 20, iron: 12, amber: 12 }, minLevel: 8, levelReached: 8, needs: 'Forest Glaive' });
  assert.deepEqual(forgeOffer(moonsteel, closed), { label: 'NEEDS\nFOREST GLAIVE', action: 'locked' });
  assert.deepEqual(forgeOffer({ ...moonsteel, levelReached: 0 }, closed), { label: 'NEEDS\nFOREST GLAIVE', action: 'locked' }, 'the tier is named first');
  assert.deepEqual(forgeOffer({ ...moonsteel, needs: undefined }, closed), { label: 'CRAFT\n(20B/12A/12I)', action: 'craft' }, 'owning the tier opens it');
  // an item an older server does not list is crafted while its shop is open, and the order holds there too
  const older = status({ shop: { ...SHOP, items: SHOP.items.filter((x) => x.id !== 'moonsteel_blade') } });
  assert.equal(forgeOffer(moonsteel, older).action, 'locked');
  assert.equal(forgeOffer({ ...moonsteel, needs: undefined }, older).action, 'craft');
  // a piece the shop does sell is the server's to judge, from what it says the player owns
  assert.equal(forgeOffer({ ...moonsteel, needs: 'Forest Glaive' }, status({ owned: ['iron_starter', 'forest_glaive'], bestLevel: 8 })).action, 'forge');
});

test('what is owned is equipped, or put on and off for the pet', () => {
  assert.deepEqual(forgeOffer(item({ unlocked: true }), status()), { label: 'EQUIP', action: 'equip' });
  assert.deepEqual(forgeOffer(item({ unlocked: true, equipped: true }), status()), { label: 'EQUIPPED', action: 'none' });
  const pet = item({ id: 'satchel_pet', pet: true });
  assert.deepEqual(forgeOffer({ ...pet, unlocked: true, equipped: true }, status()), { label: 'PET ON', action: 'toggle' });
  assert.deepEqual(forgeOffer({ ...pet, unlocked: true }, status()), { label: 'PET OFF', action: 'toggle' });
  assert.equal(forgeOffer(pet, status()).action, 'buy');
});

test('a payment on its way is shown, and cannot be sent twice', () => {
  const s = status({ awaiting: { ubi: null, bounty: null, spoils: {}, shop: { skin_flame: `0x${'ab'.repeat(32)}` } } });
  assert.deepEqual(forgeOffer(item(), s), { label: 'PAYING…', action: 'wait' });
});

test('a visitor sees the prices, and buying sends them to the wallet panel first (connect, verify)', () => {
  for (const s of [
    status({ connected: false, verified: false, status: 'anonymous', owned: null }),
    status({ verified: false, status: 'unverified', owned: null }),
  ]) {
    assert.deepEqual(forgeOffer(item(), s), { label: 'BUY\n100 G$', action: 'wallet', priceG: '100' });
  }
});

test('with no shop on the server everything is crafted from materials, as before', () => {
  assert.deepEqual(forgeOffer(item(), status({ shop: CLOSED })), { label: 'CRAFT\n(6B/4A/10I)', action: 'craft' });
  assert.equal(forgeOffer(item({ hasMaterials: false }), status({ shop: CLOSED })).action, 'short');
  assert.deepEqual(forgeOffer(item({ unlocked: true }), status({ shop: CLOSED })), { label: 'EQUIP', action: 'equip' });
});

test('an item the shop does not sell is crafted from materials even while the shop is open', () => {
  const reroll = item({ id: 'relic_reroll', cost: { bark: 2, amber: 2 } });
  assert.deepEqual(forgeOffer(reroll, status()), { label: 'CRAFT\n(2B/2A)', action: 'craft' });
});

test('until the shop is known, nothing is sold; if the server cannot be reached, it says so', () => {
  assert.deepEqual(forgeOffer(item(), status({ shop: null })), { label: 'LOADING…', action: 'locked' });
  assert.deepEqual(forgeOffer(item(), status({ shop: null, offline: true })), { label: 'SHOP\nOFFLINE', action: 'locked' });
  assert.deepEqual(forgeOffer(item({ unlocked: true }), status({ shop: null })), { label: 'EQUIP', action: 'equip' });
});
