import { rgb } from './design.js';

const YARN_MATCH_LIMIT = 0.025;
const linear = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

// Björn Ottosson's linear sRGB to Oklab transform.
function oklab(hex) {
  const [r, g, b] = rgb(hex).map(channel => linear[channel]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function nearestColor(source, limit = Infinity) {
  const entries = source.trimEnd().split('\n').map(line => {
    const [hex, name, brand, range] = line.split('\t');
    const [l, a, b] = oklab(hex);
    return { l, a, b, swatch: { hex, name, brand, range } };
  });

  return hex => {
    const [l, a, b] = oklab(hex);
    let closest;
    let nearest = limit ** 2;
    for (const entry of entries) {
      const distance = (l - entry.l) ** 2 + (a - entry.a) ** 2 + (b - entry.b) ** 2;
      if (distance === 0) return entry.swatch;
      if (distance <= nearest && (!closest || distance < nearest)) {
        nearest = distance;
        closest = entry.swatch;
      }
    }
    return closest;
  };
}

export function colorNameMatcher(source) {
  const closest = nearestColor(source);
  return hex => closest(hex)?.name;
}

export function colorSuggestions(names, yarns) {
  const findName = names ? colorNameMatcher(names) : undefined;
  const findYarn = yarns ? nearestColor(yarns, YARN_MATCH_LIMIT) : undefined;
  return hex => {
    const yarn = findYarn?.(hex);
    return { name: yarn?.name ?? findName?.(hex), yarn };
  };
}

async function loadSwatches(file) {
  const response = await fetch(new URL(file, import.meta.url));
  if (!response.ok) throw new Error('Nuancier indisponible.');
  return response.text();
}

export async function loadColorSuggestions() {
  const [names, yarns] = await Promise.allSettled([
    loadSwatches('./data/color-names.tsv'),
    loadSwatches('./data/yarn-swatches.tsv'),
  ]);
  return colorSuggestions(
    names.status === 'fulfilled' ? names.value : undefined,
    yarns.status === 'fulfilled' ? yarns.value : undefined,
  );
}
