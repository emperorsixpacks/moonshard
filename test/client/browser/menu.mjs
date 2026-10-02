// The menu in a real browser, with real mouse clicks through the canvas scaling:
//   a visitor who taps a play row is stopped by the verified-human gate BEFORE the screen fades out (and the chapter
//     picker does not open); the rows that are not play (forge, leaderboard, settings) stay open to everyone
//   a verified human is never stopped
//   turning the phone with a dialog open brings the dialog back on the new canvas, and it still works afterwards
//   the forge keeps its tab and the leaderboard keeps its tab (without asking the server again) when the phone is turned
//   node test/client/browser/menu.mjs [section]        (run from the repository root; `section` filters by name)
import { bootGame, clickMenuRow as clickRow, inScene, sceneTexts } from './lib.mjs';
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
const panelOpen = (page) => page.evaluate(() => Boolean(document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden')));
const panelText = (page) => page.evaluate(() => document.querySelector('#gd-panel')?.innerText ?? '');
/** Waits (up to `ms`) for the wallet panel to be open. */
const waitPanel = (page, ms = 4000) => page.waitForFunction(
  () => Boolean(document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden')),
  null, { timeout: ms },
).then(() => true, () => false);
/** Waits (up to `ms`) for a condition on the menu scene. */
const waitMenu = (page, fn, ms = 4000) => page.waitForFunction(
  (src) => (0, eval)(`(${src})`)(window.game.scene.getScene('MenuScene')),
  fn.toString(), { timeout: ms },
).then(() => true, () => false);
const closePanel = async (page) => {
  if (await panelOpen(page)) await page.click('#gd-close');
  await page.waitForTimeout(100);
};

/** Counts the fades the menu's camera starts from now on (a fade means the screen is on its way out). */
const watchFades = (page) => inScene(page, 'MenuScene', (scene) => {
  window.__fades = 0;
  const cam = scene.cameras.main;
  const fade = cam.fade;
  cam.fade = function (...args) { window.__fades += 1; return fade.apply(this, args); };
});
const fades = (page) => page.evaluate(() => window.__fades);

const menuState = (page) => inScene(page, 'MenuScene', (scene) => ({
  story: Boolean(scene.storyModalObjects),
  settings: Boolean(scene.settingsModalObjects),
  height: scene.cameras.main.height,
  laidOutFor: scene.layoutSize,
  overlayHeight: (scene.storyModalObjects || scene.settingsModalObjects || [])[0]?.displayHeight ?? null,
}));

/** Remembers one object of a scene's current layout, so a test can tell when the scene has been built again. */
const mark = (page, key, pick = (scene) => scene.children.list[0]) => inScene(page, key, (scene, src) => {
  window.__mark = (0, eval)(`(${src})`)(scene);
}, pick.toString());
const rebuilt = (page, ms = 15_000) => page.waitForFunction(() => window.__mark.active === false, null, { timeout: ms }).then(() => true, () => false);

/** Turn the phone and wait until the menu has been laid out again for the new canvas. */
async function turnPhone(page, viewport, canvasHeight) {
  await page.setViewportSize(viewport);
  await page.waitForFunction(
    (h) => window.game.scale.height === h && window.game.scene.getScene('MenuScene')?.layoutSize?.h === h,
    canvasHeight, { timeout: 15_000 },
  );
  await page.waitForTimeout(150);
}

// ---- 1. a visitor ---------------------------------------------------------------------------------------------------
if (wanted('visitor')) {
  const g = await bootGame({ viewport: LANDSCAPE }); // no wallet, the API is down: a first visit
  try {
    log('▶ a visitor taps the rows');
    await g.goto();
    check((await sceneTexts(g.page, 'MenuScene')).some((t) => /CONNECT & VERIFY TO PLAY/.test(t)), 'the badge says what is needed to play');

    for (const [label, mode] of [['ENDLESS MODE', 'ENDLESS MODE'], ['COMBAT TUTORIAL', 'THE TUTORIAL'], ['STORY MODE', 'STORY MODE']]) {
      await watchFades(g.page);
      await clickRow(g.page, label);
      check(await waitPanel(g.page), `${label}: the gate opens`);
      check(new RegExp(mode).test(await panelText(g.page)), `${label}: the gate names ${mode}`);
      check((await fades(g.page)) === 0, `${label}: the screen did not fade out first`);
      await g.page.waitForTimeout(600); // a start that was going to happen would have happened by now
      check(await active(g.page, 'MenuScene'), `${label}: the menu is still on screen`);
      check(!(await menuState(g.page)).story, `${label}: no chapter picker behind the gate`);
      for (const key of ['SurvivalScene', 'TutorialScene', 'StoryScene', 'StoryIntroScene']) {
        if (await active(g.page, key)) check(false, `${label}: ${key} must not have started`);
      }
      await closePanel(g.page);
    }
    await clickRow(g.page, 'ENDLESS MODE');
    await waitPanel(g.page);
    check(/No wallet detected/.test(await panelText(g.page)), 'with no wallet the gate says how to get one');
    await closePanel(g.page);

    log('▶ the rows that are not play stay open');
    await clickRow(g.page, 'SETTINGS');
    check(await waitMenu(g.page, (scene) => Boolean(scene.settingsModalObjects)), 'settings opens');
    check(!(await panelOpen(g.page)), 'with no gate');
    await g.page.keyboard.press('Escape');
    check(await waitMenu(g.page, (scene) => !scene.settingsModalObjects), 'ESC closes it');

    await clickRow(g.page, 'LEADERBOARD');
    await g.page.waitForFunction(() => window.game.scene.isActive('LeaderboardScene'), null, { timeout: 15_000 });
    check(!(await panelOpen(g.page)), 'the leaderboard opens, with no gate');
    await g.page.waitForFunction(() => window.game.scene.getScene('LeaderboardScene').errorText, null, { timeout: 15_000 });
    const lb = await sceneTexts(g.page, 'LeaderboardScene');
    check(lb.some((t) => /reach the server/i.test(t)), 'with the API down it says so, in plain words');
    check(!lb.some((t) => /TypeError|undefined|\[object|Failed to fetch/i.test(t)), 'and shows no raw error text');
    await g.startScene('MenuScene');

    await clickRow(g.page, 'FORGE');
    await g.page.waitForFunction(() => window.game.scene.isActive('ForgeScene'), null, { timeout: 15_000 });
    check(!(await panelOpen(g.page)), 'the forge opens, with no gate');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 2. a verified human --------------------------------------------------------------------------------------------
if (wanted('verified')) {
  const g = await bootGame({ api: true, init: sessionInit(), viewport: LANDSCAPE });
  try {
    await installApi(g.page, { verified: true });
    log('▶ a verified human taps the rows');
    await g.goto();
    await g.page.waitForFunction(() => window.game.scene.getScene('MenuScene').children.list.some((o) => o.type === 'Text' && /VERIFIED •/.test(o.text)), null, { timeout: 30_000 });
    check(true, 'the badge shows they are verified');

    await clickRow(g.page, 'STORY MODE');
    check(await waitMenu(g.page, (scene) => Boolean(scene.storyModalObjects)), 'the chapter picker opens');
    check(!(await panelOpen(g.page)), 'with no gate');
    await g.page.keyboard.press('Escape');
    check(await waitMenu(g.page, (scene) => !scene.storyModalObjects), 'ESC closes it');

    await watchFades(g.page);
    await clickRow(g.page, 'ENDLESS MODE');
    await g.page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 30_000 });
    check((await fades(g.page)) === 1, 'the screen fades out and endless mode starts');
    check(!(await panelOpen(g.page)), 'with no gate');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 3. turning the phone with a dialog open --------------------------------------------------------------------------
if (wanted('rotation')) {
  const g = await bootGame({ api: true, init: sessionInit(), viewport: PHONE_SIDEWAYS });
  try {
    const api = await installApi(g.page, { verified: true });
    log('▶ turning the phone with a dialog open');
    await g.goto();
    await g.page.waitForFunction(() => window.game.scene.getScene('MenuScene').children.list.some((o) => o.type === 'Text' && /VERIFIED •/.test(o.text)), null, { timeout: 30_000 });

    await clickRow(g.page, 'STORY MODE');
    await waitMenu(g.page, (scene) => Boolean(scene.storyModalObjects));
    let s = await menuState(g.page);
    check(s.story && s.height === 270 && s.overlayHeight === 270, 'sideways: the chapter picker is open on the 270-high canvas');

    await turnPhone(g.page, PHONE_UPRIGHT, 440);
    s = await menuState(g.page);
    check(s.story, 'upright: the chapter picker is open again');
    check(s.overlayHeight === 440, 'its dimmer covers the whole tall canvas');
    const ratio = await g.page.evaluate(() => { const r = window.game.canvas.getBoundingClientRect(); return r.width / r.height; });
    check(Math.abs(ratio - 480 / 440) < 0.02, `the picture is not squashed (${ratio.toFixed(3)} vs ${(480 / 440).toFixed(3)})`);

    await g.page.keyboard.press('Escape');
    check(await waitMenu(g.page, (scene) => !scene.storyModalObjects), 'ESC closes it');
    await clickRow(g.page, 'STORY MODE');
    check(await waitMenu(g.page, (scene) => Boolean(scene.storyModalObjects)), 'and the STORY MODE row opens it again (it is not left dead by the turn)');
    await g.page.keyboard.press('Escape');
    await waitMenu(g.page, (scene) => !scene.storyModalObjects);

    await clickRow(g.page, 'SETTINGS');
    check(await waitMenu(g.page, (scene) => Boolean(scene.settingsModalObjects)), 'upright: settings opens');
    await turnPhone(g.page, PHONE_SIDEWAYS, 270);
    s = await menuState(g.page);
    check(s.settings && s.overlayHeight === 270, 'turned back: settings is open on the 270-high canvas');
    await g.page.keyboard.press('Escape');
    check(await waitMenu(g.page, (scene) => !scene.settingsModalObjects), 'and closes');

    log('▶ the forge keeps its tab when the phone is turned');
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
