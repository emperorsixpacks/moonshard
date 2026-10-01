/**
 * The verified-human gate, as pure rules. Owner decision: a player must be a verified human (GoodDollar face
 * verification, one human per slot) BEFORE they can start playing. Everything here is a function of the wallet
 * service's status, so it can be tested without a browser.
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

/**
 * Where the player stands on the way in:
 *   connect      not signed in with a wallet
 *   checking     signed in, the server has not said yet whether they are verified
 *   unreachable  signed in, but the server cannot be reached to say
 *   verify       signed in, not a verified human (never verified, or the verification expired)
 *   ready        a verified human
 */
export function gateStep(status) {
  if (!status?.connected) return 'connect';
  if (status.verified) return 'ready';
  if (status.status === 'unknown') return status.offline ? 'unreachable' : 'checking';
  return 'verify';
}

export const canPlay = (status) => gateStep(status) === 'ready';

/** `bypass` is for development tooling only (see playGate.js). */
export const blocksStart = (sceneKey, status, { bypass = false } = {}) =>
  GATED_SCENES.has(sceneKey) && !bypass && !canPlay(status);
