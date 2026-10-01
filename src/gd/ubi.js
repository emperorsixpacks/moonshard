import { ClaimSDK, IdentitySDK } from '@goodsdks/citizen-sdk';
import { GD } from './config.js';

// The claim and status logic is SDK-free (and unit-tested) in ubi-claim.js.
export { claimUbi, ubiStatus } from './ubi-claim.js';

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
