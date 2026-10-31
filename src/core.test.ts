import { describe, expect, it } from 'vitest';
import { decode, iou, nms } from './centerface';
import { applyBlur, maskAlpha, paddedRect, type Pixels } from './blur';

const image = (w: number, h: number, fn: (x: number, y: number) => number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
};
const px = (p: Pixels, x: number, y: number) => p.data[(y * p.width + x) * 4];
const opts = { mode: 'gaussian', strength: 60, padding: 0, feather: 0, shape: 'rect' } as const;

describe('centerface decode', () => {
  it('turns one heatmap peak into a box centred on its cell', () => {
    const h = 8, w = 8, plane = h * w;
    const heat = new Float32Array(plane);
    const scale = new Float32Array(plane * 2).fill(Math.log(4)); // exp(log 4) * 4 = 16px
    const offset = new Float32Array(plane * 2);
    heat[3 * w + 4] = 0.9; // cell (x=4, y=3)
    const [b, ...rest] = decode(heat, scale, offset, h, w, { w: 32, h: 32 }, 0.5);
    expect(rest).toHaveLength(0);
    expect(b.score).toBeCloseTo(0.9);
    expect(b.w).toBeCloseTo(16);
    expect(b.x + b.w / 2).toBeCloseTo((4 + 0.5) * 4);
    expect(b.y + b.h / 2).toBeCloseTo((3 + 0.5) * 4);
  });

  it('ignores cells at or below the threshold', () => {
    const heat = new Float32Array(16).fill(0.5);
    expect(decode(heat, new Float32Array(32), new Float32Array(32), 4, 4, { w: 16, h: 16 }, 0.5)).toEqual([]);
  });
});

describe('nms', () => {
  it('keeps the best of overlapping boxes and all disjoint ones', () => {
    const kept = nms(
      [
        { x: 0, y: 0, w: 10, h: 10, score: 0.6 },
        { x: 1, y: 1, w: 10, h: 10, score: 0.9 },
        { x: 50, y: 50, w: 10, h: 10, score: 0.7 },
      ],
      0.3,
    );
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.7]);
  });
  it('iou of identical boxes is 1, disjoint is 0', () => {
    const r = { x: 0, y: 0, w: 4, h: 4 };
    expect(iou(r, r)).toBe(1);
    expect(iou(r, { x: 9, y: 9, w: 2, h: 2 })).toBe(0);
  });
});

describe('blur engine', () => {
  const edge = () => image(40, 40, (x) => (x < 20 ? 0 : 255));

  it('smooths a hard edge inside the region only', () => {
    const img = edge();
    applyBlur(img, { x: 10, y: 10, w: 20, h: 20 }, opts);
    expect(px(img, 19, 20)).toBeGreaterThan(0);
    expect(px(img, 20, 20)).toBeLessThan(255);
    expect(px(img, 5, 20)).toBe(0); // outside untouched
    expect(px(img, 35, 20)).toBe(255);
  });

  it('leaves a flat image unchanged', () => {
    const img = image(30, 30, () => 120);
    applyBlur(img, { x: 5, y: 5, w: 20, h: 20 }, opts);
    expect(px(img, 15, 15)).toBe(120);
  });

  it('pixelate yields constant blocks', () => {
    const img = image(40, 40, (x, y) => (x * 7 + y * 13) % 256);
    applyBlur(img, { x: 0, y: 0, w: 40, h: 40 }, { ...opts, mode: 'pixelate', strength: 40 }); // block = 4
    expect(px(img, 0, 0)).toBe(px(img, 3, 3));
  });

  it('solid fills with black', () => {
    const img = image(20, 20, () => 200);
    applyBlur(img, { x: 5, y: 5, w: 10, h: 10 }, { ...opts, mode: 'solid' });
    expect(px(img, 10, 10)).toBe(0);
    expect(px(img, 1, 1)).toBe(200);
  });

  it('clips padded regions to the image and survives out-of-bounds boxes', () => {
    expect(paddedRect({ x: -5, y: -5, w: 20, h: 20 }, 50, 30, 30)).toEqual({ x: 0, y: 0, w: 25, h: 25 });
    const img = image(10, 10, () => 50);
    expect(() => applyBlur(img, { x: 100, y: 100, w: 5, h: 5 }, opts)).not.toThrow();
  });

  it('ellipse mask excludes corners; feather ramps down toward the edge', () => {
    expect(maskAlpha(0.9, 0.9, 'ellipse', 0)).toBe(0);
    expect(maskAlpha(0.9, 0.9, 'rect', 0)).toBe(1);
    expect(maskAlpha(0, 0, 'ellipse', 0.5)).toBe(1);
    expect(maskAlpha(0.75, 0, 'ellipse', 0.5)).toBeCloseTo(0.5);
  });
});
