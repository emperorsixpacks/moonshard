import { ClaimSDK, IdentitySDK } from '@goodsdks/citizen-sdk';
import { formatUnits } from 'viem';
import { GD } from './config.js';

export async function prepareUbi(wallet) {
  const { publicClient, walletClient } = wallet.clients();
  const identitySDK = await IdentitySDK.init({ publicClient, walletClient, env: GD.env });
  const claimSDK = new ClaimSDK({
    account: walletClient.account.address,
    publicClient,
    walletClient,
    identitySDK,
    rdu: window.location.href,
    env: GD.env,
  });
  return claimSDK;
}

export async function ubiStatus(claimSDK) {
  const ent = await claimSDK.checkEntitlement();
  const canClaim = ent.amount > 0n;
  const nextClaimAt = canClaim ? null : (await claimSDK.nextClaimTime()).getTime();
  return { entitlementG: formatUnits(ent.amount, 18), canClaim, nextClaimAt };
}

/**
 * Claims on-chain. The server confirmation (which grants today's Citizen's Blessing) is done by the caller
 * through the pending-confirmation queue, so a flaky network can never turn a paid claim into an error.
 */
export async function claimUbi({ claimSDK }) {
  const receipt = await claimSDK.claim();
  if (receipt.status && receipt.status !== 'success') throw new Error('tx_failed');
  return { hash: receipt.transactionHash };
}
