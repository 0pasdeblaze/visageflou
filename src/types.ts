export type BlurMode = 'gaussian' | 'pixelate' | 'solid';
export type Shape = 'ellipse' | 'rect';

/** Axis-aligned box in source-image pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region extends Rect {
  id: number;
  source: 'auto' | 'manual';
  /** Per-region overrides; undefined means "use the global setting". */
  mode?: BlurMode;
  strength?: number;
}

export interface Settings {
  mode: BlurMode;
  /** 0..100, relative to the region size so the look is resolution independent. */
  strength: number;
  /** Extra margin around each region, % of its size per side. */
  padding: number;
  /** 0..100, width of the soft edge as % of the region radius. */
  feather: number;
  shape: Shape;
  /** Detection confidence threshold, 0..1. */
  threshold: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'gaussian',
  strength: 60,
  padding: 20,
  feather: 25,
  shape: 'ellipse',
  threshold: 0.5,
};
