// coop-coep-sw.js
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Intercepte les requêtes pour ajouter les en-têtes d'isolation si nécessaire
    event.respondWith(
        fetch(event.request).then((response) => {
            if (response.status === 0) return response;
            
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
            newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });
        }).catch((err) => {
            return fetch(event.request);
        })
    );
});
