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

function sword(rust) {
  const c = canvas();
  c.line(13, 2, 7, 8, 's').line(14, 2, 8, 8, 'S'); // blade: light edge, mid edge
  c.px(14, 1, 's').px(15, 2, 'D').px(8, 9, 'D');
  if (rust) c.px(11, 4, 'r').px(10, 5, 'R').px(9, 6, 'r').px(12, 3, 'r');
  c.line(4, 7, 9, 12, 'o'); c.px(5, 8, 'g').px(6, 9, 'g'); // cross guard
  c.line(5, 10, 3, 12, 'b', 2); c.px(4, 11, 'B'); // grip
  c.disc(2, 13, 1.2, 'g').px(1, 14, 'o'); // pommel
  return c.outline().rows();
}
IC.sword = sword(true);
IC.sword_clean = sword(false);
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
IC.lock = canvas().rect(3, 7, 10, 7, '#').ring(7.5, 6.5, 3.8, 1.8, '#', 180, 360).px(7, 10, '.').px(8, 10, '.').px(7, 11, '.').px(8, 11, '.').rows();

/** An icon as inline SVG, `px` pixels on its longest side. */
export function ico(name, px = 20, cls = '') {
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
  const s = px / Math.max(w, h);
  return `<svg class="ico ${cls}" viewBox="0 0 ${w} ${h}" width="${(w * s).toFixed(1)}" height="${(h * s).toFixed(1)}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
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
