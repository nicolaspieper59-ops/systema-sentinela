const CACHE_NAME = 'sentinela-cache-v19.12';
const ASSETS = [
    './',
    './index.html',
    './meteo_manager.js',
    './worker.js',
    './three.min.js',
    './manifest.json',
    './flux_live.json',
    './WMM2025.COF'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(e.request).catch(() => {
                // Secours hors-ligne
            });
        })
    );
});
