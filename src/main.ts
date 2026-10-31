import './style.css';
import { applyBlur, type BlurOptions } from './blur';
import { iou } from './centerface';
import { analyze, type Analysis } from './detect';
import { DEFAULT_SETTINGS, type BlurMode, type Rect, type Region, type Settings, type Shape } from './types';

const PREVIEW_MAX = 1800;
const MIN_SIZE = 6; // image px
const HANDLE_PX = 12; // on screen
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];
const CURSORS: Record<Handle, string> = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
const svg = document.getElementById('overlay') as unknown as SVGSVGElement;
const stage = $('stage');

// ---- state -----------------------------------------------------------------

const settings: Settings = { ...DEFAULT_SETTINGS };
let regions: Region[] = [];
let selectedId: number | null = null;
let nextId = 1;
let bitmap: ImageBitmap | null = null;
let fileName = 'image';
let pristine: ImageData | null = null;
let analysis: Analysis | null = null;
let tool: 'select' | 'add' = 'select';
let detectRun = 0;
const undoStack: Region[][] = [];
const redoStack: Region[][] = [];

const clone = (r: Region[]) => r.map((x) => ({ ...x }));
const selected = () => regions.find((r) => r.id === selectedId);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function checkpoint() {
  undoStack.push(clone(regions));
  redoStack.length = 0;
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(clone(regions));
  regions = prev;
  changed();
}

function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(clone(regions));
  regions = next;
  changed();
}

// ---- rendering -------------------------------------------------------------

function optsFor(r: Region): BlurOptions {
  return {
    mode: r.mode ?? settings.mode,
    strength: r.strength ?? settings.strength,
    padding: settings.padding,
    feather: settings.feather,
    shape: settings.shape,
  };
}

let frame = 0;
function changed() {
  if (!selected()) selectedId = null;
  refreshUi();
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    renderPreview();
    drawOverlay();
  });
}

function renderPreview() {
  if (!pristine || !bitmap) return;
  const img = new ImageData(new Uint8ClampedArray(pristine.data), pristine.width, pristine.height);
  const sx = img.width / bitmap.width;
  const sy = img.height / bitmap.height;
  for (const r of regions) {
    applyBlur(img, { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }, optsFor(r));
  }
  ctx.putImageData(img, 0, 0);
}

function drawOverlay() {
  if (!bitmap) return;
  svg.setAttribute('viewBox', `0 0 ${bitmap.width} ${bitmap.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.replaceChildren();
  const hs = HANDLE_PX / displayScale();
  for (const r of regions) {
    const el = rectEl(r, `region ${r.source}${r.id === selectedId ? ' selected' : ''}`);
    el.dataset.id = String(r.id);
    svg.append(el);
  }
  const sel = selected();
  if (sel) {
    for (const h of HANDLES) {
      const cx = h.includes('w') ? sel.x : h.includes('e') ? sel.x + sel.w : sel.x + sel.w / 2;
      const cy = h.includes('n') ? sel.y : h.includes('s') ? sel.y + sel.h : sel.y + sel.h / 2;
      const el = rectEl({ x: cx - hs / 2, y: cy - hs / 2, w: hs, h: hs }, 'handle');
      el.dataset.handle = h;
      el.style.cursor = `${CURSORS[h]}-resize`;
      svg.append(el);
    }
  }
}

function rectEl(r: Rect, cls: string): SVGRectElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  el.setAttribute('x', String(r.x));
  el.setAttribute('y', String(r.y));
  el.setAttribute('width', String(r.w));
  el.setAttribute('height', String(r.h));
  el.setAttribute('class', cls);
  return el;
}

const displayScale = () => (bitmap ? svg.getBoundingClientRect().width / bitmap.width : 1);
new ResizeObserver(() => drawOverlay()).observe(stage);

// ---- pointer editing -------------------------------------------------------

type Drag =
  | { kind: 'move' | 'resize'; start: Pt; orig: Rect; handle?: Handle; id: number; started: boolean }
  | { kind: 'draw'; start: Pt; draft: SVGRectElement };
type Pt = { x: number; y: number };
let drag: Drag | null = null;

function toImage(e: PointerEvent): Pt {
  const b = svg.getBoundingClientRect();
  return { x: ((e.clientX - b.left) / b.width) * bitmap!.width, y: ((e.clientY - b.top) / b.height) * bitmap!.height };
}

svg.addEventListener('pointerdown', (e) => {
  if (!bitmap) return;
  const target = e.target as SVGElement;
  const p = toImage(e);
  svg.setPointerCapture(e.pointerId);

  if (tool === 'add') {
    const draft = rectEl({ x: p.x, y: p.y, w: 0, h: 0 }, 'draft');
    svg.append(draft);
    drag = { kind: 'draw', start: p, draft };
    return;
  }
  const handle = target.dataset.handle as Handle | undefined;
  const id = handle ? selectedId : target.dataset.id ? Number(target.dataset.id) : null;
  const region = regions.find((r) => r.id === id);
  if (!region) {
    selectedId = null;
    changed();
    return;
  }
  selectedId = region.id;
  drag = { kind: handle ? 'resize' : 'move', start: p, orig: { ...region }, handle, id: region.id, started: false };
  changed();
});

svg.addEventListener('pointermove', (e) => {
  if (!drag || !bitmap) return;
  const p = toImage(e);
  const W = bitmap.width;
  const H = bitmap.height;

  if (drag.kind === 'draw') {
    const r = normalized(drag.start, p, W, H);
    drag.draft.setAttribute('x', String(r.x));
    drag.draft.setAttribute('y', String(r.y));
    drag.draft.setAttribute('width', String(r.w));
    drag.draft.setAttribute('height', String(r.h));
    return;
  }

  const d = drag;
  const region = regions.find((r) => r.id === d.id);
  if (!region) return;
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (!drag.started) {
    if (Math.hypot(dx, dy) * displayScale() < 3) return; // ignore click jitter
    checkpoint();
    drag.started = true;
  }
  const o = drag.orig;
  if (drag.kind === 'move') {
    region.x = clamp(o.x + dx, 0, W - o.w);
    region.y = clamp(o.y + dy, 0, H - o.h);
  } else {
    const h = drag.handle!;
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (h.includes('w')) x1 = clamp(o.x + dx, 0, x2 - MIN_SIZE);
    if (h.includes('e')) x2 = clamp(x2 + dx, x1 + MIN_SIZE, W);
    if (h.includes('n')) y1 = clamp(o.y + dy, 0, y2 - MIN_SIZE);
    if (h.includes('s')) y2 = clamp(y2 + dy, y1 + MIN_SIZE, H);
    Object.assign(region, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  region.source = 'manual';
  changed();
});

function endDrag(e: PointerEvent) {
  if (!drag || !bitmap) return;
  if (drag.kind === 'draw') {
    const r = normalized(drag.start, toImage(e), bitmap.width, bitmap.height);
    drag.draft.remove();
    if (Math.min(r.w, r.h) * displayScale() >= 10) {
      checkpoint();
      const region: Region = { id: nextId++, source: 'manual', ...r };
      regions.push(region);
      selectedId = region.id;
      setTool('select');
    }
    changed();
  }
  drag = null;
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

function normalized(a: Pt, b: Pt, W: number, H: number): Rect {
  const x1 = clamp(Math.min(a.x, b.x), 0, W);
  const y1 = clamp(Math.min(a.y, b.y), 0, H);
  return { x: x1, y: y1, w: clamp(Math.max(a.x, b.x), 0, W) - x1, h: clamp(Math.max(a.y, b.y), 0, H) - y1 };
}

function setTool(t: typeof tool) {
  tool = t;
  $('tool-select').setAttribute('aria-pressed', String(t === 'select'));
  $('tool-add').setAttribute('aria-pressed', String(t === 'add'));
  stage.classList.toggle('adding', t === 'add');
}

function removeSelected() {
  if (selectedId === null) return;
  checkpoint();
  regions = regions.filter((r) => r.id !== selectedId);
  selectedId = null;
  changed();
}

// ---- detection -------------------------------------------------------------

function applyDetections() {
  if (!analysis) return;
  const manual = regions.filter((r) => r.source === 'manual');
  const found = analysis.faces(settings.threshold).filter((f) => manual.every((m) => iou(m, f) < 0.2));
  regions = [...manual, ...found.map<Region>((f) => ({ id: nextId++, source: 'auto', x: f.x, y: f.y, w: f.w, h: f.h }))];
  changed();
}

async function detect() {
  if (!bitmap) return;
  const run = ++detectRun;
  $<HTMLButtonElement>('detect').disabled = true;
  setStatus('Detecting faces… (the first run also loads the model)');
  try {
    const result = await analyze(bitmap, bitmap.width, bitmap.height);
    if (run !== detectRun) return;
    analysis = result;
    checkpoint();
    applyDetections();
  } catch (err) {
    console.error(err);
    if (run === detectRun) setStatus('Face detection failed. You can still add blurs by hand.');
  } finally {
    if (run === detectRun) $<HTMLButtonElement>('detect').disabled = false;
  }
}

// ---- files -----------------------------------------------------------------

async function loadFile(file: File) {
  if (!file.type.startsWith('image/')) return setStatus('That file is not an image.');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file); // honours EXIF orientation
  } catch {
    return setStatus('This browser cannot decode that image format.');
  }
  bitmap?.close();
  bitmap = bmp;
  fileName = file.name.replace(/\.[^.]+$/, '') || 'image';

  const scale = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  pristine = ctx.getImageData(0, 0, canvas.width, canvas.height);

  regions = [];
  selectedId = null;
  analysis = null;
  undoStack.length = 0;
  redoStack.length = 0;
  stage.hidden = false;
  $('empty').hidden = true;
  changed();
  await detect();
  undoStack.length = 0; // the first detection is the baseline, not an undo step
  refreshUi();
}

async function exportImage() {
  if (!bitmap) return;
  const type = $<HTMLSelectElement>('format').value;
  setStatus('Exporting at full resolution…');
  const out = new OffscreenCanvas(bitmap.width, bitmap.height);
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.drawImage(bitmap, 0, 0);
  const img = octx.getImageData(0, 0, out.width, out.height);
  for (const r of regions) applyBlur(img, r, optsFor(r));
  octx.putImageData(img, 0, 0);
  const blob = await out.convertToBlob({ type, quality: 0.92 });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}-blurred.${type === 'image/png' ? 'png' : 'jpg'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  refreshUi();
}

// ---- controls --------------------------------------------------------------

function setStatus(text: string) {
  $('count').textContent = text;
}

function refreshUi() {
  const has = bitmap !== null;
  $<HTMLButtonElement>('undo').disabled = undoStack.length === 0;
  $<HTMLButtonElement>('redo').disabled = redoStack.length === 0;
  $<HTMLButtonElement>('delete').disabled = selectedId === null;
  $<HTMLButtonElement>('export').disabled = !has;
  if (has) {
    const auto = regions.filter((r) => r.source === 'auto').length;
    setStatus(`${regions.length} blur${regions.length === 1 ? '' : 's'} (${auto} detected, ${regions.length - auto} edited or added)`);
  }
  const sel = selected();
  $<HTMLFieldSetElement>('selected').disabled = !sel;
  $('selected-hint').hidden = !!sel;
  $<HTMLSelectElement>('r-mode').value = sel?.mode ?? '';
  const rs = sel?.strength ?? settings.strength;
  $<HTMLInputElement>('r-strength').value = String(rs);
  $('o-r-strength').textContent = `${rs}${sel?.strength === undefined ? ' (global)' : ''}`;
}

/** Groups the many `input` events of one slider drag into a single undo step. */
function gesture(el: HTMLElement, fn: () => void) {
  let open = false;
  el.addEventListener('input', () => {
    if (!open) {
      checkpoint();
      open = true;
    }
    fn();
  });
  el.addEventListener('change', () => (open = false));
}

function bindSetting<K extends keyof Settings>(id: string, key: K, parse: (v: string) => Settings[K], show?: (v: Settings[K]) => string) {
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  el.value = String(key === 'threshold' ? Math.round((settings[key] as number) * 100) : settings[key]);
  const out = document.getElementById(`o-${id}`);
  const update = () => {
    settings[key] = parse(el.value);
    if (out) out.textContent = show ? show(settings[key]) : String(settings[key]);
  };
  update();
  el.addEventListener('input', () => {
    update();
    if (key === 'threshold') applyDetections();
    else changed();
  });
}

bindSetting('mode', 'mode', (v) => v as BlurMode);
bindSetting('shape', 'shape', (v) => v as Shape);
bindSetting('strength', 'strength', Number, (v) => `${v}`);
bindSetting('padding', 'padding', Number, (v) => `${v}%`);
bindSetting('feather', 'feather', Number, (v) => `${v}%`);
bindSetting('threshold', 'threshold', (v) => Number(v) / 100, (v) => `${Math.round(v * 100)}%`);

$('r-mode').addEventListener('change', (e) => {
  const sel = selected();
  if (!sel) return;
  checkpoint();
  sel.mode = ((e.target as HTMLSelectElement).value || undefined) as BlurMode | undefined;
  sel.source = 'manual';
  changed();
});
gesture($('r-strength'), () => {
  const sel = selected();
  if (!sel) return;
  sel.strength = Number($<HTMLInputElement>('r-strength').value);
  sel.source = 'manual';
  changed();
});
$('r-reset').addEventListener('click', () => {
  const sel = selected();
  if (!sel) return;
  checkpoint();
  delete sel.mode;
  delete sel.strength;
  changed();
});

$('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) void loadFile(input.files[0]);
  input.value = '';
});
$('detect').addEventListener('click', () => {
  // Re-run from the cached analysis if we have one; manual blurs are kept either way.
  if (analysis) {
    checkpoint();
    applyDetections();
  } else void detect();
});
$('tool-select').addEventListener('click', () => setTool('select'));
$('tool-add').addEventListener('click', () => setTool('add'));
$('delete').addEventListener('click', removeSelected);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('export').addEventListener('click', () => void exportImage());

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeSelected();
  } else if (e.key === 'Escape') {
    selectedId = null;
    setTool('select');
    changed();
  } else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
  else if (!mod && e.key.toLowerCase() === 'a') setTool('add');
});

// drag & drop
const empty = $('empty');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  empty.classList.add('dragover');
});
window.addEventListener('dragleave', () => empty.classList.remove('dragover'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  empty.classList.remove('dragover');
  const f = e.dataTransfer?.files[0];
  if (f) void loadFile(f);
});

refreshUi();
