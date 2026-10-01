import { submitTracked } from './tx.js';

/**
 * First-boss bounty: the server attests the cleared boss run (`attest()`), the player signs the app registration
 * message and submits `nonContractAppClaim` (the third argument is `validUntilBlock`).
 * Resolves `{ hash }`, or `{ hash, unconfirmed: true }` if only the receipt wait failed after the send.
 */
export async function runBountyClaim({ sdk, attest, onHash }) {
  const att = await attest();
  const validUntilBlock = BigInt(att.validUntilBlock);
  const userSignature = await sdk.signClaim(att.app, att.inviter, validUntilBlock);
  return submitTracked(
    (sent) => sdk.nonContractAppClaim(att.app, att.inviter, validUntilBlock, userSignature, att.appSignature, sent),
    onHash,
  );
}
