/**
 * Multi-Chain Provider - Support for BSC, Ethereum, Polygon and Native CHEESE
 * Enables wallet to store and transact tokens across multiple networks
 */

class MultiChainProvider {
    constructor() {
        // Auto-detect environment for Native CHEESE API
        const isLocalDev = typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const nativeApiUrl = isLocalDev ? 'http://localhost:3000' : 'https://cheeseblockchain.com';

        // Network configurations with CORS-friendly RPC endpoints
        this.networks = {
            'native': {
                name: 'Native CHEESE',
                symbol: 'NCH',
                chainId: null,
                rpc: nativeApiUrl,
                explorer: nativeApiUrl,
                nativeCurrency: { name: 'NCHEESE', symbol: 'NCH', decimals: 18 },
                isNative: true
            },
            'bsc': {
                name: 'BNB Smart Chain',
                symbol: 'BNB',
                chainId: 56,
                rpc: 'https://bsc-dataseed.binance.org',
                rpcFallbacks: [
                    'https://bsc-dataseed.binance.org/',
                    'https://bsc-dataseed1.binance.org',
                    'https://bsc-dataseed2.binance.org'
                ],
                explorer: 'https://bscscan.com',
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }
            },
            'ethereum': {
                name: 'Ethereum',
                symbol: 'ETH',
                chainId: 1,
                rpc: 'https://ethereum.publicnode.com/',
                rpcFallbacks: [
                    'https://eth.llamarpc.com',
                    'https://cloudflare-eth.com',
                    'https://ethereum.publicnode.com'
                ],
                explorer: 'https://etherscan.io',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
            },
            'polygon': {
                name: 'Polygon',
                symbol: 'MATIC',
                chainId: 137,
                rpc: 'https://polygon-rpc.com/',
                rpcFallbacks: [
                    'https://polygon-rpc.com',
                    'https://polygon.llamarpc.com',
                    'https://polygon-bor.publicnode.com'
                ],
                explorer: 'https://polygonscan.com',
                nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }
            }
        };

        // Token configurations per network
        this.tokens = {
            'bsc': {
                'USDT': {
                    address: '0x55d398326f99059fF775485246999027B3197955',
                    decimals: 18,
                    symbol: 'USDT',
                    name: 'Tether USD',
                    logo: '💵'
                },
                'USDC': {
                    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
                    decimals: 18,
                    symbol: 'USDC',
                    name: 'USD Coin',
                    logo: '💲'
                },
                'CHEESE': {
                    address: '0xd379d390055cB73a3401027B5D2aC846f21cE5E1',
                    decimals: 18,
                    symbol: 'CHEESE',
                    name: 'CHEESE Token',
                    logo: '🧀'
                },
                'BUSD': {
                    address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
                    decimals: 18,
                    symbol: 'BUSD',
                    name: 'Binance USD',
                    logo: '💰'
                }
            },
            'ethereum': {
                'USDT': {
                    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                    decimals: 6,
                    symbol: 'USDT',
                    name: 'Tether USD',
                    logo: '💵'
                },
                'USDC': {
                    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                    decimals: 6,
                    symbol: 'USDC',
                    name: 'USD Coin',
                    logo: '💲'
                }
            },
            'polygon': {
                'USDT': {
                    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
                    decimals: 6,
                    symbol: 'USDT',
                    name: 'Tether USD',
                    logo: '💵'
                },
                'USDC': {
                    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                    decimals: 6,
                    symbol: 'USDC',
                    name: 'USD Coin',
                    logo: '💲'
                }
            }
        };

        // ERC-20 ABI (minimal for balance and transfer)
        this.ERC20_ABI = [
            'function balanceOf(address) view returns (uint256)',
            'function transfer(address to, uint256 amount) returns (bool)',
            'function decimals() view returns (uint8)',
            'function symbol() view returns (string)',
            'function approve(address spender, uint256 amount) returns (bool)'
        ];

        // Current network
        this.currentNetwork = 'native';

        // Cached balances
        this.balanceCache = {};
        this.cacheExpiry = 30000; // 30 seconds
    }

    // Get all supported networks
    getNetworks() {
        return Object.entries(this.networks).map(([id, config]) => ({
            id,
            ...config
        }));
    }

    // Get tokens for a network
    getTokens(networkId) {
        return this.tokens[networkId] || {};
    }

    // Set current network
    setNetwork(networkId) {
        if (this.networks[networkId]) {
            this.currentNetwork = networkId;
            return true;
        }
        return false;
    }

    // Get native balance (BNB, ETH, MATIC)
    async getNativeBalance(address, networkId = null) {
        const network = networkId || this.currentNetwork;

        if (network === 'native') {
            // Use CHEESE API - get URL from network config
            const config = this.networks['native'];
            try {
                const response = await fetch(`${config.rpc}/api/balance/${address}?apiKey=REDACTED_DEX_API_KEY`);
                const data = await response.json();
                return data.balance || 0;
            } catch (error) {
                console.error('Native balance error:', error);
                return 0;
            }
        }

        // EVM chains - use JSON-RPC
        const config = this.networks[network];
        if (!config) return 0;

        try {
            const response = await fetch(config.rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_getBalance',
                    params: [address, 'latest'],
                    id: 1
                })
            });
            const data = await response.json();
            if (data.result) {
                // Convert from wei to ether
                return parseInt(data.result, 16) / 1e18;
            }
            return 0;
        } catch (error) {
            console.error(`${network} balance error:`, error);
            return 0;
        }
    }

    // Get ERC-20/BEP-20 token balance
    async getTokenBalance(address, tokenSymbol, networkId = null) {
        const network = networkId || this.currentNetwork;

        if (network === 'native') {
            return 0; // Native chain doesn't have ERC-20 tokens
        }

        const token = this.tokens[network]?.[tokenSymbol];
        if (!token) {
            console.warn(`Token ${tokenSymbol} not found on ${network}`);
            return 0;
        }

        const config = this.networks[network];

        try {
            // Encode balanceOf(address) call
            const data = '0x70a08231' + address.slice(2).padStart(64, '0');

            const response = await fetch(config.rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_call',
                    params: [{
                        to: token.address,
                        data: data
                    }, 'latest'],
                    id: 1
                })
            });

            const result = await response.json();
            if (result.result && result.result !== '0x') {
                const balance = parseInt(result.result, 16);
                return balance / Math.pow(10, token.decimals);
            }
            return 0;
        } catch (error) {
            console.error(`Token balance error (${tokenSymbol} on ${network}):`, error);
            return 0;
        }
    }

    // Get all balances for an address across all networks
    async getAllBalances(address) {
        const balances = {
            native: {
                NCH: await this.getNativeBalance(address, 'native')
            },
            bsc: {
                BNB: await this.getNativeBalance(address, 'bsc'),
                USDT: await this.getTokenBalance(address, 'USDT', 'bsc'),
                USDC: await this.getTokenBalance(address, 'USDC', 'bsc'),
                CHEESE: await this.getTokenBalance(address, 'CHEESE', 'bsc'),
                BUSD: await this.getTokenBalance(address, 'BUSD', 'bsc')
            },
            ethereum: {
                ETH: await this.getNativeBalance(address, 'ethereum'),
                USDT: await this.getTokenBalance(address, 'USDT', 'ethereum'),
                USDC: await this.getTokenBalance(address, 'USDC', 'ethereum')
            },
            polygon: {
                MATIC: await this.getNativeBalance(address, 'polygon'),
                USDT: await this.getTokenBalance(address, 'USDT', 'polygon'),
                USDC: await this.getTokenBalance(address, 'USDC', 'polygon')
            }
        };

        return balances;
    }

    // Build ERC-20 transfer transaction
    buildTokenTransfer(toAddress, amount, tokenSymbol, networkId) {
        const token = this.tokens[networkId]?.[tokenSymbol];
        if (!token) throw new Error(`Token ${tokenSymbol} not found on ${networkId}`);

        // Encode transfer(address, uint256)
        const amountWei = BigInt(Math.floor(amount * Math.pow(10, token.decimals)));
        const data = '0xa9059cbb' +
            toAddress.slice(2).padStart(64, '0') +
            amountWei.toString(16).padStart(64, '0');

        return {
            to: token.address,
            data: data,
            value: '0x0'
        };
    }

    // Sign and send transaction (requires private key)
    async sendTransaction(fromAddress, toAddress, amount, privateKey, networkId, tokenSymbol = null) {
        const config = this.networks[networkId];
        if (!config) throw new Error(`Network ${networkId} not supported`);

        if (networkId === 'native') {
            // Initialize WalletCore to sign locally
            // We assume 'wallet' passed here is an ethers wallet, so we might need to access the main walletCore instance
            // But privateKey is passed directly. 
            // Better Approach: Use the passed privateKey to sign using Ethers directly here, OR fix the architecture.
            // Since we updated WalletCore.signTransaction, let's use a temporary WalletCore instance or Ethers directly if possible.

            if (typeof ethers === 'undefined') throw new Error('Ethers.js required for signing');

            // 1. Prepare Transaction Data
            const timestamp = Date.now();
            const transactionData = {
                from: fromAddress,
                to: toAddress,
                amount: amount,
                timestamp: timestamp,
                data: {}
            };

            // 2. Hash Logic (Must match Server)
            const sortedKeys = ['amount', 'data', 'from', 'timestamp', 'to'];
            const signData = {};
            sortedKeys.forEach(key => { if (transactionData[key] !== undefined) signData[key] = transactionData[key]; });
            const dataString = JSON.stringify(signData, sortedKeys);

            const encoder = new TextEncoder();
            const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dataString));
            const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

            // 3. Sign Locally
            const signingKey = new ethers.SigningKey(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
            const sig = signingKey.sign('0x' + hashHex);

            const signature = {
                r: sig.r,
                s: sig.s,
                publicKey: signingKey.publicKey
            };

            // 4. Send Signed Request (NO PRIVATE KEY)
            const response = await fetch(`${config.rpc}/api/transaction`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': 'cheese-live-key-2025'
                },
                body: JSON.stringify({
                    ...transactionData,
                    signature: signature
                })
            });
            return await response.json();
        }

        // For EVM chains, use ethers.js
        if (typeof ethers === 'undefined') {
            throw new Error('ethers.js not loaded - please refresh the page');
        }

        try {
            const provider = new ethers.JsonRpcProvider(config.rpc);
            const wallet = new ethers.Wallet(privateKey, provider);

            if (tokenSymbol) {
                // ERC-20 token transfer
                return await this.sendToken(wallet, toAddress, amount, tokenSymbol, networkId);
            } else {
                // Native token transfer (BNB, ETH, MATIC)
                return await this.sendNativeToken(wallet, toAddress, amount);
            }
        } catch (error) {
            console.error('EVM transaction error:', error);
            throw error;
        }
    }

    // Send native token (BNB, ETH, MATIC)
    async sendNativeToken(wallet, toAddress, amount) {
        console.log(`📤 Sending ${amount} native tokens to ${toAddress}`);

        const tx = await wallet.sendTransaction({
            to: toAddress,
            value: ethers.parseEther(amount.toString())
        });

        console.log('⏳ Transaction sent, waiting for confirmation...', tx.hash);
        const receipt = await tx.wait();

        console.log('✅ Transaction confirmed!', receipt.hash);
        return {
            success: true,
            hash: receipt.hash,
            blockNumber: receipt.blockNumber,
            from: receipt.from,
            to: receipt.to
        };
    }

    // Send ERC-20/BEP-20 token
    async sendToken(wallet, toAddress, amount, tokenSymbol, networkId) {
        const token = this.tokens[networkId]?.[tokenSymbol];
        if (!token) throw new Error(`Token ${tokenSymbol} not found on ${networkId}`);

        console.log(`📤 Sending ${amount} ${tokenSymbol} to ${toAddress} on ${networkId}`);

        // Create contract instance
        const contract = new ethers.Contract(
            token.address,
            this.ERC20_ABI,
            wallet
        );

        // Convert amount to token units
        const amountInUnits = ethers.parseUnits(amount.toString(), token.decimals);

        // Send transfer
        const tx = await contract.transfer(toAddress, amountInUnits);
        console.log('⏳ Token transfer sent, waiting for confirmation...', tx.hash);

        const receipt = await tx.wait();
        console.log('✅ Token transfer confirmed!', receipt.hash);

        return {
            success: true,
            hash: receipt.hash,
            blockNumber: receipt.blockNumber,
            from: receipt.from,
            to: toAddress,
            token: tokenSymbol,
            amount: amount
        };
    }

    // Get transaction history from Explorer APIs
    async getTransactionHistory(address, networkId) {
        const config = this.networks[networkId];
        if (!config) return [];

        if (networkId === 'native') {
            try {
                // Native CHEESE History
                const response = await fetch(`${config.rpc}/api/transactions/${address}?apiKey=cheese-live-key-2025`);
                return await response.json();
            } catch (error) {
                console.error('Native history error:', error);
                return [];
            }
        }

        // EVM Chains - Use Explorer APIs (BscScan, Etherscan, PolygonScan)
        // Note: Using public/free endpoints. In production, use dedicated API keys.
        let apiUrl = '';
        let apiKey = 'YourApiKeyToken'; // Default free key

        if (networkId === 'bsc') {
            apiUrl = 'https://api.bscscan.com/api';
            // Try to find a key if available, otherwise rely on free tier
        } else if (networkId === 'ethereum') {
            apiUrl = 'https://api.etherscan.io/api';
        } else if (networkId === 'polygon') {
            apiUrl = 'https://api.polygonscan.com/api';
        }

        if (!apiUrl) return [];

        try {
            // Fetch Native Transactions (BNB, ETH, MATIC)
            const response = await fetch(`${apiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`);
            const data = await response.json();

            let transactions = [];
            if (data.status === '1' && data.result) {
                transactions = data.result.map(tx => ({
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: (parseFloat(tx.value) / 1e18).toString(), // Convert Wei to Unit
                    timestamp: parseInt(tx.timeStamp) * 1000,
                    type: tx.from.toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
                    symbol: config.symbol, // e.g. BNB
                    status: tx.isError === '0' ? 'confirmed' : 'failed'
                }));
            }

            // Note: Token transfers (USDT, etc) require 'tokentx' action and overlap handling
            // For MVP, we show Native transfers. To show Tokens, we would need a second call:
            // action=tokentx

            try {
                const tokenResponse = await fetch(`${apiUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`);
                const tokenData = await tokenResponse.json();

                if (tokenData.status === '1' && tokenData.result) {
                    const tokenTxs = tokenData.result.map(tx => ({
                        hash: tx.hash,
                        from: tx.from,
                        to: tx.to,
                        value: (parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal))).toString(),
                        timestamp: parseInt(tx.timeStamp) * 1000,
                        type: tx.from.toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
                        symbol: tx.tokenSymbol,
                        status: 'confirmed'
                    }));
                    // Create combined list by hash to avoid duplicates if any, but they are different events usually
                    transactions = [...transactions, ...tokenTxs].sort((a, b) => b.timestamp - a.timestamp);
                }
            } catch (e) {
                console.warn('Token history fetch failed:', e);
            }

            return transactions.slice(0, 50); // Limit to 50 recent
        } catch (error) {
            console.error(`${networkId} history error:`, error);
            return [];
        }
    }

    // Format balance for display
    formatBalance(balance, decimals = 4) {
        if (balance === 0) return '0';
        if (balance < 0.0001) return '<0.0001';
        return balance.toFixed(decimals);
    }

    // Get token logo/icon
    getTokenLogo(symbol) {
        const logos = {
            'NCH': '🧀',
            'NCHEESE': '🧀',
            'CHEESE': '🧀',
            'BNB': '💛',
            'ETH': '💎',
            'MATIC': '💜',
            'USDT': '💵',
            'USDC': '💲',
            'BUSD': '💰'
        };
        return logos[symbol] || '🪙';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiChainProvider;
}
