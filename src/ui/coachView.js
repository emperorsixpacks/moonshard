import { LESSONS, lessonSay } from './tutorialLessons.js';
import { ico } from './icons.js';
import { input } from '../engine/inputMode.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Sylva's line as markup: a word in [brackets] becomes a key cap. */
export const sayHtml = (text) => esc(text).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');

/**
 * The lesson card: Sylva, how far along the six lessons are, her instruction and what is left to do.
 * `done` is the set of task ids already done in this lesson.
 */
export function coachHtml({ index = 0, mode = 'keys', done = [] } = {}) {
  const lesson = LESSONS[index];
  if (!lesson) return '';
  const finished = new Set(done);
  const pips = LESSONS.map((l, i) => `<li class="${i < index ? 'done' : i === index ? 'now' : ''}"><span class="sr">${esc(l.title)}</span></li>`).join('');
  const tasks = lesson.tasks.map(([id, label]) => (
    `<li data-task="${id}" class="${finished.has(id) ? 'done' : ''}"><i>${ico('tick', 16)}</i>${esc(label)}</li>`
  )).join('');
  return `<div class="co-portrait"><img src="assets/companion/fairy_portrait.png" alt="" width="48" height="48"></div>`
    + `<div class="co-body">`
    + `<div class="co-top"><ol class="co-steps" role="img" aria-label="Lesson ${index + 1} of ${LESSONS.length}">${pips}</ol><b class="co-title">${esc(lesson.title)}</b></div>`
    + `<p class="co-say"><span class="co-who">Sylva</span> ${sayHtml(lessonSay(index, mode))}</p>`
    + `<ul class="co-tasks">${tasks}</ul>`
    + `</div>`
    + `<button type="button" class="co-skip" data-act="skip">Skip</button>`;
}

/** What the player learned, shown when the last lesson is done. */
export const LEARNED = ['Running and double jumps', 'Sword slashes and upward strikes', 'Stomp bounces and shell tactics'];

/** The "training complete" sheet's body: what they learned and the way on. `fromPrologue` is a player who came here from the story's start. */
export function doneHtml({ fromPrologue = false } = {}) {
  const learned = LEARNED.map((t) => `<li>${ico('tick', 18)}${esc(t)}</li>`).join('');
  return `<p class="lead">You have mastered the Moonshard.</p>`
    + `<ul class="learned">${learned}</ul>`
    + `<button type="button" class="gold btn" data-act="story">${esc(fromPrologue ? 'Begin chapter 1' : 'Start the story')}</button>`
    + `<div class="duo"><button type="button" class="btn-2" data-act="trial">Daily trial</button><button type="button" class="btn-2" data-act="menu">Main menu</button></div>`;
}

/**
 * The lesson card on screen, over the game. `onSkip` runs when the player taps Skip.
 * Returns { lesson(index), done(taskId), hide(), show(), destroy() }.
 */
export function createCoach(host, { onSkip = () => {}, mode = () => input.mode } = {}) {
  const el = document.createElement('div');
  el.className = 'coach';
  el.setAttribute('role', 'status');
  host.appendChild(el);

  let index = 0;
  let done = new Set();
  const paint = (enter) => {
    el.innerHTML = coachHtml({ index, mode: mode(), done: [...done] });
    if (enter) {
      el.classList.remove('enter');
      void el.offsetWidth; // restart the entrance
      el.classList.add('enter');
    }
  };
  const onClick = (e) => {
    if (e.target.closest('[data-act="skip"]')) onSkip();
  };
  el.addEventListener('click', onClick);
  // a keyboard player who touches the screen (or the other way round) gets the other wording
  const stop = input.subscribe(() => paint(false));

  return {
    /** Start lesson `i` (0-based). */
    lesson(i) {
      index = i;
      done = new Set();
      el.classList.remove('cleared');
      paint(true);
    },
    /** A task of this lesson is done. */
    done(taskId) {
      if (done.has(taskId)) return;
      done.add(taskId);
      el.querySelector(`[data-task="${taskId}"]`)?.classList.add('done');
    },
    /** The whole lesson is done: the steps light up before the next lesson comes. */
    complete() {
      el.classList.add('cleared');
    },
    hide() { el.hidden = true; },
    show() { el.hidden = false; },
    destroy() {
      stop();
      el.removeEventListener('click', onClick);
      el.remove();
    },
  };
}
