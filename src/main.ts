import './style.css';
import { applyBlur, type BlurOptions } from './blur';
import { iou } from './centerface';
import { analyze, type Analysis } from './detect';
import { DEFAULT_SETTINGS, type BlurMode, type Rect, type Region, type Settings, type Shape } from './types';
import { zip, type ZipEntry } from './zip';

const PREVIEW_MAX = 1800;
const THUMB_MAX = 192;
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
const strip = $('strip');

// ---- state -----------------------------------------------------------------

/** One opened image. Only the displayed image keeps its decoded pixels in memory. */
interface Doc {
  id: number;
  file: File;
  name: string;
  thumbUrl: string;
  status: 'pending' | 'detecting' | 'ready' | 'error';
  analysis: Analysis | null;
  regions: Region[];
  selectedId: number | null;
  undo: Region[][];
  redo: Region[][];
}

const settings: Settings = { ...DEFAULT_SETTINGS };
const docs: Doc[] = [];
let current: Doc | null = null;
let bitmap: ImageBitmap | null = null;
let pristine: ImageData | null = null;
let tool: 'select' | 'add' = 'select';
let nextRegionId = 1;
let nextDocId = 1;
let selectToken = 0;
let exporting = false;
let notice = '';

const clone = (r: Region[]) => r.map((x) => ({ ...x }));
const selected = () => current?.regions.find((r) => r.id === current?.selectedId);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const plural = (n: number, word: string) => (n > 1 ? `${word}s` : word);
const busy = (d: Doc) => d.status === 'pending' || d.status === 'detecting';

function checkpoint(d: Doc) {
  d.undo.push(clone(d.regions));
  d.redo.length = 0;
}

function undo() {
  const d = current;
  const prev = d?.undo.pop();
  if (!d || !prev) return;
  d.redo.push(clone(d.regions));
  d.regions = prev;
  changed();
}

function redo() {
  const d = current;
  const next = d?.redo.pop();
  if (!d || !next) return;
  d.undo.push(clone(d.regions));
  d.regions = next;
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

/** Applies every blur of `d` to `img`; sx/sy scale image coordinates to `img` pixels. */
function paint(img: ImageData, d: Doc, sx: number, sy: number) {
  for (const r of d.regions) applyBlur(img, { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }, optsFor(r));
}

let frame = 0;
function changed() {
  if (current && !selected()) current.selectedId = null;
  refreshUi();
  renderStrip();
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    renderPreview();
    drawOverlay();
  });
}

function renderPreview() {
  if (!pristine || !bitmap || !current) return;
  const img = new ImageData(new Uint8ClampedArray(pristine.data), pristine.width, pristine.height);
  paint(img, current, img.width / bitmap.width, img.height / bitmap.height);
  ctx.putImageData(img, 0, 0);
}

function drawOverlay() {
  svg.replaceChildren();
  if (!bitmap || !current) return;
  svg.setAttribute('viewBox', `0 0 ${bitmap.width} ${bitmap.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const hs = HANDLE_PX / displayScale();
  for (const r of current.regions) {
    const el = rectEl(r, `region ${r.source}${r.id === current.selectedId ? ' selected' : ''}`);
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

// ---- thumbnails ------------------------------------------------------------

const thumbs = new Map<number, { el: HTMLElement; btn: HTMLButtonElement; label: HTMLElement }>();

function describe(d: Doc): string {
  if (d.status === 'pending') return 'en attente';
  if (d.status === 'detecting') return 'détection…';
  if (d.status === 'error') return 'détection échouée';
  return `${d.regions.length} ${plural(d.regions.length, 'flou')}`;
}

function buildThumb(d: Doc) {
  const el = document.createElement('div');
  el.className = 'thumb';
  el.setAttribute('role', 'listitem');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'thumb-btn';
  const img = document.createElement('img');
  img.src = d.thumbUrl;
  img.alt = '';
  const label = document.createElement('span');
  label.className = 'thumb-label';
  btn.append(img, label);
  btn.addEventListener('click', () => void selectDoc(d));
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'thumb-x';
  x.textContent = '×';
  x.setAttribute('aria-label', `Retirer ${d.name}`);
  x.title = 'Retirer cette image';
  x.addEventListener('click', () => removeDoc(d));
  el.append(btn, x);
  return { el, btn, label };
}

function renderStrip() {
  strip.hidden = docs.length === 0;
  for (const [id, t] of thumbs) {
    if (!docs.some((d) => d.id === id)) {
      t.el.remove();
      thumbs.delete(id);
    }
  }
  docs.forEach((d, i) => {
    let t = thumbs.get(d.id);
    if (!t) {
      t = buildThumb(d);
      thumbs.set(d.id, t);
    }
    if (strip.children[i] !== t.el) strip.insertBefore(t.el, strip.children[i] ?? null);
    const text = describe(d);
    t.label.textContent = text;
    t.btn.setAttribute('aria-pressed', String(d === current));
    t.btn.setAttribute('aria-label', `${d.name}, ${text}`);
    t.btn.title = d.file.name;
  });
}

// ---- pointer editing -------------------------------------------------------

type Pt = { x: number; y: number };
type Drag =
  | { kind: 'move' | 'resize'; start: Pt; orig: Rect; handle?: Handle; id: number; started: boolean }
  | { kind: 'draw'; start: Pt; draft: SVGRectElement };
let drag: Drag | null = null;

function toImage(e: PointerEvent): Pt {
  const b = svg.getBoundingClientRect();
  return { x: ((e.clientX - b.left) / b.width) * bitmap!.width, y: ((e.clientY - b.top) / b.height) * bitmap!.height };
}

svg.addEventListener('pointerdown', (e) => {
  const d = current;
  if (!bitmap || !d) return;
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
  const id = handle ? d.selectedId : target.dataset.id ? Number(target.dataset.id) : null;
  const region = d.regions.find((r) => r.id === id);
  if (!region) {
    d.selectedId = null;
    changed();
    return;
  }
  d.selectedId = region.id;
  drag = { kind: handle ? 'resize' : 'move', start: p, orig: { ...region }, handle, id: region.id, started: false };
  changed();
});

svg.addEventListener('pointermove', (e) => {
  const d = current;
  if (!drag || !bitmap || !d) return;
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

  const active = drag;
  const region = d.regions.find((r) => r.id === active.id);
  if (!region) return;
  const dx = p.x - active.start.x;
  const dy = p.y - active.start.y;
  if (!active.started) {
    if (Math.hypot(dx, dy) * displayScale() < 3) return; // ignore click jitter
    checkpoint(d);
    active.started = true;
  }
  const o = active.orig;
  if (active.kind === 'move') {
    region.x = clamp(o.x + dx, 0, W - o.w);
    region.y = clamp(o.y + dy, 0, H - o.h);
  } else {
    const h = active.handle!;
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
  const d = current;
  if (!drag || !bitmap || !d) {
    drag = null;
    return;
  }
  if (drag.kind === 'draw') {
    const r = normalized(drag.start, toImage(e), bitmap.width, bitmap.height);
    drag.draft.remove();
    if (Math.min(r.w, r.h) * displayScale() >= 10) {
      checkpoint(d);
      const region: Region = { id: nextRegionId++, source: 'manual', ...r };
      d.regions.push(region);
      d.selectedId = region.id;
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
  const d = current;
  if (!d || d.selectedId === null) return;
  checkpoint(d);
  d.regions = d.regions.filter((r) => r.id !== d.selectedId);
  d.selectedId = null;
  changed();
}

// ---- detection -------------------------------------------------------------

/** Rebuilds the automatic regions from the cached analysis; manual and edited ones are kept. */
function withDetections(d: Doc) {
  if (!d.analysis) return;
  const manual = d.regions.filter((r) => r.source === 'manual');
  const found = d.analysis.faces(settings.threshold).filter((f) => manual.every((m) => iou(m, f) < 0.2));
  d.regions = [...manual, ...found.map<Region>((f) => ({ id: nextRegionId++, source: 'auto', x: f.x, y: f.y, w: f.w, h: f.h }))];
}

let pumping = false;
/** Detects faces in queued images one at a time, decoding each only while it is analysed. */
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (let d = docs.find((x) => x.status === 'pending'); d; d = docs.find((x) => x.status === 'pending')) {
      d.status = 'detecting';
      changed();
      try {
        const bmp = await createImageBitmap(d.file);
        try {
          d.analysis = await analyze(bmp, bmp.width, bmp.height);
        } finally {
          bmp.close();
        }
        withDetections(d);
        d.status = 'ready';
      } catch (err) {
        console.error(err);
        d.status = 'error';
      }
      changed();
    }
  } finally {
    pumping = false;
  }
}

// ---- files -----------------------------------------------------------------

async function makeThumb(bmp: ImageBitmap): Promise<string> {
  const s = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
}

async function addFiles(files: File[]) {
  notice = '';
  const images = files.filter((f) => f.type.startsWith('image/'));
  let unreadable = files.length - images.length;
  for (const file of images) {
    try {
      const bmp = await createImageBitmap(file); // honours EXIF orientation
      const thumbUrl = await makeThumb(bmp);
      bmp.close();
      const doc: Doc = {
        id: nextDocId++,
        file,
        name: file.name.replace(/\.[^.]+$/, '') || 'image',
        thumbUrl,
        status: 'pending',
        analysis: null,
        regions: [],
        selectedId: null,
        undo: [],
        redo: [],
      };
      docs.push(doc);
      if (!current) await selectDoc(doc);
      changed();
      void pump();
    } catch {
      unreadable++;
    }
  }
  if (unreadable) {
    notice = `${unreadable} ${plural(unreadable, 'fichier')} ${plural(unreadable, 'ignoré')} (format non pris en charge).`;
    refreshUi();
  }
}

async function selectDoc(d: Doc) {
  const token = ++selectToken;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(d.file);
  } catch {
    notice = `Impossible d'ouvrir « ${d.file.name} ».`;
    refreshUi();
    return;
  }
  if (token !== selectToken || !docs.includes(d)) {
    bmp.close();
    return;
  }
  bitmap?.close();
  bitmap = bmp;
  current = d;
  drag = null;

  const scale = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  pristine = ctx.getImageData(0, 0, canvas.width, canvas.height);

  stage.hidden = false;
  $('empty').hidden = true;
  changed();
}

function removeDoc(d: Doc) {
  const i = docs.indexOf(d);
  if (i < 0) return;
  docs.splice(i, 1);
  URL.revokeObjectURL(d.thumbUrl);
  notice = '';
  if (d !== current) return changed();
  selectToken++;
  current = null;
  const next = docs[Math.min(i, docs.length - 1)];
  if (next) return void selectDoc(next);
  showEmpty();
}

function showEmpty() {
  bitmap?.close();
  bitmap = null;
  pristine = null;
  current = null;
  stage.hidden = true;
  $('empty').hidden = false;
  changed();
}

function clearAll() {
  for (const d of docs) URL.revokeObjectURL(d.thumbUrl);
  docs.length = 0;
  selectToken++;
  notice = '';
  showEmpty();
}

function step(delta: number) {
  if (!current || docs.length < 2) return;
  const next = docs[(docs.indexOf(current) + delta + docs.length) % docs.length];
  void selectDoc(next);
}

// ---- export ----------------------------------------------------------------

function format() {
  const type = $<HTMLSelectElement>('format').value;
  return { type, ext: type === 'image/png' ? 'png' : 'jpg' };
}

async function renderToBlob(d: Doc, type: string): Promise<Blob> {
  const bmp = await createImageBitmap(d.file);
  try {
    const out = new OffscreenCanvas(bmp.width, bmp.height);
    const octx = out.getContext('2d', { willReadFrequently: true })!;
    octx.drawImage(bmp, 0, 0);
    const img = octx.getImageData(0, 0, out.width, out.height);
    paint(img, d, 1, 1);
    octx.putImageData(img, 0, 0);
    return await out.convertToBlob({ type, quality: 0.92 });
  } finally {
    bmp.close();
  }
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** An image without any blur is usually a missed detection: make the user confirm. */
function confirmUnblurred(list: Doc[]): boolean {
  const bare = list.filter((d) => d.regions.length === 0);
  if (bare.length === 0) return true;
  const what = bare.length === 1 ? `L'image « ${bare[0].file.name} » n'a aucun flou` : `${bare.length} images n'ont aucun flou`;
  return confirm(`${what} : aucun visage n'a peut-être été détecté. Exporter quand même ?`);
}

async function runExport(job: (progress: (text: string) => void) => Promise<void>) {
  exporting = true;
  refreshUi();
  try {
    await job((text) => {
      notice = text;
      refreshUi();
    });
  } catch (err) {
    console.error(err);
    notice = "L'export a échoué.";
  } finally {
    exporting = false;
    if (notice.startsWith('Export')) notice = '';
    refreshUi();
  }
}

async function exportCurrent() {
  const d = current;
  if (!d || exporting || busy(d) || !confirmUnblurred([d])) return;
  const { type, ext } = format();
  await runExport(async (progress) => {
    progress('Export en pleine résolution…');
    download(await renderToBlob(d, type), `${d.name}-flou.${ext}`);
  });
}

async function exportAll() {
  const list = [...docs];
  if (exporting || list.length === 0 || list.some(busy) || !confirmUnblurred(list)) return;
  const { type, ext } = format();
  await runExport(async (progress) => {
    const entries: ZipEntry[] = [];
    const used = new Set<string>();
    for (const [i, d] of list.entries()) {
      progress(`Export ${i + 1} sur ${list.length}…`);
      const data = new Uint8Array(await (await renderToBlob(d, type)).arrayBuffer());
      const base = d.name.replace(/[\\/]/g, '_');
      let name = `${base}-flou.${ext}`;
      for (let n = 2; used.has(name); n++) name = `${base}-flou-${n}.${ext}`;
      used.add(name);
      entries.push({ name, data });
    }
    download(new Blob([zip(entries)], { type: 'application/zip' }), 'visageflou.zip');
  });
}

// ---- controls --------------------------------------------------------------

function setStatus(text: string) {
  $('count').textContent = text;
}

function refreshUi() {
  const d = current;
  const waiting = docs.filter(busy).length;
  $<HTMLButtonElement>('undo').disabled = !d || d.undo.length === 0;
  $<HTMLButtonElement>('redo').disabled = !d || d.redo.length === 0;
  $<HTMLButtonElement>('delete').disabled = !d || d.selectedId === null;
  $<HTMLButtonElement>('detect').disabled = !d || d.status === 'detecting';
  $<HTMLButtonElement>('clear').disabled = docs.length === 0 || exporting;
  $<HTMLButtonElement>('export').disabled = !d || busy(d) || exporting;
  $<HTMLButtonElement>('export-all').disabled = docs.length < 2 || waiting > 0 || exporting;

  const parts: string[] = [];
  if (d && docs.length > 1) parts.push(`Image ${docs.indexOf(d) + 1} sur ${docs.length}`);
  if (d && !busy(d)) {
    const auto = d.regions.filter((r) => r.source === 'auto').length;
    const edited = d.regions.length - auto;
    parts.push(
      `${d.regions.length} ${plural(d.regions.length, 'flou')} (${auto} ${plural(auto, 'détecté')}, ${edited} ${plural(edited, 'modifié')} ou ${plural(edited, 'ajouté')})`,
    );
  }
  if (waiting) parts.push(`détection en cours (${waiting} ${plural(waiting, 'image')} ${plural(waiting, 'restante')})`);
  if (notice) parts.push(notice);
  setStatus(parts.join(' — '));

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
    if (!open && current) {
      checkpoint(current);
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
    if (key === 'threshold') docs.forEach(withDetections);
    changed();
  });
}

bindSetting('mode', 'mode', (v) => v as BlurMode);
bindSetting('shape', 'shape', (v) => v as Shape);
bindSetting('strength', 'strength', Number, (v) => `${v}`);
bindSetting('padding', 'padding', Number, (v) => `${v}%`);
bindSetting('feather', 'feather', Number, (v) => `${v}%`);
bindSetting('threshold', 'threshold', (v) => Number(v) / 100, (v) => `${Math.round(v * 100)}%`);

$('r-mode').addEventListener('change', (e) => {
  const d = current;
  const sel = selected();
  if (!d || !sel) return;
  checkpoint(d);
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
  const d = current;
  const sel = selected();
  if (!d || !sel) return;
  checkpoint(d);
  delete sel.mode;
  delete sel.strength;
  changed();
});

$('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (files.length) void addFiles(files);
});
$('detect').addEventListener('click', () => {
  // Re-run from the cached analysis if we have one; manual blurs are kept either way.
  const d = current;
  if (!d) return;
  if (d.analysis) {
    checkpoint(d);
    withDetections(d);
    changed();
  } else {
    d.status = 'pending';
    changed();
    void pump();
  }
});
$('tool-select').addEventListener('click', () => setTool('select'));
$('tool-add').addEventListener('click', () => setTool('add'));
$('delete').addEventListener('click', removeSelected);
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('clear').addEventListener('click', clearAll);
$('export').addEventListener('click', () => void exportCurrent());
$('export-all').addEventListener('click', () => void exportAll());

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
    if (current) current.selectedId = null;
    setTool('select');
    changed();
  } else if (e.key === 'ArrowLeft' && !mod) step(-1);
  else if (e.key === 'ArrowRight' && !mod) step(1);
  else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
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
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void addFiles(files);
});

refreshUi();
