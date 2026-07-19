/**
 * CHEESE Blockchain Wallet & Network Configuration
 * Centralized source of truth for EVM Network and Token metadata.
 */

const BLOCKCHAIN_FAVICON = 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png';
const BLOCKCHAIN_LOGO_192 = 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png';
const BLOCKCHAIN_LOGO_512 = 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-512.png';
const BLOCKCHAIN_LOGO_32 = 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png';

window.CHEESE_METAMASK_CONFIG = {
    NETWORK: {
        chainId: '0x4f1a', // 20250 in lowercase hex
        chainName: 'CHEESE Blockchain',
        nativeCurrency: {
            name: 'Native Cheesecoin',
            symbol: 'NCH',
            decimals: 18,
            image: 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-512.png'
        },
        rpcUrls: ['https://cheeseblockchain.com/api/rpc'],
        blockExplorerUrls: ['https://cheeseblockchain.com/explorer/'],
        iconUrls: [
            'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png',
            'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-512.png'
        ]
    },
    TOKENS: [
        {
            address: '0x000000000000000000000000000000000000c8ee',
            symbol: 'NCH',
            decimals: 6,
            image: 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png'
        },
        {
            address: '0x55d398326f99059fF775485246999027B3197955',
            symbol: 'USDT',
            decimals: 6,
            image: 'https://cheeseblockchain.com/usdt_cheese.png?v=10.1'
        },
        {
            address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            symbol: 'USDC',
            decimals: 6,
            image: 'https://cheeseblockchain.com/usdc_cheese.png?v=10.1'
        }
    ]
};

console.log('🧀 Cheese Blockchain Wallet & Network Config Ready');
