// Generated at build time (see vite.config.ts): precaches the app, the WASM runtime and the
// model so everything works offline after the first load.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `visageflou-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        FILES.map(async (url) => {
          // `no-store`: the page downloads the same files in parallel on first load, and two
          // concurrent HTTP cache writes make one request fail (ERR_CACHE_WRITE_FAILURE).
          const res = await fetch(new Request(url, { cache: 'no-store' }));
          if (!res.ok) throw new Error(`${url}: ${res.status}`);
          await cache.put(url, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('visageflou-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // `ignoreVary`: the server sends `Vary: Accept-Encoding`, which would prevent matches.
      const hit =
        (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ??
        (req.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).pathname, { ignoreVary: true }) : undefined);
      return hit ?? fetch(req);
    })(),
  );
});
