import test from 'node:test';
import assert from 'node:assert/strict';
import { shortAddress, formatG, walletG, formatCountdown, explainError } from '../../src/gd/format.js';

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

test('walletG rounds a balance down to the cent, and a balance on a cent stays on it', () => {
  // each of these sits a hair under its cent once multiplied by 100 in binary (0.29 * 100 is 28.999999999999996)
  for (const cents of ['19.99', '0.29', '1.15', '4.35', '8.2', '0.57']) assert.equal(walletG(Number(cents)), formatG(cents, 2), `${cents} G$`);
  assert.equal(walletG('19.99'), '19.99');
  assert.equal(walletG(19.999), '19.99', 'rounded down: a balance shown as 20 can pay 20');
  assert.equal(walletG('420.999'), '420.99');
  assert.equal(walletG('0.009'), '0');
  assert.equal(walletG(20), '20');
  assert.equal(walletG('12873.5'), '12,873.5');
  assert.equal(walletG('nope'), '0');
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
  // a real timeout is "slow"; any other network failure is "can't reach" (offline devices used to be told the server was slow)
  assert.match(explainError({ message: 'timeout', status: 0 }), /slow/i);
  assert.match(explainError({ message: 'x', status: 0 }), /reach|connection/i);
  assert.equal(explainError({ message: 'not_claimable', body: { reason: 'Claim cooldown not reached' } }), 'Claim cooldown not reached');
  assert.equal(explainError(new Error('x'.repeat(200))), 'Something went wrong. Please try again.');
});
