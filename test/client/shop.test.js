import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, hexToString } from 'viem';
import { buyItem, itemTag, readGBalance } from '../../src/gd/shop.js';
import { GD } from '../../src/gd/config.js';
import { itemOf } from '../../server/src/shop.js';

/*
 * A Moon Shop purchase on the wallet's side: a G$ transfer() of the item's price to the prize vault, with the item named
 * after the transfer's arguments ("moonshard:<id>"), which the token ignores and the server reads back.
 */

const VAULT = '0x00000000000000000000000000000000000ba5e1';
const PLAYER = '0xabcdef0123456789abcdef0123456789abcdef01';
const HASH = `0x${'5a'.repeat(32)}`;
const ITEM = { id: 'iron_starter', name: 'Rusted Shortsword', kind: 'blade', priceG: '20', requires: null };

function fakeWallet({ receipt = { status: 'success' }, simulateError } = {}) {
  const seen = { simulated: null, written: null };
  const walletClient = {
    account: PLAYER,
    async writeContract(request) { seen.written = request; return HASH; },
  };
  const publicClient = {
    async simulateContract(args) {
      seen.simulated = args;
      if (simulateError) throw simulateError;
      return { request: { ...args, account: args.account } };
    },
    async waitForTransactionReceipt({ hash }) { assert.equal(hash, HASH); return receipt; },
    async readContract(args) { seen.read = args; return 123n * 10n ** 18n; },
  };
  return { seen, wallet: { clients: () => ({ walletClient, publicClient }) } };
}

test('the tag is the text "moonshard:<item>", and the server reads the item back from a transfer that carries it', () => {
  assert.equal(hexToString(itemTag('iron_starter')), 'moonshard:iron_starter');
  const call = encodeFunctionData({
    abi: [{ type: 'function', name: 'transfer', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
    functionName: 'transfer',
    args: [VAULT, 20n * 10n ** 18n],
  });
  assert.equal(itemOf(call + itemTag('skin_frost').slice(2)), 'skin_frost');
  assert.equal(itemOf(call), null, 'a plain transfer names nothing');
});

test('buying pays the price in G$ to the vault, on the G$ token, with the item named, and reports the hash at once', async () => {
  const { seen, wallet } = fakeWallet();
  const hashes = [];
  const out = await buyItem({ wallet, vault: VAULT, item: ITEM, onHash: (h) => hashes.push(h) });
  assert.deepEqual(out, { hash: HASH });
  assert.deepEqual(hashes, [HASH]);
  const s = seen.simulated;
  assert.equal(s.address, GD.token);
  assert.equal(s.functionName, 'transfer');
  assert.deepEqual(s.args, [VAULT, 20n * 10n ** 18n]);
  assert.equal(s.account, PLAYER);
  assert.equal(hexToString(s.dataSuffix), 'moonshard:iron_starter');
  assert.equal(seen.written.dataSuffix, s.dataSuffix, 'the transaction sent is the one simulated, tag included');
});

test('a price with decimals is paid exactly', async () => {
  const { seen, wallet } = fakeWallet();
  await buyItem({ wallet, vault: VAULT, item: { ...ITEM, priceG: '12.5' } });
  assert.deepEqual(seen.simulated.args, [VAULT, 12_500_000_000_000_000_000n]);
});

test('a payment the chain reverts is a failure; one whose receipt never came is reported unconfirmed, not failed', async () => {
  const reverted = fakeWallet({ receipt: { status: 'reverted' } });
  await assert.rejects(buyItem({ wallet: reverted.wallet, vault: VAULT, item: ITEM }), /tx_failed/);

  const lost = fakeWallet();
  lost.wallet.clients().publicClient.waitForTransactionReceipt = async () => { throw new Error('timeout'); };
  const out = await buyItem({ wallet: lost.wallet, vault: VAULT, item: ITEM });
  assert.deepEqual(out, { hash: HASH, unconfirmed: true });
});

test('nothing is sent when the simulation already shows the transfer would fail (not enough G$)', async () => {
  const { seen, wallet } = fakeWallet({ simulateError: new Error('transfer amount exceeds balance') });
  await assert.rejects(buyItem({ wallet, vault: VAULT, item: ITEM }), /exceeds balance/);
  assert.equal(seen.written, null);
});

test('the G$ balance is read from the token for the given address', async () => {
  const { seen, wallet } = fakeWallet();
  const { publicClient } = wallet.clients();
  assert.equal(await readGBalance({ publicClient, address: PLAYER }), 123n * 10n ** 18n);
  assert.equal(seen.read.address, GD.token);
  assert.equal(seen.read.functionName, 'balanceOf');
  assert.deepEqual(seen.read.args, [PLAYER]);
});
