import test from 'node:test';
import assert from 'node:assert/strict';
import { shortAddress, formatG, formatCountdown, explainError } from '../../src/gd/format.js';

test('shortAddress keeps both ends and leaves short input alone', () => {
  assert.equal(shortAddress('0x1234567890abcdef1234567890abcdef12345678'), '0x1234…5678');
  assert.equal(shortAddress('0x12'), '0x12');
  assert.equal(shortAddress(null), '');
});

test('formatG groups thousands and respects decimals', () => {
  assert.equal(formatG(5000), '5,000');
  assert.equal(formatG('1234.5678', 2), '1,234.57');
  assert.equal(formatG('nope'), '0');
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(-5), 'now');
  assert.equal(formatCountdown(30 * 60_000), '30m');
  assert.equal(formatCountdown(3 * 3600_000 + 12 * 60_000), '3h 12m');
});

test('explainError maps known codes and never leaks a stack', () => {
  assert.match(explainError('no_wallet'), /No wallet found/);
  assert.match(explainError(Object.assign(new Error('rejected'), { status: 400 })), /cancelled/i);
  assert.match(explainError({ message: 'x', status: 0 }), /slow/i);
  assert.equal(explainError({ message: 'not_claimable', body: { reason: 'Claim cooldown not reached' } }), 'Claim cooldown not reached');
  assert.equal(explainError(new Error('x'.repeat(200))), 'Something went wrong. Please try again.');
});
