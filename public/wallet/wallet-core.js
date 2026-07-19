/**
 * Wallet Core - Cryptographic Wallet Management
 * Handles wallet creation, encryption, and transaction signing
 */

class WalletCore {
    constructor() {
        this.wallet = null;
        this.encryptedKey = null;
    }

    // Generate new wallet using standard EVM (secp256k1)
    async createNewWallet() {
        try {
            // Use ethers.js for standard EVM wallet generation
            // This ensures compatibility with Firebase app and MetaMask
            const wallet = ethers.Wallet.createRandom();

            this.wallet = {
                address: wallet.address,
                publicKey: wallet.publicKey,
                privateKey: wallet.privateKey,
                mnemonic: wallet.mnemonic.phrase
            };

            console.log('✅ New EVM wallet created:', this.wallet.address);
            return this.wallet;
        } catch (error) {
            console.error('Wallet creation error:', error);
            throw error;
        }
    }

    // Encrypt private key with password using AES-GCM
    async encryptPrivateKey(password) {
        if (!this.wallet || !this.wallet.privateKey) {
            throw new Error('No wallet to encrypt');
        }

        if (!password || password.length < 4) {
            throw new Error('Password must be at least 4 characters');
        }

        // CRITICAL FIX: Normalize password (trim whitespace) for consistency
        // This ensures the same password works after browser refresh
        password = password.trim();

        try {
            // Generate random salt
            const salt = crypto.getRandomValues(new Uint8Array(16));
            
            // Derive key from password using PBKDF2
            // CRITICAL: Use normalized password for encoding
            const passwordKey = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(password),
                { name: 'PBKDF2' },
                false,
                ['deriveBits', 'deriveKey']
            );

            const keyMaterial = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000, // High iteration count for security
                    hash: 'SHA-256'
                },
                passwordKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );

            // Generate random IV
            const iv = crypto.getRandomValues(new Uint8Array(12));

            // Encrypt private key
            const privateKeyBytes = new TextEncoder().encode(this.wallet.privateKey);
            const encryptedData = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                keyMaterial,
                privateKeyBytes
            );

            // Combine salt, IV, and encrypted data
            const combined = new Uint8Array(salt.length + iv.length + encryptedData.byteLength);
            combined.set(salt, 0);
            combined.set(iv, salt.length);
            combined.set(new Uint8Array(encryptedData), salt.length + iv.length);

            // Convert to base64 for storage
            const encrypted = btoa(String.fromCharCode(...combined));
            this.encryptedKey = encrypted;
            
            return encrypted;
        } catch (error) {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt wallet: ' + error.message);
        }
    }

    // Decrypt private key with password using AES-GCM
    async decryptPrivateKey(encryptedKey, password, tryVariations = true) {
        if (!password || password.length < 4) {
            throw new Error('Invalid password');
        }

        // CRITICAL: Try multiple password variations to handle edge cases
        // IMPORTANT: Try original password FIRST, then trimmed versions
        // This handles cases where password might have been saved with trailing spaces
        const passwordVariations = tryVariations ? [
            password,                  // Original password FIRST (in case it wasn't trimmed during encryption)
            password.trim(),           // Normalized (most common)
            password.replace(/\s+/g, ' ').trim(), // Normalize multiple spaces
            password.trimStart(),      // Only trim start
            password.trimEnd(),        // Only trim end
        ] : [password.trim()];

        // Remove duplicates while preserving order
        const uniqueVariations = [];
        const seen = new Set();
        for (const variant of passwordVariations) {
            if (!seen.has(variant)) {
                seen.add(variant);
                uniqueVariations.push(variant);
            }
        }

        let lastError = null;
        
        for (const passwordVariant of uniqueVariations) {
            try {
                console.log('🔓 Trying password variation, length:', passwordVariant.length, 'First char:', passwordVariant.charCodeAt(0), 'Last char:', passwordVariant.charCodeAt(passwordVariant.length - 1));
                
                // Decode from base64
                let combined;
                try {
                    combined = new Uint8Array(
                        atob(encryptedKey).split('').map(c => c.charCodeAt(0))
                    );
                } catch (e) {
                    throw new Error('Invalid encrypted key format (not base64)');
                }

                // Validate encrypted data structure
                if (combined.length < 28) {
                    throw new Error('Encrypted key is too short (corrupted data)');
                }

                // Extract salt, IV, and encrypted data
                const salt = combined.slice(0, 16);
                const iv = combined.slice(16, 28);
                const encryptedData = combined.slice(28);

                if (encryptedData.length === 0) {
                    throw new Error('No encrypted data found (corrupted)');
                }

                // Derive key from password using PBKDF2 (same parameters as encryption)
                const passwordKey = await crypto.subtle.importKey(
                    'raw',
                    new TextEncoder().encode(passwordVariant),
                    { name: 'PBKDF2' },
                    false,
                    ['deriveBits', 'deriveKey']
                );

                const keyMaterial = await crypto.subtle.deriveKey(
                    {
                        name: 'PBKDF2',
                        salt: salt,
                        iterations: 100000,
                        hash: 'SHA-256'
                    },
                    passwordKey,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['decrypt']
                );

                // Decrypt private key
                const decryptedData = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: iv },
                    keyMaterial,
                    encryptedData
                );

                // Convert back to string
                const privateKey = new TextDecoder().decode(decryptedData);
                
                // Validate private key format
                const cleanKey = privateKey.replace(/^0x/, '');
                if (!privateKey || !/^[0-9a-fA-F]{32,}$/.test(cleanKey)) {
                    console.warn('⚠️ Decrypted data is not a valid private key format');
                    lastError = new Error('Decrypted data is not a valid private key');
                    continue; // Try next variation
                }

                console.log('✅ Decryption successful with password variation');
                return privateKey;
            } catch (error) {
                console.log('⚠️ Password variation failed:', error.name, error.message);
                lastError = error;
                // Continue to next variation
                continue;
            }
        }

        // All variations failed
        console.error('❌ All password variations failed');
        if (lastError && (lastError.name === 'OperationError' || lastError.message.includes('decrypt'))) {
            throw new Error('Invalid password. Please verify your password is correct.');
        }
        throw new Error('Decryption failed: Invalid password or corrupted data');
    }

    // Sign transaction
    async signTransaction(transaction) {
        if (!this.wallet) {
            throw new Error('No wallet loaded');
        }

        if (this.wallet.readOnly) {
            throw new Error('Cannot sign transactions with read-only wallet');
        }

        if (!this.wallet.privateKey) {
            throw new Error('Private key not available');
        }

        try {
            // Create transaction hash
            const txData = JSON.stringify(transaction);
            const txHash = await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(txData)
            );

            // For imported wallets, we need to create a key pair from the private key
            // For now, we'll use a simplified signing approach
            // In production, you'd use a proper cryptographic library
            const signature = this.wallet.privateKey + ':' + this.arrayBufferToHex(txHash);

            return {
                transaction,
                signature: signature,
                publicKey: this.wallet.publicKey || this.wallet.address
            };
        } catch (error) {
            console.error('Signing error:', error);
            throw error;
        }
    }

    // Save wallet to localStorage
    async saveWallet(password = null) {
        if (!this.wallet) {
            throw new Error('No wallet to save');
        }

        if (!this.wallet.privateKey) {
            throw new Error('Cannot save wallet without private key');
        }

        const walletData = {
            address: this.wallet.address,
            publicKey: this.wallet.publicKey,
            encrypted: false,
            version: '2.0' // Mark as new secure version
        };

        if (password) {
            // CRITICAL FIX: Normalize password before validation and encryption
            // This ensures consistency between save and load operations
            password = password.trim();
            
            if (!password || password.length < 4) {
                throw new Error('Password must be at least 4 characters');
            }
            
            // CRITICAL: Create password verification hash for debugging
            // This helps verify if the same password is being used
            const passwordHash = await this.createPasswordHash(password);
            walletData.passwordHash = passwordHash;
            console.log('🔐 Password hash created for verification:', passwordHash.substring(0, 16) + '...');
            
            // Always use new secure encryption (password is already normalized)
            walletData.encryptedPrivateKey = await this.encryptPrivateKey(password);
            walletData.encrypted = true;
            walletData.encryptionVersion = '2.0'; // Mark encryption version
            
            // Deprecated: XOR backupKey removed for security reasons (vulnerability fix).
            // Direct AES-256-GCM is used as the primary cryptographic layout.
            
            // DO NOT store private key when encrypted
            delete walletData.privateKey;
        } else {
            // Allow unencrypted for backward compatibility with existing wallets
            // But warn user
            console.warn('Saving wallet without encryption - not recommended');
            walletData.privateKey = this.wallet.privateKey;
            walletData.encrypted = false;
        }

        // Save to localStorage
        localStorage.setItem('cheeseWallet', JSON.stringify(walletData));
        
        // CRITICAL VALIDATION: Verify saved data matches original wallet
        const savedData = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
        if (savedData.address !== this.wallet.address) {
            console.error('❌ Address mismatch after save! Original:', this.wallet.address, 'Saved:', savedData.address);
            throw new Error('Wallet save failed - address mismatch detected');
        }
        
        console.log('✅ Wallet saved successfully, address verified:', savedData.address);
        return walletData;
    }

    // Load wallet from localStorage
    async loadWallet(password = null) {
        const walletData = localStorage.getItem('cheeseWallet');
        if (!walletData) {
            return null;
        }

        try {
            const data = JSON.parse(walletData);
            
            if (data.encrypted && data.encryptedPrivateKey) {
                // ENCRYPTED WALLET - PASSWORD IS REQUIRED AND MUST BE CORRECT
                if (!password || password === '') {
                    throw new Error('Password required for encrypted wallet');
                }
                
                // CRITICAL FIX: Normalize password (trim whitespace) BEFORE validation
                // This ensures consistency with encryption (password was trimmed during save)
                password = password.trim();
                
                if (password.length < 4) {
                    throw new Error('Invalid password - must be at least 4 characters');
                }
                
                // CRITICAL: Log password length for debugging (without revealing password)
                console.log('🔓 Decrypting wallet - Password length:', password.length, 'Encryption version:', data.encryptionVersion || '1.0');

                // CRITICAL: Verify password hash first (if available)
                if (data.passwordHash) {
                    const isCorrectPassword = await this.verifyPasswordHash(password, data.passwordHash);
                    console.log('🔐 Password hash verification:', isCorrectPassword ? '✅ MATCH' : '❌ MISMATCH');
                    if (!isCorrectPassword) {
                        console.error('❌ Password hash does not match! The password entered is different from the one used during import.');
                    }
                }

                // Check encryption version to determine format
                const encryptionVersion = data.encryptionVersion || '1.0';
                const isOldFormat = encryptionVersion === '1.0' || this.isOldEncryptionFormat(data.encryptedPrivateKey);
                
                let privateKey = null;
                let decryptionMethod = 'none';
                
                // Try new format first (if version 2.0 or unknown)
                if (!isOldFormat || encryptionVersion === '2.0') {
                    try {
                        privateKey = await this.decryptPrivateKey(data.encryptedPrivateKey, password);
                        decryptionMethod = 'aes-gcm';
                        console.log('✅ Decrypted using new format (AES-GCM)');
                    } catch (newFormatError) {
                        console.log('AES-GCM decryption failed:', newFormatError.message);
                        
                        // Try old format as fallback
                        if (isOldFormat) {
                            try {
                                privateKey = this.decryptOldFormat(data.encryptedPrivateKey, password);
                                decryptionMethod = 'old-format';
                                console.log('✅ Decrypted using old format');
                            } catch (oldFormatError) {
                                console.log('Old format also failed:', oldFormatError.message);
                            }
                        }
                        
                        // CRITICAL: Try backup decryption as last resort
                        if (!privateKey && data.backupKey) {
                            console.log('🔄 Trying backup decryption...');
                            try {
                                privateKey = this.simpleDecrypt(data.backupKey, password);
                                if (privateKey && /^[0-9a-fA-F]{32,}$/.test(privateKey.replace(/^0x/, ''))) {
                                    decryptionMethod = 'backup-xor';
                                    console.log('✅ Decrypted using backup XOR method');
                                } else {
                                    privateKey = null;
                                }
                            } catch (backupError) {
                                console.log('Backup decryption also failed:', backupError.message);
                            }
                        }
                    }
                } else {
                    // Try old format first
                    try {
                        privateKey = this.decryptOldFormat(data.encryptedPrivateKey, password);
                        decryptionMethod = 'old-format';
                        console.log('✅ Decrypted using old format');
                    } catch (oldFormatError) {
                        console.log('Old format decryption failed:', oldFormatError.message);
                        
                        // Try new format as fallback
                        try {
                            privateKey = await this.decryptPrivateKey(data.encryptedPrivateKey, password);
                            decryptionMethod = 'aes-gcm';
                            console.log('✅ Decrypted using new format (fallback)');
                        } catch (newFormatError) {
                            console.log('New format also failed:', newFormatError.message);
                            
                            // CRITICAL: Try backup decryption as last resort
                            if (data.backupKey) {
                                console.log('🔄 Trying backup decryption...');
                                try {
                                    privateKey = this.simpleDecrypt(data.backupKey, password);
                                    if (privateKey && /^[0-9a-fA-F]{32,}$/.test(privateKey.replace(/^0x/, ''))) {
                                        decryptionMethod = 'backup-xor';
                                        console.log('✅ Decrypted using backup XOR method');
                                    } else {
                                        privateKey = null;
                                    }
                                } catch (backupError) {
                                    console.log('Backup decryption also failed:', backupError.message);
                                }
                            }
                        }
                    }
                }
                
                // If all decryption methods failed
                if (!privateKey) {
                    console.error('❌ All decryption methods failed');
                    throw new Error('Incorrect password. Please try again.');
                }
                
                // Validate decrypted private key format
                if (!privateKey || privateKey.length < 32) {
                    throw new Error('Incorrect password - decryption failed');
                }

                // Additional validation - check if private key is valid hex
                const cleanKey = privateKey.replace(/^0x/, '');
                if (!/^[0-9a-fA-F]{32,}$/.test(cleanKey)) {
                    throw new Error('Incorrect password - invalid decryption result');
                }
                
                console.log('✅ Wallet decrypted successfully using:', decryptionMethod);
                
                // Reconstruct wallet
                this.wallet = {
                    address: data.address,
                    publicKey: data.publicKey,
                    privateKey: privateKey
                };

                // CRITICAL SECURITY UPGRADE: If the wallet was loaded with a backupKey (XOR)
                // or is on an older encryption version, automatically upgrade it to the secure GCM format.
                if (data.backupKey || data.encryptionVersion !== '2.0') {
                    console.log('🔒 Auto-upgrading wallet to secure AES-256-GCM format (removing weak XOR backup)...');
                    try {
                        await this.saveWallet(password);
                        console.log('✅ Wallet successfully migrated to secure GCM-only format.');
                    } catch (migrationError) {
                        console.error('⚠️ Wallet migration failed:', migrationError.message);
                        // Do not throw error here, so the user is not locked out of their wallet
                    }
                }
            } else {
                // UNENCRYPTED WALLET - IGNORE PASSWORD COMPLETELY
                // Password parameter is ignored for unencrypted wallets
                // Load wallet directly without any password validation
                
                if (!data.privateKey) {
                    throw new Error('Wallet data corrupted - private key missing');
                }
                
                // Validate private key exists and is not empty
                if (!data.privateKey || data.privateKey.length < 32) {
                    throw new Error('Wallet data corrupted - invalid private key');
                }
                
                this.wallet = {
                    address: data.address,
                    publicKey: data.publicKey,
                    privateKey: data.privateKey
                };
            }

            return this.wallet;
        } catch (error) {
            console.error('Load wallet error:', error);
            // Re-throw with clear error message
            if (error.message.includes('Incorrect password') || 
                error.message.includes('Invalid password') || 
                error.message.includes('Decryption failed') ||
                error.message.includes('decrypt') ||
                error.message.includes('OperationError')) {
                throw new Error('Incorrect password. Please try again.');
            }
            throw error;
        }
    }

    // Check if encryption is old weak format - SUPPORT OLD FORMAT FOR BACKWARD COMPATIBILITY
    isOldEncryptionFormat(encryptedKey) {
        try {
            // Old format was simple base64 with password stored in plain text
            // Try to decode and check format
            const decoded = atob(encryptedKey);
            // Old format would have "privateKey:password" structure
            // New format is binary data (salt + IV + encrypted data), won't have readable text
            if (decoded.includes(':') && decoded.split(':').length === 2) {
                // Check if it looks like "hex:password" format
                const parts = decoded.split(':');
                if (parts.length === 2 && parts[0].length >= 32 && /^[0-9a-fA-F]+$/.test(parts[0])) {
                    // This is old format
                    return true;
                }
            }
            // New format is binary data, won't decode to readable text
            return false;
        } catch (error) {
            // If decoding fails, it's likely new format (binary data)
            return false;
        }
    }

    // Decrypt old format encryption (for backward compatibility)
    decryptOldFormat(encryptedKey, password) {
        try {
            const decrypted = atob(encryptedKey);
            const [privateKey, storedPassword] = decrypted.split(':');
            
            // CRITICAL: Normalize both passwords for comparison (trim whitespace)
            const normalizedStored = (storedPassword || '').trim();
            const normalizedInput = (password || '').trim();
            
            if (normalizedStored !== normalizedInput) {
                throw new Error('Invalid password');
            }

            return privateKey;
        } catch (error) {
            throw new Error('Decryption failed: ' + error.message);
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
    async importWalletFromPrivateKey(privateKeyHex, address = null) {
        try {
            // Validate private key format
            if (!privateKeyHex || typeof privateKeyHex !== 'string') {
                throw new Error('Invalid private key format');
            }

            // Remove '0x' prefix if present and trim whitespace
            privateKeyHex = privateKeyHex.replace(/^0x/, '').trim();

            // Validate hex format
            if (!/^[0-9a-fA-F]+$/.test(privateKeyHex)) {
                throw new Error('Private key must be a valid hexadecimal string');
            }

            // Validate address if provided
            let walletAddress = address;
            if (walletAddress) {
                walletAddress = walletAddress.replace(/^0x/, '').trim();
                if (!/^[0-9a-fA-F]{40}$/.test(walletAddress)) {
                    throw new Error('Invalid address format (must be 40 hex characters)');
                }
                walletAddress = '0x' + walletAddress;
            } else {
                // Generate address from private key using standard EVM logic
                const tempWallet = new ethers.Wallet('0x' + privateKeyHex.replace(/^0x/, ''));
                walletAddress = tempWallet.address;
            }

            // Store wallet with private key
            // Note: For signing, we'll use the private key directly
            this.wallet = {
                address: walletAddress,
                publicKey: null, // Will be derived when needed
                privateKey: privateKeyHex,
                keyPair: null, // Will be created when signing
                imported: true
            };

            return this.wallet;
        } catch (error) {
            console.error('Import wallet from private key error:', error);
            throw new Error('Failed to import wallet: ' + error.message);
        }
    }

    // Import wallet from address only (read-only mode)
    importWalletFromAddress(address) {
        if (!address || typeof address !== 'string') {
            throw new Error('Invalid address format');
        }

        // Remove '0x' prefix if present and validate
        address = address.replace(/^0x/, '');
        if (!/^[0-9a-fA-F]{40}$/.test(address)) {
            throw new Error('Invalid address format (must be 40 hex characters)');
        }

        address = '0x' + address;

        // Create read-only wallet (no private key)
        this.wallet = {
            address: address,
            publicKey: null,
            privateKey: null,
            keyPair: null,
            readOnly: true
        };

        return this.wallet;
    }

    // Utility: Convert ArrayBuffer to hex string
    arrayBufferToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    // Utility: Convert hex string to ArrayBuffer
    hexToArrayBuffer(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    }

    // Create a hash of the password for verification (not for encryption)
    async createPasswordHash(password) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(password + 'cheese-wallet-salt-2025');
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (error) {
            console.error('Error creating password hash:', error);
            // Fallback to simple hash
            let hash = 0;
            const str = password + 'cheese-wallet-salt-2025';
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return 'fallback_' + Math.abs(hash).toString(16);
        }
    }

    // Verify password against stored hash
    async verifyPasswordHash(password, storedHash) {
        const currentHash = await this.createPasswordHash(password);
        return currentHash === storedHash;
    }

    // Simple XOR encryption for backup (less secure but more reliable)
    simpleEncrypt(text, password) {
        try {
            let result = '';
            for (let i = 0; i < text.length; i++) {
                const charCode = text.charCodeAt(i) ^ password.charCodeAt(i % password.length);
                result += String.fromCharCode(charCode);
            }
            return btoa(result); // Base64 encode
        } catch (error) {
            console.error('Simple encrypt error:', error);
            return null;
        }
    }

    // Simple XOR decryption for backup
    simpleDecrypt(encryptedText, password) {
        try {
            const decoded = atob(encryptedText); // Base64 decode
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                const charCode = decoded.charCodeAt(i) ^ password.charCodeAt(i % password.length);
                result += String.fromCharCode(charCode);
            }
            return result;
        } catch (error) {
            console.error('Simple decrypt error:', error);
            return null;
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletCore;
}


