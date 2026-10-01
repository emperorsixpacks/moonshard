/**
 * Time the player actually spent playing, as opposed to time on the wall clock.
 *
 * The Survival score pays 10 points per second survived, and the daily prizes go to the top scores, so the clock
 * behind that bonus must not run while the game is paused (the scene keeps updating behind the pause screen: pausing
 * only stops physics) or while the tab is hidden. It is advanced by the frame delta the engine hands to `update()`,
 * and a single frame can add at most `maxStepMs`, so a stalled tab or a long GC pause cannot add a big jump either.
 */
export class ActiveClock {
  constructor({ maxStepMs = 250 } = {}) {
    this.maxStepMs = maxStepMs;
    this.ms = 0;
  }

  /** Credit one frame of `deltaMs` unless the game is paused or the page hidden. Returns the milliseconds credited. */
  tick(deltaMs, { paused = false, hidden = false } = {}) {
    if (paused || hidden) return 0;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
    const step = Math.min(deltaMs, this.maxStepMs);
    this.ms += step;
    return step;
  }

  /** Whole seconds played. */
  get seconds() {
    return Math.floor(this.ms / 1000);
  }
}

/** True while the browser tab is not visible. Without a document (Node) nothing is hidden. */
export function pageHidden() {
  return typeof document !== 'undefined' && document.hidden === true;
}
