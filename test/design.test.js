import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  WIDTH, design, resize, rows, validate, parse, serialize, paint, fill, placeImage, pixelRGBA, stroke,
  compose, packTextMask, packImageSource, findFloats, addFloatStitches, addGrain,
  resizeImageCorner, removeYarn,
} from '../src/design.js';
import { colorNameMatcher, colorSuggestions } from '../src/color-names.js';

test('strokes reject a third yarn only on the affected rows', () => {
  const p = design(3);
  paint(p, [[1, 0, 1], [2, 2, 3]]);
  const result = paint(p, stroke(4, 0, 4, 2, 1, 2));
  assert.deepEqual(result, { changed: true, rejected: [0, 2] });
  assert.deepEqual(rows(p), [[0, 1], [0, 2], [0, 3]]);
  assert.ok(validate(p));
});

test('a complete replacement is validated against the final row', () => {
  const p = design(1);
  paint(p, [[1, 0, 1], [2, 0, 1]]);
  assert.equal(paint(p, [[1, 0, 2], [2, 0, 2]]).changed, true);
  assert.deepEqual(rows(p), [[0, 2]]);
});

test('fill does not wrap across the right and left edges', () => {
  const p = design(2);
  p.pixels.fill(1);
  p.pixels[WIDTH - 1] = p.pixels[WIDTH] = 0;
  assert.deepEqual([...fill(p, WIDTH - 1, 0, 2)], [[WIDTH - 1, 0, 2]]);
});

test('a patterned fill starts at the clicked stitch and crosses gaps in the pattern within the same region', () => {
  const p = design(3);
  p.pixels.fill(1);
  for (let y = 0; y < p.height; y++) {
    p.pixels.fill(0, y * WIDTH, y * WIDTH + 3);
    p.pixels[y * WIDTH + 4] = 0;
  }
  const result = paint(p, fill(p, 1, 1, 1, 'checker'));
  assert.deepEqual(result, { changed: true, rejected: [] });
  assert.deepEqual([...p.pixels.slice(0, 5)], [1, 0, 1, 1, 0]);
  assert.deepEqual([...p.pixels.slice(WIDTH, WIDTH + 5)], [0, 1, 0, 1, 0]);
  assert.deepEqual([...p.pixels.slice(2 * WIDTH, 2 * WIDTH + 5)], [1, 0, 1, 1, 0]);
});

test('patterned fill skips rows where it would introduce a third yarn', () => {
  const p = design(3);
  p.pixels[WIDTH + 6] = 1;
  const before = p.pixels.slice(WIDTH, 2 * WIDTH);
  const result = paint(p, fill(p, 0, 0, 2, 'checker'));
  assert.deepEqual(result, { changed: true, rejected: [1] });
  assert.deepEqual(p.pixels.slice(WIDTH, 2 * WIDTH), before);
  assert.deepEqual(rows(p), [[0, 2], [0, 1], [0, 2]]);
});

test('image placement retains transparent and untouched stitches and respects saturated rows', () => {
  const p = design(3);
  paint(p, [[0, 0, 1]]);
  const row = [238, 224, 189, 255, 236, 71, 52, 255, 184, 202, 97, 0];
  const image = { width: 3, height: 2, data: new Uint8ClampedArray([...row, ...row]) };
  const result = placeImage(p, image, 10, 0, [0, 2]);
  assert.deepEqual(result, { changed: true, rejected: [], adapted: 1 });
  assert.deepEqual(rows(p), [[0, 1], [0, 2], [0]]);
  assert.equal(p.pixels[0], 1);
  assert.equal(p.pixels[12], 0);
});

test('a full-width import can use a different color pair on each row', () => {
  const p = design(2);
  const data = new Uint8ClampedArray(WIDTH * 2 * 4);
  for (let x = 0; x < WIDTH; x++) {
    data.set(x % 2 ? [236, 71, 52, 255] : [30, 32, 34, 255], x * 4);
    data.set(x % 2 ? [238, 224, 189, 255] : [184, 202, 97, 255], (WIDTH + x) * 4);
  }
  placeImage(p, { width: WIDTH, height: 2, data }, 0, 0);
  assert.deepEqual(rows(p), [[0, 1], [2, 3]]);
  assert.ok(validate(p));
});

test('resize, persistence, and export pixels preserve the exact stitch colors', () => {
  const p = design(2);
  paint(p, [[0, 0, 1], [0, 1, 2]]);
  const grown = resize(p, 4);
  assert.equal(grown.pixels.length, 4 * WIDTH);
  assert.equal(grown.pixels[WIDTH], 2);
  assert.equal(grown.pixels[2 * WIDTH], 0);
  assert.deepEqual(parse(serialize(grown)), grown);
  assert.deepEqual([...pixelRGBA(grown).slice(0, 8)], [236, 71, 52, 255, 30, 32, 34, 255]);
  const corrupt = JSON.parse(serialize(grown));
  corrupt.pixels[1] = 2;
  assert.throws(() => parse(JSON.stringify(corrupt)), /deux couleurs/);
  corrupt.width = 181;
  assert.throws(() => parse(JSON.stringify(corrupt)), /Format/);
});

test('editable text survives project round trips and reserves its yarn while drawing', () => {
  const p = design(3);
  const data = new Uint8ClampedArray(2 * 2 * 4);
  data[3] = data[15] = 255;
  p.layers.push({
    type: 'text', text: 'T', font: 'tiny5', width: 2, height: 2, x: 5, y: 1, color: 2,
    mask: packTextMask({ width: 2, height: 2, data }),
  });
  assert.deepEqual(paint(p, [[0, 1, 1], [0, 0, 1]]), { changed: true, rejected: [1] });
  p.checkFloats = true;
  p.floatLimit = 7;
  const reopened = parse(serialize(p));
  assert.equal(reopened.checkFloats, true);
  assert.equal(reopened.floatLimit, 7);
  const visible = compose(reopened).visible;
  assert.equal(visible.pixels[WIDTH + 5], 2);
  assert.equal(visible.pixels[2 * WIDTH + 6], 2);
  assert.equal(p.pixels[WIDTH + 5], 0);
  assert.ok(validate(visible));

  const old = JSON.parse(serialize(p));
  old.version = 2;
  old.textLayers = old.layers;
  delete old.layers;
  assert.deepEqual(parse(JSON.stringify(old)).layers, p.layers);
  old.version = 1;
  delete old.textLayers;
  delete old.checkFloats;
  delete old.floatLimit;
  assert.deepEqual(parse(JSON.stringify(old)).layers, []);
});

test('images reopen as editable objects with original pixels, dimensions and yarn choices', () => {
  const p = design(4);
  const data = Uint8Array.from([238,224,189,255, 30,32,34,255, 30,32,34,255, 238,224,189,0]);
  p.layers.push({
    type: 'image', name: 'Motif', source: packImageSource({ width: 2, height: 2, data }),
    width: 2, height: 2, x: 2, y: 1, duo: [0, 2], aspectRatio: 1, orderedDuo: false,
  });
  p.noiseAmount = 6;
  const saved = parse(serialize(p));
  assert.deepEqual(saved, p);
  const { visible } = compose(saved);
  assert.equal(visible.pixels[WIDTH + 2], 2);
  assert.equal(visible.pixels[2 * WIDTH + 3], 0);
  saved.layers[0] = { ...saved.layers[0], x: 4, width: 4, duo: [0, 3] };
  const changed = compose(saved).visible;
  assert.deepEqual([...changed.pixels.subarray(WIDTH + 2, WIDTH + 8)], [0, 0, 3, 3, 0, 0]);
  assert.equal(saved.pixels.every(color => color === 0), true);
  const legacy = JSON.parse(serialize(p));
  delete legacy.layers[0].aspectRatio;
  delete legacy.layers[0].orderedDuo;
  assert.deepEqual(parse(JSON.stringify(legacy)).layers, p.layers);
  saved.layers[0].aspectRatio = null;
  assert.equal(parse(serialize(saved)).layers[0].aspectRatio, null);
});

test('removing a yarn remaps drawn stitches, text, image yarns, and grain in the saved project', () => {
  const p = design(3);
  const data = new Uint8ClampedArray([236, 71, 52, 255]);
  const bounds = { x: 1, width: 1, height: 1 };
  p.pixels[0] = 1;
  p.pixels[2 * WIDTH] = 3;
  p.grainYarn = 1;
  p.layers.push(
    { type: 'text', text: 'T', font: 'tiny5', ...bounds, y: 0, color: 1, mask: packTextMask({ ...bounds, data }) },
    {
      type: 'image', name: 'Motif', ...bounds, y: 1, duo: [1, 2], aspectRatio: 1, orderedDuo: true,
      source: packImageSource({ ...bounds, data }),
    },
  );
  const next = parse(serialize(removeYarn(p, 1, 2)));
  assert.deepEqual(next.palette.map(yarn => yarn.name), ['Encre', 'Écru', 'Lichen']);
  assert.deepEqual(rows(next), [[0, 1], [0], [0, 2]]);
  assert.deepEqual(rows(compose(next).visible), [[0, 1], [0, 1], [0, 2]]);
  assert.equal(next.layers[0].color, 1);
  assert.deepEqual(next.layers[1].duo, [1, 1]);
  assert.equal(next.grainYarn, 1);
  assert.equal(p.palette.length, 4);
  assert.deepEqual(p.layers[1].duo, [1, 2]);
});

test('removing the background promotes its replacement and the last yarn is required', () => {
  const p = design(1);
  p.pixels[1] = 1;
  const next = removeYarn(p, 0, 2);
  assert.deepEqual(next.palette.map(yarn => yarn.name), ['Écru', 'Vermillon', 'Lichen']);
  assert.deepEqual([...resize(next, 2).pixels.slice(WIDTH)], Array(WIDTH).fill(0));
  assert.deepEqual([...next.pixels.slice(0, 3)], [0, 1, 0]);
  const single = design(1, [next.palette[0]]);
  assert.throws(() => removeYarn(single, 0, 0), /autre fil/);
});

test('locked corners preserve the ratio and opposite corner at poster edges', () => {
  const image = { x: 40, y: 10, width: 60, height: 30, aspectRatio: 2 };
  assert.deepEqual(resizeImageCorner(image, [1, 1], 30, 15, 120), { x: 40, y: 10, width: 90, height: 45 });
  assert.deepEqual(resizeImageCorner(image, [-1, -1], -80, -40, 120), { x: 20, y: 0, width: 80, height: 40 });
  const resized = resizeImageCorner(image, [1, 1], 400, 400, 120);
  assert.deepEqual(resized, { x: 40, y: 10, width: 140, height: 70 });
});

test('inverting an ordered image duo changes dark and light pixels and respects the row palette', () => {
  const p = design(2);
  const data = Uint8Array.from([15,15,15,255, 220,220,220,255, 15,15,15,255, 220,220,220,255]);
  p.layers.push({
    type: 'image', name: 'Contraste', source: packImageSource({ width: 2, height: 2, data }),
    x: 0, y: 0, width: 2, height: 2, aspectRatio: 1, duo: [0, 2], orderedDuo: true,
  });
  assert.deepEqual([...compose(p).visible.pixels.subarray(0, 3)], [0, 2, 0]);
  p.layers[0] = { ...p.layers[0], duo: [2, 0] };
  assert.deepEqual([...compose(p).visible.pixels.subarray(0, 3)], [2, 0, 0]);
  p.pixels[3] = 1;
  const { visible, adapted } = compose(p);
  assert.ok(validate(visible));
  assert.equal(visible.pixels[3], 1);
  assert.equal(adapted.get(p.layers[0]), 1);
});

test('automatic catches enforce any selected limit and leave the original grid intact', () => {
  const p = design(4);
  p.pixels.fill(2, WIDTH + 40, WIDTH + 43);
  p.pixels.fill(2, 2 * WIDTH + 2, 2 * WIDTH + 4);
  p.pixels.fill(2, 2 * WIDTH + 99, 2 * WIDTH + 122);
  p.pixels.fill(1, 3 * WIDTH, 3 * WIDTH + 29);
  const original = p.pixels.slice();
  for (let limit = 1; limit <= WIDTH; limit++) {
    const { visible, stitches } = addFloatStitches(p, limit);
    assert.equal(findFloats(visible, limit).count, 0, 'limit ' + limit);
    assert.deepEqual(rows(visible), rows(p));
    assert.equal(stitches.has(0), false);
    assert.deepEqual(p.pixels, original);
  }
});

test('staggered catches avoid repeated columns on broad runs and the grain covers solid rows', () => {
  const p = design(64);
  for (let y = 0; y < p.height; y++) p.pixels[y * WIDTH + 3] = 1;
  const { visible, stitches } = addFloatStitches(p, 12);
  let repeated = 0, count = 0;
  for (const [row, columns] of stitches) {
    const above = new Set(stitches.get(row - 1));
    repeated += columns.filter(x => above.has(x)).length;
    count += columns.length;
  }
  assert.ok(repeated / count < .08);
  assert.equal(findFloats(visible, 12).count, 0);
  assert.deepEqual(addFloatStitches(p, 12).visible.pixels, visible.pixels);
  const blank = design(10);
  const noisy = addGrain(blank, 12);
  assert.ok(rows(noisy).every(row => row.length === 2));
  assert.ok(blank.pixels.every(color => color === 0));
  assert.deepEqual(addGrain(blank, 12).pixels, noisy.pixels);
});

test('grain keeps existing row pairs and uses the local companion or the chosen yarn on solid rows', () => {
  const p = design(6);
  const [, red, cream, ground] = p.palette.keys();
  p.pixels.fill(ground);
  p.pixels[WIDTH + 20] = red;
  p.pixels.fill(cream, 3 * WIDTH, 3 * WIDTH + 35);
  p.pixels.fill(cream, 4 * WIDTH, 4 * WIDTH + 35);
  const automatic = addGrain(p, 30);
  assert.deepEqual(rows(automatic), [
    [cream, ground], [red, ground], [cream, ground],
    [cream, ground], [cream, ground], [cream, ground],
  ]);

  const explicit = parse(serialize({ ...p, grainYarn: 0 }));
  const chosen = addGrain(explicit, 30);
  assert.deepEqual(rows(chosen), [
    [0, ground], [red, ground], [0, ground],
    [cream, ground], [cream, ground], [0, ground],
  ]);
  assert.deepEqual(addGrain({ ...p, grainYarn: ground }, 30).pixels, automatic.pixels);
  const { visible } = addFloatStitches(chosen, 12);
  assert.deepEqual(rows(visible), rows(chosen));
  assert.equal(findFloats(visible, 12).count, 0);
  assert.equal(parse(serialize({ ...p, grainYarn: undefined })).grainYarn, null);
});

test('auto grain follows both edges of a solid band despite a distant majority and nearby specks', () => {
  const p = design(112);
  const [, red, cream, ground] = p.palette.keys();
  p.pixels.fill(ground);
  const mix = (row, color, count) => p.pixels.fill(color, row * WIDTH, row * WIDTH + count);
  for (let row = 0; row < 46; row++) {
    if (row < 10 || row >= 15) mix(row, red, 60);
  }
  for (const row of [89, 90, 99, 100]) mix(row, cream, 50);
  for (const row of [91, 98]) mix(row, red, 1);

  const grained = rows(addGrain(p, 30));
  assert.deepEqual(grained.slice(10, 15), Array.from({ length: 5 }, () => [red, ground]));
  assert.deepEqual(grained.slice(92, 98), Array.from({ length: 6 }, () => [cream, ground]));
  assert.deepEqual(grained[91], [red, ground]);
  assert.deepEqual(grained[98], [red, ground]);
});

test('the full name table matches exact colors and compares shades without favoring names containing wool', () => {
  const data = readFileSync(new URL('../src/data/color-names.tsv', import.meta.url), 'utf8');
  assert.equal(data.trimEnd().split('\n').length, 32004);
  const nearest = colorNameMatcher(data);
  assert.equal(nearest('#ffffff'), 'White');
  const names = colorNameMatcher('#fcfbfa\tOff White\n#fdfcfb\tWhite Wool\n#ff0000\tRed');
  assert.equal(names('#fcfbfa'), 'Off White');
  assert.equal(names('#fbfaf9'), 'Off White');
  assert.equal(names('#fa0302'), 'Red');
});

test('color suggestions prefer a close real yarn and fall back to the closest general color name', () => {
  const yarns = '#1c1b1b\tBlack\tDROPS\tKarisma';
  const lookup = colorSuggestions('#1d1c1c\tInk\n#ff0000\tRed', yarns);
  assert.deepEqual(lookup('#1d1c1c'), {
    name: 'Black',
    yarn: { hex: '#1c1b1b', name: 'Black', brand: 'DROPS', range: 'Karisma' },
  });
  assert.deepEqual(lookup('#ff0000'), { name: 'Red', yarn: undefined });
  assert.deepEqual(colorSuggestions('#ff0000\tRed')('#ff0000'), { name: 'Red', yarn: undefined });
});
