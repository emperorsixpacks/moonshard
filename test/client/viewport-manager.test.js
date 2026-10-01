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

test('turning the phone rebuilds the menu-type screens for the new shape, and never restarts a level in progress', async () => {
  await withScreen({ portrait: false }, async ({ ViewportManager, listeners, setPortrait }) => {
    const restarted = [];
    const resized = [];
    const scene = (key, extra = {}) => ({ scene: { key, restart: () => restarted.push(key) }, ...extra });
    const game = fakeGame({ width: 480, height: 270 });
    game.scene.getScenes = () => [
      scene('MenuScene', { onViewportResize: () => resized.push('menu handler') }), // returns early in the real game
      scene('SurvivalScene', { onViewportResize: (w, h) => resized.push(['level', w, h]) }),
      scene('ForgeScene'),
      scene('LeaderboardScene'),
      scene('StoryScene'),
      scene('TutorialScene'),
      scene('CustomScene', { onViewportResize: (w, h) => resized.push([w, h]) }),
    ];
    new ViewportManager(game);
    setPortrait(true);
    listeners.resize();
    assert.deepEqual(restarted, ['MenuScene', 'ForgeScene', 'LeaderboardScene']);
    assert.deepEqual(resized, [['level', 480, 440], [480, 440]], 'a level adapts in place; a custom scene is told; neither is restarted');
  });
});
