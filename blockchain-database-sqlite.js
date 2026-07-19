/**
 * 🧀 CHEESE BLOCKCHAIN - SQLITE DATABASE LAYER
 * Local persistent storage using sql.js (pure JavaScript SQLite)
 * FALLBACK when Firestore is unavailable - DATA PERSISTS LOCALLY!
 * 
 * This implements the SAME interface as BlockchainDatabaseFirestore
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

class BlockchainDatabaseSQLite {
    constructor(dbPath) {
        // PRIORITY ORDER for DB path:
        // 1. Explicit constructor argument (highest priority)
        // 2. DB_PATH environment variable
        // 3. Railway auto-detect → /app/data/cheese-blockchain.db (persistent volume)
        // 4. Local fallback → ./cheese-blockchain.db
        if (dbPath) {
            this.dbPath = dbPath;
        } else if (process.env.DB_PATH) {
            this.dbPath = process.env.DB_PATH;
        } else if (process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_NAME || process.env.RENDER) {
            this.dbPath = '/app/data/cheese-blockchain.db';
        } else {
            this.dbPath = './cheese-blockchain.db';
        }
        this.db = null;
        this.SQL = null;
        this.initialized = false;
        this.saveInterval = null;
        this.isDirty = false;
        this.saveTimeout = null;
        console.log(`💾 SQLite Database path resolved to: ${this.dbPath}`);
        console.log(`   DB_PATH env: ${process.env.DB_PATH || '(not set)'}`);
        console.log(`   Railway env: ${process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_NAME || '(not set)'}`);
    }

    async initialize() {
        try {
            // Initialize sql.js
            this.SQL = await initSqlJs();

            // Ensure directory exists
            const dir = path.dirname(this.dbPath);
            if (dir && dir !== '.' && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Load existing database or create new one
            if (fs.existsSync(this.dbPath)) {
                console.log('📂 Loading existing SQLite database...');
                const buffer = fs.readFileSync(this.dbPath);
                this.db = new this.SQL.Database(buffer);
            } else {
                console.log('📝 Creating new SQLite database...');
                this.db = new this.SQL.Database();
            }

            // Create tables if they don't exist
            this.createTables();

            // Auto-save every 60 seconds as a fallback
            this.saveInterval = setInterval(() => {
                if (this.isDirty) this.saveToDisk();
            }, 60000);

            this.initialized = true;
            console.log('✅ SQLite database connected and tables created');

            // Log existing data count
            const blockCount = this.db.exec('SELECT COUNT(*) as count FROM blocks')[0]?.values[0][0] || 0;
            const txCount = this.db.exec('SELECT COUNT(*) as count FROM transactions')[0]?.values[0][0] || 0;
            console.log(`📊 SQLite contains: ${blockCount} blocks, ${txCount} transactions`);

            return true;
        } catch (error) {
            console.error('❌ SQLite initialization failed:', error.message);
            throw error;
        }
    }

    /**
     * Request a disk save (Debounced)
     * Prevents I/O storm when many blocks are saved at once
     */
    requestSave() {
        this.isDirty = true;
        if (this.saveTimeout) return; // Wait for existing timeout

        this.saveTimeout = setTimeout(() => {
            this.saveToDisk();
            this.saveTimeout = null;
        }, 5000); // Save every 5 seconds maximum during high load
    }

    saveToDisk() {
        if (!this.db || !this.isDirty) return;
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
            this.isDirty = false;
            // console.log(`💾 Committed to disk (${buffer.length} bytes)`);
        } catch (error) {
            console.error('❌ SQLite save to disk failed:', error.message);
        }
    }

    createTables() {
        console.log('🛠️ CREATING SQLITE TABLES...');
        // Blocks table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS blocks (
                blockIndex INTEGER PRIMARY KEY,
                hash TEXT NOT NULL,
                previousHash TEXT,
                timestamp INTEGER,
                nonce INTEGER,
                difficulty INTEGER,
                data TEXT,
                createdAt INTEGER
            )
        `);

        // Transactions table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                fromAddress TEXT,
                toAddress TEXT,
                amount REAL,
                currency TEXT DEFAULT 'NCH',
                timestamp INTEGER,
                blockIndex INTEGER,
                signature TEXT,
                data TEXT,
                pending INTEGER DEFAULT 0,
                createdAt INTEGER
            )
        `);

        // Migration: Ensure currency column exists
        try {
            const tableInfo = this.db.exec('PRAGMA table_info(transactions)');
            const columns = tableInfo[0].values.map(v => v[1]);
            if (!columns.includes('currency')) {
                console.log('🔄 Migrating transactions table: adding currency column...');
                this.db.run('ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT "NCH"');
            }
        } catch (err) {
            console.warn('⚠️ Migration check failed (transactions):', err.message);
        }

        // Smart contracts table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS smart_contracts (
                address TEXT PRIMARY KEY,
                code TEXT,
                state TEXT,
                creator TEXT,
                createdAt INTEGER
            )
        `);

        // Wallets table (for caching)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS wallets (
                address TEXT PRIMARY KEY,
                data TEXT,
                updatedAt INTEGER
            )
        `);

        // Migration: Ensure data and updatedAt columns exist in wallets
        try {
            const tableInfo = this.db.exec('PRAGMA table_info(wallets)');
            const columns = tableInfo[0].values.map(v => v[1]);
            if (!columns.includes('data')) {
                console.log('🔄 Migrating wallets table: adding data column...');
                this.db.run('ALTER TABLE wallets ADD COLUMN data TEXT');
            }
            if (!columns.includes('updatedAt')) {
                console.log('🔄 Migrating wallets table: adding updatedAt column...');
                this.db.run('ALTER TABLE wallets ADD COLUMN updatedAt INTEGER');
            }
        } catch (err) {
            console.warn('⚠️ Migration check failed (wallets):', err.message);
        }

        // Miner block history table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS miner_block_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                minerAddress TEXT NOT NULL,
                blockIndex INTEGER NOT NULL,
                timestamp INTEGER,
                UNIQUE(minerAddress, blockIndex)
            )
        `);

        // Mining registrations table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS mining_registrations (
                walletAddress TEXT PRIMARY KEY,
                deviceId TEXT,
                bscTxHash TEXT,
                registeredAt INTEGER,
                status TEXT,
                referralCode TEXT,
                referrerAddress TEXT,
                referralProcessed INTEGER DEFAULT 0,
                referralRewardTxId TEXT,
                ipAddress TEXT
            )
        `);

        this.requestSave();
        console.log('✅ SQLite tables created/verified');
    }

    // ==================== BLOCK OPERATIONS ====================

    async saveBlock(block, skipSave = false) {
        // Robust index detection: Handle both .index and .blockIndex
        const actualIndex = block.index !== undefined ? block.index : (block.blockIndex !== undefined ? block.blockIndex : 0);

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO blocks (blockIndex, hash, previousHash, timestamp, nonce, difficulty, data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        try {
            stmt.run([
                actualIndex,
                block.hash || 'UNKNOWN',
                block.previousHash || '0',
                block.timestamp || Date.now(),
                block.nonce || 0,
                block.difficulty || 2,
                JSON.stringify({
                    transactions: block.transactions || [],
                    aiValidation: block.aiValidation || {},
                    ...block.data
                })
            ]);
            stmt.free();
        } catch (error) {
            console.error('❌ SQLite saveBlock failed:', error.message);
            console.error('Offending Block:', block.index, block.hash);
            stmt.free();
            throw error;
        }

        // Save transactions from block
        if (block.transactions && block.transactions.length > 0) {
            for (const tx of block.transactions) {
                await this.saveTransaction(tx, block.index);
            }
        }

        if (!skipSave) {
            this.requestSave();
            // Silence log spam for individual blocks to improve event loop performance
            // console.log(`💾 Block ${block.index} saved to SQLite`);
        }
        return block;
    }

    async deleteBlock(blockIndex) {
        this.db.run('DELETE FROM blocks WHERE blockIndex = ?', [blockIndex]);
        this.db.run('DELETE FROM transactions WHERE blockIndex = ?', [blockIndex]);
        this.requestSave();
        console.log(`🗑️ Block ${blockIndex} deleted from SQLite`);
        return true;
    }

    async getBlock(index) {
        if (index === undefined || index === null) return null;
        const result = this.db.exec('SELECT * FROM blocks WHERE blockIndex = ?', [index]);
        if (!result.length || !result[0].values.length) return null;

        const row = this.rowToObject(result[0]);
        const block = this.rowToBlock(row);
        block.transactions = await this.getTransactionsByBlock(index);
        return block;
    }

    async getAllBlocks(skipTransactions = false) {
        const result = this.db.exec('SELECT * FROM blocks ORDER BY blockIndex ASC');
        if (!result.length) return [];

        const blocks = [];
        for (const row of result[0].values) {
            const obj = this.rowToObjectFromArray(result[0].columns, row);
            const block = this.rowToBlock(obj);
            if (!skipTransactions) {
                block.transactions = await this.getTransactionsByBlock(block.index);
            } else {
                block.transactions = [];
            }
            if (block.index === 0) {
                console.log(`DB_DEBUG: Block 0 JSON: ${JSON.stringify(block)}`);
            }
            blocks.push(block);
        }

        return blocks;
    }

    async getTransaction(idOrHash) {
        if (!idOrHash) return null;
        const q = String(idOrHash).trim().toLowerCase();

        // 1. Direct ID/Hash lookups
        let result = this.db.exec('SELECT * FROM transactions WHERE LOWER(id) = ?', [q]);
        if (result.length && result[0].values.length) {
            return this.rowToTransaction(this.rowToObjectFromArray(result[0].columns, result[0].values[0]));
        }

        // 2. Scan fallback to match doc/EVM/data hashes
        const all = await this.getAllTransactions();
        return all.find(tx => {
            const txId = (tx.id || '').toLowerCase();
            const txHash = (tx.hash || '').toLowerCase();
            const docHash = (tx.data?.hash || '').toLowerCase();
            const ethHash = (tx.data?.eth_hash || '').toLowerCase();
            const dataTxHash = (tx.data?.txHash || '').toLowerCase();
            return txId === q || txHash === q || docHash === q || ethHash === q || dataTxHash === q;
        }) || null;
    }

    async getLatestBlock() {
        const result = this.db.exec('SELECT * FROM blocks ORDER BY blockIndex DESC LIMIT 1');
        if (!result.length || !result[0].values.length) return null;

        const row = this.rowToObjectFromArray(result[0].columns, result[0].values[0]);
        const block = this.rowToBlock(row);
        block.transactions = await this.getTransactionsByBlock(block.index);
        return block;
    }

    rowToObject(result) {
        if (!result.values.length) return null;
        return this.rowToObjectFromArray(result.columns, result.values[0]);
    }

    rowToObjectFromArray(columns, values) {
        const obj = {};
        columns.forEach((col, i) => obj[col] = values[i]);
        return obj;
    }

    rowToBlock(row) {
        let data = {};
        if (row.data) {
            try {
                data = JSON.parse(row.data);
            } catch (e) {
                // console.warn(`⚠️ Malformed block data at index ${row.blockIndex || row.idx}:`, e.message);
                data = { rawData: row.data };
            }
        }
        return {
            index: row.blockIndex !== undefined ? row.blockIndex : row.idx,
            hash: row.hash,
            previousHash: row.previousHash,
            timestamp: row.timestamp,
            nonce: row.nonce,
            difficulty: row.difficulty,
            transactions: data.transactions || [],
            aiValidation: data.aiValidation,
            ...data
        };
    }

    // ==================== TRANSACTION OPERATIONS ====================

    async transactionExists(id) {
        if (!id) return false;
        const result = this.db.exec('SELECT id FROM transactions WHERE id = ?', [id]);
        return result.length > 0 && result[0].values.length > 0;
    }

    async saveTransaction(transaction, blockIndex = null) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO transactions 
            (id, fromAddress, toAddress, amount, currency, timestamp, blockIndex, signature, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const txId = transaction.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        let actualBlockIndex = (blockIndex !== null && blockIndex !== undefined) ? blockIndex : (transaction.blockIndex !== undefined && transaction.blockIndex !== null ? transaction.blockIndex : null);
        if (actualBlockIndex === null && transaction.data && transaction.data.blockIndex !== undefined && transaction.data.blockIndex !== null) {
            actualBlockIndex = Number(transaction.data.blockIndex);
        }
        if (actualBlockIndex === null && (txId.startsWith('gen-') || txId.startsWith('v33-') || (transaction.data && transaction.data.type === 'premine'))) {
            actualBlockIndex = 0;
        }

        try {
            stmt.run([
                txId,
                transaction.from !== undefined ? transaction.from : null,
                transaction.to || 'UNKNOWN',
                transaction.amount !== undefined ? transaction.amount : 0,
                transaction.currency || (transaction.data && transaction.data.currency) || 'NCH',
                transaction.timestamp || Date.now(),
                actualBlockIndex,
                JSON.stringify(transaction.signature || {}),
                JSON.stringify(transaction.data || {})
            ]);
            stmt.free();
        } catch (error) {
            console.error('❌ SQLite saveTransaction failed:', error.message);
            console.error('Offending TX:', JSON.stringify({ ...transaction, id: txId }));
            stmt.free();
            throw error;
        }

        return { ...transaction, id: txId, blockIndex: actualBlockIndex };
    }

    async getPendingTransactions() {
        const result = this.db.exec('SELECT * FROM transactions WHERE blockIndex IS NULL');
        if (!result.length) return [];
        return result[0].values.map(row =>
            this.rowToTransaction(this.rowToObjectFromArray(result[0].columns, row))
        );
    }

    async clearPendingTransactions() {
        this.db.run('DELETE FROM transactions WHERE pending = 1');
        this.requestSave();
        return true;
    }

    async getTransactionsByBlock(blockIndex) {
        if (blockIndex === undefined || blockIndex === null) return [];
        const result = this.db.exec('SELECT * FROM transactions WHERE blockIndex = ?', [blockIndex]);
        if (!result.length) return [];
        return result[0].values.map(row =>
            this.rowToTransaction(this.rowToObjectFromArray(result[0].columns, row))
        );
    }

    async getAllTransactions() {
        const result = this.db.exec('SELECT * FROM transactions ORDER BY timestamp DESC');
        if (!result.length) return [];
        return result[0].values.map(row =>
            this.rowToTransaction(this.rowToObjectFromArray(result[0].columns, row))
        );
    }

    async getTransactionHistory(address) {
        if (!address) return [];
        const addrLower = address.toLowerCase();
        const result = this.db.exec(
            'SELECT * FROM transactions WHERE LOWER(fromAddress) = ? OR LOWER(toAddress) = ? ORDER BY timestamp DESC',
            [addrLower, addrLower]
        );
        if (!result.length || !result[0].values) return [];
        return result[0].values.map(row =>
            this.rowToTransaction(this.rowToObjectFromArray(result[0].columns, row))
        );
    }

    rowToTransaction(row) {
        let signature = null;
        let data = {};

        if (row.signature) {
            try {
                signature = JSON.parse(row.signature);
            } catch (e) {
                signature = row.signature; // Fallback to raw string
            }
        }

        if (row.data) {
            try {
                data = JSON.parse(row.data);
            } catch (e) {
                data = { rawData: row.data };
            }
        }

        return {
            id: row.id,
            from: row.fromAddress,
            to: row.toAddress,
            amount: row.amount,
            currency: row.currency || 'NCH',
            timestamp: row.timestamp,
            blockIndex: row.blockIndex,
            signature: signature,
            data: data,
            pending: row.pending === 1
        };
    }

    // ==================== WALLET OPERATIONS ====================

    async saveWallet(wallet) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO wallets (address, data, updatedAt)
            VALUES (?, ?, ?)
        `);
        stmt.run([wallet.address, JSON.stringify(wallet), Date.now()]);
        stmt.free();
        this.requestSave();
        return wallet;
    }

    async getWallet(address) {
        const result = this.db.exec('SELECT * FROM wallets WHERE address = ?', [address]);
        if (!result.length || !result[0].values.length) return null;
        const row = this.rowToObjectFromArray(result[0].columns, result[0].values[0]);
        return JSON.parse(row.data);
    }

    // ==================== SMART CONTRACT OPERATIONS ====================

    async saveSmartContract(contract) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO smart_contracts (address, code, state, creator, createdAt)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run([
            contract.address,
            contract.code,
            JSON.stringify(contract.state || {}),
            contract.creator,
            Date.now()
        ]);
        stmt.free();
        this.requestSave();
        return contract;
    }

    async getSmartContract(address) {
        const result = this.db.exec('SELECT * FROM smart_contracts WHERE address = ?', [address]);
        if (!result.length || !result[0].values.length) return null;
        const row = this.rowToObjectFromArray(result[0].columns, result[0].values[0]);
        return {
            address: row.address,
            code: row.code,
            state: row.state ? JSON.parse(row.state) : {},
            creator: row.creator
        };
    }

    async getAllSmartContracts() {
        const result = this.db.exec('SELECT * FROM smart_contracts');
        if (!result.length) return [];
        return result[0].values.map(row => {
            const obj = this.rowToObjectFromArray(result[0].columns, row);
            return {
                address: obj.address,
                code: obj.code,
                state: obj.state ? JSON.parse(obj.state) : {},
                creator: obj.creator
            };
        });
    }

    // ==================== MINER HISTORY OPERATIONS ====================

    async getMinerBlockHistory() {
        const result = this.db.exec('SELECT * FROM miner_block_history');
        if (!result.length) return [];
        return result[0].values.map(row => {
            const obj = this.rowToObjectFromArray(result[0].columns, row);
            return {
                minerAddress: obj.minerAddress,
                blockIndex: obj.blockIndex,
                timestamp: obj.timestamp
            };
        });
    }

    async saveMinerBlockHistory(record) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO miner_block_history (minerAddress, blockIndex, timestamp)
            VALUES (?, ?, ?)
        `);
        stmt.run([record.minerAddress, record.blockIndex, Date.now()]);
        stmt.free();
        return record;
    }

    // ==================== MINING REGISTRATION OPERATIONS ====================

    async saveMiningRegistration(registration) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO mining_registrations 
            (walletAddress, deviceId, bscTxHash, registeredAt, status, referralCode, referrerAddress, referralProcessed, referralRewardTxId, ipAddress)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        try {
            stmt.run([
                registration.walletAddress.toLowerCase(),
                registration.deviceId,
                registration.bscTxHash ? registration.bscTxHash.toLowerCase() : null,
                registration.registeredAt || Date.now(),
                registration.status || 'active',
                registration.referralCode || null,
                registration.referrerAddress || null,
                registration.referralProcessed ? 1 : 0,
                registration.referralRewardTxId || null,
                registration.ipAddress || null
            ]);
            stmt.free();
            this.requestSave();
            return registration;
        } catch (error) {
            console.error('❌ SQLite saveMiningRegistration failed:', error.message);
            stmt.free();
            throw error;
        }
    }

    async getMiningRegistration(walletAddress, deviceId = null) {
        let query = 'SELECT * FROM mining_registrations WHERE walletAddress = ?';
        let params = [walletAddress.toLowerCase()];

        if (deviceId) {
            query += ' OR deviceId = ?';
            params.push(deviceId);
        }

        const result = this.db.exec(query, params);
        if (!result.length || !result[0].values.length) return null;

        const row = this.rowToObjectFromArray(result[0].columns, result[0].values[0]);
        return {
            ...row,
            referralProcessed: row.referralProcessed === 1
        };
    }

    async getAllMiningRegistrations() {
        const result = this.db.exec('SELECT * FROM mining_registrations');
        if (!result.length) return [];

        return result[0].values.map(row => {
            const obj = this.rowToObjectFromArray(result[0].columns, row);
            return {
                ...obj,
                referralProcessed: obj.referralProcessed === 1
            };
        });
    }

    // ==================== NODE OPERATIONS ====================

    async saveNode(node) {
        return node;
    }

    async getAllNodes() {
        return [];
    }

    // ==================== ANALYTICS OPERATIONS ====================

    async saveAnalytics(type, data) {
        return { type, data };
    }

    // ==================== UTILITY OPERATIONS ====================

    async backup() {
        this.saveToDisk();
        console.log('💾 SQLite backup completed');
        return true;
    }

    async reset() {
        if (!this.db) return;
        console.warn('⚠️ RESETTING SQLITE DATABASE (WIPING ALL DATA)...');
        this.db.run('DELETE FROM blocks');
        this.db.run('DELETE FROM transactions');
        this.db.run('DELETE FROM smart_contracts');
        this.db.run('DELETE FROM wallets');
        this.db.run('DELETE FROM miner_block_history');
        this.db.run('DELETE FROM mining_registrations');
        this.requestSave();
        console.log('✅ SQLite database wiped successfully');
        return true;
    }

    async close() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        if (this.db) {
            this.saveToDisk();
            this.db.close();
            console.log('🔒 SQLite database closed and saved');
        }
    }
}

module.exports = BlockchainDatabaseSQLite;
