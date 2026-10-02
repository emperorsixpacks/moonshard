// The chapter card at the start of a story level fades itself out after a couple of seconds, or goes when tapped, and then the
// opening dialogue begins. Review finding: a tap during the fade-out advanced the card and then the fade finished and advanced it
// AGAIN, so the opening dialogue started twice (the second one from its first line, over the first).
//   node test/client/browser/story-intro-card.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const g = await bootGame();
const { page } = g;

/** Starts chapter 1 with its card, counting how many times the opening dialogue is begun. */
async function startWithCard() {
  await g.goto();
  await g.startScene('StoryScene', { chapter: 1 });
  await page.evaluate(() => {
    const scene = window.game.scene.getScene('StoryScene');
    window.__openings = 0;
    const begin = scene.triggerChapterOpeningDialogue.bind(scene);
    scene.triggerChapterOpeningDialogue = () => { window.__openings += 1; return begin(); };
  });
}
const openings = () => page.evaluate(() => window.__openings);
const cardAlpha = () => page.evaluate(() => window.game.scene.getScene('StoryScene').chapterIntroCard?.alpha ?? null);
const tap = () => page.mouse.click(640, 400);
const settleDialogue = () => page.waitForTimeout(2_500);

try {
  log('▶ nobody touches the card: it fades out by itself');
  await startWithCard();
  await page.waitForFunction(() => window.game.scene.getScene('StoryScene').chapterIntroCard === null, null, { timeout: 30_000 });
  await settleDialogue();
  check((await openings()) === 1, `the opening dialogue begins once (${await openings()})`);

  log('▶ a tap early on');
  await startWithCard();
  await page.waitForTimeout(600);
  await tap();
  await settleDialogue();
  check((await openings()) === 1, `the opening dialogue begins once (${await openings()})`);

  log('▶ a tap while the card is fading out by itself');
  await startWithCard();
  await page.waitForFunction(() => {
    const alpha = window.game.scene.getScene('StoryScene').chapterIntroCard?.alpha;
    return alpha !== undefined && alpha < 0.9; // the fade has started
  }, null, { timeout: 30_000, polling: 'raf' });
  const alphaAtTap = await cardAlpha();
  await tap();
  await settleDialogue();
  check(alphaAtTap !== null && alphaAtTap < 1, `the tap really landed during the fade (alpha ${alphaAtTap?.toFixed?.(2)})`);
  check((await openings()) === 1, `the opening dialogue still begins once (${await openings()})`);
  check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
} catch (err) {
  failures.push(String(err.stack || err));
  log(`\n${err.stack || err}`);
} finally {
  await g.close();
}

if (failures.length) {
  console.log(`\n❌ story intro card check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ story intro card check passed');
