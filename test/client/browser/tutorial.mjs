// The tutorial and the controls in a real browser:
//   attack is E (Z does nothing); a keyboard player sees no on-screen pad and is told about keys; a touch brings the pad
//   and the button words; the lesson card follows the lessons; Skip leaves; the last lesson opens the "training complete" sheet
//   pressing E to close a story dialogue does not also swing the sword
//   node test/client/browser/tutorial.mjs        (run from the repository root)
import { bootGame, sheetName, sheetText, waitSheet } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const scene = (page, key, fn, arg) => page.evaluate(([k, src, a]) => new Function('s', 'a', `return (${src})(s, a)`)(window.game.scene.getScene(k), a), [key, fn.toString(), arg]);
// the card's words (the lesson steps carry hidden labels for screen readers, so read the title and the sentence themselves)
const coachText = (page) => page.evaluate(() => ['.co-title', '.co-say', '.co-tasks'].map((q) => document.querySelector(`#ms-hud ${q}`)?.innerText ?? '').join(' | '));
const idle = (page) => page.waitForFunction(() => !window.game.scene.getScene('TutorialScene').player.isAttacking, null, { timeout: 8000 });
const taskDone = (page, id) => page.waitForFunction((t) => document.querySelector(`#ms-hud [data-task="${t}"]`)?.classList.contains('done'), id, { timeout: 8000 }).then(() => true, () => false);
const padHidden = (page) => page.evaluate(() => document.getElementById('touch-controls').classList.contains('hidden'));

// ---- 1. a keyboard player ------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit() });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    await g.startScene('TutorialScene');
    await g.page.waitForSelector('#ms-hud .coach');
    log('▶ a keyboard player in the tutorial');
    check(await padHidden(g.page), 'the on-screen pad is not drawn');
    const first = await coachText(g.page);
    check(/Running/.test(first) && /Hold\s*A\s*and\s*D/.test(first.replace(/\n/g, ' ')), `the card names the keys (${first.replace(/\n/g, ' ').slice(0, 90)})`);
    check(!/D-Pad|JUMP|◀/.test(first), 'and does not talk about buttons');

    await g.page.waitForTimeout(1500); // the hero lands; no attack is under way
    await g.page.keyboard.press('KeyZ');
    await g.page.waitForTimeout(150);
    check(!(await scene(g.page, 'TutorialScene', (s) => s.player.isAttacking)), 'Z does not attack');
    await g.page.keyboard.press('KeyE');
    check(await g.page.waitForFunction(() => window.game.scene.getScene('TutorialScene').player.isAttacking, null, { timeout: 3000 }).then(() => true, () => false), 'E attacks');
    await idle(g.page);

    // the first lesson: run both ways, and the card follows
    await g.page.keyboard.down('KeyD');
    check(await taskDone(g.page, 'right'), 'running right ticks "Run right"');
    await g.page.keyboard.up('KeyD');
    check(await g.page.evaluate(() => !document.querySelector('#ms-hud [data-task="left"]')?.classList.contains('done')), 'and not "Run left"');
    await g.page.keyboard.down('KeyA');
    check(await taskDone(g.page, 'left'), 'running left ticks "Run left"');
    await g.page.waitForFunction(() => /Jump and double jump/.test(document.querySelector('#ms-hud .co-title')?.innerText ?? ''), null, { timeout: 8000 })
      .then(() => check(true, 'both done: the next lesson comes'), () => check(false, 'both done: the next lesson comes'));
    await g.page.keyboard.up('KeyA');
    check(/Space/.test(await coachText(g.page)), 'the jump lesson names the Space key');

    // a touch switches the words and brings the pad
    log('▶ then a touch');
    await g.page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
    await g.page.waitForTimeout(150);
    check(!(await padHidden(g.page)), 'the pad appears');
    check(/JUMP/.test(await coachText(g.page)) && !/Space/.test(await coachText(g.page)), 'and the card talks about the JUMP button');
    await g.page.keyboard.press('KeyE');
    await g.page.waitForTimeout(150);
    check(await padHidden(g.page), 'a key press takes the pad away again');

    // the last lesson done: the sheet
    log('▶ training complete');
    await scene(g.page, 'TutorialScene', (s) => s.startLesson(7));
    check(await waitSheet(g.page, /Training complete/, 10_000), 'the "training complete" sheet opens');
    check((await sheetName(g.page)) === 'result' && /Start the story/.test(await sheetText(g.page)), 'with the way on');
    check(!(await g.page.evaluate(() => Boolean(document.querySelector('#ms-hud .coach:not([hidden])')))), 'and the lesson card is out of the way');
    check(await g.page.evaluate(() => JSON.parse(localStorage.getItem('MOONSHARD_SAVE_V1') || '{}').tutorialDone === true), 'the tutorial counts as done');
    await g.page.click('#ms-sheets [data-act="menu"]');
    await g.page.waitForFunction(() => window.game.scene.isActive('MenuScene'), null, { timeout: 15_000 });
    check(!(await g.page.evaluate(() => Boolean(document.querySelector('#ms-hud .coach')))), 'leaving takes the card away');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 2. Skip -----------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit() });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    await g.startScene('TutorialScene');
    await g.page.waitForSelector('#ms-hud .coach .co-skip');
    log('▶ Skip');
    await g.page.click('#ms-hud .co-skip');
    await g.page.waitForFunction(() => window.game.scene.isActive('MenuScene'), null, { timeout: 15_000 });
    check(true, 'Skip goes back to the menu');
    check(await g.page.evaluate(() => JSON.parse(localStorage.getItem('MOONSHARD_SAVE_V1') || '{}').tutorialDone === true), 'and counts the tutorial as done');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 3. E closes a dialogue without swinging the sword ---------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), tutorialDone: true });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    await g.startScene('StoryScene', { chapter: 1 });
    log('▶ pressing E through the story\'s dialogue');
    await g.page.waitForFunction(() => window.game.scene.getScene('StoryScene')?.inDialogue === true, null, { timeout: 20_000 });
    let swung = false;
    let closed = false;
    for (let i = 0; i < 60 && !closed; i++) {
      await g.page.keyboard.press('KeyE');
      await g.page.waitForTimeout(260);
      const s = await scene(g.page, 'StoryScene', (sc) => ({ talking: sc.inDialogue, attacking: sc.player.isAttacking }));
      if (!s.talking) { closed = true; swung = s.attacking; }
    }
    check(closed, 'E turns the pages until the dialogue is over');
    // look again a moment later: the sword may only swing from a press made after the dialogue
    await g.page.waitForTimeout(120);
    swung = swung || (await scene(g.page, 'StoryScene', (sc) => sc.player.isAttacking));
    check(!swung, 'and the press that closed it did not swing the sword');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ tutorial check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ tutorial check passed');
