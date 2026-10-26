// Shared plumbing for the browser checks in this folder: serve the game with Vite on a free port, drive it with
// Playwright's Chromium, and optionally stand in for the Moonshard API with `page.route` (no server, no chain).
//   node test/client/browser/<script>.mjs        (run from the repository root)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { freePort, waitForMoonshard } from '../../../scripts/fork/ports.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;

// The dev servers still running: one exit handler stops them all (a handler per boot trips Node's listener limit in a long script).
const servers = new Set();
process.on('exit', () => servers.forEach((server) => server.kill()));

/**
 * Boot the dev server and a browser page. Returns { page, web, errors, close, startScene, scene }.
 *  - `api`: false (default) leaves the API unreachable (port 9), like a first visit; true serves /api from the page
 *    origin so the test can answer it with `page.route`.
 *  - `deviceScaleFactor`: the screen's pixel density (a sharp 2x display, say).
 *  - `clock`: install Playwright's fake clock before the page loads (Date, timers, rAF and performance.now all follow it).
 *  - `tutorialDone`: the player has been through the tutorial (the menu's big button then leads to the story, not to it).
 *  - `env`: more environment for the dev server, e.g. `{ VITE_MAGIC_PUBLISHABLE_KEY: 'pk_test' }`.
 */
export async function bootGame({ api = false, clock = false, viewport = { width: 1280, height: 800 }, deviceScaleFactor, init, tutorialDone = false, env: extraEnv = {} } = {}) {
  const port = await freePort();
  const web = `http://127.0.0.1:${port}`;
  const env = { ...process.env, ...extraEnv };
  if (api) delete env.VITE_API_URL;
  else env.VITE_API_URL = 'http://127.0.0.1:9';
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: 'ignore' });
  servers.add(vite);
  const close = async () => { await browser?.close().catch(() => {}); vite.kill(); servers.delete(vite); };
  let browser;
  try {
    await waitForMoonshard(web);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport, ...(deviceScaleFactor ? { deviceScaleFactor } : {}) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    if (clock) await page.clock.install();
    // a player who has done the tutorial: the menu's big button leads to the story
    if (tutorialDone) await page.addInitScript({ content: "localStorage.setItem('MOONSHARD_SAVE_V1', JSON.stringify({ tutorialDone: true, prologueSeen: true }));" });
    if (init) await page.addInitScript({ content: init }); // a string of JS, run before the app on every load
    return {
      page, web, errors, close, context,
      goto: async () => {
        await page.goto(web);
        await page.waitForFunction(() => window.game?.scene?.isActive('MenuScene'), null, { timeout: 60_000 });
      },
      // Phaser's scene.start leaves other scenes running underneath; stop them so one scene (and one run) is live
      startScene: async (key, data) => {
        await page.evaluate(([k, d]) => {
          for (const s of window.game.scene.getScenes(true)) if (s.scene.key !== k) window.game.scene.stop(s.scene.key);
          window.game.scene.start(k, d);
        }, [key, data]);
        await page.waitForFunction((k) => window.game.scene.isActive(k), key, { timeout: 30_000 });
      },
    };
  } catch (err) {
    await close();
    throw err;
  }
}

/** Run `fn(scene)` inside the page against a live scene and return its (serialisable) result. */
export const inScene = (page, key, fn, arg) => page.evaluate(
  ([k, src, a]) => (0, eval)(`(${src})`)(window.game.scene.getScene(k), a),
  [key, fn.toString(), arg],
);

/** All Text objects of a scene, in display order, as plain strings (what the player reads). */
export const sceneTexts = (page, key) => inScene(page, key, (scene) => scene.children.list
  .filter((o) => o.type === 'Text' && o.visible !== false)
  .map((o) => o.text));

/**
 * Waits until a scene has run a few frames. Phaser adds a new scene's interactive objects to its input list on the
 * scene's next update, so a click that lands in its very first frame finds nothing to hit. (A person cannot tap a
 * screen before it has drawn once; a script can.)
 */
export const settled = (page, key, frames = 4) => page.evaluate(([k, n]) => new Promise((resolve) => {
  const scene = window.game.scene.getScene(k);
  let seen = 0;
  const onUpdate = () => { if (++seen >= n) { scene.events.off('update', onUpdate); resolve(); } };
  scene.events.on('update', onUpdate);
}), [key, frames]);

/** A real mouse click on the middle of the menu row whose label contains `label`. */
export async function clickMenuRow(page, label) {
  await settled(page, 'MenuScene');
  const at = await inScene(page, 'MenuScene', (scene, text) => {
    const t = scene.children.list.find((o) => o.type === 'Text' && o.text.includes(text));
    const row = scene.children.list.find((o) => o.type === 'Rectangle' && o.input?.enabled
      && Math.abs(o.x - t.x) < 1 && Math.abs(t.y - o.y) <= o.height / 2);
    const b = row.getBounds();
    const r = window.game.canvas.getBoundingClientRect();
    const k = r.width / window.game.scale.width;
    return { x: r.left + (b.x + b.width / 2) * k, y: r.top + (b.y + b.height / 2) * k };
  }, label);
  await page.mouse.click(at.x, at.y);
}

/* ---- the interface layer: the menu and the sheets over the screen (src/ui) ---- */

/** The sheet over the screen right now (the wallet, the way in, settings, the chapter list). */
export const sheetOpen = (page) => page.evaluate(() => Boolean(document.querySelector('#ms-sheets .sheet:not(.out)')));
export const sheetText = (page) => page.evaluate(() => document.querySelector('#ms-sheets .sheet')?.innerText ?? '');
/** The kind of sheet: 'wallet', 'gate', 'settings', 'chapters' or '' when none is open. */
export const sheetName = (page) => page.evaluate(() => (document.querySelector('#ms-sheets .sheet')?.className.match(/\bs-(\w+)/) ?? [])[1] ?? '');
/** Waits for a sheet whose text matches `re` (any sheet when `re` is omitted). Resolves true, or false after `timeout`. */
export const waitSheet = (page, re = /./, timeout = 20_000) => page.waitForFunction(
  (src) => new RegExp(src).test(document.querySelector('#ms-sheets .sheet:not(.out)')?.innerText ?? ''),
  re.source, { timeout },
).then(() => true, () => false);
/** Closes the sheet with its close button, and waits for it to slide away. */
export async function closeSheet(page) {
  if (!(await sheetOpen(page))) return;
  await page.click('#ms-sheets [data-sheet="close"]');
  await page.waitForFunction(() => !document.querySelector('#ms-sheets .sheet'), null, { timeout: 5000 });
}
/** A real click on a control of the menu: play, endless, forge, ranks, wallet, settings, chapters. */
export async function clickMenu(page, act) {
  const sel = `#ms-menu [data-act="${act}"]`;
  await page.waitForSelector(sel, { timeout: 30_000 });
  await page.click(sel);
}
/** What the menu's big button says: its title and the line under it. */
export const playButton = (page) => page.evaluate(() => {
  const b = document.querySelector('#ms-menu .btn-main');
  return b ? { title: b.querySelector('b').textContent, sub: b.querySelector('small').textContent } : null;
});
