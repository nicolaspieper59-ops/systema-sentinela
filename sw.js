/**
 * Service Worker - Systema Sentinela
 * Gestion avancée du cache : Network-First pour les données, Cache-First pour les assets.
 */

const CACHE_NAME = 'sentinela-cache-v2026.1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './worker.js',
    './meteo_manager.js',
    './wasm_astronomie.js',
    './wasm_astronomie.wasm',
    './three.min.js',
    './manifest.json',
    './WMM2025.COF'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
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
    const url = new URL(e.request.url);

    // Stratégie Network-First pour le flux dynamique JSON
    if (url.pathname.endsWith('flux_live.json')) {
        e.respondWith(
            fetch(e.request)
                .then((response) => {
                    if (!response || response.status !== 200) throw new Error('Réseau indisponible');
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Stratégie Cache-First pour tous les autres assets statiques et le WASM
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(e.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const copy = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                return networkResponse;
            });
        })
    );
});
