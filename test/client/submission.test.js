import test from 'node:test';
import assert from 'node:assert/strict';
import { submitTracked } from '../../src/gd/tx.js';
import { redeemSpoil } from '../../src/gd/spoils.js';
import { claimUbi } from '../../src/gd/ubi-claim.js';
import { runBountyClaim } from '../../src/gd/bounty-flow.js';

/*
 * Once a transaction has been sent the player may already be paid. If the wait for its receipt then fails (a mobile
 * network blip, viem's 180 s limit), the hash must survive and the action must be reported as "submitted", never as
 * a failure that invites a second tap.
 */

const H = `0x${'ab'.repeat(32)}`;
const APP = '0x00000000000000000000000000000000000a11ce';

/* ---- submitTracked ---- */

test('a clean success returns the hash and reports it exactly once', async () => {
  const seen = [];
  const out = await submitTracked(async (onHash) => {
    onHash(H);
    return { status: 'success', transactionHash: H };
  }, (h) => seen.push(h));
  assert.deepEqual(out, { hash: H });
  assert.deepEqual(seen, [H]);
});

test('the receipt wait failing after the hash exists is "unconfirmed", not an error', async () => {
  const seen = [];
  const out = await submitTracked(async (onHash) => {
    onHash(H);
    throw new Error('The request took too long to respond.');
  }, (h) => seen.push(h));
  assert.deepEqual(out, { hash: H, unconfirmed: true });
  assert.deepEqual(seen, [H]);
});

test('a failure before any hash exists is rethrown unchanged (nothing was sent)', async () => {
  const boom = Object.assign(new Error('User rejected the request.'), { code: 4001 });
  await assert.rejects(submitTracked(async () => { throw boom; }), (err) => err === boom);
});

test('a reverted receipt is a failure even though a hash exists', async () => {
  await assert.rejects(
    submitTracked(async (onHash) => {
      onHash(H);
      return { status: 'reverted', transactionHash: H };
    }),
    (err) => err.message === 'tx_failed' && err.hash === H,
  );
});

test('the receipt hash is used when the sender never reported one', async () => {
  assert.deepEqual(await submitTracked(async () => ({ status: 'success', transactionHash: H })), { hash: H });
});

test('a listener that throws cannot turn a sent transaction into a failure', async () => {
  const out = await submitTracked(async (onHash) => {
    onHash(H);
    return { status: 'success', transactionHash: H };
  }, () => { throw new Error('storage full'); });
  assert.deepEqual(out, { hash: H });
});

/* ---- Spoils redemption ---- */

function fakeVaultWallet({ wait, log }) {
  return {
    clients: () => ({
      walletClient: {
        account: { address: '0xabc' },
        writeContract: async () => { log.push('write'); return H; },
      },
      publicClient: {
        simulateContract: async () => ({ request: { simulated: true } }),
        waitForTransactionReceipt: async () => { log.push('wait'); return wait(); },
      },
    }),
  };
}

const voucher = { to: APP, id: '7', amount: '1000', deadline: '9999999999', signature: '0x00' };

test('redeemSpoil: the hash is reported before the receipt wait, and a failed wait is "unconfirmed"', async () => {
  const log = [];
  const out = await redeemSpoil({
    wallet: fakeVaultWallet({ log, wait: async () => { throw new Error('network down'); } }),
    vault: APP,
    voucher,
    onHash: (h) => log.push(`hash:${h.slice(0, 6)}`),
  });
  assert.deepEqual(out, { hash: H, unconfirmed: true });
  assert.deepEqual(log, ['write', 'hash:0xabab', 'wait']);
});

test('redeemSpoil: a mined success returns the hash', async () => {
  const out = await redeemSpoil({
    wallet: fakeVaultWallet({ log: [], wait: async () => ({ status: 'success', transactionHash: H }) }),
    vault: APP,
    voucher,
  });
  assert.deepEqual(out, { hash: H });
});

test('redeemSpoil: a reverted redemption is a failure', async () => {
  await assert.rejects(
    redeemSpoil({ wallet: fakeVaultWallet({ log: [], wait: async () => ({ status: 'reverted' }) }), vault: APP, voucher }),
    /tx_failed/,
  );
});

test('redeemSpoil: a simulation failure (nothing sent) is an error with no hash', async () => {
  const wallet = {
    clients: () => ({
      walletClient: { account: { address: '0xabc' }, writeContract: async () => { throw new Error('must not send'); } },
      publicClient: { simulateContract: async () => { throw new Error('VoucherExpired'); } },
    }),
  };
  await assert.rejects(redeemSpoil({ wallet, vault: APP, voucher }), /VoucherExpired/);
});

/* ---- UBI claim ---- */

/** Same shape as the real ClaimSDK: claim() calls this.submitAndWait(params) WITHOUT an onHash callback. */
function fakeClaimSDK({ wait, beforeSubmit = async () => {} }) {
  const log = [];
  const sdk = {
    log,
    async submitAndWait(_params, onHash) {
      log.push('write');
      onHash?.(H);
      log.push('wait');
      return wait();
    },
    async claim() {
      await beforeSubmit();
      return this.submitAndWait({ functionName: 'claim' });
    },
  };
  return sdk;
}

test('claimUbi: a mined claim returns its hash', async () => {
  const sdk = fakeClaimSDK({ wait: async () => ({ status: 'success', transactionHash: H }) });
  assert.deepEqual(await claimUbi({ claimSDK: sdk }), { hash: H });
});

test('claimUbi: the SDK never exposes the hash, so it is captured, reported before the wait, and survives a failed wait', async () => {
  const sdk = fakeClaimSDK({ wait: async () => { throw new Error('Claim failed: timed out'); } });
  const seen = [];
  const out = await claimUbi({ claimSDK: sdk, onHash: (h) => seen.push([h, [...sdk.log]]) });
  assert.deepEqual(out, { hash: H, unconfirmed: true });
  assert.deepEqual(seen, [[H, ['write']]], 'the listener ran after the send and before the wait');
});

test('claimUbi: an error before the send (e.g. no UBI to claim) is rethrown and no hash is invented', async () => {
  const sdk = fakeClaimSDK({
    wait: async () => { throw new Error('unreachable'); },
    beforeSubmit: async () => { throw new Error('No UBI available to claim for this period.'); },
  });
  await assert.rejects(claimUbi({ claimSDK: sdk }), /No UBI available/);
});

test('claimUbi: a reverted claim is a failure', async () => {
  const sdk = fakeClaimSDK({ wait: async () => ({ status: 'reverted', transactionHash: H }) });
  await assert.rejects(claimUbi({ claimSDK: sdk }), /tx_failed/);
});

test('claimUbi leaves the SDK exactly as it found it', async () => {
  const sdk = fakeClaimSDK({ wait: async () => ({ status: 'success', transactionHash: H }) });
  const original = sdk.submitAndWait;
  await claimUbi({ claimSDK: sdk });
  assert.equal(sdk.submitAndWait, original);

  class Proto { async submitAndWait(_p, onHash) { onHash?.(H); return { status: 'success', transactionHash: H }; } async claim() { return this.submitAndWait({}); } }
  const inherited = new Proto();
  await claimUbi({ claimSDK: inherited });
  assert.equal(Object.hasOwn(inherited, 'submitAndWait'), false, 'the prototype method is visible again');
});

/* ---- Engagement bounty ---- */

const attestation = { app: APP, inviter: '0x0000000000000000000000000000000000000000', validUntilBlock: '123', appSignature: '0xappsig' };
const attest = async () => attestation;

test('runBountyClaim: signs, submits and returns the hash', async () => {
  const sdk = {
    signClaim: async () => '0xusersig',
    nonContractAppClaim: async (app, inviter, block, userSig, appSig, onHash) => {
      assert.equal(block, 123n);
      assert.equal(userSig, '0xusersig');
      assert.equal(appSig, '0xappsig');
      onHash(H);
      return { status: 'success', transactionHash: H };
    },
  };
  assert.deepEqual(await runBountyClaim({ sdk, attest }), { hash: H });
});

test('runBountyClaim: the SDK rejecting after the hash was reported means "submitted"', async () => {
  const sdk = {
    signClaim: async () => '0xusersig',
    nonContractAppClaim: async (...args) => {
      args.at(-1)(H);
      throw new Error('Transaction receipt polling timed out');
    },
  };
  const seen = [];
  assert.deepEqual(await runBountyClaim({ sdk, attest, onHash: (h) => seen.push(h) }), { hash: H, unconfirmed: true });
  assert.deepEqual(seen, [H]);
});

test('runBountyClaim: a rejected signature sends nothing and has no hash', async () => {
  let sent = false;
  const sdk = {
    signClaim: async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); },
    nonContractAppClaim: async () => { sent = true; },
  };
  await assert.rejects(runBountyClaim({ sdk, attest }), (err) => err.code === 4001);
  assert.equal(sent, false);
});

test('runBountyClaim: a reverted claim is a failure', async () => {
  const sdk = {
    signClaim: async () => '0xusersig',
    nonContractAppClaim: async (...args) => {
      args.at(-1)(H);
      return { status: 'reverted', transactionHash: H };
    },
  };
  await assert.rejects(runBountyClaim({ sdk, attest }), /tx_failed/);
});
