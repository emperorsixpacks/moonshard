/*
 * The interface's pixel icons. Each icon is a small program on a 16x16 grid: shapes are filled, then an automatic dark
 * outline is added, so every icon shares the same hand-inked look. They are drawn as inline SVG (crisp at any size).
 * Characters are palette keys (COL); '#' means "the text colour around it", which is how a glyph follows its button.
 */

const COL = {
  '#': 'currentColor', k: '#0B1020', e: '#EEE8D5',
  s: '#DCE3F2', S: '#A9B8D8', D: '#5E7098', i: '#3E4C74', I: '#6E80AE',
  r: '#B06A3C', R: '#7E4624', b: '#9A6330', B: '#5A361A',
  g: '#F4B63F', G: '#FFD97A', o: '#B8761A', w: '#FFFFFF', m: '#62D6A4', d: '#5B6E95',
  // the realms' metals, light then dark: forest leaf, hive honey, ruins frost, caldera ember, spire violet (and the void's near-black)
  l: '#9BE8A8', L: '#3F9D5B', y: '#FFE08A', Y: '#D9942B', c: '#BFE3FF', C: '#5E86C6', f: '#FFB067', F: '#C8421C', v: '#D3B6FF', V: '#7A4DD6', x: '#2B1A52',
  // amber, light to dark
  a: '#FFD27A', A: '#F59A23', n: '#B8560C',
};

function canvas(w = 16, h = 16) {
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const A = {
    px(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; return A; },
    rect(x, y, rw, rh, c) { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) A.px(x + i, y + j, c); return A; },
    line(x0, y0, x1, y1, c, t = 1) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let er = dx + dy;
      for (;;) {
        A.px(x0, y0, c); if (t > 1) A.px(x0 + 1, y0, c); if (t > 2) A.px(x0, y0 + 1, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * er;
        if (e2 >= dy) { er += dy; x0 += sx; }
        if (e2 <= dx) { er += dx; y0 += sy; }
      }
      return A;
    },
    disc(cx, cy, r, c) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) A.px(x, y, c); return A; },
    ring(cx, cy, r, th, c, a0 = 0, a1 = 360) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r || d < r - th) continue;
        const a = (((Math.atan2(y - cy, x - cx) * 180) / Math.PI) % 360 + 360) % 360;
        const s = ((a0 % 360) + 360) % 360, e = ((a1 % 360) + 360) % 360;
        if (s <= e ? (a >= s && a <= e) : (a >= s || a <= e)) A.px(x, y, c);
      }
      return A;
    },
    mask(fn, c) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fn(x, y)) A.px(x, y, c); return A; },
    outline(c = 'k') {
      const src = g.map((r) => r.slice());
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (src[y][x] !== '.') continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => src[y + j]?.[x + i] && src[y + j][x + i] !== '.')) g[y][x] = c;
      }
      return A;
    },
    rows() { return g.map((r) => r.join('')); },
  };
  return A;
}

const IC = {};

function sword(rust, hi = 's', lo = 'S', tip = 'D') {
  const c = canvas();
  c.line(13, 2, 7, 8, hi).line(14, 2, 8, 8, lo); // blade: light edge, mid edge
  c.px(14, 1, hi).px(15, 2, tip).px(8, 9, tip);
  if (rust) c.px(11, 4, 'r').px(10, 5, 'R').px(9, 6, 'r').px(12, 3, 'r');
  c.line(4, 7, 9, 12, 'o'); c.px(5, 8, 'g').px(6, 9, 'g'); // cross guard
  c.line(5, 10, 3, 12, 'b', 2); c.px(4, 11, 'B'); // grip
  c.disc(2, 13, 1.2, 'g').px(1, 14, 'o'); // pommel
  return c.outline().rows();
}
IC.sword = sword(true);
IC.sword_clean = sword(false);
// the blades of the shop: one colour of metal for each realm, and the two Celestial looks
IC.blade_leaf = sword(false, 'l', 'L', 'L');
IC.blade_honey = sword(false, 'y', 'Y', 'Y');
IC.blade_frost = sword(false, 'c', 'C', 'C');
IC.blade_ember = sword(false, 'f', 'F', 'F');
IC.blade_violet = sword(false, 'v', 'V', 'V');
IC.blade_gold = sword(false, 'G', 'g', 'o');
IC.blade_void = sword(false, 'V', 'x', 'x');
IC.swordup = canvas()
  .rect(7, 1, 2, 9, 's').rect(8, 1, 1, 9, 'S').px(7, 0, 's').px(8, 0, 'S')
  .rect(4, 10, 8, 1, 'o').px(5, 10, 'g').px(6, 10, 'g').rect(7, 11, 2, 3, 'b').px(8, 12, 'B').rect(6, 14, 4, 1, 'g').px(9, 14, 'o')
  .outline().rows();
IC.anvil = canvas()
  .rect(1, 4, 3, 2, 'I').rect(3, 3, 11, 3, 'I').rect(3, 3, 11, 1, 'S')
  .rect(5, 6, 7, 3, 'i').rect(6, 9, 5, 2, 'i').rect(3, 11, 10, 3, 'i').rect(3, 11, 10, 1, 'I')
  .px(13, 5, 'D').px(12, 8, 'D')
  .outline().rows();
IC.trophy = canvas()
  .rect(4, 2, 8, 6, 'g').rect(5, 8, 6, 1, 'g').rect(6, 9, 4, 1, 'o').rect(5, 3, 1, 5, 'G').rect(6, 3, 1, 3, 'G')
  .rect(7, 10, 2, 2, 'o').rect(4, 12, 8, 2, 'o').rect(4, 12, 8, 1, 'g').rect(10, 3, 2, 5, 'o')
  .px(3, 3, 'o').px(2, 4, 'o').px(2, 5, 'o').px(3, 6, 'o').px(12, 3, 'o').px(13, 4, 'o').px(13, 5, 'o').px(12, 6, 'o')
  .outline().rows();
IC.chest = canvas()
  .rect(2, 4, 12, 3, 'b').rect(2, 4, 12, 1, 'r').rect(2, 7, 12, 6, 'b').rect(2, 7, 12, 1, 'B')
  .rect(7, 5, 2, 6, 'o').rect(7, 8, 2, 2, 'g').rect(2, 8, 1, 5, 'B').rect(13, 8, 1, 5, 'B').px(3, 5, 'r')
  .outline().rows();
IC.coin = canvas()
  .disc(7.5, 7.5, 7, 'o').disc(7.5, 7.5, 6, 'g')
  .ring(7.5, 7.5, 5.4, 1.4, 'G', 190, 285)
  .mask((x, y) => Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 3, 'o').mask((x, y) => Math.abs(x - 7.5) + Math.abs(y - 7.5) <= 2, 'G')
  .outline().rows();
IC.shard = canvas(9, 9)
  .mask((x, y) => Math.abs(x - 4) + Math.abs(y - 4) <= 4, 'g')
  .mask((x, y) => Math.abs(x - 4) + Math.abs(y - 4) <= 4 && x + y <= 7, 'G')
  .mask((x, y) => Math.abs(x - 4) + Math.abs(y - 4) <= 4 && x + y >= 9, 'o')
  .outline().rows();
IC.shardo = canvas(9, 9).mask((x, y) => { const d = Math.abs(x - 4) + Math.abs(y - 4); return d <= 4 && d >= 3; }, 'D').rows();
IC.sparkle = canvas(11, 11)
  .mask((x, y) => { const dx = Math.abs(x - 5), dy = Math.abs(y - 5); return dx * dy <= 1.6 && dx + dy <= 5; }, 'G').px(5, 5, 'w')
  .rows();

/* ---- interface glyphs (one colour: they follow the text colour) ---- */
IC.play = canvas().mask((x, y) => x >= 4 && Math.abs(y - 7.5) <= (13.5 - x) * 0.62 + 0.4, '#').rows();
IC.jump = canvas().mask((x, y) => y >= 1 && y <= 7 && Math.abs(x - 7.5) <= y - 1 + 0.5, '#').rect(6, 8, 4, 6, '#').rows();
IC.chev = canvas().line(3, 5, 8, 10, '#', 2).line(12, 5, 8, 9, '#', 2).rows();
IC.tick = canvas().line(2, 8, 6, 12, '#', 2).line(6, 12, 14, 4, '#', 2).rows();
IC.check = canvas().line(2, 8, 6, 12, 'm', 2).line(6, 12, 14, 4, 'm', 2).rows(); // the verified tick: the one green in the interface
IC.close = canvas().line(3, 3, 12, 12, '#', 2).line(12, 3, 3, 12, '#', 2).rows();
IC.pause = canvas().rect(4, 3, 3, 10, '#').rect(9, 3, 3, 10, '#').rows();
IC.gear = canvas().mask((x, y) => {
  const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy);
  if (r < 2.6) return false;
  if (r <= 5.2) return true;
  if (r <= 7.4) return ((Math.atan2(dy, dx) * 180) / Math.PI + 382.5) % 45 < 15;
  return false;
}, '#').rows();
IC.loop = (() => { // endless: a figure-eight whose strokes cross in the middle
  const c = canvas();
  for (let t = 0; t < 6.2832; t += 0.01) {
    const d = 1 + Math.sin(t) ** 2;
    c.px(7.5 + (7 * Math.cos(t)) / d, 7.5 + (9 * Math.sin(t) * Math.cos(t)) / d, '#');
  }
  // thicken by one pixel right and down
  const rows = c.rows();
  const out = canvas();
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') out.px(x, y, '#').px(x + 1, y, '#').px(x, y + 1, '#'); }));
  return out.rows();
})();
const speaker = () => {
  const c = canvas().rect(1, 6, 3, 4, '#');
  for (let i = 0; i < 4; i++) c.rect(4 + i, 5 - i, 1, 6 + 2 * i, '#');
  return c;
};
IC.spk_on = speaker().ring(8, 8, 4.2, 1.2, '#', -50, 50).ring(8, 8, 6.6, 1.2, '#', -50, 50).rows();
IC.spk_off = speaker().line(10, 5, 14, 11, 'e', 2).line(14, 5, 10, 11, 'e', 2).rows();
const note = () => canvas().rect(5, 3, 9, 2, '#').rect(5, 3, 2, 9, '#').rect(12, 3, 2, 9, '#').disc(4, 11.5, 2.2, '#').disc(11, 11.5, 2.2, '#');
IC.note_on = note().rows();
IC.note_off = note().line(2, 14, 14, 2, 'e', 2).rows();
/** A medal on a ribbon: gold, silver and bronze are the same shape in three metals (the Leaderboard's top three). */
function medal(rim, face, hi) {
  return canvas()
    .rect(4, 9, 3, 6, 'I').rect(9, 9, 3, 6, 'i').px(5, 14, '.').px(10, 14, '.') // the ribbon, with a notch in its end
    .disc(7.5, 5.5, 5.4, rim).disc(7.5, 5.5, 4.4, face)
    .ring(7.5, 5.5, 3.5, 1.2, hi, 190, 285)
    .outline().rows();
}
IC.medal = medal('o', 'g', 'G');
IC.medal_silver = medal('D', 'S', 's');
IC.medal_bronze = medal('B', 'b', 'r');
IC.mail = canvas().rect(2, 4, 12, 1, '#').rect(2, 12, 12, 1, '#').rect(2, 4, 1, 9, '#').rect(13, 4, 1, 9, '#').line(2, 4, 7, 9, '#').line(13, 4, 8, 9, '#').rows();
IC.share = canvas().line(4, 8, 12, 4, '#', 2).line(4, 8, 12, 12, '#', 2).disc(4, 8, 2.6, '#').disc(12, 3.5, 2.6, '#').disc(12, 12.5, 2.6, '#').rows(); // invite: three nodes joined
IC.copy = (() => { // two sheets: the front one covers the back
  const c = canvas();
  const box = (x, y, n) => c.rect(x, y, n, 1, '#').rect(x, y + n - 1, n, 1, '#').rect(x, y, 1, n, '#').rect(x + n - 1, y, 1, n, '#');
  box(2, 2, 8);
  c.rect(6, 6, 8, 8, '.');
  box(6, 6, 8);
  return c.rows();
})();
IC.lock = canvas().rect(3, 7, 10, 7, '#').ring(7.5, 6.5, 3.8, 1.8, '#', 180, 360).px(7, 10, '.').px(8, 10, '.').px(7, 11, '.').px(8, 11, '.').rows();

/* ---- armour: a helm and a shield for each realm ---- */
/** A helm seen from the front: a dome, a brim and a face guard with two eye windows (a cap has ear flaps instead); `deco` adds what makes it the realm's own. */
function helm({ hi, mid, lo, trim, cap = false }, deco) {
  const c = canvas();
  const dome = (x, y, k) => ((x - 7.5) / (6.4 * k)) ** 2 + ((y - 9.5) / (7.8 * k)) ** 2 <= 1;
  c.mask((x, y) => y >= 2 && y <= 9 && dome(x, y, 1), mid);
  c.mask((x, y) => y >= 3 && y <= 8 && x <= 7 && dome(x, y, 0.74), hi);
  c.rect(2, 9, 12, 2, trim);
  if (cap) {
    c.rect(2, 11, 3, 3, mid).rect(11, 11, 3, 3, mid).rect(2, 11, 1, 3, lo).rect(13, 11, 1, 3, lo);
  } else {
    c.rect(2, 11, 12, 4, mid).rect(2, 11, 1, 4, lo).rect(13, 11, 1, 4, lo).rect(2, 14, 12, 1, lo);
    c.px(2, 14, '.').px(13, 14, '.').rect(4, 11, 3, 2, 'k').rect(9, 11, 3, 2, 'k');
  }
  deco?.(c);
  return c.outline().rows();
}
IC.helm_woods = helm({ hi: 'r', mid: 'b', lo: 'B', trim: 'B', cap: true }, (c) => c.rect(5, 4, 1, 1, 'R').rect(10, 6, 1, 1, 'R').line(12, 1, 14, 4, 'l').line(13, 1, 14, 4, 'L')); // a leather cap, a leaf in its band
IC.helm_hive = helm({ hi: 'y', mid: 'Y', lo: 'n', trim: 'n' }, (c) => c.line(5, 2, 3, 0, 'n').line(10, 2, 12, 0, 'n').px(3, 0, 'y').px(12, 0, 'y').rect(5, 5, 6, 1, 'n')); // chitin, with feelers
IC.helm_ruins = helm({ hi: 'e', mid: 's', lo: 'S', trim: 'D' }, (c) => c.rect(7, 0, 2, 3, 'S').rect(7, 0, 1, 3, 'e').rect(4, 5, 8, 1, 'D')); // a warden's helm, tall crest
IC.helm_caldera = helm({ hi: 'D', mid: 'i', lo: 'k', trim: 'F' }, (c) => c.line(3, 5, 1, 1, 'i').line(12, 5, 14, 1, 'i').px(1, 1, 'f').px(14, 1, 'f').rect(5, 11, 2, 1, 'f').rect(9, 11, 2, 1, 'f')); // obsidian, horned, eyes alight
IC.helm_spire = helm({ hi: 'v', mid: 'V', lo: 'x', trim: 'G' }, (c) => c.px(4, 1, 'G').px(7, 0, 'G').px(8, 0, 'G').px(11, 1, 'G').rect(4, 2, 8, 1, 'G').px(7, 5, 'w').px(8, 5, 'w')); // a crown helm

/** A heater shield (a kite with a flat top): `rim`, `face`, a sheen on the left, then what makes it the realm's own. */
function shield({ rim, face, hi }, deco) {
  const c = canvas();
  const half = (y) => (y <= 7 ? 6 : Math.max(0, 6 - (y - 7) * 0.85));
  c.mask((x, y) => y >= 1 && y <= 14 && Math.abs(x - 7.5) <= half(y) + 0.5, rim);
  c.mask((x, y) => y >= 2 && y <= 13 && Math.abs(x - 7.5) <= half(y) - 0.5, face);
  c.mask((x, y) => y >= 3 && y <= 8 && x >= 3 && x <= 5 && Math.abs(x - 7.5) <= half(y) - 0.5, hi);
  deco?.(c);
  return c.outline().rows();
}
IC.shield_woods = canvas().disc(7.5, 7.5, 6.6, 'B').disc(7.5, 7.5, 5.6, 'b').ring(7.5, 7.5, 4.6, 0.9, 'r', 200, 300).disc(7.5, 7.5, 2, 'o').disc(7.5, 7.5, 1.1, 'g').px(3, 7, 'B').px(12, 7, 'B').outline().rows(); // an oak buckler: round, iron boss
IC.shield_hive = shield({ rim: 'n', face: 'Y', hi: 'y' }, (c) => { for (const [x, y] of [[6, 5], [9, 5], [4, 8], [7, 8], [10, 8], [6, 11], [9, 11]]) c.px(x, y, 'n').px(x + 1, y, 'n').px(x, y + 1, 'y'); }); // honeycomb cells
IC.shield_ruins = shield({ rim: 'D', face: 's', hi: 'e' }, (c) => c.rect(7, 3, 2, 9, 'S').rect(4, 6, 8, 2, 'S').px(7, 4, 'e').px(5, 6, 'e')); // a bone bulwark, crossed
IC.shield_caldera = shield({ rim: 'k', face: 'i', hi: 'D' }, (c) => c.line(7, 3, 9, 7, 'f').line(9, 7, 6, 10, 'f').line(6, 10, 8, 12, 'F').px(8, 3, 'f')); // obsidian with a seam of magma
IC.shield_spire = shield({ rim: 'G', face: 'V', hi: 'v' }, (c) => c.disc(7.5, 7, 3.2, 'v').disc(9, 6, 2.8, 'V').px(4, 4, 'w').px(11, 10, 'w')); // a bastion with a moon on it

/* ---- the three forest materials ---- */
IC.bark = canvas().disc(7.5, 7.5, 6.6, 'B').disc(7.5, 7.5, 5.2, 'r').ring(7.5, 7.5, 3.6, 1.1, 'b').ring(7.5, 7.5, 1.5, 1.1, 'b').px(7, 7, 'R').px(8, 8, 'R').outline().rows();
IC.amber = canvas().mask((x, y) => Math.abs(x - 7.5) + Math.abs(y - 8) <= 6.5, 'A').mask((x, y) => Math.abs(x - 7.5) + Math.abs(y - 8) <= 4.2, 'a')
  .mask((x, y) => Math.abs(x - 7.5) + Math.abs(y - 8) <= 6.5 && x + y >= 17, 'n').px(5, 5, 'w').px(6, 4, 'w').px(5, 6, 'w').outline().rows();
IC.iron = canvas()
  .rect(5, 5, 6, 1, 'S').rect(4, 6, 8, 1, 'S').rect(3, 7, 10, 1, 'I').rect(2, 8, 12, 4, 'I').rect(2, 12, 12, 1, 'i')
  .rect(5, 6, 5, 1, 's').px(3, 8, 'S').px(4, 9, 'S').px(11, 10, 'D').px(12, 9, 'D').outline().rows();

/* ---- the five realms, one glyph each (they follow the text colour) ---- */
IC.realm_woods = canvas()
  .mask((x, y) => y >= 1 && y <= 5 && Math.abs(x - 7.5) <= (y - 1) * 0.9 + 0.5, '#')
  .mask((x, y) => y >= 5 && y <= 9 && Math.abs(x - 7.5) <= (y - 5) * 1 + 1.5, '#')
  .mask((x, y) => y >= 9 && y <= 12 && Math.abs(x - 7.5) <= (y - 9) * 1.1 + 2.5, '#').rect(7, 12, 2, 3, '#').rows();
IC.realm_hive = (() => {
  const hex = (r) => (x, y) => Math.abs(x - 7.5) <= r * 0.866 && Math.abs(y - 7.5) + Math.abs(x - 7.5) * 0.577 <= r;
  return canvas().mask(hex(7), '#').mask(hex(4.6), '.').mask(hex(1.8), '#').rows();
})();
IC.realm_ruins = canvas().rect(1, 13, 14, 2, '#').rect(2, 6, 3, 7, '#').rect(11, 6, 3, 7, '#').ring(7.5, 6.5, 6.2, 2.4, '#', 180, 360).rect(2, 6, 3, 1, '#').rect(11, 6, 3, 1, '#').rows();
IC.realm_caldera = canvas()
  .disc(7.5, 10, 4.8, '#').mask((x, y) => y >= 1 && y <= 9 && Math.abs(x - 7.5) <= (y - 1) * 0.6, '#').px(10, 4, '#').px(10, 5, '#')
  .disc(7.5, 11.5, 2.2, '.').px(7, 9, '.').px(8, 9, '.').rows();
IC.realm_spire = canvas().disc(7, 8, 6, '#').disc(10.5, 6, 5, '.').px(12, 11, '#').px(13, 11, '#').px(12, 12, '#').px(12, 10, '#').rows();

/** An icon's size in its own pixels and its pixels as SVG rects (a run of one colour along a row is one rect). */
function paint(name) {
  const rows = IC[name];
  if (!rows) throw new Error(`unknown icon: ${name}`);
  const h = rows.length, w = rows[0].length;
  let r = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      if (c === '.') { x += 1; continue; }
      let x2 = x;
      while (x2 < w && row[x2] === c) x2 += 1;
      r += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${COL[c]}"/>`;
      x = x2;
    }
  });
  return { w, h, r };
}

/** An icon as inline SVG, `px` pixels on its longest side. */
export function ico(name, px = 20, cls = '') {
  const { w, h, r } = paint(name);
  const s = px / Math.max(w, h);
  return `<svg class="ico ${cls}" viewBox="0 0 ${w} ${h}" width="${(w * s).toFixed(1)}" height="${(h * s).toFixed(1)}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

/**
 * An icon as a reference to a symbol of iconSprite(): the same picture as ico() for a few dozen bytes instead of all its
 * pixels, for a screen that draws the same icons many times over (the shop's cards).
 */
export function icoUse(name, px = 20, cls = '') {
  const { w, h } = paint(name);
  const s = px / Math.max(w, h);
  return `<svg class="ico ${cls}" viewBox="0 0 ${w} ${h}" width="${(w * s).toFixed(1)}" height="${(h * s).toFixed(1)}" shape-rendering="crispEdges" aria-hidden="true"><use href="#ms-ic-${name}"/></svg>`;
}

/** The symbols icoUse() points at, drawn once where the screen can see them (an SVG of no size, put on the page beside it). */
export function iconSprite(names) {
  const symbols = names.map((name) => {
    const { w, h, r } = paint(name);
    return `<symbol id="ms-ic-${name}" viewBox="0 0 ${w} ${h}">${r}</symbol>`;
  });
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${symbols.join('')}</defs></svg>`;
}

export const ICON_NAMES = Object.keys(IC);

/**
 * The moon: a pixel disc with a gold crack. With `rank` every pixel carries a random order (data-r, 0 to 1; the crack comes
 * last), so the loader can build the moon up as the game loads.
 */
export function moonSvg(rank = false) {
  const N = 26, R = 12.2;
  const crack = new Set('17,2 17,3 16,4 16,5 15,6 15,7 14,8 14,9 13,10 12,11 12,12 11,13 10,14 10,15 9,16'.split(' '));
  const craters = new Set('7,8 8,8 7,9 8,9 8,17 9,17 8,18 15,16 16,16 15,17 5,13 6,13 13,19 14,19'.split(' '));
  let r = '', seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - 13, dy = y + 0.5 - 13, d = Math.hypot(dx, dy);
    if (d > R) continue;
    const k = `${x},${y}`;
    let c;
    if (crack.has(k)) c = '#FFD97A';
    else if (crack.has(`${x - 1},${y}`) || crack.has(`${x + 1},${y}`)) c = '#F6E2A8';
    else if (craters.has(k)) c = '#C1CADF';
    else if (d > R - 1) c = '#B6C1DB';
    else if (dx * 0.8 + dy * 0.6 > 6.5) c = '#CBD2E4';
    else c = '#EEE8D5';
    const rk = rank ? ` data-r="${(crack.has(k) ? 0.96 + rnd() * 0.04 : rnd() * 0.94).toFixed(3)}"` : '';
    r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"${rk}/>`;
  }
  return `<svg class="moon" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
