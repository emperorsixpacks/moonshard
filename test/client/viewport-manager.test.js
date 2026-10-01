import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * Turning the phone changes the game's shape (480x270 landscape, 480x440 portrait). Phaser fits the picture to a box of
 * the aspect ratio it was last TOLD; `resize()` keeps the old ratio (it is for the NONE scale mode), `setGameSize()`
 * updates it. Using `resize()` left the picture squashed after every rotation.
 */

function fakeGame({ width, height }) {
  const calls = [];
  return {
    calls,
    scene: { getScenes: () => [] },
    scale: {
      width, height,
      setGameSize(w, h) { calls.push(['setGameSize', w, h]); this.width = w; this.height = h; },
      resize(w, h) { calls.push(['resize', w, h]); this.width = w; this.height = h; },
    },
  };
}

async function withScreen({ portrait }, fn) {
  const listeners = {};
  globalThis.window = {
    innerWidth: portrait ? 390 : 844,
    innerHeight: portrait ? 844 : 390,
    matchMedia: () => ({ matches: portrait, addEventListener() {} }),
    addEventListener: (type, cb) => { listeners[type] = cb; },
    removeEventListener() {},
  };
  globalThis.document = { getElementById: () => null };
  try {
    const { ViewportManager } = await import(`../../src/engine/ViewportManager.js?t=${Math.random()}`);
    await fn({ ViewportManager, listeners, setPortrait: (p) => { globalThis.window.matchMedia = () => ({ matches: p, addEventListener() {} }); } });
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
}

test('starting upright on a landscape-shaped game re-shapes it with setGameSize, so the picture is fitted to the new ratio', async () => {
  await withScreen({ portrait: true }, async ({ ViewportManager }) => {
    const game = fakeGame({ width: 480, height: 270 });
    new ViewportManager(game);
    assert.deepEqual(game.calls, [['setGameSize', 480, 440]]);
  });
});

test('rotating the phone re-shapes the game the same way, both ways', async () => {
  await withScreen({ portrait: false }, async ({ ViewportManager, listeners, setPortrait }) => {
    const game = fakeGame({ width: 480, height: 270 });
    new ViewportManager(game);
    assert.deepEqual(game.calls, []);

    setPortrait(true);
    listeners.resize();
    assert.deepEqual(game.calls, [['setGameSize', 480, 440]]);

    setPortrait(false);
    listeners.resize();
    assert.deepEqual(game.calls.at(-1), ['setGameSize', 480, 270]);
    assert.equal(game.calls.some(([name]) => name === 'resize'), false);
  });
});

test('turning the phone tells every screen that is showing the new size, and restarts none of them itself', async () => {
  // Each screen knows how to re-lay itself out (a menu closes its dialog and restarts, the forge keeps its tab, a level
  // adapts in place), so the manager only passes the new size on. Restarting the menu-type screens from here threw away
  // what their own handlers keep: an open dialog came back dead, the forge went back to its first tab.
  await withScreen({ portrait: false }, async ({ ViewportManager, listeners, setPortrait }) => {
    const restarted = [];
    const told = [];
    const scene = (key) => ({
      scene: { key, restart: () => restarted.push(key) },
      onViewportResize: (w, h) => told.push([key, w, h]),
    });
    const game = fakeGame({ width: 480, height: 270 });
    game.scene.getScenes = () => ['MenuScene', 'ForgeScene', 'LeaderboardScene', 'StoryIntroScene', 'SurvivalScene', 'StoryScene'].map(scene);
    new ViewportManager(game);
    setPortrait(true);
    listeners.resize();
    assert.deepEqual(restarted, [], 'the manager never restarts a screen on its own');
    assert.deepEqual(
      told,
      ['MenuScene', 'ForgeScene', 'LeaderboardScene', 'StoryIntroScene', 'SurvivalScene', 'StoryScene'].map((key) => [key, 480, 440]),
    );
  });
});

test('a screen without a resize handler is simply left alone', async () => {
  await withScreen({ portrait: false }, async ({ ViewportManager, listeners, setPortrait }) => {
    const game = fakeGame({ width: 480, height: 270 });
    game.scene.getScenes = () => [{ scene: { key: 'BootScene', restart() { throw new Error('must not restart'); } } }];
    new ViewportManager(game);
    setPortrait(true);
    assert.doesNotThrow(() => listeners.resize());
  });
});
