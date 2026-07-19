/**
 * 🧀 CHEESE DEX Engine
 * Core AMM Logic for Swaps and Liquidity
 */

const SWAP_FEE_RATE = 0.003; // 0.3% on input (Uniswap-style)

class CheeseDEX {
    constructor(blockchainProxy, storage) {
        this.blockchain = blockchainProxy;
        this.storage = storage;
        this.pools = [];

        this.gasFeeNCH = 1.0;
        this.treasuryAddress = '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3';

        this.revenueSession = {
            totalNCH: 0,
            transactions: []
        };
    }

    async initialize() {
        console.log('🔄 Loading DEX Pools...');
        if (this.storage) {
            const loadedPools = await this.storage.loadPools();
            if (loadedPools && loadedPools.length > 0) {
                this.pools = loadedPools;
                console.log(`✅ Loaded ${this.pools.length} pools from storage`);
            } else {
                console.log('ℹ️ No pools found in storage, starting fresh');
            }
            if (this.storage.loadPositions) {
                await this.storage.loadPositions();
            }
        }
    }

    getAllPools() {
        return this.pools.map((pool) => this.withPoolStats(pool));
    }

    withPoolStats(pool) {
        const price = this.getPrice(pool.token0, pool.token1);
        const usdtReserve = pool.token0 === 'USDT' ? pool.reserve0 : (pool.token1 === 'USDT' ? pool.reserve1 : 0);
        const nchReserve = pool.token0 === 'NCH' ? pool.reserve0 : (pool.token1 === 'NCH' ? pool.reserve1 : 0);
        const tvl = pool.token0 === 'USDT' || pool.token1 === 'USDT'
            ? usdtReserve + (nchReserve * price)
            : pool.reserve0 + pool.reserve1;
        const apr = tvl > 0 ? ((pool.fees24h || 0) * 365 / tvl) * 100 : 0;
        return {
            ...pool,
            stats: {
                tvl,
                apr,
                price
            }
        };
    }

    getPool(tokenA, tokenB) {
        return this.pools.find(p =>
            (p.token0 === tokenA && p.token1 === tokenB) ||
            (p.token0 === tokenB && p.token1 === tokenA)
        );
    }

    poolKey(tokenA, tokenB) {
        return [tokenA, tokenB].sort().join('_');
    }

    async createPool(tokenA, tokenB, amountA, amountB, creator) {
        if (this.getPool(tokenA, tokenB)) {
            throw new Error(`Pool ${tokenA}/${tokenB} already exists`);
        }

        const pool = {
            id: this.poolKey(tokenA, tokenB),
            token0: tokenA,
            token1: tokenB,
            reserve0: parseFloat(amountA),
            reserve1: parseFloat(amountB),
            totalLiquidity: Math.sqrt(parseFloat(amountA) * parseFloat(amountB)),
            fees24h: 0,
            volume24h: 0,
            createdAt: Date.now(),
            createdBy: creator,
            candles: {}
        };

        const price = pool.reserve1 / pool.reserve0;
        const now = Math.floor(Date.now() / 1000);
        pool.candles['15m'] = [{
            time: now,
            open: price,
            high: price,
            low: price,
            close: price
        }];

        this.pools.push(pool);

        if (this.storage) {
            await this.storage.savePool(pool);
        }

        return pool;
    }

    getSwapQuote(tokenIn, tokenOut, amountIn) {
        const pool = this.getPool(tokenIn, tokenOut);
        if (!pool) throw new Error('Pool not found');

        const amountInNum = parseFloat(amountIn);
        if (!amountInNum || amountInNum <= 0) {
            return { amountOut: 0, priceImpact: 0, swapFee: 0, gasFeeNCH: this.gasFeeNCH, rate: '0' };
        }

        const isToken0 = pool.token0 === tokenIn;
        const reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
        const reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

        if (reserveIn <= 0 || reserveOut <= 0) {
            return { amountOut: 0, priceImpact: 0, swapFee: 0, gasFeeNCH: this.gasFeeNCH, rate: '0' };
        }

        const swapFee = amountInNum * SWAP_FEE_RATE;
        const amountInAfterFee = amountInNum - swapFee;
        const amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
        const priceImpact = (amountInNum / reserveIn) * 100;

        return {
            amountOut,
            priceImpact,
            swapFee,
            gasFeeNCH: this.gasFeeNCH,
            rate: (amountOut / amountInNum).toFixed(8)
        };
    }

    async swap(tokenIn, tokenOut, amountIn, userAddress, options = {}) {
        const { persist = true } = options;
        const pool = this.getPool(tokenIn, tokenOut);
        if (!pool) throw new Error('Pool not found');

        const quote = this.getSwapQuote(tokenIn, tokenOut, amountIn);

        if (pool.token0 === tokenIn) {
            pool.reserve0 += parseFloat(amountIn);
            pool.reserve1 -= quote.amountOut;
        } else {
            pool.reserve1 += parseFloat(amountIn);
            pool.reserve0 -= quote.amountOut;
        }

        if (pool.reserve0 < 0 || pool.reserve1 < 0) {
            throw new Error('Insufficient pool liquidity for this swap');
        }

        this.updateCandles(pool, tokenIn);

        const usdVolume = this.toUsdEstimate(tokenIn, parseFloat(amountIn), pool);
        pool.volume24h = (pool.volume24h || 0) + usdVolume;
        pool.fees24h = (pool.fees24h || 0) + quote.swapFee;

        this.revenueSession.totalNCH += this.gasFeeNCH;
        this.revenueSession.transactions.push({
            user: userAddress,
            gasFeeNCH: this.gasFeeNCH,
            swapFee: quote.swapFee,
            swap: `${tokenIn} → ${tokenOut}`,
            timestamp: Date.now()
        });

        if (persist && this.storage) {
            await this.storage.savePool(pool);
        }

        return {
            success: true,
            amountIn: parseFloat(amountIn),
            amountOut: quote.amountOut,
            swapFee: quote.swapFee,
            gasFeeNCH: this.gasFeeNCH,
            priceImpact: quote.priceImpact
        };
    }

    updateCandles(pool, tokenIn) {
        const currentPrice = pool.token0 === 'NCH' ? (pool.reserve1 / pool.reserve0) : (pool.reserve0 / pool.reserve1);
        const now = Math.floor(Date.now() / 1000);
        const intervals = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1h': 3600,
            '4h': 14400,
            '1d': 86400
        };

        if (!pool.candles) pool.candles = {};
        if (Array.isArray(pool.candles)) {
            pool.candles = { '15m': pool.candles };
        }

        Object.entries(intervals).forEach(([label, seconds]) => {
            if (!pool.candles[label]) pool.candles[label] = [];
            const candles = pool.candles[label];
            const candleTime = Math.floor(now / seconds) * seconds;
            const lastCandle = candles[candles.length - 1];

            if (lastCandle && lastCandle.time === candleTime) {
                lastCandle.high = Math.max(lastCandle.high, currentPrice);
                lastCandle.low = Math.min(lastCandle.low, currentPrice);
                lastCandle.close = currentPrice;
            } else {
                candles.push({
                    time: candleTime,
                    open: lastCandle ? lastCandle.close : currentPrice,
                    high: currentPrice,
                    low: currentPrice,
                    close: currentPrice
                });
                if (candles.length > 1000) candles.shift();
            }
        });
    }

    toUsdEstimate(token, amount, pool) {
        if (token === 'USDT' || token === 'USDC') return amount;
        if (token === 'NCH') {
            const price = pool.token0 === 'NCH' ? pool.reserve1 / pool.reserve0 : pool.reserve0 / pool.reserve1;
            return amount * price;
        }
        return amount;
    }

    async addLiquidity(tokenA, tokenB, amountA, amountB, userAddress) {
        let pool = this.getPool(tokenA, tokenB);

        if (!pool) {
            pool = await this.createPool(tokenA, tokenB, amountA, amountB, userAddress);
            const liquidityMinted = pool.totalLiquidity;
            if (this.storage) {
                await this.storage.addPosition(userAddress, pool.id, liquidityMinted);
            }
            return {
                success: true,
                amount0Added: pool.reserve0,
                amount1Added: pool.reserve1,
                lpTokensMinted: liquidityMinted,
                poolId: pool.id
            };
        }

        const amount0 = pool.token0 === tokenA ? amountA : amountB;
        const amount1 = pool.token0 === tokenA ? amountB : amountA;

        const totalSupply = pool.totalLiquidity;
        let liquidityMinted;

        if (totalSupply === 0) {
            liquidityMinted = Math.sqrt(amount0 * amount1);
        } else {
            liquidityMinted = Math.min(
                (amount0 * totalSupply) / pool.reserve0,
                (amount1 * totalSupply) / pool.reserve1
            );
        }

        if (liquidityMinted <= 0) throw new Error('Insufficient liquidity minted');

        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.totalLiquidity += liquidityMinted;

        if (this.storage) {
            await this.storage.savePool(pool);
            await this.storage.addPosition(userAddress, pool.id, liquidityMinted);
        }

        return {
            success: true,
            amount0Added: amount0,
            amount1Added: amount1,
            lpTokensMinted: liquidityMinted,
            poolId: pool.id
        };
    }

    async removeLiquidity(tokenA, tokenB, lpAmount, userAddress) {
        const pool = this.getPool(tokenA, tokenB);
        if (!pool) throw new Error('Pool not found');

        if (this.storage) {
            const held = this.storage.getLpBalance(userAddress, pool.id);
            if (held < lpAmount) {
                throw new Error(`Insufficient LP balance. Have ${held}, requested ${lpAmount}`);
            }
        }

        const share = lpAmount / pool.totalLiquidity;
        const amount0 = share * pool.reserve0;
        const amount1 = share * pool.reserve1;

        if (amount0 <= 0 || amount1 <= 0) throw new Error('Insufficient liquidity burned');

        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.totalLiquidity -= lpAmount;

        if (this.storage) {
            await this.storage.savePool(pool);
            await this.storage.updatePosition(userAddress, pool.id, -lpAmount);
        }

        return {
            success: true,
            amount0Returned: amount0,
            amount1Returned: amount1,
            lpTokensBurned: lpAmount,
            poolId: pool.id
        };
    }

    getPrice(tokenA, tokenB) {
        const pool = this.getPool(tokenA, tokenB);
        if (!pool) return 0;

        if (pool.token0 === tokenA) return pool.reserve1 / pool.reserve0;
        return pool.reserve0 / pool.reserve1;
    }

    getTWAP(tokenA, tokenB, timeframe = '15m', periods = 12) {
        const candles = this.getCandles(tokenA, tokenB, timeframe);
        if (!candles.length) return this.getPrice(tokenA, tokenB);
        const slice = candles.slice(-periods);
        const sum = slice.reduce((acc, c) => acc + c.close, 0);
        return sum / slice.length;
    }

    getCandles(tokenA, tokenB, timeframe = '15m') {
        const pool = this.getPool(tokenA, tokenB);
        if (!pool) return [];

        if (pool.candles && !Array.isArray(pool.candles)) {
            return pool.candles[timeframe] || pool.candles['15m'] || [];
        }
        return pool.candles || [];
    }

    getPriceHistory(tokenA, tokenB, limit) {
        return this.getCandles(tokenA, tokenB).slice(-limit);
    }

    getUserPositions(address) {
        if (this.storage && this.storage.getEnrichedUserPositions) {
            return this.storage.getEnrichedUserPositions(address, this.pools);
        }
        if (this.storage && this.storage.getUserPositions) {
            return this.storage.getUserPositions(address);
        }
        return [];
    }

    getDEXStats() {
        let totalLiquidityUSD = 0;
        let volume24h = 0;
        let fees24h = 0;

        for (const pool of this.pools) {
            const price = this.getPrice(pool.token0, pool.token1);
            if (pool.token0 === 'USDT' || pool.token1 === 'USDT') {
                const usdt = pool.token0 === 'USDT' ? pool.reserve0 : pool.reserve1;
                const nch = pool.token0 === 'NCH' ? pool.reserve0 : pool.reserve1;
                totalLiquidityUSD += usdt + (nch * price);
            } else {
                totalLiquidityUSD += pool.reserve0 + pool.reserve1;
            }
            volume24h += pool.volume24h || 0;
            fees24h += pool.fees24h || 0;
        }

        return {
            totalLiquidityUSD,
            volume24h,
            fees24h,
            totalPools: this.pools.length
        };
    }

    getProtocolRevenue() {
        return this.revenueSession.totalNCH;
    }

    async getProtocolRevenueFromStorage() {
        return { totalNCH: this.getProtocolRevenue(), transactions: this.revenueSession.transactions };
    }
}

module.exports = CheeseDEX;
