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
    { id: 'golden_albatross', name: 'Golden Solar Blade', kind: 'cosmetic', priceG: '150', requires: 'forest_glaive' },
    { id: 'skin_flame', name: 'Crimson Flame Katana', kind: 'cosmetic', priceG: '100', requires: null },
    { id: 'satchel_pet', name: 'Moon Sprite', kind: 'cosmetic', priceG: '80', requires: null },
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
