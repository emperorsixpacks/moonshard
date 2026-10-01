import { IdentitySDK } from '@goodsdks/citizen-sdk';
import { GD } from './config.js';

/** Face-verification URL; the player returns to this page with ?gdfv=1 and we re-check identity. */
export async function faceVerificationLink(wallet) {
  const { publicClient, walletClient } = wallet.clients();
  const identitySDK = await IdentitySDK.init({ publicClient, walletClient, env: GD.env });
  const callback = `${window.location.origin}${window.location.pathname}?gdfv=1`;
  return identitySDK.generateFVLink(false, callback, GD.chainId);
}
