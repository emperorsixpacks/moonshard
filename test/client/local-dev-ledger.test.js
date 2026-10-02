import test from 'node:test';
import assert from 'node:assert/strict';
import { formatG, ledgerRows, shortAddress } from '../../scripts/local-dev/ledger.mjs';

/*
 * The local test launcher shows the player's G$ moving in and out, labelled by what the game uses each source for. These
 * are the rules for turning raw token Transfer logs into that list.
 */

const PLAYER = '0x1111111111111111111111111111111111111111';
const UBI = '0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1';
const ENGAGEMENT = '0x25db74CF4E7BA120526fd87e159CF656d94bAE43';
const VAULT = '0x9999999999999999999999999999999999999999';
const KNOWN = { ubi: UBI, engagement: ENGAGEMENT, vault: VAULT };
const G = (n) => BigInt(Math.round(n * 100)) * 10n ** 16n;

const transfer = (from, to, value, blockNumber = 100n, logIndex = 0) => ({
  args: { from, to, value }, blockNumber, logIndex, transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
});
const rows = (transfers) => ledgerRows(transfers, { player: PLAYER, known: KNOWN });

test('each source of G$ is named for what the game uses it for', () => {
  const [spoil, bounty, claim] = rows([ // newest first
    transfer(UBI, PLAYER, G(114.5), 101n),
    transfer(ENGAGEMENT, PLAYER, G(2400), 102n),
    transfer(VAULT, PLAYER, G(1100), 103n),
  ]);
  assert.deepEqual({ direction: claim.direction, label: claim.label, amountG: claim.amountG }, { direction: 'in', label: 'Daily UBI claim', amountG: '114.5' });
  assert.deepEqual({ label: bounty.label, amountG: bounty.amountG }, { label: 'First-boss bounty (Engagement Rewards)', amountG: '2,400' });
  assert.deepEqual({ label: spoil.label, amountG: spoil.amountG }, { label: 'Spoils redeemed (MoonshardVault)', amountG: '1,100' });
});

test('a source the game does not know is shown by its address, not guessed at', () => {
  const [row] = rows([transfer('0x2222222222222222222222222222222222222222', PLAYER, G(5))]);
  assert.equal(row.label, `From ${shortAddress('0x2222222222222222222222222222222222222222')}`);
  assert.equal(row.direction, 'in');
});

test('G$ paid into the prize vault is a Moon Shop purchase, named by the item its transaction carries', () => {
  const [named, unnamed] = rows([
    { ...transfer(PLAYER, VAULT, G(80), 101n), item: null },
    { ...transfer(PLAYER, VAULT, G(20), 102n), item: 'Rusted Shortsword' },
  ]);
  assert.deepEqual({ direction: named.direction, label: named.label, amountG: named.amountG }, { direction: 'out', label: 'Moon Shop: Rusted Shortsword (into the prize vault)', amountG: '20' });
  assert.equal(unnamed.label, 'Paid into the prize vault (Moon Shop)');
});

test('G$ sent somewhere the game does not know is listed as going out, by address', () => {
  const [row] = rows([transfer(PLAYER, '0x3333333333333333333333333333333333333333', G(10))]);
  assert.deepEqual({ direction: row.direction, amountG: row.amountG }, { direction: 'out', amountG: '10' });
  assert.match(row.label, /^Sent to 0x3333…3333$/);
});

test('addresses are matched whatever their letter case', () => {
  const [row] = rows([transfer(UBI.toLowerCase(), PLAYER.toUpperCase().replace('0X', '0x'), G(1))]);
  assert.equal(row.label, 'Daily UBI claim');
  assert.equal(row.direction, 'in');
});

test('newest first: by block, then by position inside the block', () => {
  const list = rows([
    transfer(UBI, PLAYER, G(1), 10n, 0),
    transfer(ENGAGEMENT, PLAYER, G(2), 12n, 1),
    transfer(VAULT, PLAYER, G(3), 12n, 5),
    transfer(UBI, PLAYER, G(4), 11n, 0),
  ]);
  assert.deepEqual(list.map((r) => r.amountG), ['3', '2', '4', '1']);
});

test('amounts are whole G$ with at most two decimals', () => {
  assert.equal(formatG(G(2400)), '2,400');
  assert.equal(formatG(G(114.5)), '114.5');
  assert.equal(formatG(G(0.25)), '0.25');
  assert.equal(formatG(0n), '0');
  assert.equal(formatG(10n ** 18n * 1234567n), '1,234,567');
});

test('no transfers, no rows', () => {
  assert.deepEqual(rows([]), []);
});
