/** Small deterministic pixel avatar (5x5, mirrored) derived from an address. */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function identiconGrid(address) {
  const seed = String(address || '').toLowerCase();
  let state = hash32(seed) || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  const grid = [];
  for (let y = 0; y < 5; y++) {
    const half = [next() % 100 < 55, next() % 100 < 55, next() % 100 < 55];
    grid.push([half[0], half[1], half[2], half[1], half[0]]);
  }
  return grid;
}

export function identiconSvg(address) {
  const hue = hash32(String(address || '').toLowerCase()) % 360;
  const fg = `hsl(${hue} 70% 58%)`;
  const bg = `hsl(${hue} 35% 14%)`;
  const cells = identiconGrid(address)
    .flatMap((row, y) => row.map((on, x) => (on ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${fg}"/>` : '')))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" shape-rendering="crispEdges"><rect width="5" height="5" fill="${bg}"/>${cells}</svg>`;
}

export async function identiconDataUrl(address) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(identiconSvg(address))}`;
}
