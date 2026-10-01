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
