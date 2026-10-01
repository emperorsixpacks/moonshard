/**
 * Turns the font a scene asks for into one the canvas will actually use.
 *
 * Scenes write their text styles for a very small canvas: `fontFamily: 'Press Start 2P'`, sizes from 4px to 14px.
 * Two things were wrong with that:
 *
 *  1. A canvas silently IGNORES a font whose family name is not quoted ("7px Press Start 2P" is invalid CSS because of
 *     the "2P"), so every text in the game was drawn as 10px sans-serif whatever it asked for.
 *  2. The pixel font is only legible at its drawing size (8px) or larger. Captions of 4-6px do not survive in it.
 *
 * So headings keep the pixel font at the size they asked for, and captions that are too small for it use a readable
 * small font at a proportionally larger size (the hierarchy between them is kept).
 */

export const PIXEL_FONT = '"Press Start 2P", monospace';
export const BODY_FONT = '"VT323", monospace';

/** Below this size the pixel font stops being legible. */
const PIXEL_MIN_SIZE = 7;
/** VT323 looks about 2.3 x smaller than a pixel font set at the same number. */
const BODY_SIZE_FACTOR = 2.3;
/** An outline thicker than this share of the font size starts to fill the letters in. */
const MAX_OUTLINE_SHARE = 0.25;

const formatPx = (n) => `${Math.round(n * 10) / 10}px`;

function parseSize(fontSize) {
  if (typeof fontSize === 'number') return fontSize;
  const n = parseFloat(String(fontSize ?? ''));
  return Number.isFinite(n) ? n : NaN;
}

const needsQuotes = (family) => /\s/.test(family) && !/["',]/.test(family);

export function resolveTextStyle(style) {
  if (!style || typeof style !== 'object') return {};
  const out = { ...style };

  const family = out.fontFamily;
  if (typeof family === 'string') {
    const size = parseSize(out.fontSize);
    if (/press\s*start/i.test(family)) {
      if (!Number.isFinite(size) || size >= PIXEL_MIN_SIZE) {
        out.fontFamily = PIXEL_FONT;
        if (Number.isFinite(size)) out.fontSize = formatPx(size);
      } else {
        out.fontFamily = BODY_FONT;
        out.fontSize = formatPx(Math.round(size * BODY_SIZE_FACTOR * 2) / 2);
      }
    } else if (needsQuotes(family)) {
      out.fontFamily = `"${family}"`;
      if (Number.isFinite(size)) out.fontSize = formatPx(size);
    } else if (Number.isFinite(size)) {
      out.fontSize = formatPx(size);
    }
  }

  const finalSize = parseSize(out.fontSize);
  if (out.strokeThickness && Number.isFinite(finalSize)) {
    out.strokeThickness = Math.min(out.strokeThickness, finalSize * MAX_OUTLINE_SHARE);
  }
  return out;
}
