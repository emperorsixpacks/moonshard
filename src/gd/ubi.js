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

/** Claims on-chain, then asks the server to confirm the tx (grants today's Citizen's Blessing). */
export async function claimUbi({ claimSDK, api, token }) {
  const receipt = await claimSDK.claim();
  const hash = receipt.transactionHash;
  const confirm = await api('/ubi/confirm', { method: 'POST', token, body: { txHash: hash } });
  return { hash, confirm };
}
