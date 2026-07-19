/**
 * Token Manager - Multi-Token Support
 * Supports ERC-20, BEP-20, and other token standards
 */

class TokenManager {
    constructor(blockchainAPI) {
        this.api = blockchainAPI;
        this.supportedTokens = this.getSupportedTokens();
        this.userTokens = this.loadUserTokens();
    }

    // Get supported tokens
    getSupportedTokens() {
        return {
            // Native
            'CHEESE': {
                symbol: 'CHEESE',
                name: 'Cheese Native Token',
                decimals: 18,
                chain: 'native',
                address: null,
                logo: '🧀'
            },
            // Ethereum (ERC-20)
            'ETH': {
                symbol: 'ETH',
                name: 'Ethereum',
                decimals: 18,
                chain: 'ethereum',
                address: null,
                logo: '💎'
            },
            'USDT': {
                symbol: 'USDT',
                name: 'Tether USD',
                decimals: 6,
                chain: 'ethereum',
                address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                logo: '💵'
            },
            'USDC': {
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                chain: 'ethereum',
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                logo: '💵'
            },
            // BSC (BEP-20)
            'BNB': {
                symbol: 'BNB',
                name: 'Binance Coin',
                decimals: 18,
                chain: 'bsc',
                address: null,
                logo: '🔵'
            },
            'BUSD': {
                symbol: 'BUSD',
                name: 'Binance USD',
                decimals: 18,
                chain: 'bsc',
                address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
                logo: '💵'
            },
            // Polygon
            'MATIC': {
                symbol: 'MATIC',
                name: 'Polygon',
                decimals: 18,
                chain: 'polygon',
                address: null,
                logo: '🟣'
            }
        };
    }

    // Load user tokens from storage
    loadUserTokens() {
        const saved = localStorage.getItem('userTokens');
        return saved ? JSON.parse(saved) : [];
    }

    // Save user tokens
    saveUserTokens() {
        localStorage.setItem('userTokens', JSON.stringify(this.userTokens));
    }

    // Add custom token
    addCustomToken(tokenData) {
        const token = {
            symbol: tokenData.symbol,
            name: tokenData.name,
            decimals: tokenData.decimals || 18,
            chain: tokenData.chain,
            address: tokenData.address,
            logo: tokenData.logo || '🪙',
            custom: true
        };

        this.userTokens.push(token);
        this.saveUserTokens();
        return token;
    }

    // Remove custom token
    removeCustomToken(symbol) {
        this.userTokens = this.userTokens.filter(t => t.symbol !== symbol);
        this.saveUserTokens();
    }

    // Get all tokens (supported + custom)
    getAllTokens() {
        const all = { ...this.supportedTokens };
        this.userTokens.forEach(token => {
            all[token.symbol] = token;
        });
        return all;
    }

    // Get token balance
    async getTokenBalance(walletAddress, tokenSymbol, chain = 'native') {
        const token = this.getAllTokens()[tokenSymbol];
        if (!token) {
            throw new Error(`Token ${tokenSymbol} not found`);
        }

        if (token.chain === 'native' || tokenSymbol === 'CHEESE') {
            // Native token balance
            return await this.api.getBalance(walletAddress);
        } else {
            // ERC-20/BEP-20 token balance
            return await this.getERC20Balance(walletAddress, token);
        }
    }

    // Get ERC-20/BEP-20 token balance
    async getERC20Balance(walletAddress, token) {
        // FIXED: Use MultiChainProvider or CrossChainBalance for actual balance fetching
        try {
            if (typeof MultiChainProvider !== 'undefined') {
                const multiChain = new MultiChainProvider();
                const networkId = token.chain;  // 'bsc', 'ethereum', 'polygon'
                return await multiChain.getTokenBalance(walletAddress, token.symbol, networkId);
            }

            if (typeof CrossChainBalance !== 'undefined') {
                const crossChain = new CrossChainBalance();
                return await crossChain.getTokenBalance(walletAddress, token.address, token.decimals);
            }

            console.warn('⚠️ No balance provider available for', token.symbol);
            return 0;
        } catch (error) {
            console.error('Get token balance error:', error);
            return 0;
        }
    }


    // Transfer token
    async transferToken(fromAddress, toAddress, tokenSymbol, amount, privateKey) {
        const token = this.getAllTokens()[tokenSymbol];
        if (!token) {
            throw new Error(`Token ${tokenSymbol} not found`);
        }

        if (token.chain === 'native' || tokenSymbol === 'CHEESE') {
            // Native token transfer
            return await this.api.sendTransaction(fromAddress, toAddress, amount, privateKey);
        } else {
            // ERC-20/BEP-20 token transfer
            return await this.transferERC20Token(fromAddress, toAddress, token, amount, privateKey);
        }
    }

    // Transfer ERC-20/BEP-20 token
    async transferERC20Token(fromAddress, toAddress, token, amount, privateKey) {
        // FIXED: Use MultiChainProvider for ERC-20/BEP-20 token transfers
        if (typeof MultiChainProvider !== 'undefined') {
            const multiChain = new MultiChainProvider();
            const networkId = token.chain;  // 'bsc', 'ethereum', 'polygon'

            console.log(`📤 Transferring ${amount} ${token.symbol} on ${networkId}`);

            return await multiChain.sendTransaction(
                fromAddress,
                toAddress,
                amount,
                privateKey,
                networkId,
                token.symbol  // Token symbol for ERC-20 transfer
            );
        }

        throw new Error('MultiChainProvider not available. Please refresh the page.');
    }


    // Detect tokens in wallet
    async detectTokens(walletAddress) {
        const detected = [];

        // Check native tokens
        for (const [symbol, token] of Object.entries(this.supportedTokens)) {
            if (token.chain === 'native') {
                try {
                    const balance = await this.getTokenBalance(walletAddress, symbol);
                    if (balance > 0) {
                        detected.push({ ...token, balance });
                    }
                } catch (error) {
                    console.error(`Error detecting ${symbol}:`, error);
                }
            }
        }

        return detected;
    }

    // Get token info
    getTokenInfo(symbol) {
        return this.getAllTokens()[symbol] || null;
    }
}

// Attach to window for browser usage
if (typeof window !== 'undefined') {
    window.TokenManager = TokenManager;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TokenManager;
}


