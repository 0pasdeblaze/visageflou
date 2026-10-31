import type { Rect } from './types';

export interface Detection extends Rect {
  score: number;
}

/**
 * Decodes the CenterFace heatmap/scale/offset outputs into boxes, following
 * the reference implementation in deface (centerface.py). Output stride is 4.
 * All tensors are [1, C, h, w] flattened; `size` is the network input size.
 */
export function decode(
  heatmap: Float32Array,
  scale: Float32Array,
  offset: Float32Array,
  h: number,
  w: number,
  size: { w: number; h: number },
  threshold: number,
): Detection[] {
  const plane = h * w;
  const boxes: Detection[] = [];
  for (let i = 0; i < plane; i++) {
    const score = heatmap[i];
    if (score <= threshold) continue;
    const cy = Math.floor(i / w);
    const cx = i % w;
    const sh = Math.exp(scale[i]) * 4;
    const sw = Math.exp(scale[plane + i]) * 4;
    const oy = offset[i];
    const ox = offset[plane + i];
    const x1 = Math.min(Math.max(0, (cx + ox + 0.5) * 4 - sw / 2), size.w);
    const y1 = Math.min(Math.max(0, (cy + oy + 0.5) * 4 - sh / 2), size.h);
    const x2 = Math.min(x1 + sw, size.w);
    const y2 = Math.min(y1 + sh, size.h);
    boxes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, score });
  }
  return nms(boxes, 0.3);
}

export function nms(boxes: Detection[], iouThreshold: number): Detection[] {
  const order = [...boxes].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const b of order) {
    if (kept.every((k) => iou(k, b) < iouThreshold)) kept.push(b);
  }
  return kept;
}

export function iou(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}
