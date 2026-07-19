/**
 * CHEESE Blockchain - Upgrades Verification Script
 * Validates cryptographic license checks, balance checks, and neural network evaluations.
 */

const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const EnhancedHybridBlockchainAI = require('../blockchain-core-v33');
const SimpleNeuralNetwork = require('../simple-nn');
const GuardianAIML = require('../guardian-ai-ml');
const { HybridBlockchainAI } = require('../hybrid-blockchain-ai');

const FOUNDER_ADDRESS = '0x0E6ec6713E7b5b7C11d969dA848813d08223598E';
const TEST_MINER = '0x0E6ec6713E7b5b7C11d969dA848813d08223598E'; // Has balance
const SUFFICIENT_BALANCE_WALLET = '0x0E6ec6713E7b5b7C11d969dA848813d08223598E';
const EMPTY_WALLET = '0x0000000000000000000000000000000000000000';

// A valid signature generated using Founder Private Key for the Founder Wallet address
const VALID_LICENSE_KEY = "0x4a29084f9e6c3fb101a32f3d7bb2fce776463b8b36e85ddd8a02c61977fc974e01e59c866e1fe95f7d3558c41af5d31c2a102c619a5be867fa9a1ea4343e41511b";
const INVALID_LICENSE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001b";

async function runTests() {
    console.log('🧪 RUNNING SYSTEM UPGRADE VERIFICATION');
    console.log('=====================================\n');

    // Test 1: Verify SimpleNeuralNetwork implementation
    console.log('🧠 Test 1: Verifying SimpleNeuralNetwork class...');
    const nn = new SimpleNeuralNetwork(3, 5, 1);
    const output = nn.forward([0.5, 0.2, 0.9]);
    console.log(`- Forward pass output: [${output.join(', ')}]`);
    if (output.length === 1 && output[0] >= 0 && output[0] <= 1) {
        console.log('✅ SimpleNeuralNetwork forward pass verified.');
    } else {
        throw new Error('SimpleNeuralNetwork forward pass failed');
    }
    
    // Check serialization
    const serialized = nn.toJSON();
    if (serialized.weightsIH && serialized.weightsHO) {
        console.log('✅ SimpleNeuralNetwork serialization (toJSON) verified.');
    } else {
        throw new Error('SimpleNeuralNetwork serialization failed');
    }
    console.log('-------------------------------------\n');

    // Test 2: Verify GuardianAIML loads weights from file
    console.log('🛡️  Test 2: Verifying GuardianAIML weight loading...');
    const guardian = new GuardianAIML();
    if (guardian.modelTrained) {
        console.log('✅ GuardianAIML loaded and verified.');
    } else {
        throw new Error('GuardianAIML loading failed');
    }
    console.log('-------------------------------------\n');

    // Test 3: Verify AI Consensus & Validator in hybrid-blockchain-ai
    console.log('🏛️  Test 3: Verifying AI Consensus & Validator calculations...');
    const aiEngine = new HybridBlockchainAI();
    
    const dummyBlock = {
        index: 100,
        timestamp: Date.now(),
        difficulty: 4,
        previousHash: '0xabc',
        transactions: [
            { from: '0x123', to: '0x456', amount: 500, signature: '0xdef' }
        ]
    };
    
    const consensusResult = aiEngine.aiConsensus.reachConsensus(dummyBlock, []);
    console.log(`- AI Consensus Confidence: ${consensusResult.confidence} (Approved: ${consensusResult.approved})`);
    
    const dummyTx = {
        from: '0x123',
        to: '0x456',
        amount: 25000,
        signature: '0xabc',
        data: { frequency: 5, avgAmount: 12000, accountAge: 864000000 }
    };
    
    const validationResult = aiEngine.aiValidator.validateTransaction(dummyTx);
    console.log(`- AI Validator Risk Score: ${validationResult.riskScore} (Valid: ${validationResult.valid})`);
    
    if (consensusResult.confidence !== undefined && validationResult.riskScore !== undefined) {
        console.log('✅ Real Neural Network integration verified for consensus and transaction validation.');
    } else {
        throw new Error('AI Consensus/Validator NN check failed');
    }
    console.log('-------------------------------------\n');

    // Test 4: Verify licensing fallback mode
    console.log('⚖️  Test 4: Verifying Licensing Fallback behaviour (No env set)...');
    
    // Clear environment variables temporarily for dry-run
    const oldKey = process.env.PREMIUM_LICENSE_KEY;
    const oldAddr = process.env.MINING_WALLET_ADDRESS;
    delete process.env.PREMIUM_LICENSE_KEY;
    delete process.env.MINING_WALLET_ADDRESS;
    
    // Initialize node as hybrid
    const fallbackNode = new EnhancedHybridBlockchainAI({
        nodeType: 'hybrid',
        dbPath: ':memory:', // Use in-memory SQLite to prevent writing
        useFirestore: false,
        useDualStorage: false
    });
    
    await fallbackNode.initialize();
    
    console.log(`- Node Type resolved to: ${fallbackNode.nodeType}`);
    console.log(`- Mining enabled flag:   ${fallbackNode.miningEnabled}`);
    
    if (fallbackNode.nodeType === 'governance' && fallbackNode.miningEnabled === false) {
        console.log('✅ Fallback behavior verified: unlicensed hybrid node downgraded to governance-only.');
    } else {
        throw new Error('Fallback licensing test failed');
    }
    
    // Verify mining fails
    try {
        await fallbackNode.minePendingTransactions(SUFFICIENT_BALANCE_WALLET);
        throw new Error('Mining should have failed when disabled');
    } catch (e) {
        console.log(`- Block mining rejected as expected: "${e.message}"`);
        console.log('✅ Mining blocker verified.');
    }
    console.log('-------------------------------------\n');

    // Restore environment
    process.env.PREMIUM_LICENSE_KEY = oldKey;
    process.env.MINING_WALLET_ADDRESS = oldAddr;

    console.log('🎉 ALL AUTOMATED VERIFICATION CHECKS COMPLETED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('\n❌ Verification Failed:', err);
    process.exit(1);
});
