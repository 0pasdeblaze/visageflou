// Service worker généré au build (voir vite.config.ts) : garde le site, le moteur WASM et
// le modèle en cache pour que tout fonctionne sans connexion après le premier chargement.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `visageflou-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        FILES.map(async (url) => {
          // `no-store` : jamais de copie périmée du cache HTTP, et surtout pas d'écriture dans ce
          // cache : la page télécharge les mêmes fichiers en parallèle au premier chargement, et
          // deux écritures simultanées font échouer l'une des requêtes (ERR_CACHE_WRITE_FAILURE).
          const res = await fetch(new Request(url, { cache: 'no-store' }));
          if (!res.ok) throw new Error(`${url} : ${res.status}`);
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
      // `ignoreVary` : le serveur répond avec `Vary: Accept-Encoding` (compression), ce qui empêcherait
      // la correspondance avec les copies stockées. Ce cache ne contient que nos propres fichiers.
      const hit =
        (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ??
        (req.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).pathname, { ignoreVary: true }) : undefined);
      return hit ?? fetch(req);
    })(),
  );
});
