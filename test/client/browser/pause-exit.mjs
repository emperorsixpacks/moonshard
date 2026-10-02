// Leaving a run from the pause menu (MAIN MENU, or RETRY BATTLE) ends it like any other end: it is settled with the totals at
// that moment. Review finding: both exits left the run open on the server and dropped it, so the score and the Shards the
// HUD had been counting ("+2 G$" each) silently vanished.
//   node test/client/browser/pause-exit.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const g = await bootGame({ api: true, init: sessionInit() });
const { page } = g;
const api = await installApi(page, { verified: true });
const lastRun = () => api.runList().at(-1);
const runById = (id) => api.runList().find((r) => r.runId === id);
const pause = async () => { await page.keyboard.press('p'); await page.waitForFunction(() => window.pauseService.isPaused, null, { timeout: 10_000 }); };
const waitStatus = (id, status) => page.waitForFunction(() => true).then(async () => {
  for (let i = 0; i < 60 && runById(id)?.status !== status; i += 1) await page.waitForTimeout(250);
  return runById(id)?.status === status;
});

try {
  await g.goto();
  await page.waitForFunction(() => window.gdService.getStatus().verified === true, null, { timeout: 30_000 });

  log('▶ endless: MAIN MENU from the pause menu');
  await g.startScene('SurvivalScene');
  await page.waitForFunction(() => window.game.scene.getScene('SurvivalScene').player, null, { timeout: 30_000 });
  await page.waitForTimeout(2_000); // the ticket arrives
  const endless = lastRun().runId;
  await page.evaluate(() => {
    const s = window.game.scene.getScene('SurvivalScene');
    s.totalScore = 500;
    s.sessionCrystalsCollected = 4;
    s.killCount.total = 3;
  });
  await pause();
  await page.click('#btn-pause-menu');
  check(await waitStatus(endless, 'submitted'), 'the run is settled, not left open');
  const sub = runById(endless).submit;
  check(sub?.shards === 4 && sub?.kills === 3 && sub?.score >= 500, `with its totals (${JSON.stringify(sub && { score: sub.score, kills: sub.kills, shards: sub.shards })})`);
  check(await page.evaluate(() => window.game.scene.isActive('MenuScene')), 'and the player is on the menu');

  log('▶ endless: RETRY BATTLE from the pause menu');
  await g.startScene('SurvivalScene');
  await page.waitForTimeout(2_000);
  const first = lastRun().runId;
  await page.evaluate(() => { window.game.scene.getScene('SurvivalScene').sessionCrystalsCollected = 2; });
  await pause();
  await page.click('#btn-pause-retry');
  check(await waitStatus(first, 'submitted'), 'the run being left is settled');
  await page.waitForFunction(() => window.game.scene.isActive('SurvivalScene'), null, { timeout: 15_000 });
  for (let i = 0; i < 40 && lastRun().runId === first; i += 1) await page.waitForTimeout(250);
  check(lastRun().runId !== first && lastRun().status === 'open', 'and the new run is the open one');
  check(runById(first).status === 'submitted', 'and the new start did not void the old one first');

  log('▶ story: MAIN MENU from the pause menu');
  await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
  await page.waitForTimeout(2_000);
  const story = lastRun().runId;
  await page.evaluate(() => {
    const s = window.game.scene.getScene('StoryScene');
    s.killsCount = 5;
    s.sessionCrystalsCollected = 2;
  });
  await pause();
  await page.click('#btn-pause-menu');
  check(await waitStatus(story, 'submitted'), 'the story run is settled');
  const storySub = runById(story).submit;
  check(storySub?.kills === 5 && storySub?.shards === 2 && storySub?.bossCleared === false, `as a run, not a boss clear (${JSON.stringify(storySub && { kills: storySub.kills, shards: storySub.shards, bossCleared: storySub.bossCleared })})`);

  check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
} catch (err) {
  failures.push(String(err.stack || err));
  log(`\n${err.stack || err}`);
} finally {
  await g.close();
}

if (failures.length) {
  console.log(`\n❌ pause-exit check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ pause-exit check passed');
