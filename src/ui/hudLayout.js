/**
 * The in-game HUD bar (chapter / mode on top of the screen): what goes where, and at which type size.
 * One pure function so the same content can be checked to fit every screen: a desktop window (a game unit is about
 * 2 CSS px), a phone held sideways (1.4) and a phone held upright (0.8). Scenes only place their texts into the slots.
 */

const half = (n) => Math.round(n * 2) / 2;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const PIXEL = 'Press Start 2P';
const BODY = 'VT323';

/** Width of a text in game units: the pixel font is one em per character, VT323 0.4 em, emoji one em in either. */
export function estimateWidth(text, size, face) {
  let width = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) continue; // variation selector: no width
    const emoji = cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff);
    width += emoji ? size : size * (face === 'pixel' ? 1 : 0.4);
  }
  return width;
}

export function layoutHud({ width = 480, unit = 2, variant = 'story' } = {}) {
  // Type: the pixel font for labels, VT323 for values; each at least ~10 / ~12 CSS px wherever the screen allows.
  const labelPx = clamp(half(10 / unit), 7, 13.5);
  const valuePx = clamp(half(12 / unit), 12, 17);
  const rowH = Math.ceil(Math.max(labelPx * 1.15, valuePx * 1.05)) + 2;
  const pad = 2;
  const barH = rowH * 2 + pad * 2;
  const rowY = [pad, pad + rowH];
  const rowMid = rowY.map((y) => y + rowH / 2);
  // Small screens need bigger type, so the three columns become two rows with the health bar on the second.
  const stacked = unit < 1.1;
  const left = stacked ? 8 : 12;
  const right = width - left;
  const healthBar = { width: 104, height: stacked ? 12 : 9, fontPx: stacked ? 15 : 12 };
  const healthW = healthBar.width + 6;
  const healthH = healthBar.height + 6;

  const at = (x, row, ox, face) => ({ x, y: rowMid[row], ox, face });
  let health;
  let slots;

  if (variant === 'survival') {
    if (stacked) {
      health = { x: 314, y: rowMid[1] };
      slots = {
        mode: at(left, 0, 0, 'pixel'),
        wave: at(190, 0, 0, 'pixel'),
        harvest: at(right, 0, 1, 'body'),
        score: at(left, 1, 0, 'pixel'),
        foes: at(right, 1, 1, 'body'),
      };
    } else {
      health = { x: width / 2 - 25, y: barH / 2 };
      const mid = health.x + healthW / 2 + 16;
      slots = {
        mode: at(left, 0, 0, 'pixel'),
        score: at(left, 1, 0, 'pixel'),
        wave: at(mid, 0, 0, 'pixel'),
        foes: at(mid, 1, 0, 'body'),
        harvest: at(right, 0, 1, 'body'),
      };
    }
  } else if (stacked) {
    health = { x: 318, y: rowMid[1] };
    slots = {
      title: at(left, 0, 0, 'pixel'),
      materials: at(right, 0, 1, 'body'),
      objective: at(left, 1, 0, 'body'),
      harvest: at(right, 1, 1, 'body'),
    };
  } else {
    health = { x: width / 2 + 8, y: barH / 2 };
    slots = {
      title: at(left, 0, 0, 'pixel'),
      objective: at(left, 1, 0, 'body'),
      materials: at(right, 0, 1, 'body'),
      harvest: at(right, 1, 1, 'body'),
    };
  }

  return {
    stacked, barH, rowH, rowY, left, right, health, healthBar, healthW, healthH, slots,
    fonts: {
      label: { fontFamily: PIXEL, fontSize: `${labelPx}px` },
      value: { fontFamily: BODY, fontSize: `${valuePx}px` },
    },
  };
}
