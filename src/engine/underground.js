/**
 * The earth under the ground, down to the bottom of the picture.
 *
 * A run held upright is taller than the levels are (see engine/playStage.js), and the pad floats over the lower part of it.
 * The ground's own tiles go down 68 units; this carries the same earth on below them, as one tiled sprite per stretch of
 * ground rather than a tile each, and dims it a little with depth so the pad reads against it.
 */

/** How far down the ground's own tile rows go below its top edge. */
export const GROUND_TILES_DEPTH = 68;

/**
 * Fill `x .. x + width`, from `top` down to `bottom`, with the cliff's body tile. Returns the objects added (none when
 * there is nothing to fill).
 */
export function fillUnderground(scene, { x, top, width, bottom, depth = 9, tint }) {
  if (!(bottom > top) || !(width > 0)) return [];
  const earth = scene.add.tileSprite(x, top, width, bottom - top, 'tile_cliff_body_mid').setOrigin(0, 0).setDepth(depth);
  if (tint != null) earth.setTint(tint);
  const made = [earth];
  // darker with depth, in steps (they suit the pixel art): the pad floats over the bottom of this
  for (let i = 0, y = top; y < bottom; i += 1, y += DIM_STEP) {
    const alpha = Math.min(DIM_MAX, DIM_FIRST + i * DIM_RISE);
    made.push(scene.add.rectangle(x, y, width, Math.min(DIM_STEP, bottom - y), 0x050a14, alpha).setOrigin(0, 0).setDepth(depth + 0.1));
  }
  return made;
}

const DIM_STEP = 40;
const DIM_FIRST = 0.28;
const DIM_RISE = 0.09;
const DIM_MAX = 0.8;
