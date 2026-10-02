const MESSAGES = {
  no_wallet: 'No wallet found. Open Moonshard in a browser or app with a Celo-compatible wallet.',
  rejected: 'Request cancelled in your wallet.',
  wrong_chain: 'Switch your wallet to the Celo network to continue.',
  no_account: 'Your wallet has no account available.',
  wallet_error: 'Your wallet could not complete that. Check it for a pending prompt, then try again.',
  wallet_mismatch: 'The connected wallet differs from the signed-in one. Switch accounts or reconnect.',
  unauthorized: 'Please connect your wallet first.',
  invalid_session: 'Your session expired. Reconnect your wallet.',
  verification_required: 'Verify you are human first (quick face scan).',
  already_claimed: 'You have already claimed this.',
  not_claimable: 'This reward is not claimable right now.',
  boss_not_cleared: 'Defeat a chapter boss first.',
  run_too_old: 'That boss run is too old. Defeat a boss again.',
  tx_failed: 'The transaction failed. Nothing was paid out.',
  chain_unavailable: 'The Celo network is busy. Try again in a moment.',
  timeout: 'The server is slow right now. Try again.',
  network_error: "Can't reach the server. Check your connection and try again.",
  bad_response: 'The server sent something unexpected. Try again in a moment.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  tx_not_found: "The network hasn't seen that transaction yet. It will be retried automatically.",
  bad_tx: 'That transaction could not be checked.',
  no_claim_event: 'That transaction was not a daily G$ claim.',
  tx_not_today: "That claim was not made today, so it can't earn today's blessing.",
  not_your_tx: 'That transaction was sent from a different wallet.',
  wallet_timeout: "The wallet didn't respond. Check it for a pending prompt, then try again.",
  vault_mismatch: "The prize vault in the server's answer does not match this app's configuration. Do not redeem; tell the team.",
  slow_down: 'Easy. Try again in a few seconds.',
  wallet_busy: 'Your wallet is still waiting for an answer. Approve or reject that request there first.',
  already_submitted: 'Your earlier request is still confirming on the network. Check back in a minute.',
  engagement_not_configured: 'Bounty claims are not enabled on this server yet.',
  not_enough_g: "Not enough G$ in your wallet for that yet. Claim today's free G$ first.",
  already_owned: 'You already own that.',
  requires_item: 'Get the item it builds on first.',
  not_for_sale: 'That is not for sale on this server.',
  shop_closed: 'The Moon Shop is not open on this server.',
  token_mismatch: "The G$ token in the server's answer does not match this app's. Nothing was sent; tell the team.",
  blade_required: 'Get your blade first: it is paid for in G$.',
  not_paid_to_vault: 'That payment did not go to the prize vault.',
  underpaid: 'That payment was less than the price.',
  no_item: 'That payment did not name a Moon Shop item.',
  unknown_item: 'That payment did not name a Moon Shop item.',
};

export function shortAddress(addr) {
  const a = String(addr || '').trim();
  return a.length < 10 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatG(value, maxDecimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
}

export function formatCountdown(ms) {
  if (!(ms > 0)) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Human message for an Error / server code / wallet code. Machine codes, stack traces and SDK internals are never
 * shown: unknown failures get a generic line (viem's `shortMessage` is a human summary, so it is allowed).
 */
export function explainError(err) {
  // contract revert reasons from the server are sentences ("Claim cooldown not reached"); codes have no spaces
  const reason = typeof err === 'string' ? '' : err?.body?.reason || err?.reason || '';
  if (reason && /\s/.test(String(reason))) return String(reason).slice(0, 120);
  const code = typeof err === 'string' ? err : err?.message || '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (err?.status === 0) return MESSAGES.network_error;
  const short = typeof err?.shortMessage === 'string' ? err.shortMessage.trim() : '';
  if (short) return short.slice(0, 140);
  return 'Something went wrong. Please try again.';
}
