import { design, paint, WIDTH } from './design.js';

export const FONTS = {
  affiche: '900 90px Impact, "Arial Black", sans-serif',
  bloc: '900 90px "Arial Black", system-ui, sans-serif',
  machine: 'bold 90px "Courier New", monospace',
  journal: 'bold 90px Georgia, serif',
};

export function textMask(text, width, height, face = 'affiche') {
  const lines = text.trim().split('\n').slice(0, 12);
  const source = document.createElement('canvas');
  const output = document.createElement('canvas');
  output.width = width; output.height = height;
  const dest = output.getContext('2d', { willReadFrequently: true });
  const src = source.getContext('2d');
  const band = height / lines.length;
  const gap = lines.length > 1 ? Math.max(1, Math.round(band * .13)) : 0;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    src.font = FONTS[face] ?? FONTS.affiche;
    const m = src.measureText(line);
    source.width = Math.max(1, Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + 4));
    source.height = Math.max(1, Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 4));
    src.font = FONTS[face] ?? FONTS.affiche;
    src.fillText(line, m.actualBoundingBoxLeft + 2, m.actualBoundingBoxAscent + 2);
    const y = Math.floor(i * band);
    dest.drawImage(source, 0, y, width, Math.max(1, Math.floor((i + 1) * band) - y - gap));
  }
  return dest.getImageData(0, 0, width, height);
}

export function* stamp(mask, left, top, color) {
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (mask.data[(y * mask.width + x) * 4 + 3] >= 128) yield [left + x, top + y, color];
  }
}

export function sample() {
  const p = design(204, undefined, 'On tisse la lutte');
  const red = document.createElement('canvas');
  red.width = WIDTH; red.height = 76;
  const rc = red.getContext('2d', { willReadFrequently: true });
  rc.fillRect(5, 6, 170, 66);
  rc.globalCompositeOperation = 'destination-out';
  rc.drawImage(asCanvas(textMask('ON TISSE', 153, 25)), 13, 12);
  rc.drawImage(asCanvas(textMask('LA LUTTE', 153, 29)), 13, 37);
  let random = 232;
  function jitter(n) { random = (random * 1664525 + 1013904223) >>> 0; return random % n; }
  for (let i = 0; i < 420; i++) rc.fillRect(5 + jitter(170), 6 + jitter(66), 1 + (i % 17 === 0), 1);
  paint(p, stamp(rc.getImageData(0, 0, WIDTH, 76), 0, 0, 1));

  const cream = document.createElement('canvas');
  cream.width = WIDTH; cream.height = 128;
  const c = cream.getContext('2d', { willReadFrequently: true });
  c.fillRect(5, 0, 170, 2);
  c.fillRect(5, 2, 1, 118);
  c.fillRect(174, 2, 1, 118);
  c.fillRect(5, 120, 170, 2);
  c.save();
  c.translate(40, 0);
  c.fill(new Path2D('M29 102 L36 80 L29 73 L23 61 L22 51 L17 46 L16 35 L18 25 L22 21 L30 20 L34 11 L44 9 L53 12 L57 6 L66 6 L73 11 L77 9 L86 12 L91 21 L99 24 L102 36 L99 49 L103 62 L98 74 L86 84 L79 102 Z'));
  c.globalCompositeOperation = 'destination-out';
  c.fill(new Path2D('M29 26 L33 29 L33 40 L42 44 L55 43 L69 37 L75 39 L79 45 L77 51 L63 59 L55 69 L53 81 L49 72 L52 62 L57 56 L68 50 L73 46 L72 43 L67 43 L55 49 L41 49 L32 46 L26 40 Z'));
  c.fill(new Path2D('M43 13 L46 14 L46 25 L50 36 L45 39 L40 31 L39 20 Z M59 11 L62 13 L63 23 L67 32 L62 35 L56 26 L55 18 Z M76 14 L80 16 L80 23 L84 33 L80 37 L74 30 L72 21 Z M90 24 L94 27 L94 37 L87 45 L85 41 L89 35 Z M88 57 L93 56 L95 61 L91 69 L78 76 L69 94 L64 96 L70 78 L81 70 Z M39 79 L45 84 L38 101 L34 101 Z'));
  c.fill(new Path2D('M40 93 L42 87 L46 83 L46 89 L41 102 L39 102 Z M48 93 L51 90 L50 97 L48 102 L45 102 Z M57 92 L59 90 L58 99 L56 102 L53 102 Z M66 83 L67 80 L70 80 L69 83 Z M87 50 L93 46 L94 49 L87 53 Z M30 52 L32 53 L34 61 L30 57 Z M41 56 L49 55 L47 58 L42 59 Z'));
  c.restore();
  for (const [x, y, s] of [[27,24,8],[148,35,10],[26,76,5],[151,77,5],[113,22,3],[40,37,3]]) {
    c.fill(new Path2D(`M${x} ${y-s} l2 ${s-2} ${s-2} 2 -${s-2} 2 -2 ${s-2} -2 -${s-2} -${s-2} -2 ${s-2} -2Z`));
  }
  for (let i = 0; i < 120; i++) {
    const x = 10 + jitter(160), y = 4 + jitter(96);
    if (x > 62 && x < 144 && i % 3 === 0) continue;
    c.fillRect(x, y, 1, 1);
  }
  c.fillRect(12, 103, 156, 1);
  c.drawImage(asCanvas(textMask('MAILLE APRÈS MAILLE', 145, 10, 'machine')), 17, 107);
  paint(p, stamp(c.getImageData(0, 0, WIDTH, 128), 0, 76, 2));
  return p;
}

function asCanvas(mask) {
  const canvas = document.createElement('canvas');
  canvas.width = mask.width; canvas.height = mask.height;
  canvas.getContext('2d').putImageData(mask, 0, 0);
  return canvas;
}
