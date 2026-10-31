import { defineConfig, type Plugin } from 'vite';

// Same policy the Caddyfile sends as a header; the meta copy keeps it in force
// if the built site is opened from disk or served by something else.
// 'self' for connect-src is only needed to load the model and WASM runtime.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// ONNX Runtime's bundle makes Vite emit its own copy of the WASM; we load ours
// from public/ort via env.wasm.wasmPaths, so drop the unused 14 MB duplicate.
const dropBundledWasm = (): Plugin => ({
  name: 'drop-bundled-wasm',
  generateBundle(_, bundle) {
    for (const key of Object.keys(bundle)) if (key.endsWith('.wasm')) delete bundle[key];
  },
});

// Cross-origin isolation lets ONNX Runtime use multiple threads.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [csp(), dropBundledWasm()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022' },
});
