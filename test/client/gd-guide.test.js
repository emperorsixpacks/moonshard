import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGuideHtml, walletPillText } from '../../src/ui/gdPanelView.js';
import { takeFirstVisit } from '../../src/ui/guideOnce.js';

/*
 * "The use of G$ should be very clear in the game" (owner, 2026-10-02). The G$ guide: one screen that says what G$ is,
 * how to get it, what it buys, how it is earned back and where every G$ paid goes, with the one next step for this player.
 * It opens from the menu, and once by itself on a first visit. The G$ button shows the balance.
 */

const SHOP = {
  enabled: true, token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', vault: '0x00000000000000000000000000000000000ba5e1',
  items: [
    { id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null },
    { id: 'iron_broadsword', name: 'Iron Broadsword', kind: 'forge', priceG: '30', requires: null },
    { id: 'forest_glaive', name: 'Forest Glaive', kind: 'forge', priceG: '60', requires: null },
    { id: 'golden_albatross', name: 'Golden Solar Blade', kind: 'cosmetic', priceG: '150', requires: 'forest_glaive' },
    { id: 'corrupted_void', name: 'Corrupted Void Edge', kind: 'cosmetic', priceG: '150', requires: 'forest_glaive' },
    { id: 'skin_flame', name: 'Crimson Flame Katana', kind: 'cosmetic', priceG: '100', requires: null },
    { id: 'skin_frost', name: 'Frostmoon Crystal Saber', kind: 'cosmetic', priceG: '100', requires: null },
    { id: 'satchel_pet', name: 'Moon Sprite', kind: 'cosmetic', priceG: '80', requires: null },
  ],
};
const CONFIG = { prizesEnabled: true, prizesG: ['1000', '600', '300'], shardRateG: '2', dailyShardCap: 50 };
const CONFIG_OFF = { prizesEnabled: false, prizesG: [], shardRateG: '0', dailyShardCap: 0 };
const visitor = {
  connected: false, verified: false, status: 'anonymous', offline: false, hasWallet: true, busy: null, wrongChain: false, needsReconnect: false,
  shop: SHOP, owned: null, balance: null, rewards: null, ubi: null, bounty: null, awaiting: { ubi: null, bounty: null, spoils: {}, shop: {} },
};
const player = (over = {}) => ({
  ...visitor, connected: true, verified: true, status: 'verified', shortAddress: '0xabcd…ef01', owned: ['iron_starter'], balance: '57.5',
  rewards: { firstBossPrizeG: 2400 }, ubi: { entitlementG: '114.5', canClaim: false, nextClaimAt: null }, ...over,
});
const guide = (s, config = CONFIG) => renderGuideHtml(s, { config, now: 0 });

test('the guide tells the whole story: what G$ is, claim, the blade, forging, the Moon Shop, earning, and where it goes', () => {
  const h = guide(visitor);
  assert.match(h, /GoodDollar/);
  assert.match(h, /free/i);
  assert.match(h, /CLAIM/);
  assert.match(h, /Blessing/);
  assert.match(h, /Rusted Shortsword[^<]*<\/b>[^<]*20 G\$/);
  assert.match(h, /Iron Broadsword[^<]*<\/b>[^<]*30 G\$/);
  assert.match(h, /Forest Glaive[^<]*<\/b>[^<]*60 G\$/);
  assert.match(h, /materials/i);
  assert.match(h, /MOON SHOP/);
  assert.match(h, /looks only/i);
  assert.match(h, /skins[^.]*100 G\$/i);
  assert.match(h, /Celestial blades[^.]*150 G\$/i);
  assert.match(h, /Moon Sprite[^.]*80 G\$/);
  assert.match(h, /1,000 \/ 600 \/ 300 G\$/);
  assert.match(h, /2 G\$ a Shard, up to 100 G\$ a day/);
  assert.match(h, /prize vault/i);
  assert.match(h, /celoscan\.io\/address\/0x00000000000000000000000000000000000ba5e1/);
  assert.match(h, /stats\.html/);
});

test('the guide ends with this player\'s next step, as the gate has it', () => {
  assert.match(guide(visitor), /data-act="connect"/);
  assert.match(guide(player({ verified: false, status: 'unverified', owned: null })), /data-act="verify"/);
  const noBlade = guide(player({ owned: [] }));
  assert.match(noBlade, /data-act="buy" data-id="iron_starter"/);
  const short = guide(player({ owned: [], balance: '3', ubi: { entitlementG: '114.5', canClaim: true, nextClaimAt: null } }));
  assert.match(short, /data-act="ubi"/);
  assert.doesNotMatch(short, /data-act="buy"/);
  const ready = guide(player());
  assert.match(ready, /all set/i);
  assert.doesNotMatch(ready, /data-act="(buy|connect|verify)"/);
  assert.match(ready, /Your G\$: <b>57\.5<\/b>/);
});

test('the first-boss bounty is named with the player\'s share when the server gave it, and never invented', () => {
  assert.match(guide(player()), /2,400 G\$/);
  assert.doesNotMatch(guide(visitor), /2,400/);
  assert.match(guide(visitor), /one-time G\$ bounty/);
});

test('without the server\'s numbers the guide says less, and invents nothing', () => {
  const unknown = guide(visitor, null); // nothing known about prizes: none is promised at all
  assert.doesNotMatch(unknown, /1,000|top 3|Shard Harvest/);
  const h = guide({ ...visitor, prizes: true }, null); // prizes on, their amounts not loaded
  assert.doesNotMatch(h, /1,000|up to 100 G\$ a day/);
  assert.match(h, /top 3/);
  const noShop = guide({ ...visitor, shop: null });
  assert.doesNotMatch(noShop, /20 G\$/);
  assert.match(noShop, /prices/i);
});

test('on a server with no Moon Shop the guide says the first blade is free and nothing is sold', () => {
  const h = guide({ ...visitor, shop: { enabled: false, token: SHOP.token, vault: null, items: [] } });
  assert.match(h, /free/i);
  assert.doesNotMatch(h, /MOON SHOP \(LOOKS ONLY\)/);
  assert.doesNotMatch(h, /20 G\$/);
});

test('names from the server are escaped', () => {
  const h = guide({ ...visitor, shop: { ...SHOP, items: [{ ...SHOP.items[0], name: '<img src=x>' }, ...SHOP.items.slice(1)] } });
  assert.doesNotMatch(h, /<img src=x>/);
});

test('the G$ button shows the balance of a verified player', () => {
  assert.equal(walletPillText(visitor), 'G$');
  assert.equal(walletPillText(player({ verified: false, status: 'unverified' })), '0xabcd…ef01');
  assert.equal(walletPillText(player({ balance: null })), 'G$ ✔');
  assert.equal(walletPillText(player({ balance: '57.519' })), 'G$ 57.51');
  assert.equal(walletPillText(player({ balance: '1234.5' })), 'G$ 1,234');
  assert.equal(walletPillText(player({ balance: '0' })), 'G$ 0');
});

test('the guide opens by itself once, on the first visit', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(takeFirstVisit(storage), true);
  assert.equal(takeFirstVisit(storage), false);
  assert.equal(takeFirstVisit({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), false, 'blocked storage: never pester');
});

test('with prizes off the guide promises none: claim, spend, the bounty, and where the G$ goes', () => {
  for (const h of [guide(player(), CONFIG_OFF), guide({ ...player(), prizes: false }, null)]) {
    assert.doesNotMatch(h, /Daily prizes|top 3|Shard Harvest|win it back/i);
    assert.match(h, /CLAIM IT FREE, EVERY DAY/);
    assert.match(h, /BUY YOUR BLADE/);
    assert.match(h, /First-boss bounty: <b>2,400 G\$<\/b>/);
    assert.match(h, /prize vault/i);
    assert.doesNotMatch(h, /pays the daily prizes/);
  }
});
