import {
  WIDTH, MAX_HEIGHT, MAX_COLORS, MAX_COLOR_NAME_LENGTH, MAX_LAYERS, MAX_PROJECT_BYTES, clone, design,
  resize, rows, validate, parse, serialize, paint, stroke, fill, FILL_PATTERNS, removeYarn,
  pixelRGBA, compose, packTextMask, packImageSource, addFloatStitches, addGrain,
  proportionalImageSize, resizeImageCorner, orderYarnsByTone,
} from './design.js';
import { FONTS, sample, textMask, upgradeSample } from './art.js';
import { KNIT_RATIO, renderKnit } from './knit.js';
import { ayabPng } from './ayab-png.js';
import { loadColorSuggestions } from './color-names.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'politicayab-project-1';
const FALLBACK_KEY = STORAGE_KEY + '-fallback';
const pixel = $('pixels'), knit = $('knit'), overlay = $('overlay'), stage = $('stage');
const context = pixel.getContext('2d', { alpha: false });
const guide = overlay.getContext('2d');
const autosaveDatabase = await openAutosave().catch(() => null);
let project;
try {
  const saved = await readAutosave().catch(() => null);
  project = upgradeSample(parse(readLocal(FALLBACK_KEY) ?? saved ?? readLocal(STORAGE_KEY)));
} catch {
  project = sample();
}
let selected = Math.min(1, project.palette.length - 1);
let tool = 'pencil', brush = 1, mode = 'pixel', zoom = 1, grid = false;
let fillPattern = 'solid';
let row = Math.min(23, project.height - 1), rowInfo = [];
let hover = null, keyboard = { x: 90, y: row }, pinned = false;
let drag = null, imageSequence = 0, replaceWithImage = false, editColor = null;
let objectEdit = null, objectConflicts = new Set(), adaptedImages = new Map();
let visibleDesign = project, floatStitches = new Map(), objectDragFrame;
let draggedLayer = null, layerScrollFrame, suppressLayerClick = false;
let imageYarnSlot = null;
const imageYarnLabels = { 'image-first': 'Tons foncés', 'image-second': 'Tons clairs' };
let colorMatcher, colorNamesRequest, yarnSuggestion, manualColorName = false;
let knitDirty = true, toastTimer, saveSequence = 0;
const undo = [], redo = [];

function announce(message, warning = false) {
  const el = $('toast');
  el.textContent = message;
  el.dataset.type = warning ? 'warning' : 'notice';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, warning ? 5500 : 3000);
}

function openAutosave() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('politicayab', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = reject;
  });
}

function readAutosave() {
  if (!autosaveDatabase) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = autosaveDatabase.transaction('projects').objectStore('projects').get('last');
    request.onsuccess = () => resolve(request.result);
    request.onerror = reject;
  });
}

function readLocal(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function autosave() {
  const source = serialize(project);
  const sequence = ++saveSequence;
  function saveFallback() {
    if (sequence !== saveSequence) return;
    try { localStorage.setItem(FALLBACK_KEY, source); }
    catch { announce('Sauvegarde automatique indisponible. Enregistrez le projet depuis le menu Projet.', true); }
  }
  if (!autosaveDatabase) { saveFallback(); return; }
  // Keep a small checkpoint until the asynchronous write finishes, even during a reload.
  if (source.length < 1_000_000) {
    try { localStorage.setItem(FALLBACK_KEY, source); } catch {}
  }
  const checkpoint = readLocal(FALLBACK_KEY);
  try {
    const tx = autosaveDatabase.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(source, 'last');
    tx.onabort = saveFallback;
    tx.oncomplete = () => {
      if (checkpoint && sequence === saveSequence && readLocal(FALLBACK_KEY) === checkpoint) {
        try { localStorage.removeItem(FALLBACK_KEY); } catch {}
      }
    };
  } catch { saveFallback(); }
}
window.addEventListener('pagehide', commitObject);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') commitObject();
});

function track(previous) {
  undo.push(previous);
  if (undo.length > 45) undo.shift();
  redo.length = 0;
  historyButtons();
  autosave();
}

function swap(next) {
  const previous = project;
  project = next.pixels === previous.pixels ? { ...next, pixels: next.pixels.slice() } : next;
  track(previous);
  renderAll();
}

function stepHistory(from, to) {
  if (drag) return;
  if (objectEdit) {
    const valid = commitObject();
    closeObject();
    if (!valid) { refreshArtwork(); return; }
  }
  if (!from.length) { refreshArtwork(); return; }
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
    choose.title = name + ' · ' + hex + (i === 0 ? ' — fond de la gomme' : '');
    const label = document.createElement('span');
    label.className = 'color-name';
    label.textContent = name;
    choose.append(swatch(hex), label);
    choose.onclick = () => {
      selected = i;
      updateSelected();
      if (objectEdit) {
        if (objectEdit.layer.type === 'text') $('text-color').value = i;
        else {
          $('image-color-mode').value = 'duo';
          $('image-first').value = i;
        }
        updateObjectDraft(undefined, undefined, objectEdit.layer.type === 'image');
        return;
      }
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
  const ratio = mode === 'knit' ? KNIT_RATIO : 1;
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
  const draftProject = objectEdit ? withObjectDraft() : project;
  const { visible, rejected, adapted } = compose(draftProject);
  const grained = addGrain(visible, Number($('noise-amount').value));
  const adjusted = project.checkFloats ? addFloatStitches(grained, project.floatLimit) : null;
  visibleDesign = adjusted?.visible ?? grained;
  objectConflicts = rejected;
  adaptedImages = adapted;
  floatStitches = adjusted?.stitches ?? new Map();
  const count = adjusted?.added ?? 0, rowCount = floatStitches.size;
  $('float-count').textContent = count
    ? count + ' points d’accroche sur ' + rowCount + ' rangée' + (rowCount === 1 ? '' : 's')
    : 'Aucun point d’accroche nécessaire.';
  $('next-float-row').hidden = !count;
  context.putImageData(new ImageData(pixelRGBA(visibleDesign), WIDTH, project.height), 0, 0);
  updateObjectFeedback();
  knitDirty = true;
  if (mode === 'knit') drawKnit();
}

function drawKnit() {
  if (!knitDirty) return;
  knitDirty = false;
  renderKnit(knit, visibleDesign, $('finish').value);
}

function renderAll() {
  selected = Math.min(selected, project.palette.length - 1);
  row = Math.min(project.height - 1, row);
  keyboard.y = Math.min(project.height - 1, keyboard.y);
  $('height').value = project.height;
  $('check-floats').checked = project.checkFloats;
  $('float-limit').value = project.floatLimit;
  $('noise-amount').value = project.noiseAmount;
  $('noise-value').value = project.noiseAmount + ' %';
  $('noise-amount').disabled = project.palette.length < 2;
  const grainYarn = $('grain-yarn');
  options(grainYarn, paletteIndices(), project.grainYarn);
  grainYarn.prepend(new Option('Automatique', '', false, project.grainYarn === null));
  grainYarn.disabled = project.palette.length < 2;
  $('float-controls').hidden = !project.checkFloats;
  $('row-number').max = project.height;
  $('height-label').textContent = project.height + (project.height === 1 ? ' RANGÉE' : ' RANGÉES');
  $('project-name').value = project.name;
  showPalette();
  showLayers();
  drawPixels();
  updateRows();
  historyButtons();
  layout();
}

function updateRows() {
  rowInfo = rows(visibleDesign);
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
      const n = visibleDesign.pixels.subarray(y * WIDTH, (y + 1) * WIDTH).reduce((count, v) => count + (v === id), 0);
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

function positionInProject(box, point, height) {
  return {
    x: Math.max(0, Math.min(WIDTH - box.width, point.x - Math.floor(box.width / 2))),
    y: Math.max(0, Math.min(height - box.height, point.y - Math.floor(box.height / 2))),
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
  if (objectEdit) {
    const { x, y, width, height } = objectEdit.layer;
    guide.strokeStyle = objectConflicts.size ? '#ff7956' : '#e5fa71';
    guide.lineWidth = 1.5;
    guide.strokeRect(x * sx + .5, y * sy + .5, Math.max(1, width * sx - 1), Math.max(1, height * sy - 1));
    guide.fillStyle = '#ff502b85';
    for (const y of objectConflicts) guide.fillRect(0, y * sy, w, Math.max(1, sy));
    guide.fillStyle = '#e5fa71';
    guide.strokeStyle = '#272921';
    for (const cornerX of [x, x + width]) for (const cornerY of [y, y + height]) {
      const left = Math.max(0, Math.min(w - 8, cornerX * sx - 4));
      const top = Math.max(0, Math.min(h - 8, cornerY * sy - 4));
      guide.fillRect(left, top, 8, 8);
      guide.strokeRect(left + .5, top + .5, 7, 7);
    }
    return;
  }
  if (tool === 'select' && !pinned) return;
  if (hover || pinned) {
    const cursorRow = hover?.y ?? row;
    const y = cursorRow * sy;
    const current = rowInfo[cursorRow];
    const color = tool === 'eraser' ? 0 : selected;
    const warning = hover && tool !== 'dropper' && current?.length === 2 && !current.includes(color);
    guide.fillStyle = warning ? '#ff502b7d' : '#e1fc6b5c';
    guide.fillRect(0, y, w, Math.max(1, sy));
    guide.fillStyle = '#ddf84fbc';
    for (const x of floatStitches.get(cursorRow) ?? []) {
      guide.fillRect(x * sx, y, Math.max(1, sx), Math.max(1, sy));
    }
    if (hover) {
      guide.strokeStyle = warning ? '#ffab91' : '#f2ffb0';
      const size = ['pencil', 'eraser'].includes(tool) ? brush : 1;
      const lo = Math.floor((size - 1) / 2);
      guide.strokeRect((hover.x - lo) * sx, (hover.y - lo) * sy, Math.max(1, sx * size), Math.max(1, sy * size));
    }
  }
}

function setMode(next) {
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

function selectTool(next) {
  tool = next;
  pixel.toggleAttribute('data-selecting', next === 'select');
  document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed', button.dataset.tool === tool));
  $('brush-settings').hidden = next !== 'pencil' && next !== 'eraser';
  $('fill-settings').hidden = next !== 'fill';
}

function useTool(next) {
  if (!finishObjectEdit()) return;
  if (mode === 'knit') setMode('pixel');
  selectTool(next);
  drawGuide();
}

function reportRejected(rejected) {
  if (!rejected.length) return;
  const sampleRows = [...rejected].sort((a, b) => a - b).slice(0, 3).map(y => y + 1).join(', ');
  announce((rejected.length === 1 ? 'Rangée ' : 'Rangées ') + sampleRows +
    (rejected.length > 3 ? '…' : '') + ' : une troisième couleur serait nécessaire. Choisissez un fil présent ou remplacez-en un.', true);
}

function moveCursor(point) {
  hover = point;
  keyboard = point;
  $('coords').textContent = (point.x + 1) + ' , ' + (point.y + 1);
  if (row !== point.y) inspect(point.y);
  drawGuide();
}

function pointFor(event, clamp = true) {
  const rect = pixel.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * WIDTH);
  const y = Math.floor((event.clientY - rect.top) / rect.height * project.height);
  if (!clamp) return { x, y };
  return { x: Math.max(0, Math.min(WIDTH - 1, x)), y: Math.max(0, Math.min(project.height - 1, y)) };
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
  if (tool === 'dropper') {
    selected = visibleDesign.pixels[point.y * WIDTH + point.x];
    updateSelected();
    announce('Fil sélectionné : ' + project.palette[selected].name);
    return;
  }
  if (tool === 'fill') {
    const before = clone(project);
    const result = paint(project, fill(project, point.x, point.y, selected, fillPattern));
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

function containsPoint(layer, point) {
  return point.x >= layer.x && point.x < layer.x + layer.width &&
    point.y >= layer.y && point.y < layer.y + layer.height;
}

function objectCorner(point) {
  if (!objectEdit) return null;
  const { x, y, width, height } = objectEdit.layer;
  const rect = pixel.getBoundingClientRect();
  const left = Math.abs(point.x - x), right = Math.abs(point.x - x - width);
  const top = Math.abs(point.y - y), bottom = Math.abs(point.y - y - height);
  if (Math.min(left, right) * rect.width / WIDTH > 8 ||
      Math.min(top, bottom) * rect.height / project.height > 8) return null;
  return [left <= right ? -1 : 1, top <= bottom ? -1 : 1];
}

function selectAt(point) {
  const index = project.layers.findLastIndex(layer => containsPoint(layer, point));
  if (index >= 0) return openObject(index);
  finishObjectEdit();
  return false;
}

pixel.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  pixel.focus({ preventScroll: true });
  const point = pointFor(event);
  pinned = false;
  moveCursor(point);
  if (tool === 'select') {
    const origin = pointFor(event, false);
    const corner = objectCorner(origin);
    if (!corner && (!objectEdit || !containsPoint(objectEdit.layer, point)) && !selectAt(point)) return;
    objectEdit.drag = { origin, layer: objectEdit.layer, corner, point: null };
    pixel.setPointerCapture(event.pointerId);
    return;
  }
  applyTool(point);
  if (drag) pixel.setPointerCapture(event.pointerId);
});
pixel.addEventListener('pointermove', event => {
  if (!event.isPrimary) return;
  const point = pointFor(event);
  moveCursor(point);
  if (objectEdit?.drag) {
    objectEdit.drag.point = pointFor(event, false);
    if (!objectDragFrame) {
      objectDragFrame = requestAnimationFrame(() => {
        objectDragFrame = 0;
        if (objectEdit?.drag?.point) moveObject(objectEdit.drag.point, objectEdit.drag);
      });
    }
  } else if (objectEdit) {
    const corner = objectCorner(pointFor(event, false));
    pixel.style.cursor = corner ? (corner[0] === corner[1] ? 'nwse-resize' : 'nesw-resize')
      : (containsPoint(objectEdit.layer, point) ? 'move' : 'default');
  }
  if (drag) { drawStroke(drag.last, point); drag.last = point; }
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) pixel.addEventListener(name, () => {
  if (objectEdit?.drag) {
    cancelAnimationFrame(objectDragFrame);
    objectDragFrame = 0;
    if (objectEdit.drag.point) moveObject(objectEdit.drag.point, objectEdit.drag);
    objectEdit.drag = null;
    commitObject();
  }
  endStroke();
});
pixel.addEventListener('pointerleave', () => {
  if (!drag) { hover = null; $('coords').textContent = '— , —'; drawGuide(); }
});
pixel.addEventListener('blur', () => { hover = null; drawGuide(); });
pixel.addEventListener('keydown', event => {
  const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (event.key in deltas) {
    event.preventDefault();
    const [dx, dy] = deltas[event.key], step = event.shiftKey ? 10 : 1;
    if (objectEdit) {
      moveObject({ x: dx * step, y: dy * step }, { origin: { x: 0, y: 0 }, layer: objectEdit.layer, corner: null });
      commitObject();
      return;
    }
    moveCursor({ x: Math.max(0, Math.min(WIDTH - 1, keyboard.x + dx * step)), y: Math.max(0, Math.min(project.height - 1, keyboard.y + dy * step)) });
  } else if (event.code === 'Space') {
    event.preventDefault();
    if (tool === 'select') { selectAt(keyboard); return; }
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
  if (!finishObjectEdit()) return;
  const base = [...new Set(project.pixels.subarray(row * WIDTH, (row + 1) * WIDTH))];
  options($('row-old'), base, base[1] ?? base[0]);
  options($('row-new'), paletteIndices(), selected);
  $('row-dialog-label').textContent = 'Rangée ' + (row + 1) + ' : remplace les mailles dessinées dans ce fil. La couleur des textes se modifie dans le panneau Objets.';
  $('row-dialog').showModal();
};
$('row-form').onsubmit = event => {
  event.preventDefault();
  const from = Number($('row-old').value), to = Number($('row-new').value);
  const next = clone(project);
  const edits = Array.from({ length: WIDTH }, (_, x) => [x, row, project.pixels[row * WIDTH + x]])
    .filter(edit => edit[2] === from).map(([x, y]) => [x, y, to]);
  const result = paint(next, edits);
  if (result.changed) swap(next);
  $('row-dialog').close();
  reportRejected(result.rejected);
};

function openColor(index) {
  editColor = index;
  const current = project.palette[index] ?? { name: 'Fil ' + (project.palette.length + 1), hex: '#6796a6' };
  manualColorName = false;
  $('color-dialog').setAttribute('aria-labelledby', 'color-title');
  $('color-form').hidden = false;
  $('delete-yarn-form').hidden = true;
  $('delete-yarn').hidden = index === null;
  $('delete-yarn').disabled = project.palette.length === 1;
  $('delete-yarn').title = project.palette.length === 1 ? 'La palette doit garder au moins un fil.' : '';
  $('color-title').textContent = index === null ? 'Ajouter un fil' : 'Modifier le fil';
  $('color-name').value = current.name;
  $('color-hex').value = $('color-picker').value = current.hex;
  $('color-hex').setCustomValidity('');
  $('color-dialog').showModal();
  suggestColorName();
}

function renderImageYarns() {
  for (const [slot, label] of Object.entries(imageYarnLabels)) {
    const { name, hex } = project.palette[Number($(slot).value)];
    const button = $(slot + '-pick');
    const caption = document.createElement('span');
    caption.textContent = name;
    button.replaceChildren(swatch(hex), caption, icon('chevron'));
    button.setAttribute('aria-label', label + ' : ' + name);
    button.setAttribute('aria-expanded', imageYarnSlot === slot);
    button.title = name + ' · ' + hex;
  }
  $('invert-image-yarns').disabled = $('image-first').value === $('image-second').value;
  const choices = $('image-yarn-choices');
  choices.hidden = !imageYarnSlot;
  if (!imageYarnSlot) return;
  const slot = imageYarnSlot;
  choices.setAttribute('aria-label', imageYarnLabels[slot]);
  choices.replaceChildren(...project.palette.map(({ name, hex }, i) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'image-yarn-option';
    option.title = name + ' · ' + hex;
    option.setAttribute('aria-pressed', Number($(slot).value) === i);
    const caption = document.createElement('span');
    caption.textContent = name;
    option.append(swatch(hex), caption);
    option.onclick = () => {
      $(slot).value = i;
      imageYarnSlot = null;
      updateObjectDraft(undefined, undefined, true);
      $(slot + '-pick').focus({ preventScroll: true });
    };
    return option;
  }));
}

for (const slot of Object.keys(imageYarnLabels)) {
  $(slot + '-pick').onclick = () => {
    imageYarnSlot = imageYarnSlot === slot ? null : slot;
    renderImageYarns();
  };
}
$('invert-image-yarns').onclick = () => {
  const first = $('image-first'), second = $('image-second');
  [first.value, second.value] = [second.value, first.value];
  imageYarnSlot = null;
  updateObjectDraft(undefined, undefined, true);
};

const colorHex = /^#[0-9a-f]{6}$/i;
$('color-name').maxLength = MAX_COLOR_NAME_LENGTH;
$('color-name').oninput = () => {
  manualColorName = true;
  $('color-name-source').hidden = true;
};

function showYarnSuggestion(yarn, hex) {
  yarnSuggestion = yarn;
  $('yarn-match').hidden = !yarn;
  if (!yarn) return;
  $('yarn-match-swatch').style.setProperty('--swatch', yarn.hex);
  $('yarn-match-name').textContent = yarn.name;
  $('yarn-match-reference').textContent = [yarn.brand, yarn.range, yarn.hex].join(' · ');
  $('apply-yarn-hex').hidden = yarn.hex === hex;
}

function suggestColorName() {
  const hex = $('color-hex').value.toLowerCase(), name = $('color-name');
  $('color-name-source').hidden = true;
  if (!colorHex.test(hex)) {
    showYarnSuggestion(undefined, hex);
    return;
  }
  const original = project.palette[editColor];
  const useOriginalName = original?.hex === hex;
  if (!manualColorName && useOriginalName) name.value = original.name;
  if (colorMatcher) {
    const suggestion = colorMatcher(hex);
    showYarnSuggestion(suggestion.yarn, hex);
    if (!manualColorName && !useOriginalName) {
      name.value = suggestion.name || 'Fil ' + ((editColor ?? project.palette.length) + 1);
      $('color-name-source').hidden = !suggestion.name || !!suggestion.yarn;
    }
    return;
  }
  showYarnSuggestion(undefined, hex);
  if (!manualColorName && !useOriginalName) {
    name.placeholder = 'Recherche du nom…';
    name.value = '';
  }
  if (!colorNamesRequest) {
    colorNamesRequest = loadColorSuggestions()
      .then(matcher => { colorMatcher = matcher; }, () => { colorMatcher = () => ({}); })
      .finally(() => {
        colorNamesRequest = undefined;
        name.placeholder = '';
        if ($('color-dialog').open) suggestColorName();
      });
  }
}

$('add-color').onclick = () => openColor(null);
$('delete-yarn').onclick = () => {
  if (!finishObjectEdit()) { $('color-dialog').close(); return; }
  const used = editColor === 0 || project.pixels.includes(editColor) || project.grainYarn === editColor ||
    project.layers.some(layer => layer.color === editColor || layer.duo?.includes(editColor)) ||
    visibleDesign.pixels.includes(editColor);
  const remaining = paletteIndices().filter(i => i !== editColor);
  options($('delete-yarn-with'), remaining, remaining.includes(selected) ? selected : remaining[0]);
  $('delete-yarn-message').textContent = used
    ? 'Choisissez un fil pour remplacer « ' + project.palette[editColor].name + ' ».'
    : 'Retirer « ' + project.palette[editColor].name + ' » de la palette ?';
  $('delete-yarn-replacement').hidden = !used;
  $('delete-yarn-auto').hidden = !project.layers.some(layer => layer.type === 'image' && layer.duo === null);
  $('delete-yarn-error').hidden = true;
  $('confirm-delete-yarn').textContent = used ? 'Remplacer et supprimer' : 'Supprimer';
  $('color-dialog').setAttribute('aria-labelledby', 'delete-yarn-title');
  $('color-form').hidden = true;
  $('delete-yarn-form').hidden = false;
  $(used ? 'delete-yarn-with' : 'cancel-delete-yarn').focus();
};
$('cancel-delete-yarn').onclick = () => {
  $('delete-yarn-form').hidden = true;
  $('color-dialog').setAttribute('aria-labelledby', 'color-title');
  $('color-form').hidden = false;
  $('delete-yarn').focus();
};
$('delete-yarn-with').onchange = () => { $('delete-yarn-error').hidden = true; };
$('delete-yarn-form').onsubmit = event => {
  event.preventDefault();
  const replacement = Number($('delete-yarn-with').value);
  const next = removeYarn(project, editColor, replacement);
  if (compose(next).rejected.size) {
    $('delete-yarn-error').textContent = 'Ce choix créerait un troisième fil sur une rangée avec du texte. Choisissez un autre fil ou ajustez les couleurs des objets.';
    $('delete-yarn-error').hidden = false;
    return;
  }
  const active = project.palette[selected === editColor ? replacement : selected];
  selected = next.palette.indexOf(active);
  swap(next);
  $('color-dialog').close();
  $('palette').querySelector('.color-choose[aria-pressed="true"]').focus({ preventScroll: true });
};
$('color-picker').oninput = () => {
  $('color-hex').value = $('color-picker').value;
  $('color-hex').setCustomValidity('');
  suggestColorName();
};
$('color-hex').oninput = event => {
  const hex = event.target.value;
  event.target.setCustomValidity('');
  if (colorHex.test(hex)) {
    $('color-picker').value = hex;
  }
  suggestColorName();
};
$('apply-yarn-hex').onclick = () => {
  if (!yarnSuggestion) return;
  $('color-picker').value = yarnSuggestion.hex;
  $('color-picker').oninput();
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
  swap(next);
  if (objectEdit) {
    const { layer } = objectEdit;
    if (layer.type === 'text') options($('text-color'), paletteIndices(), layer.color);
    else renderImageYarns();
  }
  $('color-dialog').close();
};

function emptyNewObject() {
  return objectEdit?.index === null && !objectEdit.layer.text?.trim();
}

function finishObjectEdit() {
  if (!objectEdit) return true;
  if (!emptyNewObject() && !commitObject()) {
    announce('Corrigez ou annulez la modification en cours.', true);
    return false;
  }
  closeObject();
  refreshArtwork();
  return true;
}

function showLayers() {
  const canReorder = project.layers.length > 1;
  const canDuplicate = project.layers.length < MAX_LAYERS;
  const list = project.layers.map((layer, index) => {
    const row = document.createElement('div');
    row.className = 'object-row';
    const button = document.createElement('button');
    button.className = 'object-layer';
    button.type = 'button';
    button.dataset.layerIndex = index;
    button.setAttribute('aria-pressed', objectEdit?.index === index);
    const name = layer.type === 'text' ? layer.text : layer.name;
    button.title = name;
    const title = document.createElement('span');
    title.textContent = name.replace(/\s+/g, ' ');
    button.append(icon(layer.type === 'text' ? 'text' : 'image'), title);
    if (canReorder) {
      const grip = icon('grip');
      grip.classList.add('object-grip');
      button.append(grip);
      button.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    }
    button.onclick = () => openObject(index);
    row.append(button,
      layerAction('copy', 'Dupliquer', title.textContent, !canDuplicate, () => duplicateLayer(index)),
      layerAction('trash', 'Supprimer', title.textContent, false, () => deleteLayer(index)));
    return row;
  }).reverse();
  const listElement = $('object-layers');
  const scroll = listElement.scrollTop;
  if (draggedLayer !== null) clearLayerDrag();
  listElement.replaceChildren(...list);
  listElement.scrollTop = scroll;
  $('object-order-hint').hidden = !canReorder;
  $('object-panel').hidden = !list.length && !objectEdit;
  $('object-form').hidden = !objectEdit;
  $('add-text').disabled = $('text-tool').disabled = !canDuplicate;
  $('text-tool').setAttribute('aria-pressed', objectEdit?.layer.type === 'text');
}

function layerAction(symbol, label, name, disabled, action) {
  const button = document.createElement('button');
  button.className = 'icon-button object-action';
  button.type = 'button';
  button.title = label;
  button.disabled = disabled;
  button.setAttribute('aria-label', label + ' « ' + name + ' »');
  button.append(icon(symbol));
  button.onclick = action;
  return button;
}

function focusLayer(index) {
  (objectList.querySelector(`[data-layer-index="${index}"]`) ?? $('text-tool')).focus();
}

function duplicateLayer(index) {
  if (!finishObjectEdit() || project.layers.length >= MAX_LAYERS) return;
  const layer = project.layers[index];
  if (!layer) return;
  const layers = project.layers.slice();
  layers.splice(index + 1, 0, { ...layer });
  swap({ ...project, layers });
  openObject(index + 1);
  focusLayer(index + 1);
  announce('Objet dupliqué.');
}

function deleteLayer(index) {
  if (objectEdit?.index !== index && !finishObjectEdit()) return;
  const layers = project.layers.slice();
  layers.splice(index, 1);
  const next = { ...project, layers };
  if (compose(next).rejected.size) {
    announce('La suppression ferait apparaître une troisième couleur sous un autre objet.', true);
    return;
  }
  if (objectEdit) closeObject();
  swap(next);
  focusLayer(Math.min(index, layers.length - 1));
  announce('Objet supprimé.');
}

function reorderLayer(from, to) {
  if (from === to || from < 0 || from >= project.layers.length || to < 0 || to >= project.layers.length) return false;
  if (objectEdit && !emptyNewObject() && !commitObject()) {
    announce('Corrigez ou annulez la modification avant de changer l’ordre.', true);
    return false;
  }
  const layers = project.layers.slice();
  const selectedLayer = project.layers[objectEdit?.index];
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  const next = { ...project, layers };
  const { rejected } = compose(next);
  if (rejected.size) {
    announce('Cet ordre ajouterait un troisième fil sur certaines rangées. Ajustez les fils des objets qui se superposent.', true);
    return false;
  }
  if (selectedLayer) objectEdit.index = layers.indexOf(selectedLayer);
  swap(next);
  return true;
}

const objectList = $('object-layers');

function objectDropSlot(clientY) {
  const rows = [...objectList.children];
  const before = rows.findIndex(row => {
    const { top, height } = row.getBoundingClientRect();
    return clientY < top + height / 2;
  });
  return before === -1 ? rows.length : before;
}

function clearDropMarker() {
  objectList.querySelector('[data-drop-edge]')?.removeAttribute('data-drop-edge');
}

function clearLayerDrag() {
  cancelAnimationFrame(layerScrollFrame);
  draggedLayer = null;
  clearDropMarker();
  objectList.querySelector('.is-dragged')?.classList.remove('is-dragged');
}

function layerListContainsPoint({ x, y }) {
  const { left, right, top, bottom } = objectList.getBoundingClientRect();
  return x >= left && x <= right && y >= top - 7 && y <= bottom + 7;
}

function showDropMarker(point) {
  clearDropMarker();
  if (!layerListContainsPoint(point)) return;
  const slot = objectDropSlot(point.y);
  if (slot < objectList.children.length) objectList.children[slot].dataset.dropEdge = 'before';
  else objectList.lastElementChild.dataset.dropEdge = 'after';
}

function scrollWhileDraggingLayer() {
  if (!draggedLayer?.active) return;
  const { point } = draggedLayer;
  if (layerListContainsPoint(point)) {
    const { top, bottom } = objectList.getBoundingClientRect();
    const before = objectList.scrollTop;
    if (point.y < top + 16) objectList.scrollTop -= 5;
    if (point.y > bottom - 16) objectList.scrollTop += 5;
    if (objectList.scrollTop !== before) showDropMarker(point);
  }
  layerScrollFrame = requestAnimationFrame(scrollWhileDraggingLayer);
}

objectList.addEventListener('pointerdown', event => {
  suppressLayerClick = false;
  if (event.button !== 0 || !event.isPrimary || project.layers.length < 2) return;
  const button = event.target.closest('.object-layer');
  if (!button || (event.pointerType === 'touch' && !event.target.closest('.object-grip'))) return;
  const origin = { x: event.clientX, y: event.clientY };
  draggedLayer = { row: button.closest('.object-row'), index: Number(button.dataset.layerIndex), pointerId: event.pointerId, origin, active: false };
  button.setPointerCapture(event.pointerId);
});
objectList.addEventListener('pointermove', event => {
  if (draggedLayer?.pointerId !== event.pointerId) return;
  const point = { x: event.clientX, y: event.clientY };
  if (!draggedLayer.active) {
    const { origin } = draggedLayer;
    if (Math.hypot(point.x - origin.x, point.y - origin.y) < 5) return;
    draggedLayer.active = true;
    draggedLayer.row.classList.add('is-dragged');
    layerScrollFrame = requestAnimationFrame(scrollWhileDraggingLayer);
  }
  draggedLayer.point = point;
  showDropMarker(point);
});
objectList.addEventListener('pointerup', event => {
  if (draggedLayer?.pointerId !== event.pointerId) return;
  const { active, index } = draggedLayer;
  clearLayerDrag();
  if (!active) return;
  suppressLayerClick = true;
  if (!layerListContainsPoint({ x: event.clientX, y: event.clientY })) return;
  const count = project.layers.length;
  const displayedFrom = count - 1 - index;
  const slot = objectDropSlot(event.clientY);
  const displayedTo = slot > displayedFrom ? slot - 1 : slot;
  reorderLayer(index, count - 1 - displayedTo);
});
for (const eventName of ['pointercancel', 'lostpointercapture']) {
  objectList.addEventListener(eventName, event => {
    if (draggedLayer?.pointerId === event.pointerId) clearLayerDrag();
  });
}
objectList.addEventListener('click', event => {
  if (suppressLayerClick && event.detail > 0) {
    event.preventDefault();
    event.stopPropagation();
  }
}, { capture: true });
objectList.addEventListener('keydown', event => {
  const row = event.target.closest('.object-layer');
  if (!row || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const from = Number(row.dataset.layerIndex);
  const to = from + (event.key === 'ArrowUp' ? 1 : -1);
  if (reorderLayer(from, to)) objectList.querySelector(`[data-layer-index="${to}"]`)?.focus();
});

function openObject(index, focusText = false) {
  if (index !== null && objectEdit?.index === index) return true;
  if (!finishObjectEdit()) return false;
  if (index === null && project.layers.length >= MAX_LAYERS) return false;
  const layer = index === null ? {
    type: 'text', text: '', font: 'pixelify-sans', width: 128, height: Math.min(24, project.height),
    x: 26, y: Math.min(Math.floor(project.height / 4), Math.max(0, project.height - 24)),
    color: selected, mask: null,
  } : project.layers[index];
  if (!layer) return false;
  selectTool('select');
  setMode('pixel');
  objectEdit = { index, layer };
  const text = layer.type === 'text';
  $('text-fields').hidden = !text;
  $('text-value').disabled = !text;
  $('image-fields').hidden = text;
  $('image-aspect-control').hidden = text;
  if (text) {
    $('text-value').value = layer.text;
    $('font').value = Object.hasOwn(FONTS, layer.font) ? layer.font : 'affiche';
    options($('text-color'), paletteIndices(), layer.color);
  } else {
    const duo = layer.duo && !layer.orderedDuo ? orderYarnsByTone(layer.duo, project.palette) : layer.duo;
    $('image-color-mode').value = layer.duo ? 'duo' : 'auto';
    $('image-first').value = duo?.[0] ?? 0;
    $('image-second').value = duo?.[1] ?? Math.min(2, project.palette.length - 1);
    $('image-duo').hidden = !layer.duo;
    $('image-aspect-lock').checked = layer.aspectRatio !== null;
    renderImageYarns();
  }
  setObjectBounds(layer);
  $('height').disabled = true;
  pixel.dataset.editingObject = '';
  showLayers();
  refreshArtwork();
  if (focusText && text) $('text-value').focus();
  return true;
}

function setObjectBounds({ width, height, x, y }) {
  $('object-width').value = width;
  $('object-height').max = Math.max(height, project.height);
  $('object-height').value = height;
  $('object-x').max = WIDTH - width + 1;
  $('object-y').max = Math.max(y + 1, project.height - height + 1);
  $('object-x').value = x + 1;
  $('object-y').value = y + 1;
}

function withObjectDraft(layer = objectEdit.layer) {
  const layers = project.layers.slice();
  const index = objectEdit.index ?? layers.length;
  const replacement = layer && (layer.type === 'image' || layer.mask) ? [layer] : [];
  layers.splice(index, objectEdit.index === null ? 0 : 1, ...replacement);
  return { ...project, layers };
}

function refreshArtwork() {
  drawPixels();
  updateRows();
  drawGuide();
}

function objectReady() {
  return objectEdit && (objectEdit.layer.type === 'image' || !!objectEdit.layer.mask) &&
    !objectEdit.request && !objectEdit.invalid && !objectConflicts.size;
}

function updateObjectFeedback() {
  if (!objectEdit) return;
  const feedback = $('object-feedback');
  const conflict = objectConflicts.size;
  feedback.toggleAttribute('data-warning', !!(conflict || objectEdit.error));
  if (objectEdit.error) feedback.textContent = objectEdit.error;
  else if (objectEdit.request) feedback.textContent = 'Préparation de la typographie…';
  else if (conflict) {
    const preview = [...objectConflicts].slice(0, 3).map(y => y + 1).join(', ');
    feedback.textContent = 'Troisième fil sur ' + (conflict === 1 ? 'la rangée ' : 'les rangées ') +
      preview + (conflict > 3 ? '…' : '.') + ' Déplacez l’objet ou changez de fil.';
  } else {
    const adapted = adaptedImages.get(objectEdit.layer);
    feedback.textContent = adapted
      ? 'Fils du fond conservés sur ' + adapted + (adapted === 1 ? ' rangée.' : ' rangées.')
      : 'Glissez l’objet ou une poignée dans les coins.';
  }
  $('cancel-object').hidden = !!(objectReady() || emptyNewObject());
}

function commitObjectInput() {
  if (!objectEdit?.drag) commitObject();
}

function commitObject() {
  if (!objectReady()) return false;
  const { layer, index } = objectEdit;
  const original = project.layers[index];
  if (original && Object.keys(layer).every(key => layer[key] === original[key])) return true;
  const previous = project;
  project = { ...withObjectDraft(), pixels: previous.pixels.slice() };
  objectEdit.index = index ?? project.layers.length - 1;
  track(previous);
  showLayers();
  return true;
}

function updateObjectDraft(geometry, dimension, yarnsChanged = false) {
  if (!objectEdit) return;
  let width = $('object-width').valueAsNumber, height = $('object-height').valueAsNumber;
  const column = $('object-x').valueAsNumber, row = $('object-y').valueAsNumber;
  objectEdit.invalid = !($('object-width').validity.valid && $('object-height').validity.valid &&
    Number.isInteger(column) && Number.isInteger(row));
  if (objectEdit.invalid) { updateObjectFeedback(); return; }
  const previous = objectEdit.layer;
  const aspectRatio = previous.type === 'image' && $('image-aspect-lock').checked
    ? (previous.aspectRatio ?? previous.width / previous.height) : null;
  if (aspectRatio !== null && dimension) {
    ({ width, height } = proportionalImageSize(
      aspectRatio, dimension === 'width' ? width : height * aspectRatio, WIDTH, project.height,
    ));
  }
  const x = Math.max(0, Math.min(WIDTH - width, column - 1));
  const maxY = height === previous.height ? Math.max(previous.y, project.height - height) : Math.max(0, project.height - height);
  const y = Math.max(0, Math.min(maxY, row - 1));
  const bounds = geometry ?? { width, height, x, y };
  setObjectBounds(bounds);
  if (previous.type === 'image') {
    const duo = yarnsChanged
      ? ($('image-color-mode').value === 'duo' ? [Number($('image-first').value), Number($('image-second').value)] : null)
      : previous.duo;
    const sameDuo = duo?.[0] === previous.duo?.[0] && duo?.[1] === previous.duo?.[1];
    objectEdit.layer = {
      ...previous, ...bounds, duo: sameDuo ? previous.duo : duo, aspectRatio,
      orderedDuo: previous.orderedDuo || yarnsChanged,
    };
    $('image-duo').hidden = !duo;
    if (!duo) imageYarnSlot = null;
    renderImageYarns();
    refreshArtwork();
    commitObjectInput();
    return;
  }

  const text = $('text-value').value.trim(), font = $('font').value;
  const changed = text !== previous.text || font !== previous.font ||
    bounds.width !== previous.width || bounds.height !== previous.height;
  objectEdit.layer = { type: 'text', text, font, ...bounds, color: Number($('text-color').value), mask: changed ? null : previous.mask };
  objectEdit.error = '';
  if (changed) objectEdit.request = null;
  if (text && !objectEdit.layer.mask && !objectEdit.request) {
    const request = { text, width: bounds.width, height: bounds.height, font };
    objectEdit.request = request;
    const render = () => {
      if (objectEdit?.request !== request) return;
      const mask = packTextMask(textMask(text, request.width, request.height, font));
      objectEdit.layer = { ...objectEdit.layer, mask };
      objectEdit.request = null;
      refreshArtwork();
      commitObjectInput();
    };
    if (document.fonts.check(FONTS[font], text)) { render(); return; }
    document.fonts.load(FONTS[font], text).then(render).catch(() => {
      if (objectEdit?.request !== request) return;
      objectEdit.request = null;
      objectEdit.error = 'Typographie indisponible. Choisissez une autre police.';
      updateObjectFeedback();
    });
  }
  refreshArtwork();
  commitObjectInput();
}

function moveObject(point, drag) {
  const { origin, layer, corner } = drag;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  let { x, y, width, height } = layer;
  if (!corner) {
    x = Math.max(0, Math.min(WIDTH - width, x + dx));
    y = Math.max(0, Math.min(project.height - height, y + dy));
  } else if (layer.type === 'image' && layer.aspectRatio !== null) {
    ({ x, y, width, height } = resizeImageCorner(layer, corner, dx, dy, project.height));
  } else {
    const right = x + width, bottom = y + height;
    if (corner[0] < 0) {
      x = Math.max(0, Math.min(right - 1, x + dx));
      width = right - x;
    } else width = Math.max(1, Math.min(WIDTH - x, width + dx));
    if (corner[1] < 0) {
      y = Math.max(0, Math.min(bottom - 1, y + dy));
      height = bottom - y;
    } else height = Math.max(1, Math.min(project.height - y, height + dy));
  }
  const current = objectEdit.layer;
  if (x === current.x && y === current.y && width === current.width && height === current.height) return;
  setObjectBounds({ x, y, width, height });
  updateObjectDraft({ x, y, width, height });
}

function closeObject() {
  cancelAnimationFrame(objectDragFrame);
  objectDragFrame = 0;
  objectEdit = null;
  imageYarnSlot = null;
  $('height').disabled = false;
  delete pixel.dataset.editingObject;
  pixel.style.cursor = '';
  showLayers();
}

$('text-tool').onclick = $('add-text').onclick = () => openObject(null, true);
for (const id of ['text-value', 'font', 'text-color', 'image-color-mode', 'image-aspect-lock',
  'object-width', 'object-height', 'object-x', 'object-y']) {
  $(id).oninput = () => updateObjectDraft(undefined,
    id === 'object-width' ? 'width' : id === 'object-height' ? 'height' : undefined,
    id === 'image-color-mode');
  $(id).onchange = commitObject;
}
$('cancel-object').onclick = () => { closeObject(); refreshArtwork(); };
$('object-form').onsubmit = event => {
  event.preventDefault();
  finishObjectEdit();
};

function chooseImage(replace = false) {
  if (!finishObjectEdit()) return;
  if (!replace && project.layers.length >= MAX_LAYERS) { announce('L’affiche contient déjà ' + MAX_LAYERS + ' objets.'); return; }
  replaceWithImage = replace;
  $('image-file').click();
}

async function receiveImage(file, point = null, replace = false) {
  if (!file || !finishObjectEdit()) return;
  if (!replace && project.layers.length >= MAX_LAYERS) { announce('L’affiche contient déjà ' + MAX_LAYERS + ' objets.'); return; }
  const sequence = ++imageSequence;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (sequence !== imageSequence || !finishObjectEdit()) return;
    if (!replace && project.layers.length >= MAX_LAYERS) return;
    const scale = Math.min(1, WIDTH / image.naturalWidth, MAX_HEIGHT / image.naturalHeight);
    const buffer = document.createElement('canvas');
    buffer.width = Math.max(1, Math.round(image.naturalWidth * scale));
    buffer.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = buffer.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, buffer.width, buffer.height);
    const source = packImageSource(ctx.getImageData(0, 0, buffer.width, buffer.height));
    let next = project;
    if (replace) {
      const height = Math.max(1, Math.min(MAX_HEIGHT, Math.round(image.naturalHeight * WIDTH / image.naturalWidth)));
      next = design(height, project.palette, project.name);
      next.checkFloats = project.checkFloats;
      next.floatLimit = project.floatLimit;
      next.noiseAmount = project.noiseAmount;
      next.grainYarn = project.grainYarn;
    }
    const fit = Math.min(1, WIDTH * .8 / source.width, next.height * .8 / source.height);
    const width = replace ? WIDTH : Math.max(1, Math.round(source.width * fit));
    const height = replace ? next.height : Math.max(1, Math.round(source.height * fit));
    const pos = positionInProject({ width, height }, point ?? { x: WIDTH / 2, y: Math.floor(next.height / 2) }, next.height);
    const layer = {
      type: 'image', name: file.name.trim().slice(0, 120) || 'Image', ...pos, width, height,
      duo: null, aspectRatio: width / height, orderedDuo: true, source,
    };
    const updated = { ...next, layers: [...next.layers, layer] };
    swap(updated);
    openObject(updated.layers.length - 1);
    if (replace) setZoom(1);
  } catch {
    if (sequence === imageSequence) announce('Image illisible. Essayez un fichier PNG ou JPEG.', true);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('image-tool').onclick = () => chooseImage();
$('new-from-image').onclick = () => { closeMenu(); chooseImage(true); };
$('image-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  receiveImage(file, null, replaceWithImage);
};
document.addEventListener('paste', event => {
  if (document.querySelector('dialog[open]')) return;
  const file = [...(event.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))?.getAsFile();
  if (!file) return;
  event.preventDefault();
  receiveImage(file);
});
stage.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
stage.addEventListener('drop', event => {
  event.preventDefault();
  if (document.querySelector('dialog[open]')) return;
  const file = [...event.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) receiveImage(file, mode === 'pixel' ? pointFor(event) : null);
  else announce('Déposez un fichier image.', true);
});

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
async function exportPng(monochrome) {
  document.querySelector('.export-menu').open = false;
  if (!finishObjectEdit()) return;
  if (!validate(visibleDesign)) { announce('Corrigez les rangées avant l’export.', true); return; }
  const name = filename() + '-180x' + project.height + (monochrome ? '-ayab.png' : '.png');
  try {
    const blob = monochrome ? await ayabPng(visibleDesign) : await new Promise(resolve => pixel.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG vide.');
    saveFile(blob, name);
    announce('PNG exporté : ' + name);
  } catch {
    announce('Impossible de générer le PNG.', true);
  }
}
$('export').onclick = () => exportPng(false);
$('export-ayab').onclick = () => exportPng(true);
function closeMenu() { document.querySelector('.project-menu').open = false; }
$('save-project').onclick = () => {
  closeMenu();
  if (!finishObjectEdit()) return;
  saveFile(new Blob([serialize(project)], { type: 'application/json' }), filename() + '.politicayab.json');
};
$('open-project').onclick = () => { closeMenu(); if (finishObjectEdit()) $('project-file').click(); };
$('project-file').onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > MAX_PROJECT_BYTES) throw new Error('Ce fichier est trop volumineux pour être un projet.');
    const next = upgradeSample(parse(await file.text()));
    if (!finishObjectEdit()) return;
    imageSequence++;
    swap(next);
    setZoom(1);
    announce('Projet ouvert.');
  } catch (error) { announce(error.message || 'Projet illisible.', true); }
};
$('new-project').onclick = () => { closeMenu(); if (finishObjectEdit()) $('new-dialog').showModal(); };
$('new-form').onsubmit = event => {
  event.preventDefault();
  $('new-dialog').close();
  imageSequence++;
  swap(design($('new-height').valueAsNumber, undefined, $('new-name').value.trim() || 'Sans titre'));
  setMode('pixel'); setZoom(1);
};
$('load-sample').onclick = () => {
  closeMenu();
  if (!finishObjectEdit()) return;
  imageSequence++;
  swap(sample()); setMode('pixel'); setZoom(1);
};
$('project-name').oninput = event => {
  const name = event.target.value.trim() || 'Sans titre';
  if (name !== project.name) {
    const before = clone(project);
    project.name = name;
    track(before);
  }
};
$('project-name').onchange = event => { event.target.value = project.name; };
$('height').onchange = event => {
  const height = event.target.valueAsNumber;
  if (!Number.isInteger(height) || height < 1 || height > MAX_HEIGHT) {
    event.target.value = project.height;
    announce('Choisissez une hauteur entre 1 et ' + MAX_HEIGHT + ' rangées.', true);
  } else if (height !== project.height) {
    const next = resize(project, height);
    if (compose(next).rejected.size) {
      event.target.value = project.height;
      announce('Cette hauteur ferait réapparaître des textes à trois couleurs sur certaines rangées.', true);
      return;
    }
    swap(next);
    if (height < undo.at(-1).height) announce('Affiche recadrée en hauteur. Vous pouvez annuler.');
  }
};
$('check-floats').onchange = event => swap({ ...project, checkFloats: event.target.checked });
$('float-limit').oninput = event => {
  if (!event.target.validity.valid) return;
  const limit = event.target.valueAsNumber;
  if (limit !== project.floatLimit) {
    const previous = project;
    project = { ...project, pixels: project.pixels.slice(), floatLimit: limit };
    track(previous);
    refreshArtwork();
  }
};
$('float-limit').onchange = event => { event.target.value = project.floatLimit; };
$('noise-amount').oninput = event => {
  $('noise-value').value = event.target.value + ' %';
  refreshArtwork();
};
$('noise-amount').onchange = event => {
  const noiseAmount = event.target.valueAsNumber;
  if (noiseAmount !== project.noiseAmount) swap({ ...project, noiseAmount });
};
$('grain-yarn').onchange = event => {
  const grainYarn = event.target.value === '' ? null : Number(event.target.value);
  if (grainYarn !== project.grainYarn) swap({ ...project, grainYarn });
};
$('next-float-row').onclick = () => {
  if (!finishObjectEdit() || !floatStitches.size) return;
  setMode('pixel');
  hover = null;
  const affected = [...floatStitches.keys()];
  const next = affected.find(y => y > row) ?? affected[0];
  selectRow(next);
  const count = floatStitches.get(next).length;
  announce('Rangée ' + (next + 1) + ' · ' + count + ' point' + (count === 1 ? '' : 's') + ' d’accroche');
};
for (const btn of document.querySelectorAll('[data-tool]')) btn.onclick = () => useTool(btn.dataset.tool);
for (const btn of document.querySelectorAll('.close-dialog')) btn.onclick = () => btn.closest('dialog').close();
$('undo').onclick = () => stepHistory(undo, redo);
$('redo').onclick = () => stepHistory(redo, undo);
$('pixel-mode').onclick = () => setMode('pixel');
$('knit-mode').onclick = $('show-knit').onclick = () => setMode('knit');
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
$('finish').onchange = () => { knitDirty = true; drawKnit(); };
document.addEventListener('pointerdown', event => {
  for (const menu of document.querySelectorAll('.project-menu[open], .export-menu[open]')) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener('click', event => {
  if (!objectEdit || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  // Selection can rebuild the object list during the click.
  const insideEditor = event.composedPath().some(node => node instanceof Element &&
    node.matches('#object-panel, #pixels, .palette-block, #text-tool, .inspector-sticky, dialog'));
  if (insideEditor) return;
  finishObjectEdit();
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    if (imageYarnSlot) {
      const trigger = $(imageYarnSlot + '-pick');
      imageYarnSlot = null;
      renderImageYarns();
      trigger.focus({ preventScroll: true });
      return;
    }
    if (objectEdit) { closeObject(); refreshArtwork(); }
    closeMenu();
    document.querySelector('.export-menu').open = false;
    return;
  }
  if (event.target.matches('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
    event.preventDefault();
    if (event.shiftKey || key === 'y') stepHistory(redo, undo);
    else stepHistory(undo, redo);
  } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    const shortcuts = { b: 'pencil', e: 'eraser', g: 'fill', i: 'dropper', v: 'select' };
    if (key in shortcuts) useTool(shortcuts[key]);
    if (key === 't') $('text-tool').click();
  }
});

function setupFillPatterns() {
  const picker = $('fill-patterns');
  for (const [id, { label, mask }] of Object.entries(FILL_PATTERNS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', id === fillPattern);
    const preview = document.createElement('canvas');
    preview.width = 24;
    preview.height = 12;
    preview.setAttribute('aria-hidden', 'true');
    const ctx = preview.getContext('2d');
    ctx.fillStyle = '#444a34';
    for (let y = 0; y < preview.height; y++) {
      const row = mask[y % mask.length];
      for (let x = 0; x < preview.width; x++) {
        if (row[x % row.length] === '1') ctx.fillRect(x, y, 1, 1);
      }
    }
    button.append(preview, label);
    button.onclick = () => {
      picker.querySelector('[aria-pressed="true"]').setAttribute('aria-pressed', 'false');
      fillPattern = id;
      button.setAttribute('aria-pressed', 'true');
    };
    picker.append(button);
  }
}

function setupInspectorTitles() {
  const inspector = document.querySelector('.inspector');
  const nav = $('inspector-titles');
  const innerScroll = matchMedia('(min-width: 746px)');
  const rowHeight = Number.parseFloat(getComputedStyle(nav).getPropertyValue('--inspector-title-height'));
  const headings = [...inspector.querySelectorAll('.panel-block h2')].map(heading => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = [...heading.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
    heading.tabIndex = -1;
    return { heading, section: heading.closest('.panel-block'), button };
  });
  nav.append(...headings.map(item => item.button));
  let frame = 0;
  function update() {
    frame = 0;
    const top = innerScroll.matches ? inspector.getBoundingClientRect().top : 0;
    let height = 0;
    for (const { heading, section, button } of headings) {
      const pinned = !section.hidden && heading.getBoundingClientRect().top < top + height - 1;
      button.hidden = !pinned;
      if (pinned) height += rowHeight;
    }
    nav.hidden = height === 0;
  }
  function queueUpdate() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  headings.forEach(({ heading, button }, index) => {
    button.onclick = () => {
      const offset = headings.slice(0, index).filter(item => !item.section.hidden).length * rowHeight + 4;
      if (innerScroll.matches) {
        inspector.scrollTop += heading.getBoundingClientRect().top - inspector.getBoundingClientRect().top - offset;
      } else {
        window.scrollBy(0, heading.getBoundingClientRect().top - offset);
      }
      heading.focus({ preventScroll: true });
      queueUpdate();
    };
  });
  inspector.addEventListener('scroll', queueUpdate, { passive: true });
  window.addEventListener('scroll', queueUpdate, { passive: true });
  innerScroll.addEventListener('change', queueUpdate);
  const observer = new ResizeObserver(queueUpdate);
  observer.observe(inspector);
  for (const { section } of headings) observer.observe(section);
  update();
}

new ResizeObserver(layout).observe(stage);
renderAll();
setupFillPatterns();
setupInspectorTitles();
