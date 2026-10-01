/**
 * How large a game unit looks on this screen, and text sizes that stay readable at that scale.
 * The game is drawn in game units (480 wide). A unit is about 2-3 CSS pixels on a desktop, 1.4 on a phone held
 * sideways and 0.8 on a phone held upright, so text sized in units alone is too small to read on an upright phone.
 */

/** CSS pixels per game unit: how big the canvas is shown, divided by the game's width. */
export function cssPerUnitOf(scene) {
  const shown = scene?.scale?.displaySize?.width;
  const game = scene?.scale?.gameSize?.width;
  return shown > 0 && game > 0 ? shown / game : 1;
}

/** The tall (portrait) canvas has room for bigger type and looser spacing. */
export const isTallCanvas = (scene) => (scene?.scale?.gameSize?.height ?? scene?.scale?.height ?? 0) > 300;

/**
 * A size in game units that is at least `minCss` CSS pixels on screen, and never smaller than `designSize`.
 * `maxBoost` caps how much it may grow beyond the design size, so a layout is never asked to grow without limit.
 * `round` snaps to half a unit.
 */
export function legibleSizeFor(designSize, cssPerUnit, minCss = 9, { maxBoost = 2, round = false } = {}) {
  const wanted = cssPerUnit > 0 ? minCss / cssPerUnit : designSize;
  let size = Math.min(Math.max(designSize, wanted), designSize * maxBoost);
  if (round) size = Math.round(size * 2) / 2;
  return size;
}

/** `legibleSizeFor` for the scene's current scale. */
export const legibleSize = (scene, designSize, minCss, options) => legibleSizeFor(designSize, cssPerUnitOf(scene), minCss, options);
