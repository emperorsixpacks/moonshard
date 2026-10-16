import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, lessonSay } from '../../src/ui/tutorialLessons.js';
import { coachHtml, doneHtml, sayHtml, LEARNED } from '../../src/ui/coachView.js';

test('a word in brackets is drawn as a key cap, and nothing else becomes markup', () => {
  assert.equal(sayHtml('Press [E] to slash'), 'Press <kbd>E</kbd> to slash');
  assert.equal(sayHtml('<b>[A]</b>'), '&lt;b&gt;<kbd>A</kbd>&lt;/b&gt;');
});

test('there are six lessons and each says something to a keyboard and to a finger', () => {
  assert.equal(LESSONS.length, 6);
  for (const [i, lesson] of LESSONS.entries()) {
    assert.ok(lesson.tasks.length >= 1, `${lesson.id} has a task`);
    assert.ok(lessonSay(i, 'keys').length > 10, `${lesson.id} has words for keys`);
    assert.ok(lessonSay(i, 'touch').length > 10, `${lesson.id} has words for touch`);
  }
});

test('the keyboard lessons name E for the attack, never Z', () => {
  const keys = LESSONS.map((_, i) => lessonSay(i, 'keys')).join(' ');
  assert.match(keys, /\[E\]/);
  assert.doesNotMatch(keys, /\[Z\]/);
});

test('a keyboard player is told about keys and a touch player about the buttons', () => {
  assert.match(coachHtml({ index: 0, mode: 'keys' }), /<kbd>A<\/kbd>/);
  assert.doesNotMatch(coachHtml({ index: 0, mode: 'keys' }), /JUMP|◀/);
  assert.match(coachHtml({ index: 1, mode: 'touch' }), /<kbd>JUMP<\/kbd>/);
  assert.doesNotMatch(coachHtml({ index: 1, mode: 'touch' }), /Space/);
});

test('the card shows how far along the lessons are and which tasks are done', () => {
  const h = coachHtml({ index: 2, mode: 'keys', done: ['crate'] });
  assert.equal((h.match(/<li class="done">/g) || []).length, 2); // two lessons behind
  assert.equal((h.match(/<li class="now">/g) || []).length, 1);
  assert.match(h, /data-task="crate" class="done"/);
  assert.match(h, /aria-label="Lesson 3 of 6"/);
  assert.match(coachHtml({ index: 0 }), /data-task="left" class=""/);
});

test('past the last lesson there is no card', () => {
  assert.equal(coachHtml({ index: 6 }), '');
});

test('the finish names what was learned and the way on', () => {
  const h = doneHtml();
  for (const line of LEARNED) assert.ok(h.includes(line));
  assert.match(h, /Start the story/);
  assert.match(h, /data-act="trial"/);
  assert.match(h, /data-act="menu"/);
  assert.match(doneHtml({ fromPrologue: true }), /Begin chapter 1/);
});
