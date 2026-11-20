const CACHE_NAME = 'sentinela-cache-v19.55'; // Incrémentez la version à chaque mise à jour
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './worker.js',
    './wasm_astronomie.js',
    './wasm_astronomie.wasm',
    './WMM2025.COF',
    './flux_live.json',
    './three.min.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting(); // Force l'installation immédiate du nouveau SW
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim()) // Prend le contrôle immédiat des clients ouverts
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. STRATÉGIE NETWORK-FIRST POUR LE HTML (Force la récupération de la dernière version)
    if (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname === self.registration.scope) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    return caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                })
                .catch(() => {
                    // Repli sur le cache uniquement si l'utilisateur est totalement hors-ligne
                    return caches.match(event.request);
                })
        );
        return;
    }

    // 2. STRATÉGIE STALE-WHILE-REVALIDATE POUR LES AUTRES ACTIFS (Wasm, JS, JSON, etc.)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse);
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }
            return fetch(event.request);
        })
    );
});
