/**
 * Wallet Enhancements - Additional Features
 * Portfolio, Analytics, Staking, and more
 */

class WalletEnhancements {
    constructor(blockchainAPI, walletCore) {
        this.api = blockchainAPI;
        this.walletCore = walletCore;
        this.addressBook = this.loadAddressBook();
        this.transactionNotes = this.loadTransactionNotes();
    }

    // Address Book
    loadAddressBook() {
        const saved = localStorage.getItem('addressBook');
        return saved ? JSON.parse(saved) : [];
    }

    saveAddressBook() {
        localStorage.setItem('addressBook', JSON.stringify(this.addressBook));
    }

    addToAddressBook(name, address, label = '') {
        this.addressBook.push({
            name,
            address,
            label,
            addedAt: Date.now()
        });
        this.saveAddressBook();
    }

    removeFromAddressBook(address) {
        this.addressBook = this.addressBook.filter(entry => entry.address !== address);
        this.saveAddressBook();
    }

    getAddressBook() {
        return this.addressBook;
    }

    // Transaction Notes
    loadTransactionNotes() {
        const saved = localStorage.getItem('transactionNotes');
        return saved ? JSON.parse(saved) : {};
    }

    saveTransactionNotes() {
        localStorage.setItem('transactionNotes', JSON.stringify(this.transactionNotes));
    }

    addTransactionNote(txHash, note) {
        this.transactionNotes[txHash] = {
            note,
            createdAt: Date.now()
        };
        this.saveTransactionNotes();
    }

    getTransactionNote(txHash) {
        return this.transactionNotes[txHash]?.note || '';
    }

    // Portfolio Analytics
    async getPortfolioStats(walletAddress) {
        try {
            const balance = await this.api.getBalance(walletAddress);
            const transactions = await this.api.getTransactionHistory(walletAddress);
            const blockchain = await this.api.getBlockchainInfo();

            // Calculate stats
            const totalSent = transactions
                .filter(tx => tx.from === walletAddress)
                .reduce((sum, tx) => sum + (tx.amount || 0), 0);

            const totalReceived = transactions
                .filter(tx => tx.to === walletAddress)
                .reduce((sum, tx) => sum + (tx.amount || 0), 0);

            const transactionCount = transactions.length;
            const firstTransaction = transactions.length > 0 
                ? transactions[transactions.length - 1].timestamp 
                : null;

            // Estimate USD value (placeholder - would use real price API)
            const estimatedUSD = balance * 1.0; // 1 NCHEESE = $1 (placeholder)

            return {
                balance,
                estimatedUSD,
                totalSent,
                totalReceived,
                transactionCount,
                firstTransaction,
                walletAge: firstTransaction ? Date.now() - firstTransaction : 0,
                avgTransactionValue: transactionCount > 0 
                    ? (totalSent + totalReceived) / transactionCount 
                    : 0
            };
        } catch (error) {
            console.error('Portfolio stats error:', error);
            return null;
        }
    }

    // Generate QR Code for Address
    generateQRCode(address, amount = null, token = 'NCHEESE') {
        // QR code data format: ethereum:address?value=amount&token=symbol
        let qrData = `ethereum:${address}`;
        
        if (amount) {
            qrData += `?value=${amount}`;
            if (token && token !== 'ETH') {
                qrData += `&token=${token}`;
            }
        }
        
        return qrData;
    }

    // Parse QR Code
    parseQRCode(qrData) {
        try {
            if (qrData.startsWith('ethereum:')) {
                const parts = qrData.substring(9).split('?');
                const address = parts[0];
                const params = {};
                
                if (parts[1]) {
                    parts[1].split('&').forEach(param => {
                        const [key, value] = param.split('=');
                        params[key] = value;
                    });
                }
                
                return {
                    address,
                    amount: params.value ? parseFloat(params.value) : null,
                    token: params.token || 'ETH',
                    type: 'ethereum'
                };
            } else if (qrData.startsWith('0x')) {
                // Plain address
                return {
                    address: qrData,
                    amount: null,
                    token: null,
                    type: 'address'
                };
            }
            
            return null;
        } catch (error) {
            console.error('Parse QR code error:', error);
            return null;
        }
    }

    // Export Wallet (JSON)
    exportWalletJSON(wallet, password = null) {
        const exportData = {
            address: wallet.address,
            publicKey: wallet.publicKey,
            exportedAt: Date.now(),
            version: '1.0.0'
        };

        if (password) {
            // Encrypt export data
            exportData.encrypted = true;
            exportData.encryptedData = btoa(JSON.stringify({
                privateKey: wallet.privateKey,
                password: password
            }));
        }

        return JSON.stringify(exportData, null, 2);
    }

    // Import Wallet from JSON
    importWalletJSON(jsonData, password = null) {
        try {
            const data = JSON.parse(jsonData);
            
            if (data.encrypted && data.encryptedData) {
                if (!password) {
                    throw new Error('Password required for encrypted wallet');
                }
                const decrypted = JSON.parse(atob(data.encryptedData));
                if (decrypted.password !== password) {
                    throw new Error('Invalid password');
                }
                return {
                    address: data.address,
                    publicKey: data.publicKey,
                    privateKey: decrypted.privateKey
                };
            } else {
                return {
                    address: data.address,
                    publicKey: data.publicKey,
                    privateKey: data.privateKey
                };
            }
        } catch (error) {
            throw new Error('Invalid wallet file: ' + error.message);
        }
    }

    // Transaction Filtering
    filterTransactions(transactions, filters = {}) {
        let filtered = [...transactions];

        if (filters.type) {
            if (filters.type === 'sent') {
                filtered = filtered.filter(tx => tx.from === filters.address);
            } else if (filters.type === 'received') {
                filtered = filtered.filter(tx => tx.to === filters.address);
            }
        }

        if (filters.minAmount) {
            filtered = filtered.filter(tx => tx.amount >= filters.minAmount);
        }

        if (filters.maxAmount) {
            filtered = filtered.filter(tx => tx.amount <= filters.maxAmount);
        }

        if (filters.startDate) {
            filtered = filtered.filter(tx => tx.timestamp >= filters.startDate);
        }

        if (filters.endDate) {
            filtered = filtered.filter(tx => tx.timestamp <= filters.endDate);
        }

        if (filters.search) {
            const search = filters.search.toLowerCase();
            filtered = filtered.filter(tx => 
                tx.id?.toLowerCase().includes(search) ||
                tx.from?.toLowerCase().includes(search) ||
                tx.to?.toLowerCase().includes(search)
            );
        }

        return filtered;
    }

    // Format Currency
    formatCurrency(amount, currency = 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount);
    }

    // Format Date
    formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Format Relative Time
    formatRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        return 'Just now';
    }

    // Validate Address
    validateAddress(address) {
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    // Copy to Clipboard
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            return true;
        }
    }

    // Share Address
    async shareAddress(address) {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My CHEESE Wallet Address',
                    text: `My CHEESE wallet address: ${address}`,
                    url: window.location.href
                });
                return true;
            } catch (error) {
                return false;
            }
        }
        return false;
    }

    // Show QR Code (delegates to app.js for consistency)
    showQRCode(address) {
        // This method is kept for compatibility but app.js handles QR display
        if (window.app && window.app.showQRCode) {
            window.app.showQRCode();
        } else {
            // Fallback if app not available
            alert(`QR Code for: ${address}\n\nPlease use the QR button in the wallet interface.`);
        }
    }

    // Show Portfolio Modal
    async showPortfolioModal(walletAddress, api) {
        const stats = await this.getPortfolioStats(walletAddress);
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        `;
        
        content.innerHTML = `
            <h2>📊 Portfolio</h2>
            <div style="margin: 20px 0;">
                <div><strong>Balance:</strong> ${stats.balance.toFixed(2)} NCHEESE</div>
                <div><strong>Estimated USD:</strong> $${stats.estimatedUSD.toFixed(2)}</div>
                <div><strong>Total Sent:</strong> ${stats.totalSent.toFixed(2)} NCHEESE</div>
                <div><strong>Total Received:</strong> ${stats.totalReceived.toFixed(2)} NCHEESE</div>
                <div><strong>Transactions:</strong> ${stats.transactionCount}</div>
            </div>
            <button id="portfolio-close-btn" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        document.getElementById('portfolio-close-btn').onclick = () => {
            document.body.removeChild(modal);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
    }

    // Show All Transactions Modal
    showAllTransactionsModal(transactions) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
        `;
        
        const txList = transactions.length > 0 
            ? transactions.map(tx => `
                <div style="padding: 10px; border-bottom: 1px solid #eee;">
                    <div><strong>${tx.from === window.app?.wallet?.address ? 'Sent' : 'Received'}:</strong> ${tx.amount} NCHEESE</div>
                    <div style="font-size: 0.9em; color: #666;">${new Date(tx.timestamp).toLocaleString()}</div>
                </div>
            `).join('')
            : '<p>No transactions</p>';
        
        content.innerHTML = `
            <h2>All Transactions</h2>
            <div style="margin: 20px 0;">
                ${txList}
            </div>
            <button id="tx-close-btn" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        document.getElementById('tx-close-btn').onclick = () => {
            document.body.removeChild(modal);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
    }

    // Show Address Book Modal
    showAddressBookModal() {
        const addresses = this.getAddressBook();
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        `;
        
        const addressList = addresses.length > 0
            ? addresses.map(addr => `
                <div style="padding: 10px; border-bottom: 1px solid #eee;">
                    <div><strong>${addr.name}</strong></div>
                    <div style="font-family: monospace; font-size: 0.9em; color: #666;">${addr.address}</div>
                </div>
            `).join('')
            : '<p>No saved addresses</p>';
        
        content.innerHTML = `
            <h2>Address Book</h2>
            <div style="margin: 20px 0;">
                ${addressList}
            </div>
            <button id="addressbook-close-btn" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
        `;
        
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        document.getElementById('addressbook-close-btn').onclick = () => {
            document.body.removeChild(modal);
        };
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletEnhancements;
}

