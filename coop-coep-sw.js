/**
 * ============================================================================
 * SYSTEMA SENTINELA — SERVICE WORKER COOP / COEP (Corrigé)
 * Assure l'isolation Cross-Origin sans bloquer les flux WASM, JSON et binaires
 * ============================================================================
 */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Contournement du wrapping pour les fichiers critiques (WASM, JSON, COF, BSP)
    // pour préserver les flux de données et éviter les erreurs de streaming binaire.
    if (
        url.pathname.endsWith('.wasm') || 
        url.pathname.endsWith('.json') || 
        url.pathname.endsWith('.COF') || 
        url.pathname.endsWith('.bsp')
    ) {
        event.respondWith(
            fetch(event.request).catch(err => {
                console.error("[ServiceWorker] Erreur de récupération du fichier de données :", err);
                throw err;
            })
        );
        return;
    }

    // Gestion standard avec injection des en-têtes d'isolation pour le reste de l'application
    event.respondWith(
        fetch(event.request).then((response) => {
            if (!response || response.status === 0) return response;
            
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
            newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });
        }).catch(() => {
            return fetch(event.request);
        })
    );
});
