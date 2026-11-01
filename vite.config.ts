import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

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

// Writes dist/sw.js from src/sw.template.js with the list of built files, so the site
// (including the 22 MB model and WASM runtime) is cached and works offline.
const offline = (): Plugin => {
  let config: ResolvedConfig;
  return {
    name: 'offline-service-worker',
    apply: 'build',
    configResolved: (c) => void (config = c),
    closeBundle() {
      const dir = config.build.outDir;
      const files = (readdirSync(dir, { recursive: true }) as string[])
        .map((f) => f.split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && statSync(join(dir, f)).isFile())
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
      const urls = [config.base, ...files.map((f) => config.base + f)];
      const template = readFileSync('src/sw.template.js', 'utf8');
      writeFileSync(
        join(dir, 'sw.js'),
        template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__FILES__', JSON.stringify(urls, null, 2)),
      );
    },
  };
};

// Cross-origin isolation lets ONNX Runtime use multiple threads.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [csp(), dropBundledWasm(), offline()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022' },
});
