// G$ in plain sight, in a real browser, with the API stood in for (no chain: the real payment is proven by the fork runs):
//   the way in has a blade step: a verified player with no blade is stopped there, and is let through once they own one
//   coming back from the face scan with no blade picks up at the blade step
//   the G$ guide opens by itself on a first visit and never again; the menu's G$ row opens it
//   the Forge prices each item in G$, and a visitor who presses one is sent to the wallet panel
//   node test/client/browser/shop.mjs        (run from the repository root)
import { bootGame, clickMenuRow, inScene, sceneTexts, settled } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const active = (page, key) => page.evaluate((k) => window.game.scene.isActive(k), key);
const panelOpen = (page) => page.evaluate(() => Boolean(document.querySelector('#gd-panel')) && !document.querySelector('#gd-panel').classList.contains('hidden'));
const panelText = (page) => page.evaluate(() => document.querySelector('#gd-panel')?.innerText ?? '');
const waitPanel = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#gd-panel')?.innerText ?? ''), re.source, { timeout: 20_000 })
  .then(() => true, () => false);

/** A real mouse click on the Forge button whose label starts with `label`. */
async function clickForgeButton(page, label) {
  await settled(page, 'ForgeScene');
  const at = await inScene(page, 'ForgeScene', (scene, text) => {
    const t = scene.contentContainer.list.find((o) => o.type === 'Text' && o.text.startsWith(text));
    const b = scene.contentContainer.list.find((o) => o.type === 'Rectangle' && o.input && Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1).getBounds();
    const r = window.game.canvas.getBoundingClientRect();
    const k = r.width / window.game.scale.width;
    return { x: r.left + (b.x + b.width / 2) * k, y: r.top + (b.y + b.height / 2) * k };
  }, label);
  await page.mouse.click(at.x, at.y);
}

// ---- 1. the blade step of the way in ----------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit() });
  try {
    const api = await installApi(g.page, { verified: true, owned: [] });
    await g.goto();
    log('▶ a verified human with no blade');
    await clickMenuRow(g.page, 'ENDLESS MODE');
    check(await waitPanel(g.page, /3\. Buy your blade with G\$/), 'the gate stops them at step three: buy the blade with G$');
    const text = await panelText(g.page);
    check(/BUY RUSTED SHORTSWORD — 20 G\$/.test(text), 'with the blade and its price on the button');
    check(/prize vault/.test(text), 'and where the G$ goes');
    check(!/PLAY ENDLESS MODE ▶/.test(text), 'no PLAY yet');
    check(!(await active(g.page, 'SurvivalScene')), 'the mode did not start');
    check(/BUY YOUR BLADE \(20 G\$\)/.test((await sceneTexts(g.page, 'MenuScene')).join(' ')), 'the menu line says the same');

    log('▶ once the blade is theirs');
    api.owned = ['iron_starter']; // what the server says after it has confirmed the payment
    await g.page.evaluate(() => window.__gdPanel.open()); // the panel refreshes when it opens; the gate request is kept
    check(await waitPanel(g.page, /PLAY ENDLESS MODE/), 'the gate offers PLAY');
    await g.page.click('[data-act="play"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
    check(true, 'and PLAY starts the mode');
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
    check(await waitPanel(g.page, /3\. Buy your blade with G\$/), 'the mode they asked for is picked up at the blade step');
    check(!(await active(g.page, 'SurvivalScene')), 'nothing started by itself');
  } finally { await g.close(); }
}

// ---- 3. the G$ guide ----------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ guide: true, api: true });
  try {
    await installApi(g.page, { verified: false });
    log('▶ a first visit');
    await g.goto();
    check(await waitPanel(g.page, /WHAT G\$ IS/), 'the G$ guide opens by itself');
    check(await waitPanel(g.page, /Rusted Shortsword: 20 G\$/), 'with the prices from the server');
    const text = await panelText(g.page);
    check(/G\$ IN MOONSHARD/.test(text), 'titled as the guide, not the wallet');
    check(/CLAIM IT FREE, EVERY DAY/.test(text) && /MOON SHOP \(LOOKS ONLY\)/.test(text) && /WHERE YOUR G\$ GOES/.test(text), 'claim, spend, and where it goes');
    check(/CONNECT WALLET/.test(text), 'and ends with the next step: connect');
    await g.page.click('#gd-close');
    check(!(await panelOpen(g.page)), 'it closes');

    log('▶ the menu row');
    await clickMenuRow(g.page, 'G$: EARN & SPEND');
    check(await waitPanel(g.page, /WHAT G\$ IS/), 'the G$ row opens the guide');
    await g.page.click('#gd-close');

    log('▶ the next visit');
    await g.goto();
    await g.page.waitForTimeout(1500);
    check(!(await panelOpen(g.page)), 'the guide does not open by itself again');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 4. the Forge ---------------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit() });
  try {
    await installApi(g.page, { verified: true, owned: ['iron_starter'] });
    await g.goto();
    log('▶ the Forge prices every item in G$');
    await g.startScene('ForgeScene');
    await settled(g.page, 'ForgeScene');
    const tab = async (name) => {
      await inScene(g.page, 'ForgeScene', (scene, t) => scene[t].emit('pointerdown'), name);
      return (await inScene(g.page, 'ForgeScene', (scene) => scene.contentContainer.list.filter((o) => o.type === 'Text').map((o) => o.text))).join(' | ');
    };
    const header = (await sceneTexts(g.page, 'ForgeScene')).join(' | ');
    check(/forest materials \+ a G\$ fee/.test(header), 'the header says how blades and looks are paid for');
    const blades = await tab('tabFree');
    check(/FORGE \+ 30 G\$\n10B\/5I/.test(blades), 'the Iron Broadsword: materials plus a 30 G$ fee');
    check(/FORGE \+ 60 G\$\n15B\/10A\/8I/.test(blades), 'the Forest Glaive: materials plus a 60 G$ fee');
    check(/EQUIPPED/.test(blades), 'the owned blade is equipped');
    const skins = await tab('tabSkins');
    check((skins.match(/BUY\n100 G\$/g) || []).length === 3, 'three skins at 100 G$');
    const nim = await tab('tabNim');
    check((nim.match(/NEEDS\nFOREST GLAIVE/g) || []).length === 2, 'the Celestial blades wait for the Glaive');
    check(/BUY\n80 G\$/.test(nim), 'the Moon Sprite at 80 G$');
    check(/REROLL/.test(nim), 'the relic re-roll is still materials only');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}
{
  const g = await bootGame();
  try {
    log('▶ a visitor presses a G$ item');
    await g.goto();
    await g.startScene('ForgeScene');
    await inScene(g.page, 'ForgeScene', (scene) => scene.tabSkins.emit('pointerdown'));
    // a visitor's page cannot reach the API in this check, so the catalog is not known: nothing is offered for sale
    const offline = (await inScene(g.page, 'ForgeScene', (scene) => scene.contentContainer.list.filter((o) => o.type === 'Text').map((o) => o.text))).join(' | ');
    check(/SHOP\nOFFLINE|LOADING…/.test(offline), 'with the server out of reach, nothing is offered for sale');
  } finally { await g.close(); }
}
{
  const g = await bootGame({ api: true });
  try {
    await installApi(g.page, { verified: false });
    await g.goto();
    await g.startScene('ForgeScene');
    await inScene(g.page, 'ForgeScene', (scene) => scene.tabSkins.emit('pointerdown'));
    await clickForgeButton(g.page, 'BUY');
    check(await waitPanel(g.page, /CONNECT WALLET/), 'pressing BUY sends a visitor to the wallet panel (connect, then verify)');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ shop check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ shop check passed');
