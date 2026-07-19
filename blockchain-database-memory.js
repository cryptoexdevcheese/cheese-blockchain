/**
 * In-Memory Blockchain Database
 * Fallback when Firestore is not available
 * WARNING: Data is lost on server restart!
 */

class BlockchainDatabaseMemory {
    constructor() {
        this.blocks = [];
        this.transactions = new Map();
        this.pendingTransactions = [];
        this.smartContracts = [];
        this.minerBlockHistory = [];
        this.miningRegistrations = new Map();
        this.initialized = false;
    }

    async initialize() {
        console.log('⚠️ Using IN-MEMORY database - data will be LOST on restart!');
        this.initialized = true;
        return true;
    }

    async saveBlock(block) {
        const existing = this.blocks.findIndex(b => b.index === block.index);
        if (existing >= 0) {
            this.blocks[existing] = block;
        } else {
            this.blocks.push(block);
        }
        return block;
    }

    async getAllBlocks(skipTransactions = false) {
        return this.blocks.sort((a, b) => a.index - b.index);
    }

    async getTransaction(idOrHash) {
        if (!idOrHash) return null;
        const q = String(idOrHash).trim().toLowerCase();
        
        // Scan memory blocks for matching transaction
        for (const block of this.blocks) {
            const found = (block.transactions || []).find(tx => {
                const txId = (tx.id || '').toLowerCase();
                const txHash = (tx.hash || '').toLowerCase();
                const docHash = (tx.data?.hash || '').toLowerCase();
                const ethHash = (tx.data?.eth_hash || '').toLowerCase();
                const dataTxHash = (tx.data?.txHash || '').toLowerCase();
                return txId === q || txHash === q || docHash === q || ethHash === q || dataTxHash === q;
            });
            if (found) return found;
        }
        return null;
    }

    async getBlock(index) {
        return this.blocks.find(b => b.index === index);
    }

    async deleteBlock(index) {
        this.blocks = this.blocks.filter(b => b.index !== index);
        return true;
    }

    async saveTransaction(tx, blockIndex = null) {
        const key = tx.id || `tx-${Date.now()}-${Math.random()}`;
        this.transactions.set(key, { ...tx, blockIndex });
        return tx;
    }

    async getTransactionsByBlock(blockIndex) {
        const txs = [];
        this.transactions.forEach((tx, key) => {
            if (tx.blockIndex === blockIndex) {
                txs.push(tx);
            }
        });
        return txs;
    }

    async getTransactionHistory(address) {
        const txs = [];
        this.transactions.forEach((tx) => {
            if (tx.from === address || tx.to === address) {
                txs.push(tx);
            }
        });
        return txs;
    }

    async getPendingTransactions() {
        return this.pendingTransactions;
    }

    async clearPendingTransactions() {
        this.pendingTransactions = [];
        return true;
    }

    async saveSmartContract(contract) {
        this.smartContracts.push(contract);
        return contract;
    }

    async getAllSmartContracts() {
        return this.smartContracts;
    }

    async getMinerBlockHistory() {
        return this.minerBlockHistory;
    }

    async saveMinerBlockHistory(record) {
        this.minerBlockHistory.push(record);
        return record;
    }

    // ==================== MINING REGISTRATION OPERATIONS ====================

    async saveMiningRegistration(registration) {
        const key = registration.walletAddress.toLowerCase();
        this.miningRegistrations.set(key, registration);
        return registration;
    }

    async getMiningRegistration(walletAddress, deviceId = null) {
        const key = walletAddress.toLowerCase();
        let registration = this.miningRegistrations.get(key);

        if (!registration && deviceId) {
            // Check by device ID
            for (const reg of this.miningRegistrations.values()) {
                if (reg.deviceId === deviceId) {
                    registration = reg;
                    break;
                }
            }
        }

        return registration;
    }

    async getAllMiningRegistrations() {
        return Array.from(this.miningRegistrations.values());
    }

    async close() {
        console.log('🔒 In-memory database closed');
    }
}

module.exports = BlockchainDatabaseMemory;
