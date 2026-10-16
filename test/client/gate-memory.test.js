import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberGate, takeGate } from '../../src/engine/gateMemory.js';

/*
 * The face scan takes the player to GoodDollar's site and back: the page reloads, so what they asked to play has to be
 * remembered across it, or they would have to find it again.
 */

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), size: () => m.size };
}

test('what the player asked to play comes back once, then is gone', () => {
  const storage = memoryStorage();
  rememberGate(storage, { key: 'StoryScene', data: { chapter: 3 } }, { now: 1000 });
  assert.deepEqual(takeGate(storage, { now: 2000 }), { key: 'StoryScene', data: { chapter: 3 } });
  assert.equal(takeGate(storage, { now: 2000 }), null);
  assert.equal(storage.size(), 0);
});

test('a request without data comes back without data', () => {
  const storage = memoryStorage();
  rememberGate(storage, { key: 'SurvivalScene' }, { now: 1000 });
  assert.deepEqual(takeGate(storage, { now: 1500 }), { key: 'SurvivalScene', data: undefined });
});

test('an old request is forgotten: the player wandered off', () => {
  const storage = memoryStorage();
  rememberGate(storage, { key: 'StoryScene' }, { now: 0 });
  assert.equal(takeGate(storage, { now: 31 * 60 * 1000 }), null);
  assert.equal(storage.size(), 0);
});

test('only play scenes can be remembered, so stored text can never start anything else', () => {
  const storage = memoryStorage();
  rememberGate(storage, { key: 'ForgeScene' }, { now: 0 });
  assert.equal(takeGate(storage, { now: 1 }), null);
  storage.setItem('moonshard.gate.v1', JSON.stringify({ key: 'MenuScene', at: 0 }));
  assert.equal(takeGate(storage, { now: 1 }), null);
});

test('garbage and blocked storage are harmless', () => {
  const storage = memoryStorage();
  storage.setItem('moonshard.gate.v1', '{not json');
  assert.equal(takeGate(storage), null);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => rememberGate(broken, { key: 'SurvivalScene' }));
  assert.equal(takeGate(broken), null);
  assert.equal(takeGate(undefined), null);
});
