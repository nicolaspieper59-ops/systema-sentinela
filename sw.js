const CACHE_NAME = 'sentinela-v19.30';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './worker.js',
    './wasm_astronomie.js',
    './wasm_astronomie.wasm',
    './flux_live.json',
    './WMM2025.COF',
    './meteo_manager.js',
    './three.min.js'
];
// Installation du Service Worker et mise en cache des actifs
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// Activation et nettoyage strict des anciens caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Suppression de l\'ancien cache obsolète :', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Interception des requêtes avec stratégie hybride (Réseau d'abord pour le code, Cache pour les ressources statiques)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. Ne jamais mettre en cache le flux live dynamique ni le worker pour garantir la fraîcheur
    if (url.pathname.includes('flux_live.json') || url.pathname.includes('worker.js')) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // 2. Pour le reste des fichiers : Cache d'abord, avec mise à jour en arrière-plan
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Optionnel : onfetch met à jour le cache en arrière-plan discrètement
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
