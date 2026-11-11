export const WIDTH = 180;
export const MAX_HEIGHT = 1200;
export const MAX_COLORS = 12;
export const DEFAULT_COLORS = [
  { name: 'Encre', hex: '#1e2022' },
  { name: 'Vermillon', hex: '#ec4734' },
  { name: 'Écru', hex: '#eee0bd' },
  { name: 'Lichen', hex: '#b8ca61' },
];

export function design(height = 204, palette = DEFAULT_COLORS, name = 'Sans titre') {
  if (!Number.isInteger(height) || height < 1 || height > MAX_HEIGHT) throw new Error('Hauteur hors limites.');
  return { name, height, palette: palette.map(c => ({...c})), pixels: new Uint8Array(WIDTH * height) };
}

export function clone(p) {
  return { ...p, palette: p.palette.map(c => ({...c})), pixels: p.pixels.slice() };
}

export function resize(p, height) {
  const next = design(height, p.palette, p.name);
  next.pixels.set(p.pixels.subarray(0, next.pixels.length));
  return next;
}

export function rows(p) {
  const result = [];
  for (let y = 0; y < p.height; y++) {
    const mask = new Set(p.pixels.subarray(y * WIDTH, (y + 1) * WIDTH));
    result.push([...mask].sort((a, b) => a - b));
  }
  return result;
}

export function validate(p) {
  return p.pixels.length === WIDTH * p.height &&
    rows(p).every(row => row.length <= 2 && row.every(i => i < p.palette.length));
}

export function serialize(p) {
  return JSON.stringify({ version: 1, width: WIDTH, ...p, pixels: Array.from(p.pixels) });
}

export function parse(source) {
  const v = JSON.parse(source);
  if (!v || v.version !== 1 || v.width !== WIDTH || typeof v.name !== 'string' ||
    !Array.isArray(v.palette) || v.palette.length < 1 || v.palette.length > MAX_COLORS ||
    !v.palette.every(c => c && typeof c.name === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex)) ||
    new Set(v.palette.map(c => c.hex.toLowerCase())).size !== v.palette.length) throw new Error('Format de projet invalide.');
  const p = design(v.height, v.palette.map(c => ({name: c.name.slice(0, 28), hex: c.hex.toLowerCase()})), v.name.slice(0, 80));
  if (!Array.isArray(v.pixels) || v.pixels.length !== p.pixels.length ||
      !v.pixels.every(i => Number.isInteger(i) && i >= 0 && i < p.palette.length)) throw new Error('Pixels invalides.');
  p.pixels.set(v.pixels);
  if (!validate(p)) throw new Error('Certaines rangées ont plus de deux couleurs.');
  return p;
}

// Validate each final row as a unit so a stroke cannot introduce a third yarn,
// but can replace a color completely in that row.
export function paint(p, edits) {
  const byRow = new Map();
  for (const [x, y, c] of edits) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(c) ||
        x < 0 || x >= WIDTH || y < 0 || y >= p.height || c < 0 || c >= p.palette.length) continue;
    if (!byRow.has(y)) byRow.set(y, p.pixels.slice(y * WIDTH, (y + 1) * WIDTH));
    byRow.get(y)[x] = c;
  }
  let changed = false;
  const rejected = [];
  for (const [y, line] of byRow) {
    const start = y * WIDTH;
    if (new Set(line).size > 2) rejected.push(y);
    else if (line.some((value, x) => value !== p.pixels[start + x])) {
      p.pixels.set(line, start);
      changed = true;
    }
  }
  return { changed, rejected };
}

export function* stroke(x0, y0, x1, y1, size, color) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const lo = -Math.floor((size - 1) / 2), hi = lo + size;
  let error = dx + dy;
  while (true) {
    for (let dy = lo; dy < hi; dy++) for (let dx = lo; dx < hi; dx++) yield [x0 + dx, y0 + dy, color];
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
}

export function* fill(p, x, y, color) {
  const origin = y * WIDTH + x, target = p.pixels[origin];
  if (target === color) return;
  const queue = [origin], visited = new Uint8Array(p.pixels.length);
  visited[origin] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor], x = i % WIDTH;
    yield [x, Math.floor(i / WIDTH), color];
    const candidates = [i - WIDTH, i + WIDTH];
    if (x) candidates.push(i - 1);
    if (x + 1 < WIDTH) candidates.push(i + 1);
    for (const n of candidates) {
      if (n < 0 || n >= visited.length || visited[n] || p.pixels[n] !== target) continue;
      visited[n] = 1;
      queue.push(n);
    }
  }
}

export function rgb(hex) {
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
}

// Import into a rectangular region. Keep untouched stitches and fit the image
// to the two yarns that minimize the weighted RGB error on each row.
export function placeImage(p, image, left, top, allowed = p.palette.map((_, i) => i)) {
  const colors = p.palette.map(c => rgb(c.hex));
  const edits = [];
  let adapted = 0;
  for (let sy = 0; sy < image.height; sy++) {
    const y = sy + top;
    if (y < 0 || y >= p.height) continue;
    const fixed = new Set();
    const samples = [];
    for (let x = 0; x < WIDTH; x++) {
      const sx = x - left;
      const offset = (sy * image.width + sx) * 4;
      if (sx < 0 || sx >= image.width || image.data[offset + 3] < 128) {
        fixed.add(p.pixels[y * WIDTH + x]);
        continue;
      }
      const d = colors.map(([r, g, b]) =>
        2 * (r - image.data[offset]) ** 2 + 4 * (g - image.data[offset + 1]) ** 2 + (b - image.data[offset + 2]) ** 2);
      samples.push([x, d]);
    }
    if (!samples.length) continue;
    const candidates = [...new Set([...fixed, ...allowed])];
    let best, loss = Infinity;
    for (let i = 0; i < candidates.length; i++) for (let j = i; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if ([...fixed].some(c => c !== a && c !== b)) continue;
      let error = 0;
      for (const [, d] of samples) error += Math.min(d[a], d[b]);
      if (error < loss) { loss = error; best = [a, b]; }
    }
    if (!best) continue;
    const [a, b] = best;
    if (fixed.size && best.some(c => !allowed.includes(c))) adapted++;
    for (const [x, d] of samples) edits.push([x, y, d[a] <= d[b] ? a : b]);
  }
  return { ...paint(p, edits), adapted };
}

export function pixelRGBA(p) {
  const colors = p.palette.map(c => rgb(c.hex));
  const data = new Uint8ClampedArray(p.pixels.length * 4);
  for (let i = 0; i < p.pixels.length; i++) {
    const [r, g, b] = colors[p.pixels[i]], start = i * 4;
    data[start] = r; data[start + 1] = g; data[start + 2] = b; data[start + 3] = 255;
  }
  return data;
}
