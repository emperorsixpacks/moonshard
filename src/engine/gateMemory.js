import { GATED_SCENES } from './playGateRules.js';

/**
 * The face scan takes the player to GoodDollar's site and back, which reloads the page. What they asked to play is
 * kept in session storage across that trip so they land on a single "PLAY" tap instead of hunting for the mode again.
 */

const KEY = 'moonshard.gate.v1';
const MAX_AGE_MS = 30 * 60 * 1000;

export function rememberGate(storage, { key, data } = {}, { now = Date.now() } = {}) {
  try {
    storage.setItem(KEY, JSON.stringify({ key, data: data ?? null, at: now }));
  } catch { /* blocked storage: the player just taps the mode again */ }
}

/** Returns `{ key, data }` once, or null. Only play scenes and recent requests are honoured. */
export function takeGate(storage, { now = Date.now() } = {}) {
  try {
    const raw = storage?.getItem(KEY);
    storage?.removeItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!GATED_SCENES.has(saved?.key) || !(now - saved.at <= MAX_AGE_MS)) return null;
    return { key: saved.key, data: saved.data ?? undefined };
  } catch {
    return null;
  }
}
