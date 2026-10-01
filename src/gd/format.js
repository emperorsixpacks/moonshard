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
  slow_down: 'Easy. Try again in a few seconds.',
  engagement_not_configured: 'Bounty claims are not enabled on this server yet.',
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

/** Human message for an Error / server code / wallet code. Never exposes stacks or long raw text. */
export function explainError(err) {
  const reason = typeof err === 'string' ? '' : err?.body?.reason || err?.reason || '';
  if (reason && reason !== 'not_claimable') return String(reason).slice(0, 120);
  const code = typeof err === 'string' ? err : err?.message || '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (err?.status === 0) return MESSAGES.timeout;
  return code && code.length < 90 ? code : 'Something went wrong. Please try again.';
}
