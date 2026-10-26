import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnits } from 'viem';
import { GAME } from '../../server/config.js';
import { GAME_CONFIG } from '../../src/config.js';
import { REALM_ORDER, REALMS } from '../../src/engine/levels.js';
import { ARMOUR } from '../../src/engine/gear.js';
import { walletG } from '../../src/gd/format.js';
import { SHOP_ICONS, TABS, noticeFor, shopHtml, shopModel } from '../../src/ui/shopView.js';

/*
 * The shop, as data and as markup: what each card offers a player in each state (the offer itself is forgeOffer's, tested on its
 * own), how the three tabs are laid out, and that what comes out is safe to put on a page. No DOM: these are pure functions.
 * The catalog is the server's own (server/config.js GAME.SHOP), so a price, a requirement or a level that changes there shows up here.
 */

const W = GAME_CONFIG.WEAPONS;
const A = GAME_CONFIG.ARMOUR;
const catalog = (rename = {}) => GAME.SHOP.map(({ id, name, kind, price, requires, minLevel }) => ({
  id, name: rename[id] ?? name, kind, priceG: formatUnits(price, 18), requires: requires ?? null, ...(minLevel ? { minLevel } : {}),
}));
const SHOP = { enabled: true, token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', vault: '0x00000000000000000000000000000000000ba5e1', items: catalog() };
const CLOSED = { enabled: false, token: SHOP.token, vault: null, items: [] };
const status = (over = {}) => ({
  connected: true, verified: true, status: 'verified', offline: false, shop: SHOP, owned: ['iron_starter'], bestLevel: 0, balance: '57.5',
  awaiting: { ubi: null, bounty: null, spoils: {}, shop: {} }, ...over,
});
const ctx = (over = {}) => ({
  tab: 'blades', status: status(), mats: { bark: 105, amber: 79, iron: 86 }, weaponId: 'iron_starter', helmId: null, shieldId: null,
  unlockedWeapons: ['iron_starter'], unlockedArmour: [], petUnlocked: false, petOn: false, perkId: 'magnet', bestLevel: 0, ...over,
});
const cards = (m) => m.sections.flatMap((s) => s.cards);
const cardOf = (m, id) => cards(m).find((c) => c.id === id);
const chips = (card) => card.cost.map((c) => `${c.n} ${c.name}`);

// ---- the three tabs --------------------------------------------------------------------------------------------------

test('there are three tabs, and anything else is the blades', () => {
  assert.deepEqual(TABS.map((t) => t.key), ['blades', 'armour', 'looks']);
  assert.equal(shopModel(ctx({ tab: 'armour' })).tab, 'armour');
  assert.equal(shopModel(ctx({ tab: 'nim' })).tab, 'blades');
  assert.equal(shopModel(ctx({ tab: undefined })).tab, 'blades');
});

test('blades: a section for each realm, the woods\' three first and then the blade of each realm after it', () => {
  const m = shopModel(ctx());
  assert.deepEqual(m.sections.map((s) => s.key), REALM_ORDER);
  assert.deepEqual(m.sections.map((s) => s.cards.map((c) => c.id)), [
    ['iron_starter', 'iron_broadsword', 'forest_glaive'], ['moonsteel_blade'], ['starforged_edge'], ['cinderbrand'], ['voidglass_reaver'],
  ]);
  assert.deepEqual(m.sections.map((s) => s.title), REALM_ORDER.map((r) => REALMS[r].name));
  assert.equal(m.sections[0].sub, 'Levels 1 to 5 · home of boars, snails, mushrooms and goblins');
  assert.equal(m.sections[1].sub, 'Levels 6 to 10 · home of bees, flying eyes and hornet guards');
});

test('armour: a helm and a shield for each realm, then the relic', () => {
  const m = shopModel(ctx({ tab: 'armour' }));
  assert.deepEqual(m.sections.map((s) => s.key), [...REALM_ORDER, 'relic']);
  assert.deepEqual(m.sections[0].cards.map((c) => c.id), ['leather_cap', 'oak_buckler']);
  assert.deepEqual(m.sections[1].cards.map((c) => c.id), ['chitin_helm', 'honeycomb_shield']);
  assert.deepEqual(m.sections.at(-2).cards.map((c) => c.id), ['moonborn_crown', 'lunar_bastion']);
  assert.deepEqual(m.sections.at(-1).cards.map((c) => c.id), ['relic_reroll']);
  assert.equal(cards(m).filter((c) => c.type === 'armour').length, 10);
  assert.equal(m.sections[1].sub, 'Levels 6 to 10');
});

test('an armour card says what the piece does, in words', () => {
  const m = shopModel(ctx({ tab: 'armour' }));
  assert.equal(cardOf(m, 'chitin_helm').note, 'Takes 14% off blows from foes');
  assert.equal(cardOf(m, 'honeycomb_shield').note, 'Takes 22% off what foes throw');
  assert.equal(cardOf(m, 'chitin_helm').stats, 'Helm · against blows');
  assert.equal(cardOf(m, 'honeycomb_shield').stats, 'Shield · against what is thrown');
  assert.deepEqual(cardOf(m, 'chitin_helm').art, { ico: 'helm_hive' });
  assert.deepEqual(cardOf(m, 'lunar_bastion').art, { ico: 'shield_spire' });
});

test('looks: the skins, the Celestial blades and the companion, each a look and nothing more', () => {
  const m = shopModel(ctx({ tab: 'looks' }));
  assert.deepEqual(m.sections.map((s) => s.key), ['skins', 'celestial', 'companion']);
  assert.deepEqual(m.sections.map((s) => s.cards.map((c) => c.id)), [['skin_flame', 'skin_frost', 'skin_verdant'], ['golden_albatross', 'corrupted_void'], ['satchel_pet']]);
  assert.ok(cards(m).every((c) => /^Look only/.test(c.stats)), 'every card says it is a look only');
  assert.deepEqual(cardOf(m, 'skin_flame').art, { img: '/assets/weapons/sword_flame.png' });
  assert.match(m.note, /Looks only: nothing here adds power/);
});

test('a blade says which beasts it is the bane of, and the stats of its power', () => {
  const m = shopModel(ctx());
  assert.equal(cardOf(m, 'moonsteel_blade').note, '+30% against bees, flying eyes and hornet guards');
  assert.equal(cardOf(m, 'moonsteel_blade').noteTone, 'bane');
  assert.equal(cardOf(m, 'moonsteel_blade').stats, `x${W.MOONSTEEL_BLADE.damageMul} damage · x${W.MOONSTEEL_BLADE.rangeMul} reach`);
  assert.equal(cardOf(m, 'iron_broadsword').note, null, 'a blade with no bane says nothing');
  assert.equal(cardOf(m, 'forest_glaive').note, '+30% against boars, snails, mushrooms and goblins');
  assert.equal(cardOf(m, 'iron_starter').tag, 'Standard');
  assert.equal(cardOf(m, 'iron_broadsword').tag, 'Tier 1');
});

// ---- what a button says --------------------------------------------------------------------------------------------------

test('the blade worn is Equipped, a blade owned can be put on, and neither shows a cost', () => {
  const m = shopModel(ctx({ unlockedWeapons: ['iron_starter', 'iron_broadsword'] }));
  const worn = cardOf(m, 'iron_starter');
  assert.deepEqual([worn.state, worn.offer.action, worn.button, worn.cost], ['equipped', 'none', { text: 'Equipped', tone: 'on', tick: true }, []]);
  const owned = cardOf(m, 'iron_broadsword');
  assert.deepEqual([owned.state, owned.offer.action, owned.button, owned.cost], ['owned', 'equip', { text: 'Equip', tone: 'plain' }, []]);
});

test('a blade to forge says its G$ fee and shows its materials', () => {
  const m = shopModel(ctx());
  const broadsword = cardOf(m, 'iron_broadsword');
  assert.deepEqual(broadsword.button, { text: 'Forge · 30 G$', tone: 'gold' });
  assert.equal(broadsword.offer.action, 'forge');
  assert.deepEqual(chips(broadsword), ['10 Bark', '5 Iron'], 'only the materials it needs, in a fixed order');
  assert.ok(broadsword.cost.every((c) => !c.short));
  assert.deepEqual(broadsword.press, { id: 'iron_broadsword', type: 'weapon', cost: W.IRON_BROADSWORD.cost, hasMaterials: true });
  assert.deepEqual(chips(cardOf(m, 'forest_glaive')), ['15 Bark', '10 Amber', '8 Iron']);
});

test('without the materials the button is still a price, and the materials it lacks are marked', () => {
  const m = shopModel(ctx({ mats: { bark: 10, amber: 0, iron: 2 } }));
  const broadsword = cardOf(m, 'iron_broadsword');
  assert.deepEqual(broadsword.button, { text: 'Forge · 30 G$', tone: 'gold', short: true });
  assert.equal(broadsword.offer.action, 'short');
  assert.deepEqual(broadsword.cost.map((c) => [c.name, c.short]), [['Bark', false], ['Iron', true]]);
  assert.equal(broadsword.press.hasMaterials, false);
});

test('a blade past the Glaive waits for the blade before it, then for its level, then it can be forged', () => {
  const owned = ['iron_starter', 'forest_glaive'];
  const at = (bestLevel, over = {}) => cardOf(shopModel(ctx({ status: status({ owned, bestLevel }), unlockedWeapons: owned, ...over })), 'moonsteel_blade');
  assert.equal(cardOf(shopModel(ctx()), 'moonsteel_blade').button.text, 'Needs Forest Glaive');
  assert.deepEqual(at(7).button, { text: 'Reach level 8 in Endless', tone: 'off', lock: true });
  assert.equal(at(7).offer.action, 'locked');
  assert.deepEqual(at(8).button, { text: 'Forge · 100 G$', tone: 'gold' });
  assert.equal(at(8).offer.action, 'forge');
  assert.equal(cardOf(shopModel(ctx({ status: status({ owned, bestLevel: 30 }) })), 'voidglass_reaver').button.text, 'Needs Cinderbrand');
  assert.equal(cardOf(shopModel(ctx({ status: status({ owned, bestLevel: 30 }) })), 'cinderbrand').button.text, 'Needs Starforged Edge');
});

test('a card that cannot be bought yet shows its G$ price, first among its costs; one that can has it on its button', () => {
  const m = shopModel(ctx());
  assert.deepEqual(chips(cardOf(m, 'voidglass_reaver')), ['240 G$', '40 Bark', '26 Amber', '26 Iron']);
  assert.equal(cardOf(m, 'voidglass_reaver').cost[0].g, true);
  const armour = shopModel(ctx({ tab: 'armour' }));
  assert.deepEqual(chips(cardOf(armour, 'chitin_helm')), ['50 G$', '12 Bark', '6 Amber', '6 Iron']);
  assert.deepEqual(chips(cardOf(armour, 'leather_cap')), ['8 Bark', '3 Iron'], 'forgeable now: the price is on the button, only the materials are listed');
  assert.deepEqual(cardOf(armour, 'leather_cap').button, { text: 'Forge · 15 G$', tone: 'gold' });
});

test('armour is forged like a blade: tier by tier, each piece waiting for the one before it and for its level', () => {
  const bought = ['iron_starter', 'leather_cap'];
  const at = (bestLevel) => cardOf(shopModel(ctx({ tab: 'armour', status: status({ owned: bought, bestLevel }), unlockedArmour: ['leather_cap'] })), 'chitin_helm');
  assert.equal(cardOf(shopModel(ctx({ tab: 'armour' })), 'chitin_helm').button.text, 'Needs Leather Cap');
  assert.equal(at(7).button.text, 'Reach level 8 in Endless');
  assert.deepEqual(at(8).button, { text: 'Forge · 50 G$', tone: 'gold' });
  assert.equal(cardOf(shopModel(ctx({ tab: 'armour', status: status({ owned: bought, bestLevel: 30 }) })), 'wardens_helm').button.text, 'Needs Chitin Helm');
});

test('armour worn is Equipped; another owned piece of the same slot can be put on', () => {
  const m = shopModel(ctx({ tab: 'armour', status: status({ owned: ['iron_starter', 'leather_cap', 'chitin_helm', 'oak_buckler'] }), unlockedArmour: ['leather_cap', 'chitin_helm', 'oak_buckler'], helmId: 'chitin_helm', shieldId: 'oak_buckler' }));
  assert.deepEqual([cardOf(m, 'chitin_helm').state, cardOf(m, 'chitin_helm').button.text], ['equipped', 'Equipped']);
  assert.deepEqual([cardOf(m, 'leather_cap').state, cardOf(m, 'leather_cap').button.text], ['owned', 'Equip']);
  assert.deepEqual([cardOf(m, 'oak_buckler').state, cardOf(m, 'oak_buckler').button.text], ['equipped', 'Equipped']);
  assert.equal(cardOf(m, 'leather_cap').press.type, 'armour');
});

test('a look is bought with G$ alone: its price on the button and no materials on the card', () => {
  const m = shopModel(ctx({ tab: 'looks' }));
  assert.deepEqual(cardOf(m, 'skin_flame').button, { text: 'Buy · 100 G$', tone: 'gold' });
  assert.deepEqual(cardOf(m, 'skin_flame').cost, []);
  assert.equal(cardOf(m, 'satchel_pet').button.text, 'Buy · 80 G$');
  assert.equal(cardOf(m, 'golden_albatross').button.text, 'Needs Forest Glaive');
  assert.deepEqual(chips(cardOf(m, 'golden_albatross')), ['150 G$'], 'waiting: the G$ price, and no materials, which a look does not need');
});

test('the companion: Pet on, Pet off, and nothing to buy once it is owned', () => {
  const owned = status({ owned: ['iron_starter', 'satchel_pet'] });
  const off = cardOf(shopModel(ctx({ tab: 'looks', status: owned, petUnlocked: true, petOn: false })), 'satchel_pet');
  const on = cardOf(shopModel(ctx({ tab: 'looks', status: owned, petUnlocked: true, petOn: true })), 'satchel_pet');
  assert.deepEqual([off.button, off.offer.action, off.cost], [{ text: 'Pet off', tone: 'plain' }, 'toggle', []]);
  assert.deepEqual([on.button, on.offer.action, on.state], [{ text: 'Pet on', tone: 'on', tick: true }, 'toggle', 'equipped']);
  assert.equal(on.press.type, 'satchel');
});

test('a payment on its way is Paying…, and cannot be pressed again', () => {
  const m = shopModel(ctx({ tab: 'looks', status: status({ awaiting: { ubi: null, bounty: null, spoils: {}, shop: { skin_flame: true } } }) }));
  assert.deepEqual(cardOf(m, 'skin_flame').button, { text: 'Paying…', tone: 'off', busy: true });
  assert.equal(cardOf(m, 'skin_flame').offer.action, 'wait');
  assert.equal(cardOf(m, 'skin_frost').button.text, 'Buy · 100 G$', 'the others are not held up');
});

test('a visitor is sent to the wallet by a price; they are told so at the top', () => {
  const visitor = status({ connected: false, verified: false, status: 'anonymous', owned: null, balance: null });
  const m = shopModel(ctx({ tab: 'looks', status: visitor }));
  assert.deepEqual([cardOf(m, 'skin_flame').button.text, cardOf(m, 'skin_flame').offer.action], ['Buy · 100 G$', 'wallet']);
  assert.deepEqual(m.notice, { text: 'Connect a wallet to buy with G$. Tap here.', tone: 'plain', act: 'wallet' });
  assert.equal(m.balance, null, 'no wallet, no balance');
});

test('the notice at the top: why a button asks for the wallet, or why nothing can be bought', () => {
  assert.equal(noticeFor(status()), null, 'a verified player in an open shop has nothing to be told');
  assert.deepEqual(noticeFor(status({ verified: false, status: 'unverified' })), { text: 'Verify you are human to buy with G$. Tap here.', tone: 'warn', act: 'wallet' });
  assert.deepEqual(noticeFor(status({ shop: null })), { text: 'Loading the shop…', tone: 'plain' });
  assert.deepEqual(noticeFor(status({ shop: null, offline: true })), { text: "Can't reach the server, so prices are unavailable right now.", tone: 'warn' });
  assert.match(noticeFor(status({ shop: CLOSED })).text, /No shop is open on this server/);
  assert.equal(noticeFor(status({ shop: CLOSED })).act, undefined);
});

test('the shop not yet loaded, out of reach, or closed', () => {
  const loading = shopModel(ctx({ tab: 'looks', status: status({ shop: null }) }));
  assert.deepEqual(cardOf(loading, 'skin_flame').button, { text: 'Loading the shop…', tone: 'off', lock: true });
  const offline = shopModel(ctx({ tab: 'looks', status: status({ shop: null, offline: true }) }));
  assert.deepEqual(cardOf(offline, 'skin_flame').button, { text: 'Shop offline', tone: 'off', lock: true });
});

test('with no shop on the server everything is crafted from forest materials, and lacking them says so on the button', () => {
  const closed = (mats) => shopModel(ctx({ status: status({ shop: CLOSED, owned: [] }), mats }));
  const broadsword = cardOf(closed({ bark: 25, amber: 15, iron: 10 }), 'iron_broadsword');
  assert.deepEqual([broadsword.button, broadsword.offer.action], [{ text: 'Craft', tone: 'plain' }, 'craft']);
  assert.deepEqual(chips(broadsword), ['10 Bark', '5 Iron'], 'no G$ chip: nothing is sold');
  const poor = cardOf(closed({ bark: 1, amber: 0, iron: 0 }), 'iron_broadsword');
  assert.deepEqual([poor.button, poor.offer.action], [{ text: 'Craft', tone: 'plain', short: true }, 'short']);
  // and a blade that asks for a level waits for it on this device, once its tier is owned: the Glaive comes first
  const glaive = ['iron_starter', 'forest_glaive'];
  const deep = shopModel(ctx({ status: status({ shop: CLOSED, owned: [] }), bestLevel: 7, unlockedWeapons: glaive }));
  assert.equal(cardOf(deep, 'moonsteel_blade').button.text, 'Reach level 8 in Endless');
  const reached = shopModel(ctx({ status: status({ shop: CLOSED, owned: [] }), bestLevel: 8, unlockedWeapons: glaive }));
  assert.equal(cardOf(reached, 'moonsteel_blade').button.text, 'Craft');
  const skipped = shopModel(ctx({ status: status({ shop: CLOSED, owned: [] }), bestLevel: 8 }));
  assert.deepEqual([cardOf(skipped, 'moonsteel_blade').button.text, cardOf(skipped, 'moonsteel_blade').offer.action], ['Needs Forest Glaive', 'locked'], 'no level skips the tier under it');
  // armour the same: the Chitin Helm waits for the Leather Cap, however deep the hero has been
  const bare = shopModel(ctx({ tab: 'armour', status: status({ shop: CLOSED, owned: [] }), bestLevel: 30 }));
  assert.equal(cardOf(bare, 'chitin_helm').button.text, 'Needs Leather Cap');
  const capped = shopModel(ctx({ tab: 'armour', status: status({ shop: CLOSED, owned: [] }), bestLevel: 30, unlockedArmour: ['leather_cap'] }));
  assert.equal(cardOf(capped, 'chitin_helm').button.text, 'Craft');
});

test('the relic re-roll is materials only, whatever the shop sells, and says the perk now', () => {
  const m = shopModel(ctx({ tab: 'armour', perkId: 'haste' }));
  const reroll = cardOf(m, 'relic_reroll');
  assert.deepEqual([reroll.button, reroll.offer.action], [{ text: 'Re-roll', tone: 'plain' }, 'craft']);
  assert.deepEqual(chips(reroll), ['2 Bark', '2 Amber']);
  assert.equal(reroll.stats, 'Perk now: Sylva Breeze');
  assert.equal(reroll.press.type, 'reroll');
  const poor = cardOf(shopModel(ctx({ tab: 'armour', mats: { bark: 1, amber: 5, iron: 5 } })), 'relic_reroll');
  assert.deepEqual([poor.button, poor.offer.action, poor.cost[0].short], [{ text: 'Re-roll', tone: 'plain', short: true }, 'short', true]);
  assert.equal(cardOf(shopModel(ctx({ tab: 'armour', perkId: 'no-such-perk' })), 'relic_reroll').stats, `Perk now: ${GAME_CONFIG.PERKS[0].name}`);
});

// ---- the head and the kit -------------------------------------------------------------------------------------------------

test('the head says the materials, and the G$ balance rounded down to what can be paid', () => {
  const m = shopModel(ctx({ status: status({ balance: '420.999' }) }));
  assert.deepEqual(m.mats, [{ key: 'bark', name: 'Bark', n: 105 }, { key: 'amber', name: 'Amber', n: 79 }, { key: 'iron', name: 'Iron', n: 86 }]);
  assert.equal(m.balance, '420.99');
  assert.equal(walletG('12873.5'), '12,873.5');
  assert.equal(walletG(20), '20');
  assert.deepEqual(shopModel(ctx({ mats: undefined })).mats.map((x) => x.n), [0, 0, 0], 'no materials known: none');
});

test('the kit: the blade, the helm and the shield worn, and what they add up to', () => {
  const bare = shopModel(ctx()).kit;
  assert.equal(bare.blade.name, 'Rusted Shortsword');
  assert.equal(bare.helm, null, 'no helm worn: no helm in the kit');
  assert.equal(bare.shield, null);
  assert.deepEqual(bare.summary, { damage: 'x1', contact: 'none', ranged: 'none' });
  const dressed = shopModel(ctx({ weaponId: 'moonsteel_blade', helmId: 'chitin_helm', shieldId: 'oak_buckler' })).kit;
  assert.equal(dressed.blade.name, 'Moonsteel Blade');
  assert.deepEqual([dressed.helm.name, dressed.shield.name], ['Chitin Helm', 'Oak Buckler']);
  assert.deepEqual(dressed.summary, { damage: 'x1.8', contact: '-14%', ranged: '-12%' });
  assert.equal(shopModel(ctx({ weaponId: 'gone' })).kit.blade.name, 'Rusted Shortsword', 'an unknown blade is the first one');
});

// ---- the markup ----------------------------------------------------------------------------------------------------------

const htmlOf = (over) => shopHtml(shopModel(ctx(over)));

test('the markup has a head with the tabs, a list, and a footer with the two ways out', () => {
  const h = htmlOf();
  assert.match(h, /<h1 class="sh-title">Shop<\/h1>/);
  assert.equal((h.match(/data-act="tab"/g) || []).length, 3);
  assert.match(h, /class="sh-tab on"[^>]*aria-selected="true"[^>]*data-tab="blades"/);
  assert.match(h, /data-act="menu"/);
  assert.match(h, /data-act="endless"/);
  assert.equal((h.match(/class="sh-card[ "]/g) || []).length, 7, 'seven blades');
  assert.match(h, /sh-note/);
});

test('every button is one of the actions the scene understands, and a card names the item it is for', () => {
  for (const tab of ['blades', 'armour', 'looks']) {
    const h = htmlOf({ tab, status: status({ connected: false, verified: false, owned: null, balance: null }) });
    for (const act of h.match(/data-act="[^"]*"/g)) assert.ok(['tab', 'offer', 'menu', 'endless', 'wallet'].includes(act.slice(10, -1)), act);
    for (const btn of h.match(/<button[^>]*data-act="offer"[^>]*>/g)) assert.match(btn, /data-id="[a-z_]+" data-action="[a-z]+"/);
  }
});

test('a button that cannot be pressed is disabled: what is worn, what is locked, what is being paid for', () => {
  const m = shopModel(ctx({ tab: 'looks', status: status({ awaiting: { ubi: null, bounty: null, spoils: {}, shop: { skin_flame: true } } }) }));
  const h = shopHtml(m);
  const button = (id) => h.match(new RegExp(`<button[^>]*data-id="${id}"[^>]*>`))[0];
  assert.match(button('skin_flame'), /disabled/, 'paying');
  assert.match(button('golden_albatross'), /disabled/, 'locked');
  assert.doesNotMatch(button('skin_frost'), /disabled/, 'for sale');
  assert.match(shopHtml(shopModel(ctx())).match(/<button[^>]*data-id="iron_starter"[^>]*>/)[0], /disabled/, 'worn');
});

test('every icon the markup draws is in the sprite the screen makes, in every state', () => {
  const states = [
    ctx(), ctx({ tab: 'armour' }), ctx({ tab: 'looks' }),
    ctx({ tab: 'armour', helmId: 'moonborn_crown', shieldId: 'lunar_bastion', weaponId: 'voidglass_reaver' }),
    ctx({ tab: 'blades', status: status({ shop: CLOSED }) }),
  ];
  for (const state of states) {
    const used = new Set([...shopHtml(shopModel(state)).matchAll(/href="#ms-ic-([a-z_]+)"/g)].map((x) => x[1]));
    assert.ok(used.size > 5);
    for (const name of used) assert.ok(SHOP_ICONS.includes(name), `${name} is in SHOP_ICONS`);
  }
  assert.equal(new Set(SHOP_ICONS).size, SHOP_ICONS.length, 'no icon twice');
  for (const piece of ARMOUR) assert.ok(SHOP_ICONS.includes(`${piece.slot}_${piece.realm}`), piece.id);
});

test('the markup stays small, because an icon is a reference and not its pixels', () => {
  for (const tab of ['blades', 'armour', 'looks']) assert.ok(htmlOf({ tab }).length < 24_000, `${tab}: ${htmlOf({ tab }).length} bytes`);
});

test('what comes from the server is escaped: a name with markup in it is text, never a tag', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const hostile = { ...SHOP, items: catalog({ forest_glaive: evil }) };
  const h = htmlOf({ status: status({ shop: hostile, owned: ['iron_starter'] }) });
  assert.ok(!h.includes('<img src=x'), 'no raw tag');
  assert.ok(!/onerror=alert/.test(h.replace(/&lt;img src=x onerror=alert\(1\)&gt;/gi, '')), 'only as escaped text');
  assert.match(h, /Needs &lt;img src=x onerror=alert\(1\)&gt;/i);
});

test('every piece in the shop has art, a tier tag and a button, in whatever state it is', () => {
  for (const tab of ['blades', 'armour', 'looks']) {
    for (const c of cards(shopModel(ctx({ tab })))) {
      assert.ok(c.art.ico || c.art.img, c.id);
      assert.ok(c.name && c.tag && c.stats, c.id);
      assert.ok(c.button.text, c.id);
      assert.ok(['gold', 'plain', 'on', 'off'].includes(c.button.tone), c.id);
      assert.ok(['equip', 'none', 'toggle', 'craft', 'short', 'wait', 'locked', 'buy', 'forge', 'wallet'].includes(c.offer.action), c.id);
    }
  }
});

test('the armour the client wears is the armour the shop lists, each once', () => {
  const listed = cards(shopModel(ctx({ tab: 'armour' }))).filter((c) => c.type === 'armour').map((c) => c.id).sort();
  assert.deepEqual(listed, Object.values(A).map((a) => a.id).sort());
});
