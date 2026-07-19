/**
 * Elliptic Library Loader - Browser-compatible wrapper
 * This creates a simple UMD wrapper for elliptic in the browser
 */

(function(global) {
    'use strict';
    
    // Try to load from CDN using a script tag
    function loadEllipticFromCDN() {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (global.elliptic) {
                resolve(global.elliptic);
                return;
            }
            
            // Try multiple CDN sources - using browser-compatible bundles
            const cdnUrls = [
                'https://cdn.jsdelivr.net/npm/elliptic@6.5.4/dist/elliptic.min.js',
                'https://unpkg.com/elliptic@6.5.4/dist/elliptic.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/elliptic/6.5.4/elliptic.min.js',
                'https://cdn.jsdelivr.net/npm/elliptic@6/dist/elliptic.min.js'
            ];
            
            let currentIndex = 0;
            
            function tryNextCDN() {
                if (currentIndex >= cdnUrls.length) {
                    reject(new Error('All CDN sources failed to load elliptic'));
                    return;
                }
                
                const script = document.createElement('script');
                script.src = cdnUrls[currentIndex];
                script.async = false;
                
                script.onload = function() {
                    // Wait a bit for the library to initialize
                    setTimeout(() => {
                        if (global.elliptic) {
                            console.log('✅ Elliptic loaded from CDN:', cdnUrls[currentIndex]);
                            resolve(global.elliptic);
                        } else {
                            console.warn('⚠️ Script loaded but elliptic not found, trying next CDN...');
                            currentIndex++;
                            tryNextCDN();
                        }
                    }, 100);
                };
                
                script.onerror = function() {
                    console.warn('⚠️ CDN failed:', cdnUrls[currentIndex]);
                    currentIndex++;
                    tryNextCDN();
                };
                
                document.head.appendChild(script);
            }
            
            tryNextCDN();
        });
    }
    
    // Export the loader
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = loadEllipticFromCDN;
    } else {
        global.loadElliptic = loadEllipticFromCDN;
    }
    
})(typeof window !== 'undefined' ? window : this);

