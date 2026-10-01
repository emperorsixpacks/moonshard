// H1 in a real browser: the Survival score must not grow while the game is paused or the tab is hidden.
//   node test/client/browser/active-time.mjs
// The time bonus is 10 pts per second survived, so before the fix 39 minutes parked on the pause screen were worth
// about 23,400 points, enough for the daily 1,000 / 600 / 300 G$ prizes. Playwright's fake clock lets the test "wait"
// 39 minutes in a moment; Phaser, the scene and the pause service all run unmodified on top of it.
import assert from 'node:assert/strict';
import { bootGame, inScene } from './lib.mjs';

const MIN = 60_000;
const g = await bootGame({ clock: true });
const { page } = g;
const clock = page.clock;
const survival = (fn, arg) => inScene(page, 'SurvivalScene', fn, arg);
const state = () => survival((s) => ({ secondsSurvived: s.secondsSurvived, totalScore: s.totalScore, paused: window.pauseService.isPaused, over: s.isGameOver }));
// let the game render some frames (with the fake clock, frames only happen when time is advanced)
const frames = (ms = 600) => clock.runFor(ms);
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log('   ✓ ok'); };

try {
  await g.goto();
  await g.startScene('SurvivalScene');

  log('▶ time passes while playing');
  await frames(3_200);
  const playing = await state();
  log('   after ~3 s of play:', playing);
  check(playing.secondsSurvived >= 2 && playing.secondsSurvived <= 4, `expected ~3 s survived, got ${playing.secondsSurvived}`);

  log('▶ paused for 39 minutes (the ticket lives 40)');
  await page.evaluate(() => window.pauseService.pause());
  assert.equal((await state()).paused, true);
  const before = await state();
  await clock.fastForward(39 * MIN);
  await frames(1_000);
  await page.evaluate(() => window.pauseService.resume());
  await frames(300);
  const afterPause = await state();
  log('   before pause:', before, '\n   after resume:', afterPause);
  check(afterPause.secondsSurvived - before.secondsSurvived <= 3, `the pause was counted: ${before.secondsSurvived}s -> ${afterPause.secondsSurvived}s`);

  log('▶ tab hidden for 39 minutes');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const beforeHide = await state();
  await clock.fastForward(39 * MIN);
  await frames(1_000);
  await page.evaluate(() => {
    delete document.hidden; // back to the prototype getter: visible again
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await frames(300);
  const afterHide = await state();
  log('   before hiding:', beforeHide, '\n   after returning:', afterHide);
  check(afterHide.secondsSurvived - beforeHide.secondsSurvived <= 3, `the hidden tab was counted: ${beforeHide.secondsSurvived}s -> ${afterHide.secondsSurvived}s`);

  log('▶ the final score has no phantom time bonus');
  await survival((s) => s.handleGameOver());
  await frames(300);
  const over = await state();
  log('   at game over:', over);
  check(over.over, 'the run ended');
  check(over.totalScore < 1_000, `score ${over.totalScore} is far above what ~10 s of play can earn`);

  log('▶ Story: the run clock behaves the same way');
  await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
  const story = () => inScene(page, 'StoryScene', (s) => ({ secondsElapsed: s.secondsElapsed, paused: window.pauseService.isPaused }));
  await frames(3_200);
  const storyPlaying = await story();
  log('   after ~3 s of play:', storyPlaying);
  check(storyPlaying.secondsElapsed >= 2 && storyPlaying.secondsElapsed <= 4, `expected ~3 s, got ${storyPlaying.secondsElapsed}`);
  await page.evaluate(() => window.pauseService.pause());
  await clock.fastForward(39 * MIN);
  await frames(1_000);
  await page.evaluate(() => window.pauseService.resume());
  await frames(300);
  const storyAfter = await story();
  log('   after a 39 minute pause:', storyAfter);
  check(storyAfter.secondsElapsed - storyPlaying.secondsElapsed <= 3, `Story counted the pause: ${storyPlaying.secondsElapsed}s -> ${storyAfter.secondsElapsed}s`);

  check(g.errors.length === 0, `browser errors:\n${g.errors.join('\n')}`);

  assert.deepEqual(failures, [], `${failures.length} check(s) failed`);
  log('\n✅ active-time check passed');
} catch (err) {
  console.error('\n❌ active-time check failed');
  console.error(err.message, failures.length ? `\n - ${failures.join('\n - ')}` : '');
  process.exitCode = 1;
} finally {
  await g.close();
}
