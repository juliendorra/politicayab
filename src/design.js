export const WIDTH = 180;
export const MAX_HEIGHT = 1200;
export const MAX_COLORS = 12;
export const MAX_COLOR_NAME_LENGTH = 64;
export const MAX_LAYERS = 24;
export const MAX_PROJECT_BYTES = 32_000_000;
export const MAX_TEXT_LENGTH = 200;
export const DEFAULT_COLORS = [
  { name: 'Encre', hex: '#1e2022' },
  { name: 'Vermillon', hex: '#ec4734' },
  { name: 'Écru', hex: '#eee0bd' },
  { name: 'Lichen', hex: '#b8ca61' },
];
export const FILL_PATTERNS = {
  solid: { label: 'Uni', mask: ['1'] },
  checker: { label: 'Damier', mask: ['10', '01'] },
  dots: { label: 'Pois', mask: ['100', '000', '000'] },
  horizontal: { label: 'Horizontal', mask: ['1', '1', '0', '0'] },
  vertical: { label: 'Vertical', mask: ['1100'] },
  diagonal: { label: 'Diagonales', mask: ['1100', '0110', '0011', '1001'] },
};

export function design(height = 204, palette = DEFAULT_COLORS, name = 'Sans titre') {
  if (!Number.isInteger(height) || height < 1 || height > MAX_HEIGHT) throw new Error('Hauteur hors limites.');
  return {
    name, height, palette: palette.map(c => ({...c})), pixels: new Uint8Array(WIDTH * height),
    layers: [], checkFloats: false, floatLimit: 12, noiseAmount: 0, grainYarn: null,
  };
}

export function clone(p) {
  return { ...p, palette: p.palette.map(c => ({...c})), pixels: p.pixels.slice(), layers: p.layers.slice() };
}

export function removeYarn(p, removed, replacement) {
  const last = p.palette.length - 1;
  if (!inRange(removed, 0, last) || !inRange(replacement, 0, last) || removed === replacement) {
    throw new Error('Choisissez un autre fil.');
  }
  const remaining = p.palette.map((_, i) => i).filter(i => i !== removed);
  if (removed === 0) {
    // The replacement also becomes the eraser color and the background of new rows.
    remaining.splice(remaining.indexOf(replacement), 1);
    remaining.unshift(replacement);
  }
  const remap = p.palette.map((_, i) => remaining.indexOf(i === removed ? replacement : i));
  return {
    ...p,
    palette: remaining.map(i => p.palette[i]),
    pixels: p.pixels.map(i => remap[i]),
    grainYarn: p.grainYarn == null ? null : remap[p.grainYarn],
    layers: p.layers.map(layer => {
      if (layer.type === 'text') return { ...layer, color: remap[layer.color] };
      if (layer.duo) return { ...layer, duo: layer.duo.map(i => remap[i]) };
      return layer;
    }),
  };
}

export function resize(p, height) {
  if (!inRange(height, 1, MAX_HEIGHT)) throw new Error('Hauteur hors limites.');
  const next = { ...p, height, pixels: new Uint8Array(WIDTH * height) };
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
  return JSON.stringify({ version: 3, width: WIDTH, ...p, pixels: Array.from(p.pixels) });
}

export function parse(source) {
  const v = JSON.parse(source);
  if (!v || ![1, 2, 3].includes(v.version) || v.width !== WIDTH || typeof v.name !== 'string' ||
    !Array.isArray(v.palette) || v.palette.length < 1 || v.palette.length > MAX_COLORS ||
    !v.palette.every(c => c && typeof c.name === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex)) ||
    new Set(v.palette.map(c => c.hex.toLowerCase())).size !== v.palette.length) throw new Error('Format de projet invalide.');
  const palette = v.palette.map(c => ({ name: c.name.slice(0, MAX_COLOR_NAME_LENGTH), hex: c.hex.toLowerCase() }));
  const p = design(v.height, palette, v.name.slice(0, 80));
  if (!Array.isArray(v.pixels) || v.pixels.length !== p.pixels.length ||
      !v.pixels.every(i => Number.isInteger(i) && i >= 0 && i < p.palette.length)) throw new Error('Pixels invalides.');
  p.pixels.set(v.pixels);
  if (!validate(p)) throw new Error('Certaines rangées ont plus de deux couleurs.');
  if (v.version >= 2) {
    const layers = v.version === 2 ? v.textLayers : v.layers;
    if (typeof v.checkFloats !== 'boolean' || !inRange(v.floatLimit, 1, WIDTH) ||
        !Array.isArray(layers) || layers.length > MAX_LAYERS ||
        (v.version === 3 && (!inRange(v.noiseAmount, 0, 30) ||
          (v.grainYarn != null && !inRange(v.grainYarn, 0, palette.length - 1))))) {
      throw new Error('Réglages ou objets invalides.');
    }
    p.checkFloats = v.checkFloats;
    p.floatLimit = v.floatLimit;
    p.noiseAmount = v.version === 3 ? v.noiseAmount : 0;
    if (v.version === 3) p.grainYarn = v.grainYarn ?? null;
    p.layers = layers.map(layer => {
      if (v.version === 2 || layer?.type === 'text') return parseTextLayer(layer, palette.length);
      return parseImageLayer(layer, palette.length);
    });
    if (compose(p).rejected.size) throw new Error('Certains objets ajoutent une troisième couleur.');
  }
  return p;
}

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function parseTextLayer(layer, paletteSize) {
  if (!layer || typeof layer.text !== 'string' || !layer.text.trim() || layer.text.length > MAX_TEXT_LENGTH ||
      typeof layer.font !== 'string' || !/^[a-z0-9-]{1,32}$/.test(layer.font) ||
      !inRange(layer.width, 1, WIDTH) || !inRange(layer.height, 1, MAX_HEIGHT) ||
      !inRange(layer.x, 0, WIDTH - layer.width) || !inRange(layer.y, 0, MAX_HEIGHT - layer.height) ||
      !inRange(layer.color, 0, paletteSize - 1) || typeof layer.mask !== 'string') {
    throw new Error('Texte invalide.');
  }
  const { text, font, width, height, x, y, color, mask } = layer;
  const bytes = Math.ceil(width * height / 8);
  if (mask.length !== Math.ceil(bytes / 3) * 4 || atob(mask).length !== bytes) throw new Error('Masque de texte invalide.');
  return { type: 'text', text, font, width, height, x, y, color, mask };
}

function parseImageLayer(layer, paletteSize) {
  if (layer?.type !== 'image' || !inRange(layer.width, 1, WIDTH) || !inRange(layer.height, 1, MAX_HEIGHT) ||
      !inRange(layer.x, 0, WIDTH - layer.width) || !inRange(layer.y, 0, MAX_HEIGHT - layer.height) ||
      typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 120 ||
      !(layer.duo === null || (Array.isArray(layer.duo) && layer.duo.length === 2 &&
        layer.duo.every(i => inRange(i, 0, paletteSize - 1))))) throw new Error('Image invalide.');
  const { source, type, name, x, y, width, height, duo } = layer;
  const aspectRatio = layer.aspectRatio === undefined ? width / height : layer.aspectRatio;
  const orderedDuo = layer.orderedDuo ?? false;
  if (aspectRatio !== null && (!Number.isFinite(aspectRatio) || aspectRatio < 1 / MAX_HEIGHT || aspectRatio > WIDTH)) {
    throw new Error('Proportions de l’image invalides.');
  }
  if (typeof orderedDuo !== 'boolean') throw new Error('Réglage des fils de l’image invalide.');
  if (!source || !inRange(source.width, 1, WIDTH) || !inRange(source.height, 1, MAX_HEIGHT) ||
      typeof source.rgba !== 'string') throw new Error('Source d’image invalide.');
  const bytes = source.width * source.height * 4;
  if (source.rgba.length !== Math.ceil(bytes / 3) * 4 || atob(source.rgba).length !== bytes) {
    throw new Error('Pixels de l’image invalides.');
  }
  return { type, name, x, y, width, height, duo, aspectRatio, orderedDuo, source: { width: source.width, height: source.height, rgba: source.rgba } };
}

export function proportionalImageSize(ratio, requestedWidth, maxWidth, maxHeight) {
  const width = Math.min(maxWidth, maxHeight * ratio, Math.max(1, ratio, requestedWidth));
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(width / ratio)) };
}

export function resizeImageCorner(layer, [sideX, sideY], dx, dy, posterHeight) {
  const { x, y, width, height } = layer;
  if (dx === 0 && dy === 0) return { x, y, width, height };
  const ratio = layer.aspectRatio ?? width / height;
  const right = x + width, bottom = y + height;
  const maxWidth = sideX < 0 ? right : WIDTH - x;
  const maxHeight = sideY < 0 ? bottom : posterHeight - y;
  // Project the pointer movement onto the diagonal of the locked rectangle.
  const targetWidth = width + (sideX * dx + sideY * dy / ratio) / (1 + 1 / (ratio * ratio));
  const size = proportionalImageSize(ratio, targetWidth, maxWidth, maxHeight);
  return {
    x: sideX < 0 ? right - size.width : x,
    y: sideY < 0 ? bottom - size.height : y,
    ...size,
  };
}

export function packImageSource({ width, height, data }) {
  const chunks = [];
  for (let offset = 0; offset < data.length; offset += 16384) {
    chunks.push(String.fromCharCode(...data.subarray(offset, offset + 16384)));
  }
  return { width, height, rgba: btoa(chunks.join('')) };
}

const imageSources = new WeakMap();

function scaledImage(layer) {
  const { source, width, height } = layer;
  let cached = imageSources.get(source);
  if (!cached) {
    cached = { original: Uint8Array.from(atob(source.rgba), char => char.charCodeAt(0)) };
    imageSources.set(source, cached);
  }
  if (source.width === width && source.height === height) return { width, height, data: cached.original };
  if (cached.scaled?.width === width && cached.scaled?.height === height) return cached.scaled;
  const data = new Uint8Array(width * height * 4);
  const columns = Array.from({ length: width }, (_, x) => Math.floor((x + .5) * source.width / width) * 4);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y + .5) * source.height / height) * source.width * 4;
    for (let x = 0; x < width; x++) {
      const from = row + columns[x], to = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) data[to + channel] = cached.original[from + channel];
    }
  }
  return cached.scaled = { width, height, data };
}

// Keep a 1-bit copy of the rasterized text so reopening a project preserves its exact stitches.
export function packTextMask({ width, height, data }) {
  const bytes = new Uint8Array(Math.ceil(width * height / 8));
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] >= 128) bytes[i >> 3] |= 1 << (i & 7);
  }
  return btoa(String.fromCharCode(...bytes));
}

const textMasks = new WeakMap();

function prepareLayers(p) {
  const colors = p.palette.map(c => rgb(c.hex));
  const allowed = colors.map((_, i) => i);
  return p.layers.map(layer => {
    if (layer.type !== 'image') return { layer };
    const image = scaledImage(layer);
    const threshold = layer.duo && layer.orderedDuo ? sourceToneThreshold(layer.source) : null;
    return { layer, image, colors, allowed: layer.duo ?? allowed, threshold };
  });
}

function objectRow(layers, base, y, rejected, adapted) {
  let line = base;
  for (const item of layers) {
    const { layer } = item;
    if (y < layer.y || y >= layer.y + layer.height) continue;
    if (item.image) {
      const sy = y - layer.y;
      const result = item.threshold === null
        ? fitImageRow(line, item.image, layer.x, sy, item.colors, item.allowed)
        : fitToneRow(line, item.image, layer.x, sy, item.colors, item.allowed, item.threshold);
      line = result.line;
      if (result.adapted && adapted) adapted.set(layer, (adapted.get(layer) ?? 0) + 1);
      continue;
    }
    let mask = textMasks.get(layer);
    if (!mask) {
      mask = Uint8Array.from(atob(layer.mask), char => char.charCodeAt(0));
      textMasks.set(layer, mask);
    }
    const first = (y - layer.y) * layer.width;
    const stamped = line.slice();
    for (let x = 0; x < layer.width; x++) {
      const bit = first + x;
      if (mask[bit >> 3] & (1 << (bit & 7))) stamped[layer.x + x] = layer.color;
    }
    if (new Set(stamped).size <= 2) line = stamped;
    else rejected.add(y);
  }
  return line;
}

export function compose(p) {
  const rejected = new Set(), adapted = new Map();
  if (!p.layers.length) return { visible: p, rejected, adapted };
  const layers = prepareLayers(p);
  const pixels = new Uint8Array(p.pixels.length);
  for (let y = 0; y < p.height; y++) {
    const start = y * WIDTH;
    const line = objectRow(layers, p.pixels.subarray(start, start + WIDTH), y, rejected, adapted);
    pixels.set(line, start);
  }
  return { visible: { ...p, pixels }, rejected, adapted };
}

// A run at either edge counts if the row uses two yarns. A solid row has no second yarn.
export function findFloats(p, limit) {
  const byRow = new Map();
  let longest = 0, count = 0;
  for (let y = 0; y < p.height; y++) {
    const offset = y * WIDTH;
    let start = 0;
    const spans = [];
    for (let x = 1; x <= WIDTH; x++) {
      if (x < WIDTH && p.pixels[offset + x] === p.pixels[offset + start]) continue;
      if (x === WIDTH && start === 0) break;
      const length = x - start;
      longest = Math.max(longest, length);
      if (length > limit) spans.push({ start, length, color: p.pixels[offset + start] });
      start = x;
    }
    if (spans.length) {
      byRow.set(y, spans);
      count += spans.length;
    }
  }
  return { byRow, longest, count };
}

function stitchNoise(x, y) {
  let hash = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

function grainCompanions(p, palettes) {
  const usage = new Uint32Array(p.palette.length);
  const mixes = p.palette.map(() => []);
  for (let row = 0; row < p.height; row++) {
    const [first, second] = palettes[row];
    if (second === undefined) {
      usage[first] += WIDTH;
      continue;
    }
    let firstCount = 0;
    for (let i = row * WIDTH; i < (row + 1) * WIDTH; i++) {
      firstCount += Number(p.pixels[i] === first);
    }
    const secondCount = WIDTH - firstCount;
    usage[first] += firstCount;
    usage[second] += secondCount;
    const strength = Math.min(firstCount, secondCount);
    mixes[first].push({ row, yarn: second, strength });
    mixes[second].push({ row, yarn: first, strength });
  }
  const brightness = p.palette.map(color => luma(rgb(color.hex), 0));
  const yarns = p.palette.map((_, i) => i);
  const companions = new Uint8Array(p.height);
  for (let start = 0; start < p.height;) {
    const [first, existing] = palettes[start];
    if (existing !== undefined) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < p.height && palettes[end].length === 1 && palettes[end][0] === first) end++;

    let companion = p.grainYarn;
    if (companion == null || companion === first) {
      const scores = new Float64Array(p.palette.length);
      for (const mix of mixes[first]) {
        // Measure from the nearer edge so the whole solid band gets one companion.
        const distance = mix.row < start ? start - mix.row : mix.row - end + 1;
        scores[mix.yarn] += mix.strength / (1 + distance / 8) ** 2;
      }
      [companion] = yarns.filter(color => color !== first).sort((a, b) =>
        scores[b] - scores[a] || usage[b] - usage[a] ||
        Math.abs(brightness[b] - brightness[first]) - Math.abs(brightness[a] - brightness[first])
      );
    }
    companions.fill(companion, start, end);
    start = end;
  }
  return companions;
}

export function addGrain(p, amount) {
  if (!amount || p.palette.length < 2) return p;
  const palettes = rows(p);
  const pixels = p.pixels.slice();
  const companions = grainCompanions(p, palettes);
  const intensity = amount / 100;
  for (let y = 0; y < p.height; y++) {
    const [first, existing] = palettes[y];
    const second = existing ?? companions[y];
    const start = y * WIDTH;
    for (let x = 0; x < WIDTH; x++) {
      if (stitchNoise(x + WIDTH, y) < intensity) {
        pixels[start + x] = pixels[start + x] === first ? second : first;
      }
    }
  }
  return { ...p, pixels };
}

function scatteredCatches(start, length, limit, row, penalties) {
  const scores = new Float64Array(length).fill(Infinity);
  const previous = new Int16Array(length);
  let bestEnd = 0;
  for (let x = 1; x < length - 1; x++) {
    let score = x <= limit ? 0 : Infinity;
    for (let before = Math.max(1, x - limit - 1); before <= x - 2; before++) {
      if (scores[before] < score) {
        score = scores[before];
        previous[x] = before;
      }
    }
    // Each catch has a cost. An extra stitch can break up a column if it
    // saves enough repetition across the preceding rows.
    scores[x] = score + 1.65 + stitchNoise(start + x, row) * .7 + penalties[start + x];
    if (length - 1 - x <= limit && (!bestEnd || scores[x] < scores[bestEnd])) bestEnd = x;
  }
  const catches = [];
  for (let x = bestEnd; x; x = previous[x]) catches.push(start + x);
  return catches.reverse();
}

export function addFloatStitches(p, limit) {
  const report = findFloats(p, limit);
  const stitches = new Map();
  let added = 0;
  if (!report.count) return { visible: p, stitches, added };
  const pixels = p.pixels.slice();
  for (const [y, spans] of report.byRow) {
    const offset = y * WIDTH;
    const line = p.pixels.subarray(offset, offset + WIDTH);
    const colors = [...new Set(line)];
    const changes = [];
    function catchStitch(x, color) {
      if (line[x] === color) return;
      pixels[offset + x] = color;
      changes.push(x);
    }
    if (limit === 1) {
      // Alternation is the only two-color pattern with no run longer than one stitch.
      let matches = 0;
      for (let x = 0; x < WIDTH; x++) if (line[x] === colors[x % 2]) matches++;
      if (matches < WIDTH / 2) colors.reverse();
      for (let x = 0; x < WIDTH; x++) catchStitch(x, colors[x % 2]);
    } else {
      const penalties = new Float32Array(WIDTH);
      for (const [distance, weight] of [[1, 2.2], [2, 1.3], [3, .65]]) {
        for (const x of stitches.get(y - distance) ?? []) {
          penalties[x] += weight;
          if (x > 0) penalties[x - 1] += weight * .28;
          if (x < WIDTH - 1) penalties[x + 1] += weight * .28;
        }
      }
      for (const { start, length, color } of spans) {
        const other = colors.find(value => value !== color);
        for (const x of scatteredCatches(start, length, limit, y, penalties)) catchStitch(x, other);
      }
    }
    stitches.set(y, changes);
    added += changes.length;
  }
  return { visible: { ...p, pixels }, stitches, added };
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
  const lastText = p.layers.findLastIndex(layer => layer.type === 'text');
  const layers = lastText < 0 ? [] : prepareLayers({ ...p, layers: p.layers.slice(0, lastText + 1) });
  for (const [y, line] of byRow) {
    const start = y * WIDTH;
    if (!line.some((value, x) => value !== p.pixels[start + x])) continue;
    const textRejected = new Set();
    if (layers.length) objectRow(layers, line, y, textRejected);
    if (new Set(line).size > 2 || textRejected.size) rejected.push(y);
    else {
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

export function* fill(p, x, y, color, pattern = 'solid') {
  if (!inRange(x, 0, WIDTH - 1) || !inRange(y, 0, p.height - 1)) return;
  const origin = y * WIDTH + x, target = p.pixels[origin];
  if (target === color) return;
  const mask = FILL_PATTERNS[pattern]?.mask ?? FILL_PATTERNS.solid.mask;
  const tileWidth = mask[0].length, tileHeight = mask.length;
  const offsetX = tileWidth - x % tileWidth, offsetY = tileHeight - y % tileHeight;
  const queue = [origin], visited = new Uint8Array(p.pixels.length);
  visited[origin] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor], px = i % WIDTH, py = Math.floor(i / WIDTH);
    if (mask[(py + offsetY) % tileHeight][(px + offsetX) % tileWidth] === '1') {
      yield [px, py, color];
    }
    const candidates = [i - WIDTH, i + WIDTH];
    if (px) candidates.push(i - 1);
    if (px + 1 < WIDTH) candidates.push(i + 1);
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

function luma(data, i) {
  return .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
}

export function orderYarnsByTone(duo, palette) {
  return duo.slice().sort((a, b) => luma(rgb(palette[a].hex), 0) - luma(rgb(palette[b].hex), 0));
}

function sourceToneThreshold(source) {
  const cached = imageSources.get(source);
  if (cached.threshold !== undefined) return cached.threshold;
  let darkest = 255, lightest = 0;
  const { original } = cached;
  for (let i = 0; i < original.length; i += 4) {
    if (original[i + 3] < 128) continue;
    const value = luma(original, i);
    darkest = Math.min(darkest, value);
    lightest = Math.max(lightest, value);
  }
  return cached.threshold = lightest > darkest ? (darkest + lightest) / 2 : 127.5;
}

function yarnDistance([r, g, b], [red, green, blue]) {
  return 2 * (r - red) ** 2 + 4 * (g - green) ** 2 + (b - blue) ** 2;
}

function fitToneRow(base, image, left, sy, colors, duo, threshold) {
  const fixed = new Set(), dark = [], light = [];
  for (let x = 0; x < WIDTH; x++) {
    const sx = x - left;
    const i = (sy * image.width + sx) * 4;
    if (sx < 0 || sx >= image.width || image.data[i + 3] < 128) fixed.add(base[x]);
    else (luma(image.data, i) < threshold ? dark : light).push(x);
  }
  if ((!dark.length && !light.length) || fixed.size > 2) return { line: base, adapted: false };
  const compatible = (a, b) => {
    const used = new Set(fixed);
    if (dark.length) used.add(a);
    if (light.length) used.add(b);
    return used.size <= 2;
  };
  let [a, b] = duo;
  if (!compatible(a, b)) {
    const candidates = [...new Set([...fixed, ...duo])];
    let best = Infinity;
    for (const first of candidates) for (const second of candidates) {
      if ((first === second) !== (duo[0] === duo[1]) || !compatible(first, second)) continue;
      const loss = yarnDistance(colors[duo[0]], colors[first]) + yarnDistance(colors[duo[1]], colors[second]);
      if (loss < best) { best = loss; a = first; b = second; }
    }
  }
  const line = base.slice();
  for (const x of dark) line[x] = a;
  for (const x of light) line[x] = b;
  return { line, adapted: (dark.length > 0 && a !== duo[0]) || (light.length > 0 && b !== duo[1]) };
}

// Keep untouched stitches and fit the image to the pair with the lowest
// weighted RGB error on this row.
function fitImageRow(base, image, left, sy, colors, allowed) {
  const fixed = new Set();
  const samples = [];
  for (let x = 0; x < WIDTH; x++) {
    const sx = x - left;
    const offset = (sy * image.width + sx) * 4;
    if (sx < 0 || sx >= image.width || image.data[offset + 3] < 128) {
      fixed.add(base[x]);
      continue;
    }
    const d = colors.map(([r, g, b]) =>
      2 * (r - image.data[offset]) ** 2 + 4 * (g - image.data[offset + 1]) ** 2 + (b - image.data[offset + 2]) ** 2);
    samples.push([x, d]);
  }
  if (!samples.length || fixed.size > 2) return { line: base, adapted: false };
  const candidates = [...new Set([...fixed, ...allowed])];
  const fixedColors = [...fixed];
  let best, loss = Infinity;
  for (let i = 0; i < candidates.length; i++) for (let j = i; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j];
    if (fixedColors.some(c => c !== a && c !== b)) continue;
    let error = 0;
    for (const [, d] of samples) error += Math.min(d[a], d[b]);
    if (error < loss) { loss = error; best = [a, b]; }
  }
  if (!best) return { line: base, adapted: false };
  const [a, b] = best;
  const line = base.slice();
  for (const [x, d] of samples) line[x] = d[a] <= d[b] ? a : b;
  return { line, adapted: fixed.size > 0 && best.some(c => !allowed.includes(c)) };
}

export function placeImage(p, image, left, top, allowed = p.palette.map((_, i) => i)) {
  const colors = p.palette.map(c => rgb(c.hex));
  const edits = [];
  let adapted = 0;
  for (let sy = 0; sy < image.height; sy++) {
    const y = sy + top;
    if (y < 0 || y >= p.height) continue;
    const base = p.pixels.subarray(y * WIDTH, (y + 1) * WIDTH);
    const result = fitImageRow(base, image, left, sy, colors, allowed);
    if (result.adapted) adapted++;
    for (let x = 0; x < WIDTH; x++) if (result.line[x] !== base[x]) edits.push([x, y, result.line[x]]);
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
