import { entryBlade, gateStep } from '../engine/playGateRules.js';
import { formatG } from '../gd/format.js';

/*
 * What the menu shows, as pure functions of the wallet status and the player's progress (no DOM, no storage), so every
 * state it can be in is testable: the wallet chip at the top, and the one big button that carries the player forward.
 */

/** The story, in order. `n` 0 is the Prologue; the others are the chapters a player unlocks one after another. */
export const CHAPTERS = [
  { n: 0, name: 'The Shattered Moon', desc: 'Origin of the Pale Blight' },
  { n: 1, name: 'Whispering Woods', desc: 'Boss Gorgok, Whispering Waters' },
  { n: 2, name: 'The Hive Canopy', desc: 'Boss Malakor, High Boughs' },
  { n: 3, name: 'The Sunken Ruins', desc: 'Boss Vorgath, Ancient Crypt' },
  { n: 4, name: 'Obsidian Caldera', desc: 'Boss Ignis, Molten Deep' },
  { n: 5, name: 'The Lunar Spire', desc: 'Boss Umbra, Shattered Core' },
];

/**
 * The wallet chip: what it says, whether it looks switched off, whether a verified tick sits beside it, and whether
 * today's free G$ is waiting (a small gold dot). A balance is shown rounded down, so "20" can always pay 20.
 */
export function chipModel(st) {
  if (!st?.connected) return { text: 'Connect', dim: true, verified: false, claimReady: false };
  if (!st.verified) return { text: st.shortAddress || 'Connected', dim: false, verified: false, claimReady: false };
  const balance = st.balance == null ? null : Math.floor(Number(st.balance) * 100) / 100;
  return {
    text: balance == null ? 'G$' : `${formatG(balance, 2)} G$`,
    dim: false,
    verified: true,
    claimReady: Boolean(st.ubi?.canClaim),
  };
}

/** The line under "Play" when the way in is not open yet: where the player stands, in the gate's own steps. */
function gateLine(st) {
  switch (gateStep(st)) {
    case 'connect': return 'Connect a wallet to start';
    case 'checking': return st.verified ? 'Checking your blade…' : 'Checking your verification…';
    case 'unreachable': return "Can't reach the server";
    case 'verify': return st.status === 'expired' ? 'Verify again to play' : 'One quick face scan to go';
    case 'blade': return `Buy your blade (${formatG(entryBlade(st.shop).priceG, 2)} G$) to start`;
    default: return '';
  }
}

/**
 * The big button. A player who has not done the tutorial is sent there first: it needs no wallet. After that it is the
 * story: "Continue" at the furthest chapter they have unlocked, or "Play" the first time. Until the way in is open it
 * says what is missing and opens the gate.
 *   action: 'tutorial' | 'gate' | 'story'
 * @param {object} st wallet status (see GdService.getStatus)
 * @param {{tutorialDone?: boolean, furthest?: number}} progress
 */
export function playModel(st, { tutorialDone = false, furthest = 1 } = {}) {
  if (!tutorialDone) return { title: 'Play', sub: 'Learn the moves. No wallet needed.', action: 'tutorial' };
  const chapter = CHAPTERS[Math.min(5, Math.max(1, furthest))];
  if (gateStep(st) !== 'ready') return { title: 'Play', sub: gateLine(st), action: 'gate' };
  return {
    title: furthest > 1 ? 'Continue' : 'Play',
    sub: `Chapter ${chapter.n}: ${chapter.name}`,
    action: 'story',
  };
}

/** The chapter list: each row says whether it can be opened. `unlocked(n)` answers for chapters 1 to 5. */
export function chapterRows(unlocked) {
  return CHAPTERS.map((c) => {
    const open = c.n <= 1 || Boolean(unlocked(c.n));
    return { ...c, open, note: open ? c.desc : `Finish chapter ${c.n - 1} to unlock` };
  });
}
