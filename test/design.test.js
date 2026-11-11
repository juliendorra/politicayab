import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WIDTH, design, resize, rows, validate, parse, serialize, paint, fill, placeImage, pixelRGBA, stroke,
} from '../src/design.js';

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
