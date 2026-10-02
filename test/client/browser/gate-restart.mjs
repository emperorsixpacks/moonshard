// When the verified-human gate refuses a restart (the verification lapsed while the player was on a results screen, or in the
// middle of a run), the screen they are on must stay exactly as it was: the gate opens OVER it, and closing the gate leaves
// the player where they were, with every button and shortcut still working. Review finding: the Story end screens, the story
// intro prompt, Endless results shortcuts and the pause menu's RETRY took themselves apart BEFORE asking, so a refusal left a
// screen that nothing could be done on until a reload.
//   node test/client/browser/gate-restart.mjs        (run from the repository root)
import { bootGame, sceneTexts } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const g = await bootGame({ api: true, init: sessionInit() });
const { page } = g;
const api = await installApi(page, { verified: true });

const gateOpen = () => page.evaluate(() => Boolean(document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden')));
const waitGate = (open) => page.waitForFunction((want) => (Boolean(document.querySelector('#gd-panel') && !document.querySelector('#gd-panel').classList.contains('hidden')) === want), open, { timeout: 15_000 });
const closeGate = async () => {
  await page.click('#gd-close');
  await waitGate(false);
  // the panel swallows key presses meant for itself, so the keyboard must be back on the game the moment it closes
  const focusBack = await page.evaluate(() => document.activeElement === document.body || !document.querySelector('#gd-panel').contains(document.activeElement));
  check(focusBack, 'closing the panel gives the keyboard back to the game at once');
};
const active = (key) => page.evaluate((k) => window.game.scene.isActive(k), key);
const verifiedNow = (want) => page.waitForFunction((w) => window.gdService.getStatus().verified === w, want, { timeout: 15_000 });
const setVerified = async (value) => {
  api.verified = value;
  await page.evaluate(() => window.gdService.refreshAll());
  await verifiedNow(value);
};
/**
 * A mark on the results screen (its dimmer or banner sits at depth 500 and above): still alive after a call means the
 * screen was not taken apart. Returns whether there was a screen to mark.
 */
const mark = (key) => page.evaluate((k) => {
  window.__mark = window.game.scene.getScene(k).children.list.find((o) => (o.type === 'Rectangle' || o.type === 'Container') && o.depth >= 500);
  return Boolean(window.__mark?.active);
}, key);
const markAlive = () => page.evaluate(() => Boolean(window.__mark?.active));
const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(300); };

try {
  await g.goto();
  await verifiedNow(true);

  // ---- 1. Story game over --------------------------------------------------------------------------------------------
  log('▶ story game over: the gate refuses RETRY');
  await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.game.scene.getScene('StoryScene').handlePlayerGameOver());
  await page.waitForTimeout(3_500); // the end screen ignores input for a moment
  check(await mark('StoryScene'), 'the game-over screen is up');
  await setVerified(false);
  await press('r');
  await waitGate(true);
  check(true, 'R opens the gate');
  check(await markAlive(), 'and the game-over screen is still there behind it');
  await closeGate();
  await press('r');
  await waitGate(true);
  check(true, 'closing the gate and pressing R again opens it again: the screen is not dead');
  await closeGate();
  await setVerified(true);
  await press('r');
  check(await active('StoryScene') && !(await markAlive()), 'once verified again, R really restarts the chapter');

  // ---- 2. Story victory ----------------------------------------------------------------------------------------------
  log('▶ story victory: the gate refuses the next chapter');
  await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.game.scene.getScene('StoryScene').triggerChapterVictory());
  await page.waitForTimeout(3_500);
  await page.evaluate(() => window.game.scene.getScene('StoryScene').dialogueBox?.skipAll?.());
  await page.waitForTimeout(1_500);
  check(await mark('StoryScene'), 'the victory screen is up');
  await setVerified(false);
  await page.evaluate(() => window.game.scene.getScene('StoryScene').victoryAdvanceCallback());
  await waitGate(true);
  check(await markAlive(), 'the victory screen is still there behind the gate');
  await closeGate();
  await page.evaluate(() => window.game.scene.getScene('StoryScene').victoryAdvanceCallback());
  await waitGate(true);
  check(true, 'and its buttons still work afterwards');
  await closeGate();
  await setVerified(true);

  // ---- 3. Endless results ----------------------------------------------------------------------------------------------
  log('▶ endless results: the gate refuses RETRY');
  await g.startScene('SurvivalScene');
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.game.scene.getScene('SurvivalScene').handleGameOver());
  await page.waitForTimeout(2_500);
  await setVerified(false);
  await press('r');
  await waitGate(true);
  await closeGate();
  await press('r');
  await waitGate(true);
  check(true, 'R still works after the gate refused it once (the keyboard shortcuts are not taken down)');
  await closeGate();
  await setVerified(true);

  // ---- 4. the story intro prompt ---------------------------------------------------------------------------------------
  log('▶ the story intro prompt: the gate refuses both choices');
  await g.startScene('StoryIntroScene');
  await page.waitForTimeout(1_000);
  await page.evaluate(() => window.game.scene.getScene('StoryIntroScene').promptTutorialChoice());
  await page.waitForTimeout(500);
  await setVerified(false);
  await page.evaluate(() => window.game.scene.getScene('StoryIntroScene').onChooseSkipTutorial());
  await waitGate(true);
  const dim = await page.evaluate(() => window.game.scene.getScene('StoryIntroScene').cameras.main.fadeEffect.alpha);
  check(dim === 0, 'the screen is not left faded out behind the gate');
  await closeGate();
  await page.evaluate(() => window.game.scene.getScene('StoryIntroScene').onChoosePlayTutorial());
  await waitGate(true);
  check(true, 'and the other choice still works afterwards');
  await closeGate();
  await setVerified(true);

  // ---- 5. the pause menu's RETRY --------------------------------------------------------------------------------------
  log('▶ the pause menu: the gate refuses RETRY BATTLE');
  await g.startScene('SurvivalScene');
  await page.waitForTimeout(2_000);
  await setVerified(false);
  await press('p');
  check(await page.evaluate(() => window.pauseService.isPaused), 'the game is paused');
  await page.click('#btn-pause-retry');
  await waitGate(true);
  const behind = () => page.evaluate(() => ({
    paused: window.pauseService.isPaused,
    physicsPaused: window.game.scene.getScene('SurvivalScene').physics.world.isPaused,
    menuShown: !document.querySelector('#pause-modal').classList.contains('hidden'),
  }));
  const a = await behind();
  check(a.paused && a.physicsPaused && a.menuShown, `the run stays paused behind the gate (${JSON.stringify(a)})`);
  await closeGate();
  check((await behind()).menuShown, 'closing the gate leaves the player at the pause menu');
  await page.click('#btn-pause-resume');
  await page.waitForTimeout(300);
  check(!(await behind()).paused, 'where RESUME still works');
  await setVerified(true);

  check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
} catch (err) {
  failures.push(String(err.stack || err));
  log(`\n${err.stack || err}`);
  log('page state:', await page.evaluate(() => ({
    scenes: window.game?.scene.getScenes(true).map((s) => s.scene.key),
    gate: !document.querySelector('#gd-panel')?.classList.contains('hidden'),
    verified: window.gdService?.getStatus().verified,
    survivalResultsUp: Boolean(window.game?.scene.getScene('SurvivalScene')?.modalButtons),
    activeElement: document.activeElement?.tagName + '#' + document.activeElement?.id,
  })).catch(() => 'unavailable'));
} finally {
  await g.close();
}

if (failures.length) {
  console.log(`\n❌ gate-restart check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ gate-restart check passed');
