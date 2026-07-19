/**
 * DEDICATED MINING SERVICE FOR RENDER
 * Handles mining operations separately from main blockchain node
 * Connects to DigitalOcean main blockchain at cheeseblockchain.com
 */

const axios = require('axios');
const crypto = require('crypto');

const MASTER_NODE_URL = process.env.MASTER_NODE_URL || 'http://cheeseblockchain.com';
const API_KEY = process.env.API_KEY;
const MINING_INTERVAL = 30000; // 30 seconds between mining attempts

console.log(`🔗 Mining Service configured to connect to: ${MASTER_NODE_URL}`);
console.log(`🔑 API Key: ${API_KEY ? 'SET' : 'MISSING - mining will fail'}`);

class MiningService {
  constructor() {
    this.isRunning = false;
    this.blocksMined = 0;
    this.failedAttempts = 0;
  }

  async getLatestBlock() {
    try {
      const response = await axios.get(`${MASTER_NODE_URL}/api/blocks/latest`, {
        headers: { 'X-API-Key': API_KEY },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch latest block from DigitalOcean:', error.message);
      this.failedAttempts++;
      return null;
    }
  }

  async getPendingTransactions() {
    try {
      const response = await axios.get(`${MASTER_NODE_URL}/api/transactions/pending`, {
        headers: { 'X-API-Key': API_KEY },
        timeout: 10000
      });
      return response.data || [];
    } catch (error) {
      console.error('Failed to fetch pending transactions from DigitalOcean:', error.message);
      return [];
    }
  }

  async submitBlock(blockData) {
    try {
      const response = await axios.post(`${MASTER_NODE_URL}/api/blocks`, blockData, {
        headers: { 
          'Content-Type': 'application/json', 
          'X-API-Key': API_KEY 
        },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Failed to submit block to DigitalOcean:', error.message);
      return null;
    }
  }

  async mineBlock() {
    console.log('⛏️  Starting mining round...');
    console.log(`📊 Connection: ${MASTER_NODE_URL}`);
    console.log(`🔑 API Key: ${API_KEY ? 'Present' : 'MISSING'}`);
    
    const latestBlock = await this.getLatestBlock();
    if (!latestBlock) {
      console.error('❌ Cannot mine: Could not fetch latest block from DigitalOcean');
      console.error('💡 Check if MASTER_NODE_URL and API_KEY are correct');
      return;
    }

    console.log(`📦 Latest block from DigitalOcean: #${latestBlock.index || latestBlock.blockIndex}`);
    const pendingTransactions = await this.getPendingTransactions();
    console.log(`💰 Found ${pendingTransactions.length} pending transactions`);

    // Simple mining algorithm
    const newBlock = {
      index: (latestBlock.index || latestBlock.blockIndex) + 1,
      timestamp: Date.now(),
      transactions: pendingTransactions,
      previousHash: latestBlock.hash || latestBlock.previousHash,
      nonce: 0,
      difficulty: latestBlock.difficulty || 2
    };

    console.log(`🎯 Mining block #${newBlock.index} with difficulty ${newBlock.difficulty}...`);

    // Proof of Work
    let hash = this.calculateHash(newBlock);
    let attempts = 0;
    while (!this.isValidHash(hash, newBlock.difficulty)) {
      newBlock.nonce++;
      hash = this.calculateHash(newBlock);
      attempts++;
      
      // Progress reporting
      if (attempts % 1000 === 0) {
        console.log(`⚡ Mining attempt ${attempts}...`);
      }
      
      // Prevent infinite loop (security measure)
      if (attempts > 100000) {
        console.log('⏱️ Mining attempt limit reached, starting new round');
        return;
      }
    }

    newBlock.hash = hash;
    console.log(`✅ Block mined! Hash: ${hash.substring(0, 20)}... (${attempts} attempts)`);

    // Submit to DigitalOcean master node
    console.log(`📤 Submitting to DigitalOcean: ${MASTER_NODE_URL}`);
    const result = await this.submitBlock(newBlock);
    if (result && result.success) {
      this.blocksMined++;
      this.failedAttempts = 0; // Reset failure counter
      console.log(`🎉 Block #${newBlock.index} successfully submitted to DigitalOcean!`);
      console.log(`📊 Total blocks mined: ${this.blocksMined}`);
    } else {
      this.failedAttempts++;
      console.log(`❌ Block submission failed. Failed attempts: ${this.failedAttempts}`);
    }
  }

  calculateHash(block) {
    const data = block.index + block.previousHash + block.timestamp + JSON.stringify(block.transactions) + block.nonce;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  isValidHash(hash, difficulty) {
    const prefix = '0'repeat(difficulty);
    return hash.startsWith(prefix);
  }

  async start() {
    console.log('🚀 Starting Mining Service...');
    console.log(`🌐 Master Node (DigitalOcean): ${MASTER_NODE_URL}`);
    console.log(`⏱️ Mining interval: ${MINING_INTERVAL/1000} seconds`);
    
    this.isRunning = true;
    
    // Mining loop
    setInterval(async () => {
      if (this.isRunning) {
        await this.mineBlock();
      }
    }, MINING_INTERVAL);

    // Health check endpoint
    if (typeof require !== 'undefined') {
      try {
        const express = require('express');
        const app = express();
        const PORT = process.env.PORT || 3000;
        
        app.get('/mining-health', (req, res) => {
          res.json({
            status: 'healthy',
            isRunning: this.isRunning,
            blocksMined: this.blocksMined,
            masterNode: MASTER_NODE_URL,
            failedAttempts: this.failedAttempts,
            uptime: process.uptime()
          });
        });

        app.listen(PORT, () => {
          console.log(`✅ Mining service health check on port ${PORT}`);
        });
      } catch (error) {
        console.log('⚠️ Express not available, health check endpoint disabled');
      }
    }
  }

  stop() {
    this.isRunning = false;
    console.log('⏹️  Mining service stopped');
  }
}

// Start the mining service
const miningService = new MiningService();
miningService.start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('⏹️  Mining service stopping...');
  miningService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('⏹️  Mining service stopping...');
  miningService.stop();
  process.exit(0);
});
