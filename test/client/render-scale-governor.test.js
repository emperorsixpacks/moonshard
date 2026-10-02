import test from 'node:test';
import assert from 'node:assert/strict';
import { CAP_TTL_MS, createScaleGovernor, decodeCap, encodeCap } from '../../src/engine/renderScale.js';

/*
 * The safety net for a device that cannot keep up with the sharp (large) buffer used to be one-way: after about 8 seconds
 * below 40 fps the buffer stepped down, the lower size was saved for good, and nothing ever raised it again. Review finding:
 * a player who once played through a 30 fps cap (Chrome's Energy Saver, iOS Low Power Mode) or a CPU stall got the blurry
 * picture on every later visit, and a cap on the frame rate cannot be cured by a smaller picture at all.
 * Now a smaller size is kept only if it actually helped, and a remembered size expires.
 */

const feed = (governor, fpsList, scale) => {
  const actions = [];
  for (const fps of fpsList) actions.push(governor.sample({ fps, scale }));
  return actions;
};

test('a device that is slow at the larger size steps down after a sustained run of slow samples, but does not save it yet', () => {
  const g = createScaleGovernor();
  const actions = feed(g, [20, 22, 21, 20], 3);
  assert.deepEqual(actions.slice(0, 3), [null, null, null]);
  assert.deepEqual(actions[3], { scale: 2 });
});

test('if the smaller size is clearly faster, it is kept and then saved', () => {
  const g = createScaleGovernor();
  feed(g, [20, 22, 21, 20], 3);
  const after = feed(g, [48, 52, 50], 2); // three samples at the new size
  assert.deepEqual(after, [null, null, { save: 2 }]);
});

test('if the smaller size is no faster, the resolution was not the problem: the size is put back and nothing is saved', () => {
  const g = createScaleGovernor();
  feed(g, [30, 30, 30, 30], 3); // a 30 fps cap
  const after = feed(g, [30, 31, 30], 2);
  assert.deepEqual(after.slice(0, 2), [null, null]);
  assert.deepEqual(after[2], { scale: 3, forget: true });
});

test('...and then the governor leaves it alone for the rest of the session', () => {
  const g = createScaleGovernor();
  feed(g, [30, 30, 30, 30], 3);
  feed(g, [30, 30, 30], 2);
  assert.deepEqual(feed(g, [25, 25, 25, 25, 25, 25], 3), [null, null, null, null, null, null]);
});

test('a middling gain counts: it has to be a quarter better, or reach a healthy rate', () => {
  const kept = (before, after) => {
    const g = createScaleGovernor();
    feed(g, [before, before, before, before], 3);
    return feed(g, [after, after, after], 2).at(-1);
  };
  assert.deepEqual(kept(24, 30), { save: 2 }, '25% better');
  assert.deepEqual(kept(24, 29), { scale: 3, forget: true }, 'under 25% better and still slow');
  assert.deepEqual(kept(38, 44), { save: 2 }, 'reached a healthy rate');
});

test('the judgement uses the typical sample, not a single stall', () => {
  const g = createScaleGovernor();
  feed(g, [20, 20, 20, 20], 3);
  assert.deepEqual(feed(g, [8, 52, 50], 2).at(-1), { save: 2 }, 'one hiccup at the start does not condemn the smaller size');
});

test('samples that say nothing do not count either way', () => {
  const g = createScaleGovernor();
  assert.deepEqual(feed(g, [undefined, NaN, 0, -3], 3), [null, null, null, null]);
  feed(g, [20, 20, 20, 20], 3);
  assert.deepEqual(feed(g, [undefined, NaN, 50, 50, 50], 2), [null, null, null, null, { save: 2 }]);
});

test('reset() forgets a half-built case, as when the tab was hidden', () => {
  const g = createScaleGovernor();
  feed(g, [20, 20, 20], 3);
  g.reset();
  assert.equal(feed(g, [20], 3)[0], null, 'the count starts again');
});

test('a device that is slow even at the smallest size is left alone', () => {
  const g = createScaleGovernor();
  assert.deepEqual(feed(g, [10, 10, 10, 10, 10, 10], 1), [null, null, null, null, null, null]);
});

// ---- the remembered size ----

test('a remembered size is kept as a number and a time', () => {
  assert.deepEqual(JSON.parse(encodeCap(2, 1_000)), { cap: 2, at: 1_000 });
});

test('a remembered size is used for a while, then forgotten', () => {
  const raw = encodeCap(2, 1_000);
  assert.equal(decodeCap(raw, 1_000 + 60_000), 2);
  assert.equal(decodeCap(raw, 1_000 + CAP_TTL_MS - 1), 2);
  assert.equal(decodeCap(raw, 1_000 + CAP_TTL_MS), Infinity, 'after two hours the device gets another chance at the sharp picture');
});

test('what an earlier version saved (a bare number, forever) or garbage is not trusted', () => {
  for (const raw of ['1', '2', 'abc', '', null, undefined, '{"cap":0,"at":1}', '{"cap":2}', '{"at":5}', '[]', '{"cap":2,"at":"yesterday"}']) {
    assert.equal(decodeCap(raw, 10), Infinity, JSON.stringify(raw));
  }
});

test('a time in the future (a clock that was set back) is not trusted either', () => {
  assert.equal(decodeCap(encodeCap(2, 5_000_000), 1_000), Infinity);
});
