/**
 * CHEESE WALLET MANAGER (v2.0.1-CACHE-BUST)
 * Wallet System with Cryptographic Security
 * Uses Elliptic Curve Cryptography (ECDSA) for digital signatures
 */

const EC = require('elliptic').ec;
const crypto = require('crypto');
const CryptoJS = require('crypto-js');

const ethers = require('ethers');

class Wallet {
    constructor(privateKey = null) {
        this.ec = new EC('secp256k1'); // Same curve as Bitcoin

        if (privateKey) {
            this.keyPair = this.ec.keyFromPrivate(privateKey, 'hex');
        } else {
            this.keyPair = this.ec.genKeyPair();
        }

        this.publicKey = this.keyPair.getPublic('hex');
        this.address = this.generateAddress();
    }

    generateAddress() {
        try {
            // Ensure 0x prefix
            const pubKey = this.publicKey.startsWith('0x') ? this.publicKey : '0x' + this.publicKey;
            return ethers.computeAddress(pubKey);
        } catch (error) {
            console.error('Address derivation error:', error);
            throw new Error('Ethers.js required for valid EVM address generation.');
        }
    }

    sign(data) {
        // Use deterministic serialization matching Server Logic
        // Server uses sorted keys: ['amount', 'data', 'from', 'timestamp', 'to']
        const sortedKeys = ['amount', 'data', 'from', 'timestamp', 'to'];
        const dataString = JSON.stringify(data, sortedKeys);
        const msgHash = crypto.createHash('sha256').update(dataString).digest('hex');
        const signature = this.keyPair.sign(msgHash);
        return {
            r: signature.r.toString('hex'),
            s: signature.s.toString('hex'),
            recoveryParam: signature.recoveryParam
        };
    }

    static verifySignature(data, signature, publicKey) {
        try {
            const ec = new EC('secp256k1');
            // CRITICAL: Use SAME sorted keys as sign() method for consistent hashing
            const sortedKeys = ['amount', 'data', 'from', 'timestamp', 'to'];
            const dataString = JSON.stringify(data, sortedKeys);
            const msgHash = crypto.createHash('sha256').update(dataString).digest('hex');
            const keyPair = ec.keyFromPublic(publicKey, 'hex');
            return keyPair.verify(msgHash, signature);
        } catch (error) {
            return false;
        }
    }

    encryptPrivateKey(password) {
        const privateKeyHex = this.keyPair.getPrivate('hex');
        return CryptoJS.AES.encrypt(privateKeyHex, password).toString();
    }

    static decryptPrivateKey(encryptedKey, password) {
        try {
            const bytes = CryptoJS.AES.decrypt(encryptedKey, password);
            return bytes.toString(CryptoJS.enc.Utf8);
        } catch (error) {
            return null;
        }
    }

    getPrivateKey() {
        return this.keyPair.getPrivate('hex');
    }

    toJSON() {
        return {
            address: this.address,
            publicKey: this.publicKey,
            // Never expose private key in JSON
        };
    }
}

class WalletManager {
    constructor(database) {
        this.database = database;
        this.wallets = new Map();
    }

    async createWallet(password = null) {
        const wallet = new Wallet();

        if (password) {
            const encryptedKey = wallet.encryptPrivateKey(password);
            await this.database.saveWallet({
                address: wallet.address,
                publicKey: wallet.publicKey,
                encryptedPrivateKey: encryptedKey,
                balance: 0
            });
        } else {
            await this.database.saveWallet({
                address: wallet.address,
                publicKey: wallet.publicKey,
                balance: 0
            });
        }

        this.wallets.set(wallet.address, wallet);
        return wallet;
    }

    async loadWallet(address, password = null) {
        const walletData = await this.database.getWallet(address);
        if (!walletData) {
            return null;
        }

        let privateKey = null;
        if (walletData.encryptedPrivateKey && password) {
            privateKey = Wallet.decryptPrivateKey(walletData.encryptedPrivateKey, password);
            if (!privateKey) {
                throw new Error('Invalid password');
            }
        }

        const wallet = new Wallet(privateKey);
        this.wallets.set(wallet.address, wallet);
        return wallet;
    }

    getWallet(address) {
        return this.wallets.get(address);
    }

    signTransaction(wallet, transaction) {
        if (!wallet) {
            throw new Error('Wallet not found');
        }

        const signature = wallet.sign({
            from: transaction.from,
            to: transaction.to,
            amount: transaction.amount,
            timestamp: transaction.timestamp,
            data: transaction.data
        });

        return {
            ...signature,
            publicKey: wallet.publicKey
        };
    }



    /**
     * Import wallet from mnemonic using Custom Double Hash logic
     * Matches the logic used by active community wallets (e.g. 0x5e0c...)
     */
    async importFromMnemonic(mnemonic, index = 0) {
        try {
            // 1. Standard BIP-39/BIP-32 Derivation via Ethers.js
            // This guarantees compatibility with Metamask, TrustWallet, etc.
            const wallet = ethers.Wallet.fromPhrase(mnemonic.trim());

            // 2. Derive specific path if index > 0 (Standard is m/44'/60'/0'/0/0)
            // Ethers.fromPhrase defaults to index 0. For index > 0 we need HDNode.
            let targetWallet = wallet;
            if (index > 0) {
                const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic.trim());
                targetWallet = hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
            }

            // 3. Instantiate Internal Wallet Class
            // We strip the 0x for internal storage compatibility where needed, or keep standard
            const internalWallet = new Wallet(targetWallet.privateKey.replace(/^0x/, ''));

            // 4. Verify Address Match
            if (internalWallet.address.toLowerCase() !== targetWallet.address.toLowerCase()) {
                throw new Error(`Critical Error: Derived address mismatch! Internal: ${internalWallet.address}, Standard: ${targetWallet.address}`);
            }

            // Store in manager
            this.wallets.set(internalWallet.address, internalWallet);

            // Save to database
            await this.database.saveWallet({
                address: internalWallet.address,
                publicKey: internalWallet.publicKey,
                balance: 0,
                imported: true,
                derivation: 'standard-bip39-evm'
            });

            console.log(`✅ Imported Standard EVM Wallet: ${internalWallet.address}`);
            return internalWallet;

        } catch (error) {
            console.error('Import mnemonic error:', error);
            throw error;
        }
    }
}

module.exports = { Wallet, WalletManager };



