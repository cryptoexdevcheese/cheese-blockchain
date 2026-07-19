/* 
 * 🚨 STRICT SYNC LOCK - DO NOT ALTER WITHOUT ARCHITECTURAL AUDIT 🚨
 * ----------------------------------------------------------------
 * This file is the UNIFIED SOURCE OF TRUTH for the CHEESE Ecosystem.
 * Altering this file without updating all dependent components (Wallet, DEX, Explorer, Mining)
 * will cause critical inconsistencies and data fetching conflicts.
 * 
 * PROTECTED BY: Ecosystem Synchronization Lockdown (v1.1.5)
 * ----------------------------------------------------------------
 */
// Unified CHEESE Ecosystem Configuration
// Source of Truth for all frontend components (Wallet, DEX, Explorer, Mining)


(function () {
    const isLocalhost = window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

    // Always use same origin so local dev works on any port (8788, 8080, etc.)
    const origin = window.location.origin;

    window.CHEESE_CONFIG = {
        // Main Blockchain API (same origin — wallet, DEX, and API share one Node server)
        API_URL: origin,

        // DEX Backend API (path-based routing on same domain)
        DEX_API_URL: `${origin}/dex`,

        // Default API Key for public/readonly calls
        API_KEY: 'REDACTED_DEX_API_KEY',

        // Versioning for Cache Busting
        VERSION: '4.2.2'
    };

    console.log('✅ Unified CHEESE Configuration Loaded:', window.CHEESE_CONFIG);
})();

