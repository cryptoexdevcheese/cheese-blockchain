/**
 * Cross-Chain Balance Checker
 * Fetches token balances from multiple blockchains (BSC, Ethereum, etc.)
 */

class CrossChainBalance {
    constructor() {
        this.bscRpcUrl = 'https://bsc-dataseed.binance.org/';
        this.ethRpcUrl = 'https://eth.llamarpc.com'; // Would need real key
        this.web3 = null;
        this.initWeb3();

        // Common token contracts on BSC
        this.bscTokens = {
            'CHEESE': '0xf4ECd8c58Ec14e3AA4A0a2DDC33Bd3D5DEee73cd', // BSC CHEESE contract - REAL ADDRESS
            'USDT': '0x55d398326f99059fF775485246999027B3197955',
            'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
            'BNB': 'native', // Native BNB
            'ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            'CAKE': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
            'DAI': '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
            'AFX': '0x37A4926578C00845cc8e9063BF73528b188903BF',
            'CheeseV2': '0x3A220f351252089D385b29beca14e27F204c296A'
        };

        this.version = 'v5.0-WEBAI-FIX-20250602';
    }

    async initWeb3() {
        try {
            if (typeof window !== 'undefined' && !window.Web3) {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/web3@latest/dist/web3.min.js';
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
            if (typeof window !== 'undefined' && window.Web3) {
                this.web3 = new window.Web3(this.bscRpcUrl);
            } else if (typeof Web3 !== 'undefined') {
                this.web3 = new Web3(this.bscRpcUrl);
            }
        } catch (error) {
            console.error('Web3 initialization error:', error);
        }
    }

    /**
     * Get BNB balance (native BSC token)
     */
    async getBNBBalance(address) {
        try {
            if (!this.web3) {
                await this.initWeb3();
            }
            if (!this.web3) {
                throw new Error('Web3 not available');
            }

            const balance = await this.web3.eth.getBalance(address);
            const balanceInBNB = this.web3.utils.fromWei(balance, 'ether');
            return parseFloat(balanceInBNB);
        } catch (error) {
            console.error('Get BNB balance error:', error);
            return 0;
        }
    }

    /**
     * Get ERC-20/BEP-20 token balance
     */
    async getTokenBalance(address, tokenContract, decimals = 18) {
        try {
            // CRITICAL: Skip zero address (native NCHEESE) - it's not a BSC token
            if (!tokenContract ||
                tokenContract === '0x0000000000000000000000000000000000000000' ||
                tokenContract === 'native' ||
                tokenContract.toLowerCase() === '0x0000000000000000000000000000000000000000') {
                // Silently skip - this is expected for native NCHEESE
                return 0;
            }

            // Use BSCScan API instead of Web3.js to avoid compatibility issues
            console.log(`🔴 BSC DEBUG: Fetching balance for ${tokenContract} - address: ${address} via BSCScan API`);
            
            try {
                const apiUrl = `https://api.bscscan.com/api?module=account&action=tokenbalance&contractaddress=${tokenContract}&address=${address}&tag=latest&apikey=YourApiKeyToken`;
                const response = await fetch(apiUrl);
                const data = await response.json();
                
                if (data.status === '1' && data.result) {
                    const rawBalance = data.result;
                    console.log(`🔴 BSC DEBUG: Raw balance from BSCScan API: ${rawBalance}`);
                    const divisor = Math.pow(10, decimals);
                    const actualBalance = parseFloat(rawBalance) / divisor;
                    return actualBalance;
                } else {
                    console.log(`🔴 BSC DEBUG: BSCScan API returned no data`);
                    return 0;
                }
            } catch (apiError) {
                console.error(`🔴 BSC ERROR: BSCScan API call failed:`, apiError.message);
                return 0;
            }

            // CRITICAL: Add pending CHEESE from swaps
            const pendingCheese = this.getPendingCheeseBalance(address, tokenContract);
            const totalBalance = actualBalance + pendingCheese;

            if (pendingCheese > 0) {
                console.log(`💰 CHEESE balance: ${actualBalance.toFixed(6)} (BSC) + ${pendingCheese.toFixed(6)} (pending from swap) = ${totalBalance.toFixed(6)}`);
            }

            return totalBalance;
        } catch (error) {
            // Log detailed errors for debugging
            if (tokenContract && tokenContract !== '0x0000000000000000000000000000000000000000' && tokenContract !== 'native') {
                console.error(`🔴 BSC ERROR: Get token balance error for ${tokenContract}:`, error.message);
                console.error(`🔴 BSC ERROR: Full error details:`, error);
            }
            return 0;
        }
    }

    /**
     * Get token info (name, symbol, decimals) from contract
     */
    async getTokenInfo(contractAddress) {
        try {
            if (!this.web3) {
                await this.initWeb3();
            }
            if (!this.web3) {
                throw new Error('Web3 not available');
            }

            // ERC-20 standard ABI for name, symbol, decimals
            const tokenABI = [
                {
                    "constant": true,
                    "inputs": [],
                    "name": "name",
                    "outputs": [{ "name": "", "type": "string" }],
                    "type": "function"
                },
                {
                    "constant": true,
                    "inputs": [],
                    "name": "symbol",
                    "outputs": [{ "name": "", "type": "string" }],
                    "type": "function"
                },
                {
                    "constant": true,
                    "inputs": [],
                    "name": "decimals",
                    "outputs": [{ "name": "", "type": "uint8" }],
                    "type": "function"
                }
            ];

            const contract = new this.web3.eth.Contract(tokenABI, contractAddress);
            const [name, symbol, decimals] = await Promise.all([
                contract.methods.name().call().catch(() => 'Unknown Token'),
                contract.methods.symbol().call().catch(() => 'UNKNOWN'),
                contract.methods.decimals().call().catch(() => 18)
            ]);

            return { name, symbol, decimals: parseInt(decimals) || 18 };
        } catch (error) {
            console.error(`Get token info error for ${contractAddress}:`, error);
            return { name: 'Unknown Token', symbol: 'UNKNOWN', decimals: 18 };
        }
    }

    /**
     * Get all token balances for an address on BSC
     * Now includes user-added tokens from portfolio
     */
    async getBSCBalances(address, userTokens = []) {
        const balances = {
            network: 'BSC',
            address: address,
            tokens: []
        };

        try {
            // Get BNB balance (native)
            const bnbBalance = await this.getBNBBalance(address);
            if (bnbBalance > 0) {
                balances.tokens.push({
                    symbol: 'BNB',
                    name: 'Binance Coin',
                    address: 'native',
                    balance: bnbBalance,
                    decimals: 18,
                    chain: 'bsc',
                    logoURI: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'
                });
            }

            // Check common tokens
            const checkedAddresses = new Set(); // Track checked addresses to avoid duplicates
            for (const [symbol, contractAddress] of Object.entries(this.bscTokens)) {
                if (contractAddress === 'native') continue; // Skip native BNB (already handled)

                const normalizedAddr = contractAddress.toLowerCase();
                if (checkedAddresses.has(normalizedAddr)) continue; // Skip if already checked
                checkedAddresses.add(normalizedAddr);

                try {
                    const balance = await this.getTokenBalance(address, contractAddress, 18);
                    if (balance > 0) {
                        balances.tokens.push({
                            symbol: symbol,
                            name: this.getTokenName(symbol),
                            address: contractAddress,
                            balance: balance,
                            decimals: 18,
                            chain: 'bsc',
                            logoURI: this.getTokenLogo(symbol)
                        });
                    }
                } catch (error) {
                    // Skip tokens that fail
                    console.warn(`Failed to get balance for ${symbol}:`, error.message);
                }
            }

            // CRITICAL FIX: Check user-added tokens from portfolio (BSC chain only)
            // Include ALL tokens with 0x addresses (BSC tokens) even if chain is not set to 'bsc'
            // This fixes the issue where tokens added by contract address might not have 'bsc' chain set
            const bscUserTokens = userTokens.filter(t =>
                t.address &&
                t.address !== 'native' &&
                t.address !== '0x0000000000000000000000000000000000000000' &&
                t.address.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
                t.address.startsWith('0x') &&
                // Include if chain is BSC OR if it's a 0x address (likely BSC token)
                ((t.chain && (t.chain.toLowerCase() === 'bsc')) ||
                    (!t.chain || t.chain === 'cheese-native' || !t.chain.includes('native')))
            );

            for (const userToken of bscUserTokens) {
                const normalizedAddr = userToken.address.toLowerCase();

                // CRITICAL: Skip zero address (native NCHEESE) - it's not a BSC token
                if (normalizedAddr === '0x0000000000000000000000000000000000000000' || normalizedAddr === 'native') {
                    continue;
                }

                // Skip if already checked in common tokens or already in results
                const alreadyChecked = checkedAddresses.has(normalizedAddr) ||
                    balances.tokens.some(t => t.address.toLowerCase() === normalizedAddr);

                if (!alreadyChecked && userToken.address && userToken.address !== 'native') {
                    checkedAddresses.add(normalizedAddr);

                    try {
                        const decimals = userToken.decimals || 18;
                        const balance = await this.getTokenBalance(address, userToken.address, decimals);

                        if (balance > 0) {
                            // Get token info if not already available or incomplete
                            let tokenInfo = { name: userToken.name, symbol: userToken.symbol, decimals };
                            if (!userToken.name || !userToken.symbol ||
                                userToken.symbol === 'TOKEN' || userToken.symbol === 'UNKNOWN' ||
                                userToken.name === 'Custom Token' || userToken.name === 'Unknown Token') {
                                // Auto-detect token info from BSC contract
                                tokenInfo = await this.getTokenInfo(userToken.address);
                            }

                            balances.tokens.push({
                                symbol: tokenInfo.symbol || userToken.symbol || 'TOKEN',
                                name: tokenInfo.name || userToken.name || 'Unknown Token',
                                address: userToken.address,
                                balance: balance,
                                decimals: tokenInfo.decimals || decimals,
                                chain: 'bsc',
                                logoURI: userToken.logoURI || tokenInfo.logoURI || ''
                            });
                        }
                    } catch (error) {
                        console.warn(`Failed to get balance for user token ${userToken.address}:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.error('Get BSC balances error:', error);
        }

        return balances;
    }

    /**
     * Get pending CHEESE balance from swaps
     * This adds CHEESE tokens that were swapped from NCHEESE but not yet transferred on BSC
     */
    getPendingCheeseBalance(address, tokenContract) {
        try {
            // CHEESE token contract address on BSC
            const CHEESE_CONTRACT = '0xf4ECd8c58Ec14e3AA4A0a2DDC33Bd3D5DEee73cd';

            // Only apply to CHEESE token
            if (!tokenContract || tokenContract.toLowerCase() !== CHEESE_CONTRACT.toLowerCase()) {
                return 0;
            }

            // Get swap records from localStorage
            const swapRecords = JSON.parse(localStorage.getItem('cheeseSwapRecords') || '[]');

            // Sum up pending CHEESE for this address
            let pending = 0;
            for (const swap of swapRecords) {
                if (swap.from === address &&
                    swap.toToken === 'CHEESE' &&
                    swap.toChain === 'BSC' &&
                    (swap.status === 'pending' || swap.status === 'completed')) {
                    pending += (swap.cheeseToReceive || swap.toAmount || 0);
                }
            }

            return pending;
        } catch (error) {
            console.error('Error getting pending CHEESE balance:', error);
            return 0;
        }
    }

    /**
     * Get token name
     */
    getTokenName(symbol) {
        const names = {
            'CHEESE': 'CHEESE Token (BSC)',
            'USDT': 'Tether USD',
            'USDC': 'USD Coin',
            'BUSD': 'Binance USD',
            'ETH': 'Ethereum',
            'CAKE': 'PancakeSwap Token',
            'DAI': 'Dai Stablecoin',
            'AFX': 'AFX Token',
            'CheeseV2': 'CheeseV2 Token'
        };
        return names[symbol] || symbol;
    }

    /**
     * Get token logo URI
     */
    getTokenLogo(symbol) {
        const logos = {
            'CHEESE': '',
            'USDT': 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
            'USDC': 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
            'BUSD': 'https://assets.coingecko.com/coins/images/9576/small/BUSD.png',
            'ETH': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
            'CAKE': 'https://assets.coingecko.com/coins/images/12632/small/pancakeswap-cake-logo.png',
            'DAI': 'https://assets.coingecko.com/coins/images/9956/small/dai-multi-collateral-mcd.png',
            'AFX': '', // AFX logo - can be added later
            'CheeseV2': './icon-192.png' // Use Cheese icon for CheeseV2
        };
        return logos[symbol] || '';
    }

    /**
     * Get token transfers for an address (using BSCScan API if available)
     * This helps auto-detect tokens that were sent to the address
     * Note: Without API key, this will return empty array (manual addition required)
     */
    async getTokenTransfers(address) {
        try {
            // Use BSCScan API to get token transfers
            // Note: This requires a BSCScan API key for production use
            // Without API key, users need to manually add tokens
            // For now, return empty - users can add tokens manually via contract address
            // TODO: Add BSCScan API key support for automatic token detection

            // Uncomment and add API key when available:
            /*
            const apiKey = process.env.BSCSCAN_API_KEY || 'YourApiKeyToken';
            const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=999999999&sort=desc&apikey=${apiKey}`;
            
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data.status === '1' && data.result) {
                    const tokenAddresses = new Set();
                    data.result.forEach(tx => {
                        if (tx.contractAddress && tx.contractAddress !== '0x0000000000000000000000000000000000000000') {
                            tokenAddresses.add(tx.contractAddress.toLowerCase());
                        }
                    });
                    return Array.from(tokenAddresses);
                }
            }
            */

            return [];
        } catch (error) {
            console.error('Get token transfers error:', error);
            return [];
        }
    }

    /**
     * Get balances from all supported networks
     * @param {string} address - Wallet address
     * @param {Array} userTokens - User-added tokens from portfolio (optional)
     */
    async getAllBalances(address, userTokens = []) {
        const allBalances = {
            native: null, // Will be set by caller
            bsc: null,
            ethereum: null // Future support
        };

        try {
            // CRITICAL FIX: Auto-detect tokens from transaction history (if API available)
            // Get token transfers to find tokens that were sent to this address
            const tokenTransfers = await this.getTokenTransfers(address);

            // Add discovered tokens to userTokens for checking
            const discoveredTokens = [];
            if (tokenTransfers.length > 0) {
                for (const tokenAddress of tokenTransfers) {
                    // Check if already in userTokens
                    const alreadyAdded = userTokens.some(ut => ut.address.toLowerCase() === tokenAddress);
                    if (!alreadyAdded) {
                        // Try to get token info
                        try {
                            const tokenInfo = await this.getTokenInfo('0x' + tokenAddress);
                            if (tokenInfo && tokenInfo.symbol !== 'UNKNOWN') {
                                discoveredTokens.push({
                                    address: '0x' + tokenAddress,
                                    symbol: tokenInfo.symbol,
                                    name: tokenInfo.name,
                                    decimals: tokenInfo.decimals,
                                    chain: 'bsc'
                                });
                            }
                        } catch (error) {
                            // Skip tokens that fail
                            console.warn(`Failed to get info for discovered token ${tokenAddress}:`, error.message);
                        }
                    }
                }
            }

            // Combine user tokens with discovered tokens
            const allTokensToCheck = [...userTokens, ...discoveredTokens];

            // Get BSC balances (include user tokens and discovered tokens)
            allBalances.bsc = await this.getBSCBalances(address, allTokensToCheck);
        } catch (error) {
            console.error('Error fetching cross-chain balances:', error);
        }

        return allBalances;
    }

    /**
     * Check if address is valid
     */
    isValidAddress(address) {
        if (!address) return false;
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrossChainBalance;
}

