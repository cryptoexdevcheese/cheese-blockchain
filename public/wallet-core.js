/**
 * Wallet Core - Cryptographic Wallet Management
 * REWRITTEN V3.0 - STRICT EVM COMPATIBILITY (ethers.js)
 * 
 * Replaced legacy SHA-256 derivation with standard Keccak-256.
 * All keys and addresses are now fully EVM compliant.
 */

class WalletCore {
    constructor() {
        this.wallet = null;
        this.encryptedKey = null;

        // Ensure ethers is available
        if (typeof ethers === 'undefined') {
            console.error('CRITICAL: ethers.js not loaded! WalletCore cannot function.');
            throw new Error('ethers.js library missing');
        }
    }

    // Generate new wallet using ethers.js (Standard secp256k1 + Keccak-256)
    async createNewWallet() {
        try {
            // Create random wallet
            const wallet = ethers.Wallet.createRandom();

            this.wallet = {
                address: wallet.address,
                publicKey: wallet.signingKey.publicKey,
                privateKey: wallet.privateKey,
                mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
                _ethersWallet: wallet // Internal reference
            };

            console.log('✅ New EVM Wallet Created:', this.wallet.address);
            return this.wallet;
        } catch (error) {
            console.error('Wallet creation error:', error);
            throw error;
        }
    }

    // Save wallet to localStorage
    // Uses ethers.js standard keystore encryption (v3.0)
    async saveWallet(password = null) {
        if (!this.wallet) throw new Error('No wallet to save');
        if (!this.wallet.privateKey) throw new Error('Cannot save wallet without private key');

        const walletData = {
            address: this.wallet.address,
            publicKey: this.wallet.publicKey,
            encrypted: false,
            version: '3.0' // Mark as ethers compatible
        };

        if (password) {
            if (password.length < 4) throw new Error('Password must be at least 4 characters');

            // Normalize password
            password = password.trim();

            try {
                // Use ethers.js standard encryption (Action: AES-128-CTR + Scrypt)
                // This produces a standard JSON keystore string
                const ethersWallet = new ethers.Wallet(this.wallet.privateKey);

                console.log('🔐 Encrypting wallet with standard EVM keystore format...');
                const json = await ethersWallet.encrypt(password);

                walletData.encryptedPrivateKey = json; // Store the full JSON string
                walletData.encrypted = true;
                walletData.encryptionVersion = '3.0';

                // We do NOT store backupKey anymore as standard keystore is robust
                // But we can keep specific metadata if needed

                // DO NOT store private key
                delete walletData.privateKey;

            } catch (error) {
                console.error('Encryption Error:', error);
                throw new Error('Failed to encrypt wallet: ' + error.message);
            }
        } else {
            console.warn('Saving wallet without encryption - not recommended');
            walletData.privateKey = this.wallet.privateKey;
            walletData.encrypted = false;
        }

        localStorage.setItem('cheeseWallet', JSON.stringify(walletData));

        // Verify save
        const savedData = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
        if (savedData.address !== this.wallet.address) {
            throw new Error('Wallet save failed - address mismatch detected');
        }

        console.log('✅ Wallet saved successfully (V3.0 EVM Standard)');
        return walletData;
    }

    // Load wallet from localStorage
    // Supports V3.0 (ethers) and Legacy V1.0/V2.0 (Custom)
    async loadWallet(password = null) {
        const walletData = localStorage.getItem('cheeseWallet');
        if (!walletData) return null;

        try {
            const data = JSON.parse(walletData);

            // Check if encrypted
            if (data.encrypted && data.encryptedPrivateKey) {
                if (!password) throw new Error('Password required for encrypted wallet');
                password = password.trim();

                let privateKey = null;
                let ethersWallet = null;

                // 1. Try V3.0 (Ethers Keystore)
                if (data.encryptionVersion === '3.0' || this.isJsonKeystore(data.encryptedPrivateKey)) {
                    try {
                        console.log('🔓 Decrypting V3.0 Standard Keystore...');
                        ethersWallet = await ethers.Wallet.fromEncryptedJson(data.encryptedPrivateKey, password);
                        privateKey = ethersWallet.privateKey;
                        console.log('✅ Decryption successful (V3.0)');
                    } catch (e) {
                        // Fallthrough to try other methods if strict version check wasn't definitive
                        console.warn('V3 Decryption failed:', e.message);
                    }
                }

                // 2. Fallback: Try Legacy Methods (V2.0/V1.0) if V3 failed or version mismatch
                if (!privateKey) {
                    console.log('⚠️ Attempting Legacy Decryption (Migration Mode)...');
                    try {
                        privateKey = await this.decryptLegacy(data.encryptedPrivateKey, password, data);
                        if (privateKey) {
                            console.log('✅ Legacy Decryption successful. MIGRATING TO EVM ADDRESS.');
                            ethersWallet = new ethers.Wallet(privateKey);
                        }
                    } catch (legacyError) {
                        console.error('Legacy decryption failed:', legacyError.message);
                        throw new Error('Incorrect password. Please try again.');
                    }
                }

                if (!ethersWallet) throw new Error('Decryption failed');

                // 3. Set Wallet State
                // CRITICAL: Always use the derived address from ethersWallet
                // This fixes the "Mismatch" where legacy wallets stored a SHA-256 address
                if (data.address && data.address.toLowerCase() !== ethersWallet.address.toLowerCase()) {
                    console.warn('🚨 ADDRESS MISMATCH DETECTED & FIXED');
                    console.warn('Stored Address (Invalid):', data.address);
                    console.warn('Derived Address (Valid):', ethersWallet.address);
                }

                this.wallet = {
                    address: ethersWallet.address,
                    publicKey: ethersWallet.signingKey.publicKey,
                    privateKey: ethersWallet.privateKey,
                    _ethersWallet: ethersWallet
                };

            } else {
                // UNENCRYPTED
                if (!data.privateKey) throw new Error('Wallet private key missing');

                const ethersWallet = new ethers.Wallet(data.privateKey);
                this.wallet = {
                    address: ethersWallet.address,
                    publicKey: ethersWallet.signingKey.publicKey,
                    privateKey: ethersWallet.privateKey,
                    _ethersWallet: ethersWallet
                };
            }

            return this.wallet;

        } catch (error) {
            console.error('Load wallet error:', error);
            if (error.message.includes('password') || error.message.includes('decrypt')) {
                throw new Error('Incorrect password. Please try again.');
            }
            throw error;
        }
    }

    /**
     * Stand-alone decryption for UI components
     * @param {string} encryptedKey The encrypted private key string or JSON keystore
     * @param {string} password The user's wallet password
     * @returns {string} The decrypted private key hex
     */
    async decryptPrivateKey(encryptedKey, password) {
        if (!encryptedKey || !password) {
            throw new Error('Encrypted key and password are required');
        }

        // CRITICAL FIX: Handle case where encryptedKey is passed as an object (V3 keystore)
        // The export function passes the raw object from localStorage, but isJsonKeystore expects a string
        if (typeof encryptedKey === 'object') {
            encryptedKey = JSON.stringify(encryptedKey);
        }


        try {
            // 1. Try V3.0 (Ethers Keystore JSON)
            if (this.isJsonKeystore(encryptedKey)) {
                try {
                    const wallet = await ethers.Wallet.fromEncryptedJson(encryptedKey, password);
                    return wallet.privateKey;
                } catch (e) {
                    console.warn('V3.0 decryption failed, trying legacy fallback...');
                }
            }

            // 2. Try Legacy fallback
            const data = JSON.parse(localStorage.getItem('cheeseWallet')) || {};
            const decrypted = await this.decryptLegacy(encryptedKey, password, data);

            if (decrypted && /^[0-9a-fA-F]{64}$/.test(decrypted.replace('0x', ''))) {
                return decrypted.startsWith('0x') ? decrypted : '0x' + decrypted;
            }

            throw new Error('Decryption failed or produced invalid key format');

        } catch (error) {
            console.error('decryptPrivateKey error:', error);
            // Include effective error details for debugging
            throw new Error(`Failed to decrypt: ${error.message}`);
        }
    }


    // Helper: Detect if string is JSON keystore
    isJsonKeystore(str) {
        if (typeof str !== 'string') return false;
        if (!str.trim().startsWith('{')) return false;
        try {
            const json = JSON.parse(str);
            // RELAXED CHECK: If it parses as an object, let ethers try to handle it.
            // Strict checks (version && crypto) were causing false negatives for some formats.
            return typeof json === 'object' && json !== null;
        } catch (e) { return false; }
    }

    // Legacy Decryption (Copied from old wallet-core to support migration)
    async decryptLegacy(encryptedKey, password, data) {
        console.log('🔍 Starting decryptLegacy...');
        console.log('Encrypted Key Length:', encryptedKey ? encryptedKey.length : 'NULL');
        console.log('Has Backup Key:', !!data.backupKey);

        // CRITICAL FIX: Try multiple password variations to handle edge cases
        // This handles cases where password might have been saved with trailing spaces
        const passwordVariations = [
            password,                  // Original password FIRST
            password.trim(),           // Normalized (most common)
            password.replace(/\s+/g, ' ').trim(), // Normalize multiple spaces
            password.trimStart(),      // Only trim start
            password.trimEnd()         // Only trim end
        ];

        // Deduplicate
        const uniqueVariations = [...new Set(passwordVariations)];
        console.log('🔑 Password Variations to try:', uniqueVariations.length);
        let lastError = null;

        for (const [index, variant] of uniqueVariations.entries()) {
            console.log(`🔄 Trying Variation ${index + 1}: length=${variant.length}`);

            // 1. Simple Backup Decrypt (XOR) - Try this first
            if (data.backupKey) {
                try {
                    const dec = this.simpleDecrypt(data.backupKey, variant);
                    if (dec && /^[0-9a-fA-F]{64}$/.test(dec.replace('0x', ''))) {
                        console.log('✅ Legacy Decryption successful (XOR)');
                        return dec;
                    }
                } catch (e) {
                    console.log('XOR failed:', e.message);
                }
            }

            // 2. AES-GCM Decryption (V2)
            try {
                // Decode Base64
                let binaryStr;
                try {
                    binaryStr = atob(encryptedKey);
                } catch (e) {
                    // Not base64, skip this variation
                    continue;
                }

                const combined = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) combined[i] = binaryStr.charCodeAt(i);

                // Extract
                if (combined.length < 28) {
                    console.warn('Encrypted data too short:', combined.length);
                    continue;
                } // Too short
                const salt = combined.slice(0, 16);
                const iv = combined.slice(16, 28);
                const encryptedData = combined.slice(28);

                console.log('Salt length:', salt.length, 'IV length:', iv.length, 'Data length:', encryptedData.length);

                // Key Derivation
                const passwordKey = await crypto.subtle.importKey(
                    'raw', new TextEncoder().encode(variant), { name: 'PBKDF2' }, false, ['deriveKey']
                );
                const key = await crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
                    passwordKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
                );

                console.log('Key derived, attempting decrypt...');
                // Decrypt
                const decryptedInfo = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv }, key, encryptedData
                );

                const decryptedKey = new TextDecoder().decode(decryptedInfo);
                console.log('✅ Legacy Decryption successful (AES-GCM)');
                return decryptedKey;

            } catch (e) {
                console.log(`❌ Variation ${index + 1} failed (AES):`, e.name, e.message);
                // AES Decryption failed for this variant
                // Try Old Format (Base64 "key:pass")
                try {
                    const parts = atob(encryptedKey).split(':');
                    if (parts.length === 2 && parts[1].trim() === variant.trim()) {
                        console.log('✅ Legacy Decryption successful (Old Format)');
                        return parts[0];
                    }
                } catch (e2) { }

                lastError = e;
            }
        }

        console.error('❌ All variations failed. Last error:', lastError ? lastError.message : 'None');
        throw new Error('Legacy decryption failed: ' + (lastError ? lastError.message : 'Unknown'));
    }

    // Simple XOR decryption for backup (Legacy Support)
    // Simple XOR decryption for backup (Legacy Support)
    simpleDecrypt(encryptedText, password) {
        try {
            const decoded = atob(encryptedText);
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(decoded.charCodeAt(i) ^ password.charCodeAt(i % password.length));
            }
            return result;
        } catch (error) { return null; }
    }


    // Sign transaction using ethers.js
    async signTransaction(transaction) {
        if (!this.wallet || !this.wallet._ethersWallet) throw new Error('No wallet loaded');

        try {
            // Ethers expects specific transaction fields
            // We need to map our generic 'transaction' object to ethers format
            // Assuming transaction has: to, value, data, etc.

            const txRequest = {
                to: transaction.to,
                data: transaction.data || '0x',
                value: transaction.value ? ethers.parseEther(transaction.value.toString()) : undefined,
                // Gas fields usually handled by provider, but if offline signing:
                nonce: transaction.nonce,
                gasLimit: transaction.gasLimit,
                gasPrice: transaction.gasPrice,
                chainId: transaction.chainId || 1337 // Default or from tx
            };

            // Remove undefined 
            Object.keys(txRequest).forEach(key => txRequest[key] === undefined && delete txRequest[key]);

            console.log('📝 Signing Transaction:', txRequest);
            const signedTx = await this.wallet._ethersWallet.signTransaction(txRequest);

            // Return in format expected by app
            return {
                transaction,
                signature: signedTx, // RLP encoded signed tx
                publicKey: this.wallet.publicKey,
                raw: signedTx // Ethers returns the full serialized RLP string
            };

        } catch (error) {
            console.error('Signing error:', error);
            throw error;
        }
    }

    // Delete wallet
    deleteWallet() {
        localStorage.removeItem('cheeseWallet');
        this.wallet = null;
        this.encryptedKey = null;
    }

    // Get current wallet
    getWallet() {
        return this.wallet;
    }

    // Import wallet from private key
    async importWalletFromPrivateKey(privateKeyHex) {
        try {
            // Normalize
            if (!privateKeyHex.startsWith('0x')) privateKeyHex = '0x' + privateKeyHex;

            const wallet = new ethers.Wallet(privateKeyHex);

            this.wallet = {
                address: wallet.address,
                publicKey: wallet.signingKey.publicKey,
                privateKey: wallet.privateKey,
                _ethersWallet: wallet
            };

            console.log('✅ Imported Wallet:', this.wallet.address);
            return this.wallet;
        } catch (error) {
            console.error('Import error:', error);
            throw new Error('Invalid Private Key');
        }
    }

    // Legacy support methods (stubs to prevent crashes if app calls them)
    arrayBufferToHex(buffer) { return 'deprecated'; }
    hexToArrayBuffer(hex) { return new ArrayBuffer(0); }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletCore;
} else {
    // Browser global
    window.WalletCore = WalletCore;
}
