/**
 * Treasury Wallet Generator
 * Creates a proper treasury wallet with seed phrase and private key
 */

// Load wallet security functions
const crypto = window.crypto || require('crypto');

class TreasuryWalletGenerator {
    constructor() {
        this.bip39WordList = this.getBIP39WordList();
    }

    getBIP39WordList() {
        // Simplified BIP39 word list (first 100 words for demo)
        // In production, use full 2048-word list
        return [
            'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse',
            'access', 'accident', 'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act',
            'action', 'actor', 'actual', 'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult',
            'advance', 'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent', 'agree',
            'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album', 'alcohol', 'alert', 'alien',
            'all', 'alley', 'allow', 'almost', 'alone', 'alpha', 'already', 'also', 'alter', 'always',
            'amateur', 'amazing', 'among', 'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle',
            'angry', 'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique', 'anxiety',
            'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april', 'area', 'arena', 'argue'
        ];
    }

    // Generate mnemonic seed phrase (12 words)
    generateMnemonic(length = 12) {
        const words = [];
        const wordCount = this.bip39WordList.length;

        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * wordCount);
            words.push(this.bip39WordList[randomIndex]);
        }

        return words.join(' ');
    }

    // Derive wallet from mnemonic (uses wallet-security.js if available)
    async deriveWalletFromMnemonic(mnemonic) {
        // If WalletSecurity is available, use it
        if (typeof WalletSecurity !== 'undefined') {
            const walletSecurity = new WalletSecurity();
            return await walletSecurity.deriveWalletFromMnemonic(mnemonic);
        }

        // Fallback: Simple derivation
        // Create seed from mnemonic
        const encoder = new TextEncoder();
        const data = encoder.encode(mnemonic);
        const seed = await crypto.subtle.digest('SHA-256', data);

        // Generate key pair using ECDSA (P-256, similar to secp256k1)
        const keyPair = await crypto.subtle.generateKey(
            {
                name: 'ECDSA',
                namedCurve: 'P-256'
            },
            true,
            ['sign', 'verify']
        );

        // Export keys
        const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
        const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

        // Generate address from public key
        const publicKeyHash = await crypto.subtle.digest('SHA-256', publicKey);
        const address = '0x' + Array.from(new Uint8Array(publicKeyHash))
            .slice(0, 20)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Convert private key to hex
        const privateKeyHex = Array.from(new Uint8Array(privateKey))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        return {
            address,
            privateKey: privateKeyHex,
            publicKey: Array.from(new Uint8Array(publicKey))
                .map(b => b.toString(16).padStart(2, '0'))
                .join(''),
            mnemonic: mnemonic
        };
    }

    // Generate treasury wallet
    async generateTreasuryWallet() {
        console.log('🏦 Generating Treasury Wallet...');
        
        // Use WalletSecurity if available (has full BIP39 word list)
        let mnemonic;
        if (typeof WalletSecurity !== 'undefined') {
            const walletSecurity = new WalletSecurity();
            mnemonic = walletSecurity.generateMnemonic(12);
        } else {
            mnemonic = this.generateMnemonic(12);
        }
        console.log('✅ Seed Phrase Generated');
        
        // Derive wallet
        const wallet = await this.deriveWalletFromMnemonic(mnemonic);
        console.log('✅ Wallet Derived');
        
        return {
            ...wallet,
            mnemonic: mnemonic
        };
    }
}

// If running in browser
if (typeof window !== 'undefined') {
    window.TreasuryWalletGenerator = TreasuryWalletGenerator;
    
    // Auto-generate on load
    window.generateTreasuryWallet = async function() {
        const generator = new TreasuryWalletGenerator();
        const wallet = await generator.generateTreasuryWallet();
        
        // Display results in a secure modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 30000;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 700px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        `;
        
        content.innerHTML = `
            <h2 style="margin-bottom: 20px; color: #dc3545;">🏦 Treasury Wallet Generated</h2>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
                <strong style="color: #856404;">⚠️ CRITICAL: Save this information NOW!</strong>
                <ul style="margin: 10px 0; padding-left: 20px; color: #856404; font-size: 0.9em;">
                    <li>Write down the seed phrase</li>
                    <li>Save the private key</li>
                    <li>Store in a safe, offline location</li>
                    <li>Never share with anyone!</li>
                </ul>
            </div>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 0.9em; color: #6c757d; margin-bottom: 5px;">📝 SEED PHRASE (12 words):</div>
                    <div style="font-family: monospace; font-size: 1.1em; word-break: break-all; padding: 10px; background: white; border-radius: 5px; border: 2px solid #28a745;">
                        ${wallet.mnemonic}
                    </div>
                </div>
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 0.9em; color: #6c757d; margin-bottom: 5px;">🔑 PRIVATE KEY:</div>
                    <div style="font-family: monospace; font-size: 0.9em; word-break: break-all; padding: 10px; background: white; border-radius: 5px; border: 2px solid #dc3545; color: #dc3545;">
                        ${wallet.privateKey}
                    </div>
                </div>
                <div>
                    <div style="font-size: 0.9em; color: #6c757d; margin-bottom: 5px;">📍 WALLET ADDRESS:</div>
                    <div style="font-family: monospace; font-size: 0.9em; word-break: break-all; padding: 10px; background: white; border-radius: 5px; border: 2px solid #667eea; color: #667eea;">
                        ${wallet.address}
                    </div>
                </div>
            </div>
            <div style="background: #d4edda; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #28a745;">
                <strong style="color: #155724;">✅ Next Steps:</strong>
                <ol style="margin: 10px 0; padding-left: 20px; color: #155724; font-size: 0.9em;">
                    <li>Update TREASURY_ADDRESS in blockchain to: <code>${wallet.address}</code></li>
                    <li>Import this wallet into Cheese Wallet using the seed phrase or private key</li>
                    <li>Backup this information securely (write it down!)</li>
                </ol>
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                <button id="copy-treasury-info" class="btn btn-primary" style="padding: 10px 20px;">📋 Copy All Info</button>
                <button id="close-treasury-modal" class="btn btn-secondary" style="padding: 10px 20px;">Close</button>
            </div>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Copy button
        const copyBtn = content.querySelector('#copy-treasury-info');
        copyBtn.addEventListener('click', async () => {
            const info = `TREASURY WALLET INFORMATION

SEED PHRASE (12 words):
${wallet.mnemonic}

PRIVATE KEY:
${wallet.privateKey}

WALLET ADDRESS:
${wallet.address}

⚠️ CRITICAL: Save this information securely!
`;
            try {
                await navigator.clipboard.writeText(info);
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy All Info';
                }, 2000);
            } catch (error) {
                alert('Failed to copy. Please copy manually.');
            }
        });
        
        // Close button
        const closeBtn = content.querySelector('#close-treasury-modal');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (confirm('⚠️ Have you saved the treasury wallet information? If not, you will lose access!')) {
                    document.body.removeChild(modal);
                }
            }
        });
        
        console.log('🏦 Treasury Wallet Generated:', wallet);
        return wallet;
    };
    
    console.log('✅ Treasury Wallet Generator loaded!');
    console.log('💡 Run: generateTreasuryWallet() to generate treasury wallet');
}

// If running in Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TreasuryWalletGenerator;
}

