/* 
 * 🚨 STRICT SYNC LOCK - DO NOT ALTER WITHOUT ARCHITECTURAL AUDIT 🚨
 * ----------------------------------------------------------------
 * This file is the CENTRALIZED TOKEN METADATA for Wallet and DEX.
 * Symbols, Names, and Icons MUST remain identical to prevent display conflicts.
 * 
 * If adding tokens, ENSURE both Wallet and DEX components are updated simultaneously.
 * ----------------------------------------------------------------
 *
 * ════════════════════════════════════════════════════════════════
 * 🧀 NATIVE COIN DECLARATION — IMMUTABLE
 * ════════════════════════════════════════════════════════════════
 * NCH (Native CHEESE Coin) is the ONE AND ONLY native coin of the
 * Cheese Blockchain. It has a HARD CAP of 21,000,000 NCH.
 *
 * NCH MUST NEVER be confused with, mixed with, or substituted by:
 *   ❌ USDT (Tether) — this is a BRIDGE token from external chains
 *   ❌ USDC (USD Coin) — this is a BRIDGE token from external chains
 *
 * USDT and USDC are EXTERNAL stablecoins. They are supported in the
 * wallet as BRIDGE/SWAP assets ONLY. They do NOT live natively on
 * the Cheese Blockchain and have NO supply cap relationship to NCH.
 * ════════════════════════════════════════════════════════════════
 */
/**
 * CHEESE Ecosystem Token Metadata
 * Source of truth for all token definitions, icons, and properties.
 */

// ============================================================
// 🔒 IMMUTABLE NATIVE COIN CONSTANTS — DO NOT CHANGE
// ============================================================
window.CHEESE_NATIVE_COIN = 'NCH';              // The ONLY native coin of Cheese Blockchain
window.CHEESE_NATIVE_COIN_NAME = 'Native CHEESE Coin';
window.CHEESE_NATIVE_MAX_SUPPLY = 21000000;     // 21 Million NCH — Hard Cap, like Bitcoin
window.CHEESE_NATIVE_SYMBOL = 'NCH';            // Always NCH — never USDT, never USDC
// wNCH retired — future BSC wrapped token will ship as a new audited contract
window.CHEESE_WNCH_RETIRED = true;

// ChainList-safe logo URLs — DO NOT move/rename wallet-logos files or paths
window.CHEESE_LOGO_128 = '/wallet-logos/cheese-blockchain-128.png';
window.CHEESE_LOGO_256 = '/wallet-logos/cheese-blockchain-256.png';

// ⛔ BRIDGE TOKENS — These are EXTERNAL. NOT native to Cheese Blockchain.
window.CHEESE_BRIDGE_TOKENS = ['USDT', 'USDC']; // Read-only stablecoins via bridge only
// Native DEX pool pairs (wallet + DEX must stay in sync — only NCH/USDT pool today)
window.CHEESE_NATIVE_SWAP_TOKENS = ['NCH', 'USDT'];
// ============================================================

window.CHEESE_TOKENS = {
    // ============================================================
    // 🧀 CHEESE BLOCKCHAIN — SOVEREIGN NATIVE COINS
    // NCH is the EXCLUSIVE native coin. 21M hard cap. Non-substitutable.
    // ============================================================
    NCH: {
        symbol: 'NCH',
        name: 'Native CHEESE Coin',
        fullName: 'Native CHEESE Coin (NCH)',
        icon: '🧀',
        logo: '/wallet-logos/cheese-blockchain-128.png',
        color: '#FFD700',
        isNative: true,               // ✅ THIS IS THE NATIVE COIN OF CHEESE BLOCKCHAIN
        isBridgeToken: false,         // ✅ NOT a bridge token
        maxSupply: 21000000,          // 🔒 21 Million Hard Cap — IMMUTABLE
        decimals: 6,
        chain: 'cheese',              // Lives EXCLUSIVELY on Cheese Blockchain
        swappable: true,
        bridgeOnly: false
    },
    // ============================================================
    // ⛔ EXTERNAL BRIDGE STABLECOINS
    // USDT and USDC are NOT native to Cheese Blockchain.
    // They are EXTERNAL tokens from BSC/ETH, supported via bridge ONLY.
    // These have NO relationship to the 21M NCH supply.
    // ============================================================
    USDT: {
        symbol: 'USDT',
        name: 'Tether USD (Bridge)',
        fullName: 'Tether USD — External Bridge Token',
        icon: '💵',
        logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
        color: '#26A17B',
        isNative: false,              // ⛔ NOT native to Cheese Blockchain
        isBridgeToken: true,          // ✅ Bridge/External token only
        chain: 'bridge',              // Sourced from BSC/ETH, not Cheese
        swappable: true
    },
    USDC: {
        symbol: 'USDC',
        name: 'USD Coin (Bridge)',
        fullName: 'USD Coin — External Bridge Token',
        icon: '💲',
        logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
        color: '#2775CA',
        isNative: false,              // ⛔ NOT native to Cheese Blockchain
        isBridgeToken: true,          // ✅ Bridge/External token only
        chain: 'bridge',              // Sourced from BSC/ETH, not Cheese
        swappable: false              // No USDC pool on native DEX yet — bridge/send only
    },

    // Layer 1
    BTC: { symbol: 'BTC', name: 'Bitcoin', icon: '₿', logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', color: '#F7931A' },
    ETH: { symbol: 'ETH', name: 'Ethereum', icon: '💎', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', color: '#627EEA' },
    BNB: { symbol: 'BNB', name: 'BNB Chain', icon: '🔶', logo: 'https://assets.coingecko.com/coins/images/825/small/binancecoin.png', color: '#F0B90B' },
    SOL: { symbol: 'SOL', name: 'Solana', icon: '◎', logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', color: '#9945FF' },
    XRP: { symbol: 'XRP', name: 'Ripple', icon: '✕', logo: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', color: '#23292F' },
    TRX: { symbol: 'TRX', name: 'TRON', icon: '⚡', logo: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png', color: '#FF0013' },

    // Layer 2
    MATIC: { symbol: 'MATIC', name: 'Polygon', icon: '⇅', logo: 'https://assets.coingecko.com/coins/images/4713/small/matic-token.png', color: '#8247E5' },
    ARB: { symbol: 'ARB', name: 'Arbitrum', icon: '🔵', logo: 'https://assets.coingecko.com/coins/images/16547/small/arbitrum.png', color: '#28A0F0' },

    // Meme Coins
    DOGE: { symbol: 'DOGE', name: 'Dogecoin', icon: '🐶', logo: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png', color: '#C2A633' },
    SHIB: { symbol: 'SHIB', name: 'Shiba Inu', icon: '🐕', logo: 'https://assets.coingecko.com/coins/images/11939/small/shiba.png', color: '#FFA409' },
    PEPE: { symbol: 'PEPE', name: 'Pepe', icon: '🐸', logo: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.png', color: '#3D9900' }
};

// ============================================================
// 🛡️ RUNTIME INTEGRITY GUARD
// Enforces that NCH is always the sole native coin at runtime.
// ============================================================
(function enforceNativeCoinIntegrity() {
    const NCH = window.CHEESE_TOKENS && window.CHEESE_TOKENS.NCH;
    if (!NCH || !NCH.isNative || NCH.maxSupply !== 21000000) {
        console.error('🚨 CRITICAL: NCH native coin integrity check FAILED! Token registry may be corrupted.');
        return;
    }
    const USDT = window.CHEESE_TOKENS.USDT;
    const USDC = window.CHEESE_TOKENS.USDC;
    if (USDT && USDT.isNative) {
        console.error('🚨 CRITICAL: USDT is incorrectly marked as native! Must be bridge token only.');
    }
    if (USDC && USDC.isNative) {
        console.error('🚨 CRITICAL: USDC is incorrectly marked as native! Must be bridge token only.');
    }
    console.log('✅ CHEESE Token Metadata Loaded');
    console.log(`🧀 Native Coin: ${window.CHEESE_NATIVE_COIN} | Max Supply: ${window.CHEESE_NATIVE_MAX_SUPPLY.toLocaleString()} NCH | Hard Cap: LOCKED`);
    console.log(`⛔ Bridge Tokens (NOT native): ${window.CHEESE_BRIDGE_TOKENS.join(', ')}`);
})();
