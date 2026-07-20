// CRITICAL: V27 - BUTTON FIX + SHOWSCREEN METHOD - MAY 6 2026
// Force clear ALL old caches
const CACHE_NAME = 'cheese-wallet-v6.1.0';
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './blockchain-api.js',
    './wallet-core.js',
    './fiat-gateway.js',
    './swap-engine.js',
    './connect-manager.js',
    './wallet-enhancements.js',
    './wallet-security.js',
    './token-manager.js',
    './token-search.js', // CRITICAL: Added token-search.js to cache
    './mobile-miner.js',
    './bsc-verifier.js',
    './founder-income.js',
    './cross-chain-balance.js',
    './elliptic-loader.js',
    './manifest.json'
];

// Install
self.addEventListener('install', event => {
    self.skipWaiting(); // Moved skipWaiting to the beginning
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Opened cache'); // Changed log message
            return cache.addAll(urlsToCache);
        })
        // Removed the .catch block from install
    );
});

// Activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete ALL old caches to force fresh start
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            // CRITICAL: Force clear all caches and reload clients
            return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
                clients.forEach(client => {
                    /* 
                    // CRITICAL: DISABLED TO PREVENT REFRESH LOOPS
                    client.postMessage({
                        type: 'CLEAR_PRICE_CACHE',
                        action: 'clearNCHEESEPrice',
                        forceReload: false // Changed to false
                    });
                    */
                });
            });
        }).then(() => {
            // Immediately claim clients to activate new service worker
            return self.clients.claim();
        })
    );
    // Skip waiting to activate immediately
    self.skipWaiting();
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

// Fetch - Network first strategy for better updates
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Never intercept API / external requests — let the browser handle them directly
    if (event.request.url.includes('cheese-blockchain') ||
        event.request.url.includes('moonpay') ||
        event.request.url.includes('ramp') ||
        event.request.url.includes('coingecko') ||
        event.request.url.includes('bscscan') ||
        event.request.url.includes('/api/')) {
        return;
    }

    const url = new URL(event.request.url);

    if (isAppAsset(url)) {
        event.respondWith(
            fetch(new Request(event.request, { cache: 'no-cache' }))
                .then((response) => {
                    // If network succeeds, update cache
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(event.request) || (event.request.headers.get('accept')?.includes('text/html') ? caches.match('./index.html') : null);
                })
        );
        return;
    }

    // For other files, standard matching
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                return response;
            });
        })
    );
});

