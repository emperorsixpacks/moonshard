import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputMode, GAME_KEYS } from '../../src/engine/inputMode.js';

test('a computer starts on keys and a phone on touch', () => {
  assert.equal(createInputMode().mode, 'keys');
  assert.equal(createInputMode({ coarse: true }).mode, 'touch');
});

test('a touch switches to touch and a game key switches back', () => {
  const m = createInputMode();
  m.touched();
  assert.equal(m.mode, 'touch');
  m.keyed('KeyE');
  assert.equal(m.mode, 'keys');
});

test('a key that does not play the game says nothing about how they play', () => {
  const m = createInputMode({ coarse: true });
  m.keyed('MetaLeft');
  m.keyed('F5');
  m.keyed('KeyZ'); // attack is E now
  assert.equal(m.mode, 'touch');
});

test('attack is E, and Z is not a game key', () => {
  assert.ok(GAME_KEYS.has('KeyE'));
  assert.ok(!GAME_KEYS.has('KeyZ'));
});

test('listeners hear a change once, and stop when asked', () => {
  const m = createInputMode();
  const heard = [];
  const stop = m.subscribe((mode) => heard.push(mode));
  m.touched();
  m.touched(); // no change, no call
  m.keyed('Space');
  stop();
  m.touched();
  assert.deepEqual(heard, ['touch', 'keys']);
});
