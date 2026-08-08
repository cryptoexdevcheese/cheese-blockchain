/**
 * 🧀 CHEESE BLOCKCHAIN - FIRESTORE DATABASE LAYER
 * Permanent, immutable storage using Google Firestore
 * Data persists forever!
 */

const { Firestore } = require('@google-cloud/firestore');

class BlockchainDatabaseFirestore {
    constructor(projectId = 'cheese-blockchain', collectionPrefix = 'cheese-blockchain', backupProjectId = null, backupKeyFilename = null) {
        this.projectId = projectId;
        this.db = null;

        // Backup Configuration
        this.backupProjectId = backupProjectId;
        this.backupKeyFilename = backupKeyFilename;
        this.backupDb = null;

        this.prefix = collectionPrefix;

        // Collection names with dynamic prefix
        this.collections = {
            blocks: `${this.prefix}-blocks`,
            transactions: `${this.prefix}-transactions`,
            pendingTransactions: `${this.prefix}-pending`,
            wallets: `${this.prefix}-wallets`,
            smartContracts: `${this.prefix}-contracts`,
            networkNodes: `${this.prefix}-nodes`,
            analytics: `${this.prefix}-analytics`,
            config: `${this.prefix}-config`,
            miningRegistrations: `${this.prefix}-mining-registrations`,  // Mining registrations
            referrals: `${this.prefix}-referrals`  // NEW: Referral tracking
        };

        console.log(`🔥 Firestore Database initialized for project: ${this.prefix}`);
    }

    async initialize() {
        try {
            // ENHANCED: Check for credentials before attempting connection
            const credentialsAvailable = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
                process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
                process.env.GOOGLE_CLOUD_PROJECT ||
                this.isRunningOnGCE();

            if (!credentialsAvailable) {
                console.warn('⚠️  WARNING: No Firestore credentials detected');
                console.warn('   Set GOOGLE_APPLICATION_CREDENTIALS or run on GCE');
                console.warn('   Falling back to SQLite-only mode');
                throw new Error('FIRESTORE_NO_CREDENTIALS');
            }

            // Initialize Firestore with timeout
            console.log('🔥 Initializing Firestore connection...');
            console.log(`   Project ID: ${this.projectId}`);

            // Use explicit keyFilename if available for better compatibility
            const firestoreOptions = {
                projectId: this.projectId
            };

            // Support for JSON content in Env Var (Railway/Heroku friendly)
            let jsonParsed = false;
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                try {
                    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
                    firestoreOptions.credentials = credentials;
                    console.log('   🔑 Using credentials from GOOGLE_APPLICATION_CREDENTIALS_JSON');
                    jsonParsed = true;
                } catch (e) {
                    console.error('❌ Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON (Falling back):', e.message);
                }
            }

            if (!jsonParsed && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                firestoreOptions.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
                console.log(`   Using service account file: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
            }

            this.db = new Firestore(firestoreOptions);

            // Initialize Backup DB if configured
            if (this.backupProjectId && this.backupKeyFilename) {
                console.log(`🛡️ Initializing BACKUP Connection to: ${this.backupProjectId}...`);
                try {
                    this.backupDb = new Firestore({
                        projectId: this.backupProjectId,
                        keyFilename: this.backupKeyFilename
                    });
                    console.log('✅ BACKUP Database Connected!');
                } catch (backupErr) {
                    console.error('⚠️ Failed to connect Backup DB:', backupErr.message);
                }
            }

            // Test connection with timeout
            const connectionTest = this.testConnection();
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('FIRESTORE_TIMEOUT')), 10000)
            );

            await Promise.race([connectionTest, timeout]);

            // Verify connection by reading/writing config
            const configRef = this.db.collection(this.collections.config).doc('blockchain');

            let configDoc;
            try {
                configDoc = await configRef.get();
            } catch (getError) {
                if (getError.code === 7) { // PERMISSION_DENIED
                    console.error('❌ FIRESTORE PERMISSION DENIED');
                    console.error('   This usually means:');
                    console.error('   1. Service account lacks Firestore permissions');
                    console.error('   2. Firestore is not enabled for this project');
                    console.error('   3. IAM roles are not properly configured');
                    console.error('');
                    console.error('   To fix, run on VM: bash setup-firestore-credentials.sh');
                    throw new Error('FIRESTORE_PERMISSION_DENIED');
                }
                throw getError;
            }

            if (!configDoc.exists) {
                // Initialize config document
                await configRef.set({
                    name: 'CHEESE Blockchain',
                    version: '1.0.0',
                    createdAt: Date.now(),
                    lastUpdated: Date.now(),
                    hostname: require('os').hostname(),
                    nodeVersion: process.version
                });
                console.log('✅ Firestore connected successfully');
                console.log('📝 Created blockchain config document');
            } else {
                await configRef.update({
                    lastUpdated: Date.now(),
                    hostname: require('os').hostname(),
                    lastConnection: new Date().toISOString()
                });
                console.log('✅ Firestore connected successfully');
                console.log('📝 Updated blockchain config (last seen)');
            }

            console.log(`📊 Project: ${this.projectId}`);
            console.log('🔒 All blockchain data will be stored PERMANENTLY in Firestore');
            console.log('💾 Data persists across VM restarts forever!');

            return true;
        } catch (error) {
            // CRITICAL: Enhanced error handling with specific error types
            console.error('❌ Firestore initialization error:', error.message);

            // Provide detailed error information
            if (error.message === 'FIRESTORE_NO_CREDENTIALS') {
                console.error('');
                console.error('===============================================');
                console.error('   FIRESTORE CREDENTIALS NOT FOUND');
                console.error('===============================================');
                console.error('To enable Firestore:');
                console.error('1. On VM: Run setup-firestore-credentials.sh');
                console.error('2. On local: Set GOOGLE_APPLICATION_CREDENTIALS');
                console.error('3. Or use: gcloud auth application-default login');
                console.error('===============================================');
            } else if (error.message === 'FIRESTORE_PERMISSION_DENIED') {
                console.error('');
                console.error('===============================================');
                console.error('   FIRESTORE PERMISSION DENIED');
                console.error('===============================================');
                console.error('Fix with one of these options:');
                console.error('');
                console.error('Option 1 (Recommended - On VM):');
                console.error('  bash setup-firestore-credentials.sh');
                console.error('');
                console.error('Option 2 (Manual):');
                console.error('  1. Go to Cloud Console IAM');
                console.error('  2. Find your service account');
                console.error('  3. Add roles:');
                console.error('     - Cloud Datastore User');
                console.error('     - Cloud Datastore Index Admin');
                console.error('');
                console.error('Option 3 (Quick test):');
                console.error('  gcloud auth application-default login');
                console.error('===============================================');
            } else if (error.message === 'FIRESTORE_TIMEOUT') {
                console.error('Firestore connection timed out - may be network issue');
            } else {
                console.error('Unexpected Firestore error:', error.code, error.details);
            }

            console.error('');
            console.warn('⚠️  FALLBACK: Will use SQLite-only mode');
            console.warn('   Data will be stored in cheese-blockchain.db');
            console.warn('   ⚠️  WARNING: Data may be lost on VM restart!');
            console.warn('   ⚠️  For production, MUST fix Firestore!');

            throw error;
        }
    }

    // Helper: Check if running on Google Compute Engine
    isRunningOnGCE() {
        try {
            const fs = require('fs');
            // Check for GCE metadata
            if (fs.existsSync('/sys/class/dmi/id/product_name')) {
                const productName = fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim();
                return productName === 'Google Compute Engine';
            }
        } catch (e) {
            // Not on GCE
        }
        return false;
    }

    // Helper: Test Firestore connection
    async testConnection() {
        // Simple test - just creating Firestore instance is enough
        // Actual read/write test happens in initialize()
        return true;
    }

    // ==================== BLOCK OPERATIONS ====================

    async saveBlock(block) {
        try {
            const blockRef = this.db.collection(this.collections.blocks).doc(`block-${block.index}`);

            await blockRef.set({
                blockIndex: block.index,
                timestamp: block.timestamp,
                previousHash: block.previousHash,
                hash: block.hash,
                nonce: block.nonce,
                difficulty: block.difficulty || 2,
                transactionCount: block.transactions ? block.transactions.length : 0,
                aiValidation: block.aiValidation || {},
                createdAt: Date.now()
            });

            // Save transactions for this block
            if (block.transactions && block.transactions.length > 0) {
                const batch = this.db.batch();
                for (const tx of block.transactions) {
                    const txId = tx.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    const txRef = this.db.collection(this.collections.transactions).doc(txId);
                    batch.set(txRef, {
                        id: txId,
                        hash: tx.hash || txId,
                        blockIndex: block.index,
                        from: tx.from || 'SYSTEM',
                        to: tx.to,
                        amount: tx.amount,
                        currency: tx.currency || 'NCH',
                        timestamp: tx.timestamp,
                        signature: typeof tx.signature === 'object' ? JSON.stringify(tx.signature) : tx.signature,
                        data: tx.data || {},
                        aiValidation: tx.aiValidation || {},
                        createdAt: Date.now()
                    });
                }
                await batch.commit();
            }

            console.log(`✅ Block ${block.index} saved to Firestore (permanent)`);

            // Backup Write
            if (this.backupDb) {
                this.backupDb.collection(this.collections.blocks).doc(`block-${block.index}`).set({
                    blockIndex: block.index,
                    timestamp: block.timestamp,
                    previousHash: block.previousHash,
                    hash: block.hash,
                    nonce: block.nonce,
                    difficulty: block.difficulty || 2,
                    transactionCount: block.transactions ? block.transactions.length : 0,
                    aiValidation: block.aiValidation || {},
                    createdAt: Date.now()
                }).catch(e => console.warn('⚠️ Backup Write Failed (Block):', e.message));
            }

            return true;
        } catch (error) {
            console.error('❌ Error saving block:', error);
            throw error;
        }
    }

    async deleteBlock(blockIndex) {
        try {
            // Delete transactions for this block
            const txSnapshot = await this.db.collection(this.collections.transactions)
                .where('blockIndex', '==', blockIndex)
                .get();

            const batch = this.db.batch();
            txSnapshot.docs.forEach(doc => batch.delete(doc.ref));

            // Delete the block
            const blockRef = this.db.collection(this.collections.blocks).doc(`block-${blockIndex}`);
            batch.delete(blockRef);

            await batch.commit();
            console.log(`🗑️ Deleted block ${blockIndex} from Firestore`);
            return true;
        } catch (error) {
            console.error('❌ Error deleting block:', error);
            throw error;
        }
    }

    async getBlock(index) {
        try {
            const blockRef = this.db.collection(this.collections.blocks).doc(`block-${index}`);
            const doc = await blockRef.get();

            if (!doc.exists) return null;

            const data = doc.data();
            return {
                index: data.blockIndex,
                blockIndex: data.blockIndex,
                timestamp: data.timestamp,
                previousHash: data.previousHash,
                hash: data.hash,
                nonce: data.nonce,
                difficulty: data.difficulty,
                transactionCount: data.transactionCount,
                aiValidation: data.aiValidation || {}
            };
        } catch (error) {
            console.error('❌ Error getting block:', error);
            throw error;
        }
    }

    async getAllBlocks(skipTransactions = false) {
        try {
            const snapshot = await this.db.collection(this.collections.blocks).get();

            return snapshot.docs.map(doc => {
                const data = doc.data();
                const index = data.blockIndex !== undefined ? data.blockIndex : data.index;
                return {
                    index: index,
                    blockIndex: index,
                    timestamp: data.timestamp,
                    previousHash: data.previousHash,
                    hash: data.hash,
                    nonce: data.nonce,
                    difficulty: data.difficulty,
                    transactionCount: data.transactionCount,
                    aiValidation: data.aiValidation || {}
                };
            });
        } catch (error) {
            console.error('❌ Error getting all blocks:', error);
            throw error;
        }
    }

    async getLatestBlock() {
        try {
            const snapshot = await this.db.collection(this.collections.blocks)
                .orderBy('blockIndex', 'desc')
                .limit(1)
                .get();

            if (snapshot.empty) {
                console.log('⚠️ Firestore: No blocks found (Empty)');
                return null;
            }

            const doc = snapshot.docs[0];
            const data = doc.data();
            console.log(`✅ Firestore Head: Index ${data.blockIndex} | Hash ${data.hash?.substring(0, 10)}`);

            const block = {
                index: data.blockIndex,
                // ... map fields ...
                hash: data.hash,
                previousHash: data.previousHash,
                timestamp: data.timestamp,
                nonce: data.nonce,
                difficulty: data.difficulty,
                transactions: [], // Fetch separately or lazy load
                aiValidation: data.aiValidation
            };
            return block;
        } catch (error) {
            console.error('❌ Error getting latest block:', error);
            throw error;
        }
    }

    // ==================== TRANSACTION OPERATIONS ====================

    async saveTransaction(transaction, blockIndex = null) {
        try {
            const collection = blockIndex !== null ? this.collections.transactions : this.collections.pendingTransactions;
            const txId = transaction.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const docRef = this.db.collection(collection).doc(txId);

            const txData = {
                id: txId,
                hash: transaction.hash || txId,
                from: transaction.from ? transaction.from.toLowerCase() : 'system',
                to: transaction.to ? transaction.to.toLowerCase() : null,
                amount: transaction.amount,
                currency: transaction.currency || 'NCH',
                timestamp: transaction.timestamp,
                signature: typeof transaction.signature === 'object' ? JSON.stringify(transaction.signature) : transaction.signature,
                data: transaction.data || {},
                aiValidation: transaction.aiValidation || {},
                createdAt: Date.now()
            };

            if (blockIndex !== null) {
                txData.blockIndex = blockIndex;
            }

            await docRef.set(txData);

            // Backup Write
            if (this.backupDb) {
                this.backupDb.collection(collection).doc(docRef.id).set(txData)
                    .catch(e => console.warn('⚠️ Backup Write Failed (Tx):', e.message));
            }

            return true;
        } catch (error) {
            console.error('❌ Error saving transaction:', error);
            throw error;
        }
    }

    async getPendingTransactions() {
        try {
            const snapshot = await this.db.collection(this.collections.pendingTransactions)
                .orderBy('timestamp', 'asc')
                .get();

            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: data.id || doc.id,
                    hash: data.hash || data.id || doc.id,
                    from: data.from === 'SYSTEM' ? null : data.from,
                    to: data.to,
                    amount: data.amount,
                    timestamp: data.timestamp,
                    signature: data.signature,
                    data: data.data || {},
                    aiValidation: data.aiValidation || {}
                };
            });
        } catch (error) {
            console.error('❌ Error getting pending transactions:', error);
            throw error;
        }
    }

    async clearPendingTransactions() {
        try {
            const snapshot = await this.db.collection(this.collections.pendingTransactions).get();

            const batch = this.db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            console.log('🧹 Cleared all pending transactions');
            return true;
        } catch (error) {
            console.error('❌ Error clearing pending transactions:', error);
            throw error;
        }
    }

    async getTransactionsByBlock(blockIndex) {
        try {
            const snapshot = await this.db.collection(this.collections.transactions)
                .where('blockIndex', '==', blockIndex)
                .get();

            return snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: data.id || doc.id,
                    hash: data.hash || data.id || doc.id,
                    from: data.from === 'SYSTEM' ? null : data.from,
                    to: data.to,
                    amount: data.amount,
                    currency: data.currency || (data.data && data.data.currency) || 'NCH',
                    timestamp: data.timestamp,
                    signature: data.signature,
                    data: data.data || {},
                    aiValidation: data.aiValidation || {}
                };
            });
        } catch (error) {
            console.error('❌ Error getting transactions by block:', error);
            throw error;
        }
    }

    /**
     * Get ALL transactions from Firestore (for transparency/explorer)
     * Returns all historical transactions sorted by timestamp
     */
    async getAllTransactions() {
        try {
            let allTransactions = [];
            let lastDoc = null;
            const CHUNK_SIZE = 5000;
            let hasMore = true;

            console.log('📥 Fetching all transactions from Firestore in chunks...');

            while (hasMore) {
                let query = this.db.collection(this.collections.transactions)
                    .orderBy('timestamp', 'asc')
                    .limit(CHUNK_SIZE);

                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }

                const snapshot = await query.get();

                if (snapshot.empty) {
                    hasMore = false;
                    break;
                }

                const chunk = snapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: data.id || doc.id,
                        hash: data.hash || data.id || doc.id,
                        from: data.from === 'SYSTEM' ? null : data.from,
                        to: data.to,
                        amount: data.amount,
                        currency: data.currency || (data.data && data.data.currency) || 'NCH',
                        timestamp: data.timestamp,
                        blockIndex: data.blockIndex,
                        signature: data.signature,
                        data: data.data || {},
                        aiValidation: data.aiValidation || {}
                    };
                });

                allTransactions = allTransactions.concat(chunk);
                lastDoc = snapshot.docs[snapshot.docs.length - 1];

                console.log(`   📦 Loaded chunk of ${chunk.length} transactions (Total: ${allTransactions.length})`);

                if (chunk.length < CHUNK_SIZE) {
                    hasMore = false;
                }
            }

            return allTransactions;
        } catch (error) {
            console.error('❌ Error getting all transactions:', error);
            // Return what we have if some chunks succeeded, otherwise []
            return [];
        }
    }

    /**
     * Get transaction history for a specific address from Firestore
     * Combined search of 'from' and 'to' fields
     */
    async getTransaction(idOrHash) {
        if (!idOrHash) return null;
        try {
            // 1. Try direct doc fetch
            const doc = await this.db.collection(this.collections.transactions).doc(idOrHash).get();
            if (doc.exists) {
                const data = doc.data();
                return {
                    id: data.id || doc.id,
                    hash: data.hash || data.id || doc.id,
                    from: data.from === 'SYSTEM' ? null : data.from,
                    to: data.to,
                    amount: parseFloat(data.amount),
                    currency: data.currency || 'NCH',
                    timestamp: data.timestamp,
                    signature: data.signature || {},
                    data: data.data || {},
                    blockIndex: data.blockIndex !== undefined ? data.blockIndex : null
                };
            }
            // 2. Query fallback by hash field
            const snapshot = await this.db.collection(this.collections.transactions)
                .where('hash', '==', idOrHash)
                .limit(1)
                .get();
            if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                return {
                    id: data.id || snapshot.docs[0].id,
                    hash: data.hash || data.id || snapshot.docs[0].id,
                    from: data.from === 'SYSTEM' ? null : data.from,
                    to: data.to,
                    amount: parseFloat(data.amount),
                    currency: data.currency || 'NCH',
                    timestamp: data.timestamp,
                    signature: data.signature || {},
                    data: data.data || {},
                    blockIndex: data.blockIndex !== undefined ? data.blockIndex : null
                };
            }
        } catch (e) {
            console.warn('Firestore getTransaction failed:', e.message);
        }
        return null;
    }

    async getTransactionHistory(address) {
        if (!address) return [];
        const addrLower = address.toLowerCase();

        try {
            console.log(`🔥 Fetching transaction history from Firestore for: ${addrLower}`);

            // Robust Case-Insensitive Queries (check both lowercase and raw address)
            const [fromLowerSnap, fromRawSnap, toLowerSnap, toRawSnap] = await Promise.all([
                this.db.collection(this.collections.transactions).where('from', '==', addrLower).get().catch(() => ({ docs: [] })),
                this.db.collection(this.collections.transactions).where('from', '==', address).get().catch(() => ({ docs: [] })),
                this.db.collection(this.collections.transactions).where('to', '==', addrLower).get().catch(() => ({ docs: [] })),
                this.db.collection(this.collections.transactions).where('to', '==', address).get().catch(() => ({ docs: [] }))
            ]);

            const transactionsMap = new Map();

            const processDoc = (doc) => {
                if (!doc || !doc.data) return;
                const data = doc.data();
                const tx = {
                    id: data.id || doc.id,
                    hash: data.hash || data.id || doc.id,
                    from: data.from === 'SYSTEM' ? null : data.from,
                    to: data.to,
                    amount: parseFloat(data.amount) || 0,
                    currency: data.currency || data.asset || (data.data && (data.data.currency || data.data.asset)) || 'NCH',
                    timestamp: data.timestamp,
                    blockIndex: data.blockIndex,
                    signature: data.signature,
                    data: data.data || {},
                    aiValidation: data.aiValidation || {}
                };
                if (tx.id) transactionsMap.set(tx.id, tx);
            };

            [fromLowerSnap, fromRawSnap, toLowerSnap, toRawSnap].forEach(snap => {
                if (snap && snap.docs) snap.docs.forEach(processDoc);
            });

            const results = Array.from(transactionsMap.values())
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            console.log(`✅ Firestore History: Found ${results.length} transactions for ${addrLower}`);
            return results;

        } catch (error) {
            console.error('❌ Error getting transaction history from Firestore:', error.message);
            // Return empty array to allow local fallback in DualStorage if possible
            return [];
        }
    }

    // ==================== WALLET OPERATIONS ====================

    async saveWallet(wallet) {
        try {
            const walletRef = this.db.collection(this.collections.wallets).doc(wallet.address);

            // NORMALIZE: Ensure we have a balances map
            const balances = wallet.balances || {};
            
            // Backward compatibility: If we have a single 'balance' field, treat it as NCH
            if (wallet.balance !== undefined && !balances.NCH) {
                balances.NCH = wallet.balance;
            }

            await walletRef.set({
                address: wallet.address,
                publicKey: wallet.publicKey || null,
                encryptedPrivateKey: wallet.encryptedPrivateKey || null,
                balance: balances.NCH || 0, // Keep legacy field for explorer/website
                balances: balances,       // NEW: Explicit multi-currency map
                lastUpdated: Date.now(),
                createdAt: wallet.createdAt || Date.now()
            }, { merge: true });

            return true;
        } catch (error) {
            console.error('❌ Error saving wallet:', error);
            throw error;
        }
    }

    async getWallet(address) {
        try {
            const walletRef = this.db.collection(this.collections.wallets).doc(address);
            const doc = await walletRef.get();

            if (!doc.exists) return null;
            return doc.data();
        } catch (error) {
            console.error('❌ Error getting wallet:', error);
            throw error;
        }
    }

    // ==================== SMART CONTRACT OPERATIONS ====================

    async saveSmartContract(contract) {
        try {
            const contractRef = this.db.collection(this.collections.smartContracts).doc(contract.address);

            await contractRef.set({
                address: contract.address,
                code: contract.code,
                deployer: contract.deployer,
                timestamp: contract.timestamp,
                state: contract.state || {},
                createdAt: Date.now()
            });

            return true;
        } catch (error) {
            console.error('❌ Error saving smart contract:', error);
            throw error;
        }
    }

    async getSmartContract(address) {
        try {
            const contractRef = this.db.collection(this.collections.smartContracts).doc(address);
            const doc = await contractRef.get();

            if (!doc.exists) return null;
            return doc.data();
        } catch (error) {
            console.error('❌ Error getting smart contract:', error);
            throw error;
        }
    }

    async getAllSmartContracts() {
        try {
            const snapshot = await this.db.collection(this.collections.smartContracts).get();
            return snapshot.docs.map(doc => doc.data());
        } catch (error) {
            console.error('❌ Error getting all smart contracts:', error);
            throw error;
        }
    }

    // ==================== NETWORK NODE OPERATIONS ====================

    async saveNode(node) {
        try {
            const nodeRef = this.db.collection(this.collections.networkNodes).doc(node.address);

            await nodeRef.set({
                address: node.address,
                port: node.port,
                lastSeen: Date.now(),
                isActive: true,
                createdAt: Date.now()
            }, { merge: true });

            return true;
        } catch (error) {
            console.error('❌ Error saving node:', error);
            throw error;
        }
    }

    async getAllNodes() {
        try {
            const snapshot = await this.db.collection(this.collections.networkNodes)
                .where('isActive', '==', true)
                .get();

            return snapshot.docs.map(doc => doc.data());
        } catch (error) {
            console.error('❌ Error getting all nodes:', error);
            throw error;
        }
    }

    // ==================== ANALYTICS OPERATIONS ====================

    async saveAnalytics(type, data) {
        try {
            await this.db.collection(this.collections.analytics).add({
                type: type,
                data: data,
                timestamp: Date.now()
            });
            return true;
        } catch (error) {
            console.error('❌ Error saving analytics:', error);
            throw error;
        }
    }

    // ==================== MINING REGISTRATION OPERATIONS ====================

    async saveMiningRegistration(registration) {
        try {
            // Create composite key: walletAddress_deviceId
            const docId = `${registration.walletAddress.toLowerCase()}_${registration.deviceId}`;
            const regRef = this.db.collection(this.collections.miningRegistrations).doc(docId);

            await regRef.set({
                walletAddress: registration.walletAddress.toLowerCase(),
                deviceId: registration.deviceId,
                bscTxHash: registration.bscTxHash ? registration.bscTxHash.toLowerCase() : null,
                registeredAt: registration.registeredAt || Date.now(),
                status: registration.status || 'active',
                // NEW: Referral fields
                referralCode: registration.referralCode || null,
                referrerAddress: registration.referrerAddress || registration.referrer || null, // FIXED: Added fallback
                referralProcessed: registration.referralProcessed || false,
                referralRewardTxId: registration.referralRewardTxId || null,
                registrationIP: registration.ipAddress || null,
                createdAt: Date.now()
            });

            // Also index by bscTxHash to prevent reuse
            const txRef = this.db.collection(this.collections.miningRegistrations).doc(`tx_${registration.bscTxHash.toLowerCase()}`);
            await txRef.set({
                walletAddress: registration.walletAddress.toLowerCase(),
                deviceId: registration.deviceId,
                bscTxHash: registration.bscTxHash.toLowerCase(),
                type: 'tx_index'
            });

            console.log(`✅ Mining registration saved: ${registration.walletAddress}`);
            return true;
        } catch (error) {
            console.error('❌ Error saving mining registration:', error);
            throw error;
        }
    }

    async getMiningRegistration(walletAddress, deviceId = null) {
        try {
            // 1. Try composite ID lookup if deviceId is provided
            if (deviceId) {
                const docId = `${walletAddress.toLowerCase()}_${deviceId}`;
                const doc = await this.db.collection(this.collections.miningRegistrations).doc(docId).get();
                if (doc.exists) return doc.data();
            }

            // 2. Fallback: Query by walletAddress to find ANY registration for this wallet
            const snapshot = await this.db.collection(this.collections.miningRegistrations)
                .where('walletAddress', '==', walletAddress.toLowerCase())
                .where('status', 'in', ['active', 'paid']) // FIXED: Only return real registrations, ignore tx_index docs
                .limit(1)
                .get();

            if (!snapshot.empty) {
                return snapshot.docs[0].data();
            }

            return null;
        } catch (error) {
            console.error('❌ Error getting mining registration:', error);
            return null;
        }
    }

    // ==================== MINER BLOCK HISTORY OPERATIONS ====================

    async saveMinerBlockHistory(walletAddress, blockIndex, blockHash) {
        try {
            // Use prefix for miner history collection
            const historyCollection = `${this.prefix}-miner-history`;
            const docId = `${walletAddress.toLowerCase()}_${blockIndex}`;
            const historyRef = this.db.collection(historyCollection).doc(docId);

            await historyRef.set({
                walletAddress: walletAddress.toLowerCase(),
                blockIndex: blockIndex,
                blockHash: blockHash,
                minedAt: Date.now()
            });

            return true;
        } catch (error) {
            console.error('❌ Error saving miner block history:', error && error.message ? error.message : error);
            // Don't throw - this is non-critical, just log the error
            return false;
        }
    }

    async getMinerBlockHistory(walletAddress = null) {
        try {
            const historyCollection = `${this.prefix}-miner-history`;
            let query = this.db.collection(historyCollection);

            if (walletAddress) {
                query = query.where('walletAddress', '==', walletAddress.toLowerCase());
            }

            const snapshot = await query.orderBy('minedAt', 'desc').limit(100).get();

            return snapshot.docs.map(doc => doc.data());
        } catch (error) {
            console.error('❌ Error getting miner block history:', error);
            return [];
        }
    }

    // ==================== REFERRAL TRACKING OPERATIONS ====================

    /**
     * Save referral record when a new miner registers with a referral code
     */
    async saveReferral(referralData) {
        try {
            const docRef = this.db.collection(this.collections.referrals).doc();

            await docRef.set({
                referrerAddress: referralData.referrerAddress.toLowerCase(),
                referredAddress: referralData.referredAddress.toLowerCase(),
                referralCode: referralData.referralCode,
                rewardAmount: referralData.rewardAmount,
                transactionId: referralData.transactionId,
                bscPaymentTxHash: referralData.bscPaymentTxHash.toLowerCase(),
                deviceId: referralData.deviceId,
                ipAddress: referralData.ipAddress,
                timestamp: referralData.timestamp || Date.now(),
                status: referralData.status || 'completed',
                source: referralData.source || 'unmined_supply',
                createdAt: Date.now()
            });

            console.log(`✅ Referral saved: ${referralData.referrerAddress} referred ${referralData.referredAddress}`);
            return docRef.id;
        } catch (error) {
            console.error('❌ Error saving referral:', error);
            throw error;
        }
    }

    /**
     * Get referrals from a specific IP address within a time window
     * Used for rate limiting (max 5 per hour per IP)
     */
    async getReferralsByIP(ipAddress, sinceTimestamp) {
        try {
            const snapshot = await this.db.collection(this.collections.referrals)
                .where('ipAddress', '==', ipAddress)
                .where('timestamp', '>=', sinceTimestamp)
                .get();

            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('❌ Error getting referrals by IP:', error);
            return [];
        }
    }

    /**
     * Get total referral count for a referrer
     * Used for pattern detection and high-volume monitoring
     */
    async getReferralCount(referrerAddress) {
        try {
            const snapshot = await this.db.collection(this.collections.referrals)
                .where('referrerAddress', '==', referrerAddress.toLowerCase())
                .get();

            return snapshot.size;
        } catch (error) {
            console.error('❌ Error getting referral count:', error);
            return 0;
        }
    }

    /**
     * Check if a BSC transaction hash was already used for registration
     * Prevents payment reuse exploit
     */
    async getBscTxUsage(bscTxHash) {
        try {
            const snapshot = await this.db.collection(this.collections.miningRegistrations)
                .where('bscTxHash', '==', bscTxHash.toLowerCase())
                .limit(1)
                .get();

            return !snapshot.empty;
        } catch (error) {
            console.error('❌ Error checking BSC tx usage:', error);
            return false;
        }
    }

    /**
     * Get all referrals for a specific referrer (for dashboard)
     */
    async getReferralsByReferrer(referrerAddress) {
        try {
            const snapshot = await this.db.collection(this.collections.referrals)
                .where('referrerAddress', '==', referrerAddress.toLowerCase())
                .orderBy('timestamp', 'desc')
                .get();

            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('❌ Error getting referrals by referrer:', error);
            return [];
        }
    }

    /**
     * Flag account for manual review (pattern detection)
     */
    async flagForReview(walletAddress, reason) {
        try {
            const flaggedCollection = `${this.prefix}-flagged-accounts`;
            const flagRef = this.db.collection(flaggedCollection).doc(walletAddress.toLowerCase());

            await flagRef.set({
                walletAddress: walletAddress.toLowerCase(),
                flagReason: reason,
                flaggedAt: Date.now(),
                status: 'under_review',
                resolved: false
            }, { merge: true });

            console.log(`🚩 Flagged ${walletAddress} for review: ${reason}`);
            return true;
        } catch (error) {
            console.error('❌ Error flagging account:', error);
            return false;
        }
    }

    // ==================== BACKUP METHOD (for compatibility) ====================

    async backup() {
        // Firestore auto-backs up, but we can log the action
        console.log('🔥 Firestore data is automatically backed up by Google');
        return true;
    }

    async close() {
        // Firestore doesn't require explicit closing
        console.log('🔒 Firestore connection closed');
        return true;
    }
}

module.exports = BlockchainDatabaseFirestore;















