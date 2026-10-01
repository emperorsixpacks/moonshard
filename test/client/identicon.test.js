import test from 'node:test';
import assert from 'node:assert/strict';
import { identiconGrid, identiconSvg, identiconDataUrl } from '../../src/gd/identicon.js';

const A = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const B = '0x2222222222222222222222222222222222222222';

test('grid is deterministic, case-insensitive and horizontally symmetric', () => {
  assert.deepEqual(identiconGrid(A), identiconGrid(A.toUpperCase().replace('0X', '0x')));
  for (const row of identiconGrid(A)) assert.deepEqual(row, [...row].reverse());
});

test('different addresses give different images', () => {
  assert.notEqual(identiconSvg(A), identiconSvg(B));
});

test('data url is a decodable svg', async () => {
  const url = await identiconDataUrl(A);
  assert.match(url, /^data:image\/svg\+xml;utf8,/);
  assert.match(decodeURIComponent(url.split(',')[1]), /^<svg /);
});
