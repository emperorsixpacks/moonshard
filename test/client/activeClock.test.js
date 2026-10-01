import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveClock, pageHidden } from '../../src/gd/activeClock.js';

/** Feed `ms` of 60 fps frames and return the clock. */
function play(clock, ms, flags = {}, frame = 1000 / 60) {
  for (let t = 0; t < ms; t += frame) clock.tick(frame, flags);
  return clock;
}

test('H1: counts the frames that are played', () => {
  const clock = play(new ActiveClock(), 5_000, {}, 100);
  assert.equal(clock.ms, 5_000);
  assert.equal(clock.seconds, 5);
  assert.ok(Math.abs(play(new ActiveClock(), 5_000).ms - 5_000) < 20, 'at 60 fps too');
});

test('H1: a long pause adds nothing: 39 minutes behind the pause screen are not 23,400 points', () => {
  const clock = new ActiveClock();
  play(clock, 3_000);
  const before = clock.ms;
  play(clock, 39 * 60_000, { paused: true }); // the scene keeps updating while paused, at 60 fps
  assert.equal(clock.ms, before);
  play(clock, 2_000);
  assert.ok(clock.seconds >= 4 && clock.seconds <= 5, `seconds=${clock.seconds}`);
  // the old formula, performance.now() - startTime, would have said this for the same session
  const wallSeconds = Math.floor((3_000 + 39 * 60_000 + 2_000) / 1000);
  assert.equal(wallSeconds, 2_345);
});

test('H1: a hidden tab adds nothing', () => {
  const clock = new ActiveClock();
  play(clock, 1_000);
  const before = clock.ms;
  play(clock, 39 * 60_000, { hidden: true });
  assert.equal(clock.ms, before);
});

test('H1: paused and hidden together still add nothing, and resuming picks up where it left off', () => {
  const clock = new ActiveClock();
  play(clock, 1_000);
  const before = clock.ms;
  play(clock, 10_000, { paused: true, hidden: true });
  play(clock, 1_000);
  assert.ok(Math.abs(clock.ms - (before + 1_000)) < 20);
});

test('H1: one frame is capped, so a stalled tab cannot add a big jump', () => {
  const clock = new ActiveClock();
  assert.equal(clock.tick(30 * 60_000), 250);
  assert.equal(clock.ms, 250);
  assert.equal(clock.tick(90_000), 250);
  assert.equal(clock.ms, 500);
});

test('H1: the cap can be configured', () => {
  const clock = new ActiveClock({ maxStepMs: 100 });
  assert.equal(clock.tick(5_000), 100);
});

test('H1: ignores deltas that are not positive finite numbers', () => {
  const clock = new ActiveClock();
  for (const bad of [0, -16, NaN, Infinity, -Infinity, undefined, null, '16', {}]) assert.equal(clock.tick(bad), 0, String(bad));
  assert.equal(clock.ms, 0);
});

test('H1: seconds are whole, rounded down', () => {
  const clock = new ActiveClock();
  clock.tick(200);
  clock.tick(200);
  clock.tick(200);
  clock.tick(200);
  clock.tick(200);
  assert.equal(clock.ms, 1_000);
  assert.equal(clock.seconds, 1);
  clock.tick(249);
  assert.equal(clock.seconds, 1);
});

test('H1: tick() credits exactly what it returns, never more than the frame', () => {
  const clock = new ActiveClock();
  let credited = 0;
  for (const d of [16.7, 33, 250, 400, 0, 12]) credited += clock.tick(d);
  assert.equal(clock.ms, credited);
  assert.equal(credited, 16.7 + 33 + 250 + 250 + 0 + 12);
});

test('pageHidden() reads document.hidden and is false without a document', () => {
  assert.equal(pageHidden(), false);
  globalThis.document = { hidden: true };
  try {
    assert.equal(pageHidden(), true);
    globalThis.document.hidden = false;
    assert.equal(pageHidden(), false);
  } finally {
    delete globalThis.document;
  }
});
