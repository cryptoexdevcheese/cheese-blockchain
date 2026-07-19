/**
 * Token Search and Management System
 * Like MetaMask's token search functionality
 */

class TokenSearch {
    constructor(blockchainAPI) {
        this.api = blockchainAPI;
        this.allTokens = new Map();
        this.userTokens = new Map();
        this.priceCache = new Map(); // Cache for prices
        this.priceCacheTime = new Map(); // Cache timestamps
        this.priceCacheDuration = 60000; // Cache for 1 minute
        this.loadUserTokens();
        this.initializePopularTokens();
        this.initializePriceCache();
        this.dexApiUrl = 'https://cheeseblockchain.com'; // CHEESE DEX PROD API
        console.log('🐺 Wolf Mode: All CHEESE prices from YOUR DEX');
    }

    // Initialize price cache from localStorage
    initializePriceCache() {
        try {
            const cached = localStorage.getItem('cheeseTokenPrices');
            const cachedTime = localStorage.getItem('cheeseTokenPricesTime');
            if (cached && cachedTime) {
                const prices = JSON.parse(cached);
                const cacheTime = parseInt(cachedTime);
                const now = Date.now();
                // Only use cache if less than 5 minutes old
                if (now - cacheTime < 300000) {
                    Object.entries(prices).forEach(([symbol, price]) => {
                        this.priceCache.set(symbol.toUpperCase(), price);
                        this.priceCacheTime.set(symbol.toUpperCase(), cacheTime);
                    });
                }
            }
            // Fetch NCHEESE price from DEX in background
            this.fetchNCHEESEPriceFromDEX().catch(e => console.log('DEX price fetch pending...'));
            console.log('✅ Price cache initialized');
        } catch (error) {
            console.error('Error loading price cache:', error);
        }
    }

    // Save price cache to localStorage
    savePriceCache() {
        try {
            const prices = {};
            this.priceCache.forEach((price, symbol) => {
                prices[symbol] = price;
            });
            localStorage.setItem('cheeseTokenPrices', JSON.stringify(prices));
            localStorage.setItem('cheeseTokenPricesTime', Date.now().toString());
        } catch (error) {
            console.error('Error saving price cache:', error);
        }
    }

    // Fetch NCHEESE price from DEX liquidity pools (DYNAMIC PRICING)
    async fetchNCHEESEPriceFromDEX() {
        try {
            // Use proxy endpoint via main API client (avoids Mixed Content / CORS issues)
            // This ensures we use the correct Production setup
            const data = await this.api.request('/api/dex-proxy/price/NCHEESE');

            if (data.success && data.price > 0) {
                console.log(`💰 Got NCHEESE price from DEX: $${data.price} (${data.source})`);
                this.priceCache.set('NCHEESE', data.price);
                this.priceCacheTime.set('NCHEESE', Date.now());
                this.savePriceCache();
                return data.price;
            }

            console.warn('⚠️ DEX price unavailable or zero, using $0.022 seed');
            return 0.022; // Seed price fallback
        } catch (error) {
            console.warn('⚠️ DEX price fetch failed (using $0.022 seed):', error.message);
            return 0.022; // Seed price fallback
        }
    }


    // Map token symbols to CoinGecko IDs
    getCoinGeckoId(symbol) {
        const symbolUpper = symbol?.toUpperCase();

        // CRITICAL FIX: NCHEESE should NEVER use CoinGecko (different "cheese" token exists)
        if (symbolUpper === 'NCHEESE') {
            return null; // Don't fetch from CoinGecko for NCHEESE
        }

        const symbolMap = {
            'BNB': 'binancecoin',
            'WBNB': 'wrapped-bnb',
            'USDT': 'tether',
            'USDC': 'usd-coin',
            'ETH': 'ethereum',
            'CAKE': 'pancakeswap-token',
            'DAI': 'dai',
            'BUSD': 'binance-usd',
            'WBTC': 'wrapped-bitcoin',
            'BTC': 'bitcoin',
            'CHEESE': null  // Will fetch from PancakeSwap/BSC directly
        };
        return symbolMap[symbolUpper] || null;
    }

    // Fetch price from CoinGecko API or PancakeSwap for CHEESE
    async fetchPriceFromAPI(symbol) {
        const symbolUpper = symbol.toUpperCase();

        // Special handling for CHEESE token - fetch from YOUR DEX (Wolf Strategy)
        if (symbolUpper === 'CHEESE') {
            return await this.fetchTokenPriceFromDEX(symbolUpper);
        }

        const coinGeckoId = this.getCoinGeckoId(symbol);
        if (!coinGeckoId) {
            return null;
        }

        try {
            // Use CoinGecko simple price API
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinGeckoId}&vs_currencies=usd`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            if (data[coinGeckoId] && data[coinGeckoId].usd) {
                const price = data[coinGeckoId].usd;
                // Update cache
                this.priceCache.set(symbol.toUpperCase(), price);
                this.priceCacheTime.set(symbol.toUpperCase(), Date.now());
                this.savePriceCache();
                return price;
            }
            return null;
        } catch (error) {
            console.error(`Error fetching price for ${symbol}:`, error);
            return null;
        }
    }

    // 🐺 Wolf of Crypto: Fetch token price from YOUR DEX
    async fetchTokenPriceFromDEX(symbol) {
        try {
            const symbolUpper = symbol.toUpperCase();
            console.log(`🐺 Fetching ${symbolUpper} price from YOUR DEX...`);

            // Use proxy endpoint via main API client
            const data = await this.api.request(`/api/dex-proxy/price/${symbolUpper}`);

            if (data.success && (data.price_usd > 0 || data.price > 0)) {
                const price = data.price_usd || data.price;
                console.log(`💰 ${symbolUpper} price from YOUR DEX: $${price}`);
                this.priceCache.set(symbolUpper, price);
                this.priceCacheTime.set(symbolUpper, Date.now());
                this.savePriceCache();
                return price;
            }

            console.warn(`⚠️ No price for ${symbolUpper} on YOUR DEX`);
            return null;
        } catch (error) {
            console.warn(`⚠️ DEX price fetch failed for ${symbol}:`, error.message);
            return null;
        }
    }

    // Fallback: Fetch CHEESE price from PancakeSwap API (only if DEX fails)
    async fetchCheesePriceFromPancakeSwap() {
        // Try YOUR DEX first (Wolf Strategy)
        const dexPrice = await this.fetchTokenPriceFromDEX('CHEESE');
        if (dexPrice !== null) return dexPrice;

        // Fallback to PancakeSwap only if DEX unavailable
        console.log('⚠️ DEX unavailable, falling back to PancakeSwap...');
        try {
            // CHEESE token contract on BSC
            const CHEESE_CONTRACT = '0xf4ECd8c58Ec14e3AA4A0a2DDC33Bd3D5DEee73cd';

            // Try DexScreener API as fallback
            const dexScreenerAPI = `https://api.dexscreener.com/latest/dex/tokens/${CHEESE_CONTRACT}`;
            const dexResponse = await fetch(dexScreenerAPI);

            if (dexResponse.ok) {
                const dexData = await dexResponse.json();
                if (dexData.pairs && dexData.pairs.length > 0) {
                    const bestPair = dexData.pairs
                        .filter(p => p.chainId === 'bsc' || p.chainId === '56')
                        .sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0))[0];

                    if (bestPair && bestPair.priceUsd) {
                        const price = parseFloat(bestPair.priceUsd);
                        if (price > 0) {
                            console.log(`💰 Got CHEESE price from DexScreener: $${price}`);
                            this.priceCache.set('CHEESE', price);
                            this.priceCacheTime.set('CHEESE', Date.now());
                            this.savePriceCache();
                            return price;
                        }
                    }
                }
            }

            console.warn('⚠️ Could not fetch CHEESE price from fallback sources');
            return null;
        } catch (error) {
            console.error('Error fetching CHEESE price:', error);
            return null;
        }
    }

    // Fetch multiple prices at once (more efficient)
    async fetchPricesFromAPI(symbols) {
        // Handle NCHEESE separately - fetch from DEX
        const hasNCHEESE = symbols.some(s => s.toUpperCase() === 'NCHEESE');
        if (hasNCHEESE) {
            await this.fetchNCHEESEPriceFromDEX();
        }

        const symbolsToFetch = symbols.filter(s => s.toUpperCase() !== 'NCHEESE');

        // Handle CHEESE separately - fetch from PancakeSwap
        const hasCheese = symbolsToFetch.some(s => s.toUpperCase() === 'CHEESE');
        if (hasCheese) {
            const cheesePrice = await this.fetchCheesePriceFromPancakeSwap();
            if (cheesePrice) {
                console.log(`✅ CHEESE price fetched: $${cheesePrice}`);
            }
        }

        // Filter out CHEESE from CoinGecko fetch (we handle it separately)
        const symbolsForCoinGecko = symbolsToFetch.filter(s => s.toUpperCase() !== 'CHEESE');

        const coinGeckoIds = symbolsForCoinGecko
            .map(s => this.getCoinGeckoId(s))
            .filter(id => id !== null);

        if (coinGeckoIds.length === 0) {
            this.savePriceCache(); // Save NCHEESE price
            return {};
        }

        if (this.apiDisabled) {
            console.warn('⚠️ CoinGecko API previously failed. Using fallback prices.');
            return {};
        }

        try {
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinGeckoIds.join(',')}&vs_currencies=usd`;
            console.log('🌐 Fetching prices from:', url);

            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.status === 429) {
                console.warn('⚠️ CoinGecko Rate Limit (429). Disabling API calls for this session.');
                this.apiDisabled = true;
                throw new Error('Rate limit exceeded');
            }

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            console.log('📊 CoinGecko response:', data);
            const prices = {};

            // Map back to symbols (excluding NCHEESE)
            symbolsToFetch.forEach(symbol => {
                const coinGeckoId = this.getCoinGeckoId(symbol);
                if (coinGeckoId && data[coinGeckoId] && data[coinGeckoId].usd) {
                    const price = data[coinGeckoId].usd;
                    prices[symbol.toUpperCase()] = price;
                    console.log(`💰 Saved price for ${symbol}: $${price}`);
                    // Update cache
                    this.priceCache.set(symbol.toUpperCase(), price);
                    this.priceCacheTime.set(symbol.toUpperCase(), Date.now());
                }
            });

            this.savePriceCache();
            return prices;
        } catch (error) {
            console.warn('⚠️ Error fetching prices (using fallbacks):', error.message);
            // If it's a CORS or network error, potentially disable to avoid spam
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                this.failureCount = (this.failureCount || 0) + 1;
                if (this.failureCount > 3) {
                    console.warn('❌ Too many API failures. Disabling CoinGecko for this session.');
                    this.apiDisabled = true;
                }
            }
            this.savePriceCache();
            return {};
        }
    }

    // Initialize popular tokens database
    initializePopularTokens() {
        const popularTokens = [
            // NCheese Native (Native CHEESE Token) - Official logo with blue background (embedded)
            // Logo is always available at ./icon-192.png (default embedded logo)
            { address: '0x0000000000000000000000000000000000000000', symbol: 'NCHEESE', name: 'NCheese (Native CHEESE)', decimals: 18, logoURI: './icon-192.png', chain: 'cheese-native' },


            // BSC CHEESE Token
            { address: '0xf4ECd8c58Ec14e3AA4A0a2DDC33Bd3D5DEee73cd', symbol: 'CHEESE', name: 'CHEESE (BSC)', decimals: 18, logoURI: './icon-192.png', chain: 'bsc', isFromDEX: true },

            // BSC Native Token
            { address: '0x0000000000000000000000000000000000000001', symbol: 'BNB', name: 'Binance Coin (BNB)', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', chain: 'bsc' },

            // BSC Tokens
            { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png', chain: 'bsc' },
            { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png', chain: 'bsc' },
            { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', chain: 'bsc' },
            { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo.png', chain: 'bsc' },
            { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/9956/small/dai-multi-collateral-mcd.png', chain: 'bsc' },
            { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', name: 'Binance USD', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/9576/small/BUSD.png', chain: 'bsc' },
            { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png', chain: 'bsc' },

            // Ethereum Native Token
            { address: '0x0000000000000000000000000000000000000002', symbol: 'ETH', name: 'Ethereum (ETH)', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', chain: 'ethereum' },

            // Ethereum Tokens
            { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png', chain: 'ethereum' },
            { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png', chain: 'ethereum' },
            { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/9956/small/dai-multi-collateral-mcd.png', chain: 'ethereum' },
            { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, logoURI: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png', chain: 'ethereum' }
        ];

        popularTokens.forEach(token => {
            this.allTokens.set(token.address.toLowerCase(), token);
        });
    }

    // Load user's added tokens
    loadUserTokens() {
        try {
            const saved = localStorage.getItem('cheeseUserTokens');
            if (saved) {
                const tokens = JSON.parse(saved);
                tokens.forEach(token => {
                    this.userTokens.set(token.address.toLowerCase(), token);
                });
            }
        } catch (error) {
            console.error('Error loading user tokens:', error);
        }
    }

    // Save user's added tokens
    saveUserTokens() {
        try {
            localStorage.setItem('cheeseUserTokens', JSON.stringify(Array.from(this.userTokens.values())));
        } catch (error) {
            console.error('Error saving user tokens:', error);
        }
    }

    // Search tokens
    async searchTokens(query, chain = null) {
        const queryLower = query.toLowerCase().trim();
        if (!queryLower) {
            return this.getPopularTokens(chain);
        }

        const results = [];

        // Search in all tokens
        this.allTokens.forEach(token => {
            if (chain && token.chain !== chain) return;

            if (token.symbol.toLowerCase().includes(queryLower) ||
                token.name.toLowerCase().includes(queryLower) ||
                token.address.toLowerCase().includes(queryLower)) {
                results.push({ ...token, isAdded: this.userTokens.has(token.address.toLowerCase()) });
            }
        });

        // Search in user tokens
        this.userTokens.forEach(token => {
            if (chain && token.chain !== chain) return;

            if (!results.find(r => r.address.toLowerCase() === token.address.toLowerCase()) &&
                (token.symbol.toLowerCase().includes(queryLower) ||
                    token.name.toLowerCase().includes(queryLower) ||
                    token.address.toLowerCase().includes(queryLower))) {
                results.push({ ...token, isAdded: true });
            }
        });

        // If query looks like an address, add it to results
        if (queryLower.startsWith('0x')) {
            // Check if it's a valid address format (40 hex chars after 0x)
            const addressPart = queryLower.replace(/^0x/, '');
            if (addressPart.length >= 20 && /^[0-9a-f]+$/.test(addressPart)) {
                // Normalize to full 42-char address
                const normalizedAddress = '0x' + addressPart.padStart(40, '0').slice(0, 40);
                const existing = results.find(r => r.address.toLowerCase() === normalizedAddress.toLowerCase());

                if (!existing) {
                    // Check if this address is already in user tokens
                    const userToken = Array.from(this.userTokens.values()).find(t =>
                        t.address.toLowerCase() === normalizedAddress.toLowerCase()
                    );

                    if (userToken) {
                        // Use existing user token data
                        results.push({ ...userToken, isAdded: true });
                    } else {
                        // Create new custom token entry
                        results.push({
                            address: normalizedAddress,
                            symbol: 'TOKEN',
                            name: 'Custom Token',
                            decimals: 18,
                            logoURI: '',
                            chain: chain || 'cheese-native',
                            isAdded: false,
                            isCustom: true,
                            addressInput: query // Keep original input for display
                        });
                    }
                }
            }
        }

        return results.sort((a, b) => {
            // Prioritize user tokens
            if (a.isAdded && !b.isAdded) return -1;
            if (!a.isAdded && b.isAdded) return 1;
            // Then by symbol match
            const aSymbolMatch = a.symbol.toLowerCase().startsWith(queryLower);
            const bSymbolMatch = b.symbol.toLowerCase().startsWith(queryLower);
            if (aSymbolMatch && !bSymbolMatch) return -1;
            if (!aSymbolMatch && bSymbolMatch) return 1;
            return 0;
        });
    }

    // Get popular tokens
    getPopularTokens(chain = null) {
        const popular = Array.from(this.allTokens.values())
            .filter(token => !chain || token.chain === chain)
            .slice(0, 20)
            .map(token => ({
                ...token,
                isAdded: this.userTokens.has(token.address.toLowerCase())
            }));
        return popular;
    }

    // Add token to user's list
    addToken(token) {
        const tokenData = {
            ...token,
            addedAt: Date.now(),
            balance: 0
        };
        this.userTokens.set(token.address.toLowerCase(), tokenData);
        this.saveUserTokens();
        return tokenData;
    }

    // Remove token from user's list
    removeToken(address) {
        this.userTokens.delete(address.toLowerCase());
        this.saveUserTokens();
    }

    // Check if token is added
    isTokenAdded(address) {
        return this.userTokens.has(address.toLowerCase());
    }

    // Get user's tokens
    getUserTokens(chain = null) {
        const tokens = Array.from(this.userTokens.values());
        if (chain) {
            return tokens.filter(token => token.chain === chain);
        }
        return tokens;
    }

    // Get token by address
    getToken(address) {
        return this.userTokens.get(address.toLowerCase()) || this.allTokens.get(address.toLowerCase());
    }

    // Update token balance
    updateTokenBalance(address, balance) {
        const token = this.userTokens.get(address.toLowerCase());
        if (token) {
            token.balance = balance;
            this.saveUserTokens();
        }
    }

    // Get token price (with real-time fetching)
    async getTokenPrice(symbol, forceRefresh = false) {
        if (!symbol) return 0;

        const symbolUpper = symbol.toUpperCase();

        // NCHEESE: Fetch dynamic price from DEX
        if (symbolUpper === 'NCHEESE') {
            return await this.fetchNCHEESEPriceFromDEX();
        }

        const now = Date.now();

        // Check cache first (unless force refresh)
        if (!forceRefresh) {
            const cachedPrice = this.priceCache.get(symbolUpper);
            const cacheTime = this.priceCacheTime.get(symbolUpper);

            if (cachedPrice !== undefined && cacheTime && (now - cacheTime) < this.priceCacheDuration) {
                return cachedPrice;
            }
        }

        // Fallback prices REMOVED by user request
        const fallbackPrices = {};

        // Try to fetch from API
        try {
            const price = await this.fetchPriceFromAPI(symbol);
            if (price !== null && price > 0) {
                return price;
            }
        } catch (error) {
            console.warn(`Failed to fetch price for ${symbol}, using fallback:`, error);
        }

        // Use fallback price if available
        return fallbackPrices[symbolUpper] || 0;
    }

    // Get token price synchronously (from cache or fallback)
    getTokenPriceSync(symbol) {
        if (!symbol) return 0;

        const symbolUpper = symbol.toUpperCase();

        // NCHEESE: Use cached DEX price or fallback to 0 if not found
        if (symbolUpper === 'NCHEESE') {
            const cachedPrice = this.priceCache.get('NCHEESE');
            return cachedPrice !== undefined ? cachedPrice : 0;
        }

        const cachedPrice = this.priceCache.get(symbolUpper);

        if (cachedPrice !== undefined) {
            return cachedPrice;
        }

        // Fallback prices REMOVED by user request
        const fallbackPrices = {};

        return fallbackPrices[symbolUpper] || 0;
    }

    // Refresh prices for multiple tokens
    async refreshPrices(symbols) {
        const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))];

        // Fetch NCHEESE price from DEX if included
        if (uniqueSymbols.includes('NCHEESE')) {
            await this.fetchNCHEESEPriceFromDEX();
        }

        await this.fetchPricesFromAPI(uniqueSymbols);
        this.savePriceCache();
    }

    // Get token name (with fallback)
    getTokenName(token) {
        if (!token) return 'Unknown Token';
        if (token.name) return token.name;
        if (token.symbol) return token.symbol;
        return 'Unknown Token';
    }

    // Get token symbol (with fallback)
    getTokenSymbol(token) {
        if (!token) return 'TOKEN';
        if (token.symbol) return token.symbol;
        if (token.address) return token.address.slice(0, 6) + '...' + token.address.slice(-4);
        return 'TOKEN';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TokenSearch;
}

