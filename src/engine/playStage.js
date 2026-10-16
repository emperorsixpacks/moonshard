/**
 * The size of the picture while a run is on and the phone is held upright.
 *
 * Other screens are 480 game units wide, fitted to the phone's width. A run takes the whole screen under the page header
 * (the pad floats on top of it), and it is a little narrower than the others, so that everything in it, the hero most of
 * all, is drawn bigger. Its height follows the shape of the screen, so the picture fills it with no black bars.
 *
 * The levels are built 440 units tall (the ground is at 380); a taller picture shows more ground below them, which the
 * pad covers.
 */

/** Game units across during a run. 480 is the other screens' width, so the hero is 480 / PLAY_WIDTH times bigger. */
export const PLAY_WIDTH = 360;
/** The levels are 440 tall: never show less. */
export const PLAY_MIN_HEIGHT = 440;
/** A very tall, thin screen would stretch the picture and the ground under the pad for nothing. */
export const PLAY_MAX_HEIGHT = 760;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * The picture's size in game units for an area of `width` x `height` CSS pixels, with the same shape as the area (within
 * the limits above).
 * @param {{width?: number, height?: number}} area the space the picture may fill
 */
export function playStageSize(area = {}, { logicalWidth = PLAY_WIDTH, min = PLAY_MIN_HEIGHT, max = PLAY_MAX_HEIGHT } = {}) {
  const { width, height } = area;
  const ratio = width > 0 && height > 0 ? height / width : min / logicalWidth;
  return { width: logicalWidth, height: Math.round(clamp(logicalWidth * ratio, min, max)) };
}

/** Where the levels' ground is, in world units from the top (all of them are built with it at 380). */
export const GROUND_Y = 380;

/**
 * How far to raise the ground so the hero stands above the pad. On a tall screen it is 0: the ground is above the pad
 * already. On a short one the picture is scrolled down by this many units, so the ground (and the earth below it, which
 * the pad covers) rises on screen.
 * @param {number} padTop where the top of the pad is, in game units from the top of the picture (NaN or <= 0 when the
 *   pad is not shown, e.g. someone playing with a keyboard)
 */
export function groundLift(padTop, { groundY = GROUND_Y, clearance = 6, max = 150 } = {}) {
  if (!(padTop > 0)) return 0;
  return Math.round(clamp(groundY - (padTop - clearance), 0, max));
}
