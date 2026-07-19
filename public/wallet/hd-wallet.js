// HD Wallet Implementation - BIP32/BIP44
// Handles hierarchical key derivation and address generation

class HDWallet {
    constructor() {
        this.init();
    }

    init() {
        // Set up event listeners
        document.getElementById('generateAddresses').addEventListener('click', () => {
            this.generateAddressList();
        });
    }

    generateAddressList() {
        const wallet = window.btcWallet.wallet;
        if (!wallet) {
            alert('❌ Please create or recover a wallet first!');
            return;
        }

        try {
            const count = parseInt(document.getElementById('addressCount').value);
            const accountType = parseInt(document.getElementById('accountType').value);

            // Get network
            const network = wallet.network === 'testnet' ?
                bitcoin.networks.testnet : bitcoin.networks.bitcoin;

            // Derive seed
            const seed = bip39.mnemonicToSeedSync(wallet.mnemonic, wallet.passphrase || '');
            const root = bip32.fromSeed(seed, network);

            // Generate addresses
            const coinType = wallet.network === 'testnet' ? 1 : 0;
            const addresses = [];

            for (let i = 0; i < count; i++) {
                const path = `m/44'/${coinType}'/0'/${accountType}/${i}`;
                const child = root.derivePath(path);

                // Generate P2WPKH address (Native SegWit)
                const { address } = bitcoin.payments.p2wpkh({
                    pubkey: child.publicKey,
                    network: network
                });

                // Get WIF (Wallet Import Format) private key
                const wif = child.toWIF();

                addresses.push({
                    index: i,
                    path: path,
                    address: address,
                    publicKey: child.publicKey.toString('hex'),
                    privateKey: wif
                });
            }

            this.displayAddresses(addresses, wallet.network);
            this.displayExplorerLinks(addresses, wallet.network);
        } catch (error) {
            console.error('❌ Error generating addresses:', error);
            alert('Error generating addresses: ' + error.message);
        }
    }

    displayAddresses(addresses, network) {
        const listDiv = document.getElementById('addressList');
        listDiv.innerHTML = '<h3>Generated Addresses</h3>';

        addresses.forEach(addr => {
            const item = document.createElement('div');
            item.className = 'address-item';
            item.innerHTML = `
                <div class="address-info">
                    <div class="address-path">${addr.path}</div>
                    <div class="address-value">${addr.address}</div>
                </div>
                <button class="btn-icon" onclick="hdWallet.copyAddressToClipboard('${addr.address}')" title="Copy address">📋</button>
            `;
            listDiv.appendChild(item);
        });
    }

    displayExplorerLinks(addresses, network) {
        const linksDiv = document.getElementById('explorerLinks');
        linksDiv.innerHTML = '';

        if (addresses.length === 0) return;

        const explorerBase = network === 'testnet' ?
            'https://blockstream.info/testnet/address/' :
            'https://blockstream.info/address/';

        const firstAddress = addresses[0].address;

        linksDiv.innerHTML = `
            <div class="info-item">
                <label>Blockstream:</label>
                <a href="${explorerBase}${firstAddress}" target="_blank" style="color: var(--primary);">
                    View First Address on Blockstream
                </a>
            </div>
            <div class="info-item">
                <label>Blockchain.com:</label>
                <a href="https://www.blockchain.com/explorer/addresses/btc/${firstAddress}" target="_blank" style="color: var(--primary);">
                    View on Blockchain.com
                </a>
            </div>
            <p style="margin-top: 1rem; color: var(--text-tertiary); font-size: 0.875rem;">
                Click the links above to check balance and transaction history
            </p>
        `;
    }

    copyAddressToClipboard(address) {
        navigator.clipboard.writeText(address).then(() => {
            alert('📋 Address copied!');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    // Derive a specific path
    derivePath(path) {
        const wallet = window.btcWallet.wallet;
        if (!wallet) {
            throw new Error('No wallet available');
        }

        const network = wallet.network === 'testnet' ?
            bitcoin.networks.testnet : bitcoin.networks.bitcoin;

        const seed = bip39.mnemonicToSeedSync(wallet.mnemonic, wallet.passphrase || '');
        const root = bip32.fromSeed(seed, network);

        return root.derivePath(path);
    }

    // Get address from child key
    getAddress(childKey, network, type = 'p2wpkh') {
        switch (type) {
            case 'p2pkh': // Legacy
                return bitcoin.payments.p2pkh({
                    pubkey: childKey.publicKey,
                    network: network
                }).address;

            case 'p2sh-p2wpkh': // Nested SegWit
                return bitcoin.payments.p2sh({
                    redeem: bitcoin.payments.p2wpkh({
                        pubkey: childKey.publicKey,
                        network: network
                    })
                }).address;

            case 'p2wpkh': // Native SegWit
            default:
                return bitcoin.payments.p2wpkh({
                    pubkey: childKey.publicKey,
                    network: network
                }).address;
        }
    }
}

// Initialize HD Wallet when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof bitcoin !== 'undefined' && typeof bip39 !== 'undefined') {
            window.hdWallet = new HDWallet();
            console.log('✅ HD Wallet initialized');
        }
    }, 500);
});
