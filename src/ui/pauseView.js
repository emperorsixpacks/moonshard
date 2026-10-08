import { ico } from './icons.js';

/*
 * The pause menu, as markup (no DOM, no services), drawn inside #ms-ui like every other sheet. PauseService owns the
 * behaviour; the buttons carry `data-act` so one listener can serve them all, and the audio buttons can be redrawn when
 * a setting changes without losing it.
 */

/** Sound and music: an icon and a word each. Off is dimmed and struck through, not a warning colour: it is a setting. */
export function audioHtml({ soundOn, musicOn }) {
  return `<button class="mini${soundOn ? '' : ' off'}" type="button" data-act="sound" aria-pressed="${soundOn}">${ico(soundOn ? 'spk_on' : 'spk_off', 26)}Sound</button>
    <button class="mini${musicOn ? '' : ' off'}" type="button" data-act="music" aria-pressed="${musicOn}">${ico(musicOn ? 'note_on' : 'note_off', 24)}Music</button>`;
}

export function pauseHtml({ soundOn = true, musicOn = true } = {}) {
  return `<div class="scrim" data-act="resume"></div>
  <section class="sheet s-pause" role="dialog" aria-modal="true" aria-label="Paused">
    <div class="sheet-h"><h2 id="pause-modal-title">Paused</h2><button id="btn-close-pause" class="icon-btn sm" type="button" data-act="resume" aria-label="Resume">${ico('close', 18)}</button></div>
    <div class="sheet-b">
      <p class="note" id="pause-mode-desc"></p>
      <div><button id="btn-pause-resume" class="gold btn" type="button" data-act="resume">${ico('play', 22)}Resume</button></div>
      <div class="duo"><button id="btn-pause-retry" class="btn-2" type="button" data-act="retry">Restart</button><button id="btn-pause-menu" class="btn-2" type="button" data-act="menu">Back to menu</button></div>
      <div class="audio" id="pause-audio">${audioHtml({ soundOn, musicOn })}</div>
    </div></section>`;
}
