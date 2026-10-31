import type { BlurMode, Rect, Shape } from './types';

/** Structural subset of ImageData so the engine runs (and is tested) without a DOM. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface BlurOptions {
  mode: BlurMode;
  strength: number;
  padding: number;
  feather: number;
  shape: Shape;
}

/** Region grown by `padding` percent per side, clipped to the image. */
export function paddedRect(r: Rect, padding: number, width: number, height: number): Rect {
  const px = (r.w * padding) / 100;
  const py = (r.h * padding) / 100;
  const x0 = Math.max(0, Math.floor(r.x - px));
  const y0 = Math.max(0, Math.floor(r.y - py));
  const x1 = Math.min(width, Math.ceil(r.x + r.w + px));
  const y1 = Math.min(height, Math.ceil(r.y + r.h + py));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Blurs `region` of `img` in place. The effect is computed on a copy of the
 * padded rectangle and blended back through a shape mask with a soft edge.
 */
export function applyBlur(img: Pixels, region: Rect, opts: BlurOptions): void {
  const box = paddedRect(region, opts.padding, img.width, img.height);
  if (box.w < 1 || box.h < 1) return;

  const patch = extract(img, box);
  const size = Math.min(box.w, box.h);
  const amount = Math.max(0, Math.min(100, opts.strength)) / 100;

  if (opts.mode === 'gaussian') {
    const radius = Math.max(1, Math.round(amount * 0.2 * size));
    for (let i = 0; i < 3; i++) boxBlur(patch, radius);
  } else if (opts.mode === 'pixelate') {
    pixelate(patch, Math.max(2, Math.round(amount * 0.25 * size)));
  } else {
    fillSolid(patch);
  }

  blend(img, patch, box, opts.shape, opts.feather / 100);
}

function extract(img: Pixels, box: Rect): Pixels {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const src = ((box.y + y) * img.width + box.x) * 4;
    out.set(img.data.subarray(src, src + box.w * 4), y * box.w * 4);
  }
  return { data: out, width: box.w, height: box.h };
}

/** Separable box blur with clamped edges, using running sums. */
function boxBlur(p: Pixels, r: number): void {
  const { width: w, height: h, data } = p;
  const tmp = new Uint8ClampedArray(data.length);
  pass(data, tmp, w, h, 4, w * 4, r);
  pass(tmp, data, h, w, w * 4, 4, r);
}

/** Blurs `lines` lines of `len` px; `step` moves along a line, `lineStep` between lines. */
function pass(src: Uint8ClampedArray, dst: Uint8ClampedArray, len: number, lines: number, step: number, lineStep: number, r: number): void {
  const n = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[base + clamp(i, 0, len - 1) * step + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = sum / n;
        sum += src[base + clamp(i + r + 1, 0, len - 1) * step + c];
        sum -= src[base + clamp(i - r, 0, len - 1) * step + c];
      }
    }
  }
}

function pixelate(p: Pixels, block: number): void {
  const { width: w, height: h, data } = p;
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const x1 = Math.min(bx + block, w);
      const y1 = Math.min(by + block, h);
      const sum = [0, 0, 0, 0];
      for (let y = by; y < y1; y++)
        for (let x = bx; x < x1; x++)
          for (let c = 0; c < 4; c++) sum[c] += data[(y * w + x) * 4 + c];
      const count = (x1 - bx) * (y1 - by);
      for (let y = by; y < y1; y++)
        for (let x = bx; x < x1; x++)
          for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = sum[c] / count;
    }
  }
}

function fillSolid(p: Pixels): void {
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = 0;
    p.data[i + 1] = 0;
    p.data[i + 2] = 0;
    p.data[i + 3] = 255;
  }
}

/** Mask coverage 0..1 at normalised coords (nx, ny in -1..1 across the box). */
export function maskAlpha(nx: number, ny: number, shape: Shape, feather: number): number {
  const d = shape === 'ellipse' ? Math.hypot(nx, ny) : Math.max(Math.abs(nx), Math.abs(ny));
  if (d >= 1) return 0;
  const inner = 1 - Math.max(0, Math.min(1, feather));
  if (d <= inner) return 1;
  return (1 - d) / (1 - inner);
}

function blend(img: Pixels, patch: Pixels, box: Rect, shape: Shape, feather: number): void {
  for (let y = 0; y < box.h; y++) {
    const ny = ((y + 0.5) / box.h) * 2 - 1;
    for (let x = 0; x < box.w; x++) {
      const a = maskAlpha(((x + 0.5) / box.w) * 2 - 1, ny, shape, feather);
      if (a <= 0) continue;
      const s = (y * box.w + x) * 4;
      const d = ((box.y + y) * img.width + box.x + x) * 4;
      for (let c = 0; c < 3; c++) img.data[d + c] = img.data[d + c] * (1 - a) + patch.data[s + c] * a;
    }
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
