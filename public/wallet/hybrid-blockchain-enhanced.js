/**
 * Cheese Blockchain AI Hybrid
 * Enhanced Hybrid Blockchain with AI Integration
 * Features:
 * - Database persistence
 * - P2P networking
 * - Cryptographic wallets
 * - Real AI/ML integration
 */

const crypto = require('crypto');
const BlockchainDatabase = require('./blockchain-database');
const { WalletManager } = require('./blockchain-wallet');
const BlockchainNetwork = require('./blockchain-network');
const BlockchainML = require('./blockchain-ai-ml');
const { AIConsensus, AIValidator, AIAnalytics } = require('./hybrid-blockchain-ai');

class EnhancedHybridBlockchainAI {
    constructor(options = {}) {
        this.chain = [];
        this.pendingTransactions = [];
        this.miningReward = options.miningReward || 100;
        this.difficulty = options.difficulty || 2;
        this.smartContracts = [];
        
        // Enhanced components
        this.database = new BlockchainDatabase(options.dbPath);
        this.walletManager = null; // Will be initialized after database
        this.network = null; // Will be initialized if network port provided
        this.ml = new BlockchainML();
        
        // AI components
        this.aiAgents = [];
        this.aiConsensus = new AIConsensus();
        this.aiValidator = new AIValidator();
        this.aiAnalytics = new AIAnalytics();
        
        // CRITICAL: Miner block history tracking (prevents duplicate block mining)
        this.minerBlockHistory = new Map(); // In-memory cache: minerAddress -> [blockIndices]
        this.minedBlockIndices = new Set(); // Track all mined block indices (prevents duplicates)
        
        // CRITICAL: Initialize founder and treasury addresses and premine amounts
        this.founderAddress = options.founderAddress || '0xa25f52f081c3397bbc8d2ed12146757c470e049d';
        this.founderPremine = options.founderPremine || 1000000; // 1M NCHEESE
        // CRITICAL: Treasury address - using the correct treasury wallet address
        // Treasury wallet: 0xde2d2a08f90e64f9f266287129da29f498b399a4
        this.treasuryAddress = options.treasuryAddress || '0xde2d2a08f90e64f9f266287129da29f498b399a4';
        this.treasuryPremine = options.treasuryPremine || 2000000; // 2M NCHEESE
        
        console.log('🏗️ Blockchain initialized with:');
        console.log(`  Founder: ${this.founderAddress} (${this.founderPremine} NCHEESE)`);
        console.log(`  Treasury: ${this.treasuryAddress} (${this.treasuryPremine} NCHEESE)`);
        
        this.isInitialized = false;
    }

    async initialize() {
        // Initialize database
        await this.database.initialize();
        
        // Initialize wallet manager
        this.walletManager = new WalletManager(this.database);
        
        // Initialize ML (non-blocking, main unique feature)
        try {
            await Promise.race([
                this.ml.initialize(),
                new Promise((resolve) => setTimeout(resolve, 5000)) // 5s timeout
            ]);
        } catch (error) {
            console.warn('⚠️ ML initialization timeout or error (non-critical):', error.message);
            // ML will use enhanced fallback
        }
        
        // Load blockchain from database
        await this.loadFromDatabase();
        
        // CRITICAL: Load miner block history from database (prevents duplicate mining)
        await this.loadMinerBlockHistory();
        
        // CRITICAL: Check if genesis block exists but has no premine transactions
        let genesisBlock = null;
        if (this.chain.length > 0 && this.chain[0].index === 0) {
            genesisBlock = this.chain[0];
            console.log('📦 Genesis block found in database');
            
            // Check if genesis block has transactions
            const hasPremine = genesisBlock.transactions && genesisBlock.transactions.some(tx => 
                tx.data && tx.data.type === 'premine'
            );
            
            if (!hasPremine) {
                console.log('⚠️ Genesis block exists but has no premine transactions. Adding premine...');
                genesisBlock = null; // Will create new genesis with premine
            } else {
                console.log('✅ Genesis block already has premine transactions');
            }
        }
        
        // If no blocks in database OR genesis has no premine, create genesis with premine
        if (this.chain.length === 0 || genesisBlock === null) {
            if (genesisBlock === null && this.chain.length > 0) {
                // Remove old genesis block without premine
                this.chain = [];
                console.log('🗑️ Removed genesis block without premine');
            }
            
            genesisBlock = this.createGenesisBlock();
            
            // Add premine transactions: 1M to founder, 2M to treasury
            const treasuryAddress = this.treasuryAddress;
            const founderAddress = this.founderAddress;
            const founderPremine = this.founderPremine; // 1M
            const treasuryPremine = this.treasuryPremine; // 2M
            
            console.log(`💰 Preparing premine: Founder=${founderAddress} (${founderPremine}), Treasury=${treasuryAddress} (${treasuryPremine})`);
            
            const premineTransactions = [];
            
            // Allocate 1M to founder wallet
            if (founderPremine > 0 && founderAddress && founderAddress !== 'FOUNDER_WALLET_ADDRESS_HERE') {
                const founderTransaction = {
                    id: `premine-founder-${Date.now()}`,
                    from: null, // Genesis/premine transaction
                    to: founderAddress,
                    amount: founderPremine,
                    timestamp: genesisBlock.timestamp,
                    data: { 
                        type: 'premine',
                        description: 'Founder wallet initial allocation',
                        recipient: 'founder'
                    },
                    signature: this.signTransaction(null, founderAddress, founderPremine, { type: 'premine', recipient: 'founder' }),
                    aiValidation: {
                        validated: true,
                        confidence: 1.0,
                        agent: 'genesis'
                    }
                };
                premineTransactions.push(founderTransaction);
                console.log(`✅ Founder premine allocated: ${founderPremine} NCHEESE to ${founderAddress}`);
            } else {
                console.warn(`⚠️ Cannot allocate founder premine: founderPremine=${founderPremine}, founderAddress=${founderAddress}`);
            }
            
            // Allocate 2M to treasury wallet
            // CRITICAL: Treasury address must be valid and different from founder
            if (treasuryPremine > 0 && treasuryAddress && 
                treasuryAddress !== '0x0000000000000000000000000000000000000001' &&
                treasuryAddress !== 'FOUNDER_WALLET_ADDRESS_HERE' &&
                treasuryAddress !== founderAddress) {
                const treasuryTransaction = {
                    id: `premine-treasury-${Date.now()}`,
                    from: null, // Genesis/premine transaction
                    to: treasuryAddress,
                    amount: treasuryPremine,
                    timestamp: genesisBlock.timestamp,
                    data: { 
                        type: 'premine',
                        description: 'Treasury wallet initial allocation',
                        recipient: 'treasury'
                    },
                    signature: this.signTransaction(null, treasuryAddress, treasuryPremine, { type: 'premine', recipient: 'treasury' }),
                    aiValidation: {
                        validated: true,
                        confidence: 1.0,
                        agent: 'genesis'
                    }
                };
                premineTransactions.push(treasuryTransaction);
                console.log(`✅ Treasury premine allocated: ${treasuryPremine} NCHEESE to ${treasuryAddress}`);
            } else {
                console.warn(`⚠️ Cannot allocate treasury premine: treasuryPremine=${treasuryPremine}, treasuryAddress=${treasuryAddress}`);
            }
            
            // Add all premine transactions to genesis block
            if (premineTransactions.length > 0) {
                genesisBlock.transactions = premineTransactions;
                genesisBlock.hash = this.calculateHash(genesisBlock);
                console.log(`✅ Total premine allocated: ${founderPremine + treasuryPremine} NCHEESE (${founderPremine}M founder + ${treasuryPremine}M treasury)`);
                
                // Update chain
                if (this.chain.length === 0) {
                    this.chain.push(genesisBlock);
                } else {
                    this.chain[0] = genesisBlock; // Replace existing genesis
                }
                
                // Save to database
                await this.database.saveBlock(genesisBlock);
                
                // Save premine transactions
                for (const tx of premineTransactions) {
                    await this.database.saveTransaction(tx, genesisBlock.index);
                }
                
                console.log('✅ Genesis block with premine saved to database');
            } else {
                console.error('❌ No premine transactions created! Check founder/treasury addresses and amounts.');
            }
        }
        
        // Load pending transactions
        this.pendingTransactions = await this.database.getPendingTransactions();
        
        // Load smart contracts
        const contracts = await this.database.getAllSmartContracts();
        this.smartContracts = contracts;
        
        // Initialize AI agents
        this.initializeAIAgents();
        
        this.isInitialized = true;
        console.log(`✅ Cheese Blockchain AI Hybrid initialized with ${this.chain.length} blocks`);
    }

    async loadFromDatabase() {
        const blocks = await this.database.getAllBlocks();
        this.chain = blocks;
        console.log(`📦 Loaded ${blocks.length} blocks from database`);
        
        // Load transactions for each block
        for (const block of this.chain) {
            const transactions = await this.database.getTransactionsByBlock(block.index);
            block.transactions = transactions;
            console.log(`  📦 Block ${block.index} has ${transactions.length} transactions`);
            if (transactions.length > 0) {
                transactions.forEach((tx, idx) => {
                    console.log(`    Transaction ${idx}: from=${tx.from || 'null'}, to=${tx.to}, amount=${tx.amount}, type=${tx.data?.type || 'normal'}`);
                });
            }
            // Track mined block indices
            this.minedBlockIndices.add(block.index);
        }
    }
    
    // CRITICAL: Load miner block history from database (prevents duplicate block mining)
    async loadMinerBlockHistory() {
        try {
            const history = await this.database.getMinerBlockHistory();
            for (const record of history) {
                if (!this.minerBlockHistory.has(record.minerAddress)) {
                    this.minerBlockHistory.set(record.minerAddress, []);
                }
                this.minerBlockHistory.get(record.minerAddress).push(record.blockIndex);
                this.minedBlockIndices.add(record.blockIndex);
            }
            console.log(`✅ Loaded miner block history: ${history.length} records`);
        } catch (error) {
            console.warn('⚠️ Error loading miner block history:', error.message);
            // Continue without history (will be rebuilt from existing blocks)
            // Rebuild from chain
            for (const block of this.chain) {
                if (block.transactions) {
                    // Find mining reward transaction
                    const rewardTx = block.transactions.find(tx => 
                        tx.data && tx.data.type === 'mining_reward'
                    );
                    if (rewardTx && rewardTx.to) {
                        const minerAddress = rewardTx.to;
                        if (!this.minerBlockHistory.has(minerAddress)) {
                            this.minerBlockHistory.set(minerAddress, []);
                        }
                        this.minerBlockHistory.get(minerAddress).push(block.index);
                        this.minedBlockIndices.add(block.index);
                    }
                }
            }
            console.log(`✅ Rebuilt miner block history from chain: ${this.minedBlockIndices.size} block indices tracked`);
        }
    }

    initializeNetwork(port) {
        this.network = new BlockchainNetwork(port, this, this.database);
        this.network.startServer();
        
        // Listen to network events
        this.network.on('blockAdded', async (block) => {
            console.log('Block added from network');
        });
        
        this.network.on('transactionAdded', async (transaction) => {
            console.log('Transaction added from network');
        });
    }

    connectToPeer(host, port) {
        if (!this.network) {
            throw new Error('Network not initialized');
        }
        return this.network.connectToPeer(host, port);
    }

    createGenesisBlock() {
        return {
            index: 0,
            timestamp: Date.now(),
            transactions: [],
            previousHash: '0',
            hash: this.calculateHash({
                index: 0,
                timestamp: Date.now(),
                transactions: [],
                previousHash: '0',
                nonce: 0
            }),
            nonce: 0,
            difficulty: this.difficulty,
            aiValidation: {
                validated: true,
                confidence: 1.0,
                aiAgent: 'genesis'
            }
        };
    }

    initializeAIAgents() {
        this.aiAgents = [
            { type: 'consensus', description: 'Handles consensus decisions', active: true, performance: 0.8 },
            { type: 'validation', description: 'Validates transactions using ML', active: true, performance: 0.85 },
            { type: 'security', description: 'Monitors for threats and anomalies', active: true, performance: 0.8 },
            { type: 'optimization', description: 'Optimizes block creation and mining', active: true, performance: 0.75 },
            { type: 'analytics', description: 'Provides insights and predictions', active: true, performance: 0.8 }
        ];
    }

    async createTransaction(from, to, amount, data = {}, signature = null, clientTimestamp = null) {
        // Input validation
        if (!from || !to) {
            return { 
                success: false, 
                reason: 'From and to addresses are required',
                aiValidation: { valid: false, confidence: 0, agent: 'input_validator' }
            };
        }

        if (amount === undefined || amount === null || isNaN(amount) || amount < 0) {
            return { 
                success: false, 
                reason: 'Valid positive amount is required',
                aiValidation: { valid: false, confidence: 0, agent: 'input_validator' }
            };
        }

        // MANDATORY SIGNATURE - All transactions must be signed
        if (!signature) {
            return {
                success: false,
                reason: 'Transaction signature is required for security. All transactions must be cryptographically signed.',
                aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
            };
        }

        // Verify signature format
        if (!signature.publicKey) {
            return {
                success: false,
                reason: 'Signature must include publicKey for verification',
                aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
            };
        }

        // Create transaction object for verification
        // CRITICAL: Use client's timestamp if provided (for signature verification)
        // Otherwise use current timestamp (for new transactions)
        const transactionTimestamp = clientTimestamp || Date.now();
        const transactionData = { from, to, amount, timestamp: transactionTimestamp, data };
        
        // Verify signature directly using public key (doesn't require wallet in manager)
        // This allows client-side wallets to send transactions
        try {
            const EC = require('elliptic').ec;
            const ec = new EC('secp256k1');
            
            // Create hash of transaction data (MUST match client-side hash format exactly)
            // CRITICAL: Client uses sorted keys: ['amount', 'data', 'from', 'timestamp', 'to']
            // Server MUST use the SAME property order to generate the same hash!
            // CRITICAL: Must use the SAME timestamp that was used for signing!
            const sortedKeys = ['amount', 'data', 'from', 'timestamp', 'to']; // Explicit order matching client
            const dataString = JSON.stringify(transactionData, sortedKeys);
            const msgHash = crypto.createHash('sha256')
                .update(dataString)
                .digest('hex');
            
            console.log('🔐 Server: Transaction data string:', dataString);
            console.log('🔐 Server: Message hash:', msgHash);
            
            // Verify signature using public key from signature object
            if (!signature.r || !signature.s) {
                return {
                    success: false,
                    reason: 'Invalid signature format. Signature must include r and s values.',
                    aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
                };
            }
            
            // CRITICAL FIX: Handle both compressed and uncompressed public keys
            let publicKeyHex = signature.publicKey.replace(/^0x/, '');
            
            // If public key is compressed (66 chars), we need to decompress it
            // Elliptic's keyFromPublic can handle both, but let's ensure format is correct
            if (publicKeyHex.length === 66 && (publicKeyHex.startsWith('02') || publicKeyHex.startsWith('03'))) {
                // Compressed public key - elliptic can handle it, but let's try to get uncompressed
                try {
                    const tempKeyPair = ec.keyFromPublic(publicKeyHex, 'hex');
                    publicKeyHex = tempKeyPair.getPublic(false, 'hex'); // Get uncompressed
                } catch (e) {
                    // If decompression fails, use as-is
                    console.warn('Could not decompress public key, using as-is:', e.message);
                }
            }
            
            const keyPair = ec.keyFromPublic(publicKeyHex, 'hex');
            
            // CRITICAL FIX: Convert hex strings to BN objects for signature verification
            // Elliptic's verify method requires BN objects for r and s
            const BN = require('bn.js');
            const sigObj = {
                r: new BN(signature.r, 16), // Convert hex to BN
                s: new BN(signature.s, 16), // Convert hex to BN
                recoveryParam: signature.recoveryParam || 0
            };
            
            // Verify signature using BN objects
            const isValid = keyPair.verify(msgHash, sigObj);
            
            console.log('🔐 Server: Signature verification result:', isValid);
            
            if (!isValid) {
                // Fallback: Try using wallet manager if wallet exists
                const wallet = this.walletManager.getWallet(from);
                if (wallet) {
                    // Wallet exists in manager, try its verification method
                    if (this.walletManager.verifyTransaction(transactionData, signature)) {
                        // Wallet manager verification passed
                        console.log('✅ Signature verified using wallet manager');
                    } else {
                        return {
                            success: false,
                            reason: 'Invalid transaction signature. Signature verification failed.',
                            aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
                        };
                    }
                } else {
                    return {
                        success: false,
                        reason: 'Invalid transaction signature. Signature verification failed.',
                        aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
                    };
                }
            } else {
                console.log('✅ Signature verified using public key');
            }
        } catch (error) {
            console.error('Signature verification error:', error);
            // Fallback: Try wallet manager verification
            const wallet = this.walletManager.getWallet(from);
            if (wallet) {
                if (this.walletManager.verifyTransaction(transactionData, signature)) {
                    console.log('✅ Signature verified using wallet manager (fallback)');
                } else {
                    return {
                        success: false,
                        reason: 'Signature verification error: ' + error.message,
                        aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
                    };
                }
            } else {
                return {
                    success: false,
                    reason: 'Signature verification error: ' + error.message + '. Wallet not found in manager and signature verification failed.',
                    aiValidation: { valid: false, confidence: 0, agent: 'signature_validator' }
                };
            }
        }

        const transaction = {
            from,
            to,
            amount,
            timestamp: transactionTimestamp, // Use the timestamp that was verified
            data: data || {},
            signature: signature // Signature is mandatory - no fallback
        };

        // ML-based risk prediction
        const historicalData = await this.getTransactionHistory(from);
        const mlRisk = await this.ml.predictTransactionRisk(transaction, historicalData);
        
        // CRITICAL: Balance validation (prevents double spending)
        if (from) { // Not a reward/premine transaction
            const balance = this.getBalance(from);
            if (balance < amount) {
                return {
                    success: false,
                    reason: `Insufficient balance. Current: ${balance}, Required: ${amount}`,
                    aiValidation: { valid: false, confidence: 0, agent: 'balance_validator' }
                };
            }
        }
        
        // AI validation
        const aiValidation = this.aiValidator.validateTransaction(transaction);
        aiValidation.mlRiskScore = mlRisk.riskScore;
        aiValidation.mlConfidence = mlRisk.confidence;
        
        // Combine ML and AI validation
        const finalRisk = Math.max(aiValidation.riskScore || 0, mlRisk.riskScore);
        aiValidation.valid = finalRisk < 0.5;
        aiValidation.combinedRiskScore = finalRisk;
        
        if (aiValidation.valid) {
            this.pendingTransactions.push({
                ...transaction,
                aiValidation: aiValidation
            });
            
            // Save to database
            await this.database.saveTransaction(transaction);
            
            // Broadcast to network (WebSocket if available)
            if (this.network) {
                try {
                    this.network.broadcastTransaction(transaction);
                } catch (error) {
                    console.warn('WebSocket broadcast failed, HTTP P2P will handle it:', error.message);
                }
            }
            
            // HTTP-based P2P broadcast will be handled by the server endpoint
            
            return { success: true, transaction, aiValidation };
        } else {
            return { 
                success: false, 
                reason: aiValidation.reason || `High risk score: ${finalRisk.toFixed(2)}`, 
                aiValidation 
            };
        }
    }

    async getTransactionHistory(address) {
        const allTransactions = [];
        for (const block of this.chain) {
            if (block.transactions) {
                const relevant = block.transactions.filter(tx => 
                    tx.from === address || tx.to === address
                );
                allTransactions.push(...relevant);
            }
        }
        return allTransactions;
    }

    signTransaction(from, to, amount, data) {
        const dataString = `${from}${to}${amount}${JSON.stringify(data)}${Date.now()}`;
        return crypto.createHash('sha256').update(dataString).digest('hex');
    }

    async minePendingTransactions(miningRewardAddress) {
        // CRITICAL: Check if block index was already mined
        const nextBlockIndex = this.chain.length;
        if (this.minedBlockIndices.has(nextBlockIndex)) {
            throw new Error(`Block index ${nextBlockIndex} was already mined. Please wait for the next block.`);
        }
        
        // CRITICAL: Check if this miner already mined this block index
        if (this.minerBlockHistory.has(miningRewardAddress)) {
            const minedIndices = this.minerBlockHistory.get(miningRewardAddress);
            if (minedIndices.includes(nextBlockIndex)) {
                throw new Error(`You already mined block index ${nextBlockIndex}. Please wait for the next block.`);
            }
        }
        
        if (this.pendingTransactions.length === 0) {
            throw new Error('No pending transactions to mine');
        }

        // CRITICAL: Validate all pending transactions before mining (check balances)
        for (const tx of this.pendingTransactions) {
            if (tx.from) { // Not a reward/premine transaction
                const balance = this.getBalance(tx.from);
                if (balance < tx.amount) {
                    throw new Error(`Transaction validation failed: Insufficient balance for ${tx.from}. Current: ${balance}, Required: ${tx.amount}`);
                }
            }
        }

        // CRITICAL: Add mining reward to transactions BEFORE creating block
        // This ensures reward is part of the block hash and prevents duplicate mining
        const rewardTx = {
            from: null,
            to: miningRewardAddress,
            amount: this.miningReward,
            timestamp: Date.now(),
            data: { type: 'mining_reward' },
            signature: this.signTransaction(null, miningRewardAddress, this.miningReward, { type: 'mining_reward' }),
            aiValidation: { valid: true, confidence: 1.0, agent: 'mining' }
        };
        
        // Include reward in block transactions
        const blockTransactions = [...this.pendingTransactions, rewardTx];

        // ML-based mining optimization
        const mlOptimization = await this.ml.optimizeMining(
            { transactions: blockTransactions },
            this.chain
        );
        
        const optimizedDifficulty = mlOptimization.difficulty || this.difficulty;

        const block = {
            index: nextBlockIndex,
            timestamp: Date.now(),
            transactions: blockTransactions, // INCLUDES REWARD
            previousHash: this.getLatestBlock().hash,
            nonce: mlOptimization.suggestedNonce || 0,
            difficulty: optimizedDifficulty
        };

        // AI consensus validation
        const consensusResult = this.aiConsensus.reachConsensus(block, this.chain);
        
        if (!consensusResult.approved) {
            throw new Error(`AI Consensus rejected block: ${consensusResult.reason}`);
        }

        // Anomaly detection
        const anomalies = await this.ml.detectAnomalies(block, this.chain);
        if (anomalies.hasAnomalies) {
            console.warn('⚠️ Anomalies detected:', anomalies.anomalies);
        }

        // Mine the block
        block.hash = this.mineBlock(block, optimizedDifficulty);
        
        // AI validation
        const aiBlockValidation = this.aiValidator.validateBlock(block, this.getLatestBlock());
        block.aiValidation = {
            ...aiBlockValidation,
            mlOptimization: mlOptimization,
            anomalies: anomalies
        };

        // CRITICAL: Mark block index as mined BEFORE adding to chain (prevents race conditions)
        this.minedBlockIndices.add(block.index);
        
        // CRITICAL: Track miner block history
        if (!this.minerBlockHistory.has(miningRewardAddress)) {
            this.minerBlockHistory.set(miningRewardAddress, []);
        }
        this.minerBlockHistory.get(miningRewardAddress).push(block.index);
        
        // Save miner block history to database
        await this.database.saveMinerBlockHistory(miningRewardAddress, block.index, block.hash);
        
        // Add to chain
        this.chain.push(block);
        
        // Save to database
        await this.database.saveBlock(block);
        for (const tx of block.transactions) {
            await this.database.saveTransaction(tx, block.index);
        }
        
        // Clear pending transactions (reward is already in the block)
        this.pendingTransactions = [];
        await this.database.clearPendingTransactions();

        // Broadcast to network (WebSocket if available)
        if (this.network) {
            try {
                this.network.broadcastBlock(block);
            } catch (error) {
                console.warn('WebSocket broadcast failed, HTTP P2P will handle it:', error.message);
            }
        }
        
        // HTTP-based P2P broadcast will be handled by the server endpoint

        // AI analytics update
        this.aiAnalytics.recordBlock(block);
        await this.database.saveAnalytics('block_mined', {
            blockIndex: block.index,
            timestamp: block.timestamp,
            transactionCount: block.transactions.length
        });

        return block;
    }

    mineBlock(block, difficulty) {
        const target = '0'.repeat(difficulty);
        let hash = this.calculateHash(block);

        for (let nonce = block.nonce; nonce < block.nonce + 1000000; nonce++) {
            block.nonce = nonce;
            hash = this.calculateHash(block);
            
            if (hash.substring(0, difficulty) === target) {
                return hash;
            }
        }

        // Fallback
        while (hash.substring(0, difficulty) !== target) {
            block.nonce++;
            hash = this.calculateHash(block);
        }

        return hash;
    }

    calculateHash(block) {
        return crypto.createHash('sha256')
            .update(block.index + block.previousHash + block.timestamp + JSON.stringify(block.transactions) + block.nonce)
            .digest('hex');
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    getBalance(address) {
        if (!address) {
            console.warn('⚠️ getBalance called with null/undefined address');
            return 0;
        }
        
        // CRITICAL: Normalize address to lowercase for case-insensitive comparison
        const normalizedAddress = address.toLowerCase();
        let balance = 0;
        
        console.log(`🔍 Calculating balance for address: ${address} (normalized: ${normalizedAddress})`);
        console.log(`📊 Chain has ${this.chain.length} blocks`);

        // Check all blocks
        for (let blockIndex = 0; blockIndex < this.chain.length; blockIndex++) {
            const block = this.chain[blockIndex];
            if (block.transactions && Array.isArray(block.transactions)) {
                console.log(`  📦 Block ${block.index || blockIndex} has ${block.transactions.length} transactions`);
                for (let txIndex = 0; txIndex < block.transactions.length; txIndex++) {
                    const transaction = block.transactions[txIndex];
                    // Case-insensitive comparison
                    const fromAddr = transaction.from ? transaction.from.toLowerCase() : null;
                    const toAddr = transaction.to ? transaction.to.toLowerCase() : null;
                    
                    // CRITICAL: Handle premine transactions (from is null)
                    if (fromAddr === normalizedAddress) {
                        balance -= transaction.amount || 0;
                        console.log(`  ➖ Debit: ${transaction.amount} (from transaction ${transaction.id || transaction.hash || txIndex})`);
                    }
                    if (toAddr === normalizedAddress) {
                        balance += transaction.amount || 0;
                        const txType = transaction.data?.type || 'normal';
                        console.log(`  ➕ Credit: ${transaction.amount} (${txType} transaction ${transaction.id || transaction.hash || txIndex})`);
                    }
                    
                    // Also check if this is a premine transaction to this address
                    if (transaction.from === null && toAddr === normalizedAddress) {
                        // This is already handled above, but log it specifically
                        if (transaction.data?.type === 'premine') {
                            console.log(`  🎁 Premine transaction found: ${transaction.amount} NCHEESE`);
                        }
                    }
                }
            } else {
                console.log(`  ⚠️ Block ${block.index || blockIndex} has no transactions array`);
            }
        }

        // Check pending transactions
        for (const transaction of this.pendingTransactions) {
            const fromAddr = transaction.from ? transaction.from.toLowerCase() : null;
            const toAddr = transaction.to ? transaction.to.toLowerCase() : null;
            
            if (fromAddr === normalizedAddress) {
                balance -= transaction.amount || 0;
                console.log(`  ➖ Pending debit: ${transaction.amount}`);
            }
            if (toAddr === normalizedAddress) {
                balance += transaction.amount || 0;
                console.log(`  ➕ Pending credit: ${transaction.amount}`);
            }
        }

        console.log(`💰 Final balance for ${address}: ${balance}`);
        return balance;
    }

    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];

            if (currentBlock.hash !== this.calculateHash(currentBlock)) {
                return false;
            }

            if (currentBlock.previousHash !== previousBlock.hash) {
                return false;
            }

            if (!currentBlock.aiValidation || !currentBlock.aiValidation.validated) {
                return false;
            }
        }

        return true;
    }

    async deploySmartContract(contractCode, deployer) {
        const contract = {
            address: this.generateAddress(),
            code: contractCode,
            deployer,
            timestamp: Date.now(),
            state: {},
            aiAgent: null // Would use AISmartContractAgent
        };

        const validation = this.aiValidator.validateSmartContract(contract);
        if (validation.valid) {
            this.smartContracts.push(contract);
            await this.database.saveSmartContract(contract);
            return { success: true, contract, aiValidation: validation };
        } else {
            return { success: false, reason: validation.reason };
        }
    }

    generateAddress() {
        return '0x' + crypto.randomBytes(20).toString('hex');
    }

    getAIAnalytics() {
        return this.aiAnalytics.getInsights(this.chain);
    }

    async getAIPredictions() {
        const networkStats = this.network ? { peerCount: this.network.getPeers().length } : null;
        const health = await this.ml.predictNetworkHealth(this.chain, networkStats);
        return {
            ...this.aiAnalytics.predict(this.chain),
            networkHealth: health
        };
    }

    async close() {
        if (this.database) {
            await this.database.close();
        }
    }
}

module.exports = EnhancedHybridBlockchainAI;

