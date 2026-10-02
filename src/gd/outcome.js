import { explorerTx } from './config.js';
import { explainError } from './format.js';

/**
 * What the player is told after an action: exactly what happened, and no more. A paid action can end five ways
 * (recorded / still being recorded / refused for good / the session died first / sent but not yet seen on the
 * network), and each needs different words. Returns `{ text, type }` for a toast, or null when nothing should be said.
 */

const DONE = { ubi: '💚 G$ claimed', bounty: '🌟 Bounty claimed', redeem: '🏆 Spoils redeemed', buy: '🗡 Paid' };
const SENT = { ubi: '💚 Claim sent', bounty: '🌟 Bounty claim sent', redeem: '🏆 Redemption sent', buy: '🗡 Payment sent' };
const GENERIC = 'Something went wrong. Please try again.';

const link = (hash) => (hash ? `  ${explorerTx(hash).replace('https://', '')}` : '');

function paid(act, res, blessing) {
  const lead = DONE[act];
  const tx = link(res.hash);

  if (res.reconnectNeeded) return { text: `${lead} on-chain. Reconnect your wallet to finish recording it.${tx}`, type: 'warn' };

  if (res.confirmed) {
    let text = `${lead}!`;
    if (act === 'ubi') text = blessing ? "💚 G$ claimed — Citizen's Blessing active!" : '💚 G$ claimed!';
    if (act === 'buy') text = `🗡 ${res.item || 'It'} is yours!`;
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
    let text = `${lead}! The server will record it shortly (retrying automatically).`;
    if (act === 'ubi') text = `${lead}! Your blessing applies as soon as the server confirms (retrying automatically).`;
    if (act === 'buy') text = `${lead}! ${res.item || 'Your item'} unlocks as soon as the server confirms (retrying automatically).`;
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
    case 'buy':
      return paid(act, res, blessing);
    default:
      return null;
  }
}
