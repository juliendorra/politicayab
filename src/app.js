import {
  WIDTH, MAX_HEIGHT, MAX_COLORS, clone, design, resize, rows, validate, parse,
  serialize, paint, stroke, fill, placeImage, pixelRGBA,
} from './design.js';
import { sample, textMask, stamp } from './art.js';
import { renderKnit } from './knit.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'politicayab-project-1';
const pixel = $('pixels'), knit = $('knit'), overlay = $('overlay'), stage = $('stage');
const context = pixel.getContext('2d', { alpha: false });
const guide = overlay.getContext('2d');
let project;
try { project = parse(localStorage.getItem(STORAGE_KEY)); } catch { project = sample(); }
let selected = Math.min(1, project.palette.length - 1);
let tool = 'pencil', brush = 1, mode = 'pixel', zoom = 1, grid = false;
let row = Math.min(23, project.height - 1), rowInfo = [];
let hover = null, keyboard = { x: 90, y: row }, pinned = false;
let drag = null, placement = null, image = null, imageSequence = 0, editColor = null;
let knitDirty = true, toastTimer, saveTimer;
const undo = [], redo = [];

function announce(message, warning = false) {
  const el = $('toast');
  el.textContent = message;
  el.dataset.type = warning ? 'warning' : 'notice';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, warning ? 5500 : 3000);
}

function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 180);
}
function persist() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, serialize(project)); } catch {}
}
window.addEventListener('pagehide', persist);

function track(previous) {
  undo.push(previous);
  if (undo.length > 45) undo.shift();
  redo.length = 0;
  historyButtons();
  autosave();
}

function swap(next) {
  const previous = project;
  project = next;
  track(previous);
  renderAll();
}

function stepHistory(from, to) {
  if (!from.length || drag) return;
  cancelPlacement();
  to.push(project);
  project = from.pop();
  autosave();
  renderAll();
}

function historyButtons() {
  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function swatch(hex) {
  const el = document.createElement('span');
  el.className = 'swatch';
  el.style.setProperty('--swatch', hex);
  return el;
}

function showPalette() {
  const list = project.palette.map(({ name, hex }, i) => {
    const item = document.createElement('div');
    item.className = 'color-item';
    const choose = document.createElement('button');
    choose.className = 'color-choose';
    choose.setAttribute('aria-pressed', i === selected);
    choose.title = hex + (i === 0 ? ' — fond de la gomme' : '');
    const label = document.createElement('span');
    label.className = 'color-name';
    label.textContent = name;
    choose.append(swatch(hex), label);
    choose.onclick = () => {
      selected = i;
      updateSelected();
      if (tool === 'eraser' || tool === 'dropper') useTool('pencil');
    };
    const edit = document.createElement('button');
    edit.className = 'icon-button color-edit';
    edit.title = 'Modifier ' + name;
    edit.setAttribute('aria-label', edit.title);
    edit.append(icon('more'));
    edit.onclick = () => openColor(i);
    item.append(choose, edit);
    return item;
  });
  $('palette').replaceChildren(...list);
  $('add-color').disabled = list.length >= MAX_COLORS;
}

function updateSelected() {
  document.querySelectorAll('.color-choose').forEach((button, i) => button.setAttribute('aria-pressed', i === selected));
}

function layout() {
  const ratio = mode === 'knit' ? Number($('ratio').value) / 100 : 1;
  const aspect = project.height * ratio / WIDTH;
  const pad = stage.clientWidth < 600 ? 74 : 94;
  const fit = Math.max(1, Math.min(stage.clientWidth - pad, (stage.clientHeight - 66) / aspect, 520));
  const w = Math.max(1, Math.round(fit * zoom));
  const h = Math.max(1, Math.round(fit * zoom * aspect));
  $('poster').style.setProperty('--poster-w', w + 'px');
  $('poster').style.setProperty('--poster-h', h + 'px');
  if (mode === 'pixel') {
    overlay.width = Math.min(2400, w);
    overlay.height = Math.min(2400, h);
    drawGuide();
  }
  $('zoom-reset').textContent = Math.round(zoom * 100) + ' %';
  $('zoom-out').disabled = zoom <= .5;
  $('zoom-in').disabled = zoom >= 6;
}

function setZoom(value) {
  const cx = (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth;
  const cy = (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight;
  zoom = Math.min(6, Math.max(.5, value));
  layout();
  stage.scrollTo(cx * stage.scrollWidth - stage.clientWidth / 2, cy * stage.scrollHeight - stage.clientHeight / 2);
}

function drawPixels() {
  if (pixel.width !== WIDTH || pixel.height !== project.height) {
    pixel.width = WIDTH;
    pixel.height = project.height;
  }
  context.putImageData(new ImageData(pixelRGBA(project), WIDTH, project.height), 0, 0);
  knitDirty = true;
  if (mode === 'knit') drawKnit();
}

function drawKnit() {
  if (!knitDirty) return;
  knitDirty = false;
  renderKnit(knit, project, Number($('ratio').value) / 100, $('finish').value);
}

function renderAll() {
  selected = Math.min(selected, project.palette.length - 1);
  row = Math.min(project.height - 1, row);
  keyboard.y = Math.min(project.height - 1, keyboard.y);
  $('height').value = project.height;
  $('row-number').max = project.height;
  $('height-label').textContent = project.height + (project.height === 1 ? ' RANGÉE' : ' RANGÉES');
  $('project-name').value = project.name;
  showPalette();
  drawPixels();
  updateRows();
  historyButtons();
  layout();
}

function updateRows() {
  rowInfo = rows(project);
  const validCount = rowInfo.filter(line => line.length <= 2).length;
  $('valid-count').textContent = validCount + ' rangée' + (validCount === 1 ? '' : 's') + ' sur ' + project.height;
  $('valid-title').textContent = validCount === project.height ? 'Affiche conforme' : 'Rangées à corriger';
  const map = $('row-map');
  map.width = WIDTH; map.height = project.height;
  const ctx = map.getContext('2d');
  for (let y = 0; y < project.height; y++) {
    const line = rowInfo[y];
    let offset = 0;
    for (const id of line) {
      const n = project.pixels.subarray(y * WIDTH, (y + 1) * WIDTH).reduce((count, v) => count + (v === id), 0);
      ctx.fillStyle = project.palette[id].hex;
      ctx.fillRect(offset, y, n, 1);
      offset += n;
    }
  }
  inspect(row);
}

function inspect(y) {
  if (!rowInfo[y]) return;
  row = y;
  const line = rowInfo[y];
  $('row-number').value = y + 1;
  $('row-count').textContent = line.length + ' / 2 fils';
  $('replace-row').hidden = project.palette.length <= 1;
  $('row-colors').replaceChildren(...line.map(i => {
    const chip = document.createElement('span');
    chip.className = 'row-chip';
    chip.append(swatch(project.palette[i].hex), document.createTextNode(project.palette[i].name));
    return chip;
  }));
}

function position(box, point) {
  return {
    x: Math.max(0, Math.min(WIDTH - box.width, point.x - Math.floor(box.width / 2))),
    y: Math.max(0, Math.min(project.height - box.height, point.y - Math.floor(box.height / 2))),
  };
}

function drawGuide() {
  const w = overlay.width, h = overlay.height;
  guide.clearRect(0, 0, w, h);
  if (mode !== 'pixel') return;
  const sx = w / WIDTH, sy = h / project.height;
  if (grid && sx >= 3 && sy >= 3) {
    guide.strokeStyle = '#fff9e347';
    guide.lineWidth = .7;
    guide.beginPath();
    for (let x = 1; x < WIDTH; x++) { guide.moveTo(x * sx, 0); guide.lineTo(x * sx, h); }
    for (let y = 1; y < project.height; y++) { guide.moveTo(0, y * sy); guide.lineTo(w, y * sy); }
    guide.stroke();
  }
  if (hover && placement) {
    const pos = position(placement, hover);
    guide.imageSmoothingEnabled = false;
    guide.globalAlpha = .72;
    guide.drawImage(placement.preview, pos.x * sx, pos.y * sy, placement.width * sx, placement.height * sy);
    guide.globalAlpha = 1;
    guide.strokeStyle = '#e5fa71';
    guide.setLineDash([4, 3]);
    guide.strokeRect(pos.x * sx + .5, pos.y * sy + .5, placement.width * sx - 1, placement.height * sy - 1);
    guide.setLineDash([]);
    return;
  }
  if (hover || pinned) {
    const y = (hover?.y ?? row) * sy;
    const current = rowInfo[hover?.y ?? row];
    const color = tool === 'eraser' ? 0 : selected;
    const warning = hover && tool !== 'dropper' && current?.length === 2 && !current.includes(color);
    guide.fillStyle = warning ? '#ff502b7d' : '#e1fc6b5c';
    guide.fillRect(0, y, w, Math.max(1, sy));
    if (hover) {
      guide.strokeStyle = warning ? '#ffab91' : '#f2ffb0';
      const size = ['pencil', 'eraser'].includes(tool) ? brush : 1;
      const lo = Math.floor((size - 1) / 2);
      guide.strokeRect((hover.x - lo) * sx, (hover.y - lo) * sy, Math.max(1, sx * size), Math.max(1, sy * size));
    }
  }
}

function setMode(next) {
  if (next === 'knit') cancelPlacement();
  mode = next;
  stage.dataset.view = mode;
  const isKnit = mode === 'knit';
  $('pixel-mode').setAttribute('aria-pressed', !isKnit);
  $('knit-mode').setAttribute('aria-pressed', isKnit);
  $('preview-prompt').hidden = isKnit;
  $('knit-controls').hidden = !isKnit;
  pixel.hidden = overlay.hidden = isKnit;
  knit.hidden = !isKnit;
  $('grid').disabled = isKnit;
  if (isKnit) drawKnit();
  layout();
}

function useTool(next) {
  cancelPlacement();
  if (mode === 'knit') setMode('pixel');
  tool = next;
  document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed', button.dataset.tool === tool));
  drawGuide();
}

function cancelPlacement() {
  placement = null;
  $('placement').hidden = true;
  drawGuide();
}

function startPlacement(next, label) {
  setMode('pixel');
  placement = next;
  $('placement-label').textContent = label;
  $('placement').hidden = false;
  pixel.focus({ preventScroll: true });
  drawGuide();
}

function reportRejected(rejected) {
  if (!rejected.length) return;
  const sampleRows = [...rejected].sort((a, b) => a - b).slice(0, 3).map(y => y + 1).join(', ');
  announce((rejected.length === 1 ? 'Rangée ' : 'Rangées ') + sampleRows +
    (rejected.length > 3 ? '…' : '') + ' : une troisième couleur serait nécessaire. Choisissez un fil présent ou remplacez-en un.', true);
}

function usePlacement(point) {
  const pos = position(placement, point);
  const before = clone(project);
  const result = placement.type === 'text'
    ? paint(project, stamp(placement.mask, pos.x, pos.y, placement.color))
    : placeImage(project, placement.data, pos.x, pos.y, placement.allowed);
  const type = placement.type;
  if (result.changed) {
    track(before);
    drawPixels();
    updateRows();
    cancelPlacement();
  }
  if (result.rejected.length) reportRejected(result.rejected);
  else if (result.changed && type === 'image') {
    announce(result.adapted ? 'Image placée. Des fils déjà présents ont été conservés.' : 'Image convertie et placée.');
  } else if (!result.changed) announce('Aucune maille modifiée.');
  drawGuide();
}

function moveCursor(point) {
  hover = point;
  keyboard = point;
  $('coords').textContent = (point.x + 1) + ' , ' + (point.y + 1);
  if (row !== point.y) inspect(point.y);
  drawGuide();
}

function pointFor(event) {
  const rect = pixel.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(WIDTH - 1, Math.floor((event.clientX - rect.left) / rect.width * WIDTH))),
    y: Math.max(0, Math.min(project.height - 1, Math.floor((event.clientY - rect.top) / rect.height * project.height))),
  };
}

function drawStroke(from, to) {
  const result = paint(project, stroke(from.x, from.y, to.x, to.y, brush, tool === 'eraser' ? 0 : selected));
  for (const y of result.rejected) drag.rejected.add(y);
  if (result.changed) {
    drag.changed = true;
    drawPixels();
    updateRows();
  }
  drawGuide();
}

function applyTool(point) {
  if (placement) { usePlacement(point); return; }
  if (tool === 'dropper') {
    selected = project.pixels[point.y * WIDTH + point.x];
    updateSelected();
    announce('Fil sélectionné : ' + project.palette[selected].name);
    return;
  }
  if (tool === 'fill') {
    const before = clone(project);
    const result = paint(project, fill(project, point.x, point.y, selected));
    if (result.changed) {
      track(before);
      drawPixels();
      updateRows();
    }
    reportRejected(result.rejected);
    drawGuide();
    return;
  }
  drag = { before: clone(project), last: point, rejected: new Set(), changed: false };
  drawStroke(point, point);
}

function endStroke() {
  if (!drag) return;
  if (drag.changed) track(drag.before);
  reportRejected([...drag.rejected]);
  drag = null;
}

pixel.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  pixel.focus({ preventScroll: true });
  const point = pointFor(event);
  pinned = false;
  moveCursor(point);
  applyTool(point);
  if (drag) pixel.setPointerCapture(event.pointerId);
});
pixel.addEventListener('pointermove', event => {
  if (!event.isPrimary) return;
  const point = pointFor(event);
  moveCursor(point);
  if (drag) { drawStroke(drag.last, point); drag.last = point; }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) pixel.addEventListener(name, endStroke);
pixel.addEventListener('pointerleave', () => {
  if (!drag) { hover = null; $('coords').textContent = '— , —'; drawGuide(); }
});
pixel.addEventListener('blur', () => { hover = null; drawGuide(); });
pixel.addEventListener('keydown', event => {
  const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (event.key in deltas) {
    event.preventDefault();
    const [dx, dy] = deltas[event.key], step = event.shiftKey ? 10 : 1;
    moveCursor({ x: Math.max(0, Math.min(WIDTH - 1, keyboard.x + dx * step)), y: Math.max(0, Math.min(project.height - 1, keyboard.y + dy * step)) });
  } else if (event.code === 'Space') {
    event.preventDefault();
    moveCursor(keyboard);
    applyTool(keyboard);
    endStroke();
  }
});

function selectRow(y) {
  pinned = true;
  inspect(y);
  drawGuide();
  if (mode === 'pixel' && stage.scrollHeight > stage.clientHeight) {
    const center = $('stage-inner').offsetHeight / 2 + 5;
    stage.scrollTop = center + (y / project.height - .5) * $('poster').offsetHeight - stage.clientHeight / 2;
  }
}
$('row-map').addEventListener('pointerdown', event => {
  const rect = $('row-map').getBoundingClientRect();
  selectRow(Math.max(0, Math.min(project.height - 1, Math.floor((event.clientY - rect.top) / rect.height * project.height))));
});
$('row-number').onchange = event => {
  const value = event.target.valueAsNumber;
  selectRow(Number.isInteger(value) ? Math.max(0, Math.min(project.height - 1, value - 1)) : row);
};

function options(el, indices, choice) {
  el.replaceChildren(...indices.map(i => new Option(project.palette[i].name, i, false, i === choice)));
}
function paletteIndices() { return project.palette.map((_, i) => i); }

$('replace-row').onclick = () => {
  options($('row-old'), rowInfo[row], rowInfo[row][1] ?? rowInfo[row][0]);
  options($('row-new'), paletteIndices(), selected);
  $('row-dialog-label').textContent = 'Rangée ' + (row + 1) + ' : toutes les mailles du fil choisi seront remplacées.';
  $('row-dialog').showModal();
};
$('row-form').onsubmit = event => {
  event.preventDefault();
  const from = Number($('row-old').value), to = Number($('row-new').value);
  const next = clone(project);
  const edits = Array.from({ length: WIDTH }, (_, x) => [x, row, project.pixels[row * WIDTH + x]])
    .filter(edit => edit[2] === from).map(([x, y]) => [x, y, to]);
  if (paint(next, edits).changed) swap(next);
  $('row-dialog').close();
};

function openColor(index) {
  editColor = index;
  const current = project.palette[index] ?? { name: 'Fil ' + (project.palette.length + 1), hex: '#6796a6' };
  $('color-title').textContent = index === null ? 'Ajouter un fil' : 'Modifier le fil';
  $('color-name').value = current.name;
  $('color-hex').value = $('color-picker').value = current.hex;
  $('color-hex').setCustomValidity('');
  $('color-dialog').showModal();
}
$('add-color').onclick = () => openColor(null);
$('color-picker').oninput = () => {
  $('color-hex').value = $('color-picker').value;
  $('color-hex').setCustomValidity('');
};
$('color-hex').oninput = event => {
  const hex = event.target.value;
  event.target.setCustomValidity('');
  if (/^#[0-9a-f]{6}$/i.test(hex)) $('color-picker').value = hex;
};
$('color-form').onsubmit = event => {
  event.preventDefault();
  const next = clone(project), i = editColor ?? next.palette.length;
  const hex = $('color-hex').value.toLowerCase();
  if (next.palette.some((c, j) => j !== i && c.hex === hex)) {
    $('color-hex').setCustomValidity('Cette couleur existe déjà dans la palette.');
    $('color-hex').reportValidity();
    return;
  }
  next.palette[i] = { name: $('color-name').value.trim() || 'Fil ' + (i + 1), hex };
  selected = i;
  cancelPlacement();
  swap(next);
  $('color-dialog').close();
};

$('text-tool').onclick = () => { cancelPlacement(); $('text-dialog').showModal(); };
$('text-form').onsubmit = event => {
  event.preventDefault();
  const text = $('text-value').value.trim();
  if (!text) return;
  const width = $('text-width').valueAsNumber, height = $('text-height').valueAsNumber;
  const mask = textMask(text, width, height, $('font').value);
  const preview = document.createElement('canvas');
  preview.width = width; preview.height = height;
  const ctx = preview.getContext('2d');
  ctx.fillStyle = project.palette[selected].hex;
  for (const [x, y] of stamp(mask, 0, 0, selected)) ctx.fillRect(x, y, 1, 1);
  $('text-dialog').close();
  startPlacement({ type: 'text', mask, preview, width, height, color: selected }, 'Cliquez sur l’affiche pour placer le texte.');
};

function imageDimensions() {
  if (!image) return;
  const replace = $('image-target').value === 'replace';
  const width = replace ? WIDTH : Math.min(WIDTH, image.naturalWidth);
  $('image-width').value = width;
  $('image-height').value = Math.min(MAX_HEIGHT, Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth)));
}

function updateImageForm() {
  const replace = $('image-target').value === 'replace';
  $('image-width').readOnly = replace;
  $('apply-image').textContent = replace ? 'Remplacer l’affiche' : 'Placer l’image';
  $('apply-image').disabled = !image;
  $('image-duo').hidden = $('image-color-mode').value !== 'duo';
}
function openImage() {
  cancelPlacement();
  options($('image-first'), paletteIndices(), 0);
  options($('image-second'), paletteIndices(), Math.min(2, project.palette.length - 1));
  updateImageForm();
  if (!$('image-dialog').open) $('image-dialog').showModal();
}

async function receiveImage(file) {
  if (!file) return;
  const sequence = ++imageSequence;
  image = null;
  openImage();
  $('file-label').textContent = 'Chargement…';
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (sequence !== imageSequence) return;
    image = img;
    $('file-label').textContent = (file.name || 'Image collée') + ' · ' + img.naturalWidth + ' × ' + img.naturalHeight;
    imageDimensions();
  } catch {
    if (sequence === imageSequence) $('file-label').textContent = 'Image illisible. Essayez un fichier PNG ou JPEG.';
  } finally {
    URL.revokeObjectURL(url);
    if (sequence === imageSequence) updateImageForm();
  }
}
$('image-tool').onclick = openImage;
$('choose-image').onclick = () => $('image-file').click();
$('image-file').onchange = event => {
  receiveImage(event.target.files[0]);
  event.target.value = '';
};
$('image-target').onchange = () => { imageDimensions(); updateImageForm(); };
$('image-color-mode').onchange = updateImageForm;
$('image-width').onchange = event => {
  if (image && event.target.validity.valid) {
    $('image-height').value = Math.max(1, Math.min(MAX_HEIGHT, Math.round(event.target.valueAsNumber * image.naturalHeight / image.naturalWidth)));
  }
};

document.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))?.getAsFile();
  if (!file || (document.querySelector('dialog[open]') && !$('image-dialog').open)) return;
  event.preventDefault();
  receiveImage(file);
});
for (const target of [stage, $('choose-image')]) {
  target.addEventListener('dragover', event => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      target.classList.add('dragging');
    }
  });
  target.addEventListener('dragleave', () => target.classList.remove('dragging'));
  target.addEventListener('drop', event => {
    event.preventDefault();
    target.classList.remove('dragging');
    if (document.querySelector('dialog[open]') && !$('image-dialog').open) return;
    const file = [...event.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (file) receiveImage(file);
    else announce('Déposez un fichier image.', true);
  });
}
$('image-form').onsubmit = event => {
  event.preventDefault();
  if (!image) return;
  const replace = $('image-target').value === 'replace';
  const width = replace ? WIDTH : $('image-width').valueAsNumber;
  const height = $('image-height').valueAsNumber;
  const preview = document.createElement('canvas');
  preview.width = width; preview.height = height;
  const ctx = preview.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  const allowed = $('image-color-mode').value === 'duo' ? [Number($('image-first').value), Number($('image-second').value)] : paletteIndices();
  $('image-dialog').close();
  if (replace) {
    const next = design(height, project.palette, project.name);
    next.pixels.fill(allowed[0]);
    placeImage(next, data, 0, 0, allowed);
    swap(next);
    setMode('pixel');
    announce('Image convertie en affiche de 180 mailles.');
  } else {
    startPlacement({ type: 'image', preview, data, allowed, width, height }, 'Cliquez sur l’affiche pour placer l’image.');
  }
};

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename() {
  return project.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'affiche';
}
$('export').onclick = () => {
  if (!validate(project)) { announce('Corrigez les rangées avant l’export.', true); return; }
  const name = filename() + '-180x' + project.height + '.png';
  pixel.toBlob(blob => {
    if (blob) { saveFile(blob, name); announce('PNG exporté : ' + name); }
    else announce('Impossible de générer le PNG.', true);
  }, 'image/png');
};
function closeMenu() { document.querySelector('.project-menu').open = false; }
$('save-project').onclick = () => {
  closeMenu();
  saveFile(new Blob([serialize(project)], { type: 'application/json' }), filename() + '.politicayab.json');
};
$('open-project').onclick = () => { closeMenu(); $('project-file').click(); };
$('project-file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2_500_000) throw new Error('Ce fichier est trop volumineux pour être un projet.');
    const next = parse(await file.text());
    cancelPlacement();
    swap(next);
    setZoom(1);
    announce('Projet ouvert.');
  } catch (error) { announce(error.message || 'Projet illisible.', true); }
};
$('new-project').onclick = () => { closeMenu(); $('new-dialog').showModal(); };
$('new-form').onsubmit = event => {
  event.preventDefault();
  $('new-dialog').close();
  cancelPlacement();
  swap(design($('new-height').valueAsNumber, undefined, $('new-name').value.trim() || 'Sans titre'));
  setMode('pixel'); setZoom(1);
};
$('load-sample').onclick = () => {
  closeMenu(); cancelPlacement(); swap(sample()); setMode('pixel'); setZoom(1);
};
$('project-name').onchange = event => {
  const name = event.target.value.trim() || 'Sans titre';
  if (name !== project.name) {
    const before = clone(project);
    project.name = name;
    track(before);
  }
  event.target.value = name;
};
$('height').onchange = event => {
  const height = event.target.valueAsNumber;
  if (!Number.isInteger(height) || height < 1 || height > MAX_HEIGHT) {
    event.target.value = project.height;
    announce('Choisissez une hauteur entre 1 et ' + MAX_HEIGHT + ' rangées.', true);
  } else if (height !== project.height) {
    cancelPlacement();
    swap(resize(project, height));
    if (height < undo.at(-1).height) announce('Affiche recadrée en hauteur. Vous pouvez annuler.');
  }
};
for (const btn of document.querySelectorAll('[data-tool]')) btn.onclick = () => useTool(btn.dataset.tool);
for (const btn of document.querySelectorAll('.close-dialog')) btn.onclick = () => btn.closest('dialog').close();
$('undo').onclick = () => stepHistory(undo, redo);
$('redo').onclick = () => stepHistory(redo, undo);
$('pixel-mode').onclick = () => setMode('pixel');
$('knit-mode').onclick = $('show-knit').onclick = () => setMode('knit');
$('cancel-placement').onclick = cancelPlacement;
$('grid').onclick = () => {
  grid = !grid;
  $('grid').setAttribute('aria-pressed', grid);
  drawGuide();
  if (grid && overlay.width / WIDTH < 3) announce('Zoomez pour afficher la grille des mailles.');
};
$('zoom-out').onclick = () => setZoom(zoom / 1.3);
$('zoom-in').onclick = () => setZoom(zoom * 1.3);
$('zoom-reset').onclick = () => setZoom(1);
$('brush').oninput = event => { brush = event.target.valueAsNumber; $('brush-size').value = brush + ' px'; drawGuide(); };
$('ratio').oninput = () => {
  $('ratio-label').value = (Number($('ratio').value) / 100).toFixed(2).replace('.', ',') + '×';
  knitDirty = true;
  drawKnit();
  layout();
};
$('finish').onchange = () => { knitDirty = true; drawKnit(); };
document.addEventListener('pointerdown', event => { if (!event.target.closest('.project-menu')) closeMenu(); });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { cancelPlacement(); closeMenu(); return; }
  if (event.target.matches('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
    event.preventDefault();
    if (event.shiftKey || key === 'y') stepHistory(redo, undo);
    else stepHistory(undo, redo);
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    const shortcuts = { b: 'pencil', e: 'eraser', g: 'fill', i: 'dropper' };
    if (key in shortcuts) useTool(shortcuts[key]);
    if (key === 't') $('text-tool').click();
  }
});
new ResizeObserver(layout).observe(stage);
renderAll();
