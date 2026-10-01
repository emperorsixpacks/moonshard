import { DEV_REWARDS_CONTRACT, EngagementRewardsSDK, REWARDS_CONTRACT } from '@goodsdks/engagement-sdk';
import { GD } from './config.js';
import { runBountyClaim } from './bounty-flow.js';

/** First-boss bounty claim (the flow itself lives in bounty-flow.js so it can be tested without the SDK bundle). */
export function claimBounty({ wallet, api, token, runId, onHash }) {
  // Build the clients first: a wrong chain or a missing wallet should fail before the server attests anything.
  const { walletClient, publicClient } = wallet.clients();
  const contract = GD.env === 'development' ? DEV_REWARDS_CONTRACT : REWARDS_CONTRACT;
  const sdk = new EngagementRewardsSDK(publicClient, walletClient, contract);
  return runBountyClaim({
    sdk,
    onHash,
    attest: () => api('/engagement/attest', { method: 'POST', token, body: { runId } }),
  });
}
