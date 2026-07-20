/**
 * NCH Sovereign Explorer
 * API Integration & Page Logic
 */

class CheeseExplorer {
    constructor() {
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        const cfg = typeof window !== 'undefined' ? window.CHEESE_CONFIG : null;
        if (isLocalhost) {
            this.apiUrl = (cfg && cfg.API_URL) || 'http://localhost:3000';
        } else {
            // Same host as the page (Render, cheeseblockchain.com, previews) so /api always matches the running server
            this.apiUrl = (cfg && cfg.API_URL) || window.location.origin;
        }

        console.log('Using API URL:', this.apiUrl);

        // Versioning check (synchronized with index.html)
        // Versioning check (Disabled to prevent loops)
        try {
            const version = '5.3.0';
            localStorage.setItem('explorerVersion', version);
            console.log('Explorer initialized v' + version);
        } catch (e) { }

        this.apiKey = (cfg && cfg.API_KEY) || 'REDACTED_DEX_API_KEY';
        this.blockchain = null;
        this.currentPage = 'home';
        this.previousChainLength = 0;
        this.refreshInterval = 10000; // Increased to 10s for better server stability
        this.lastRefreshTime = 0;
        this.init();
    }

    async init() {
        console.log('Explorer initializing...');
        this.setupEventListeners();
        await this.loadBlockchainData();
        this.startAutoRefresh();
    }

    setupEventListeners() {
        document.querySelectorAll('.nav-link, .view-all').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                if (page) this.navigateTo(page);
            });
        });

        document.getElementById('search-btn').addEventListener('click', () => this.handleSearch());
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleSearch();
            });
        }
    }

    navigateTo(pageName, data = null) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const navLink = document.querySelector(`.nav-link[data-page="${pageName}"]`);
        if (navLink) navLink.classList.add('active');

        const page = document.getElementById(`${pageName}-page`);
        if (page) {
            page.classList.add('active');
            this.currentPage = pageName;

            switch (pageName) {
                case 'home': this.loadHome(); break;
                case 'blocks': this.loadBlocks(); break;
                case 'transactions': this.loadTransactions(); break;
                case 'address': if (data) this.loadAddress(data); break;
                case 'block-detail': if (data !== null) void this.loadBlockDetail(data); break;
            }
        }
    }

    async fetchAPI(endpoint, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const separator = endpoint.includes('?') ? '&' : '?';
                const url = `${this.apiUrl}${endpoint}${separator}apiKey=${this.apiKey}`;
                console.log(`[Attempt ${i + 1}/${retries}] Fetching:`, endpoint);

                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }
                });

                if (response.status === 503) {
                    console.warn('Server initializing (503). Retrying...');
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                if (response.status === 404) {
                    return await response.json().catch(() => ({ success: false }));
                }

                if (response.status === 401) {
                    throw new Error('HTTP error! status: 401');
                }

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API Attempt ${i + 1} failed:`, error.message);
                if (i === retries - 1) return null;
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
            }
        }
        return null;
    }

    showExplorerLoadFailure(message) {
        this.showErrorMessage(message);
        const lb = document.getElementById('latest-blocks');
        const lt = document.getElementById('latest-transactions');
        if (lb) lb.innerHTML = `<div class="no-data">${message}</div>`;
        if (lt) lt.innerHTML = `<div class="no-data">${message}</div>`;
        const bb = document.getElementById('blocks-table-body');
        const tb = document.getElementById('transactions-table-body');
        if (bb) bb.innerHTML = `<tr><td colspan="5" class="no-data">${message}</td></tr>`;
        if (tb) tb.innerHTML = `<tr><td colspan="6" class="no-data">${message}</td></tr>`;
    }

    async loadBlockchainData() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay && !this.blockchain) loadingOverlay.style.display = 'flex';

        console.log('Refreshing blockchain data...');

        try {
            const data = await this.fetchAPI('/api/blockchain');

            if (!data || !data.success) {
                console.warn('Failed to fetch blockchain data');
                this.latestBlocks = [];
                if (!this.blockchain) {
                    this.showExplorerLoadFailure('Unable to connect to blockchain API. Please check your connection.');
                }
                return;
            }

            const length = data.chainLength || 0;
            console.log(`Chain length: ${length}`);

            let chainBlocks = [];
            if (length > 0) {
                const MAX_BLOCKS = 100;
                const startIdx = length > MAX_BLOCKS ? length - MAX_BLOCKS : 0;
                const blocksData = await this.fetchAPI(`/api/blocks/range?start=${startIdx}&end=${length - 1}`);
                if (blocksData && blocksData.success && Array.isArray(blocksData.blocks)) {
                    chainBlocks = blocksData.blocks;
                } else {
                    console.warn('Failed to fetch blocks range');
                }
                this._explorerChainTruncated = startIdx > 0;
            } else {
                this._explorerChainTruncated = false;
            }

            this.latestBlocks = [...chainBlocks].reverse();
            this.blockchain = { ...data, chain: chainBlocks };

            const allTxData = await this.fetchAPI('/api/transactions/all');

            const newChainLength = data.chainLength || 0;

            if (this.previousChainLength > 0 && newChainLength > this.previousChainLength) {
                const newBlocks = newChainLength - this.previousChainLength;
                this.showNewBlockNotification(newBlocks);
            }

            this.previousChainLength = newChainLength;

            if (allTxData && allTxData.success) {
                this.allFirestoreTransactions = allTxData.transactions || [];
                console.log(`Loaded ${this.allFirestoreTransactions.length} transactions from API`);
            } else {
                this.allFirestoreTransactions = [];
                chainBlocks.forEach(block => {
                    if (block.transactions) {
                        block.transactions.forEach(tx => {
                            this.allFirestoreTransactions.push({
                                ...tx,
                                blockIndex: block.index,
                                timestamp: block.timestamp
                            });
                        });
                    }
                });
                console.log(`Fallback: extracted ${this.allFirestoreTransactions.length} transactions from blocks`);
            }

            this.lastRefreshTime = Date.now();
            this.updateStats();
            this.updateLiveIndicator();
            this.refreshCurrentPage();
        } catch (err) {
            console.error('Load error:', err);
            if (!this.blockchain) {
                this.showExplorerLoadFailure('Explorer failed to load data. Please retry.');
            }
        } finally {
            if (loadingOverlay) loadingOverlay.style.display = 'none';
        }
    }

    refreshCurrentPage() {
        switch (this.currentPage) {
            case 'home': this.loadHome(); break;
            case 'blocks': this.loadBlocks(); break;
            case 'transactions': this.loadTransactions(); break;
        }
    }

    showErrorMessage(msg) {
        const statsGrid = document.querySelector('.stats-grid');
        if (statsGrid) {
            let errorDiv = document.getElementById('api-error-msg');
            if (!errorDiv) {
                errorDiv = document.createElement('div');
                errorDiv.id = 'api-error-msg';
                errorDiv.style.cssText = 'grid-column: 1/-1; background: rgba(255, 68, 68, 0.1); border: 1px solid #ff4444; color: #ff4444; padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 20px;';
                statsGrid.parentNode.insertBefore(errorDiv, statsGrid);
            }
            errorDiv.innerHTML = `Error: ${msg} <button onclick="explorer.manualRefresh()" style="margin-left:15px; background:#ff4444; color:white; border:none; padding:5px 12px; border-radius:6px; cursor:pointer;">Retry Now</button>`;
        }
    }

    showNewBlockNotification(count) {
        // Create or update notification element
        let notif = document.getElementById('new-block-notif');
        if (!notif) {
            notif = document.createElement('div');
            notif.id = 'new-block-notif';
            notif.style.cssText = 'position:fixed;top:80px;right:20px;background:linear-gradient(135deg,#ffd700,#f5a623);color:#000;padding:12px 20px;border-radius:12px;font-weight:bold;z-index:1000;animation:slideIn 0.3s ease;box-shadow:0 4px 15px rgba(0,0,0,0.3);';
            document.body.appendChild(notif);
        }
        notif.innerHTML = `${count} New Block${count > 1 ? 's' : ''} Mined!`;
        notif.style.display = 'block';

        // Auto-hide after 3 seconds
        setTimeout(() => { if (notif) notif.style.display = 'none'; }, 3000);
    }

    updateLiveIndicator() {
        // Update live indicator if it exists
        const indicator = document.getElementById('live-indicator');
        if (indicator) {
            indicator.classList.add('pulse');
            setTimeout(() => indicator.classList.remove('pulse'), 500);
        }

        // Update last updated text if it exists
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            lastUpdated.textContent = 'Just now';
        }
    }

    updateStats() {
        if (!this.blockchain) return;

        // Use Firestore transaction count for complete history, fallback to in-memory chain
        let totalTxns = 0;
        if (this.allFirestoreTransactions && this.allFirestoreTransactions.length > 0) {
            totalTxns = this.allFirestoreTransactions.length;
        } else {
            if (this.allFirestoreTransactions && this.allFirestoreTransactions.length > 0) {
                totalTxns = this.allFirestoreTransactions.length;
            } else if (this.latestBlocks && this.latestBlocks.length > 0) {
                // Fallback estimation or sum of fetched blocks
                totalTxns = this.latestBlocks.reduce((sum, block) => sum + (block.transactions?.length || 0), 0);
            }
        }

        const chainLength = this.blockchain.chainLength || (this.latestBlocks && this.latestBlocks.length > 0 ? this.latestBlocks[0].index + 1 : 0);
        const latestHeight = this.latestBlocks && this.latestBlocks.length > 0 ? this.latestBlocks[0].index : Math.max(0, chainLength - 1);

        document.getElementById('total-blocks').textContent = chainLength > 0 ? `${chainLength} (Height #${latestHeight})` : '-';
        document.getElementById('total-transactions').textContent = totalTxns;
        document.getElementById('mining-reward').textContent = (this.blockchain.miningReward || 1) + ' NCH';
        document.getElementById('difficulty').textContent = this.blockchain.difficulty || '-';
    }

    loadHome() {
        this.loadLatestBlocks();
        this.loadLatestTransactions();
    }

    loadLatestBlocks() {
        if (!this.latestBlocks) return;
        const container = document.getElementById('latest-blocks');
        const blocks = this.latestBlocks.slice(0, 10);

        if (blocks.length === 0) {
            container.innerHTML = '<div class="no-data">No blocks yet</div>';
            return;
        }

        container.innerHTML = blocks.map(block => `
            <div class="data-item" onclick="explorer.navigateTo('block-detail', ${block.index})">
                <div class="item-row">
                    <span class="item-value">Block #${block.index}</span>
                    <span class="item-time">${this.formatTime(block.timestamp)}</span>
                </div>
                <div class="item-row">
                    <span class="item-label">Hash</span>
                    <span class="item-hash">${this.truncate(block.hash, 20)}</span>
                </div>
                <div class="item-row">
                    <span class="item-label">Txns</span>
                    <span class="item-value">${block.transactions?.length || 0}</span>
                </div>
            </div>
        `).join('');
    }

    async loadLatestTransactions() {
        const container = document.getElementById('latest-transactions');

        // PRIORITY: Fetch actual full history including pending
        let allTxns = [];
        
        try {
            // Fetch pending transactions first
            const pendingData = await this.fetchAPI('/api/transactions/pending');
            if (pendingData && pendingData.transactions) {
                allTxns = pendingData.transactions.map(tx => ({ ...tx, status: 'pending' }));
            }

            // Then add confirmed transactions fromFirestore or chain
            if (this.allFirestoreTransactions && this.allFirestoreTransactions.length > 0) {
                allTxns = [...allTxns, ...this.allFirestoreTransactions];
            } else if (this.blockchain?.chain) {
                for (const block of this.blockchain.chain) {
                    if (block.transactions) {
                        for (const tx of block.transactions) {
                            allTxns.push({ ...tx, blockIndex: block.index });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Error fetching latest transactions, falling back:', e);
        }

        allTxns.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const recentTxns = allTxns.slice(0, 15); // Show more on home

        if (recentTxns.length === 0) {
            container.innerHTML = '<div class="no-data">No transactions yet</div>';
            return;
        }

        container.innerHTML = recentTxns.map(tx => `
            <div class="data-item ${tx.status === 'pending' ? 'pending' : ''}" onclick="explorer.showTxDetail('${tx.id || tx.signature?.r || '-'}', ${tx.blockIndex || 0})">
                <div class="item-row">
                    <span class="item-hash">${this.truncate(tx.id || tx.signature?.r || '-', 16)}</span>
                    <span class="item-amount">${tx.amount || 0} ${tx.currency || 'NCH'}</span>
                </div>
                <div class="item-row">
                    <span class="item-address">From: ${this.truncate(tx.from || 'Mining', 12)}</span>
                    <span class="item-address">To: ${this.truncate(tx.to || '-', 12)}</span>
                </div>
                <div class="item-row">
                    <span class="item-time">${tx.status === 'pending' ? '<span class="badge badge-pending">Pending</span>' : this.formatTime(tx.timestamp)}</span>
                    <span class="item-label">${tx.status === 'pending' ? 'Mempool' : 'Block #' + (tx.blockIndex || 0)}</span>
                </div>
            </div>
        `).join('');
    }

    loadBlocks() {
        const tbody = document.getElementById('blocks-table-body');
        if (!tbody) return;

        if (!this.blockchain?.chain || !Array.isArray(this.blockchain.chain)) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data">No blocks loaded yet</td></tr>';
            return;
        }

        const blocks = [...this.blockchain.chain].reverse();

        if (blocks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data">No blocks yet</td></tr>';
            return;
        }

        tbody.innerHTML = blocks.map(block => {
            const miner = this.findMiner(block);
            return `
                <tr onclick="explorer.navigateTo('block-detail', ${block.index})">
                    <td><span class="hash">#${block.index}</span></td>
                    <td>${this.formatTime(block.timestamp)}</td>
                    <td>${block.transactions?.length || 0}</td>
                    <td><span class="address">${this.truncate(miner, 16)}</span></td>
                    <td><span class="hash">${this.truncate(block.hash, 16)}</span></td>
                </tr>
            `;
        }).join('');
    }

    async loadTransactions() {
        const tbody = document.getElementById('transactions-table-body');

        let allTxns = [];
        
        try {
            // Fetch pending transactions first
            const pendingData = await this.fetchAPI('/api/transactions/pending');
            if (pendingData && pendingData.transactions) {
                allTxns = pendingData.transactions.map(tx => ({ ...tx, status: 'pending' }));
            }

            if (this.allFirestoreTransactions && this.allFirestoreTransactions.length > 0) {
                allTxns = [...allTxns, ...this.allFirestoreTransactions];
            } else if (this.blockchain?.chain) {
                for (const block of this.blockchain.chain) {
                    if (block.transactions) {
                        for (const tx of block.transactions) {
                            allTxns.push({ ...tx, blockIndex: block.index });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Error loading transactions table:', e);
        }

        allTxns.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (allTxns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No transactions yet</td></tr>';
            return;
        }

        tbody.innerHTML = allTxns.map(tx => `
            <tr onclick="explorer.showTxDetail('${tx.id || tx.signature?.r || '-'}', ${tx.blockIndex || 0})" class="${tx.status === 'pending' ? 'row-pending' : ''}">
                <td><span class="hash">${this.truncate(tx.id || tx.signature?.r || '-', 12)}</span></td>
                <td>${tx.status === 'pending' ? '<span class="badge badge-pending">Pending</span>' : '#' + (tx.blockIndex || 0)}</td>
                <td>${tx.status === 'pending' ? 'Just now' : this.formatTime(tx.timestamp)}</td>
                <td><span class="address">${this.truncate(tx.from || 'Mining', 10)}</span></td>
                <td><span class="address">${this.truncate(tx.to || '-', 10)}</span></td>
                <td><span class="amount">${tx.amount || 0} ${tx.currency || 'NCH'}</span></td>
            </tr>
        `).join('');
    }

    async loadAddress(address) {
        document.getElementById('address-prompt').style.display = 'none';
        document.getElementById('address-info').style.display = 'block';
        document.getElementById('current-address').textContent = address;
        document.getElementById('address-display').textContent = address;

        const balanceData = await this.fetchAPI(`/api/balance/${address}`);

        // Multi-Asset Display
        let balanceHtml = `${balanceData?.balance || 0} NCH`;
        if (balanceData?.portfolio) {
            const extra = Object.entries(balanceData.portfolio)
                .filter(([sym, bal]) => bal > 0 || ['USDT', 'USDC'].includes(sym))
                .map(([sym, bal]) => `<br><span style="font-size:0.9em; color:#aaa">+ ${bal} ${sym}</span>`)
                .join('');
            balanceHtml += extra;
        }
        document.getElementById('address-balance').innerHTML = balanceData?.success ? balanceHtml : '0 NCH';

        const txContainer = document.getElementById('address-transactions');
        let addressTxns = [];

        try {
            // CRITICAL: Fetch full history (confirmed + pending) from backend
            console.log(`Fetching full history for address: ${address}`);
            const result = await this.fetchAPI(`/api/transactions/${address}`);
            if (result && result.success && result.transactions) {
                addressTxns = result.transactions;
            } else {
                // Fallback to manual scan if backend fails
                console.warn('Backend history failed, falling back to chain scan');
                if (this.blockchain?.chain) {
                    for (const block of this.blockchain.chain) {
                        if (block.transactions) {
                            for (const tx of block.transactions) {
                                if (tx.from === address || tx.to === address) {
                                    addressTxns.push({ ...tx, blockIndex: block.index });
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error loading address transactions:', e);
        }

        if (addressTxns.length === 0) {
            txContainer.innerHTML = '<div class="no-data">No transactions found</div>';
            return;
        }

        addressTxns.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        txContainer.innerHTML = addressTxns.map(tx => `
            <div class="data-item ${tx.status === 'pending' ? 'pending' : ''}">
                <div class="item-row">
                    <span class="item-value">${tx.from === address ? '<span class="badge badge-out">OUT</span>' : '<span class="badge badge-in">IN</span>'}</span>
                    <span class="item-amount">${tx.from === address ? '-' : '+'}${tx.amount} ${tx.currency || 'NCH'}</span>
                </div>
                <div class="item-row">
                    <span class="item-label">${tx.from === address ? 'To' : 'From'}</span>
                    <span class="item-address">${tx.from === address ? (tx.to || '-') : (tx.from || 'Mining')}</span>
                </div>
                <div class="item-row">
                    <span class="item-time">${tx.status === 'pending' ? '<span class="badge badge-pending">Pending</span>' : this.formatTime(tx.timestamp)}</span>
                    <span class="item-label">${tx.status === 'pending' ? 'Unconfirmed' : 'Block #' + (tx.blockIndex || 0)}</span>
                </div>
            </div>
        `).join('');
    }

    async loadBlockDetail(blockIndex) {
        let block = null;
        if (this.blockchain?.chain?.length) {
            block = this.blockchain.chain.find(b => b.index === blockIndex);
        }

        if (!block) {
            const res = await this.fetchAPI(`/api/block/${blockIndex}`);
            if (res && res.success && res.block) {
                block = res.block;
            }
        }

        if (!block) {
            alert('Block not found. It may be outside the range loaded in this session, or the index is invalid.');
            return;
        }

        document.getElementById('block-number').textContent = `Block #${block.index}`;
        document.getElementById('detail-block-height').textContent = block.index;
        document.getElementById('detail-block-time').textContent = new Date(block.timestamp).toLocaleString();
        document.getElementById('detail-block-txns').textContent = block.transactions?.length || 0;
        document.getElementById('detail-block-hash').textContent = block.hash || '-';
        document.getElementById('detail-prev-hash').textContent = block.previousHash || '-';
        document.getElementById('detail-nonce').textContent = block.nonce || 0;
        document.getElementById('detail-difficulty').textContent = block.difficulty || '-';

        const txList = document.getElementById('block-transactions-list');
        if (!block.transactions?.length) {
            txList.innerHTML = '<div class="no-data">No transactions</div>';
        } else {
            txList.innerHTML = block.transactions.map(tx => `
            <div class="data-item">
                <div class="item-row">
                    <span class="item-hash">${this.truncate(tx.id || tx.signature?.r || '-', 20)}</span>
                    <span class="item-amount">${tx.amount || 0} ${tx.currency || 'NCH'}</span>
                </div>
                <div class="item-row">
                    <span class="item-address">From: ${tx.from || 'Mining Reward'}</span>
                    <span class="item-address">To: ${this.truncate(tx.to || '-', 16)}</span>
                </div>
            </div>
        `).join('');
        }

        this.navigateTo('block-detail');
    }

    async showTxDetail(txId, blockIndex) {
        let tx = null;
        let blockData = null;

        // 1. Try to find in the active chain
        if (this.blockchain?.chain) {
            const block = this.blockchain.chain.find(b => b.index === blockIndex);
            if (block?.transactions) {
                tx = block.transactions.find(t => t.id === txId || t.signature?.r === txId || t.hash === txId);
                blockData = block;
            }
        }

        // 2. Try to find in historical transactions
        if (!tx && this.allFirestoreTransactions) {
            tx = this.allFirestoreTransactions.find(t => t.id === txId || t.signature?.r === txId || t.hash === txId);
            if (tx && !blockData) {
                blockData = { index: tx.blockIndex || 0, timestamp: tx.timestamp };
            }
        }

        // 3. FALLBACK: Fetch from Backend (New endpoint)
        if (!tx) {
            console.log(`TX ${txId} not in memory, fetching from server...`);
            const res = await this.fetchAPI(`/api/transaction/${txId}`);
            if (res && res.success && res.transaction) {
                tx = res.transaction;
                blockData = { index: res.blockIndex || tx.blockIndex || 'Confirmed', timestamp: tx.timestamp };
            }
        }

        if (!tx) {
            console.warn('Transaction not found:', txId);
            alert('Transaction details not found. It may still be processing or is from a block not yet indexed.');
            return;
        }

        document.getElementById('detail-tx-hash').textContent = tx.id || tx.hash || tx.signature?.r || '-';
        document.getElementById('detail-tx-block').innerHTML = blockData?.index === 'Mempool' ? '<span class="badge badge-pending">Pending</span>' : `#${blockData?.index || 0}`;
        document.getElementById('detail-tx-time').textContent = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : 'Just now';
        document.getElementById('detail-tx-from').textContent = tx.from || 'Mining Reward';
        document.getElementById('detail-tx-to').textContent = tx.to || '-';
        document.getElementById('detail-tx-amount').textContent = `${tx.amount || 0} ${tx.currency || 'NCH'}`;
        
        // Enhanced transaction type display
        let txType = 'Transfer';
        if (tx.data?.type === 'mining_reward') {
            txType = 'Mining Reward';
        } else if (tx.data?.type === 'DOCUMENT_NOTARY') {
            txType = 'Document Notary';
        } else if (tx.data?.type === 'notary_stamp') {
            txType = 'Notary Stamp';
        } else if (tx.data?.type === 'bridge_lock') {
            txType = 'Bridge Lock';
        }
        document.getElementById('detail-tx-type').textContent = txType;
        
        // Show notary details if available
        if (tx.data?.type === 'DOCUMENT_NOTARY') {
            const notaryInfo = document.getElementById('detail-tx-notary-info');
            if (notaryInfo) {
                notaryInfo.innerHTML = `
                    <div style="margin-top: 10px; padding: 10px; background: #f0f8ff; border-radius: 5px;">
                        <strong>Notary Details:</strong><br>
                        File: ${tx.data.filename || 'Unknown'}<br>
                        Hash: ${tx.data.hash || 'N/A'}<br>
                        Agent: ${tx.data.agent || 'Unknown'}
                    </div>
                `;
                notaryInfo.style.display = 'block';
            }
        } else if (tx.data?.type === 'notary_stamp' && tx.data.hash) {
            const container = document.getElementById('tx-detail-page');
            if (container) {
                const oldBox = container.querySelector('.notary-data-box');
                if (oldBox) oldBox.remove();
                const dataBox = document.createElement('div');
                dataBox.className = 'notary-data-box';
                dataBox.style.cssText = 'margin-top:20px; padding:15px; background:rgba(255,215,0,0.1); border:1px solid #ffd700; border-radius:12px;';
                dataBox.innerHTML = `
                    <div style="color:#ffd700; font-weight:bold; margin-bottom:10px;">Notary Metadata</div>
                    <div style="font-size:0.9em; margin-bottom:5px;"><span style="color:#aaa;">File:</span> ${tx.data.fileName || 'Unknown'}</div>
                    <div style="font-size:0.9em; word-break:break-all;"><span style="color:#aaa;">Hash:</span> ${tx.data.hash}</div>
                `;
                container.appendChild(dataBox);
            }
        }

        this.navigateTo('tx-detail');
    }

    async handleSearch() {
        const input = document.getElementById('search-input').value.trim();
        if (!input) return;

        // Block Height search
        if (/^\d+$/.test(input)) {
            const blockIndex = parseInt(input, 10);
            await this.loadBlockDetail(blockIndex);
            return;
        }

        // Address search
        if (input.startsWith('0x') && input.length >= 40) {
            this.navigateTo('address', input.toLowerCase());
            return;
        }

        // Block Hash or Transaction Hash search
        // 1. Check Blocks in memory
        if (this.blockchain?.chain) {
            const block = this.blockchain.chain.find(b => b.hash === input);
            if (block) { await this.loadBlockDetail(block.index); return; }
        }

        // 2. Check Transactions in memory/history
        const allTxs = [...(this.allFirestoreTransactions || [])];
        if (this.blockchain?.chain) {
            this.blockchain.chain.forEach(b => { if (b.transactions) allTxs.push(...b.transactions); });
        }
        if (this.blockchain?.pendingTransactions) {
            allTxs.push(...this.blockchain.pendingTransactions);
        }

        // Enhanced search for notary hashes - check multiple fields
        const tx = allTxs.find(t => 
            t.id === input || 
            t.hash === input || 
            t.signature?.r === input ||
            (t.data && t.data.hash === input) || // Notary document hash
            (t.data && t.data.filename && input.includes(t.data.filename)) // Search by filename
        );
        if (tx) {
            this.showTxDetail(tx.id || tx.hash || tx.signature?.r, tx.blockIndex || 0);
            return;
        }

        // 3. DEEP SEARCH: Call Backend (For older transactions or specific Notary hashes)
        const res = await this.fetchAPI(`/api/transaction/${input}`);
        if (res && res.success && res.transaction) {
            this.showTxDetail(input, res.blockIndex || 0);
            return;
        }

        // 4. Try Block Hash Search on Backend
        const blockRes = await this.fetchAPI(`/api/block/${input}`);
        if (blockRes && blockRes.success && blockRes.block) {
            await this.loadBlockDetail(blockRes.block.index);
            return;
        }

        alert('No block, transaction or address found matching that hash.');
    }

    findMiner(block) {
        if (!block.transactions) return 'Unknown';
        const rewardTx = block.transactions.find(tx => tx.data?.type === 'mining_reward' || !tx.from);
        return rewardTx?.to || 'Genesis';
    }

    truncate(str, length) {
        if (!str) return '-';
        if (str.length <= length) return str;
        const half = Math.floor(length / 2) - 2;
        return str.slice(0, half) + '...' + str.slice(-half);
    }

    formatTime(timestamp) {
        if (!timestamp) return '-';
        const diff = Date.now() - timestamp;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' mins ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
        if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
        return new Date(timestamp).toLocaleDateString();
    }

    startAutoRefresh() {
        // Real-time refresh every 5 seconds
        setInterval(() => {
            this.loadBlockchainData();
        }, this.refreshInterval);

        console.log(`Real-time updates enabled (every ${this.refreshInterval / 1000}s)`);
    }

    // Manual refresh button handler
    manualRefresh() {
        console.log('Manual refresh triggered');
        this.loadBlockchainData();
    }
}

function copyAddress() {
    const address = document.getElementById('address-display').textContent;
    navigator.clipboard.writeText(address).then(() => alert('Address copied!'));
}

const explorer = new CheeseExplorer();
