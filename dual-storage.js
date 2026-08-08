/**
 * 🧀 CHEESE BLOCKCHAIN - DUAL STORAGE ADAPTER
 * Hybrid Storage: Writes to BOTH Local SQLite (Primary/Sovereign) AND Cloud Firestore (Backup/Global)
 */

class DualStorage {
    constructor(localDB, cloudDB) {
        this.local = localDB;
        this.cloud = cloudDB;
        this.listeners = []; // Track Firebase listeners
        this.realtimeSyncEnabled = false;
        this.isSyncing = false;
        console.log('⚔️ DualStorage initialized: Hybrid-Priority with SQLite Master for Height');
    }

    async initialize() {
        console.log('🔄 Initializing Dual Storage...');
        let localReady = false;
        let cloudReady = false;

        try {
            await this.local.initialize();
            console.log('✅ Local SQLite Ready');
            localReady = true;
        } catch (e) {
            console.error('❌ Local DB Init Failed:', e.message);
        }

        try {
            await this.cloud.initialize();
            console.log('✅ Cloud Firestore Ready');
            cloudReady = true;
        } catch (e) {
            console.warn('⚠️ Cloud DB Init Failed (Proceeding with Local Only):', e.message);
        }

        if (!localReady && !cloudReady) {
            throw new Error('BOTH Local and Cloud storage failed to initialize!');
        }

        // AUTO-SYNC: Mirror Cloud (Standard) to Local (Sovereign)
        if (localReady && cloudReady) {
            // [OPTIMIZATION] Perform sync in background to prevent API timeout
            this.sync().catch(e => console.error('Background Sync Error:', e.message));
            // Enable real-time Firebase → SQLite sync
            await this.enableRealtimeSync();
        }

        return true;
    }

    /**
     * SYNC: Decentralization Enforcement
     * Ensures Local DB matches Cloud Standard
     */
    async sync() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        const BATCH_LIMIT = 500;
        let syncedCount = 0;
        
        console.log('🔄 STARTING MASTER SYNC (Local <-> Cloud)...');
        try {
            while (true) {
                // 1. Get current heights
                const localHead = await this.local.getLatestBlock();
                const cloudHead = await this.cloud.getLatestBlock();

                const localIdx = localHead ? localHead.index : -1;
                const cloudIdx = cloudHead ? cloudHead.index : -1;

                console.log(`📊 Chain Height: Local Master=${localIdx} | Cloud Mirror=${cloudIdx}`);

                // CASE A: Local Master is behind Cloud Mirror (Recovery)
                if (cloudIdx > localIdx) {
                    const start = localIdx + 1;
                    const end = Math.min(cloudIdx, localIdx + BATCH_LIMIT);
                    
                    console.warn(`📡 [RECOVERY] Syncing blocks ${start} to ${end} (Cloud: ${cloudIdx})...`);
                    
                    for (let i = start; i <= end; i++) {
                        process.stdout.write(`\r⬇️ [Sync] Processing block ${i}/${cloudIdx}...`);
                        const block = await this.cloud.getBlock(i);
                        if (block) {
                            if (block.blockIndex !== undefined && block.index === undefined) {
                                block.index = block.blockIndex;
                            }
                            if (block.index === undefined) block.index = i;
                            
                            await this.local.saveBlock(block, true);
                            
                            const txs = await this.cloud.getTransactionsByBlock(i);
                            if (txs && txs.length > 0) {
                                for (const tx of txs) {
                                    await this.local.saveTransaction(tx, i);
                                }
                            }
                            syncedCount++;
                        }
                    }
                    console.log('\n✅ Recovery Batch Complete.');
                    if (this.local.saveToDisk) this.local.saveToDisk();
                    
                    // Continue loop to check if more blocks are needed
                    continue;
                }

                // CASE B: Cloud Mirror is behind Local Master (Upload)
                if (localIdx > cloudIdx) {
                    const UPLOAD_BATCH = 100;
                    const start = cloudIdx + 1;
                    const end = Math.min(localIdx, cloudIdx + UPLOAD_BATCH);
                    
                    console.log(`⬆️ Cloud Mirror is behind! Pushing blocks ${start} to ${end} (Total gap: ${localIdx - cloudIdx})...`);
                    
                    for (let i = start; i <= end; i++) {
                        process.stdout.write(`\r⬆️ Pushing Block ${i}/${localIdx}...`);
                        try {
                            const block = await this.local.getBlock(i);
                            if (block) {
                                const txs = await this.local.getTransactionsByBlock(i);
                                block.transactions = txs || [];
                                
                                await Promise.race([
                                    this.cloud.saveBlock(block),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error('Push Timeout')), 10000))
                                ]);
                                syncedCount++;
                            }
                        } catch (err) {
                            console.error(`\n❌ Failed to push block ${i}:`, err.message);
                            break;
                        }
                    }
                    console.log('\n✅ Upload Batch Complete.');
                    
                    // Continue loop to check if more blocks are needed
                    continue;
                }

                // CASE C: Fully Syncronized
                console.log('✅ Ecosystem is fully synchronized.');
                break;
            }
        } catch (e) {
            console.error('❌ Sync Failed:', e.message);
        } finally {
            this.isSyncing = false;
        }
    }

    // Helper to run dual operations
    async #dualWrite(method, ...args) {
        let localPromise = null;
        let cloudPromise = null;

        // 1. Write Local (Sovereign) - Critical
        if (this.local && typeof this.local[method] === 'function') {
            localPromise = this.local[method](...args).catch(e => {
                console.error(`❌ Local Write Error (${method}):`, e.message);
                return null;
            });
        }

        // 2. Write Cloud (Global) - Best Effort
        if (this.cloud && typeof this.cloud[method] === 'function') {
            cloudPromise = this.cloud[method](...args).catch(e => {
                console.warn(`⚠️ Cloud Write Error (${method}):`, e.message);
                return null;
            });
        }

        const [localRes, cloudRes] = await Promise.all([localPromise, cloudPromise]);

        // Return local result if available (sovereign truth), else cloud
        return localRes || cloudRes;
    }

    /**
     * NEW: Enable Real-Time Firebase → SQLite Sync
     */
    async enableRealtimeSync() {
        if (!this.cloud || !this.cloud.db) {
            console.warn('⚠️ Cloud DB not available, real-time sync disabled');
            return;
        }

        console.log('🔄 Enabling real-time Firebase → SQLite sync...');

        try {
            // Listen for block changes
            const collectionName = this.cloud.collections ? this.cloud.collections.blocks : 'cheese-blockchain-blocks';
            console.log(`📡 Real-time sync listening on: ${collectionName}`);
            
            const blocksListener = this.cloud.db
                .collection(collectionName)
                .onSnapshot(snapshot => {
                    snapshot.docChanges().forEach(async change => {
                        if (change.type === 'modified' || change.type === 'added') {
                            const block = change.doc.data();
                            try {
                                // Ensure property compatibility for local storage
                                if (block.blockIndex !== undefined && block.index === undefined) {
                                    block.index = block.blockIndex;
                                }
                                if (block.index === undefined) return;

                                await this.local.saveBlock(block, true);
                                if (this.local.saveToDisk) this.local.saveToDisk();
                                console.log(`✨ [REALTIME] Synced Block ${block.index} from Cloud to Local`);
                            } catch (err) {
                                console.warn(`⚠️ [REALTIME] Failed to sync block ${block.index}:`, err.message);
                            }
                        }
                    });
                }, err => {
                    console.error('❌ Firestore Listener Error:', err.message);
                });

            this.listeners.push(blocksListener);
        } catch (error) {
            console.error('❌ Failed to enable real-time sync:', error.message);
        }
    }

    // Helper for reads: Flexible Priority
    async #dualRead(method, priority = 'cloud', ...args) {
        if (priority === 'local') {
            return this.#readLocalFirst(method, ...args);
        }
        return this.#readCloudFirst(method, ...args);
    }

    async #readCloudFirst(method, ...args) {
        let res = null;
        // PRIORITY 1: Try Cloud (Firebase)
        if (this.cloud && typeof this.cloud[method] === 'function') {
            try {
                res = await this.cloud[method](...args);
                if (res) return res;
            } catch (e) {
                console.warn(`⚠️ Cloud read failed (${method}): ${e.message}`);
            }
        }
        // PRIORITY 2: Fallback to Local (SQLite)
        if (this.local && typeof this.local[method] === 'function') {
            try {
                res = await this.local[method](...args);
                return res;
            } catch (e) {
                console.warn(`⚠️ Local fallback failed (${method}): ${e.message}`);
            }
        }
        return res;
    }

    async #readLocalFirst(method, ...args) {
        let res = null;
        // PRIORITY 1: Try Local (SQLite)
        if (this.local && typeof this.local[method] === 'function') {
            try {
                res = await this.local[method](...args);
                if (res) return res;
            } catch (e) {
                console.warn(`⚠️ Local master read failed (${method}): ${e.message}`);
            }
        }
        // PRIORITY 2: Fallback to Cloud (Firebase)
        if (this.cloud && typeof this.cloud[method] === 'function') {
            try {
                res = await this.cloud[method](...args);
                return res;
            } catch (e) {
                console.warn(`⚠️ Cloud fallback failed (${method}): ${e.message}`);
            }
        }
        return res;
    }

    // ==================== INTERFACE IMPLEMENTATION ====================

    async saveBlock(block) { return this.#dualWrite('saveBlock', block); }
    async deleteBlock(index) { return this.#dualWrite('deleteBlock', index); }
    async getBlock(index) { return this.#dualRead('getBlock', 'local', index); }
    async getAllBlocks(skipTransactions = false) { return this.#dualRead('getAllBlocks', 'local', skipTransactions); }
    async getLatestBlock() { return this.#dualRead('getLatestBlock', 'local'); }
    async getTransaction(idOrHash) { return this.#dualRead('getTransaction', 'local', idOrHash); }

    async saveTransaction(tx, blockIndex) { return this.#dualWrite('saveTransaction', tx, blockIndex); }
    async getTransactionsByBlock(index) { return this.#dualRead('getTransactionsByBlock', 'local', index); }
    async getPendingTransactions() { return this.#dualRead('getPendingTransactions', 'local'); }
    async clearPendingTransactions() { return this.#dualWrite('clearPendingTransactions'); }
    async getAllTransactions() { return this.#dualRead('getAllTransactions', 'local'); }
    async getTransactionHistory(address) {
        if (!address) return [];

        console.log(`🔍 [DualRead] getTransactionHistory for ${address.substring(0, 10)}...`);

        // Strategy: Merge both for maximum truth (Sovereignty + Cloud)
        let cloudHistory = [];
        let localHistory = [];

        if (this.cloud && typeof this.cloud.getTransactionHistory === 'function') {
            try { cloudHistory = await this.cloud.getTransactionHistory(address) || []; } catch (e) {
                console.warn('⚠️ DualRead: Cloud history read failed');
            }
        }

        if (this.local && typeof this.local.getTransactionHistory === 'function') {
            try { localHistory = await this.local.getTransactionHistory(address) || []; } catch (e) {
                console.warn('⚠️ DualRead: Local history read failed');
            }
        }

        // Merge and deduplicate by ID
        const txMap = new Map();
        [...cloudHistory, ...localHistory].forEach(tx => {
            if (tx && tx.id) txMap.set(tx.id, tx);
        });

        const merged = Array.from(txMap.values())
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        console.log(`✅ [DualRead] Returned ${merged.length} merged transactions`);
        return merged;
    }

    async saveWallet(wallet) { return this.#dualWrite('saveWallet', wallet); }
    async getWallet(address) { return this.#dualRead('getWallet', address); }

    async saveSmartContract(contract) { return this.#dualWrite('saveSmartContract', contract); }
    async getSmartContract(address) { return this.#dualRead('getSmartContract', address); }
    async getAllSmartContracts() { return this.#dualRead('getAllSmartContracts'); }

    async saveNode(node) { return this.#dualWrite('saveNode', node); }
    async getAllNodes() { return this.#dualRead('getAllNodes'); }

    async saveAnalytics(type, data) { return this.#dualWrite('saveAnalytics', type, data); }
    async backup() { return this.#dualWrite('backup'); }

    // Mining/Referral/History (Might not exist in SQLite, check existence)
    async saveMinerBlockHistory(...args) { return this.#dualWrite('saveMinerBlockHistory', ...args); }
    async getMinerBlockHistory(...args) { return this.#dualRead('getMinerBlockHistory', ...args); }

    async saveMiningRegistration(...args) { return this.#dualWrite('saveMiningRegistration', ...args); }
    async getMiningRegistration(...args) { return this.#dualRead('getMiningRegistration', ...args); }
    async getAllMiningRegistrations(...args) { return this.#dualRead('getAllMiningRegistrations', ...args); }

    async saveReferral(...args) { return this.#dualWrite('saveReferral', ...args); }
    async getReferralsByIP(...args) { return this.#dualRead('getReferralsByIP', ...args); }
    async getReferralCount(...args) { return this.#dualRead('getReferralCount', ...args); }

    async close() {
        console.log('🔌 Closing DualStorage...');

        // Unsubscribe from Firebase listeners
        if (this.listeners.length > 0) {
            console.log(`Unsubscribing from ${this.listeners.length} Firebase listeners...`);
            this.listeners.forEach(unsubscribe => unsubscribe());
            this.listeners = [];
            console.log('✅ Real-time sync disabled');
        }

        if (this.local && this.local.close) await this.local.close();
    }
}

module.exports = DualStorage;
