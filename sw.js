const CACHE_NAME = 'sentinela-astro-v16.0';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './three.min.js',
  './vsop2013.js',
  './ElpMpp02DE_min.js',
  './worker_astronomie.js',
  './astro_engine.js',   // Généré par Emscripten
  './astro_engine.wasm'  // Généré par Emscripten
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[PWA SW] Mise en cache complète du moteur Wasm & Assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // Retourne immédiatement la version du cache
      }
      return fetch(event.request);
    })
  );
});
