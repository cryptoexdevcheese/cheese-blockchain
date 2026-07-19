/**
 * MetaMask-Style Wallet System
 * Enhanced wallet with MetaMask-like features
 */

class MetaMaskStyleWallet {
    constructor(app) {
        this.app = app;
        this.accounts = [];
        this.currentAccountIndex = 0;
        this.networks = [
            {
                id: 'cheese-native',
                name: 'CHEESE Blockchain',
                rpcUrl: 'https://cheeseblockchain.com/rpc',
                chainId: 20250,
                currency: 'NCH',
                explorer: 'https://cheeseblockchain.com/explorer/',
                icon: '🧀'
            },
            {
                id: 'bsc',
                name: 'Binance Smart Chain',
                rpcUrl: 'https://bsc-dataseed.binance.org/',
                chainId: 56,
                currency: 'BNB',
                explorer: 'https://bscscan.com',
                icon: '🟡'
            }
        ];
        this.currentNetwork = this.networks[0];
        this.tokens = new Map();
        this.loadSavedData();
    }

    loadSavedData() {
        try {
            const savedAccounts = localStorage.getItem('cheeseAccounts');
            if (savedAccounts) this.accounts = JSON.parse(savedAccounts);
            const savedNetwork = localStorage.getItem('cheeseCurrentNetwork');
            if (savedNetwork) {
                const network = this.networks.find(n => n.id === savedNetwork);
                if (network) this.currentNetwork = network;
            }
        } catch (e) { console.error(e); }
    }

    getPopularTokens() {
        return [
            { address: '0x0000000000000000000000000000000000000000', symbol: 'NCH', name: 'NCHEESE (Native)', decimals: 18, logoURI: 'icon-512.png', network: 'cheese-native' },
            { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD (Native)', decimals: 6, logoURI: 'usdt_cheese.png', network: 'cheese-native' },
            { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin (Native)', decimals: 6, logoURI: 'usdc_cheese.png', network: 'cheese-native' },
            { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18, logoURI: '', network: 'bsc' },
            { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18, logoURI: '', network: 'bsc' },
            { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', name: 'Ethereum', decimals: 18, logoURI: '', network: 'bsc' },
            { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18, logoURI: '', network: 'bsc' },
            { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, logoURI: '', network: 'bsc' }
        ];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetaMaskStyleWallet;
}
