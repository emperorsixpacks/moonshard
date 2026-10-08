// The menu in a real browser, with real clicks:
//   a visitor can try the tutorial at once (no wallet); any other way into play stops at the verified-human gate BEFORE the
//     screen fades out; the places that are not play (the forge, the leaderboard, settings) stay open to everyone
//   a verified human is never stopped, and the big button says where they are in the story
//   the forge keeps its tab and the leaderboard keeps its tab (without asking the server again) when the phone is turned
//   node test/client/browser/menu.mjs [section]        (run from the repository root; `section` filters by name)
import { bootGame, clickMenu, closeSheet, inScene, playButton, sceneTexts, sheetName, sheetOpen, sheetText, waitSheet } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const only = process.argv[2];
const wanted = (name) => !only || name.includes(only);

const LANDSCAPE = { width: 1000, height: 600 };
const PHONE_SIDEWAYS = { width: 844, height: 390 };
const PHONE_UPRIGHT = { width: 390, height: 844 };

const active = (page, key) => page.evaluate((k) => window.game.scene.isActive(k), key);
/** Whether the screen has started to fade out on its way to another scene. */
const fading = (page) => page.evaluate(() => Boolean(document.getElementById('fade')?.classList.contains('on')));
const menuText = (page, sel) => page.evaluate((s) => document.querySelector(`#ms-menu ${s}`)?.innerText ?? '', sel);

/** Remembers one object of a scene's current layout, so a test can tell when the scene has been built again. */
const mark = (page, key, pick = (scene) => scene.children.list[0]) => inScene(page, key, (scene, src) => {
  window.__mark = (0, eval)(`(${src})`)(scene);
}, pick.toString());
const rebuilt = (page, ms = 15_000) => page.waitForFunction(() => window.__mark.active === false, null, { timeout: ms }).then(() => true, () => false);

// ---- 1. a first visit: the tutorial needs no wallet -------------------------------------------------------------------
if (wanted('first')) {
  const g = await bootGame({ viewport: LANDSCAPE }); // no wallet, the API is down, nothing done yet
  try {
    log('▶ a first visit');
    await g.goto();
    await clickMenu(g.page, 'wallet'); // wait until the menu is drawn
    await closeSheet(g.page);
    const play = await playButton(g.page);
    check(play.title === 'Play' && /No wallet needed/.test(play.sub), 'the big button says: learn the moves, no wallet needed');
    check(/Connect/.test(await menuText(g.page, '.chip')), 'the wallet chip is a quiet "Connect"');
    check(!(await sheetOpen(g.page)), 'no guide or panel opens by itself');

    await clickMenu(g.page, 'play');
    await g.page.waitForFunction(() => window.game.scene.isActive('TutorialScene'), null, { timeout: 30_000 });
    check(!(await sheetOpen(g.page)), 'the tutorial starts, with no gate in the way');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 2. a visitor after the tutorial ---------------------------------------------------------------------------------
if (wanted('visitor')) {
  const g = await bootGame({ viewport: LANDSCAPE, tutorialDone: true });
  try {
    log('▶ a visitor taps the ways into play');
    await g.goto();
    await clickMenu(g.page, 'wallet'); await closeSheet(g.page);
    const play = await playButton(g.page);
    check(/Connect a wallet/.test(play.sub), 'the big button says what is needed to play');

    for (const [act, label] of [['play', 'Play'], ['endless', 'Endless']]) {
      await clickMenu(g.page, act);
      check(await waitSheet(g.page, /Connect your wallet/, 4000), `${label}: the gate opens at its first step`);
      check((await sheetName(g.page)) === 'gate', `${label}: it is the way in, not the wallet`);
      check(!(await fading(g.page)), `${label}: the screen did not fade out first`);
      await g.page.waitForTimeout(600); // a start that was going to happen would have happened by now
      check(await active(g.page, 'MenuScene'), `${label}: the menu is still on screen`);
      for (const key of ['SurvivalScene', 'StoryScene', 'StoryIntroScene']) {
        if (await active(g.page, key)) check(false, `${label}: ${key} must not have started`);
      }
      if (act === 'endless') check(/No wallet detected/.test(await sheetText(g.page)), 'with no wallet the gate says how to get one');
      await closeSheet(g.page);
    }

    log('▶ the places that are not play stay open');
    await clickMenu(g.page, 'settings');
    check(await waitSheet(g.page, /Sound effects/), 'settings opens');
    check((await sheetName(g.page)) === 'settings', 'with no gate');
    await g.page.keyboard.press('Escape');
    await g.page.waitForFunction(() => !document.querySelector('#ms-sheets .sheet'), null, { timeout: 5000 });
    check(true, 'Escape closes it');

    await clickMenu(g.page, 'ranks');
    await g.page.waitForFunction(() => window.game.scene.isActive('LeaderboardScene'), null, { timeout: 15_000 });
    check(!(await sheetOpen(g.page)), 'the leaderboard opens, with no gate');
    await g.page.waitForFunction(() => window.game.scene.getScene('LeaderboardScene').errorText, null, { timeout: 15_000 });
    const lb = await sceneTexts(g.page, 'LeaderboardScene');
    check(lb.some((t) => /reach the server/i.test(t)), 'with the API down it says so, in plain words');
    check(!lb.some((t) => /TypeError|undefined|\[object|Failed to fetch/i.test(t)), 'and shows no raw error text');
    await g.startScene('MenuScene');

    await clickMenu(g.page, 'forge');
    await g.page.waitForFunction(() => window.game.scene.isActive('ForgeScene'), null, { timeout: 15_000 });
    check(!(await sheetOpen(g.page)), 'the forge opens, with no gate');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 3. a verified human --------------------------------------------------------------------------------------------
if (wanted('verified')) {
  const g = await bootGame({ api: true, init: sessionInit(), viewport: LANDSCAPE, tutorialDone: true });
  try {
    await installApi(g.page, { verified: true });
    log('▶ a verified human taps the ways into play');
    await g.goto();
    await g.page.waitForFunction(() => /G\$/.test(document.querySelector('#ms-menu .chip')?.innerText ?? '') && document.querySelector('#ms-menu .chip .tick'), null, { timeout: 30_000 });
    check(true, 'the chip shows their G$ and the verified tick');
    const play = await playButton(g.page);
    check(play.title === 'Play' && /Chapter 1/.test(play.sub), 'the big button leads to Chapter 1');
    check(!(await g.page.evaluate(() => document.querySelector('#ms-menu .chapters').hidden)), 'the chapter list is on offer (the Prologue can be replayed from it)');

    await clickMenu(g.page, 'endless');
    await g.page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
    check(!(await sheetOpen(g.page)), 'Endless starts, with no gate');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 4. a player part-way through the story: Continue and the chapter list --------------------------------------------
if (wanted('story')) {
  const progress = `localStorage.setItem('MOONSHARD_SAVE_V1', JSON.stringify({ tutorialDone: true, prologueSeen: true, storyProgress: { chapter1: { completed: true, highKills: 3 }, chapter2: { completed: false, highKills: 0 } } }));`;
  const g = await bootGame({ api: true, init: sessionInit() + progress, viewport: PHONE_UPRIGHT });
  try {
    await installApi(g.page, { verified: true });
    log('▶ a verified player part-way through the story');
    await g.goto();
    await g.page.waitForFunction(() => document.querySelector('#ms-menu .btn-main b')?.textContent === 'Continue', null, { timeout: 30_000 });
    check(/Chapter 2: The Hive Canopy/.test((await playButton(g.page)).sub), 'the big button says Continue, at the chapter they have reached');

    await clickMenu(g.page, 'chapters');
    check(await waitSheet(g.page, /Chapters/), 'the chapter list opens');
    const rows = await g.page.evaluate(() => [...document.querySelectorAll('#ms-sheets .row')].map((r) => ({ locked: r.classList.contains('locked'), text: r.innerText })));
    check(rows.length === 6 && rows.slice(0, 3).every((r) => !r.locked) && rows.slice(3).every((r) => r.locked), 'the Prologue and chapters 1 and 2 are open; 3 to 5 are locked');
    check(/Finish chapter 2 to unlock/.test(rows[3].text), 'a locked chapter says what unlocks it');
    await g.page.click('#ms-sheets [data-act="chapter"][data-n="1"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('StoryScene'), null, { timeout: 30_000 });
    check((await inScene(g.page, 'StoryScene', (scene) => scene.chapterId)) === 1, 'picking Chapter 1 plays Chapter 1');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 5. turning the phone ---------------------------------------------------------------------------------------------
if (wanted('rotation')) {
  const g = await bootGame({ api: true, init: sessionInit(), viewport: PHONE_SIDEWAYS, tutorialDone: true });
  try {
    const api = await installApi(g.page, { verified: true });
    log('▶ the menu follows the phone when it is turned');
    await g.goto();
    await clickMenu(g.page, 'settings');
    check(await waitSheet(g.page, /Sound effects/), 'sideways: settings is open');
    const sideways = await g.page.evaluate(() => { const r = document.querySelector('#ms-sheets .sheet').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    await g.page.setViewportSize(PHONE_UPRIGHT);
    await g.page.waitForTimeout(400);
    check(await sheetOpen(g.page), 'upright: the same sheet is still open');
    const upright = await g.page.evaluate(() => { const r = document.querySelector('#ms-sheets .sheet').getBoundingClientRect(); return { w: r.width, bottom: innerHeight - r.bottom }; });
    check(upright.w > sideways.w * 0.8 && upright.bottom < 2, 'and it now rises from the bottom of the screen');
    const overflows = await g.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflows, 'nothing runs off the side of the screen');
    await closeSheet(g.page);
    check((await playButton(g.page)) !== null, 'the big button is still there, and still works after the turn');

    log('▶ the forge keeps its tab when the phone is turned');
    await g.page.setViewportSize(PHONE_SIDEWAYS);
    await g.page.waitForFunction(() => window.game.scale.height === 270, null, { timeout: 15_000 });
    await g.startScene('ForgeScene');
    await inScene(g.page, 'ForgeScene', (scene) => scene.tabNim.emit('pointerdown'));
    check((await inScene(g.page, 'ForgeScene', (scene) => scene.currentTab)) === 'nim', 'the player is on the third tab');
    await mark(g.page, 'ForgeScene');
    await g.page.setViewportSize(PHONE_UPRIGHT);
    check(await rebuilt(g.page), 'turned upright: the forge is built again');
    check(await active(g.page, 'ForgeScene'), 'the forge is still showing');
    check((await inScene(g.page, 'ForgeScene', (scene) => scene.cameras.main.height)) === 440, 'on the tall canvas');
    check((await inScene(g.page, 'ForgeScene', (scene) => scene.currentTab)) === 'nim', 'and still on the third tab');

    log('▶ the leaderboard keeps its tab, and does not ask the server again');
    await g.page.setViewportSize(PHONE_SIDEWAYS);
    await g.page.waitForFunction(() => window.game.scale.height === 270, null, { timeout: 15_000 });
    await g.startScene('LeaderboardScene');
    await g.page.waitForFunction(() => window.game.scene.getScene('LeaderboardScene').boardsReady, null, { timeout: 15_000 });
    await inScene(g.page, 'LeaderboardScene', (scene) => scene.setActiveTab('daily'));
    const asked = api.callsTo(/^\/leaderboard/).length;
    await mark(g.page, 'LeaderboardScene', (scene) => scene.titleText);
    await g.page.setViewportSize(PHONE_UPRIGHT);
    check(await rebuilt(g.page), 'turned upright: the leaderboard is laid out again');
    check((await inScene(g.page, 'LeaderboardScene', (scene) => scene.layoutSize.h)) === 440, 'for the tall canvas');
    const lb = await inScene(g.page, 'LeaderboardScene', (scene) => ({ tab: scene.activeTab, ready: scene.boardsReady }));
    check(lb.tab === 'daily' && lb.ready, 'it is still on the daily board');
    check(api.callsTo(/^\/leaderboard/).length === asked, 'the boards were laid out again without being fetched again');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ menu check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ menu check passed');
