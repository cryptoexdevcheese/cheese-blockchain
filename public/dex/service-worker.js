/**
 * Service Worker for CHEESE DEX
 * Forcing cache purge for mobile users
 */

const CACHE_NAME = 'cheese-dex-v26-546-purge';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

function isAppAsset(url) {
    if (url.origin !== self.location.origin) return false;
    const path = url.pathname;
    return (
        path.endsWith('/') ||
        path.endsWith('.html') ||
        path.endsWith('.css') ||
        path.endsWith('.js') ||
        path.endsWith('manifest.json')
    );
}

self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Never intercept API / external requests
    if (event.request.url.includes('/api/')) {
        return;
    }

    const url = new URL(event.request.url);

    if (isAppAsset(url)) {
        event.respondWith(
            fetch(new Request(event.request, { cache: 'no-cache' }))
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(fetch(event.request));
});
