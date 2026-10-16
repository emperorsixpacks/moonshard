// First-visit smoke test: no wallet, API unreachable. Proves a first visitor can start the tutorial but is stopped at the
// verified-human gate before the story and Endless, the wallet opens in its "not connected" state, every scene still boots
// without a server (started the way test tooling does, around the gate), and no scene throws. Needs neither a server nor a chain.
//   npm run test:smoke        (screenshots go to docs/screenshots/smoke-*.png)
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { freePort, waitForMoonshard } from './fork/ports.mjs';

const PORT = await freePort();
const WEB = `http://127.0.0.1:${PORT}`;
const SHOTS = new URL('../docs/screenshots/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:9' }, // nothing listens on port 9
  stdio: 'ignore',
});
process.on('exit', () => vite.kill()); // never leave a dev server behind, even if a run crashes
await waitForMoonshard(WEB);

const errors = [];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
const shot = (name) => page.screenshot({ path: `${SHOTS}smoke-${name}.png` });
// the wallet chip on the menu (the menu is page elements over the whole screen)
const openWallet = async () => { await page.waitForSelector('#ms-menu [data-act="wallet"]', { timeout: 30_000 }); await page.click('#ms-menu [data-act="wallet"]'); };
const closeSheet = async () => { await page.click('#ms-sheets [data-sheet="close"]'); await page.waitForFunction(() => !document.querySelector('#ms-sheets .sheet'), null, { timeout: 5000 }); };
const sheetText = () => page.innerText('#ms-sheets .sheet');
const startScene = async (key, data) => {
  // Phaser's scene.start leaves other scenes running underneath; stop them so each shot shows one scene
  await page.evaluate(([k, d]) => {
    for (const s of window.game.scene.getScenes(true)) if (s.scene.key !== k) window.game.scene.stop(s.scene.key);
    window.game.scene.start(k, d);
  }, [key, data]);
  await page.waitForFunction((k) => window.game.scene.isActive(k), key, { timeout: 30_000 });
};

try {
  await page.goto(WEB);
  await page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });

  console.log('▶ a first visit opens nothing by itself');
  await page.waitForSelector('#ms-menu .btn-main', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#ms-sheets .sheet'))), false, 'a guide or panel opened by itself');
  assert.match(await page.innerText('#ms-menu .btn-main'), /No wallet needed/, 'the big button leads to the tutorial first');
  await shot('menu');

  console.log('▶ wallet, no wallet installed');
  await openWallet();
  await page.waitForFunction(() => document.querySelector('#ms-sheets .sheet')?.innerText.includes('Connect wallet'));
  const panelText = await sheetText();
  assert.match(panelText, /No wallet detected/i);
  assert.match(panelText, /verified humans/i);
  assert.doesNotMatch(panelText, /without a wallet/i);
  await shot('panel');
  await page.click('#ms-sheets [data-act="connect"]');
  await page.waitForTimeout(500);
  assert.match(await sheetText(), /Connect wallet/); // clicking Connect without a wallet changes nothing and does not crash
  // regression: the click must not fall through to the menu behind the sheet (it used to open the Leaderboard)
  assert.equal(await page.evaluate(() => window.game.scene.isActive('LeaderboardScene')), false, 'sheet click leaked into the game');
  assert.equal(await page.evaluate(() => window.game.scene.isActive('MenuScene')), true);
  await closeSheet();

  console.log('▶ the verified-human gate: a first visitor cannot start the story or Endless');
  for (const [key, data] of [['SurvivalScene'], ['StoryScene', { chapter: 1 }], ['StoryIntroScene']]) {
    // the same call the menu tiles and the story transitions make
    await page.evaluate(([k, d]) => window.game.scene.getScene('MenuScene').scene.start(k, d), [key, data]);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate((k) => window.game.scene.isActive(k), key), false, `${key} started without a verified human`);
    assert.equal(await page.evaluate(() => window.game.scene.isActive('MenuScene')), true);
    const gateText = await sheetText();
    assert.match(gateText, /one human, one slot/i);
    assert.match(gateText, /Connect wallet/);
    assert.equal(await page.$('#ms-sheets [data-act="play"]'), null, 'a play button before the way in is open');
    if (key === 'SurvivalScene') await shot('gate');
    await closeSheet();
  }
  console.log('▶ the tutorial needs no wallet');
  await page.evaluate(() => window.game.scene.getScene('MenuScene').scene.start('TutorialScene'));
  await page.waitForFunction(() => window.game.scene.isActive('TutorialScene'), null, { timeout: 30_000 });
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#ms-sheets .sheet'))), false, 'the tutorial opened the gate');
  await startScene('MenuScene');
  // places that are not play stay open to everyone
  await page.evaluate(() => window.game.scene.getScene('MenuScene').scene.start('LeaderboardScene'));
  await page.waitForFunction(() => window.game.scene.isActive('LeaderboardScene'), null, { timeout: 15_000 });
  await startScene('MenuScene');

  for (const [key, data, ms] of [['TutorialScene', undefined, 6000], ['SurvivalScene', undefined, 8000], ['StoryScene', { chapter: 1 }, 8000]]) {
    console.log(`▶ ${key} runs offline`);
    await startScene(key, data);
    await page.waitForTimeout(ms);
    await shot(key.replace('Scene', '').toLowerCase());
  }

  console.log('▶ game over with no wallet');
  await startScene('SurvivalScene');
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.game.scene.getScene('SurvivalScene').handleGameOver());
  await page.waitForTimeout(2500);
  await shot('gameover');

  console.log('▶ leaderboard with the API down');
  await startScene('LeaderboardScene');
  await page.waitForTimeout(2500);
  await shot('leaderboard');

  console.log('▶ mobile portrait');
  await startScene('MenuScene');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(900);
  await shot('menu-mobile');
  await openWallet();
  await page.waitForTimeout(500);
  await shot('panel-mobile');

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log('\n✅ smoke passed (screenshots: docs/screenshots/smoke-*.png)');
} catch (err) {
  console.error('\n❌ smoke failed');
  console.error(err);
  console.error('browser errors so far:', errors);
  await page.screenshot({ path: `${SHOTS}smoke-FAILURE.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  vite.kill();
}
