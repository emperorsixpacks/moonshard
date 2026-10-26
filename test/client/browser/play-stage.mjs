// A run held upright takes the whole screen, with the pad floating on top of it:
//   the picture fills the space under the header and is narrower than the other screens; the ground is above the pad;
//   every run (tutorial, story, endless) does it, other screens keep their own size, a rotation follows, and the page
//   is back to normal when the run is over.
//   node test/client/browser/play-stage.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';
import { installApi, sessionInit } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

/** The numbers that matter: the picture, where it sits, the pad, and where the ground's top edge lands on screen. */
const measure = (page, groundOf) => page.evaluate((src) => {
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom }; };
  const wrapper = document.getElementById('game-wrapper');
  const canvas = rect(document.querySelector('#game-container canvas'));
  const area = rect(wrapper);
  const cluster = document.querySelector('#touch-controls .touch-actions');
  const pad = cluster && cluster.offsetParent !== null ? rect(cluster) : null;
  const scale = window.game.scale;
  const unit = canvas.w / scale.width;
  const scene = window.game.scene.getScenes(true)[0];
  const groundY = src ? new Function('s', `return (${src})(s)`)(scene) : null;
  const scrollY = scene?.cameras?.main?.scrollY ?? 0;
  return {
    stage: wrapper.dataset.stage, game: [scale.width, scale.height], canvas, area, pad, unit,
    groundScreenY: groundY == null ? null : canvas.y + (groundY - scrollY) * unit,
  };
}, groundOf ? groundOf.toString() : null);

const PHONES = [{ name: 'a tall phone', width: 390, height: 664 }, { name: 'a short phone', width: 375, height: 560 }, { name: 'a very tall phone', width: 430, height: 932 }];
const SCENES = [
  { key: 'TutorialScene', ground: (s) => s.groundY },
  { key: 'StoryScene', data: { chapter: 1, skipIntroCard: true, skipDialogue: true }, ground: () => 380 },
  { key: 'SurvivalScene', ground: () => 320 },
];

for (const phone of PHONES) {
  const g = await bootGame({ api: true, init: sessionInit(), viewport: { width: phone.width, height: phone.height }, tutorialDone: true });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    await g.page.evaluate(() => window.dispatchEvent(new Event('touchstart'))); // played with fingers: the pad is drawn
    log(`▶ ${phone.name} (${phone.width}x${phone.height}), held upright`);

    let before = await measure(g.page);
    check(before.stage === 'screen' && before.game[0] === 480, `the menu keeps the usual 480-wide picture (${before.game.join('x')})`);

    for (const sc of SCENES) {
      await g.startScene(sc.key, sc.data);
      await g.page.waitForTimeout(1200);
      const m = await measure(g.page, sc.ground);
      log(`  ${sc.key}: picture ${m.game.join('x')}, on screen ${Math.round(m.canvas.w)}x${Math.round(m.canvas.h)}, pad top ${m.pad && Math.round(m.pad.y)}, ground at ${Math.round(m.groundScreenY)}`);
      check(m.stage === 'play', `${sc.key}: the page is in the run's layout`);
      check(m.game[0] < 480, `${sc.key}: the picture is narrower than the other screens (${m.game[0]})`);
      check(m.game[1] >= 440, `${sc.key}: and never shorter than the 440 the levels are built for (${m.game[1]})`);
      check(Math.abs(m.canvas.w - phone.width) <= 1, `${sc.key}: it is as wide as the screen (${Math.round(m.canvas.w)})`);
      check(Math.abs(m.canvas.y + m.canvas.h - m.area.bottom) <= 2 || m.game[1] >= 760, `${sc.key}: and reaches the bottom of the screen`);
      check(m.pad && m.pad.y < m.canvas.y + m.canvas.h && m.pad.bottom <= m.area.bottom + 1, `${sc.key}: the pad floats over the picture instead of sitting under it`);
      check(m.groundScreenY <= m.pad.y + 1, `${sc.key}: the ground is above the pad (ground ${Math.round(m.groundScreenY)}, pad ${Math.round(m.pad.y)})`);
    }

    // leaving a run puts the usual picture back, with no pad on a screen that has nothing to play
    for (const key of ['LeaderboardScene', 'ForgeScene']) {
      await g.startScene(key);
      await g.page.waitForTimeout(800);
      before = await measure(g.page);
      check(before.stage === 'screen' && before.game[0] === 480 && before.game[1] === 440, `${key}: after the run the picture is the usual 480x440 (${before.game.join('x')}, ${before.stage})`);
      check(before.pad === null, `${key}: and the game's pad is not drawn (a player is not playing here)`);
      const gap = await g.page.evaluate(() => { const c = document.querySelector('#game-container').getBoundingClientRect(); const w = document.getElementById('game-wrapper').getBoundingClientRect(); return { above: Math.round(c.top - w.top), below: Math.round(w.bottom - c.bottom) }; });
      check(Math.abs(gap.above - gap.below) <= 3, `${key}: the picture sits in the middle of the screen (${gap.above}px above, ${gap.below}px below)`);
    }
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- a keyboard player in a narrow window: no pad, the picture still fills the space ------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), viewport: { width: 390, height: 664 }, tutorialDone: true });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    await g.page.keyboard.press('KeyD'); // a game key: played with a keyboard
    await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
    await g.page.waitForTimeout(1000);
    log('▶ a keyboard player in a narrow window');
    const m = await measure(g.page, () => 380);
    check(m.pad === null, 'no pad is drawn');
    check(m.stage === 'play' && m.game[0] < 480, 'the run still has the whole window');
    check(Math.round(m.groundScreenY) <= m.area.bottom, 'and the ground is on screen');
  } finally { await g.close(); }
}

// ---- a rotation during a run ---------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: sessionInit(), viewport: { width: 390, height: 664 }, tutorialDone: true });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    await g.page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
    await g.startScene('StoryScene', { chapter: 1, skipIntroCard: true, skipDialogue: true });
    await g.page.waitForTimeout(1000);
    log('▶ rotating the phone during a run');
    await g.page.setViewportSize({ width: 844, height: 390 });
    await g.page.waitForFunction(() => window.game.scale.height === 270, null, { timeout: 5000 }).catch(() => {});
    let m = await measure(g.page);
    check(m.game[0] === 480 && m.game[1] === 270, `sideways it is the 480x270 picture (${m.game.join('x')})`);
    await g.page.setViewportSize({ width: 390, height: 664 });
    await g.page.waitForFunction(() => window.game.scale.height > 440, null, { timeout: 5000 }).catch(() => {});
    m = await measure(g.page);
    check(m.stage === 'play' && m.game[0] < 480 && m.game[1] > 440, `upright again it is the tall picture (${m.game.join('x')})`);
    check(Math.abs(m.canvas.w - 390) <= 1, 'filling the width again');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ play-stage check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ play-stage check passed');
