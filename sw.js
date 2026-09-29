/**
 * ============================================================================
 * SYSTEMA SENTINELA — SERVICE WORKER PWA & CROSS-ORIGIN ISOLATION (CORRIGÉ)
 * ============================================================================
 */

const CACHE_NAME = 'sentinela-kernel-v19.12';
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './three.min.js',
    './meteo_manager.js',
    './worker.js'
];

// 1. Installation & Précachage des ressources essentielles
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Mise en cache des ressources critiques');
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

// 2. Activation & Nettoyage des anciens caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) => {
                return Promise.all(
                    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
                );
            })
        ])
    );
});

// 3. Interception Réseau & Stratégie d'isolation
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    const pathnameLower = url.pathname.toLowerCase();

    // Traitement séparé pour les données dynamiques et flux binaires
    const isCriticalData = 
        pathnameLower.endsWith('.wasm') || 
        pathnameLower.endsWith('.json') || 
        pathnameLower.endsWith('.cof')  || 
        pathnameLower.endsWith('.bsp');

    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                if (!networkResponse || networkResponse.status === 0) {
                    return networkResponse;
                }

                // Pour les fichiers de données critiques, on met à jour le cache et on renvoie
                if (isCriticalData) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
                    return networkResponse;
                }

                // Pour le reste (HTML, JS, CSS), on injecte les en-têtes d'isolation requis
                const newHeaders = new Headers(networkResponse.headers);
                
                // Uniquement sur les documents HTML principaux
                if (networkResponse.headers.get('content-type')?.includes('text/html')) {
                    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
                    newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
                }
                
                // En-tête universel pour permettre le chargement croisé des sous-ressources
                newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

                const modifiedResponse = new Response(networkResponse.body, {
                    status: networkResponse.status,
                    statusText: networkResponse.statusText,
                    headers: newHeaders
                });

                // Copie dans le cache pour accès hors ligne
                const cacheClone = modifiedResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, cacheClone));

                return modifiedResponse;
            })
            .catch(async () => {
                // Secours hors ligne (Offline First) en cas de rupture de réseau
                const cachedResponse = await caches.match(request);
                if (cachedResponse) return cachedResponse;
                
                console.error(`[SW] Ressource introuvable hors ligne : ${request.url}`);
            })
    );
});
