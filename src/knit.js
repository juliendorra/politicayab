import { WIDTH, rgb } from './design.js';

const STEP = 8;

function tile(hex, stepY, finish, variant) {
  const canvas = document.createElement('canvas');
  canvas.width = STEP; canvas.height = stepY;
  const ctx = canvas.getContext('2d');
  const color = rgb(hex);
  const shift = (variant - 2) * (finish === 'brillant' ? 9 : 5);
  const tone = (factor, offset = 0) => `rgb(${color.map(v => Math.min(255, Math.max(0, Math.round(v * factor + offset + shift)))).join(' ')})`;
  ctx.scale(STEP / 8, stepY / 8);
  ctx.fillStyle = tone(.52);
  ctx.fillRect(0, 0, 8, 8);
  ctx.lineCap = 'round';
  function strand(x, ctrl, end, shadow, light) {
    const path = new Path2D(`M${x} -1 Q${ctrl} 3.8 ${end} 7.6`);
    ctx.strokeStyle = tone(.35);
    ctx.lineWidth = 3.6;
    ctx.stroke(path);
    const gradient = ctx.createLinearGradient(x - 1, 0, x + 2, 6);
    gradient.addColorStop(0, tone(shadow, 8));
    gradient.addColorStop(.40, tone(light, 15));
    gradient.addColorStop(.72, tone(1.03, 7));
    gradient.addColorStop(1, tone(.71));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.4;
    ctx.stroke(path);
  }
  strand(6.7, 6.4, 3.8, .62, 1.16);
  strand(1.35, 1.2, 4.1, .70, 1.25);
  ctx.globalAlpha = finish === 'brillant' ? .52 : .19;
  ctx.lineWidth = finish === 'brillant' ? .65 : .34;
  ctx.strokeStyle = tone(1.24, 62);
  const offset = (variant % 3) * .46;
  ctx.stroke(new Path2D(`M1.2 ${.2 + offset} Q1.4 3.7 3.1 ${5.8 - offset}`));
  if (variant === 1 || variant === 4) ctx.stroke(new Path2D('M6.1 1.6 L5.8 3.3'));
  return canvas;
}

export function renderKnit(canvas, design, ratio, finish) {
  const stepY = Math.round(STEP * ratio);
  canvas.width = WIDTH * STEP;
  canvas.height = design.height * stepY;
  const ctx = canvas.getContext('2d', { alpha: false });
  const swatches = design.palette.map(c => Array.from({ length: 5 }, (_, i) => tile(c.hex, stepY, finish, i)));
  let noise = 849;
  for (let y = 0, i = 0; y < design.height; y++) {
    for (let x = 0; x < WIDTH; x++, i++) {
      noise = (noise * 1664525 + 1013904223) >>> 0;
      ctx.drawImage(swatches[design.pixels[i]][(noise >>> 16) % 5], x * STEP, y * stepY);
    }
  }
}
