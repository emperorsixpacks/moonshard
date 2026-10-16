import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playStageSize, groundLift, GROUND_Y, PLAY_WIDTH, PLAY_MIN_HEIGHT, PLAY_MAX_HEIGHT } from '../../src/engine/playStage.js';

test('the picture is as wide as a run is, and as tall as the screen is in proportion', () => {
  // an iPhone-shaped area under the page header
  const { width, height } = playStageSize({ width: 390, height: 616 });
  assert.equal(width, PLAY_WIDTH);
  assert.equal(height, Math.round(PLAY_WIDTH * 616 / 390));
});

test('a short or square area never gets less than the 440 the levels are built for', () => {
  assert.equal(playStageSize({ width: 390, height: 300 }).height, PLAY_MIN_HEIGHT);
  assert.equal(playStageSize({ width: 800, height: 800 }).height, PLAY_MIN_HEIGHT);
});

test('a very tall thin area is capped', () => {
  assert.equal(playStageSize({ width: 300, height: 1400 }).height, PLAY_MAX_HEIGHT);
});

test('no size to go by gives the plain 440', () => {
  assert.deepEqual(playStageSize({}), { width: PLAY_WIDTH, height: PLAY_MIN_HEIGHT });
  assert.deepEqual(playStageSize(), { width: PLAY_WIDTH, height: PLAY_MIN_HEIGHT });
  assert.equal(playStageSize({ width: 0, height: 0 }).height, PLAY_MIN_HEIGHT);
});

test('the hero is drawn bigger than on the other screens', () => {
  assert.ok(PLAY_WIDTH < 480);
});

test('the ground stays where it is when it is above the pad already', () => {
  assert.equal(groundLift(GROUND_Y + 40), 0);
  assert.equal(groundLift(GROUND_Y + 6), 0);
});

test('a pad that reaches up over the ground lifts the ground clear of it', () => {
  assert.equal(groundLift(GROUND_Y - 20), 26); // 6 clear of the pad's top
  assert.ok(groundLift(300) > 0);
});

test('the lift is capped, and there is none without a pad', () => {
  assert.equal(groundLift(10), 150);
  assert.equal(groundLift(0), 0);
  assert.equal(groundLift(NaN), 0);
  assert.equal(groundLift(-30), 0);
});
