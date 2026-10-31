import * as ort from 'onnxruntime-web/wasm';
import { decode, type Detection } from './centerface';

ort.env.logLevel = 'error';
ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;

const MODEL_URL = `${import.meta.env.BASE_URL}models/centerface-dynamic.onnx`;
/** Longest side fed to the network; larger photos are downscaled for detection only. */
const MAX_SIDE = 2560;

let session: Promise<ort.InferenceSession> | undefined;

function getSession() {
  session ??= ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], logSeverityLevel: 3 });
  return session;
}

export interface Analysis {
  /** Faces at the given confidence, in source-image pixels. Cheap to call repeatedly. */
  faces(threshold: number): Detection[];
}

const ceil32 = (n: number) => Math.ceil(n / 32) * 32;

/** Runs CenterFace once and keeps the raw outputs so the threshold can change without re-inference. */
export async function analyze(source: CanvasImageSource, width: number, height: number): Promise<Analysis> {
  const sess = await getSession();
  const s = Math.min(1, MAX_SIDE / Math.max(width, height));
  const netW = ceil32(Math.round(width * s));
  const netH = ceil32(Math.round(height * s));

  const canvas = new OffscreenCanvas(netW, netH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, netW, netH);
  const { data } = ctx.getImageData(0, 0, netW, netH);

  // NCHW, RGB, 0..255 (no mean/scale) — matches deface's blobFromImage call.
  const plane = netW * netH;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 4];
    input[plane + i] = data[i * 4 + 1];
    input[2 * plane + i] = data[i * 4 + 2];
  }

  const out = await sess.run({ 'input.1': new ort.Tensor('float32', input, [1, 3, netH, netW]) });
  const heat = out['537'];
  const [, , h, w] = heat.dims;
  const heatmap = heat.data as Float32Array;
  const scale = out['538'].data as Float32Array;
  const offset = out['539'].data as Float32Array;
  const sx = netW / width;
  const sy = netH / height;

  return {
    faces: (threshold) =>
      decode(heatmap, scale, offset, h, w, { w: netW, h: netH }, threshold).map((d) => ({
        x: d.x / sx,
        y: d.y / sy,
        w: d.w / sx,
        h: d.h / sy,
        score: d.score,
      })),
  };
}
