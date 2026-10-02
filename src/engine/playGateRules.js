/**
 * The way into the game, as pure rules. Owner decisions: a player must be a verified human (GoodDollar face verification,
 * one human per slot) BEFORE they can start playing, and the blade their hero fights with is paid for in G$ (the Moon
 * Shop, server/src/shop.js). Everything here is a function of the wallet service's status, so it can be tested without a
 * browser.
 */

/** Every scene that starts play. The menu, the forge, the leaderboard and the ending are not play. */
export const GATED_SCENES = new Set(['StoryScene', 'StoryIntroScene', 'TutorialScene', 'SurvivalScene']);

const LABELS = {
  StoryScene: 'STORY MODE',
  StoryIntroScene: 'STORY MODE',
  TutorialScene: 'THE TUTORIAL',
  SurvivalScene: 'ENDLESS MODE',
};

export const gateLabel = (sceneKey) => LABELS[sceneKey] ?? 'THE GAME';

/** The blade a server's shop sells as the way in (null when it sells none). */
export const entryBlade = (shop) => shop?.items?.find((item) => item.kind === 'blade') ?? null;

/**
 * Where the player stands on the way in:
 *   connect      not signed in with a wallet
 *   checking     signed in, the server has not said yet whether they are verified, or (verified) whether they have a blade
 *   unreachable  signed in, but the server cannot be reached to say
 *   verify       signed in, not a verified human (never verified, or the verification expired)
 *   blade        a verified human without a blade: it is bought with G$
 *   ready        a verified human with a blade (on a server with no shop, or a shop that sells no blade, it is free)
 */
export function gateStep(status) {
  if (!status?.connected) return 'connect';
  if (!status.verified) {
    if (status.status === 'unknown') return status.offline ? 'unreachable' : 'checking';
    return 'verify';
  }
  const { shop, owned } = status;
  if (shop && (!shop.enabled || !entryBlade(shop))) return 'ready';
  if (!shop || !Array.isArray(owned)) return status.offline ? 'unreachable' : 'checking';
  return shop.items.some((item) => item.kind === 'blade' && owned.includes(item.id)) ? 'ready' : 'blade';
}

export const canPlay = (status) => gateStep(status) === 'ready';

/** Back from the face scan: offer the mode the player asked for again once they are verified (to play, or to buy the blade). */
export const resumesAfterScan = (status) => ['ready', 'blade'].includes(gateStep(status));

/** `bypass` is for development tooling only (see playGate.js). */
export const blocksStart = (sceneKey, status, { bypass = false } = {}) =>
  GATED_SCENES.has(sceneKey) && !bypass && !canPlay(status);
