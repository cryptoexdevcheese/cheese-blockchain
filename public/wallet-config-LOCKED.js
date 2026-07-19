/**
 * CRITICAL WALLET CONFIGURATION - DO NOT MODIFY
 * ============================================
 * 
 * ⚠️ WARNING: Changing these constants will break wallet compatibility
 * and cause users to lose access to their funds!
 * 
 * These values are LOCKED and must remain constant across all updates.
 * Last verified: 2026-01-08
 */

// ============================================
// CRYPTOGRAPHIC STANDARDS (IMMUTABLE)
// ============================================

/**
 * Address Derivation Method
 * MUST use Keccak-256 hashing (Ethereum standard)
 * NEVER use SHA-256 for address derivation
 */
const ADDRESS_DERIVATION = {
    METHOD: 'KECCAK-256',  // DO NOT CHANGE
    LIBRARY: 'ethers.js',   // DO NOT CHANGE

    // Ethereum/BSC standard derivation path (BIP44)
    BIP44_PATH: "m/44'/60'/0'/0/0",  // DO NOT CHANGE

    // Validation
    REQUIRES_ETHERS: true,
    CHECKSUM_VALIDATION: true
};

/**
 * Private Key Format
 * Must be 256-bit (64 hex characters)
 */
const PRIVATE_KEY_FORMAT = {
    LENGTH: 64,              // DO NOT CHANGE
    ENCODING: 'hex',         // DO NOT CHANGE
    PREFIX: '0x',            // Optional, both formats accepted
    CURVE: 'secp256k1'       // DO NOT CHANGE
};

/**
 * Mnemonic (Seed Phrase) Settings
 * BIP39 standard
 */
const MNEMONIC_CONFIG = {
    WORD_COUNT: [12, 24],    // Accepted lengths - DO NOT CHANGE
    STANDARD: 'BIP39',       // DO NOT CHANGE
    LANGUAGE: 'english',     // Default language
    NORMALIZATION: 'NFKD'    // Unicode normalization
};

// ============================================
// BLOCKCHAIN COMPATIBILITY (IMMUTABLE)
// ============================================

/**
 * Supported Chains
 * All chains MUST use the same address derivation (Keccak-256)
 */
const SUPPORTED_CHAINS = {
    CHEESE: {
        name: 'CHEESE Blockchain',
        chainId: 'native',
        addressFormat: 'EVM-compatible',  // Uses same Keccak-256 as Ethereum
        backend: 'https://cheeseblockchain.com'  // Railway backend
    },
    BSC: {
        name: 'Binance Smart Chain',
        chainId: 56,
        addressFormat: 'EVM-compatible',
        rpc: 'https://bsc-dataseed.binance.org'
    },
    ETHEREUM: {
        name: 'Ethereum',
        chainId: 1,
        addressFormat: 'EVM-compatible',
        rpc: 'https://eth.llamarpc.com'
    }
};

// ============================================
// WALLET CREATION (IMMUTABLE)
// ============================================

/**
 * Wallet Creation Flow
 * CRITICAL: Always follow this exact sequence
 */
const WALLET_CREATION_SEQUENCE = {
    1: 'Generate BIP39 mnemonic (12 or 24 words)',
    2: 'Derive wallet using ethers.HDNodeWallet.fromPhrase()',
    3: 'Extract: address, publicKey, privateKey',
    4: 'Validate: address matches privateKey derivation',
    5: 'Encrypt privateKey with user password',
    6: 'Save to localStorage with encrypted key'
};

/**
 * Wallet Import Methods
 * CRITICAL: All must use ethers.js for address derivation
 */
const WALLET_IMPORT_METHODS = {
    PRIVATE_KEY: {
        library: 'ethers.Wallet',
        validation: 'Must derive correct EVM address',
        method: 'new ethers.Wallet(privateKey)'
    },
    SEED_PHRASE: {
        library: 'ethers.HDNodeWallet',
        validation: 'Must use BIP44 path',
        method: 'ethers.HDNodeWallet.fromPhrase(mnemonic, null, BIP44_PATH)'
    }
};

// ============================================
// BACKEND VALIDATION (IMMUTABLE)
// ============================================

/**
 * Backend Address Verification Order
 * Tries multiple methods for backward compatibility
 */
const BACKEND_VERIFICATION_ORDER = {
    1: 'ethers.computeAddress() - Standard Keccak-256',  // PRIMARY METHOD
    2: 'SHA-256 Legacy - For old wallets only',
    3: 'SHA-256 Wallet-compatible - For old wallets only',
    4: 'SHA-256 Byte-based - For old wallets only',
    5: 'Whitelist - Founder/Treasury addresses'
};

/**
 * Whitelisted Legacy Addresses
 * These use non-standard derivation but are verified
 *    // System wallet addresses that are exempt from validation checks
    // UPDATED 2026-01-09: Corrected NEW system wallet addresses
 */
const LEGACY_WHITELIST = {
    // ==================== IMMUTABLE SYSTEM CONFIG (LOCKED 2026-01-09) ====================
    EXEMPT_WALLETS: [
        // FINAL Core System Wallets (Active) - Exempt from Registration & One-Device Policy
        '0x0E6ec6713E7b5b7C11d969dA848813d08223598E', // FOUNDER
        '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3', // TREASURY / Mining Fee Wallet
        '0x3801490C9f806c917b8CbA710Db9135FA3B116ae', // DEX LIQUIDITY VAULT (active)
        '0x712A1CBa607C60D95f27088c80aBbBD1f53d33Fe', // OPERATOR
        '0x7e73806ef3E8e11b9a226672Df5EC8E816EDA56D', // MINING VAULT
        '0x0ef03fd4C994614c4f90930e643Ab9048Ab54587', // EXEMPT SYSTEM 1
        '0x051CEcfd2229E9D1a7FB8269d4201487C26565D5', // EXEMPT SYSTEM 2
        // OLD System Wallets (Deprecated but kept for historical compatibility)
        '0xa25f52f081c3397bbc8d2ed12146757c470e049d', // OLD Founder
        '0xde2d2a08f90e64f9f266287129da29f498b399a4'  // OLD Treasury
    ]
    // =====================================================================================
};

// ============================================
// TOKEN CONFIGURATION (IMMUTABLE)
// ============================================

/**
 * Token Rules
 * NCH is native only. wNCH bridge retired (see CHEESE_WNCH_RETIRED).
 */
const TOKEN_RULES = {
    NCH: {
        name: 'NCHEESE',
        blockchain: 'CHEESE',
        swappable: true,
        bridgeable: false,
        nativeToken: true
    },
    SWAP_ONLY_TOKENS: ['USDT', 'BNB', 'ETH'],
    BRIDGE_ONLY_TOKENS: []
};

// ============================================
// VALIDATION CHECKSUMS
// ============================================

/**
 * Critical Code Checksums
 * These help detect if critical files were modified
 */
const CODE_VALIDATION = {
    CRITICAL_CONSTANTS: {
        ADDRESS_DERIVATION_METHOD: 'KECCAK-256',
        PRIVATE_KEY_LIBRARY: 'ethers.js',
        BIP44_PATH: "m/44'/60'/0'/0/0"
    },

    // If these don't match, wallet is compromised
    VALIDATION_HASH: 'CHEESE_WALLET_V2_KECCAK256_STANDARD'
};

// ============================================
// EXPORT
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ADDRESS_DERIVATION,
        PRIVATE_KEY_FORMAT,
        MNEMONIC_CONFIG,
        SUPPORTED_CHAINS,
        WALLET_CREATION_SEQUENCE,
        WALLET_IMPORT_METHODS,
        BACKEND_VERIFICATION_ORDER,
        LEGACY_WHITELIST,
        TOKEN_RULES,
        CODE_VALIDATION
    };
}

// Browser global
if (typeof window !== 'undefined') {
    window.CHEESE_WALLET_CONFIG = {
        ADDRESS_DERIVATION,
        PRIVATE_KEY_FORMAT,
        MNEMONIC_CONFIG,
        SUPPORTED_CHAINS,
        WALLET_CREATION_SEQUENCE,
        WALLET_IMPORT_METHODS,
        BACKEND_VERIFICATION_ORDER,
        LEGACY_WHITELIST,
        TOKEN_RULES,
        CODE_VALIDATION
    };
}

/**
 * Runtime Validation
 * Throws error if critical constants are modified
 */
function validateWalletConfiguration() {
    if (ADDRESS_DERIVATION.METHOD !== 'KECCAK-256') {
        throw new Error('CRITICAL: Address derivation method has been changed! Wallet is compromised!');
    }

    if (ADDRESS_DERIVATION.LIBRARY !== 'ethers.js') {
        throw new Error('CRITICAL: Address derivation library has been changed! Wallet is compromised!');
    }

    if (ADDRESS_DERIVATION.BIP44_PATH !== "m/44'/60'/0'/0/0") {
        throw new Error('CRITICAL: BIP44 derivation path has been changed! Wallet is compromised!');
    }

    console.log('✅ Wallet configuration validated - all critical constants are correct');
    return true;
}

// Auto-validate on load
if (typeof window !== 'undefined') {
    validateWalletConfiguration();
}
