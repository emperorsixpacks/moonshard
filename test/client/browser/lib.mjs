// Shared plumbing for the browser checks in this folder: serve the game with Vite on a free port, drive it with
// Playwright's Chromium, and optionally stand in for the Moonshard API with `page.route` (no server, no chain).
//   node test/client/browser/<script>.mjs        (run from the repository root)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { freePort, waitForMoonshard } from '../../../scripts/fork/ports.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;

/**
 * Boot the dev server and a browser page. Returns { page, web, errors, close, startScene, scene }.
 *  - `api`: false (default) leaves the API unreachable (port 9), like a first visit; true serves /api from the page
 *    origin so the test can answer it with `page.route`.
 *  - `clock`: install Playwright's fake clock before the page loads (Date, timers, rAF and performance.now all follow it).
 */
export async function bootGame({ api = false, clock = false, viewport = { width: 1280, height: 800 }, init } = {}) {
  const port = await freePort();
  const web = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  if (api) delete env.VITE_API_URL;
  else env.VITE_API_URL = 'http://127.0.0.1:9';
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, env, stdio: 'ignore' });
  const close = async () => { await browser?.close().catch(() => {}); vite.kill(); };
  process.on('exit', () => vite.kill());
  let browser;
  try {
    await waitForMoonshard(web);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    if (clock) await page.clock.install();
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
