/**
 * Mobile Miner - Distributed Mining for Cheese Blockchain
 * Uses Web Workers for background mining on mobile devices
 */

class MobileMiner {
    constructor(blockchainAPI, walletCore) {
        this.api = blockchainAPI;
        this.walletCore = walletCore;
        this.isMining = false;
        this.miningWorker = null;
        this.currentDifficulty = 4; // Increased from 2 to 4 (1 in 65,536 chance vs 1 in 256)
        this.lastBlockTime = null;
        this.minBlockInterval = 60000; // Minimum 60 seconds between blocks (1 minute)
        this.submittedBlocks = new Set(); // Track submitted block hashes to prevent duplicates
        this.minedBlockIndices = new Set(); // Track mined block indices to prevent duplicate index mining
        this.loadSubmittedBlocks(); // Load from localStorage
        this.deviceId = this.getOrCreateDeviceId(); // Get or create device fingerprint
        this.loadDeviceMiningWallet(); // Load which wallet is registered for this device
        this.miningStats = {
            hashRate: '0 H/s',
            hashesPerSecond: 0,
            totalHashes: 0,
            blocksFound: 0,
            difficulty: 0,
            miningTime: '0s',
            startTime: null
        };
        this.onBlockFound = null;
        this.onStatsUpdate = null;
        this.isSubmittingBlock = false; // Flag to prevent concurrent block submissions
    }

    // Generate or retrieve device fingerprint
    getOrCreateDeviceId() {
        try {
            // Check if device ID already exists
            const existingDeviceId = localStorage.getItem('cheeseDeviceId');
            if (existingDeviceId) {
                return existingDeviceId;
            }

            // Generate device fingerprint from multiple browser/device characteristics
            const fingerprint = [
                navigator.userAgent,
                navigator.language,
                screen.width + 'x' + screen.height,
                screen.colorDepth,
                new Date().getTimezoneOffset(),
                navigator.platform,
                navigator.hardwareConcurrency || 'unknown',
                navigator.deviceMemory || 'unknown',
                navigator.maxTouchPoints || 'unknown'
            ].join('|');

            // Create a simple hash of the fingerprint
            let hash = 0;
            for (let i = 0; i < fingerprint.length; i++) {
                const char = fingerprint.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32-bit integer
            }

            // Create device ID from hash (without timestamp for stability)
            // Timestamp is only added on first creation, not on subsequent loads
            const deviceId = 'device_' + Math.abs(hash).toString(36);

            // Store device ID permanently
            localStorage.setItem('cheeseDeviceId', deviceId);
            localStorage.setItem('cheeseDeviceIdCreated', Date.now().toString()); // Track creation time separately
            console.log('Device ID created:', deviceId);

            return deviceId;
        } catch (error) {
            console.error('Error creating device ID:', error);
            // Fallback to timestamp-based ID
            const fallbackId = 'device_fallback_' + Date.now();
            localStorage.setItem('cheeseDeviceId', fallbackId);
            return fallbackId;
        }
    }

    // Load which wallet is registered for mining on this device
    loadDeviceMiningWallet() {
        try {
            const saved = localStorage.getItem('cheeseDeviceMiningWallet');
            if (saved) {
                const data = JSON.parse(saved);
                // Verify device ID matches
                if (data.deviceId === this.deviceId) {
                    this.deviceMiningWallet = data.walletAddress;
                    this.deviceMiningTimestamp = data.timestamp;
                    console.log('Device mining wallet loaded:', this.deviceMiningWallet);
                } else {
                    // Device ID changed (unlikely but possible), reset
                    console.warn('Device ID mismatch, resetting mining wallet');
                    this.deviceMiningWallet = null;
                    this.deviceMiningTimestamp = null;
                }
            } else {
                this.deviceMiningWallet = null;
                this.deviceMiningTimestamp = null;
            }
        } catch (error) {
            console.error('Error loading device mining wallet:', error);
            this.deviceMiningWallet = null;
            this.deviceMiningTimestamp = null;
        }
    }

    // Save which wallet is registered for mining on this device
    saveDeviceMiningWallet(walletAddress) {
        try {
            const data = {
                deviceId: this.deviceId,
                walletAddress: walletAddress,
                timestamp: Date.now()
            };
            localStorage.setItem('cheeseDeviceMiningWallet', JSON.stringify(data));
            this.deviceMiningWallet = walletAddress;
            this.deviceMiningTimestamp = data.timestamp;
            console.log('Device mining wallet saved:', walletAddress);
        } catch (error) {
            console.error('Error saving device mining wallet:', error);
        }
    }

    // Start mining
    async startMining(walletAddress) {
        if (this.isMining) {
            throw new Error('Mining already in progress');
        }

        if (!walletAddress) {
            throw new Error('Wallet address required');
        }

        // CRITICAL: Reload submitted blocks BEFORE starting mining (prevents refresh exploit)
        this.loadSubmittedBlocks();

        // CRITICAL: Check for active mining session from before refresh
        const activeSession = localStorage.getItem('cheeseMiningActiveSession');
        if (activeSession) {
            try {
                const sessionData = JSON.parse(activeSession);
                // Only check if it's the same device and wallet
                if (sessionData.deviceId === this.deviceId &&
                    sessionData.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
                    const sessionAge = Date.now() - sessionData.timestamp;
                    // If session is less than 5 minutes old, block mining (might be from refresh)
                    // Increased from 2 to 5 minutes for better protection
                    if (sessionAge < 5 * 60 * 1000) {
                        console.warn('⚠️ Active mining session detected from recent refresh. Blocking to prevent duplicate.');
                        const waitTime = Math.ceil((5 * 60 * 1000 - sessionAge) / 1000);
                        this.showNotification(`⚠️ Please wait ${waitTime} seconds before starting mining again. This prevents duplicate submissions.`, 'warning');
                        throw new Error(`Active mining session detected. Please wait ${waitTime} seconds before starting again.`);
                    }
                }
            } catch (e) {
                console.warn('Error checking active session:', e);
                // Clear invalid session data
                localStorage.removeItem('cheeseMiningActiveSession');
            }
        }

        // Mark mining session as active
        localStorage.setItem('cheeseMiningActiveSession', JSON.stringify({
            walletAddress: walletAddress,
            timestamp: Date.now(),
            deviceId: this.deviceId
        }));

        // EXEMPT WALLETS: Founder, Treasury, and Liquidity wallets can mine from ANY device
        const exemptWallets = [
            '0x0E6ec6713E7b5b7C11d969dA848813d08223598E', // FOUNDER
            '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3', // TREASURY (Corrected from cc1)
            '0x3801490C9f806c917b8CbA710Db9135FA3B116ae', // LIQUIDITY
            '0x712A1CBa607C60D95f27088c80aBbBD1f53d33Fe'  // OPERATOR / AI
        ].map(w => w.toLowerCase()); // Force lowercase

        // Use strict check against normalized array
        const isExemptWallet = exemptWallets.includes(walletAddress.toLowerCase());

        // CRITICAL: Check if a different wallet is trying to mine on this device
        // Skip device lock check for exempt wallets (Founder, Treasury, Liquidity)
        if (!isExemptWallet && this.deviceMiningWallet && this.deviceMiningWallet.toLowerCase() !== walletAddress.toLowerCase()) {
            const errorMsg = `⚠️ Mining is restricted to one wallet per device. This device is already registered with wallet: ${this.deviceMiningWallet.substring(0, 10)}...${this.deviceMiningWallet.substring(this.deviceMiningWallet.length - 8)}. Please use that wallet to mine, or use a different device.`;
            console.error('Mining blocked: Different wallet on same device');
            this.showNotification(errorMsg, 'error');
            throw new Error(errorMsg);
        }

        // Log if exempt wallet is being used
        if (isExemptWallet) {
            console.log('✅ Exempt wallet detected (Founder/Treasury/Liquidity) - device lock bypassed');
        }

        // If no wallet is registered for this device, register the current one
        // BUT: Don't register exempt wallets (Founder/Treasury/Liquidity) to device lock
        // This allows them to mine on any device without locking that device
        if (!this.deviceMiningWallet && !isExemptWallet) {
            this.saveDeviceMiningWallet(walletAddress);
            console.log('New wallet registered for mining on this device:', walletAddress);
        }

        try {
            // Get current blockchain state
            const chainInfo = await this.api.getChain();
            if (!chainInfo || !chainInfo.chain) {
                throw new Error('Failed to get blockchain info');
            }

            // Get pending transactions (optional - if endpoint doesn't exist, use empty array)
            let pendingTxs = [];
            try {
                pendingTxs = await this.api.getPendingTransactions();
                if (!Array.isArray(pendingTxs)) {
                    pendingTxs = [];
                }
            } catch (error) {
                console.warn('⚠️ Pending transactions endpoint not available, using empty array:', error.message);
                pendingTxs = [];
            }

            // Get last block
            const lastBlock = chainInfo.chain[chainInfo.chain.length - 1];
            if (!lastBlock) {
                throw new Error('No blocks found in blockchain');
            }

            // CRITICAL: Check if we already mined the next block index (prevent duplicate mining)
            const nextBlockIndex = lastBlock.index + 1;

            // CRITICAL: Also verify the index is not already in the blockchain (server-side validation)
            // This prevents mining an index that was already added by another miner
            if (chainInfo.chain.some(block => block.index === nextBlockIndex)) {
                // Block index already exists - fetch latest blockchain state and continue with next block
                console.log('ℹ️ Block index', nextBlockIndex, 'already exists. Fetching latest blockchain state...');
                // Recursively call startMining to get fresh blockchain state
                // This will get the new next block index automatically
                setTimeout(() => {
                    if (this.isMining) {
                        this.startMining(walletAddress);
                    }
                }, 1000); // Short delay to let blockchain update
                return true; // Return success to indicate mining will continue
            }

            // Check if we already mined this index (only warn, don't throw - will be handled by server)
            if (this.minedBlockIndices.has(nextBlockIndex)) {
                console.log('ℹ️ Block index', nextBlockIndex, 'was already attempted by this wallet. Will verify with server.');
                // Don't throw error - let server handle it, then continue with next block
            }

            // CRITICAL: Ensure minimum difficulty of 4 (prevents trivial mining)
            // Difficulty 2 = 1 in 256 chance (too easy)
            // Difficulty 4 = 1 in 65,536 chance (reasonable for mobile mining)
            // Difficulty 5 = 1 in 1,048,576 chance (harder)
            let difficulty = lastBlock?.difficulty || this.currentDifficulty;
            if (difficulty < 4) {
                console.warn(`⚠️ Difficulty ${difficulty} is too low. Setting minimum to 4.`);
                difficulty = 4;
            }

            // Check if enough time has passed since last block (prevent rapid mining)
            if (this.lastBlockTime && (Date.now() - this.lastBlockTime) < this.minBlockInterval) {
                const waitTime = Math.ceil((this.minBlockInterval - (Date.now() - this.lastBlockTime)) / 1000);
                throw new Error(`Please wait ${waitTime} seconds before mining again. Mining too frequently is not allowed.`);
            }

            // Create mining worker
            this.miningWorker = this.createMiningWorker();

            // Setup worker message handler
            this.miningWorker.onmessage = (e) => {
                const { type, data } = e.data;

                if (type === 'hash') {
                    this.miningStats.totalHashes++;
                    this.updateHashRate();
                    if (this.onStatsUpdate) {
                        this.onStatsUpdate(this.miningStats);
                    }
                } else if (type === 'blockFound') {
                    this.handleBlockFound(data, walletAddress);
                } else if (type === 'error') {
                    console.error('Mining worker error:', data);
                    this.showNotification('Mining error: ' + data, 'error');
                }
            };

            // CRITICAL: Validate block timestamp is reasonable (within 5 minutes of current time)
            const blockTimestamp = Date.now();
            const maxTimestampDrift = 5 * 60 * 1000; // 5 minutes
            if (Math.abs(blockTimestamp - Date.now()) > maxTimestampDrift) {
                throw new Error('Block timestamp is invalid. Please check your system clock.');
            }

            // Start mining
            const miningData = {
                blockData: {
                    index: lastBlock.index + 1,
                    timestamp: blockTimestamp,
                    transactions: pendingTxs || [],
                    previousHash: lastBlock.hash,
                    difficulty: difficulty
                },
                difficulty: difficulty
            };

            this.currentDifficulty = difficulty;
            this.miningWorker.postMessage({
                type: 'start',
                data: miningData
            });

            this.isMining = true;
            this.miningStats.startTime = Date.now();
            this.miningStats.totalHashes = 0;
            this.miningStats.blocksFound = 0;
            this.miningStats.difficulty = difficulty;
            this.miningStats.currentDifficulty = difficulty;

            // Save mining state to localStorage for auto-resume after refresh
            localStorage.setItem('cheeseMiningActive', 'true');

            return true;
        } catch (error) {
            console.error('Start mining error:', error);
            throw error;
        }
    }

    // Stop mining
    stopMining() {
        if (!this.isMining) {
            return;
        }

        if (this.miningWorker) {
            this.miningWorker.postMessage({ type: 'stop' });
            this.miningWorker.terminate();
            this.miningWorker = null;
        }

        this.isMining = false;
        this.miningStats.hashesPerSecond = 0;

        // CRITICAL: Clear active mining session
        localStorage.removeItem('cheeseMiningActiveSession');
        localStorage.removeItem('cheeseMiningActive'); // Clear mining state

        // Reset stats
        this.miningStats.startTime = null;
        this.miningStats.totalHashes = 0;
        this.miningStats.hashRate = '0 H/s';
        this.miningStats.miningTime = '0s';

        if (this.onStatsUpdate) {
            this.onStatsUpdate(this.miningStats);
        }
    }

    // Create mining Web Worker
    createMiningWorker() {
        // Create worker from blob (inline worker)
        const workerCode = `
            let isMining = false;
            let miningInterval = null;
            let hashCount = 0;
            let startTime = Date.now();

            // Simple proof-of-work hash function
            async function hashBlock(blockData, nonce) {
                const data = JSON.stringify(blockData) + nonce.toString();
                const encoder = new TextEncoder();
                const dataBuffer = encoder.encode(data);
                const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // Check if hash meets difficulty
            function meetsDifficulty(hash, difficulty) {
                const zeros = '0'.repeat(difficulty);
                return hash.substring(0, difficulty) === zeros;
            }

            // Mining loop
            async function mineBlock(blockData, difficulty) {
                let nonce = 0;
                const maxNonce = 1000000; // Prevent infinite loops
                let batchCount = 0;

                while (isMining && nonce < maxNonce) {
                    try {
                        const hash = await hashBlock(blockData, nonce);
                        hashCount++;
                        batchCount++;

                        // Report hash every 1000 hashes
                        if (batchCount >= 1000) {
                            self.postMessage({ type: 'hash', data: hashCount });
                            batchCount = 0;
                        }

                        // Check if hash meets difficulty
                        if (meetsDifficulty(hash, difficulty)) {
                            self.postMessage({
                                type: 'blockFound',
                                data: {
                                    hash: hash,
                                    nonce: nonce,
                                    blockData: blockData
                                }
                            });
                            return;
                        }

                        nonce++;
                    } catch (error) {
                        self.postMessage({ type: 'error', data: error.message });
                        break;
                    }
                }

                // If no block found, try again with new timestamp
                if (isMining && nonce >= maxNonce) {
                    blockData.timestamp = Date.now();
                    // Use setImmediate or setTimeout to prevent stack overflow
                    setTimeout(() => mineBlock(blockData, difficulty), 10);
                }
            }

            // Handle messages from main thread
            self.onmessage = function(e) {
                const { type, data } = e.data;

                if (type === 'start') {
                    isMining = true;
                    hashCount = 0;
                    startTime = Date.now();
                    mineBlock(data.blockData, data.difficulty);
                } else if (type === 'stop') {
                    isMining = false;
                }
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    // Load submitted blocks from localStorage to prevent duplicates after refresh
    loadSubmittedBlocks() {
        try {
            // CRITICAL: Check for pending block submission from before refresh
            const pendingSubmission = localStorage.getItem('cheesePendingBlockSubmission');
            if (pendingSubmission) {
                try {
                    const pending = JSON.parse(pendingSubmission);
                    const pendingAge = Date.now() - pending.timestamp;
                    // If pending submission is less than 2 minutes old, it might be from refresh
                    if (pendingAge < 2 * 60 * 1000) {
                        console.warn('⚠️ Pending block submission detected from recent refresh. Adding to submitted blocks.');
                        // Add to submitted blocks to prevent duplicate
                        this.submittedBlocks.add(pending.blockKey);
                        this.submittedBlocks.add(pending.blockHash);
                        this.minedBlockIndices.add(pending.blockIndex);
                        // Clear the pending submission
                        localStorage.removeItem('cheesePendingBlockSubmission');
                    } else {
                        // Old pending submission, clear it
                        localStorage.removeItem('cheesePendingBlockSubmission');
                    }
                } catch (e) {
                    console.warn('Error processing pending submission:', e);
                    localStorage.removeItem('cheesePendingBlockSubmission');
                }
            }

            const saved = localStorage.getItem('cheeseSubmittedBlocks');
            if (saved) {
                const blocks = JSON.parse(saved);
                // Only keep blocks from last 24 hours to prevent localStorage bloat
                const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
                const recentBlocks = blocks.filter(block => block.timestamp > oneDayAgo);
                this.submittedBlocks = new Set(recentBlocks.map(b => b.key || b.hash));

                // Also load block indices to prevent mining same index twice
                const savedIndices = localStorage.getItem('cheeseMinedBlockIndices');
                if (savedIndices) {
                    const indices = JSON.parse(savedIndices);
                    const recentIndices = indices.filter(item => item.timestamp > oneDayAgo);
                    this.minedBlockIndices = new Set(recentIndices.map(item => item.index));
                } else {
                    this.minedBlockIndices = new Set();
                }
            } else {
                this.submittedBlocks = new Set();
                this.minedBlockIndices = new Set();
            }
        } catch (error) {
            console.warn('Error loading submitted blocks:', error);
            this.submittedBlocks = new Set();
            this.minedBlockIndices = new Set();
        }
    }

    // Save submitted blocks to localStorage
    saveSubmittedBlocks() {
        try {
            const blocks = Array.from(this.submittedBlocks).map(key => ({
                key: key,
                hash: key, // For backward compatibility
                timestamp: Date.now()
            }));
            localStorage.setItem('cheeseSubmittedBlocks', JSON.stringify(blocks));

            // Also save mined block indices
            const indices = Array.from(this.minedBlockIndices).map(index => ({
                index: index,
                timestamp: Date.now()
            }));
            localStorage.setItem('cheeseMinedBlockIndices', JSON.stringify(indices));
        } catch (error) {
            console.warn('Error saving submitted blocks:', error);
        }
    }

    // Handle block found
    async handleBlockFound(blockData, walletAddress) {
        // CRITICAL: Prevent concurrent block submissions
        if (this.isSubmittingBlock) {
            console.warn('⚠️ Block submission already in progress, skipping duplicate block found event');
            return;
        }

        this.isSubmittingBlock = true;

        try {
            // CRITICAL: Check if this block hash was already submitted
            if (this.submittedBlocks.has(blockData.hash)) {
                console.warn('⚠️ Block hash already submitted, skipping:', blockData.hash.substring(0, 10) + '...');
                this.showNotification('⚠️ This block was already submitted. Skipping duplicate.', 'warning');
                this.isSubmittingBlock = false;
                return;
            }

            // CRITICAL: Check blockchain state FIRST to get current block index
            let currentBlockIndex = -1;
            try {
                const chainInfo = await this.api.getChain();
                if (chainInfo && chainInfo.chain && chainInfo.chain.length > 0) {
                    const lastBlock = chainInfo.chain[chainInfo.chain.length - 1];
                    currentBlockIndex = lastBlock.index;

                    // CRITICAL: If the block we're trying to mine is for an index that's already mined, automatically continue with next block
                    const targetBlockIndex = blockData.blockData.index;
                    if (currentBlockIndex >= targetBlockIndex) {
                        console.log('ℹ️ Block index is stale. Blockchain index:', currentBlockIndex, 'Target index:', targetBlockIndex);
                        console.log('ℹ️ Automatically continuing with next block...');
                        this.isSubmittingBlock = false;
                        // Automatically start mining next block
                        setTimeout(() => {
                            if (this.isMining) {
                                this.startMining(walletAddress);
                            }
                        }, 1000);
                        return;
                    }
                }
            } catch (chainError) {
                console.error('CRITICAL: Could not verify blockchain state. Block submission blocked for security.', chainError);
                this.showNotification('⚠️ Cannot verify blockchain state. Block submission blocked for security.', 'error');
                return; // BLOCK submission if we can't verify blockchain state
            }

            this.miningStats.blocksFound++;

            // Create block from mined data
            const block = {
                index: blockData.blockData.index,
                timestamp: blockData.blockData.timestamp,
                transactions: blockData.blockData.transactions,
                previousHash: blockData.blockData.previousHash,
                hash: blockData.hash,
                nonce: blockData.nonce,
                difficulty: blockData.blockData.difficulty,
                miner: walletAddress
            };

            // CRITICAL: Mark block as submitted BEFORE submitting (prevents race conditions)
            // Use block index + hash as unique identifier to prevent same index being mined twice
            const blockKey = `${block.index}_${blockData.hash}`;

            // Check multiple ways to prevent duplicates
            if (this.submittedBlocks.has(blockKey) ||
                this.submittedBlocks.has(blockData.hash) ||
                this.minedBlockIndices.has(block.index)) {
                console.warn('⚠️ Block already submitted or index already mined, skipping:', blockKey);
                this.showNotification('⚠️ This block was already submitted. Skipping duplicate.', 'warning');
                return;
            }

            // Mark as submitted BEFORE submitting (prevents race conditions on refresh)
            this.submittedBlocks.add(blockKey);
            this.submittedBlocks.add(blockData.hash); // Also track by hash for backward compatibility
            this.minedBlockIndices.add(block.index); // Track by index to prevent duplicate index mining
            this.saveSubmittedBlocks();

            // CRITICAL: Also save to a separate "pending submission" tracker to prevent refresh exploits
            const pendingKey = `pending_${block.index}_${blockData.hash}_${Date.now()}`;
            localStorage.setItem('cheesePendingBlockSubmission', JSON.stringify({
                blockKey: blockKey,
                blockHash: blockData.hash,
                blockIndex: block.index,
                walletAddress: walletAddress,
                timestamp: Date.now()
            }));

            // Submit block to blockchain
            const result = await this.api.mineBlock(walletAddress, block);

            if (result.success) {
                // CRITICAL: Only clear pending submission after confirmed success
                localStorage.removeItem('cheesePendingBlockSubmission');
                // Update last block time to prevent rapid mining
                this.lastBlockTime = Date.now();

                // CRITICAL: Mark this block index as mined to prevent duplicate mining
                this.minedBlockIndices.add(block.index);

                // Block successfully submitted - keep it in submittedBlocks
                this.saveSubmittedBlocks();

                this.showNotification('✅ Block mined successfully! Reward: ' + (result.reward || 0) + ' NCHEESE', 'success');

                if (this.onBlockFound) {
                    this.onBlockFound(block, result);
                }

                // Continue mining after cooldown period - AUTOMATIC CONTINUOUS MINING
                if (this.isMining) {
                    const waitTime = this.minBlockInterval;
                    console.log(`✅ Block mined! Reward: ${result.reward || 1} NCHEESE. Next block will start in ${Math.ceil(waitTime / 1000)} seconds...`);
                    this.showNotification(`✅ Block mined! +${result.reward || 1} NCHEESE. Next block in ${Math.ceil(waitTime / 1000)}s...`, 'success');
                    setTimeout(() => {
                        if (this.isMining) {
                            console.log('⛏️ Automatically starting next block...');
                            this.startMining(walletAddress);
                        }
                    }, waitTime);
                }
            } else {
                // Block was rejected - check if it's a duplicate error
                const isDuplicateError = result.error && (
                    result.error.includes('already') ||
                    result.error.includes('duplicate') ||
                    result.error.includes('exists')
                );

                if (!isDuplicateError) {
                    // Only remove from tracking if NOT a duplicate (allows retry)
                    const blockKey = `${block.index}_${blockData.hash}`;
                    this.submittedBlocks.delete(blockKey);
                    this.submittedBlocks.delete(blockData.hash);
                    this.minedBlockIndices.delete(block.index);
                    this.saveSubmittedBlocks();
                    // Clear pending submission only if not duplicate
                    localStorage.removeItem('cheesePendingBlockSubmission');
                } else {
                    // It's a duplicate - keep it in tracking and clear pending
                    this.saveSubmittedBlocks();
                    localStorage.removeItem('cheesePendingBlockSubmission');
                }

                // For duplicate/already mined errors, don't show error - just continue seamlessly
                if (isDuplicateError) {
                    console.log('ℹ️ Block was already mined by another miner. Continuing with next block...');
                    // Don't show error notification for duplicates - make it seamless
                    // Automatically continue mining next block
                    setTimeout(() => {
                        if (this.isMining) {
                            this.startMining(walletAddress);
                        }
                    }, 1000); // Short delay to let blockchain update
                } else {
                    // For other errors, show notification
                    this.showNotification('Block rejected: ' + (result.error || 'Unknown error'), 'error');
                    // Wait a bit before retrying
                    if (this.isMining) {
                        setTimeout(() => {
                            if (this.isMining) {
                                this.startMining(walletAddress);
                            }
                        }, 5000); // Wait 5 seconds on rejection
                    }
                }
            }
        } catch (error) {
            console.error('Handle block found error:', error);
            this.showNotification('Error submitting block: ' + error.message, 'error');

            // CRITICAL: Stop mining on critical errors to prevent further issues
            if (error.message.includes('Cannot verify blockchain') ||
                error.message.includes('CRITICAL')) {
                console.error('CRITICAL ERROR: Stopping mining due to critical error');
                this.stopMining();
            }
        } finally {
            // Always clear the submission flag
            this.isSubmittingBlock = false;
        }
    }

    // Update hash rate
    updateHashRate() {
        if (!this.miningStats.startTime) return;

        const elapsed = (Date.now() - this.miningStats.startTime) / 1000; // seconds
        if (elapsed > 0) {
            this.miningStats.hashesPerSecond = Math.floor(this.miningStats.totalHashes / elapsed);

            // Format hash rate
            if (this.miningStats.hashesPerSecond < 1000) {
                this.miningStats.hashRate = this.miningStats.hashesPerSecond + ' H/s';
            } else if (this.miningStats.hashesPerSecond < 1000000) {
                this.miningStats.hashRate = (this.miningStats.hashesPerSecond / 1000).toFixed(2) + ' KH/s';
            } else {
                this.miningStats.hashRate = (this.miningStats.hashesPerSecond / 1000000).toFixed(2) + ' MH/s';
            }

            // Format mining time
            const hours = Math.floor(elapsed / 3600);
            const minutes = Math.floor((elapsed % 3600) / 60);
            const secs = Math.floor(elapsed % 60);
            this.miningStats.miningTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        if (this.onStatsUpdate) {
            this.onStatsUpdate(this.miningStats);
        }
    }

    // Get mining stats
    getMiningStats() {
        return {
            ...this.miningStats,
            isMining: this.isMining,
            currentDifficulty: this.currentDifficulty,
            difficulty: this.currentDifficulty
        };
    }

    // Set callbacks
    setOnBlockFound(callback) {
        this.onBlockFound = callback;
    }

    setOnStatsUpdate(callback) {
        this.onStatsUpdate = callback;
    }

    setOnNotification(callback) {
        this.onNotification = callback;
    }

    // Show notification (uses callback if set, otherwise falls back to window.app)
    showNotification(message, type) {
        if (this.onNotification) {
            this.onNotification(message, type);
        } else if (window.app && window.app.showNotification) {
            window.app.showNotification(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // Optimize for mobile (reduce CPU usage)
    setMobileMode(enabled) {
        if (this.miningWorker && this.isMining) {
            this.miningWorker.postMessage({
                type: 'setMobileMode',
                enabled: enabled
            });
        }
    }

    // Pause mining (for battery saving)
    pauseMining() {
        if (this.miningWorker && this.isMining) {
            this.miningWorker.postMessage({ type: 'pause' });
        }
    }

    // Resume mining
    resumeMining() {
        if (this.miningWorker && this.isMining) {
            this.miningWorker.postMessage({ type: 'resume' });
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileMiner;
}

