// Things that must survive a scene being torn down at an awkward moment (found by the independent review's random walk):
//   a dialogue box whose parts are already gone must not stop the next dialogue from starting (it soft-locked the story)
//   the pause service must tolerate its scene being stopped while paused
//   after the gate refused the pause menu's RETRY and the player passes it, the run restarts with the pause menu gone
//   node test/client/browser/scene-teardown.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const g = await bootGame({ api: true, init: sessionInit() });
const { page } = g;
const api = await installApi(page, { verified: true });
const verifiedNow = (want) => page.waitForFunction((w) => window.gdService.getStatus().verified === w, want, { timeout: 15_000 });
const setVerified = async (value) => { api.verified = value; await page.evaluate(() => window.gdService.refreshAll()); await verifiedNow(value); };

try {
  await g.goto();
  await verifiedNow(true);

  log('▶ a dialogue box with parts that are already destroyed');
  await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
  await page.waitForTimeout(1_500);
  const outcome = await page.evaluate(() => {
    const scene = window.game.scene.getScene('StoryScene');
    const lines = [{ speaker: 'LUNA', text: 'First.' }, { speaker: 'LUNA', text: 'Second.' }];
    scene.startDialogue(lines);
    const first = scene.dialogueBox;
    first.btnSkip?.destroy(); // a part of the box is gone (the scene was torn down around it)
    first.bgBox?.destroy();
    let threw = null;
    try { scene.startDialogue([{ speaker: 'LUNA', text: 'Next life.' }]); } catch (e) { threw = e.message; }
    return { threw, inDialogue: scene.inDialogue, newBox: scene.dialogueBox !== first && Boolean(scene.dialogueBox) };
  });
  check(outcome.threw === null, `starting the next dialogue does not throw (${outcome.threw})`);
  check(outcome.inDialogue && outcome.newBox, 'and the next dialogue is up');
  await page.evaluate(() => window.game.scene.getScene('StoryScene').dialogueBox?.skipAll?.());
  await page.waitForTimeout(1_000);

  log('▶ the pause service when its scene is stopped while paused');
  await g.startScene('SurvivalScene');
  await page.waitForTimeout(2_000);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.pauseService.isPaused), 'the game is paused');
  const detach = await page.evaluate(() => {
    window.game.scene.stop('SurvivalScene'); // torn down while paused
    let threw = null;
    try { window.pauseService.detachScene(); } catch (e) { threw = e.message; }
    return { threw, paused: window.pauseService.isPaused, menuShown: !document.querySelector('#pause-modal').classList.contains('hidden') };
  });
  check(detach.threw === null, `detaching does not throw (${detach.threw})`);
  check(!detach.paused && !detach.menuShown, 'and leaves nothing paused and no pause menu on screen');

  log('▶ the pause menu\'s RETRY is refused by the gate, then the player passes it');
  await g.startScene('SurvivalScene');
  await page.waitForTimeout(2_000);
  await page.evaluate(() => { window.__before = window.game.scene.getScene('SurvivalScene').player; });
  await setVerified(false);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await page.click('#btn-pause-retry');
  await page.waitForFunction(() => !document.querySelector('#gd-panel').classList.contains('hidden'), null, { timeout: 15_000 });
  await setVerified(true); // they verify again
  await page.click('[data-act="recheck"]').catch(() => {}); // (the panel updates itself when the status changes; this is a nudge)
  await page.waitForSelector('[data-act="play"]', { timeout: 15_000 });
  await page.click('[data-act="play"]');
  await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene').player !== window.__before, null, { timeout: 30_000 });
  const after = await page.evaluate(() => ({
    paused: window.pauseService.isPaused,
    menuShown: !document.querySelector('#pause-modal').classList.contains('hidden'),
    physicsPaused: window.game.scene.getScene('SurvivalScene').physics.world.isPaused,
    running: window.game.scene.isActive('SurvivalScene'),
  }));
  check(after.running && !after.paused && !after.physicsPaused, `the run restarted and is running (${JSON.stringify(after)})`);
  check(!after.menuShown, 'and the pause menu is gone');

  check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
} catch (err) {
  failures.push(String(err.stack || err));
  log(`\n${err.stack || err}`);
} finally {
  await g.close();
}

if (failures.length) {
  console.log(`\n❌ scene-teardown check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ scene-teardown check passed');
