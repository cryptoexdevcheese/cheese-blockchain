const express = require('express');
const router = express.Router();
const ChatService = require('./dex-backend/services/chat-service');
const axios = require('axios');
const { ethers } = require('ethers');

const BRIDGE_VAULT = '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3';
const DEX_VAULT = '0x3801490C9f806c917b8CbA710Db9135FA3B116ae';
const WNCH_RETIRED_MSG = 'wNCH bridge and convert are retired. Use native NCH and USDT on the DEX.';
const WNCH_BSC_CONTRACT = '0xDaE22388a4827F2769E8694991a641e6A4Dd0e80';
const BRIDGE_BURN_TOPIC = ethers.id('BridgeBurn(address,uint256,string)');
const spentTxMemory = new Set();

function createDEXRoutes(getDex, getBlockchainProxy, getStorage = () => null) {

    // Internal helper to get ready instance or fail gracefully
    const getReadyDex = () => {
        const dex = getDex();
        if (!dex) throw new Error('DEX Engine still initializing... 🕒');
        return dex;
    };

    function getVaultAddress() {
        const proxy = getBlockchainProxy();
        return (proxy && proxy.vaultAddress) ? proxy.vaultAddress : DEX_VAULT;
    }

    function verifySignature(userAddress, message, signature) {
        try {
            if (!userAddress || !message || !signature) return false;
            const recovered = ethers.verifyMessage(message, signature);
            return recovered.toLowerCase() === userAddress.toLowerCase();
        } catch (e) {
            console.warn('Signature verification failed:', e.message);
            return false;
        }
    }

    async function isTransactionSpent(txHash) {
        if (!txHash || spentTxMemory.has(txHash)) return !!txHash;
        const storage = getStorage();
        if (!storage) return false;
        const doc = await storage.collection('dex_tx_log').doc(txHash).get();
        if (doc.exists) {
            spentTxMemory.add(txHash);
            return true;
        }
        return false;
    }

    async function markTransactionSpent(txHash, meta = {}) {
        if (!txHash) return;
        spentTxMemory.add(txHash);
        const storage = getStorage();
        if (!storage) return;
        await storage.collection('dex_tx_log').doc(txHash).set({
            ...meta,
            usedAt: storage.getTimestamp()
        });
    }

    function normalizeCurrency(symbol) {
        const value = String(symbol || 'NCH').toUpperCase();
        if (value === 'NCHEESE') return 'NCH';
        return value;
    }

    /**
     * Verify a transaction on the blockchain
     */
    async function verifyTransaction(txHash, userAddress, expectedAmount, expectedCurrency, expectedRecipient, retries = 15) {
        const blockchainProxy = getBlockchainProxy();
        const vault = expectedRecipient || getVaultAddress();
        const acceptedRecipients = new Set(
            [vault, DEX_VAULT].map((a) => String(a || '').toLowerCase())
        );
        const expectedCurr = expectedCurrency ? normalizeCurrency(expectedCurrency) : null;
        const normalizedUser = String(userAddress || '').toLowerCase();
        const expectedAmt = parseFloat(expectedAmount);
        const lookupHash = encodeURIComponent(String(txHash || '').trim());

        for (let i = 0; i < retries; i++) {
            try {
                const response = await axios.get(`${blockchainProxy.apiUrl}/api/transaction/${lookupHash}`, {
                    headers: { 'x-api-key': blockchainProxy.apiKey },
                    timeout: 10000
                });

                if (response.data && response.data.success) {
                    const tx = response.data.transaction;
                    const txCurrency = normalizeCurrency(tx.currency || tx.data?.currency || 'NCH');
                    const txTo = String(tx.to || tx.data?.to || '').toLowerCase();
                    const txFrom = String(tx.from || '').toLowerCase();
                    const txAmount = parseFloat(tx.amount);

                    if (txFrom && normalizedUser && txFrom !== normalizedUser) {
                        console.warn(`Tx Sender Mismatch: Expected ${normalizedUser}, Got ${txFrom}`);
                        return false;
                    }

                    if (!acceptedRecipients.has(txTo)) {
                        console.warn(`Tx Recipient Mismatch: Expected one of ${[...acceptedRecipients].join(', ')}, Got ${txTo}`);
                        return false;
                    }

                    const amountDiff = Math.abs(txAmount - expectedAmt);
                    if (!Number.isFinite(txAmount) || amountDiff > Math.max(0.00001, expectedAmt * 1e-8)) {
                        console.warn(`Tx Amount Mismatch: Expected ${expectedAmt}, Got ${tx.amount}`);
                        return false;
                    }

                    if (expectedCurr && txCurrency !== expectedCurr) {
                        console.warn(`Tx Currency Mismatch: Expected ${expectedCurr}, Got ${txCurrency}`);
                        return false;
                    }

                    return true;
                }
            } catch (e) {
                console.warn(`Verification Retry ${i + 1}/${retries} for ${lookupHash}:`, e.message);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        return false;
    }

    async function refundToUser(userAddress, amount, currency, reason) {
        const blockchainProxy = getBlockchainProxy();
        if (!blockchainProxy || !amount || amount <= 0) return null;
        try {
            return await blockchainProxy.sendFromLiquidityPool(userAddress, amount, {
                type: 'refund',
                currency,
                description: reason || 'DEX refund'
            });
        } catch (e) {
            console.error('Refund failed:', e.message);
            return null;
        }
    }

    async function verifyBSCBridgeBurn(bscTxHash, userAddress, minAmount) {
        const rpcs = [
            'https://bsc-dataseed.binance.org/',
            'https://bsc-dataseed1.defibit.io/',
            'https://binance.llamarpc.com'
        ];
        for (const rpc of rpcs) {
            try {
                const provider = new ethers.JsonRpcProvider(rpc);
                const receipt = await provider.getTransactionReceipt(bscTxHash);
                if (!receipt || receipt.status !== 1) continue;
                if (receipt.from.toLowerCase() !== userAddress.toLowerCase()) return { valid: false, error: 'Sender mismatch on BSC' };

                const burnLog = receipt.logs.find((log) =>
                    log.address.toLowerCase() === WNCH_BSC_CONTRACT.toLowerCase() &&
                    log.topics[0] === BRIDGE_BURN_TOPIC
                );
                if (!burnLog) return { valid: false, error: 'No wNCH BridgeBurn event found' };

                const amountWei = BigInt(burnLog.data);
                const amount = Number(ethers.formatUnits(amountWei, 18));
                if (amount + 1e-9 < parseFloat(minAmount)) {
                    return { valid: false, error: `Burn amount ${amount} below expected ${minAmount}` };
                }
                return { valid: true, amount };
            } catch (e) {
                console.warn(`BSC verify via ${rpc}:`, e.message);
            }
        }
        return { valid: false, error: 'Could not verify BSC bridge burn transaction' };
    }

    function requireAdmin(req, res) {
        const adminKey = process.env.DEX_ADMIN_KEY;
        const provided = req.headers['x-admin-key'] || req.headers['x-api-key'] || req.query.adminKey;
        if (!adminKey) {
            res.status(503).json({ success: false, error: 'Admin endpoint not configured' });
            return false;
        }
        if (provided !== adminKey) {
            res.status(403).json({ success: false, error: 'Admin key required' });
            return false;
        }
        return true;
    }

    // ==========================================
    // POOLS
    // ==========================================

    /**
     * Get all pools
     * GET /api/pools
     */
    router.get('/pools', (req, res) => {
        try {
            const dex = getReadyDex();
            const pools = dex.getAllPools();
            res.json({ success: true, pools });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Get pool candles (for chart)
     * GET /api/pools/:poolId/candles
     */
    router.get('/pools/:poolId/candles', (req, res) => {
        try {
            const { poolId } = req.params;
            const { interval, timeframe } = req.query;
            const tokens = poolId.split('_');
            if (tokens.length !== 2) throw new Error('Invalid poolId format');

            const dex = getReadyDex();
            const candles = dex.getCandles(tokens[0], tokens[1], interval || timeframe || '15m');
            res.json({ success: true, candles });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    // ==========================================
    // SWAP
    // ==========================================

    /**
     * Get swap quote
     * POST /api/swap/quote
     */
    router.post('/swap/quote', (req, res) => {
        try {
            const { tokenIn, tokenOut, amountIn } = req.body;
            if (!tokenIn || !tokenOut || !amountIn) {
                return res.status(400).json({ success: false, error: 'tokenIn, tokenOut, and amountIn are required' });
            }
            if (tokenIn === 'wNCH' || tokenOut === 'wNCH') {
                return res.status(400).json({ success: false, error: WNCH_RETIRED_MSG });
            }
            const dex = getReadyDex();
            const result = dex.getSwapQuote(tokenIn, tokenOut, parseFloat(amountIn));

            res.json({
                success: true,
                ...result,
                tokenIn,
                tokenOut,
                fee: result.gasFeeNCH // Match frontend expectation
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    /**
     * Execute swap
     * POST /api/swap/execute
     */
    router.post('/swap/execute', async (req, res) => {
        try {
            const { tokenIn, tokenOut, amountIn, minAmountOut, userAddress, txHash, signature, message } = req.body;

            if (!tokenIn || !tokenOut || !amountIn || !userAddress || !txHash || !signature) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: tokenIn, tokenOut, amountIn, userAddress, txHash, signature'
                });
            }
            const tokenInNorm = normalizeCurrency(tokenIn);
            const tokenOutNorm = normalizeCurrency(tokenOut);
            if (tokenInNorm === 'WNCH' || tokenOutNorm === 'WNCH') {
                return res.status(400).json({ success: false, error: WNCH_RETIRED_MSG });
            }

            const swapMessage = message || `Swap ${amountIn} ${tokenInNorm} to ${tokenOutNorm}`;
            if (!verifySignature(userAddress, swapMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            const vault = getVaultAddress();
            const normalizedUser = String(userAddress || '').toLowerCase();
            const validTx = await verifyTransaction(txHash, normalizedUser, amountIn, tokenInNorm, vault, 15);
            if (!validTx) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid on-chain transaction. Funds not received.',
                    hint: 'Deposit may still be indexing. Retry swap confirmation with the same transaction hash.'
                });
            }

            if (await isTransactionSpent(txHash)) {
                return res.status(400).json({ success: false, error: 'Transaction already used' });
            }

            const dex = getReadyDex();
            const blockchainProxy = getBlockchainProxy();
            const quote = dex.getSwapQuote(tokenInNorm, tokenOutNorm, parseFloat(amountIn));
            const minOut = parseFloat(minAmountOut || 0);
            if (minOut > 0 && quote.amountOut + 1e-9 < minOut) {
                return res.status(400).json({
                    success: false,
                    error: `Slippage exceeded: expected at least ${minOut}, quote is ${quote.amountOut}`
                });
            }

            const result = await dex.swap(
                tokenInNorm,
                tokenOutNorm,
                parseFloat(amountIn),
                normalizedUser,
                { persist: false }
            );

            if (blockchainProxy && result.amountOut > 0) {
                try {
                    await blockchainProxy.sendFromLiquidityPool(normalizedUser, result.amountOut, {
                        type: 'swap_output',
                        currency: tokenOutNorm,
                        description: `Swap output: ${result.amountOut.toFixed(6)} ${tokenOutNorm}`
                    });
                } catch (payoutErr) {
                    console.error('Swap payout failed, rolling back pool state:', payoutErr.message);
                    const pool = dex.getPool(tokenInNorm, tokenOutNorm);
                    if (pool) {
                        if (pool.token0 === tokenInNorm) {
                            pool.reserve0 -= parseFloat(amountIn);
                            pool.reserve1 += result.amountOut;
                        } else {
                            pool.reserve1 -= parseFloat(amountIn);
                            pool.reserve0 += result.amountOut;
                        }
                    }
                    throw new Error('Swap payout failed. Your deposit was not consumed.');
                }
            }

            await markTransactionSpent(txHash, { type: 'swap', user: normalizedUser, tokenIn: tokenInNorm, tokenOut: tokenOutNorm, amountIn });
            if (dex.storage) {
                await dex.storage.savePool(dex.getPool(tokenInNorm, tokenOutNorm));
            }

            res.json({
                success: true,
                ...result,
                amountIn: parseFloat(amountIn),
                tokenIn: tokenInNorm,
                tokenOut: tokenOutNorm
            });
        } catch (error) {
            console.error('Swap error:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // ==========================================
    // LIQUIDITY
    // ==========================================

    /**
     * Add liquidity
     * POST /api/dex/liquidity/add
     * Body: { tokenA, tokenB, amountA, amountB, userAddress, signature }
     */
    router.post('/liquidity/add', async (req, res) => {
        try {
            const {
                poolId, token0Amount, token1Amount, txHash0, txHash1,
                tokenA, tokenB, amountA, amountB, userAddress, signature, message
            } = req.body;

            let tA = tokenA;
            let tB = tokenB;
            let amtA = amountA ?? token0Amount;
            let amtB = amountB ?? token1Amount;

            if ((!tA || !tB) && poolId) {
                const parts = poolId.split('_');
                if (parts.length === 2) {
                    tA = tA || parts[0];
                    tB = tB || parts[1];
                }
            }

            if (!tA || !tB || !amtA || !amtB || !userAddress || !txHash0 || !txHash1 || !signature) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields (tokens, amounts, userAddress, txHash0, txHash1, signature)'
                });
            }

            const poolKey = poolId || [tA, tB].sort().join('_');
            const addMessage = message || `Add Liquidity: ${amtA} ${tA} + ${amtB} ${tB} to ${poolKey}`;
            if (!verifySignature(userAddress, addMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            const vault = getVaultAddress();
            const normalizedUser = String(userAddress || '').toLowerCase();
            const validTx0 = await verifyTransaction(txHash0, normalizedUser, amtA, tA, vault, 15);
            const validTx1 = await verifyTransaction(txHash1, normalizedUser, amtB, tB, vault, 15);
            if (!validTx0 || !validTx1) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid or missing on-chain deposit transactions',
                    hint: 'Deposits may still be indexing. Retry confirmation with the same transaction hashes.'
                });
            }

            if (await isTransactionSpent(txHash0) || await isTransactionSpent(txHash1)) {
                return res.status(400).json({ success: false, error: 'Transaction already processed' });
            }

            const dex = getReadyDex();
            const result = await dex.addLiquidity(
                tA,
                tB,
                parseFloat(amtA),
                parseFloat(amtB),
                normalizedUser
            );

            await markTransactionSpent(txHash0, { type: 'liquidity_add', user: normalizedUser, poolId: result.poolId });
            await markTransactionSpent(txHash1, { type: 'liquidity_add', user: normalizedUser, poolId: result.poolId });

            res.json({
                success: true,
                ...result,
                lpTokens: result.lpTokensMinted
            });
        } catch (error) {
            console.error('Add liquidity error:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Remove liquidity
     * POST /api/dex/liquidity/remove
     * Body: { tokenA, tokenB, lpAmount, userAddress, signature }
     */
    router.post('/liquidity/remove', async (req, res) => {
        try {
            const {
                poolId, lpTokens, tokenA, tokenB, lpAmount, userAddress, signature, message
            } = req.body;

            let tA = tokenA;
            let tB = tokenB;
            let lp = lpAmount ?? lpTokens;

            if (poolId) {
                const parts = poolId.split('_');
                if (parts.length === 2) {
                    tA = parts[0];
                    tB = parts[1];
                }
            }

            if (!tA || !tB || !lp || !userAddress || !signature || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields (tokens, lp amount, userAddress, signature, message)'
                });
            }

            if (!verifySignature(userAddress, message, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            const poolKey = poolId || [tA, tB].sort().join('_');
            if (!message.includes(poolKey) || !message.includes(String(lp))) {
                return res.status(400).json({ success: false, error: 'Signature message mismatch' });
            }

            const dex = getReadyDex();
            const blockchainProxy = getBlockchainProxy();
            const pool = dex.getPool(tA, tB);
            if (!pool) {
                return res.status(404).json({ success: false, error: 'Pool not found' });
            }

            const result = await dex.removeLiquidity(
                tA,
                tB,
                parseFloat(lp),
                userAddress
            );

            if (blockchainProxy) {
                await blockchainProxy.sendFromLiquidityPool(userAddress, result.amount0Returned, {
                    type: 'liquidity_remove',
                    currency: pool.token0,
                    description: `Liquidity remove: ${result.amount0Returned} ${pool.token0}`
                });
                await blockchainProxy.sendFromLiquidityPool(userAddress, result.amount1Returned, {
                    type: 'liquidity_remove',
                    currency: pool.token1,
                    description: `Liquidity remove: ${result.amount1Returned} ${pool.token1}`
                });
            }

            res.json({
                success: true,
                ...result,
                token0Amount: result.amount0Returned,
                token1Amount: result.amount1Returned
            });
        } catch (error) {
            console.error('Remove liquidity error:', error);
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Create Pool (Wrapper for Add Liquidity)
     * POST /api/dex/pool/add
     * Body: { walletAddress, tokenSymbol, amount }
     */
    router.post('/pool/add', async (req, res) => {
        res.status(410).json({
            success: false,
            error: 'Deprecated endpoint. Use /liquidity/add with verified deposits or /pools/create with both token deposits.'
        });
    });

    /**
     * Create Pool (Frontend standard)
     * POST /api/pools/create or /pools/create
     * Body: { token0, token1, token0Amount, token1Amount, creatorAddress }
     */
    router.post(['/pools/create', '/pool/create'], async (req, res) => {
        try {
            const {
                token0, token1, token0Amount, token1Amount, creatorAddress,
                txHash0, txHash1, signature, message
            } = req.body;

            if (!token0 || !token1 || !token0Amount || !token1Amount || !creatorAddress || !txHash0 || !txHash1 || !signature) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: token0, token1, token0Amount, token1Amount, creatorAddress, txHash0, txHash1, signature'
                });
            }
            if (token0 === 'wNCH' || token1 === 'wNCH') {
                return res.status(400).json({ success: false, error: 'wNCH pools are not supported on native DEX' });
            }

            const poolKey = [token0, token1].sort().join('_');
            const createMessage = message || `Create Pool ${poolKey}: ${token0Amount} ${token0} + ${token1Amount} ${token1}`;
            if (!verifySignature(creatorAddress, createMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            const vault = getVaultAddress();
            const validTx0 = await verifyTransaction(txHash0, creatorAddress, token0Amount, token0, vault);
            const validTx1 = await verifyTransaction(txHash1, creatorAddress, token1Amount, token1, vault);
            if (!validTx0 || !validTx1) {
                return res.status(400).json({ success: false, error: 'Invalid or missing on-chain deposit transactions' });
            }
            if (await isTransactionSpent(txHash0) || await isTransactionSpent(txHash1)) {
                return res.status(400).json({ success: false, error: 'Transaction already processed' });
            }

            const dex = getReadyDex();
            const pool = await dex.createPool(token0, token1, token0Amount, token1Amount, creatorAddress);
            if (dex.storage && dex.storage.addPosition) {
                await dex.storage.addPosition(creatorAddress, pool.id, pool.totalLiquidity);
            }

            await markTransactionSpent(txHash0, { type: 'pool_create', user: creatorAddress, poolId: pool.id });
            await markTransactionSpent(txHash1, { type: 'pool_create', user: creatorAddress, poolId: pool.id });

            res.json({
                success: true,
                message: 'Pool created successfully',
                pool,
                lpTokens: pool.totalLiquidity
            });
        } catch (error) {
            console.error('Create pool error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==========================================
    // PRICE & POSITIONS
    // ==========================================

    /**
     * Get price
     * GET /api/dex/price/:tokenA/:tokenB
     */
    router.get('/price/:tokenA/:tokenB', (req, res) => {
        try {
            const { tokenA, tokenB } = req.params;
            const price = getReadyDex().getPrice(tokenA, tokenB);
            const twap = getReadyDex().getTWAP(tokenA, tokenB);

            res.json({
                success: true,
                pair: `${tokenA}/${tokenB}`,
                spotPrice: price,
                twap: twap,
                timestamp: Date.now()
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get price history
     * GET /api/dex/price/:tokenA/:tokenB/history
     */
    router.get('/price/:tokenA/:tokenB/history', (req, res) => {
        try {
            const { tokenA, tokenB } = req.params;
            const limit = parseInt(req.query.limit) || 100;
            const dex = getReadyDex();
            const history = dex.getPriceHistory(tokenA, tokenB, limit);

            res.json({
                success: true,
                pair: `${tokenA}/${tokenB}`,
                history
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get user's LP positions
     * GET /api/dex/positions/:address
     */
    router.get('/positions/:address', (req, res) => {
        try {
            const address = String(req.params.address || '').toLowerCase();
            const dex = getReadyDex();
            const positions = dex.getUserPositions(address);

            res.json({
                success: true,
                address,
                positions
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    });

    // ==========================================
    // STATISTICS
    // ==========================================

    /**
     * Get DEX statistics
     * GET /api/dex/stats
     */
    router.get('/stats', (req, res) => {
        try {
            const dex = getReadyDex();
            const stats = dex.getDEXStats();

            res.json({
                success: true,
                stats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ==========================================
    // PROTOCOL REVENUE (ADMIN)
    // ==========================================

    /**
     * Get protocol revenue (YOUR EARNINGS)
     * GET /api/dex/revenue
     */
    router.get('/revenue', async (req, res) => {
        try {
            if (!requireAdmin(req, res)) return;
            const dex = getReadyDex();
            // Get in-memory revenue
            const currentRevenue = dex.getProtocolRevenue();

            // Get from Firestore
            const storedRevenue = await dex.getProtocolRevenueFromStorage();

            res.json({
                success: true,
                treasuryAddress: dex.treasuryAddress,
                gasFeePerSwap: dex.gasFeeNCH + ' NCH',
                currentSessionRevenue: currentRevenue + ' NCH',
                totalRevenueNCH: storedRevenue.totalNCH,
                recentTransactions: storedRevenue.transactions.slice(0, 20),
                message: 'NCH gas fees from DEX swaps - this is YOUR earnings!'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get market prices
     * GET /api/market-prices
     */
    router.get('/market-prices', (req, res) => {
        try {
            const dex = getReadyDex();
            const prices = {
                USDT: { usd: 1, change24h: 0 },
                USDC: { usd: 1, change24h: 0 }
            };
            const baseOpen = 0.021968;
            dex.getAllPools().forEach((pool) => {
                if (pool.token0 === 'NCH' && pool.token1 === 'USDT') {
                    const nchUsd = pool.reserve1 / pool.reserve0;
                    const chg = ((nchUsd - baseOpen) / baseOpen) * 100;
                    prices.NCH = { usd: nchUsd, change24h: parseFloat(chg.toFixed(2)) };
                    prices.USDT = { usd: 1, change24h: 0 };
                } else if (pool.token0 === 'USDT' && pool.token1 === 'NCH') {
                    const nchUsd = pool.reserve0 / pool.reserve1;
                    const chg = ((nchUsd - baseOpen) / baseOpen) * 100;
                    prices.NCH = { usd: nchUsd, change24h: parseFloat(chg.toFixed(2)) };
                }
            });
            if (!prices.NCH) {
                const currentNch = global.nchMarketPrice;
                if (!currentNch || currentNch <= 0) {
                    // Price oracle not yet warmed up
                    res.json({ success: false, error: 'Price oracle initializing. Try again shortly.' });
                    return;
                }
                const chg = ((currentNch - currentNch) / currentNch) * 100; // 0% change until historical baseline is tracked
                prices.NCH = { usd: currentNch, change24h: parseFloat(chg.toFixed(2)) };
            }
            res.json({ success: true, prices });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Get public ticker data for Cheese DEX
     * GET /api/ticker or GET /ticker
     */
    router.get('/ticker', (req, res) => {
        try {
            const dex = getReadyDex();
            let nchPrice = global.nchMarketPrice;
            if (!nchPrice || nchPrice <= 0) {
                // Pool price not yet available — do NOT serve a hardcoded price
                return res.json({ success: false, error: 'Price oracle initializing. Try again shortly.' });
            }
            // nchChange is calculated below from pool reserves; initialize to 0
            let nchChange = 0;
            let totalVolumeBase = 0;
            let totalVolumeTarget = 0;

            dex.getAllPools().forEach((pool) => {
                if ((pool.token0 === 'NCH' && pool.token1 === 'USDT') || (pool.token0 === 'USDT' && pool.token1 === 'NCH')) {
                    const reserveNCH = pool.token0 === 'NCH' ? pool.reserve0 : pool.reserve1;
                    const reserveUSDT = pool.token0 === 'NCH' ? pool.reserve1 : pool.reserve0;
                    if (reserveNCH > 0) {
                        nchPrice = reserveUSDT / reserveNCH;
                        nchChange = parseFloat((((nchPrice - baseOpen) / baseOpen) * 100).toFixed(2));
                    }
                    totalVolumeBase += parseFloat(pool.volume24h0 || pool.totalVolume0 || 0);
                    totalVolumeTarget += parseFloat(pool.volume24h1 || pool.totalVolume1 || 0);
                }
            });

            res.json({
                success: true,
                exchange: "Cheese DEX",
                chainId: 20250,
                timestamp: new Date().toISOString(),
                tickers: [
                    {
                        ticker_id: "NCH_USDT",
                        base_currency: "NCH",
                        target_currency: "USDT",
                        symbol: "NCH/USDT",
                        last_price: nchPrice.toFixed(6),
                        high_24h: (nchPrice * 1.05).toFixed(6),
                        low_24h: (nchPrice * 0.95).toFixed(6),
                        base_volume: totalVolumeBase.toFixed(2),
                        target_volume: totalVolumeTarget.toFixed(2),
                        change_24h: (nchChange >= 0 ? "+" : "") + nchChange + "%",
                        updated_at: new Date().toISOString()
                    },
                    {
                        ticker_id: "NCH_USDC",
                        base_currency: "NCH",
                        target_currency: "USDC",
                        symbol: "NCH/USDC",
                        last_price: nchPrice.toFixed(6),
                        high_24h: (nchPrice * 1.05).toFixed(6),
                        low_24h: (nchPrice * 0.95).toFixed(6),
                        base_volume: (totalVolumeBase * 0.5).toFixed(2),
                        target_volume: (totalVolumeTarget * 0.5).toFixed(2),
                        change_24h: (nchChange >= 0 ? "+" : "") + nchChange + "%",
                        updated_at: new Date().toISOString()
                    }
                ]
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==========================================
    // BRIDGE, CONVERT & P2P (Restored)
    // ==========================================

    /**
     * Bridge Out (Lock on CHEESE -> Unlock on BSC)
     */
    router.post('/bridge/out', async (req, res) => {
        return res.status(410).json({ success: false, error: WNCH_RETIRED_MSG });
        try {
            const { token, fromAddress, toAddress, amount, txHash, signature, message } = req.body;
            if (!token || !fromAddress || !toAddress || !amount || !txHash || !signature) {
                return res.status(400).json({ success: false, error: 'Missing required bridge fields (including signature)' });
            }

            const bridgeMessage = message || `Bridge ${amount} ${token} to BSC ${toAddress}`;
            if (!verifySignature(fromAddress, bridgeMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            if (await isTransactionSpent(txHash)) {
                return res.status(400).json({ success: false, error: 'Bridge transaction already used' });
            }

            const validTx = await verifyTransaction(txHash, fromAddress, amount, token, BRIDGE_VAULT);
            if (!validTx) {
                return res.status(400).json({ success: false, error: 'Bridge transaction not found or invalid' });
            }

            const amountNum = parseFloat(amount);
            const bridgeFee = amountNum * 0.005;
            const netAmount = amountNum - bridgeFee;

            const dex = getReadyDex();
            const bridgeRef = await dex.storage.collection('dex_bridge_out').add({
                token,
                fromAddress,
                toAddress, // BSC Address
                amount: amountNum,
                fee: bridgeFee,
                netAmount: netAmount,
                txHashIn: txHash,
                status: 'locked',
                timestamp: dex.storage.getTimestamp()
            });

            await markTransactionSpent(txHash, { type: 'bridge_out', user: fromAddress, toAddress, amount: amountNum });

            console.log(`[BRIDGE-OUT] Intent: ${amountNum} ${token} -> Net: ${netAmount} (Fee: ${bridgeFee})`);
            res.json({
                success: true,
                message: 'Bridge intent recorded. NCH locked for wNCH release.',
                bridgeId: bridgeRef.id,
                amountNet: netAmount,
                fee: bridgeFee
            });
        } catch (error) {
            console.error('Bridge Out Error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Bridge In (Lock on BSC -> Unlock on CHEESE)
     */
    router.post('/bridge/in', async (req, res) => {
        return res.status(410).json({ success: false, error: WNCH_RETIRED_MSG });
        try {
            const { token, bscTxHash, userAddress, amount } = req.body;
            if (!token || !bscTxHash || !userAddress || !amount) {
                return res.status(400).json({ success: false, error: 'Missing bridge fields' });
            }

            if (await isTransactionSpent(bscTxHash)) {
                return res.status(400).json({ success: false, error: 'BSC bridge transaction already used' });
            }

            const burnCheck = await verifyBSCBridgeBurn(bscTxHash, userAddress, amount);
            if (!burnCheck.valid) {
                return res.status(400).json({ success: false, error: burnCheck.error });
            }

            const dex = getReadyDex();
            const blockchainProxy = getBlockchainProxy();
            const payoutAmount = burnCheck.amount || parseFloat(amount);

            if (blockchainProxy) {
                await blockchainProxy.sendFromLiquidityPool(userAddress, payoutAmount, {
                    type: 'bridge_in',
                    currency: 'NCH',
                    description: `Bridge in: ${payoutAmount} NCH from wNCH burn`
                });
            }

            const bridgeRef = await dex.storage.collection('dex_bridge_in').add({
                token,
                bscTxHash,
                userAddress,
                amount: payoutAmount,
                status: 'completed',
                timestamp: dex.storage.getTimestamp()
            });
            await markTransactionSpent(bscTxHash, { type: 'bridge_in', user: userAddress, amount: payoutAmount });

            res.json({
                success: true,
                message: 'Bridge-in completed',
                bridgeId: bridgeRef.id,
                amount: payoutAmount
            });
        } catch (error) {
            console.error('Bridge In Error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Convert Quote
     */
    router.get('/convert/quote', async (req, res) => {
        return res.status(410).json({ success: false, error: WNCH_RETIRED_MSG });
        try {
            const { fromToken, toToken, amount } = req.query;
            const from = (fromToken || 'USDT').toUpperCase();
            const to = (toToken || 'NCH').toUpperCase();
            const amountIn = parseFloat(amount || 0);

            const dex = getReadyDex();
            const priceOf = (sym) => {
                if (sym === 'USDT') return 1;
                const pool = dex.getPool(sym, 'USDT') || dex.getPool(sym, 'NCH');
                if (!pool) return sym === 'CHEESE' ? 0.1 : 0;
                if (pool.token0 === sym && pool.token1 === 'USDT') return pool.reserve1 / pool.reserve0;
                if (pool.token1 === sym && pool.token0 === 'USDT') return pool.reserve0 / pool.reserve1;
                if (pool.token0 === sym && pool.token1 === 'NCH') {
                    const nchUsd = dex.getPrice('NCH', 'USDT') || 1;
                    return (pool.reserve1 / pool.reserve0) * nchUsd;
                }
                if (pool.token1 === sym && pool.token0 === 'NCH') {
                    const nchUsd = dex.getPrice('NCH', 'USDT') || 1;
                    return (pool.reserve0 / pool.reserve1) * nchUsd;
                }
                return 0;
            };

            const fromUsd = priceOf(from);
            const toUsd = priceOf(to);
            if (!fromUsd || !toUsd) {
                return res.status(400).json({ success: false, error: 'No market price available for conversion pair' });
            }

            const usdValue = amountIn * fromUsd;
            const toAmount = usdValue / toUsd;
            const rate = fromUsd / toUsd;

            res.json({
                success: true,
                fromToken: from,
                toToken: to,
                fromPriceUSD: fromUsd,
                toPriceUSD: toUsd,
                toAmount,
                rate,
                usdValue
            });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    /**
     * Execute Convert
     */
    router.post('/convert', async (req, res) => {
        return res.status(410).json({ success: false, error: WNCH_RETIRED_MSG });
        try {
            const { fromToken, toToken, amount, userAddress, txHash, signature, message } = req.body;
            if (!fromToken || !toToken || !amount || !userAddress || !txHash || !signature) {
                return res.status(400).json({ success: false, error: 'Missing required convert fields' });
            }

            const convertMessage = message || `Convert ${amount} ${fromToken} to ${toToken}`;
            if (!verifySignature(userAddress, convertMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }
            if (await isTransactionSpent(txHash)) {
                return res.status(400).json({ success: false, error: 'Transaction already used' });
            }

            const vault = getVaultAddress();
            const validTx = await verifyTransaction(txHash, userAddress, amount, fromToken, vault);
            if (!validTx) {
                return res.status(400).json({ success: false, error: 'Invalid on-chain deposit for conversion' });
            }

            const dex = getReadyDex();
            const from = fromToken.toUpperCase();
            const to = toToken.toUpperCase();
            const amountIn = parseFloat(amount);
            const priceOf = (sym) => {
                if (sym === 'USDT') return 1;
                const pool = dex.getPool(sym, 'USDT') || dex.getPool(sym, 'NCH');
                if (!pool) return sym === 'CHEESE' ? 0.1 : 0;
                if (pool.token0 === sym && pool.token1 === 'USDT') return pool.reserve1 / pool.reserve0;
                if (pool.token1 === sym && pool.token0 === 'USDT') return pool.reserve0 / pool.reserve1;
                const nchUsd = dex.getPrice('NCH', 'USDT') || 1;
                if (pool.token0 === sym) return (pool.reserve1 / pool.reserve0) * nchUsd;
                return (pool.reserve0 / pool.reserve1) * nchUsd;
            };
            const fromUsd = priceOf(from);
            const toUsd = priceOf(to);
            if (!fromUsd || !toUsd) {
                return res.status(400).json({ success: false, error: 'No market price for conversion pair' });
            }
            const toAmount = (amountIn * fromUsd) / toUsd;

            const blockchainProxy = getBlockchainProxy();
            if (blockchainProxy && toAmount > 0) {
                await blockchainProxy.sendFromLiquidityPool(userAddress, toAmount, {
                    type: 'convert_output',
                    currency: toToken,
                    description: `Convert ${amountIn} ${fromToken} -> ${toAmount} ${toToken}`
                });
            }

            const convertRef = await dex.storage.collection('dex_conversions').add({
                fromToken,
                toToken,
                amount: amountIn,
                toAmount,
                userAddress,
                txHash,
                status: 'completed',
                timestamp: dex.storage.getTimestamp()
            });
            await markTransactionSpent(txHash, { type: 'convert', user: userAddress, fromToken, toToken, amount: amountIn });

            res.json({ success: true, conversionId: convertRef.id, toAmount });
        } catch (error) {
            console.error('Convert error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * P2P Orders List
     */
    router.get('/p2p/orders', async (req, res) => {
        try {
            const dex = getReadyDex();
            const snapshot = await dex.storage.collection('dex_p2p_orders').where('status', '==', 'active').get();
            const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            res.json({ success: true, orders });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    /**
     * P2P Trades History/List for a specific User
     * GET /api/p2p/trades
     */
    router.get('/p2p/trades', async (req, res) => {
        try {
            const { userAddress } = req.query;
            if (!userAddress) {
                return res.status(400).json({ success: false, error: 'userAddress parameter is required' });
            }
            const dex = getReadyDex();
            const addr = userAddress.toLowerCase();

            // Fetch all orders/trades from Firestore (P2P collection)
            const snapshot = await dex.storage.collection('dex_p2p_orders').get();
            const allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Filter to return those where the user is either the creator or the acceptor
            const userTrades = allOrders.filter(order => 
                (order.creatorAddress && order.creatorAddress.toLowerCase() === addr) ||
                (order.acceptorAddress && order.acceptorAddress.toLowerCase() === addr)
            );

            res.json({ success: true, trades: userTrades });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Create P2P Order
     */
    router.post('/p2p/create', async (req, res) => {
        try {
            const {
                creatorAddress, tokenOffered, amountOffered, tokenWanted, amountWanted,
                txHash, signature, message
            } = req.body;
            if (!creatorAddress || !tokenOffered || !amountOffered || !tokenWanted || !amountWanted || !txHash || !signature) {
                return res.status(400).json({ success: false, error: 'Missing required P2P order fields' });
            }

            const createMessage = message || `P2P Offer ${amountOffered} ${tokenOffered} for ${amountWanted} ${tokenWanted}`;
            if (!verifySignature(creatorAddress, createMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }
            if (await isTransactionSpent(txHash)) {
                return res.status(400).json({ success: false, error: 'Escrow transaction already used' });
            }

            const vault = getVaultAddress();
            const validTx = await verifyTransaction(txHash, creatorAddress, amountOffered, tokenOffered, vault);
            if (!validTx) {
                return res.status(400).json({ success: false, error: 'Escrow deposit not verified' });
            }

            const dex = getReadyDex();
            const orderRef = await dex.storage.collection('dex_p2p_orders').add({
                creatorAddress,
                tokenOffered,
                amountOffered: parseFloat(amountOffered),
                tokenWanted,
                amountWanted: parseFloat(amountWanted),
                escrowTxHash: txHash,
                status: 'active',
                timestamp: dex.storage.getTimestamp()
            });
            await markTransactionSpent(txHash, { type: 'p2p_escrow', user: creatorAddress, orderId: orderRef.id });

            res.json({ success: true, orderId: orderRef.id });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    /**
     * Accept P2P Order
     */
    router.post('/p2p/accept', async (req, res) => {
        try {
            const { orderId, acceptorAddress, txHash, signature, message } = req.body;
            if (!orderId || !acceptorAddress || !txHash || !signature) {
                return res.status(400).json({ success: false, error: 'Missing required accept fields' });
            }

            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Order not found' });
            const order = orderDoc.data();
            if (order.status !== 'active') {
                return res.status(400).json({ success: false, error: `Order is ${order.status}, not active` });
            }
            if (order.creatorAddress.toLowerCase() === acceptorAddress.toLowerCase()) {
                return res.status(400).json({ success: false, error: 'Cannot accept your own order' });
            }

            const acceptMessage = message || `P2P Accept order ${orderId}: pay ${order.amountWanted} ${order.tokenWanted}`;
            if (!verifySignature(acceptorAddress, acceptMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }
            if (await isTransactionSpent(txHash)) {
                return res.status(400).json({ success: false, error: 'Payment transaction already used' });
            }

            const vault = getVaultAddress();
            const validTx = await verifyTransaction(txHash, acceptorAddress, order.amountWanted, order.tokenWanted, vault);
            if (!validTx) {
                return res.status(400).json({ success: false, error: 'Payment transaction not verified' });
            }

            const blockchainProxy = getBlockchainProxy();
            if (blockchainProxy) {
                await blockchainProxy.sendFromLiquidityPool(order.creatorAddress, order.amountWanted, {
                    type: 'p2p_payment',
                    currency: order.tokenWanted,
                    description: `P2P payment for order ${orderId}`
                });
                await blockchainProxy.sendFromLiquidityPool(acceptorAddress, order.amountOffered, {
                    type: 'p2p_release',
                    currency: order.tokenOffered,
                    description: `P2P escrow release for order ${orderId}`
                });
            }

            await orderRef.update({
                status: 'completed',
                acceptorAddress,
                txHashPayment: txHash,
                completedAt: dex.storage.getTimestamp()
            });
            await markTransactionSpent(txHash, { type: 'p2p_accept', user: acceptorAddress, orderId });

            res.json({ success: true, message: 'Order accepted and settled' });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    /**
     * Cancel P2P Order
     */
    router.post('/p2p/cancel', async (req, res) => {
        try {
            const { orderId, userAddress, signature, message } = req.body;
            if (!orderId || !userAddress || !signature) {
                return res.status(400).json({ success: false, error: 'Missing cancel fields' });
            }

            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Order not found' });
            const order = orderDoc.data();
            if (order.creatorAddress.toLowerCase() !== userAddress.toLowerCase()) {
                return res.status(403).json({ success: false, error: 'Unauthorized' });
            }
            if (order.status !== 'active') {
                return res.status(400).json({ success: false, error: `Order is ${order.status}` });
            }

            const cancelMessage = message || `P2P Cancel order ${orderId}`;
            if (!verifySignature(userAddress, cancelMessage, signature)) {
                return res.status(401).json({ success: false, error: 'Invalid signature' });
            }

            const blockchainProxy = getBlockchainProxy();
            if (blockchainProxy) {
                await blockchainProxy.sendFromLiquidityPool(userAddress, order.amountOffered, {
                    type: 'p2p_refund',
                    currency: order.tokenOffered,
                    description: `P2P escrow refund for cancelled order ${orderId}`
                });
            }

            await orderRef.update({ status: 'cancelled', cancelledAt: dex.storage.getTimestamp() });
            res.json({ success: true, message: 'Order cancelled and escrow refunded' });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    /**
     * Initiate P2P Trade (P2P Chat Card / Trade Panel flow)
     */
    router.post('/p2p/trade/initiate', async (req, res) => {
        try {
            const { orderId, buyerAddress, signature, message } = req.body;
            if (!orderId || !buyerAddress) {
                return res.status(400).json({ success: false, error: 'orderId and buyerAddress are required' });
            }
            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(orderId);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Order not found' });
            const order = orderDoc.data();

            if (order.creatorAddress.toLowerCase() === buyerAddress.toLowerCase()) {
                return res.status(400).json({ success: false, error: 'Cannot trade your own order' });
            }

            const sellerAddress = order.creatorAddress;
            const initialMessages = [{
                sender: 'system',
                text: `P2P Trade initiated. Buyer: send ${order.amountWanted} ${order.tokenWanted} to seller off-chain, then click 'I Have Paid'.`,
                timestamp: Date.now()
            }];

            await orderRef.update({
                buyerAddress,
                sellerAddress,
                status: 'pending_payment',
                initiatedAt: Date.now(),
                messages: initialMessages
            });

            const updatedDoc = await orderRef.get();
            res.json({ success: true, trade: { id: updatedDoc.id, ...updatedDoc.data() } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Get P2P Trade Chat Messages
     */
    router.get('/p2p/trade/chat', async (req, res) => {
        try {
            const { tradeId, userAddress } = req.query;
            if (!tradeId) return res.status(400).json({ success: false, error: 'tradeId required' });
            const dex = getReadyDex();
            const orderDoc = await dex.storage.collection('dex_p2p_orders').doc(tradeId).get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Trade not found' });
            const trade = orderDoc.data();
            res.json({ success: true, messages: trade.messages || [] });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Send P2P Trade Chat Message
     */
    router.post('/p2p/trade/chat/send', async (req, res) => {
        try {
            const { tradeId, senderAddress, text, signature, message } = req.body;
            if (!tradeId || !senderAddress || !text) {
                return res.status(400).json({ success: false, error: 'tradeId, senderAddress, and text required' });
            }
            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(tradeId);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Trade not found' });

            const trade = orderDoc.data();
            const isBuyer = trade.buyerAddress && trade.buyerAddress.toLowerCase() === senderAddress.toLowerCase();
            const isSeller = trade.sellerAddress && trade.sellerAddress.toLowerCase() === senderAddress.toLowerCase();
            const role = isBuyer ? 'buyer' : (isSeller ? 'seller' : 'user');

            const currentMessages = trade.messages || [];
            currentMessages.push({
                sender: senderAddress,
                text,
                role,
                timestamp: Date.now()
            });

            await orderRef.update({ messages: currentMessages });
            res.json({ success: true, messages: currentMessages });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Mark P2P Trade as Paid
     */
    router.post('/p2p/trade/mark-paid', async (req, res) => {
        try {
            const { tradeId, userAddress, referenceNumber } = req.body;
            if (!tradeId || !userAddress) return res.status(400).json({ success: false, error: 'tradeId and userAddress required' });
            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(tradeId);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Trade not found' });

            const trade = orderDoc.data();
            const messages = trade.messages || [];
            messages.push({
                sender: 'system',
                text: `Payment marked as sent by buyer (Ref: ${referenceNumber || 'N/A'}). Seller: verify payment and release escrow.`,
                timestamp: Date.now()
            });

            await orderRef.update({
                status: 'paid',
                paymentConfirmation: { referenceNumber: referenceNumber || 'N/A', paidAt: Date.now() },
                messages
            });

            res.json({ success: true, message: 'Trade marked as paid' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Release P2P Escrow to Buyer
     */
    router.post('/p2p/trade/release', async (req, res) => {
        try {
            const { tradeId, userAddress } = req.body;
            if (!tradeId || !userAddress) return res.status(400).json({ success: false, error: 'tradeId and userAddress required' });
            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(tradeId);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Trade not found' });

            const trade = orderDoc.data();
            if (trade.sellerAddress.toLowerCase() !== userAddress.toLowerCase() && trade.creatorAddress.toLowerCase() !== userAddress.toLowerCase()) {
                return res.status(403).json({ success: false, error: 'Only the seller can release escrow' });
            }

            const blockchainProxy = getBlockchainProxy();
            if (blockchainProxy && trade.buyerAddress) {
                await blockchainProxy.sendFromLiquidityPool(trade.buyerAddress, trade.amountOffered, {
                    type: 'p2p_release',
                    currency: trade.tokenOffered,
                    description: `P2P escrow release for trade ${tradeId}`
                });
            }

            const messages = trade.messages || [];
            messages.push({
                sender: 'system',
                text: 'Escrow funds released to buyer! Trade completed successfully 🎉',
                timestamp: Date.now()
            });

            await orderRef.update({
                status: 'completed',
                releasedAt: Date.now(),
                messages
            });

            res.json({ success: true, message: 'Escrow released and trade completed' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * File P2P Trade Dispute
     */
    router.post('/p2p/trade/dispute', async (req, res) => {
        try {
            const { tradeId, userAddress, reason } = req.body;
            if (!tradeId || !userAddress) return res.status(400).json({ success: false, error: 'tradeId and userAddress required' });
            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(tradeId);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Trade not found' });

            const trade = orderDoc.data();
            const messages = trade.messages || [];
            messages.push({
                sender: 'system',
                text: `⚠️ Trade disputed by ${userAddress.substring(0,6)}... Reason: "${reason || 'No reason specified'}". Admin mediation requested.`,
                timestamp: Date.now()
            });

            await orderRef.update({
                status: 'disputed',
                dispute: { filedBy: userAddress, reason: reason || '', timestamp: Date.now() },
                messages
            });

            res.json({ success: true, message: 'Dispute filed successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Admin Resolve P2P Trade Dispute
     */
    router.post('/p2p/trade/resolve', async (req, res) => {
        try {
            const { tradeId, adminAddress, resolution } = req.body;
            if (!tradeId || !resolution) return res.status(400).json({ success: false, error: 'tradeId and resolution required' });
            const dex = getReadyDex();
            const orderRef = dex.storage.collection('dex_p2p_orders').doc(tradeId);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Trade not found' });

            const trade = orderDoc.data();
            const blockchainProxy = getBlockchainProxy();

            let newStatus = 'completed';
            if (resolution === 'release_to_buyer') {
                newStatus = 'completed';
                if (blockchainProxy && trade.buyerAddress) {
                    await blockchainProxy.sendFromLiquidityPool(trade.buyerAddress, trade.amountOffered, {
                        type: 'p2p_dispute_resolution',
                        currency: trade.tokenOffered,
                        description: `Dispute resolution release for trade ${tradeId}`
                    });
                }
            } else {
                newStatus = 'cancelled';
                if (blockchainProxy && trade.sellerAddress) {
                    await blockchainProxy.sendFromLiquidityPool(trade.sellerAddress, trade.amountOffered, {
                        type: 'p2p_dispute_resolution',
                        currency: trade.tokenOffered,
                        description: `Dispute resolution refund for trade ${tradeId}`
                    });
                }
            }

            const messages = trade.messages || [];
            messages.push({
                sender: 'system',
                text: `⚖️ Admin resolution applied: ${resolution}. Trade marked as ${newStatus}.`,
                timestamp: Date.now()
            });

            await orderRef.update({
                status: newStatus,
                resolution: { adminAddress, resolution, resolvedAt: Date.now() },
                messages
            });

            res.json({ success: true, message: `Dispute resolved (${resolution})` });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Support Chat AI
     */
    let chatService = null;
    router.post('/support/chat', async (req, res) => {
        try {
            const dex = getReadyDex();
            if (!chatService && dex.storage.db) {
                chatService = new ChatService(dex.storage.db);
            }
            const { message, userAddress } = req.body;
            if (!message) return res.status(400).json({ success: false, error: 'Message required' });
            if (!chatService) return res.status(503).json({ success: false, error: 'Support service unavailable' });

            const reply = await chatService.processQuery(message, userAddress);
            res.json({ success: true, reply });
        } catch (error) {
            console.error('Support Chat Error:', error);
            res.status(500).json({ success: false, error: 'AI Brain Freeze 🥶' });
        }
    });

    return router;
}

module.exports = createDEXRoutes;
