import { formatUnits } from 'viem';
import { submitTracked } from './tx.js';

export async function ubiStatus(claimSDK) {
  const ent = await claimSDK.checkEntitlement();
  const canClaim = ent.amount > 0n;
  const nextClaimAt = canClaim ? null : (await claimSDK.nextClaimTime()).getTime();
  return { entitlementG: formatUnits(ent.amount, 18), canClaim, nextClaimAt };
}

/**
 * Claims on-chain. The server confirmation (which grants today's Citizen's Blessing) is done by the caller
 * through the pending-confirmation queue, so a flaky network can never turn a paid claim into an error.
 *
 * `ClaimSDK.claim()` sends its transaction through `submitAndWait(params, onHash)` but never passes an `onHash`,
 * so the hash is never exposed. For the duration of the call `submitAndWait` is wrapped to supply one; the SDK
 * object is left exactly as it was found.
 */
export function claimUbi({ claimSDK, onHash }) {
  return submitTracked(async (sent) => {
    const own = Object.getOwnPropertyDescriptor(claimSDK, 'submitAndWait');
    const submit = claimSDK.submitAndWait;
    claimSDK.submitAndWait = (params, callback) =>
      submit.call(claimSDK, params, (hash) => {
        sent(hash);
        callback?.(hash);
      });
    try {
      return await claimSDK.claim();
    } finally {
      if (own) Object.defineProperty(claimSDK, 'submitAndWait', own);
      else delete claimSDK.submitAndWait;
    }
  }, onHash);
}
