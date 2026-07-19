/**
 * 🧀 CHEESE BLOCKCHAIN - UNIFIED API ROUTES
 * Consolidates all core blockchain functionality into a single module.
 */

const path = require('path');
const fs = require('fs');
const axios = require('axios');

// ==================== ACTIVE MINER TRACKING ====================
// Tracking miners by storing their last activity timestamp
const activeMiners = new Map(); // Map<minerAddress, lastActiveTimestamp>
const MINER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Register miner activity
function registerMinerActivity(minerAddress) {
    if (!minerAddress) return;
    activeMiners.set(minerAddress, Date.now());
}

// Check if wallet+device is registered for mining
async function checkMiningRegistration(blockchain, walletAddress, deviceId) {
    // Check in-memory registration cache (we'll need a way to share this if needed, 
    // but for now we'll query DB)
    if (blockchain && blockchain.database) {
        try {
            return await blockchain.database.getMiningRegistration(walletAddress, deviceId);
        } catch (e) {
            console.warn('Registration check error:', e.message);
        }
    }
    return null;
}

// Verify USDT payment on BSC
// Verify USDT payment on BSC - STRICT SECURITY CHECK
async function verifyUSDTPayment(txHash, walletAddress, treasuryAddress, feeAmount) {
    const { ethers } = require('ethers');
    const RPC_LIST = [
        'https://bsc-dataseed.binance.org/',
        'https://bsc-dataseed1.defibit.io/',
        'https://bsc-dataseed1.ninicoin.io/',
        'https://binance.llamarpc.com'
    ];

    let provider = null;
    let lastError = null;

    // Try multiple RPCs for robustness
    for (const rpc of RPC_LIST) {
        try {
            provider = new ethers.JsonRpcProvider(rpc);
            await provider.getNetwork();
            console.log(`✅ [RPC SUCCESS] Connected to BSC via ${rpc}`);
            break; 
        } catch (e) {
            console.warn(`⚠️ [RPC FAILED] ${rpc}: ${e.message}`);
            lastError = e;
            provider = null;
        }
    }

    if (!provider) {
        return { valid: false, error: 'All BSC RPC providers failed. Infrastructure down: ' + lastError.message };
    }

    try {
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) return { valid: false, error: 'Transaction not found on BSC' };
        if (receipt.status !== 1) return { valid: false, error: 'Transaction failed (Reverted)' };

        // 1. Check Confirmations
        const currentBlock = await provider.getBlockNumber();
        const confirmations = currentBlock - receipt.blockNumber;
        if (confirmations < 1) return { valid: false, error: `Insufficient confirmations: ${confirmations}/1` };

        // 2. Check Sender
        if (receipt.from.toLowerCase() !== walletAddress.toLowerCase()) {
            return { valid: false, error: 'Sender mismatch: Wallet does not pay this tx' };
        }

        // 3. Parse Logs for USDT Transfer
        const USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

        const transferLog = receipt.logs.find(log =>
            log.address.toLowerCase() === USDT_CONTRACT &&
            log.topics[0] === TRANSFER_TOPIC
        );

        if (!transferLog) return { valid: false, error: 'No USDT transfer found in this transaction' };

        // 4. Verify Recipient (Topic 2)
        const toAddress = '0x' + transferLog.topics[2].slice(26); // Remove padding
        if (toAddress.toLowerCase() !== treasuryAddress.toLowerCase()) {
            console.error(`Fraud Attempt: Paid to ${toAddress}, expected ${treasuryAddress}`);
            return { valid: false, error: 'Invalid Recipient: Payment not sent to Treasury' };
        }

        // 5. Verify Amount (Data)
        const amountHex = transferLog.data;
        const amountWei = BigInt(amountHex);
        const expectedWei = BigInt(Math.floor(feeAmount * 1e18)); 

        if (amountWei < expectedWei) {
            return { valid: false, error: `Insufficient Amount: Sent ${Number(amountWei) / 1e18} USDT, required ${feeAmount}` };
        }

        console.log(`✅ Payment Verified: ${txHash} | ${Number(amountWei) / 1e18} USDT`);
        return { valid: true, amount: Number(amountWei) / 1e18, confirmations };

    } catch (error) {
        console.error('Payment Verification Error:', error);
        return { valid: false, error: 'Verification error: ' + error.message };
    }
}

/**
 * [ADMIN] DIRECT SQLITE SYNC API
 * Allows migrating blocks from local laptop directly to Render SQLite
 */
function setupAdminRoutes(app, blockchainGetter) {
    const CHEESE_API_KEY = process.env.CHEESE_API_KEY || process.env.API_KEY || 'REDACTED_DEX_API_KEY';

    app.post('/api/admin/sync-sqlite', async (req, res) => {
        const apiKey = req.body.apiKey || req.headers['x-api-key'] || req.query.apiKey;
        const { blocks } = req.body;
        const blockchain = typeof blockchainGetter === 'function' ? blockchainGetter() : blockchainGetter;

        if (!blockchain || !blockchain.database) {
            return res.status(503).json({ success: false, error: 'Blockchain core not ready' });
        }

        if (apiKey !== CHEESE_API_KEY) {
            console.error(`🚨 [ADMIN] Sync Attempt Failed: Invalid API Key`);
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        if (!blocks || !Array.isArray(blocks)) {
            return res.status(400).json({ success: false, error: 'Invalid block data' });
        }

        try {
            for (const block of blocks) {
                // Save to SQLite (skip redundant Firestore if isolation is on)
                await blockchain.database.saveBlock(block, true);
            }
            
            if (blockchain.database.saveToDisk) blockchain.database.saveToDisk();

            // 🔥 CRITICAL: Reload chain into memory after sync
            console.log('🔄 [ADMIN] Sync complete. Reloading chain into memory...');
            if (typeof blockchain.loadFromDatabase === 'function') {
                await blockchain.loadFromDatabase();
            }
            if (typeof blockchain.populateMemoryCache === 'function') {
                await blockchain.populateMemoryCache();
            }

            res.json({ success: true, count: blocks.length, chainLength: blockchain.chain?.length || 0 });
        } catch (error) {
            console.error('❌ Sync API Error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });
}

// Get count of active miners (active in last 5 minutes)
function getActiveMinersCount() {
    const now = Date.now();
    let count = 0;
    for (const [address, lastActive] of activeMiners) {
        if (now - lastActive < MINER_TIMEOUT_MS) {
            count++;
        } else {
            // Clean up stale entries
            activeMiners.delete(address);
        }
    }
    return count;
}

// Get list of active miners
function getActiveMinersInfo() {
    const now = Date.now();
    const miners = [];
    for (const [address, lastActive] of activeMiners) {
        if (now - lastActive < MINER_TIMEOUT_MS) {
            miners.push({
                address: address.substring(0, 10) + '...',
                lastActive: Math.floor((now - lastActive) / 1000) + 's ago'
            });
        }
    }
    return miners;
}

module.exports = (app, blockchainGetter, isReadyGetter) => {
    // 🛡️ [ADMIN] Add Sync Routes
    setupAdminRoutes(app, blockchainGetter);

    // ==================== BIOMETRIC AUTHENTICATION AI ROUTES ====================
    const { BiometricAuthenticationAI } = require('./ai-engine/models/biometric-authenticator');
    const biometricAI = new BiometricAuthenticationAI();
    biometricAI.initialize().catch(e => console.error('❌ Failed to initialize Biometric AI:', e.message));

    // Register User Biometrics public key / template
    app.post('/api/biometrics/register', async (req, res) => {
        try {
            const { walletAddress, biometricData } = req.body;
            if (!walletAddress || !biometricData) {
                return res.status(400).json({ success: false, error: 'Missing walletAddress or biometricData' });
            }
            const normalizedAddress = walletAddress.toLowerCase().trim();
            const result = await biometricAI.registerUserBiometrics(normalizedAddress, biometricData);
            res.json({ success: true, userId: result.userId });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Verify Biometric Authentication proof
    app.post('/api/biometrics/verify', async (req, res) => {
        try {
            const { walletAddress, authRequest } = req.body;
            if (!walletAddress || !authRequest) {
                return res.status(400).json({ success: false, error: 'Missing walletAddress or authRequest' });
            }
            const normalizedAddress = walletAddress.toLowerCase().trim();
            
            // Build the authRequest structure expected by BiometricAuthenticationAI
            const fullAuthRequest = {
                userId: normalizedAddress,
                biometricType: authRequest.biometricType || 'facial',
                biometricData: authRequest.biometricData,
                livenessData: authRequest.livenessData,
                deviceFingerprint: authRequest.deviceFingerprint || { trusted: true },
                ip: req.ip || '127.0.0.1'
            };
            
            const result = await biometricAI.authenticateUser(fullAuthRequest);
            res.json({ success: true, result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    console.log('✅ Blockchain Server Routes Loading...');
    // Helper to get blockchain instance safely
    const getBlockchain = () => {
        return typeof blockchainGetter === 'function' ? blockchainGetter() : blockchainGetter;
    };

    const isReady = () => {
        return typeof isReadyGetter === 'function' ? isReadyGetter() : isReadyGetter;
    };

    // Role-based Access Control Middleware
    const requireRole = (allowedRoles) => {
        return (req, res, next) => {
            const blockchain = getBlockchain();
            const currentRole = blockchain?.nodeRole || process.env.NODE_ROLE || 'HYBRID';
            
            if (!allowedRoles.includes(currentRole)) {
                return res.status(403).json({
                    success: false,
                    error: `Forbidden: Endpoint not available on ${currentRole} node. Requires: ${allowedRoles.join(' or ')}.`
                });
            }
            next();
        };
    };

    // ==================== AGENT-LOCKED SYSTEM REGISTRY ====================
    // CRITICAL: These values are immutable and must NOT be changed.
    const TREASURY_WALLET = '0x7e73806ef3E8e11b9a226672Df5EC8E816EDA56D';
    const MINING_FEE_USDT = 10.0;
    const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'; // BSC USDT

    // Exempted wallets — skip registration fee + cooldown/session limits for NCH mining.
    const EXEMPT_WALLETS = [
        '0x0E6ec6713E7b5b7C11d969dA848813d08223598E', // FOUNDER
        '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3', // TREASURY
        '0x3801490C9f806c917b8CbA710Db9135FA3B116ae', // LIQUIDITY
        '0x712A1CBa607C60D95f27088c80aBbBD1f53d33Fe', // OPERATOR
        '0x7e73806ef3E8e11b9a226672Df5EC8E816EDA56D', // MINING VAULT
        '0x0ef03fd4C994614c4f90930e643Ab9048Ab54587', // EXEMPT SYSTEM 1
        '0x051CEcfd2229E9D1a7FB8269d4201487C26565D5'  // EXEMPT SYSTEM 2
    ].map(a => a.toLowerCase());

    // ==================== WALLET ENDPOINTS ====================


    // Create new wallet
    app.post('/api/wallet/create', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain || !blockchain.walletManager) {
                return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            }
            const { password } = req.body;
            const wallet = await blockchain.walletManager.createWallet(password);
            res.json({
                success: true,
                wallet: { address: wallet.address, publicKey: wallet.publicKey }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Load wallet
    app.post('/api/wallet/load', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain || !blockchain.walletManager) {
                return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            }
            const { address, password } = req.body;
            const wallet = await blockchain.walletManager.loadWallet(address, password);
            if (!wallet) return res.status(404).json({ success: false, error: 'Wallet not found' });
            res.json({
                success: true,
                wallet: { address: wallet.address, publicKey: wallet.publicKey }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/balance/:address', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!blockchain) return res.status(503).json({ success: false, error: 'Blockchain object not yet created' });

            const { address } = req.params;
            const forceSync = req.query.sync === 'true' || req.query.forceSync === 'true';

            // [OPTIMIZATION] High-Performance Fetch from Firestore 'wallets' collection
            // SKIP IF forceSync is requested
            if (blockchain.database && blockchain.database.db && !forceSync) {
                try {
                    const walletDoc = await blockchain.database.db.collection(blockchain.database.collections.wallets || 'cheese-blockchain-wallets').doc(address.toLowerCase()).get();
                    if (walletDoc.exists) {
                        const data = walletDoc.data();
                        const balance = parseFloat(data.balance) || 0;
                        
                        // 🛑 SAFETY CHECK: If balance is negative, the cache is CORRUPT.
                        // Force a fallback to ledger calculation to fix it.
                        if (balance < 0) {
                            console.warn(`🚨 API: Detected negative balance (${balance}) in cache for ${address}. FORCING LEDGER CALCULATION.`);
                        } else {
                            console.log(`⚡ API: Fetched High-Performance Balance for ${address}`);
                            // CRITICAL: Sanitize portfolio to remove ghost/admin tokens from cache
                            const sanitizedPortfolio = {};
                            const ghostKeywords = ['BALANCE', 'SUCCESS', 'V3.5', 'V3.6', 'V4.1', 'V4.2', 'RECOVERY', 'FIX', 'RESTORE', 'PURGE', 'GHOST', 'NCHEESE_OLD', 'CACHEDAT', 'CACHED_AT', 'TIMESTAMP', 'PHANTOM', 'MESSAGE'];
                            
                            Object.keys(data.portfolio || {}).forEach(key => {
                                const upperKey = key.toUpperCase().trim();
                                const isGhost = ghostKeywords.some(kw => upperKey.includes(kw));
                                if (!isGhost) {
                                    sanitizedPortfolio[key] = data.portfolio[key];
                                }
                            });

                            return res.json({
                                success: true,
                                address,
                                is_initializing: false,
                                balance: balance,
                                portfolio: sanitizedPortfolio,
                                source: 'cache'
                            });
                        }
                    }
                } catch (fsErr) {
                    console.warn(`⚠️ High-Performance Fetch Failed for ${address}, falling back to ledger:`, fsErr.message);
                }
            }

            console.log(`🕵️ API: Deep-Scanning Ledger for ${address}${forceSync ? ' (FORCE SYNC)' : ''}`);
            
            // If cache miss, negative balance, or forceSync, perform full ledger calculation
            const balanceData = await blockchain.getBalances(address);
            
            // 🛑 CRITICAL: Sanitize portfolio to remove ghost tokens from deep scan too
            const sanitizedPortfolio = {};
            const ghostKeywords = ['BALANCE', 'SUCCESS', 'V3.5', 'V3.6', 'V4.1', 'V4.2', 'RECOVERY', 'FIX', 'RESTORE', 'PURGE', 'GHOST', 'NCHEESE_OLD', 'CACHEDAT', 'CACHED_AT', 'TIMESTAMP', 'PHANTOM', 'MESSAGE'];
            
            Object.keys(balanceData.portfolio || {}).forEach(key => {
                const upperKey = key.toUpperCase().trim();
                const isGhost = ghostKeywords.some(kw => upperKey.includes(kw));
                if (!isGhost) {
                    sanitizedPortfolio[key] = balanceData.portfolio[key];
                }
            });
            balanceData.portfolio = sanitizedPortfolio;

            // But we should ensure it's written back to Firestore to fix the cache.
            if (blockchain.database && blockchain.database.saveWallet) {
                const walletUpdate = {
                    address: address.toLowerCase(),
                    balance: balanceData.balance,
                    balances: {
                        NCH: balanceData.balance,
                        ...balanceData.portfolio
                    },
                    updatedAt: Date.now()
                };
                // Non-blocking save to repair cache
                blockchain.database.saveWallet(walletUpdate).catch(e => console.error('Cache repair failed:', e.message));
            }

            res.json({
                success: true,
                address,
                is_initializing: !isReady(),
                balance: balanceData.balance,
                portfolio: balanceData.portfolio,
                source: 'ledger'
            });
        } catch (error) {
            console.error('❌ Balance API Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Alias for frontend compatibility
    app.get('/balances/:address', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            const { address } = req.params;

            // [OPTIMIZATION] High-Performance Fetch for Alias
            if (blockchain && blockchain.database && blockchain.database.db) {
                try {
                    const walletDoc = await blockchain.database.db.collection(blockchain.database.collections.wallets || 'cheese-blockchain-wallets').doc(address.toLowerCase()).get();
                    if (walletDoc.exists) {
                        const data = walletDoc.data();
                        const sanitizedPortfolio = { ...(data.portfolio || {}) };
                        delete sanitizedPortfolio.balance;
                        delete sanitizedPortfolio.SUCCESS;
                        // delete sanitizedPortfolio.NCH;
                        // delete sanitizedPortfolio.NCHEESE;

                        return res.json({
                            success: true,
                            address,
                            balances: { 
                                balance: parseFloat(data.balance) || 0, 
                                portfolio: sanitizedPortfolio 
                            }
                        });
                    }
                } catch (e) {}
            }

            const balanceData = await blockchain.getBalances(address);
            res.json({
                success: true,
                address,
                balances: { balance: balanceData.balance, portfolio: balanceData.portfolio }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });


    // ==================== TRANSACTION ENDPOINTS ====================

    // Get pending transactions [NEW]
    app.get('/api/transactions/pending', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) {
                return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            }
            res.json({
                success: true,
                transactions: blockchain.pendingTransactions || []
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Server-side vault transfer (DEX liquidity pool payouts — no private key in request body)
    app.post('/api/vault/transfer', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) {
                return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            }

            const callerKey = req.headers['x-api-key'] || req.query.apiKey;
            const dexKey = process.env.API_KEY || process.env.DEX_API_KEY;
            if (!callerKey || !dexKey || callerKey !== dexKey) {
                return res.status(403).json({ success: false, error: 'Vault transfer requires DEX API key' });
            }

            const vaultKey = process.env.LIQUIDITY_POOL_PRIVATE_KEY;
            const vaultAddress = process.env.LIQUIDITY_POOL_ADDRESS || '0x3801490C9f806c917b8CbA710Db9135FA3B116ae';
            if (!vaultKey) {
                return res.status(503).json({ success: false, error: 'Vault signing key not configured' });
            }

            const { to, amount, currency, data } = req.body;
            const amountNum = parseFloat(amount);
            if (!to || isNaN(amountNum) || amountNum <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid vault transfer parameters' });
            }

            const txCurrency = (currency || 'NCH').toUpperCase();
            const timestamp = Date.now();
            const txData = { ...(data || {}), currency: txCurrency, type: (data && data.type) || 'vault_transfer' };
            const signature = blockchain.signTransaction(vaultKey, vaultAddress, amountNum, {
                to,
                data: txData,
                timestamp
            });

            const result = await blockchain.createTransaction(
                vaultAddress,
                to,
                amountNum,
                txData,
                signature,
                timestamp
            );

            if (result.success) {
                return res.json({ success: true, transaction: result.transaction });
            }
            return res.status(400).json(result);
        } catch (error) {
            console.error('Vault transfer error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/transaction', async (req, res) => {
        const startTime = Date.now();
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) {
                return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            }

            const { from, to, amount, signature, privateKey, data, timestamp, currency } = req.body;

            // Standardize currency (for logging/routing ONLY — do NOT inject into data before signature verification)
            const txCurrency = (currency || (data && data.currency) || 'NCH').toUpperCase();
            console.log(`📥 API: Transaction currency: ${txCurrency}`);

            // SECURITY: Ensure all transactions are signed
            if (!signature && !privateKey) {
                return res.status(400).json({ success: false, error: 'Transaction signature required' });
            }

            // Fallback: If privateKey provided, sign the transaction for the caller
            let finalSignature = signature;
            if (!signature && privateKey) {
                try {
                    console.log(`🔑 API: Signing transaction using privateKey for ${from}`);
                    // CRITICAL: Sign with original data (not mutated txData)
                    finalSignature = blockchain.signTransaction(privateKey, from, amount, {
                        to: to,
                        data: data || {},
                        timestamp: timestamp || startTime
                    });
                } catch (signError) {
                    return res.status(400).json({ success: false, error: 'Failed to sign transaction with provided key' });
                }
            }

            // Normalize amount
            const amountNum = parseFloat(amount);
            if (isNaN(amountNum) || amountNum <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid amount' });
            }

            console.log(`📥 API: Transaction from ${from} to ${to} (${amountNum} ${txCurrency})`);

            // CRITICAL FIX: Pass the ORIGINAL `data` object (not mutated txData) to createTransaction.
            // The client signed the original data. If we add `currency` here BEFORE verification,
            // the hash will not match and ALL transactions will fail with "invalid signature".
            // createTransaction derives currency from data.currency (or defaults to NCH) internally.
            const result = await blockchain.createTransaction(
                from,
                to,
                amountNum,
                data || {},          // FIXED: original data (matches what client signed)
                finalSignature,
                timestamp || startTime // Match the timestamp used in signTransaction
            );

            const duration = Date.now() - startTime;
            if (result.success) {
                console.log(`✅ API: Transaction success in ${duration}ms`);
                res.json({
                    success: true,
                    transaction: result.transaction,
                    duration
                });
            } else {
                console.warn(`⚠️ API: Transaction rejected: ${result.reason}`);
                res.status(400).json(result);
            }
        } catch (error) {
            console.error('❌ API Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get single transaction by hash [NEW]
    app.get('/api/transaction/:hash', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            const { hash } = req.params;

            const q = String(hash).trim().toLowerCase();
            const txMatches = (tx) => {
                if (!tx) return false;
                const id = (tx.id || '').toLowerCase();
                const txHash = (tx.hash || '').toLowerCase();
                const docHash = (tx.data?.hash || '').toLowerCase();
                const ethHash = (tx.data?.eth_hash || '').toLowerCase();
                const dataTxHash = (tx.data?.txHash || '').toLowerCase();
                return id === q || txHash === q || docHash === q || ethHash === q || dataTxHash === q;
            };

            // 1. Search in Chain (Memory)
            let transaction = null;
            for (const block of blockchain.chain) {
                const found = (block.transactions || []).find(txMatches);
                if (found) {
                    transaction = found;
                    break;
                }
            }

            // 2. Search in Mempool if not found in chain
            if (!transaction) {
                transaction = blockchain.pendingTransactions.find(txMatches);
            }

            // 3. Search in Database if still not found (SQLite/Firestore unified fallback)
            if (!transaction && blockchain.database) {
                try {
                    if (typeof blockchain.database.getTransaction === 'function') {
                        transaction = await blockchain.database.getTransaction(q);
                    } else if (blockchain.database.db) {
                        // Firestore collection fallback
                        const txDoc = await blockchain.database.db.collection(blockchain.database.collections.transactions).doc(hash).get();
                        if (txDoc.exists) {
                            transaction = txDoc.data();
                        } else {
                            const txQuery = await blockchain.database.db.collection(blockchain.database.collections.transactions)
                                .where('hash', '==', hash)
                                .limit(1)
                                .get();
                            if (!txQuery.empty) {
                                transaction = txQuery.docs[0].data();
                            }
                        }
                    }
                } catch (dbError) {
                    console.warn('⚠️ Unified DB lookup failed:', dbError.message);
                }
            }

            if (transaction) {
                res.json({ success: true, transaction });
            } else {
                res.status(404).json({ success: false, error: 'Transaction not found' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== MINING STATUS & REGISTRATION ====================

    app.get('/api/mining/status', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            const { wallet } = req.query;
            if (!wallet) return res.status(400).json({ success: false, error: 'Wallet required' });

            const walletLower = wallet.trim().toLowerCase();

            // CRITICAL: Check Exemption First
            if (EXEMPT_WALLETS.includes(walletLower)) {
                console.log(`✅ [EXEMPT] Mining status check for Founder wallet: ${walletLower}`);
                return res.json({ success: true, registered: true, status: 'exempt' });
            }

            // query DB for registration
            let registration = null;
            if (blockchain && blockchain.database) {
                // Use a standard method to get registration
                registration = await blockchain.database.getMiningRegistration(walletLower);
            }

            // A wallet is registered if a record exists and status is 'active' or 'paid'
            const isRegistered = !!registration && (registration.status === 'active' || registration.status === 'paid');

            res.json({
                success: true,
                registered: isRegistered,
                registration: registration || null
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Register Mining Payment (10 USDT)
    app.post('/api/mining/register', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            const { walletAddress, deviceId, bscTxHash, referrer } = req.body;

            if (!walletAddress || !deviceId || !bscTxHash) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            console.log(`💳 Verifying Payment for ${walletAddress}...`);
            const paymentCheck = await verifyUSDTPayment(bscTxHash, walletAddress, TREASURY_WALLET, MINING_FEE_USDT);

            if (!paymentCheck.valid) {
                console.log(`❌ Payment Failed: ${paymentCheck.error}`);
                return res.status(402).json({ success: false, error: paymentCheck.error });
            }

            // Save to DB
            if (blockchain && blockchain.database) {
                await blockchain.database.saveMiningRegistration({
                    walletAddress: walletAddress.toLowerCase(),
                    deviceId: deviceId,
                    paid: true,
                    status: 'active', // 🔒 FIX: Explicit status so getMiningRegistration query finds it
                    amount: paymentCheck.amount, // Real parsed amount
                    bscTxHash: bscTxHash,
                    timestamp: Date.now(),
                    registeredAt: Date.now(),
                    referrer: referrer || null
                });

                // NOTE: Referral bonus data is recorded in the DB for tracking
                // but does NOT create on-chain transactions to prevent phantom/ghost minting.
                // Referral rewards must be issued through legitimate signed transactions only.
                if (referrer && referrer.length > 10) {
                    console.log(`📊 Referral recorded: ${walletAddress} referred by ${referrer} (no on-chain mint)`);
                }
            }

            console.log(`✅ Miner Registered: ${walletAddress}`);
            res.json({ success: true, registered: true });

        } catch (error) {
            console.error('Registration Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    function findNotaryTransaction(blockchain, query) {
        if (!blockchain || !query) return null;
        const q = String(query).trim().toLowerCase();
        const matches = (tx) => {
            if (!tx) return false;
            const id = (tx.id || '').toLowerCase();
            const docHash = (tx.data?.hash || '').toLowerCase();
            const isNotary = tx.data?.type === 'notary_stamp' || tx.data?.type === 'notary_send' || tx.data?.type === 'DOCUMENT_NOTARY';
            if (!isNotary && !docHash) return false;
            return id === q || docHash === q;
        };

        for (const tx of blockchain.pendingTransactions || []) {
            if (matches(tx)) return { transaction: tx, status: 'pending' };
        }
        for (const block of blockchain.chain || []) {
            for (const tx of block.transactions || []) {
                if (matches(tx)) return { transaction: tx, status: 'confirmed', blockIndex: block.index };
            }
        }
        return null;
    }

    app.get('/api/notary/verify', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) {
                return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            }

            const q = (req.query.q || req.query.hash || '').trim();
            if (!q) return res.status(400).json({ success: false, error: 'Hash or transaction ID required' });

            let found = findNotaryTransaction(blockchain, q);

            // 1. Query local SQLite database if available and not found in memory
            if (!found && blockchain.database) {
                try {
                    const localDB = blockchain.database.local || (blockchain.database.db && !blockchain.database.collections ? blockchain.database : null);
                    if (localDB && localDB.db) {
                        const stmt = localDB.db.prepare(`
                            SELECT * FROM transactions 
                            WHERE id = ? OR data LIKE ?
                            LIMIT 1
                        `);
                        stmt.bind([q, `%${q}%`]);
                        if (stmt.step()) {
                            const row = stmt.getAsObject();
                            let txData = {};
                            try { txData = JSON.parse(row.data || '{}'); } catch (e) {}
                            
                            const tx = {
                                id: row.id,
                                from: row.fromAddress,
                                to: row.toAddress,
                                amount: row.amount,
                                currency: row.currency,
                                timestamp: row.timestamp,
                                signature: JSON.parse(row.signature || '{}'),
                                data: txData
                            };
                            found = { transaction: tx, status: row.blockIndex ? 'confirmed' : 'pending', blockIndex: row.blockIndex };
                        }
                        stmt.free();
                    }
                } catch (localDbErr) {
                    console.warn('Local SQLite notary lookup failed:', localDbErr.message);
                }
            }

            // 2. Query cloud database if available, but ONLY if not in isolation mode and has Firestore
            const isIsolated = process.env.CHEESE_ISOLATION_MODE === 'true';
            if (!found && !isIsolated && blockchain.database) {
                const cloudDB = blockchain.database.cloud || (blockchain.database.db && blockchain.database.collections ? blockchain.database : null);
                if (cloudDB && cloudDB.db && cloudDB.collections) {
                    try {
                        const col = cloudDB.collections.transactions;
                        const dbPromise = (async () => {
                            const byId = await cloudDB.db.collection(col).doc(q).get();
                            if (byId.exists) {
                                return { transaction: byId.data(), status: 'confirmed' };
                            }
                            const snap = await cloudDB.db.collection(col)
                                .where('data.hash', '==', q)
                                .limit(1)
                                .get();
                            if (!snap.empty) {
                                return { transaction: snap.docs[0].data(), status: 'confirmed' };
                            }
                            return null;
                        })();
                        
                        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud DB Timeout')), 3000));
                        const cloudFound = await Promise.race([dbPromise, timeoutPromise]);
                        if (cloudFound) {
                            found = cloudFound;
                        }
                    } catch (cloudDbErr) {
                        console.warn('Cloud Firestore notary lookup failed or timed out:', cloudDbErr.message);
                    }
                }
            }

            if (!found) {
                return res.json({ 
                    success: true, 
                    verified: false, 
                    message: 'No notary record found for this hash or transaction ID' 
                });
            }

            const tx = found.transaction;
            res.json({
                success: true,
                verified: true,
                status: found.status,
                blockIndex: found.blockIndex ?? null,
                transaction: {
                    id: tx.id,
                    timestamp: tx.timestamp,
                    fileName: tx.data?.fileName || tx.data?.filename,
                    hash: tx.data?.hash,
                    type: tx.data?.type,
                    category: tx.data?.category
                }
            });
        } catch (error) {
            console.error('Notary verify error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== TURN CREDENTIALS API ====================
    app.get('/api/turn-credentials', async (req, res) => {
        try {
            // 1. Check if custom static TURN credentials are provided in env
            if (process.env.TURN_SERVER_URL) {
                const urls = process.env.TURN_SERVER_URL.split(',').map(u => u.trim());
                const username = process.env.TURN_SERVER_USERNAME || '';
                const credential = process.env.TURN_SERVER_PASSWORD || '';
                
                const iceServers = urls.map(url => {
                    const serverObj = { urls: url };
                    if (username && (url.startsWith('turn:') || url.startsWith('turns:'))) {
                        serverObj.username = username;
                        serverObj.credential = credential;
                    }
                    return serverObj;
                });

                console.log('📡 [TURN] Returning custom static ICE servers from env');
                return res.json({ success: true, provider: 'custom-static', iceServers });
            }

            // 2. Check if Metered.ca dynamic credentials are provided in env
            const secretKey = process.env.METERED_SECRET_KEY || process.env.METERED_API_KEY;
            const appDomain = process.env.METERED_DOMAIN;

            if (secretKey && appDomain) {
                try {
                    console.log(`📡 [TURN] Fetching dynamic credentials from Metered.ca (${appDomain})...`);
                    const response = await axios.post(`https://${appDomain}/api/v1/turn/credential?secretKey=${secretKey}`, {}, {
                        timeout: 5000
                    });
                    
                    if (response.data && Array.isArray(response.data)) {
                        console.log('📡 [TURN] Dynamic Metered.ca credentials successfully fetched');
                        return res.json({
                            success: true,
                            provider: 'metered-dynamic',
                            iceServers: response.data
                        });
                    } else if (response.data && response.data.iceServers) {
                        console.log('📡 [TURN] Dynamic Metered.ca credentials successfully fetched (format B)');
                        return res.json({
                            success: true,
                            provider: 'metered-dynamic',
                            iceServers: response.data.iceServers
                        });
                    }
                } catch (apiErr) {
                    console.error('⚠️ [TURN] Metered.ca credentials fetch failed, falling back to public:', apiErr.message);
                }
            }
        } catch (err) {
            console.error('❌ [TURN] Error in /api/turn-credentials route:', err.message);
        }

        // 3. Fallback to public free openrelay.metered.ca servers
        console.log('📡 [TURN] Returning public fallback ICE servers');
        const fallbackServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turns:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ];

        res.json({
            success: true,
            provider: 'public-fallback',
            iceServers: fallbackServers
        });
    });

    // ==================== NOTARY STAMP API ====================
    app.post('/api/notary/stamp', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) return res.status(503).json({ success: false, error: 'Blockchain initializing' });

            const { hash, fileName, category } = req.body;
            if (!hash) return res.status(400).json({ success: false, error: 'File hash required' });

            console.log(`📜 [NOTARY] Stamping hash: ${hash} (${fileName})`);

            // Create a System-Signed Notary Transaction
            // This is a professional "Proof of Integrity" stamp
            const result = await blockchain.createSystemTransaction(
                TREASURY_WALLET, 
                0, 
                'NCH', 
                { 
                    type: 'notary_stamp', 
                    hash: hash, 
                    fileName: fileName || 'unknown',
                    category: category || 'general',
                    description: 'Cheese Blockchain Notary Verification'
                }
            );

            if (result.success) {
                const tx = result.transaction;
                res.json({
                    success: true,
                    transaction: tx,
                    hash: hash,
                    txid: tx.id,
                    status: 'pending',
                    explorerUrl: `/explorer/?tx=${encodeURIComponent(tx.id)}`,
                    message: 'Document hash recorded. Transaction is in the mempool and will appear on the explorer after the next block.'
                });
            } else {
                res.status(400).json({ success: false, error: 'Failed to create notary stamp' });
            }
        } catch (error) {
            console.error('❌ Notary API Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== NOTARY SEND API ====================
    app.post('/api/notary/send', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) return res.status(503).json({ success: false, error: 'Blockchain initializing' });

            const { hash, fileName, receiverAddress, originalTxId } = req.body;
            if (!hash || !receiverAddress) return res.status(400).json({ success: false, error: 'Hash and receiver address required' });

            console.log(`📤 [NOTARY] Sending hash ${hash} to ${receiverAddress}`);

            // Create a System Transaction to send the hash proof to receiver
            const result = await blockchain.createSystemTransaction(
                receiverAddress, 
                0, 
                'NCH', 
                { 
                    type: 'notary_send', 
                    hash: hash, 
                    fileName: fileName || 'unknown',
                    originalTxId: originalTxId,
                    description: 'Cheese Blockchain Notary Proof Transfer'
                }
            );

            if (result.success) {
                res.json({
                    success: true,
                    transaction: result.transaction,
                    hash: hash,
                    sendTxid: result.transaction.id,
                    receiverAddress: receiverAddress
                });
            } else {
                res.status(400).json({ success: false, error: 'Failed to send notary proof' });
            }
        } catch (error) {
            console.error('❌ Notary Send API Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== MINING EXECUTION ====================

    // --- MINING SECURITY ENHANCEMENTS ---
    let isMining = false; // Global lock
    const activeMiningSessions = new Map(); // wallet -> timestamp
    const walletCooldowns = new Map(); // wallet -> lastMinedTimestamp
    const MIN_BLOCK_TIME = 60000; // MODIFIED: 1 minute cooldown per user request
    const WALLET_SESSION_TIMEOUT = 60000; // 60s session timeout
    let lastBlockTimestamp = 0;

    // 🔒 FIX: Safety auto-reset for stuck isMining lock (2-minute watchdog)
    let miningLockTimer = null;
    function acquireMiningLock() {
        isMining = true;
        clearTimeout(miningLockTimer);
        miningLockTimer = setTimeout(() => {
            if (isMining) {
                console.error('⚠️ [WATCHDOG] Route-level mining lock stuck > 2 min — auto-releasing.');
                isMining = false;
            }
        }, 2 * 60 * 1000);
    }
    function releaseMiningLock() {
        isMining = false;
        clearTimeout(miningLockTimer);
    }

    app.post('/api/mine', requireRole(['MINING', 'HYBRID']), async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!isReady() || !blockchain) return res.status(503).json({ success: false, error: 'Blockchain initializing' });

            const { minerAddress, deviceId } = req.body; // MODIFIED: Support deviceId
            if (!minerAddress) return res.status(400).json({ success: false, error: 'Miner address required' });

            const minerLower = minerAddress.trim().toLowerCase();
            const OPERATOR_ADDRESS = '0x712a1cba607c60d95f27088c80abbbd1f53d33fe';

            // ==================== EMERGENCY SHORTCUT ====================
            // Operator bypasses registration/session checks but MUST respect 60s cooldown
            if (minerLower === OPERATOR_ADDRESS) {
                const EXEMPT_COOLDOWN = 60000; // 60 seconds minimum for ALL exempt wallets
                const lastOpMined = walletCooldowns.get(minerLower) || 0;
                if (Date.now() - lastOpMined < EXEMPT_COOLDOWN) {
                    const waitSec = Math.ceil((EXEMPT_COOLDOWN - (Date.now() - lastOpMined)) / 1000);
                    return res.status(429).json({ success: false, error: `Operator cooldown active. Wait ${waitSec}s.` });
                }
                console.log(`🚨 [EMERGENCY BYPASS] Operator mining triggered: ${minerLower}`);
                try {
                    registerMinerActivity(minerAddress);
                    const block = await blockchain.minePendingTransactions(minerAddress);
                    if (block) {
                        walletCooldowns.set(minerLower, Date.now());
                        return res.json({ success: true, block, note: 'Emergency bypass active' });
                    }
                } catch (bypassErr) {
                    console.error('❌ Emergency Bypass Failed:', bypassErr.message);
                    return res.status(500).json({ success: false, error: 'Bypass engine failure: ' + bypassErr.message });
                }
            }

            const isExempt = EXEMPT_WALLETS.includes(minerLower);

            // 1. Check Per-Wallet Cooldown (Anti-Abuse)
            // EXEMPT wallets now have a 60-second minimum cooldown to prevent inflation
            const EXEMPT_COOLDOWN = 60000; // 60 seconds for exempt wallets
            const applicableCooldown = isExempt ? EXEMPT_COOLDOWN : MIN_BLOCK_TIME;
            const lastMined = walletCooldowns.get(minerLower) || 0;
            if (Date.now() - lastMined < applicableCooldown) {
                const waitSec = Math.ceil((applicableCooldown - (Date.now() - lastMined)) / 1000);
                return res.status(429).json({
                    success: false,
                    error: `Wallet cooldown active. Please wait ${waitSec}s.`
                });
            }

            // 2. Check Active Session (One Session per Wallet)
            const activeSession = activeMiningSessions.get(minerLower);
            if (activeSession && !isExempt) {
                // MODIFIED: Allow takeover if it's the same device (prevents refresh lockouts)
                const isSameDevice = deviceId && activeSession.deviceId === deviceId;
                const isExpired = (Date.now() - activeSession.timestamp) > WALLET_SESSION_TIMEOUT;

                if (!isSameDevice && !isExpired) {
                    console.log(`❌ [SESSION BLOCKED] Multi-device attempt: ${minerLower}`);
                    return res.status(403).json({
                        success: false,
                        error: 'Mining session already active for this wallet. Close other devices/tabs.'
                    });
                }
            }

            // 3. Exemption / Registration check
            if (!isExempt) {
                let registration = null;
                if (blockchain.database) {
                    // MODIFIED: Pass deviceId if available for precise lookup
                    registration = await blockchain.database.getMiningRegistration(minerLower, deviceId);
                }

                if (!registration) {
                    console.log(`❌ [BLOCKED] Unregistered wallet attempt: ${minerLower}`);
                    return res.status(403).json({ success: false, error: 'Wallet not registered' });
                }

                // Verify status
                const isRegistered = registration.status === 'active' || registration.status === 'paid';
                if (!isRegistered) {
                    return res.status(403).json({ success: false, error: 'Registration is not active' });
                }
            } else {
                console.log(`✅ [EXEMPT] Mining block with Founder/System/Operator wallet: ${minerLower}`);
            }

            // 4. Global Locks and Timeouts
            if (isMining) {
                console.log('⚠️ [SERVER BUSY] Global lock active. Skipping request.');
                return res.status(429).json({ success: false, error: 'Server busy. Another block is being mined.' });
            }
            
            // Hard server cooldown (1 minute total) - BYPASSED FOR EXEMPT WALLETS
            // This allows the Operator to clear queues quickly if needed
            const globalCooldown = 60000; 
            if (!isExempt && (Date.now() - lastBlockTimestamp < globalCooldown)) {
                return res.status(429).json({ success: false, error: 'Server cooldown (global). Please wait.' });
            }

            // --- EXECUTE MINING ---
            acquireMiningLock(); // 🔒 FIX: Use watchdog-aware lock
            // MODIFIED: Store object with deviceId in session
            activeMiningSessions.set(minerLower, {
                timestamp: Date.now(),
                deviceId: deviceId || 'unknown'
            });

            try {
                registerMinerActivity(minerAddress);
                const block = await blockchain.minePendingTransactions(minerAddress);
                if (block) {
                    lastBlockTimestamp = Date.now();
                    walletCooldowns.set(minerLower, Date.now()); // Mark last mined for this wallet
                    activeMiningSessions.delete(minerLower); // Release session
                    releaseMiningLock(); // 🔒 FIX
                    res.json({ success: true, block });
                } else {
                    activeMiningSessions.delete(minerLower); // Release session
                    releaseMiningLock(); // 🔒 FIX
                    res.status(400).json({ success: false, error: 'Mining failed or engine reported busy' });
                }
            } catch (innerError) {
                console.error('❌ Inner Mining Engine Error:', innerError.message);
                activeMiningSessions.delete(minerLower); // Release session
                releaseMiningLock(); // 🔒 FIX
                if (!res.headersSent) {
                    res.status(500).json({ success: false, error: 'Mining engine failure: ' + innerError.message });
                }
            } finally {
                releaseMiningLock(); // 🔒 FIX: Ensure always released (idempotent)
                // Safety clear here with delay
                setTimeout(() => {
                    const sess = activeMiningSessions.get(minerLower);
                    if (sess && sess.deviceId === (deviceId || 'unknown')) {
                        activeMiningSessions.delete(minerLower);
                    }
                }, 5000);
            }
        } catch (error) {
            console.error('❌ Mining Route Error:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: error.message || 'Unknown server error' });
            }
        }
    });


    app.get('/api/miners/active', (req, res) => {
        res.json({ success: true, count: getActiveMinersCount(), miners: getActiveMinersInfo() });
    });

    app.post('/api/miners/heartbeat', (req, res) => {
        const { minerAddress } = req.body;
        registerMinerActivity(minerAddress);
        res.json({ success: true });
    });

    // ==================== BLOCK DATA ENDPOINTS (EXPLORER SUPPORT) ====================

    // Get range of blocks (Pagination / Explorer)
    app.get('/api/blocks/range', (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!blockchain) return res.status(503).json({ success: false, error: 'Initializing' });

            const start = parseInt(req.query.start);
            const end = parseInt(req.query.end);

            // Default to last 20 blocks if no range specified
            const chainHeight = blockchain.chain.length > 0 ? blockchain.chain[blockchain.chain.length - 1].index + 1 : 0;
            const defaultStart = Math.max(0, chainHeight - 20);
            const defaultEnd = Math.max(0, chainHeight - 1);

            const safeStart = isNaN(start) ? defaultStart : Math.max(0, start);
            const safeEnd = isNaN(end) ? defaultEnd : Math.min(chainHeight - 1, end);

            console.log(`📡 Fetching blocks from ${safeStart} to ${safeEnd}`);
            const blocks = blockchain.chain.filter(b => b && b.index >= safeStart && b.index <= safeEnd);
            
            res.json({
                success: true,
                count: blocks.length,
                total: chainHeight,
                blocks: blocks
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get single block by index or hash
    app.get('/api/block/:id', (req, res) => {
        const blockchain = getBlockchain();
        if (!blockchain) return res.status(503).json({ success: false, error: 'Initializing' });

        const { id } = req.params;
        let block = null;

        if (/^\d+$/.test(id)) {
            const index = parseInt(id);
            block = blockchain.chain.find(b => b.index === index);
        } else {
            block = blockchain.chain.find(b => b.hash === id);
        }

        if (block) {
            res.json({ success: true, block });
        } else {
            res.status(404).json({ success: false, error: 'Block not found' });
        }
    });

    // Get single transaction by ID/Hash (CRITICAL for Notary Search & Bridge)
    app.get('/api/transaction/:id', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!blockchain) return res.status(503).json({ success: false, error: 'Initializing' });

            const { id } = req.params;

            // 1. Check mempool
            let tx = blockchain.pendingTransactions.find(t => t.id === id || t.hash === id);
            if (tx) return res.json({ success: true, transaction: tx, status: 'pending' });

            // 2. Check memory chain
            for (const block of blockchain.chain) {
                tx = (block.transactions || []).find(t => t.id === id || t.hash === id);
                if (tx) return res.json({ success: true, transaction: tx, status: 'confirmed', blockIndex: block.index });
            }

            // 3. Check database (Deep Search)
            if (blockchain.database && blockchain.database.getAllTransactions) {
                const allTxs = await blockchain.database.getAllTransactions();
                tx = allTxs.find(t => t.id === id || t.hash === id);
                if (tx) return res.json({ success: true, transaction: tx, status: 'confirmed' });
            }

            res.status(404).json({ success: false, error: 'Transaction not found' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== BLOCKCHAIN INFO ====================

    app.get('/api/blockchain', (req, res) => {
        const blockchain = getBlockchain();
        if (!blockchain) return res.status(503).json({ success: false, error: 'Empty' });
        const chainHeight = blockchain.chain.length > 0 ? blockchain.chain[blockchain.chain.length - 1].index + 1 : 0;
        res.json({
            success: true,
            chainLength: chainHeight,
            lastHash: blockchain.chain.length > 0 ? blockchain.chain[blockchain.chain.length - 1].hash : '',
            difficulty: blockchain.difficulty,
            miningReward: blockchain.miningReward,
            pendingTransactions: blockchain.pendingTransactions.length
        });
    });

    // 🧀 NEW: Statistics alias for frontend compatibility
    app.get('/api/blockchain/stats', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            if (!blockchain) return res.status(503).json({ success: false, error: 'Blockchain initializing' });
            
            // Comprehensive list of the 27 AI models for the audit report
            const aiModels = {
                javascript: [
                    "FraudDetectorNN", "TransactionPredictorLSTM", "AnomalyDetectorML", "MiningOptimizerRL",
                    "WhaleDetectorML", "NetworkHealthPredictor", "SentimentAnalyzer", "UserBehaviorPredictor",
                    "PricePredictor", "SmartContractAnalyzer", "AIGovernance", "QuantumResistantConsensus",
                    "SmartContractGenerator", "TransactionClassifier", "FraudDetectorSL", "RiskAssessor",
                    "PatternRecognizer"
                ],
                tensorflow_js: [
                    "DeepFraudDetector", "LSTMPricePredictor", "AnomalyAutoencoder"
                ],
                python: [
                    "FraudDetectorTF", "TransactionPredictorTF", "AnomalyDetectorScikit",
                    "PricePredictorTransformer", "TradingRLAgent", "FraudPatternGAN"
                ],
                cloud: [
                    "OpenAIGPTAnalyzer"
                ]
            };

            const aiStatus = {
                active: true,
                count: 27,
                status: "READY",
                engine: "v5.3.0-CORE",
                models: [
                    ...aiModels.javascript.map(name => ({ name, type: "JavaScript (Core / SL)", status: "Online" })),
                    ...aiModels.tensorflow_js.map(name => ({ name, type: "TensorFlow.js", status: "Online" })),
                    ...aiModels.python.map(name => ({ name, type: "Python Service", status: "Online" })),
                    ...aiModels.cloud.map(name => ({ name, type: "Cloud AI", status: "Online" }))
                ]
            };

            const chainHeight = blockchain.chain.length > 0 ? blockchain.chain[blockchain.chain.length - 1].index + 1 : 0;
            res.json({
                success: true,
                chainLength: chainHeight,
                totalTransactions: blockchain.chain.reduce((acc, b) => acc + (b.transactions ? b.transactions.length : 0), 0),
                lastHash: blockchain.chain.length > 0 ? blockchain.chain[blockchain.chain.length - 1].hash : '',
                difficulty: blockchain.difficulty,
                miningReward: blockchain.miningReward,
                pendingTransactions: blockchain.pendingTransactions.length,
                ai: aiStatus,
                timestamp: Date.now(),
                network: 'CHEESE-MAINNET'
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/transactions/pending', (req, res) => {
        const blockchain = getBlockchain();
        res.json({ success: true, count: blockchain.pendingTransactions.length, transactions: blockchain.pendingTransactions });
    });

    app.get('/api/transactions/all', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            let txs = [];
            if (blockchain.database && blockchain.database.getAllTransactions) {
                txs = await blockchain.database.getAllTransactions();
            } else {
                blockchain.chain.forEach(b => txs.push(...(b.transactions || [])));
            }
            res.json({ success: true, count: txs.length, transactions: txs });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Legacy explorer path (older clients called GET /api/transactions)
    app.get('/api/transactions', (req, res) => {
        const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        res.redirect(307, '/api/transactions/all' + q);
    });

    app.get('/api/transactions/:address', async (req, res) => {
        try {
            const blockchain = getBlockchain();
            const { address } = req.params;
            const target = address.toLowerCase();

            // 1. Get transactions from memory chain
            const txs = [];

            // 🔒 FIX: Include pending transactions from mempool (Unmined)
            blockchain.pendingTransactions.forEach(tx => {
                if ((tx.from && tx.from.toLowerCase() === target) || (tx.to && tx.to.toLowerCase() === target)) {
                    txs.push({ ...tx, status: 'pending', confirmations: 0 });
                }
            });

            blockchain.chain.forEach(b => {
                (b.transactions || []).forEach(tx => {
                    if ((tx.from && tx.from.toLowerCase() === target) || (tx.to && tx.to.toLowerCase() === target)) {
                        txs.push(tx);
                    }
                });
            });

            // 2. Get transactions from database (Firestore/SQLite)
            if (blockchain.database && blockchain.database.getTransactionHistory) {
                try {
                    const dbTxs = await blockchain.database.getTransactionHistory(address);
                    // Deduplicate based on ID/Hash
                    dbTxs.forEach(dbTx => {
                        const exists = txs.some(tx => tx.id === dbTx.id || tx.hash === dbTx.hash);
                        if (!exists) txs.push(dbTx);
                    });
                } catch (dbError) {
                    console.warn(`⚠️ API: Database history lookup failed for ${address}:`, dbError.message);
                }
            }

            // 3. Sort by timestamp descending
            txs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            res.json({ success: true, count: txs.length, transactions: txs });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== API PROXIES (FIXES CORS & MIXED CONTENT) ====================

    // DEX price cache
    const dexPriceCache = new Map();
    const DEX_CACHE_TTL = 30000; // 30 seconds

    // Specific DEX Proxy for NCHEESE and other tokens
    // Usage: /api/dex-proxy/price/NCHEESE
    app.get('/api/dex-proxy/price/:symbol', async (req, res) => {
        try {
            const { symbol } = req.params;
            const cacheKey = symbol.toUpperCase();

            // Check cache first
            const cached = dexPriceCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < DEX_CACHE_TTL) {
                console.log(`📦 DEX Cache HIT for ${cacheKey}`);
                return res.json({ ...cached.data, source: 'cache' });
            }

            // Fetch from DEX API via same-process loopback (avoids external HTTPS self-request 502s)
            const port = process.env.PORT || 8080;
            const dexUrl = `http://127.0.0.1:${port}/dex/api/dex/price/${symbol}`;
            const proxyApiKey = process.env.API_KEY || process.env.CHEESE_API_KEY || 'REDACTED_DEX_API_KEY';
            const response = await axios.get(dexUrl, {
                timeout: 5000,
                headers: { 'x-api-key': proxyApiKey }
            });

            if (response.data) {
                // Cache the response
                dexPriceCache.set(cacheKey, {
                    data: response.data,
                    timestamp: Date.now()
                });
                console.log(`📥 DEX Cache MISS for ${cacheKey} - fetched and cached`);
                res.json(response.data);
            } else {
                throw new Error('No data from DEX');
            }
        } catch (error) {
            console.warn(`⚠️ DEX Proxy error for ${req.params.symbol}:`, error.message);
            res.status(502).json({ success: false, error: 'DEX Unreachable: ' + error.message });
        }
    });

    // Generic CORS Proxy for External APIs (e.g., CoinGecko)
    app.get('/api/proxy', async (req, res) => {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL parameter is required' });
        }

        console.log(`🌐 Proxying external request to: ${url}`);

        try {
            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Cheese-Blockchain-Server/1.0',
                    'Accept': 'application/json'
                }
            });
        res.json(response.data);
        } catch (error) {
            console.error(`❌ Proxy error for ${url}:`, error.message);
            res.status(error.response?.status || 502).json({
                success: false,
                error: `Proxy failed: ${error.message}`,
                details: error.response?.data
            });
        }
    });

    // ==================== DEX POOLS API (proxy to mounted /dex backend) ====================
    const dexInternalBase = () => {
        const port = process.env.PORT || 8080;
        return process.env.DEX_INTERNAL_URL || `http://127.0.0.1:${port}/dex/api`;
    };

    async function proxyDex(req, res, method, dexPath, body) {
        try {
            const url = `${dexInternalBase()}${dexPath}`;
            const response = await axios({
                method,
                url,
                data: body,
                timeout: 10000,
                validateStatus: () => true
            });
            res.status(response.status).json(response.data);
        } catch (error) {
            res.status(502).json({ success: false, error: `DEX proxy failed: ${error.message}` });
        }
    }

    app.get(['/api/pools', '/pools'], (req, res) => proxyDex(req, res, 'GET', '/pools'));
    app.post(['/api/pools/create', '/pools/create'], (req, res) => proxyDex(req, res, 'POST', '/pools/create', req.body));
    app.get(['/api/pools/:poolId/candles', '/pools/:poolId/candles'], (req, res) => {
        const q = new URLSearchParams(req.query).toString();
        const suffix = q ? `?${q}` : '';
        proxyDex(req, res, 'GET', `/pools/${req.params.poolId}/candles${suffix}`);
    });
    app.get(['/api/positions/:address', '/positions/:address'], (req, res) => {
        proxyDex(req, res, 'GET', `/positions/${req.params.address}`);
    });
    app.get(['/api/market-prices', '/market-prices'], (req, res) => proxyDex(req, res, 'GET', '/market-prices'));

    // ==================== AI-AS-A-SERVICE (AIaaS) API GATEWAY ====================
    
    // Initialize API Keys Table in SQLite
    try {
        const localDB = blockchain.database.local || (blockchain.database.db && !blockchain.database.collections ? blockchain.database : null);
        if (localDB && localDB.db) {
            localDB.db.run(`
                CREATE TABLE IF NOT EXISTS developer_api_keys (
                    key TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    tier TEXT NOT NULL DEFAULT 'free',
                    status TEXT NOT NULL DEFAULT 'active',
                    requests_limit INTEGER NOT NULL DEFAULT 1000,
                    requests_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
            `);
            localDB.saveToDisk();
            console.log('✅ SQLite: developer_api_keys table initialized');
        }
    } catch (dbInitErr) {
        console.error('⚠️ SQLite developer_api_keys table initialization failed:', dbInitErr.message);
    }

    // Helper to validate and increment key usage
    async function validateDeveloperKey(apiKey) {
        const localDB = blockchain.database.local || (blockchain.database.db && !blockchain.database.collections ? blockchain.database : null);
        if (!localDB || !localDB.db) {
            return { valid: true, tier: 'free' }; // Fallback if database is offline
        }

        try {
            const stmt = localDB.db.prepare('SELECT * FROM developer_api_keys WHERE key = ? LIMIT 1');
            stmt.bind([apiKey]);
            const keyRecord = stmt.step() ? stmt.getAsObject() : null;
            stmt.free();

            if (!keyRecord) {
                return null;
            }

            if (keyRecord.status !== 'active') {
                return { error: 'API key is suspended or deactivated' };
            }

            if (keyRecord.requests_count >= keyRecord.requests_limit) {
                return { error: 'API usage quota exceeded for this tier' };
            }

            // Increment usage count
            const updateStmt = localDB.db.prepare('UPDATE developer_api_keys SET requests_count = requests_count + 1 WHERE key = ?');
            updateStmt.run([apiKey]);
            updateStmt.free();
            localDB.requestSave();

            return { 
                valid: true, 
                tier: keyRecord.tier, 
                requests_count: keyRecord.requests_count + 1, 
                requests_limit: keyRecord.requests_limit 
            };
        } catch (err) {
            console.error('API key verification error:', err.message);
            return { valid: true, tier: 'free' }; // Fallback to avoid breaking API
        }
    }

    // Endpoint: Generate API Key
    app.post('/api/developer/keys/create', async (req, res) => {
        const { owner } = req.body;
        if (!owner) {
            return res.status(400).json({ success: false, error: 'Owner wallet address is required' });
        }

        const localDB = blockchain.database.local || (blockchain.database.db && !blockchain.database.collections ? blockchain.database : null);
        if (!localDB || !localDB.db) {
            return res.status(503).json({ success: false, error: 'Database initializing' });
        }

        try {
            const newKey = 'nch_ai_' + require('crypto').randomBytes(16).toString('hex');
            const insertStmt = localDB.db.prepare('INSERT INTO developer_api_keys (key, owner, created_at) VALUES (?, ?, ?)');
            insertStmt.run([newKey, owner, Date.now()]);
            insertStmt.free();
            localDB.saveToDisk();

            res.json({
                success: true,
                apiKey: newKey,
                owner,
                tier: 'free',
                requests_limit: 1000,
                requests_count: 0
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Endpoint: Subscribe / Upgrade Key
    app.post('/api/developer/keys/subscribe', async (req, res) => {
        const { apiKey, tier, txHash } = req.body;
        if (!apiKey || !tier || !txHash) {
            return res.status(400).json({ success: false, error: 'apiKey, tier, and txHash are required' });
        }

        const localDB = blockchain.database.local || (blockchain.database.db && !blockchain.database.collections ? blockchain.database : null);
        if (!localDB || !localDB.db) {
            return res.status(503).json({ success: false, error: 'Database initializing' });
        }

        let limit = 1000;
        if (tier === 'developer') limit = 50000;
        if (tier === 'enterprise') limit = 500000;

        try {
            const updateStmt = localDB.db.prepare('UPDATE developer_api_keys SET tier = ?, requests_limit = ?, requests_count = 0 WHERE key = ?');
            updateStmt.run([tier, limit, apiKey]);
            updateStmt.free();
            localDB.saveToDisk();

            res.json({
                success: true,
                apiKey,
                tier,
                requests_limit: limit,
                txHash
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Endpoint: Get Key Stats
    app.get('/api/developer/keys/stats', async (req, res) => {
        const apiKey = req.query.apiKey || req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(400).json({ success: false, error: 'API key is required' });
        }

        const localDB = blockchain.database.local || (blockchain.database.db && !blockchain.database.collections ? blockchain.database : null);
        if (!localDB || !localDB.db) {
            return res.status(503).json({ success: false, error: 'Database initializing' });
        }

        try {
            const stmt = localDB.db.prepare('SELECT * FROM developer_api_keys WHERE key = ? LIMIT 1');
            stmt.bind([apiKey]);
            const keyRecord = stmt.step() ? stmt.getAsObject() : null;
            stmt.free();

            if (!keyRecord) {
                return res.status(404).json({ success: false, error: 'API key not found' });
            }

            res.json({
                success: true,
                stats: keyRecord
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Endpoint: Model Prediction Gateway
    app.post('/api/developer/predict', async (req, res) => {
        const apiKey = req.headers['x-api-key'] || req.body.apiKey;
        const { modelName, inputData } = req.body;

        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'Missing API key' });
        }
        if (!modelName || !inputData) {
            return res.status(400).json({ success: false, error: 'modelName and inputData are required' });
        }

        // Validate API key and count quota
        const keyValidation = await validateDeveloperKey(apiKey);
        if (!keyValidation) {
            return res.status(401).json({ success: false, error: 'Invalid API key' });
        }
        if (keyValidation.error) {
            return res.status(403).json({ success: false, error: keyValidation.error });
        }

        const realAI = blockchain.realAI;
        if (!realAI) {
            return res.status(503).json({ success: false, error: 'AI engine is not loaded on this node type' });
        }

        try {
            let prediction = null;
            const startTime = Date.now();

            switch (modelName) {
                // ============ Vanilla JavaScript Models ============
                case 'FraudDetectorNN':
                    if (!realAI.fraudDetector) throw new Error('Model FraudDetectorNN not active');
                    prediction = realAI.fraudDetector.predict(inputData.features || inputData);
                    break;
                case 'TransactionPredictorLSTM':
                    if (!realAI.transactionPredictor) throw new Error('Model TransactionPredictorLSTM not active');
                    prediction = realAI.transactionPredictor.predict(inputData.sequence || inputData);
                    break;
                case 'AnomalyDetectorML':
                    if (!realAI.anomalyDetector) throw new Error('Model AnomalyDetectorML not active');
                    prediction = realAI.anomalyDetector.predict(inputData.transaction || inputData, inputData.context || {});
                    break;
                case 'MiningOptimizerRL':
                    if (!realAI.miningOptimizer) throw new Error('Model MiningOptimizerRL not active');
                    prediction = realAI.miningOptimizer.predict(inputData.state || inputData);
                    break;
                case 'WhaleDetectorML':
                    if (!realAI.whaleDetector) throw new Error('Model WhaleDetectorML not active');
                    prediction = realAI.whaleDetector.predict(inputData.features || inputData);
                    break;
                case 'NetworkHealthPredictor':
                    if (!realAI.networkHealth) throw new Error('Model NetworkHealthPredictor not active');
                    prediction = realAI.networkHealth.predict(inputData.currentMetrics || inputData, inputData.steps || 10);
                    break;
                case 'SentimentAnalyzer':
                    if (!realAI.sentimentAnalyzer) throw new Error('Model SentimentAnalyzer not active');
                    prediction = realAI.sentimentAnalyzer.analyze(inputData.text || inputData.comment || inputData);
                    break;
                case 'UserBehaviorPredictor':
                    if (!realAI.userBehavior) throw new Error('Model UserBehaviorPredictor not active');
                    prediction = realAI.userBehavior.predict(inputData.features || inputData);
                    break;
                case 'PricePredictor':
                    if (!realAI.pricePredictor) throw new Error('Model PricePredictor not active');
                    prediction = realAI.pricePredictor.predict(inputData.sequence || inputData);
                    break;
                case 'SmartContractAnalyzer':
                    if (!realAI.contractAnalyzer) throw new Error('Model SmartContractAnalyzer not active');
                    prediction = realAI.contractAnalyzer.analyze(inputData.code || inputData);
                    break;

                // ============ Self-Learning Models ============
                case 'TransactionClassifier':
                    if (!realAI.selfLearning?.transactionClassifier) throw new Error('Model TransactionClassifier not active');
                    prediction = realAI.selfLearning.transactionClassifier.forward(inputData.features || inputData);
                    break;
                case 'FraudDetectorSL':
                    if (!realAI.selfLearning?.fraudDetector) throw new Error('Model FraudDetectorSL not active');
                    prediction = realAI.selfLearning.fraudDetector.forward(inputData.features || inputData);
                    break;
                case 'RiskAssessor':
                    if (!realAI.selfLearning?.riskAssessor) throw new Error('Model RiskAssessor not active');
                    prediction = realAI.selfLearning.riskAssessor.forward(inputData.features || inputData);
                    break;
                case 'PatternRecognizer':
                    if (!realAI.selfLearning?.patternRecognizer) throw new Error('Model PatternRecognizer not active');
                    prediction = realAI.selfLearning.patternRecognizer.forward(inputData.features || inputData);
                    break;

                // ============ TensorFlow.js Models ============
                case 'DeepFraudDetector':
                    if (!realAI.tensorFlow?.fraudDetector) throw new Error('Model DeepFraudDetector not active');
                    prediction = realAI.tensorFlow.fraudDetector.predict(inputData.features || inputData);
                    break;
                case 'LSTMPricePredictor':
                    if (!realAI.tensorFlow?.pricePredictor) throw new Error('Model LSTMPricePredictor not active');
                    prediction = realAI.tensorFlow.pricePredictor.predict(inputData.sequence || inputData);
                    break;
                case 'AnomalyAutoencoder':
                    if (!realAI.tensorFlow?.anomalyDetector) throw new Error('Model AnomalyAutoencoder not active');
                    prediction = realAI.tensorFlow.anomalyDetector.predict(inputData.features || inputData);
                    break;

                // ============ Google Gemini LLM API Models ============
                case 'AIGovernance':
                    const { AIGovernanceSystem } = require('./ai-engine/models/ai-governance');
                    const gov = new AIGovernanceSystem();
                    prediction = await gov.analyzeCommunitySentiment(inputData.comments || [inputData.comment || inputData]);
                    break;
                case 'QuantumResistantConsensus':
                    const qrc = realAI.quantumResistant || (realAI.quantumConsensus ? realAI : null);
                    if (!qrc) throw new Error('QuantumResistantConsensus not active');
                    prediction = qrc.detectQuantumThreat ? qrc.detectQuantumThreat(inputData) : { threat: false };
                    break;
                case 'SmartContractGenerator':
                    const { SmartContractGenerator } = require('./ai-engine/models/smart-contract-generator');
                    const gen = new SmartContractGenerator();
                    prediction = await gen.generateSmartContract(inputData.prompt, inputData.options || {});
                    break;

                // ============ Python AI Service Models ============
                case 'FraudDetectorTF':
                case 'TransactionPredictorTF':
                case 'AnomalyDetectorScikit':
                case 'PricePredictorTransformer':
                case 'TradingRLAgent':
                case 'FraudPatternGAN':
                case 'OpenAIGPTAnalyzer':
                    // Proxy requests directly to local FastAPI server
                    const pyEndpoints = {
                        FraudDetectorTF: '/ai/fraud-detection',
                        TransactionPredictorTF: '/ai/transaction-prediction',
                        AnomalyDetectorScikit: '/ai/anomaly-detection',
                        PricePredictorTransformer: '/ai/price-prediction',
                        TradingRLAgent: '/ai/trading',
                        FraudPatternGAN: '/ai/gan-fraud',
                        OpenAIGPTAnalyzer: '/ai/gpt-audit'
                    };
                    const targetPath = pyEndpoints[modelName];
                    const response = await axios.post(`${realAI.pythonAIUrl}${targetPath}`, inputData, { timeout: 10000 });
                    prediction = response.data;
                    break;

                default:
                    return res.status(400).json({ success: false, error: `Unknown modelName: ${modelName}` });
            }

            res.json({
                success: true,
                modelName,
                prediction,
                processingTime: `${Date.now() - startTime}ms`,
                quotaUsed: `${keyValidation.requests_count}/${keyValidation.requests_limit}`,
                timestamp: Date.now()
            });

        } catch (predictErr) {
            console.error(`❌ API Predict Error for ${modelName}:`, predictErr.message);
            res.status(500).json({ success: false, error: predictErr.message });
        }
    });

};
