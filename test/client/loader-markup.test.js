import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOADER_END, LOADER_START, loaderHtml } from '../../src/ui/loaderMarkup.js';

/*
 * The loading screen is written into index.html so it shows before any script has loaded. If its source changes, the page
 * must be regenerated (node scripts/inject-loader.mjs); this test fails until it is.
 */

const page = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('the loading screen in index.html is the one src/ui/loaderMarkup.js makes', () => {
  const a = page.indexOf(LOADER_START);
  const b = page.indexOf(LOADER_END);
  assert.ok(a > 0 && b > a, 'both markers are in the page');
  const written = page.slice(a + LOADER_START.length, b).trim();
  assert.equal(written, loaderHtml(), 'run: node scripts/inject-loader.mjs');
});

test('the page gives the game the two hooks it uses to report progress and to finish', () => {
  assert.match(page, /window\.__setGameLoader = /);
  assert.match(page, /window\.__dismissGameLoader = /);
  const boot = fs.readFileSync(new URL('../../src/scenes/BootScene.js', import.meta.url), 'utf8');
  assert.match(boot, /__setGameLoader\(value\)/, 'BootScene reports the real progress');
  assert.match(boot, /__dismissGameLoader/, 'and says when it is done');
});

test('the loader reaches the player as a progress bar with a name', () => {
  assert.match(loaderHtml(), /role="progressbar" aria-label="Loading"/);
  assert.match(loaderHtml(), /Loading the forest/);
});
