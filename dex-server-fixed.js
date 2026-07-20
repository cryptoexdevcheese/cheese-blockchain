/**
 * CHEESE DEX Server
 * =================
 * Standalone DEX server that connects to the CHEESE blockchain API
 *
 * Features:
 * - Full AMM DEX with swap, liquidity, LP tokens
 * - PERSISTENT STORAGE via Firebase Firestore
 * - Connects to CHEESE blockchain for balances
 * - REAL SWAP EXECUTION logic via Blockchain Proxy
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');

// DEX modules
const CheeseDEX = require('./dex-engine');
const createDEXRoutes = require('./dex-server-routes-fixed');
const DEXFirestoreStorage = require('./dex-firestore-storage');

const app = express();
const PORT = process.env.PORT || process.env.DEX_PORT || 8080;
const BLOCKCHAIN_API = process.env.BLOCKCHAIN_API
    || process.env.BLOCKCHAIN_INTERNAL_URL
    || `http://127.0.0.1:${PORT}`;
const API_KEY = process.env.API_KEY || 'REDACTED_DEX_API_KEY';

// Liquidity Pool Credentials (LOADED SECURELY)
let LIQUIDITY_POOL_ADDRESS = '0x3801490C9f806c917b8CbA710Db9135FA3B116ae';
let LIQUIDITY_POOL_PRIVATE_KEY = process.env.LIQUIDITY_POOL_PRIVATE_KEY;

if (!LIQUIDITY_POOL_PRIVATE_KEY) {
    try {
        const fs = require('fs');
        const path = require('path');
        // Try local file LIQUIDITY-POOL-WALLET.json which is ignored in Git
        const localKeyPath = path.resolve(__dirname, 'LIQUIDITY-POOL-WALLET.json');
        const parentKeyPath = path.resolve(__dirname, '../LIQUIDITY-POOL-WALLET.json');
        
        let walletFile = null;
        if (fs.existsSync(localKeyPath)) {
            walletFile = localKeyPath;
        } else if (fs.existsSync(parentKeyPath)) {
            walletFile = parentKeyPath;
        }
        
        if (walletFile) {
            const walletData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
            if (walletData.privateKey) {
                LIQUIDITY_POOL_PRIVATE_KEY = walletData.privateKey;
                LIQUIDITY_POOL_ADDRESS = walletData.address || LIQUIDITY_POOL_ADDRESS;
                console.log('✅ Loaded Liquidity Pool credentials from local secure file:', walletFile);
            }
        }
    } catch (e) {
        console.warn('⚠️ Could not load local Liquidity Pool credentials file:', e.message);
    }
}

if (!LIQUIDITY_POOL_PRIVATE_KEY) {
    console.warn('⚠️ WARNING: LIQUIDITY_POOL_PRIVATE_KEY is not defined in environment or local files. Swaps will fail!');
}

// Firebase service account path (optional - for local development)
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || './service-account.json';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public/dex'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css') || path.endsWith('manifest.json') || path.endsWith('sw.js') || path.endsWith('service-worker.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
    }
}));

// API Key middleware for DEX endpoints
const authenticateAPI = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    // Health check doesn't need API key
    if (req.path === '/health' || req.path === '/') {
        return next();
    }

    // Exempt user-interactive GET routes (secured by signature or context checks inside handlers)
    const exemptGetPaths = [
        '/p2p/trades',
        '/p2p/trade/chat',
        '/p2p/orders',
        '/pools',
        '/market-prices',
        '/swap/quote',
        '/convert/quote',
        '/positions',
        '/health',
        '/price'
    ];

    // Exempt user-interactive POST routes (secured by cryptographic signature checks inside handlers)
    const exemptPostPaths = [
        '/swap/execute',
        '/p2p/create',
        '/p2p/accept',
        '/p2p/cancel',
        '/p2p/trade/initiate',
        '/p2p/trade/mark-paid',
        '/p2p/trade/release',
        '/p2p/trade/dispute',
        '/p2p/trade/resolve',
        '/p2p/trade/chat/send',
        '/swap/quote',
        '/liquidity/add',
        '/liquidity/remove',
        '/pools/create',
        '/pool/create',
        '/bridge/out',
        '/bridge/in'
    ];

    const cleanPath = req.path.replace(/^\/api/, '');

    const isExemptGet = exemptGetPaths.some(p => cleanPath === p || cleanPath.startsWith(`${p}/`) || cleanPath.startsWith(p));
    const isExemptPost = exemptPostPaths.some(p => cleanPath === p || cleanPath.startsWith(`${p}/`));

    if (req.method === 'GET' && isExemptGet) {
        return next();
    }
    if (req.method === 'POST' && isExemptPost) {
        return next();
    }

    if (apiKey === API_KEY) {
        next();
    } else {
        res.status(401).json({
            success: false,
            error: 'Invalid or missing API key'
        });
    }
};

app.use('/api', authenticateAPI);

// Blockchain API proxy (for balance checks, transactions)
class BlockchainProxy {
    constructor(apiUrl, apiKey, vaultAddress) {
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.vaultAddress = vaultAddress || LIQUIDITY_POOL_ADDRESS;
    }

    async request(endpoint, options = {}) {
        const url = `${this.apiUrl}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'x-api-key': this.apiKey,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        return response.json();
    }

    async getBalance(address) {
        const result = await this.request(`/api/balance/${address}`);
        return result.balance || 0;
    }

    // Record data-only transaction (e.g. metadata about swap)
    async addTransaction(tx) {
        console.log('📝 DEX Metadata Log:', tx.type);
        // We do trigger blockchain API, but 'dex_swap' might not be native. 
        // We use 'from' = userAddress if we don't have their signature here?
        // Actually this is just logging.
        return { success: true };
    }

    // SEND REAL ASSETS from Liquidity Pool to User
    async sendFromLiquidityPool(to, amount, data = {}) {
        console.log(`💸 TRANSFERRING ${amount} TO ${to} (from LP via ${this.apiUrl})...`);

        try {
            const from = LIQUIDITY_POOL_ADDRESS;
            // Fetch nonce or build transaction
            // Note: Our API endpoint /transaction takes 'privateKey' and builds/signs itself? or just signs?
            // Checking cheese-blockchain-wallet.html (Step 5284), it calls:
            // POST /transaction, body: { from, to, amount, privateKey, data }

            // This means the server endpoint handles nonces and sending? 
            // Wait, passing privateKey to remote server is BAD practice but it seems that's how the wallet logic works here?
            // "This wallet runs locally in your browser" -> it sends privateKey to API? 
            // Step 5284 line 732: body: JSON.stringify({ privateKey, ... })
            // YES. The server receives private key and constructs/signs transaction. 
            // (Not ideal security, but we follow the pattern).

            const response = await this.request('/api/vault/transfer', {
                method: 'POST',
                body: JSON.stringify({
                    to,
                    amount,
                    currency: data.currency || 'NCH',
                    data
                })
            });

            if (response.success) {
                console.log('✅ Transfer successful:', response.transaction.hash || 'ok');
                return response;
            } else {
                console.error('⚠️ Transfer failed:', response.error);
                throw new Error(response.error);
            }
        } catch (error) {
            console.error('sendFromLiquidityPool Error:', error);
            throw error;
        }
    }
}

// Global DEX instance
let dex = null;
let firestoreStorage = null;
let blockchainProxyInstance = null;

// Initialize DEX with Firestore
async function initializeDEX() {
    console.log('🚀 Initializing DEX...');

    // Initialize Firestore storage
    firestoreStorage = new DEXFirestoreStorage(SERVICE_ACCOUNT_PATH);
    const storageInitialized = await firestoreStorage.initialize();

    if (!storageInitialized) {
        console.log('⚠️ Firestore not available - using in-memory storage only');
        console.log('   (Data will be lost on restart)');
        firestoreStorage = null;
    }

    // Initialize blockchain proxy (vault address exposed for route verification)
    blockchainProxyInstance = new BlockchainProxy(BLOCKCHAIN_API, API_KEY, LIQUIDITY_POOL_ADDRESS);

    // Initialize DEX with storage
    dex = new CheeseDEX(blockchainProxyInstance, firestoreStorage);
    await dex.initialize();


    // Create all 3 initial pools - Ensure they exist
    const founderAddress = '0x9a4E604Ccef19f1ab9A4509dccB2F00D244d394E';

    console.log('');
    console.log('📈 Setting up DEX pools...');

    // Pool 1: NCH/USDT - Native coin to stablecoin
    try {
        const existingPool = dex.getPool('NCH', 'USDT');
        if (!existingPool) {
            // Updated to real market price: 1 NCH = ~$0.022
            // For 500,000 NCH, we need 11,000 USDT (500,000 * 0.022)
            await dex.createPool('NCH', 'USDT', 500000, 11000, founderAddress);
            console.log('✅ Pool created: NCH/USDT (1 NCH = $0.022)');
        } else {
            console.log('Γä╣∩╕Ł NCH/USDT pool loaded');
        }
    } catch (error) {
        if (!error.message.includes('already exists')) console.log('⚠️ NCH/USDT:', error.message);
    }

    // CRITICAL: STRICT WHITELIST - ONLY NCH/USDT ALLOWED
    // Remove ALL OTHER pools immediately upon startup
    const originalCount = dex.pools.length;

    // Filter pools: Keep ONLY if pair is NCH/USDT (order insensitive)
    dex.pools = dex.pools.filter(pool => {
        const isNchUsdt = (pool.token0 === 'NCH' && pool.token1 === 'USDT') ||
            (pool.token0 === 'USDT' && pool.token1 === 'NCH');

        if (!isNchUsdt) {
            console.log(`🗑️ PRUNING UNAUTHORIZED POOL: ${pool.token0}/${pool.token1}`);
            // Delete from storage
            if (dex.storage && dex.storage.deletePool) {
                dex.storage.deletePool(pool.id).catch(e => console.error('Error deleting pool:', e.message));
            }
            return false; // Remove from memory
        }
        return true; // Keep NCH/USDT
    });

    if (dex.pools.length < originalCount) {
        console.log(`✅ Pruned ${originalCount - dex.pools.length} unauthorized pools. Only NCH/USDT remains.`);
    }

    // Seed Initial Active P2P Orders if empty
    try {
        const p2pCol = dex.storage.collection('dex_p2p_orders');
        const p2pSnapshot = await p2pCol.where('status', '==', 'active').get();
        if (p2pSnapshot.empty || p2pSnapshot.docs.length === 0) {
            console.log('🤝 Seeding initial active P2P market orders...');
            const initialOrders = [
                {
                    creatorAddress: '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3',
                    tokenOffered: 'NCH',
                    amountOffered: 5000,
                    tokenWanted: 'USDT',
                    amountWanted: 110,
                    status: 'active',
                    createdAt: Date.now()
                },
                {
                    creatorAddress: '0x9a4E604Ccef19f1ab9A4509dccB2F00D244d394E',
                    tokenOffered: 'USDT',
                    amountOffered: 500,
                    tokenWanted: 'NCH',
                    amountWanted: 22727,
                    status: 'active',
                    createdAt: Date.now() - 3600000
                },
                {
                    creatorAddress: '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3',
                    tokenOffered: 'NCH',
                    amountOffered: 10000,
                    tokenWanted: 'USDT',
                    amountWanted: 220,
                    status: 'active',
                    createdAt: Date.now() - 7200000
                }
            ];

            for (const ord of initialOrders) {
                await p2pCol.add(ord);
            }
            console.log('✅ Initial P2P orders seeded successfully');
        }
    } catch (p2pErr) {
        console.warn('⚠️ P2P order seeding skipped:', p2pErr.message);
    }

    console.log('');
    console.log('✅ Pruned unauthorized pools. Only NCH/USDT remains. (FORCE REDEPLOY)');
    return dex;
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'CHEESE DEX',
        version: '5.1.8',
        persistence: firestoreStorage ? 'Firestore' : 'In-Memory',
        blockchainApi: BLOCKCHAIN_API,
        vaultAddress: LIQUIDITY_POOL_ADDRESS,
        pools: dex ? dex.getAllPools().length : 0,
        timestamp: Date.now()
    });
});

// Railway Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'CHEESE DEX',
        version: '5.2.8-render',
        vaultAddress: LIQUIDITY_POOL_ADDRESS
    });
});

// Mount DEX routes synchronously (they will wait for 'dex' to be non-null)
const dexRoutes = createDEXRoutes(
    () => dex,
    () => blockchainProxyInstance || new BlockchainProxy(BLOCKCHAIN_API, API_KEY, LIQUIDITY_POOL_ADDRESS),
    () => firestoreStorage
);
app.use('/api', dexRoutes);
app.use('/', dexRoutes);

// Serve DEX frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dex', 'index.html'));
});

// ========== PUBLIC PRICE ENDPOINT (No Auth Required) ==========
// This endpoint allows the wallet to fetch NCHEESE price from DEX pools
app.get('/api/dex/price/:symbol', (req, res) => {
    const symbol = req.params.symbol?.toUpperCase();

    try {
        // Get all pools
        const pools = dex.getAllPools();

        if (symbol === 'NCHEESE' || symbol === 'NCH' || symbol === 'CHEESE') {
            // Look for CHEESE/USDT or NCH/USDT pool
            const usdtPool = pools.find(p =>
                (p.token0 === 'CHEESE' && p.token1 === 'USDT') ||
                (p.token0 === 'USDT' && p.token1 === 'CHEESE') ||
                (p.token0 === 'NCH' && p.token1 === 'USDT') ||
                (p.token0 === 'USDT' && p.token1 === 'NCH')
            );

            if (usdtPool) {
                let price;
                if (usdtPool.token0 === 'USDT') {
                    price = usdtPool.reserve0 / usdtPool.reserve1;
                } else {
                    price = usdtPool.reserve1 / usdtPool.reserve0;
                }

                return res.json({
                    success: true,
                    symbol: symbol,
                    price: price,
                    source: `${usdtPool.token0}/${usdtPool.token1} pool`,
                    reserve0: usdtPool.reserve0,
                    reserve1: usdtPool.reserve1,
                    timestamp: Date.now()
                });
            }

            // Fallback: return default seed price if no pool found
            return res.json({
                success: true,
                symbol: symbol,
                price: 0.022, // Seed Price (Updated from mock $1)
                source: 'fallback (no USDT pool)',
                timestamp: Date.now()
            });
        }

        // For other tokens, try to find any pool with USDT
        const pool = pools.find(p =>
            (p.token0 === symbol && p.token1 === 'USDT') ||
            (p.token0 === 'USDT' && p.token1 === symbol)
        );

        if (pool) {
            let price;
            if (pool.token0 === 'USDT') {
                price = pool.reserve0 / pool.reserve1;
            } else {
                price = pool.reserve1 / pool.reserve0;
            }

            return res.json({
                success: true,
                symbol: symbol,
                price: price,
                source: `${pool.token0}/${pool.token1} pool`,
                timestamp: Date.now()
            });
        }

        return res.json({
            success: false,
            symbol: symbol,
            error: 'No pool found for this token',
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('Error getting price:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Start server - ONLY if run directly
if (require.main === module) {
    const server = app.listen(PORT, '0.0.0.0', async () => {
        console.log('🧀 ====================================');
        console.log('🏦 CHEESE DEX Server v2.0.5 (Middleware Mode)');
        console.log('🧀 ====================================');
        console.log(`📡 DEX running on port ${PORT}`);
        console.log(`🔗 Blockchain API: ${BLOCKCHAIN_API}`);
        console.log(`🌐 DEX UI: http://localhost:${PORT}`);
        console.log(`📈 DEX API: http://localhost:${PORT}/api/dex`);
        console.log('');

        // Initialize DEX with Firestore
        await initializeDEX();

        console.log('');
        console.log('✅ DEX is ready!');
        if (firestoreStorage && firestoreStorage.initialized) {
            console.log('💾 All data persisted to Firestore');
        }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down DEX...');
        server.close(() => {
            console.log('✅ DEX server closed');
            process.exit(0);
        });
    });
} else {
    // If required as a module, initialize DEX immediately in background
    console.log('🔄 DEX Module: Initializing in background...');
    initializeDEX().then(() => {
        console.log('✅ DEX Module: Ready!');
    }).catch(err => {
        console.error('❌ DEX Module Engine Failed:', err);
    });
}

module.exports = app;
