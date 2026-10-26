// G$ in plain sight, in a real browser, with the API stood in for (no chain: the real payment is proven by the fork runs):
//   the way in has a blade step: a verified player with no blade is stopped there, and is let through once they own one
//   coming back from the face scan with no blade picks up at the blade step
//   nothing opens by itself on a first visit; "How G$ works" is a card in the wallet that the player opens, with the server's prices
//   the Shop prices each item in G$ (blades by realm, armour, looks), and a visitor who presses one is sent to the wallet panel
//   what the Shop does: tabs, equip a blade or a piece of armour, craft from materials where nothing is sold, Esc and the buttons
//   node test/client/browser/shop.mjs        (run from the repository root)
import { bootGame, clickMenu, closeSheet, playButton, sheetName, sheetOpen, sheetText, waitSheet } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const active = (page, key) => page.evaluate((k) => window.game.scene.isActive(k), key);

// ---- 1. the blade step of the way in ----------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true });
  try {
    const api = await installApi(g.page, { verified: true, owned: [] });
    await g.goto();
    log('▶ a verified human with no blade');
    await clickMenu(g.page, 'endless');
    check(await waitSheet(g.page, /Get your blade/), 'the gate stops them at the blade step: buy the blade with G$');
    const text = await sheetText(g.page);
    check(/Buy for 20 G\$/.test(text) && /Rusted Shortsword/.test(text), 'with the blade and its price on the button');
    check(/prize vault/.test(text), 'and where the G$ goes');
    check(!/Play Endless mode/.test(text), 'no Play yet');
    check(!(await active(g.page, 'SurvivalScene')), 'the mode did not start');
    await closeSheet(g.page);
    check(/Buy your blade \(20 G\$\)/.test((await playButton(g.page)).sub), 'the menu\'s big button says the same');
    await clickMenu(g.page, 'endless');
    await waitSheet(g.page, /Get your blade/);

    log('▶ once the blade is theirs');
    api.owned = ['iron_starter']; // what the server says after it has confirmed the payment
    await g.page.evaluate(() => window.__gdPanel.open()); // the sheet refreshes when it opens; the gate request is kept
    check(await waitSheet(g.page, /Play Endless mode/), 'the gate offers Play');
    await g.page.click('#ms-sheets [data-act="play"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
    check(true, 'and Play starts the mode');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 2. back from the face scan with no blade --------------------------------------------------------------------------
{
  const remembered = `sessionStorage.setItem('moonshard.gate.v1', JSON.stringify({ key: 'SurvivalScene', data: null, at: Date.now() }));`;
  const g = await bootGame({ api: true, init: sessionInit() + remembered });
  try {
    await installApi(g.page, { verified: true, owned: [] });
    log('▶ back from the face scan, verified, no blade yet');
    await g.goto();
    check(await waitSheet(g.page, /Get your blade/), 'the mode they asked for is picked up at the blade step');
    check(!(await active(g.page, 'SurvivalScene')), 'nothing started by itself');
  } finally { await g.close(); }
}

// ---- 3. "How G$ works" -------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true });
  try {
    await installApi(g.page, { verified: false });
    log('▶ a first visit');
    await g.goto();
    await g.page.waitForTimeout(1500);
    check(!(await sheetOpen(g.page)), 'nothing opens by itself: no guide, no panel');

    log('▶ the card in the wallet');
    await clickMenu(g.page, 'wallet');
    check(await waitSheet(g.page, /How G\$ works/), 'the wallet has a "How G$ works" card');
    check((await sheetName(g.page)) === 'wallet', 'in the wallet, not as a sheet of its own');
    check(!(await g.page.evaluate(() => document.querySelector('#ms-sheets details.how').open)), 'closed until the player opens it');
    await g.page.click('#ms-sheets details.how summary');
    check(await waitSheet(g.page, /Rusted Shortsword: 20 G\$/), 'opened, it has the prices from the server');
    const text = await sheetText(g.page);
    check(/Claim it once a day/.test(text) && /Moon Shop sells looks only/.test(text) && /prize vault/.test(text), 'claim, spend, and where it goes');
    check(/Connect wallet/.test(text), 'and the wallet offers the next step: connect');
    await closeSheet(g.page);
    check(!(await sheetOpen(g.page)), 'it closes');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 4. the Shop ---------------------------------------------------------------------------------------------------------
const card = (id) => `.sh-card[data-id="${id}"]`;
/** What a card's button says, the way a player reads it. */
const button = (page, id) => page.evaluate((sel) => document.querySelector(`${sel} .sh-btn`)?.innerText.trim() ?? null, card(id));
/** The G$ price a card that cannot be bought yet shows (the gold chip), or null. */
const priceChip = (page, id) => page.evaluate((sel) => document.querySelector(`${sel} .sh-cost.g`)?.innerText.replace(/\s+/g, ' ').trim() ?? null, card(id));
const openTab = async (page, key) => {
  await page.click(`.sh [data-act="tab"][data-tab="${key}"]`);
  await page.waitForSelector(`.sh .sh-tab.on[data-tab="${key}"]`);
};
const shopReady = (page) => page.waitForSelector('.sh .sh-card', { timeout: 30_000 });
/** What this device has saved: its inventory, what it owns and wears. */
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('MOONSHARD_SAVE_V1') || '{}'));
const kitText = (page) => page.evaluate(() => document.querySelector('.sh-kit')?.innerText.replace(/\s+/g, ' ') ?? '');
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.ms-toast')].map((t) => t.textContent));
const CLOSED_SHOP = { enabled: false, token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A', vault: null, items: [] };

{
  const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true });
  try {
    await installApi(g.page, { verified: true, owned: ['iron_starter'] });
    await g.goto();
    log('▶ the Shop prices every item in G$');
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    check(/forest materials and a G\$ fee/.test(await g.page.innerText('.sh-note')), 'the fine print says how blades and armour are paid for');
    check((await g.page.innerText('.sh-title')) === 'Shop', 'it is called the Shop');

    log('▶ blades, a section for each realm');
    check((await button(g.page, 'iron_starter')) === 'Equipped', 'the owned blade is equipped');
    check((await button(g.page, 'iron_broadsword')) === 'Forge · 30 G$', 'the Iron Broadsword: materials plus a 30 G$ fee');
    check((await button(g.page, 'forest_glaive')) === 'Forge · 60 G$', 'the Forest Glaive: materials plus a 60 G$ fee');
    const realms = await g.page.$$eval('.sh-sec-h', (hs) => hs.map((h) => h.innerText.trim()));
    check(['The High Forest', 'The Hive Canopy', 'The Sunken Ruins', 'The Obsidian Caldera', 'The Lunar Spire'].join() === realms.join(), 'one section for each realm, in the order the levels lead there');
    const past = ['moonsteel_blade', 'starforged_edge', 'cinderbrand', 'voidglass_reaver'];
    check((await Promise.all(past.map((id) => button(g.page, id)))).join(' | ') === 'Needs Forest Glaive | Needs Moonsteel Blade | Needs Starforged Edge | Needs Cinderbrand', 'each blade past the Glaive waits for the blade before it');
    check((await Promise.all(past.map((id) => priceChip(g.page, id)))).join(' | ') === '100 G$ | 160 G$ | 200 G$ | 240 G$', 'and shows its G$ price while it waits');
    check(/against bees, flying eyes and hornet guards/.test(await g.page.innerText(card('moonsteel_blade'))), 'a blade says which beasts it is the bane of');
    check(/against boars/.test(await g.page.innerText(card('forest_glaive'))), 'the Glaive has the woods');

    log('▶ armour');
    await openTab(g.page, 'armour');
    check((await button(g.page, 'leather_cap')) === 'Forge · 15 G$' && (await button(g.page, 'oak_buckler')) === 'Forge · 15 G$', 'the first helm and the first shield: 15 G$ each');
    check((await button(g.page, 'chitin_helm')) === 'Needs Leather Cap' && (await button(g.page, 'honeycomb_shield')) === 'Needs Oak Buckler', 'the next tier waits for the one before it');
    check((await g.page.$$('.sh-card')).length === 11, 'ten pieces of armour, and the relic');
    check(/8% off blows from foes/.test(await g.page.innerText(card('leather_cap'))) && /12% off what foes throw/.test(await g.page.innerText(card('oak_buckler'))), 'a helm says what it takes off blows, a shield what it takes off what is thrown');
    check((await button(g.page, 'relic_reroll')) === 'Re-roll', 'the relic re-roll is still materials only');

    log('▶ looks');
    await openTab(g.page, 'looks');
    const skins = await Promise.all(['skin_flame', 'skin_frost', 'skin_verdant'].map((id) => button(g.page, id)));
    check(skins.every((t) => t === 'Buy · 100 G$'), 'three skins at 100 G$');
    check((await button(g.page, 'golden_albatross')) === 'Needs Forest Glaive' && (await button(g.page, 'corrupted_void')) === 'Needs Forest Glaive', 'the Celestial blades wait for the Glaive');
    check((await button(g.page, 'satchel_pet')) === 'Buy · 80 G$', 'the Moon Sprite at 80 G$');
    check(!(await g.page.$(`${card('skin_flame')} .sh-costs`)), 'a look is bought with G$ alone: no materials on its card');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}
{
  const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true });
  try {
    const api = await installApi(g.page, { verified: true, owned: ['iron_starter', 'forest_glaive'], bestLevel: 7 });
    await g.goto();
    log('▶ a blade past the Glaive opens when the player has been deep enough in Endless');
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    check((await button(g.page, 'moonsteel_blade')) === 'Reach level 8 in Endless', 'with the Glaive and level 7, the Moonsteel Blade says to reach level 8');
    api.bestLevel = 8; // what the server answers once a run that reached level 8 has been submitted
    await g.page.evaluate(() => window.__gdPanel.open()); // the wallet refreshes the player's status when it opens
    await waitSheet(g.page, /./);
    await closeSheet(g.page);
    await g.page.waitForFunction((sel) => document.querySelector(`${sel} .sh-btn`)?.innerText.trim() === 'Forge · 100 G$', card('moonsteel_blade'), { timeout: 15_000 });
    check(true, 'at level 8 it is forged from materials and a 100 G$ fee, with no reload');
    const chips = await g.page.$$eval(`${card('moonsteel_blade')} .sh-cost`, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    check(chips.join(' | ') === '20 Bark | 12 Amber | 12 Iron', `its materials are on the card (${chips.join(' | ')})`);
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}
{
  const g = await bootGame();
  try {
    log('▶ a visitor whose server cannot be reached');
    await g.goto();
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    await openTab(g.page, 'looks');
    // a visitor's page cannot reach the API in this check, so the catalog is not known: nothing is offered for sale
    check(/Shop offline|Loading the shop/.test(await button(g.page, 'skin_flame')), 'with the server out of reach, nothing is offered for sale');
    check(/reach the server|Loading the shop/.test(await g.page.evaluate(() => document.querySelector('.sh-notice')?.innerText ?? '')), 'and the shop says why');
  } finally { await g.close(); }
}
{
  const g = await bootGame({ api: true });
  try {
    await installApi(g.page, { verified: false });
    await g.goto();
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    await openTab(g.page, 'looks');
    log('▶ a visitor presses a G$ item');
    await g.page.waitForFunction((sel) => /Buy/.test(document.querySelector(`${sel} .sh-btn`)?.innerText ?? ''), card('skin_flame'), { timeout: 15_000 });
    check(/Connect a wallet to buy with G\$/.test(await g.page.innerText('.sh-notice')), 'the shop tells a visitor to connect first');
    await g.page.click(`${card('skin_flame')} .sh-btn`);
    check(await waitSheet(g.page, /Connect wallet/), 'pressing Buy sends a visitor to the wallet sheet (connect, then verify)');
    await closeSheet(g.page);
    await g.page.click('.sh-notice');
    check(await waitSheet(g.page, /Connect wallet/), 'and so does the notice');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 5. what the Shop does ----------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true });
  try {
    await installApi(g.page, { verified: true, owned: ['iron_starter', 'iron_broadsword', 'leather_cap', 'chitin_helm', 'oak_buckler'], bestLevel: 8 });
    await g.goto();
    log('▶ equip a blade');
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    await g.page.click(`${card('iron_broadsword')} .sh-btn`);
    await g.page.waitForFunction((sel) => document.querySelector(`${sel} .sh-btn`)?.innerText.trim() === 'Equipped', card('iron_broadsword'));
    check((await saved(g.page)).equippedWeapon === 'iron_broadsword', 'the Iron Broadsword is the blade this device wears');
    check((await button(g.page, 'iron_starter')) === 'Equip', 'and the one before it can be put back on');
    check(/Iron Broadsword/.test(await kitText(g.page)) && /x1\.25 damage/.test(await kitText(g.page)), 'the kit at the top shows it');

    log('▶ armour: the best piece owned is worn, and any other can be put on');
    await openTab(g.page, 'armour');
    check((await button(g.page, 'chitin_helm')) === 'Equipped' && (await button(g.page, 'oak_buckler')) === 'Equipped', 'the best helm and shield owned are on');
    check(/Chitin Helm/.test(await kitText(g.page)) && /14% from blows/.test(await kitText(g.page)), 'the kit shows the helm and what it takes off');
    await g.page.click(`${card('leather_cap')} .sh-btn`);
    await g.page.waitForFunction((sel) => document.querySelector(`${sel} .sh-btn`)?.innerText.trim() === 'Equipped', card('leather_cap'));
    const worn = await saved(g.page);
    check(worn.equippedHelm === 'leather_cap' && worn.equippedShield === 'oak_buckler', 'the Leather Cap replaces the Chitin Helm, the shield stays');
    check((await button(g.page, 'chitin_helm')) === 'Equip', 'the helm it replaced can be put back on');
    check(/Leather Cap/.test(await kitText(g.page)) && /8% from blows/.test(await kitText(g.page)), 'the kit follows');

    log('▶ the tab and the list survive a turn of the phone');
    await openTab(g.page, 'looks');
    await g.page.setViewportSize({ width: 844, height: 390 });
    await g.page.waitForTimeout(400);
    check(await g.page.evaluate(() => document.querySelector('.sh-tab.on')?.dataset.tab === 'looks'), 'on its side: still on the same tab');
    check(await g.page.evaluate(() => document.querySelectorAll('.sh').length === 1), 'and still one screen');
    await g.page.setViewportSize({ width: 390, height: 664 });
    await g.page.waitForTimeout(400);
    check(await g.page.evaluate(() => document.querySelector('.sh-tab.on')?.dataset.tab === 'looks'), 'upright again: still on the same tab');

    log('▶ leaving');
    await g.page.keyboard.press('Escape');
    await g.page.waitForFunction(() => window.game.scene.isActive('MenuScene') && !window.game.scene.isActive('ForgeScene'), null, { timeout: 15_000 });
    check(await g.page.evaluate(() => !document.querySelector('.sh') && !document.querySelector('#ms-ic-bark')), 'Esc goes back to the menu and the shop is taken down with its icons');
    await clickMenu(g.page, 'forge');
    await g.page.waitForFunction(() => window.game.scene.isActive('ForgeScene'), null, { timeout: 15_000 });
    await shopReady(g.page);
    check(await g.page.evaluate(() => document.querySelectorAll('.sh').length === 1 && document.querySelectorAll('#ms-ic-bark').length === 1), 'the menu\'s Shop tile opens it again: one screen, one set of icons');
    await g.page.click('.sh [data-act="menu"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('MenuScene'), null, { timeout: 15_000 });
    check(true, 'the Menu button goes back too');
    await clickMenu(g.page, 'forge');
    await g.page.waitForFunction(() => window.game.scene.isActive('ForgeScene'), null, { timeout: 15_000 });
    await shopReady(g.page);
    await g.page.click('.sh [data-act="endless"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
    check(await g.page.evaluate(() => !document.querySelector('.sh')), 'Play Endless starts the run and the shop is gone');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}
{
  const g = await bootGame({ api: true, init: sessionInit() + "(() => { const k = 'MOONSHARD_SAVE_V1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, { inventory: { bark: 25, amber: 15, iron: 10 } }); localStorage.setItem(k, JSON.stringify(s)); })();", tutorialDone: true });
  try {
    await installApi(g.page, { verified: true, shop: CLOSED_SHOP, owned: [] });
    await g.goto();
    log('▶ a server with no shop: everything is crafted from forest materials');
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    check(/No shop is open on this server/.test(await g.page.innerText('.sh-notice')), 'the shop says so');
    check((await button(g.page, 'iron_broadsword')) === 'Craft', 'the Iron Broadsword is a craft');
    await g.page.click(`${card('iron_broadsword')} .sh-btn`);
    await g.page.waitForFunction((sel) => document.querySelector(`${sel} .sh-btn`)?.innerText.trim() === 'Equipped', card('iron_broadsword'));
    let save = await saved(g.page);
    check(save.unlockedWeapons.includes('iron_broadsword') && save.equippedWeapon === 'iron_broadsword', 'crafted, owned and worn');
    check(save.inventory.bark === 15 && save.inventory.iron === 5, `its materials are spent (${JSON.stringify(save.inventory)})`);
    check((await g.page.$$eval('.sh-mats li', (els) => els.map((e) => e.innerText.trim()))).join(',') === '15,15,5', 'and the head counts what is left');

    await openTab(g.page, 'armour');
    await g.page.click(`${card('leather_cap')} .sh-btn`);
    await g.page.waitForFunction((sel) => document.querySelector(`${sel} .sh-btn`)?.innerText.trim() === 'Equipped', card('leather_cap'));
    save = await saved(g.page);
    check(save.unlockedArmour.includes('leather_cap') && save.equippedHelm === 'leather_cap', 'a helm is crafted, owned and worn the same way');

    await g.page.click(`${card('relic_reroll')} .sh-btn`);
    await g.page.waitForFunction(() => document.querySelector('.ms-toast')?.textContent.includes('Relic perk re-rolled'), null, { timeout: 10_000 });
    const after = await saved(g.page);
    check(after.activePerk !== 'magnet' && after.inventory.bark === save.inventory.bark - 2 && after.inventory.amber === save.inventory.amber - 2, `the re-roll draws another perk for 2 Bark and 2 Amber (${after.activePerk})`);
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}
{
  const g = await bootGame({ api: true, init: sessionInit() + "(() => { const k = 'MOONSHARD_SAVE_V1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, { inventory: { bark: 1, amber: 0, iron: 0 } }); localStorage.setItem(k, JSON.stringify(s)); })();", tutorialDone: true });
  try {
    await installApi(g.page, { verified: true, shop: CLOSED_SHOP, owned: [] });
    await g.goto();
    log('▶ too few materials');
    await g.startScene('ForgeScene');
    await shopReady(g.page);
    check((await button(g.page, 'iron_broadsword')) === 'Craft', 'the button is still there');
    await g.page.click(`${card('iron_broadsword')} .sh-btn`);
    await g.page.waitForFunction(() => document.querySelector('.ms-toast')?.textContent.includes('Not enough forest materials'), null, { timeout: 10_000 });
    check(/Needs 10 Bark, 5 Iron/.test((await toasts(g.page)).join(' ')), 'pressing it says what is missing');
    const save = await saved(g.page);
    check(!save.unlockedWeapons.includes('iron_broadsword') && save.inventory.bark === 1, 'and nothing is spent');
    check(await g.page.evaluate((sel) => document.querySelector(`${sel} .sh-cost.lack`) !== null, card('iron_broadsword')), 'the materials it lacks are marked on the card');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ shop check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ shop check passed');
