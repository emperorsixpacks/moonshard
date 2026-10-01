import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../../src/engine/Storage.js';
import { setBlessed } from '../../src/gd/blessing.js';

test('without a blessing materials are added 1:1', () => {
  setBlessed(false);
  const before = { ...storage.getMaterials() };
  storage.addMaterials({ bark: 3, amber: 1, iron: 2 });
  const after = storage.getMaterials();
  assert.equal(after.bark - before.bark, 3);
  assert.equal(after.amber - before.amber, 1);
  assert.equal(after.iron - before.iron, 2);
});

test('with the Citizen\'s Blessing drops are +25% with fractional carry (4 single drops -> 5)', () => {
  setBlessed(true);
  const before = storage.getMaterials().bark;
  for (let i = 0; i < 4; i++) storage.addMaterials({ bark: 1 });
  assert.equal(storage.getMaterials().bark - before, 5);
  setBlessed(false);
});
