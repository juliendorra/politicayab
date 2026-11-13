import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { ayabPng } from '../src/ayab-png.js';
import { WIDTH, design } from '../src/design.js';

test('the AYAB export is a full-size 1-bit PNG that preserves contrast in each two-yarn row', async () => {
  const p = design(4);
  p.pixels[0] = p.pixels[WIDTH - 1] = 1;
  p.pixels.fill(1, WIDTH, 2 * WIDTH);
  p.pixels[WIDTH + 7] = p.pixels[WIDTH + 8] = 2;
  p.pixels.fill(1, 2 * WIDTH, 3 * WIDTH);

  const blob = await ayabPng(p);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map();
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    chunks.set(type, bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const header = chunks.get('IHDR');
  assert.equal(header.readUInt32BE(0), WIDTH);
  assert.equal(header.readUInt32BE(4), 4);
  assert.deepEqual([...header.subarray(8)], [1, 3, 0, 0, 0]);
  assert.deepEqual([...chunks.get('PLTE')], [0, 0, 0, 255, 255, 255]);
  assert.equal(chunks.has('tRNS'), false);

  const pixels = inflateSync(chunks.get('IDAT'));
  const stride = 1 + Math.ceil(WIDTH / 8);
  const whiteAt = (x, y) => Boolean(pixels[y * stride + 1 + (x >> 3)] & (0x80 >> (x & 7)));
  for (let x = 0; x < WIDTH; x++) {
    assert.equal(whiteAt(x, 0), x !== 0 && x !== WIDTH - 1);
    assert.equal(whiteAt(x, 1), x === 7 || x === 8);
    assert.equal(whiteAt(x, 2), false);
    assert.equal(whiteAt(x, 3), true);
  }
});
