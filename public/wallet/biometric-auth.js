/**
 * Biometric Authentication Module
 * Uses Web Authentication API (WebAuthn) for fingerprint/face recognition
 */

class BiometricAuth {
    constructor() {
        this.isSupported = this.checkSupport();
        this.credentialId = null;
    }

    // Check if WebAuthn is supported
    checkSupport() {
        return !!(navigator.credentials && navigator.credentials.create && PublicKeyCredential);
    }

    // Check if biometric authentication is available
    async isAvailable() {
        if (!this.isSupported) {
            return false;
        }

        try {
            // Check if platform authenticator is available
            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            return available;
        } catch (error) {
            console.error('Biometric check error:', error);
            return false;
        }
    }

    // Register biometric credential for wallet
    async registerBiometric(walletAddress, userId = null) {
        if (!this.isSupported) {
            throw new Error('Biometric authentication is not supported in this browser');
        }

        if (!await this.isAvailable()) {
            throw new Error('Biometric authentication is not available on this device');
        }

        try {
            // Generate user ID if not provided
            if (!userId) {
                userId = this.generateUserId(walletAddress);
            }

            // Create credential
            const publicKeyCredentialCreationOptions = {
                challenge: this.generateChallenge(),
                rp: {
                    name: "CHEESE Native Wallet",
                    id: window.location.hostname || "localhost"
                },
                user: {
                    id: this.stringToArrayBuffer(userId),
                    name: walletAddress,
                    displayName: `CHEESE Wallet ${walletAddress.slice(0, 8)}`
                },
                pubKeyCredParams: [
                    { alg: -7, type: "public-key" },  // ES256
                    { alg: -257, type: "public-key" } // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: "platform", // Use built-in authenticator
                    userVerification: "required"
                },
                timeout: 60000,
                attestation: "direct"
            };

            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });

            // Store credential ID
            const credentialId = this.arrayBufferToBase64(credential.rawId);
            this.saveBiometricCredential(walletAddress, credentialId, credential);

            return {
                success: true,
                credentialId: credentialId,
                message: 'Biometric authentication registered successfully'
            };
        } catch (error) {
            console.error('Biometric registration error:', error);
            if (error.name === 'NotAllowedError') {
                throw new Error('Biometric registration was cancelled or not allowed');
            } else if (error.name === 'InvalidStateError') {
                throw new Error('Biometric credential already exists for this wallet');
            }
            throw new Error('Failed to register biometric: ' + error.message);
        }
    }

    // Authenticate using biometric
    async authenticateBiometric(walletAddress) {
        if (!this.isSupported) {
            throw new Error('Biometric authentication is not supported');
        }

        // CRITICAL: Normalize address for lookup
        const normalizedAddress = walletAddress ? walletAddress.toLowerCase().trim() : null;
        if (!normalizedAddress) {
            throw new Error('Invalid wallet address');
        }

        const credentialData = this.getBiometricCredential(normalizedAddress);
        if (!credentialData) {
            throw new Error('No biometric credential found. Please register first.');
        }

        try {
            const publicKeyCredentialRequestOptions = {
                challenge: this.generateChallenge(),
                allowCredentials: [{
                    id: this.base64ToArrayBuffer(credentialData.credentialId),
                    type: "public-key",
                    transports: ["internal"] // Use platform authenticator
                }],
                timeout: 60000,
                userVerification: "required"
            };

            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            });

            // Verify authentication
            if (assertion) {
                return {
                    success: true,
                    message: 'Biometric authentication successful'
                };
            } else {
                throw new Error('Biometric authentication failed');
            }
        } catch (error) {
            console.error('Biometric authentication error:', error);
            if (error.name === 'NotAllowedError') {
                throw new Error('Biometric authentication was cancelled');
            } else if (error.name === 'InvalidStateError') {
                throw new Error('Biometric authentication failed. Please try again.');
            }
            throw new Error('Biometric authentication failed: ' + error.message);
        }
    }

    // Check if biometric is registered for wallet
    isBiometricRegistered(walletAddress) {
        const credentialData = this.getBiometricCredential(walletAddress);
        return !!credentialData;
    }

    // Remove biometric credential
    removeBiometric(walletAddress) {
        try {
            const key = `cheeseBiometric_${walletAddress}`;
            localStorage.removeItem(key);
            return { success: true, message: 'Biometric authentication removed' };
        } catch (error) {
            throw new Error('Failed to remove biometric: ' + error.message);
        }
    }

    // Save biometric credential data
    saveBiometricCredential(walletAddress, credentialId, credential) {
        try {
            // CRITICAL: Normalize address for consistent storage
            const normalizedAddress = walletAddress ? walletAddress.toLowerCase().trim() : null;
            if (!normalizedAddress) {
                throw new Error('Invalid wallet address');
            }
            
            const credentialData = {
                credentialId: credentialId,
                registeredAt: Date.now(),
                walletAddress: normalizedAddress // Store normalized address
            };
            const key = `cheeseBiometric_${normalizedAddress}`;
            localStorage.setItem(key, JSON.stringify(credentialData));
            console.log('✅ Biometric credential saved for:', normalizedAddress);
        } catch (error) {
            console.error('Error saving biometric credential:', error);
            throw error;
        }
    }

    // Get biometric credential data
    getBiometricCredential(walletAddress) {
        try {
            // CRITICAL: Normalize address for consistent lookup
            const normalizedAddress = walletAddress ? walletAddress.toLowerCase().trim() : null;
            if (!normalizedAddress) return null;
            
            const key = `cheeseBiometric_${normalizedAddress}`;
            const data = localStorage.getItem(key);
            if (data) {
                return JSON.parse(data);
            }
            
            // Fallback: Try with original address format (for backwards compatibility)
            const altKey = `cheeseBiometric_${walletAddress}`;
            const altData = localStorage.getItem(altKey);
            return altData ? JSON.parse(altData) : null;
        } catch (error) {
            console.error('Error getting biometric credential:', error);
            return null;
        }
    }

    // Generate random challenge
    generateChallenge() {
        return crypto.getRandomValues(new Uint8Array(32));
    }

    // Generate user ID from wallet address
    generateUserId(walletAddress) {
        return walletAddress.replace(/^0x/, '').slice(0, 16);
    }

    // Convert string to ArrayBuffer
    stringToArrayBuffer(str) {
        const encoder = new TextEncoder();
        return encoder.encode(str);
    }

    // Convert ArrayBuffer to base64
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // Convert base64 to ArrayBuffer
    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Get biometric type (fingerprint, face, etc.)
    async getBiometricType() {
        if (!await this.isAvailable()) {
            return 'Not Available';
        }

        // Try to detect biometric type (platform-specific)
        if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
            return 'Face ID / Touch ID';
        } else if (navigator.userAgent.includes('Android')) {
            return 'Fingerprint / Face Unlock';
        } else if (navigator.userAgent.includes('Windows')) {
            return 'Windows Hello';
        } else if (navigator.userAgent.includes('Mac')) {
            return 'Touch ID / Face ID';
        }
        return 'Biometric';
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BiometricAuth;
}

