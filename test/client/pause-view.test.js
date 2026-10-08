import test from 'node:test';
import assert from 'node:assert/strict';
import { audioHtml, pauseHtml } from '../../src/ui/pauseView.js';

/* The pause menu as markup: PauseService finds its parts by these ids and acts on these data-act values. */

test('the pause menu has every button the service looks for, and a dimmed screen that resumes', () => {
  const h = pauseHtml();
  for (const id of ['pause-modal-title', 'btn-close-pause', 'pause-mode-desc', 'btn-pause-resume', 'btn-pause-retry', 'btn-pause-menu', 'pause-audio']) {
    assert.match(h, new RegExp(`id="${id}"`), id);
  }
  for (const act of ['resume', 'retry', 'menu', 'sound', 'music']) assert.match(h, new RegExp(`data-act="${act}"`), act);
  assert.match(h, /<div class="scrim" data-act="resume">/);
  assert.match(h, /role="dialog" aria-modal="true" aria-label="Paused"/);
});

test('the main action is Resume, in the one gold button', () => {
  assert.match(pauseHtml(), /class="gold btn"[^>]*data-act="resume"[^>]*>[\s\S]*Resume</);
});

test('sound and music say what is on and off as a state, not as a warning', () => {
  const on = audioHtml({ soundOn: true, musicOn: true });
  assert.equal((on.match(/aria-pressed="true"/g) || []).length, 2);
  assert.doesNotMatch(on, /class="mini off"/);
  const off = audioHtml({ soundOn: false, musicOn: true });
  assert.match(off, /class="mini off" type="button" data-act="sound" aria-pressed="false"/);
  assert.match(off, /class="mini" type="button" data-act="music" aria-pressed="true"/);
  assert.doesNotMatch(off, /red|alert|error/i);
});

test('the pause menu follows the settings it is opened with', () => {
  assert.match(pauseHtml({ soundOn: false, musicOn: false }), /aria-pressed="false"[\s\S]*aria-pressed="false"/);
});
