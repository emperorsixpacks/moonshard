// First-visit smoke test: no wallet, API unreachable. Proves a first visitor is stopped at the verified-human gate, the
// wallet panel opens in its "not connected" state, every scene still boots without a server (started the way test tooling
// does, around the gate), and no scene throws. Needs neither a server nor a chain.
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
// the header button is shown in portrait, the floating one in landscape
const openWallet = () => page.locator('#btn-wallet:visible, #btn-wallet-landscape:visible').first().click();
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
  await page.waitForTimeout(800);
  await shot('menu');

  console.log('▶ wallet panel, no wallet installed');
  await openWallet();
  await page.waitForFunction(() => document.querySelector('#gd-panel')?.innerText.includes('NOT CONNECTED'));
  const panelText = await page.innerText('#gd-panel');
  assert.match(panelText, /No wallet detected/i);
  assert.match(panelText, /verified humans/i);
  assert.doesNotMatch(panelText, /without a wallet/i);
  await shot('panel');
  await page.click('[data-act="connect"]');
  await page.waitForTimeout(500);
  assert.match(await page.innerText('#gd-panel'), /NOT CONNECTED/); // clicking Connect without a wallet changes nothing and does not crash
  // regression: the click must not fall through to the Menu entry behind the panel (it used to open the Leaderboard)
  assert.equal(await page.evaluate(() => window.game.scene.isActive('LeaderboardScene')), false, 'panel click leaked into the game');
  assert.equal(await page.evaluate(() => window.game.scene.isActive('MenuScene')), true);
  await page.click('#gd-close');

  console.log('▶ the verified-human gate: a first visitor cannot start a game mode');
  for (const [key, data] of [['SurvivalScene'], ['TutorialScene'], ['StoryScene', { chapter: 1 }], ['StoryIntroScene']]) {
    // the same call the menu rows and the story transitions make
    await page.evaluate(([k, d]) => window.game.scene.getScene('MenuScene').scene.start(k, d), [key, data]);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate((k) => window.game.scene.isActive(k), key), false, `${key} started without a verified human`);
    assert.equal(await page.evaluate(() => window.game.scene.isActive('MenuScene')), true);
    const gateText = await page.innerText('#gd-panel');
    assert.match(gateText, /VERIFIED HUMANS ONLY/);
    assert.match(gateText, /CONNECT WALLET/);
    assert.doesNotMatch(gateText, /PLAY .* ▶/);
    if (key === 'SurvivalScene') await shot('gate');
    await page.click('#gd-close');
  }
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
