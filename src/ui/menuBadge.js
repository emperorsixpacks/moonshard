import { entryBlade, gateStep } from '../engine/playGateRules.js';

/**
 * The line under the title on the menu: where the player stands on the way into the game, using the same steps as the
 * verified-human gate. Tapping it opens the wallet panel. Plain text, kept short enough for the title banner.
 */
export function menuBadgeText(st) {
  switch (gateStep(st)) {
    case 'connect':
      return '🔒 CONNECT & VERIFY TO PLAY';
    case 'checking':
      return st.verified ? '⏳ CHECKING YOUR BLADE…' : '⏳ CHECKING YOUR VERIFICATION…';
    case 'unreachable':
      return '⚠ SERVER UNREACHABLE • TAP FOR WALLET';
    case 'verify':
      return st.status === 'expired' ? '🛡 RE-VERIFY YOU ARE HUMAN TO PLAY' : '🛡 VERIFY YOU ARE HUMAN TO PLAY';
    case 'blade':
      return `🗡 BUY YOUR BLADE (${entryBlade(st.shop).priceG} G$) TO PLAY`;
    default:
      return st.ubi?.canClaim ? '💚 DAILY G$ READY — TAP TO CLAIM' : `✔ VERIFIED • ${st.shortAddress}`;
  }
}
