const CACHE_NAME = 'sentinela-v18.9-cache';

// Liste des ressources à mettre en cache pour le mode hors-ligne
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './three.min.js',
  './worker_astronomie.js',
  './WMM2025.COF',
  './flux_live.json'
];

// Installation du Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interception des requêtes réseau (Stratégie: Cache d'abord, puis Réseau)
self.addEventListener('fetch', (event) => {
  // Ignorer les requêtes vers des API externes (ex: Cloudflare, NOAA) pour le cache strict
  if (event.request.url.includes('cloudflare.com') || event.request.url.includes('swpc.noaa.gov')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          // Mettre en cache la nouvelle ressource locale si nécessaire
          if (event.request.url.startsWith('http')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        });
      });
    }).catch(() => {
      // Option de repli si le réseau échoue et que la ressource n'est pas en cache
    })
  );
});
