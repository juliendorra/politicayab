import { WIDTH, orderYarnsByTone, rows } from './design.js';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value;
});

function chunk(type, data = new Uint8Array()) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  }
  view.setUint32(bytes.length - 4, crc ^ 0xffffffff);
  return bytes;
}

export async function ayabPng(design) {
  const rowYarns = rows(design);
  const used = [...new Set(rowYarns.flat())];
  const tones = orderYarnsByTone(used, design.palette);
  const background = used.includes(0) ? 0 : tones.at(-1);
  const rank = new Map(tones.map((yarn, i) => [yarn, i]));
  const stride = 1 + Math.ceil(WIDTH / 8);
  const scanlines = new Uint8Array(stride * design.height);
  for (const [y, [first, second]] of rowYarns.entries()) {
    // Keep the background white. Other pairs use their lighter yarn as white.
    const white = second === undefined || first === background || second === background
      ? background
      : rank.get(first) > rank.get(second) ? first : second;
    for (let x = 0; x < WIDTH; x++) {
      if (design.pixels[y * WIDTH + x] === white) {
        scanlines[y * stride + 1 + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, WIDTH);
  view.setUint32(4, design.height);
  header[8] = 1; // One bit per palette index.
  header[9] = 3; // Indexed color.
  const stream = new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return new Blob([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    chunk('PLTE', Uint8Array.of(0, 0, 0, 255, 255, 255)),
    chunk('IDAT', compressed),
    chunk('IEND'),
  ], { type: 'image/png' });
}
