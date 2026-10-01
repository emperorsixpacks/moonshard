import { DEV_REWARDS_CONTRACT, EngagementRewardsSDK, REWARDS_CONTRACT } from '@goodsdks/engagement-sdk';
import { GD } from './config.js';

/**
 * First-boss bounty: server attests the cleared boss run, the player signs the app registration
 * message and submits `nonContractAppClaim` (the third argument is `validUntilBlock`).
 */
export async function claimBounty({ wallet, api, token, runId }) {
  const att = await api('/engagement/attest', { method: 'POST', token, body: { runId } });
  const { walletClient, publicClient } = wallet.clients();
  const contract = GD.env === 'development' ? DEV_REWARDS_CONTRACT : REWARDS_CONTRACT;
  const sdk = new EngagementRewardsSDK(publicClient, walletClient, contract);
  const validUntilBlock = BigInt(att.validUntilBlock);
  const userSignature = await sdk.signClaim(att.app, att.inviter, validUntilBlock);
  let hash;
  const receipt = await sdk.nonContractAppClaim(att.app, att.inviter, validUntilBlock, userSignature, att.appSignature, (h) => { hash = h; });
  hash = hash ?? receipt.transactionHash;
  if (receipt.status !== 'success') throw new Error('tx_failed');
  await api('/engagement/confirm', { method: 'POST', token, body: { txHash: hash } }).catch(() => {});
  return { hash };
}
