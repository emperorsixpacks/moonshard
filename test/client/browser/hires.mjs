// The sharp-picture safety net in a real browser. The game renders its picture N times larger so text is crisp; a device that
// cannot keep up steps down, and what happens next matters:
//   a remembered smaller size expires, and a size saved by an earlier version (forever) is not trusted
//   a frame rate that a smaller picture cannot raise (a browser cap such as Energy Saver) gets the sharp picture back, and
//     nothing is remembered
//   a smaller size that really does help is kept, and remembered for the next visit
//   node test/client/browser/hires.mjs        (run from the repository root; about 2 minutes)
import { bootGame } from './lib.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const CAP_KEY = 'moonshard.render.cap.v1';
const VIEWPORT = { width: 1000, height: 600 };
const HOURS = 3_600_000;
const seed = (value) => `localStorage.setItem(${JSON.stringify(CAP_KEY)}, ${JSON.stringify(value)});`;

/** The buffer's multiplier (the game is 480 units wide). */
const scaleOf = (page) => page.evaluate(() => Math.round(window.game.canvas.width / 480));
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), CAP_KEY);
/** Waits until `test(scale, arg)` holds. `test` runs in the page. */
const waitScale = (page, test, arg, ms) => page.waitForFunction(
  ([src, a]) => (0, eval)(`(${src})`)(Math.round(window.game.canvas.width / 480), a),
  [test.toString(), arg], { timeout: ms },
).then(() => true, () => false);

async function load(init) {
  const g = await bootGame({ viewport: VIEWPORT, deviceScaleFactor: 2, ...(init ? { init } : {}) });
  await g.goto();
  await g.page.waitForTimeout(500);
  return g;
}

// ---- 1. what a remembered size does ----------------------------------------------------------------------------------
log('▶ a remembered smaller size');
let full;
{
  const g = await load();
  try {
    full = await scaleOf(g.page);
    check(full >= 3, `a fresh visit gets the sharp picture (${full}x)`);
  } finally { await g.close(); }
}
for (const [label, raw, want] of [
  ['one saved a minute ago is used', JSON.stringify({ cap: 1, at: Date.now() - 60_000 }), 1],
  ['one saved three hours ago has expired', JSON.stringify({ cap: 1, at: Date.now() - 3 * HOURS }), full],
  ['one saved by an earlier version (a bare number, forever) is not trusted', '1', full],
  ['garbage is not trusted', '{"cap":', full],
]) {
  const g = await load(seed(raw));
  try {
    const scale = await scaleOf(g.page);
    check(scale === want, `${label} (${scale}x, wanted ${want}x)`);
  } finally { await g.close(); }
}

// ---- 2. a frame rate that a smaller picture cannot raise ---------------------------------------------------------------
log('▶ a browser cap on the frame rate (30 fps whatever the size)');
{
  const g = await load();
  try {
    await g.page.evaluate(() => Object.defineProperty(window.game.loop, 'actualFps', { get: () => 30, set() { /* the loop assigns it every second */ }, configurable: true }));
    check(await waitScale(g.page, (n, f) => n < f, full, 60_000), 'after a sustained low frame rate the picture steps down');
    check(await waitScale(g.page, (n, f) => n === f, full, 40_000), 'and goes back to the sharp size when the smaller one did not help');
    check((await stored(g.page)) === null, 'and nothing is remembered');
    await g.page.waitForTimeout(14_000);
    check((await scaleOf(g.page)) === full, 'and it does not try again this session');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- 3. a smaller size that really does help ---------------------------------------------------------------------------
log('▶ a device that really is faster at a smaller size');
{
  const g = await load();
  try {
    await g.page.evaluate((f) => Object.defineProperty(window.game.loop, 'actualFps', {
      get: () => (Math.round(window.game.canvas.width / 480) >= f ? 20 : 55),
      set() { /* the loop assigns it every second */ },
      configurable: true,
    }), full);
    check(await waitScale(g.page, (n, f) => n === f - 1, full, 60_000), 'the picture steps down one notch');
    await g.page.waitForTimeout(9_000); // three samples at the new size
    check((await scaleOf(g.page)) === full - 1, 'and keeps the smaller size, because it was clearly faster');
    const raw = JSON.parse((await stored(g.page)) ?? 'null');
    check(raw?.cap === full - 1 && Math.abs(raw.at - Date.now()) < 120_000, `and remembers it, with the time (${JSON.stringify(raw)})`);
    await g.goto();
    await g.page.waitForTimeout(500);
    check((await scaleOf(g.page)) === full - 1, 'the next visit starts at the smaller size');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ hires check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ hires check passed');
