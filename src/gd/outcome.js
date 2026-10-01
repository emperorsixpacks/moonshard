import { explorerTx } from './config.js';
import { explainError } from './format.js';

/**
 * What the player is told after an action: exactly what happened, and no more. A paid action can end five ways
 * (recorded / still being recorded / refused for good / the session died first / sent but not yet seen on the
 * network), and each needs different words. Returns `{ text, type }` for a toast, or null when nothing should be said.
 */

const DONE = { ubi: '💚 G$ claimed', bounty: '🌟 Bounty claimed', redeem: '🏆 Spoils redeemed' };
const SENT = { ubi: '💚 Claim sent', bounty: '🌟 Bounty claim sent', redeem: '🏆 Redemption sent' };
const GENERIC = 'Something went wrong. Please try again.';

const link = (hash) => (hash ? `  ${explorerTx(hash).replace('https://', '')}` : '');

function paid(act, res, blessing) {
  const lead = DONE[act];
  const tx = link(res.hash);

  if (res.reconnectNeeded) return { text: `${lead} on-chain. Reconnect your wallet to finish recording it.${tx}`, type: 'warn' };

  if (res.confirmed) {
    const text = act === 'ubi' ? (blessing ? "💚 G$ claimed — Citizen's Blessing active!" : '💚 G$ claimed!') : `${lead}!`;
    return { text: `${text}${tx}`, type: 'info' };
  }

  if (res.confirmRejected) {
    const why = explainError(res.confirmRejected);
    return { text: `${lead} on-chain, but the server could not record it. ${why}${tx}`, type: 'warn' };
  }

  if (res.submitted) {
    return { text: `${SENT[act]} — waiting for the network to confirm (this can take a minute).${tx}`, type: 'info' };
  }

  if (res.confirmPending) {
    const text = act === 'ubi'
      ? `${lead}! Your blessing applies as soon as the server confirms (retrying automatically).`
      : `${lead}! The server will record it shortly (retrying automatically).`;
    return { text: `${text}${tx}`, type: 'info' };
  }

  return { text: `${lead}!${tx}`, type: 'info' };
}

export function describeOutcome(act, res, { blessing = false } = {}) {
  if (!res?.ok) return { text: res?.message || GENERIC, type: 'error' };
  switch (act) {
    case 'connect': return { text: '⚡ Wallet connected', type: 'info' };
    case 'reconnect': return { text: '⚡ Wallet reconnected', type: 'info' };
    case 'recheck':
      return res.verified
        ? { text: "✔ Verified — you're all set!", type: 'info' }
        : { text: 'Not verified yet. Finish the face scan, then check again.', type: 'warn' };
    case 'ubi':
    case 'bounty':
    case 'redeem':
      return paid(act, res, blessing);
    default:
      return null;
  }
}
