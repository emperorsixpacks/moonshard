/**
 * Runs `send(sent)`, which submits ONE transaction and waits for its receipt, and keeps a transaction that was
 * already sent from being reported as a failure just because the wait went wrong.
 *
 *  - `sent(hash)` is the callback for the moment the wallet has sent the transaction (before the wait). It calls
 *    `onHash`, so the caller can persist the hash straight away.
 *  - If `send` then rejects (a network blip while polling, viem's 180 s limit) the player may well have been paid:
 *    the hash comes back as `{ hash, unconfirmed: true }` and the caller keeps confirming it in the background.
 *  - A rejection before any hash exists means nothing was sent, so it is rethrown unchanged.
 *  - A receipt that says "reverted" is a real failure (`tx_failed`).
 */
export async function submitTracked(send, onHash) {
  let hash = null;
  const sent = (h) => {
    hash = h;
    try {
      onHash?.(h);
    } catch { /* a listener must never be able to fail a transaction that was sent */ }
  };

  let receipt;
  try {
    receipt = await send(sent);
  } catch (err) {
    if (hash) return { hash, unconfirmed: true };
    throw err;
  }

  if (!hash && receipt?.transactionHash) sent(receipt.transactionHash);
  if (receipt?.status && receipt.status !== 'success') throw Object.assign(new Error('tx_failed'), { hash });
  return { hash };
}
