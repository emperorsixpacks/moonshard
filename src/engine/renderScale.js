/**
 * How many times larger than the game's own coordinate space (480 x 270, or 480 x 440 in portrait) the drawing
 * buffer is rendered. The game keeps working in its small coordinates; only the number of screen pixels each one
 * covers changes, so text and art stay sharp instead of being stretched from a tiny picture.
 */

export const MAX_RENDER_SCALE = 8;

/** Device pixels the buffer may hold. Phones get less: a larger buffer costs fill-rate on every frame. */
export const pixelBudget = (coarsePointer) => (coarsePointer ? 3_200_000 : 9_000_000);

/**
 * Smallest whole multiplier that gives the buffer at least one pixel per device pixel (so the browser only ever
 * scales the picture DOWN, which stays sharp), reduced until the buffer fits the pixel budget.
 */
export function chooseRenderScale({ cssWidth, dpr = 1, baseWidth, baseHeight, budgetPixels }) {
  if (!(cssWidth > 0) || !(baseWidth > 0) || !(baseHeight > 0)) return 1;
  const density = dpr > 0 ? dpr : 1;
  let scale = Math.ceil((cssWidth * density) / baseWidth - 1e-9);
  scale = Math.max(1, Math.min(MAX_RENDER_SCALE, scale));
  while (scale > 1 && baseWidth * scale * baseHeight * scale > budgetPixels) scale--;
  return scale;
}

/**
 * The safety net for a device that cannot keep up with the larger buffer. Called every couple of seconds with the
 * measured frame rate while the tab is visible: after `strikesNeeded` slow samples in a row the buffer steps down one
 * notch. A healthy sample clears the count; a missing or nonsensical measurement counts for nothing either way.
 */
export function adaptRenderScale({ fps, scale, strikes }, { minFps = 40, strikesNeeded = 4, floor = 1 } = {}) {
  if (!(fps > 0)) return { scale, strikes, changed: false };
  if (fps >= minFps) return { scale, strikes: 0, changed: false };
  if (scale <= floor) return { scale, strikes: 0, changed: false };
  const next = strikes + 1;
  if (next < strikesNeeded) return { scale, strikes: next, changed: false };
  return { scale: scale - 1, strikes: 0, changed: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Keeping a smaller size only if it helped, and only for a while
// ---------------------------------------------------------------------------------------------------------------------

/** How many samples (two seconds apart) at the new size are judged before it is kept or given up. */
const PROBATION_SAMPLES = 3;
/** A smaller size has to be this much faster to count as having helped (or reach a healthy rate). */
const REQUIRED_GAIN = 1.25;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Decides, from frame-rate samples taken every couple of seconds while the tab is visible, when the drawing buffer should
 * step down and whether the step was worth keeping. Stepping down used to be one-way and permanent; but a frame rate that
 * is low because the browser caps it (Energy Saver, Low Power Mode) or because of a one-off stall is not cured by a smaller
 * picture, and the player was left with a blurry game for good. Now a step down is on probation: after a few samples at the
 * new size it is kept (and saved) only if the frame rate clearly improved. If not, the size goes back, nothing is saved, and
 * the governor leaves the size alone for the rest of the session.
 *
 * `sample({ fps, scale })` returns null (nothing to do) or an action:
 *   { scale }               change the buffer to this multiplier (not saved yet)
 *   { save }                the smaller size helped: remember it
 *   { scale, forget: true } it did not help: go back to this multiplier and forget any remembered size
 */
export function createScaleGovernor({ minFps = 40 } = {}) {
  let strikes = 0;
  let probation = null; // { from, fpsBefore, seen }
  let locked = false;
  return {
    /** A hidden tab says nothing about the device: start counting again. */
    reset() {
      strikes = 0;
      if (probation) probation.seen = [];
    },
    sample({ fps, scale }) {
      if (!(fps > 0)) return null;
      if (probation) {
        probation.seen.push(fps);
        if (probation.seen.length < PROBATION_SAMPLES) return null;
        const after = median(probation.seen);
        const { from, fpsBefore } = probation;
        probation = null;
        strikes = 0;
        if (after >= fpsBefore * REQUIRED_GAIN || after >= minFps) return { save: scale };
        locked = true;
        return { scale: from, forget: true };
      }
      if (locked) return null;
      const verdict = adaptRenderScale({ fps, scale, strikes }, { minFps });
      strikes = verdict.strikes;
      if (!verdict.changed) return null;
      probation = { from: scale, fpsBefore: fps, seen: [] };
      return { scale: verdict.scale };
    },
  };
}

/** A remembered smaller size is used for this long: a session on a weak device, not the rest of the device's life. */
export const CAP_TTL_MS = 2 * 60 * 60_000;

export const encodeCap = (cap, now) => JSON.stringify({ cap, at: now });

/** The remembered size, or Infinity (no limit) if there is none, it has expired, or what is stored is not trusted. */
export function decodeCap(raw, now) {
  try {
    const { cap, at } = JSON.parse(raw);
    if (!(cap >= 1) || !Number.isFinite(at)) return Infinity;
    if (at > now || now - at >= CAP_TTL_MS) return Infinity;
    return cap;
  } catch {
    return Infinity;
  }
}
