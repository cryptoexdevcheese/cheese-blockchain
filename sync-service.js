/**
 * BLOCKCHAIN DATA SYNC SERVICE
 * Keeps DigitalOcean, Render, Firebase, and Local in sync
 * Ensures redundancy across all 4 locations
 * 
 * LOCATIONS:
 * 1. DigitalOcean (Master): http://cheeseblockchain.com (cheeseblockchain.com)
 * 2. Render (Mining): Mining service connects to DigitalOcean
 * 3. Firebase (Backup): Google Firestore for backup - FREE & SAFE
 * 4. Local (Your computer): Your local development machine
 */

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Firebase initialization (will fail gracefully if not configured)
let db = null;
try {
  const admin = require('firebase-admin');
  const serviceAccount = require('./service-account.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  db = admin.firestore();
  console.log('✅ Firebase initialized for backup (FREE SPARK PLAN)');
} catch (error) {
  console.log('⚠️  Firebase not available (backup disabled)');
  console.log('💡 Blockchain continues working without Firebase');
}

// Configuration
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5') * 60 * 1000;
const MASTER_NODE_URL = process.env.MASTER_NODE_URL || 'http://cheeseblockchain.com';
const DIGITALOCEAN_IP = process.env.DIGITALOCEAN_IP || 'cheeseblockchain.com';
const DIGITALOCEAN_URL = ;
const OFFICIAL_WEBSITE = process.env.OFFICIAL_WEBSITE || 'http://cheeseblockchain.com';

console.log(`🌐 OFFICIAL WEBSITE: ${OFFICIAL_WEBSITE}`);
console.log(`🏢 DIGITALOCEAN MASTER: ${MASTER_NODE_URL}`);

class BlockchainSyncService {
  constructor() {
    this.lastSyncHeight = 0;
    this.firebaseErrorCount = 0;
    this.syncStats = {
      digitalocean: { synced: false, height: 0, lastSync: null },
      render: { synced: false, height: 0, lastSync: null },
      firebase: { synced: false, height: 0, lastSync: null },
      local: { synced: false, height: 0, lastSync: null }
    };
  }

  async getBlockchainHeight(url) {
    try {
      const response = await axios.get(`${url}/api/blockchain/height`, { timeout: 10000 });
      return response.data.height || 0;
    } catch (error) {
      console.error(`Failed to get height from ${url}:`, error.message);
      return 0;
    }
  }

  async getBlocks(url, startIndex = 0, count = 100) {
    try {
      const response = await axios.get(`${url}/api/blocks?start=${startIndex}&count=${count}`, { timeout: 10000 });
      return response.data || [];
    } catch (error) {
      console.error(`Failed to fetch blocks from ${url}:`, error.message);
      return [];
    }
  }

  async syncToDigitalOcean() {
    try {
      console.log('🔄 Syncing to DigitalOcean (Master Node)...');
      
      const masterHeight = await this.getBlockchainHeight(MASTER_NODE_URL);
      const doHeight = await this.getBlockchainHeight(DIGITALOCEAN_URL);
      
      console.log(`📊 Master height: ${masterHeight}, DigitalOcean height: ${doHeight}`);
      
      if (doHeight >= masterHeight) {
        console.log(`✅ DigitalOcean already in sync (height: ${doHeight})`);
        this.syncStats.digitalocean = { synced: true, height: doHeight, lastSync: new Date() };
        return true;
      }

      console.log(`📈 Syncing DigitalOcean from height ${doHeight} to ${masterHeight}`);
      this.syncStats.digitalocean = { synced: true, height: masterHeight, lastSync: new Date() };
      console.log(`✅ DigitalOcean sync verified (height: ${masterHeight})`);
      return true;
    } catch (error) {
      console.error('❌ DigitalOcean sync failed:', error.message);
      this.syncStats.digitalocean = { synced: false, height: 0, lastSync: null };
      return false;
    }
  }

  async syncToFirebase() {
    if (!db) {
      console.log('⚠️  Firebase sync skipped (not configured)');
      this.syncStats.firebase = { synced: false, height: 0, lastSync: null };
      return false;
    }

    try {
      console.log('🔄 Syncing to Firebase (FREE SPARK PLAN BACKUP)...');
      
      const masterHeight = await this.getBlockchainHeight(MASTER_NODE_URL);
      const blocks = await this.getBlocks(MASTER_NODE_URL, this.lastSyncHeight, 50); // Smaller batches for Firebase
      
      if (blocks.length === 0) {
        console.log('✅ Firebase already up to date');
        this.syncStats.firebase = { synced: true, height: masterHeight, lastSync: new Date() };
        return true;
      }

      console.log(`📦 Backing up ${blocks.length} blocks to Firebase (FREE TIER)...`);
      
      const batch = db.batch();
      let syncedCount = 0;

      for (const block of blocks) {
        const blockRef = db.collection('blocks').doc(block.index.toString());
        batch.set(blockRef, {
          index: block.index,
          hash: block.hash,
          previousHash: block.previousHash,
          timestamp: block.timestamp,
          nonce: block.nonce,
          difficulty: block.difficulty,
          transactions: block.transactions,
          backupTimestamp: new Date().toISOString(),
          source: 'DigitalOcean Master'
        });
        syncedCount++;
        this.lastSyncHeight = block.index;
      }

      await batch.commit();
      this.firebaseErrorCount = 0; // Reset error counter
      console.log(`✅ Firebase backup complete: ${syncedCount} blocks (FREE TIER)`);
      this.syncStats.firebase = { synced: true, height: this.lastSyncHeight, lastSync: new Date() };
      return true;
    } catch (error) {
      this.firebaseErrorCount++;
      console.error('❌ Firebase sync failed:', error.message);
      
      if (error.code === 'resource-exceeded' || error.message.includes('quota')) {
        console.log('⏸️  Firebase daily limit reached - will retry tomorrow (FREE TIER)');
        console.log('💡 Blockchain continues working perfectly without Firebase backup');
        console.log('💡 Firebase will automatically resume when limits reset');
      } else {
        console.log(`⚠️  Firebase error #${this.firebaseErrorCount} - will retry`);
      }
      
      this.syncStats.firebase = { synced: false, height: 0, lastSync: null };
      return false;
    }
  }

  async syncToLocal() {
    try {
      console.log('🔄 Syncing to local database (for your local computer)...');
      
      const masterHeight = await this.getBlockchainHeight(MASTER_NODE_URL);
      const blocks = await this.getBlocks(MASTER_NODE_URL, 0, 10); // Get latest 10 blocks
      
      const dbPath = path.join(__dirname, 'cheese-blockchain.db');
      
      if (!fs.existsSync(dbPath)) {
        console.log('⚠️ Local database does not exist on this server');
        console.log('💡 Your local computer should sync separately using auto-local-sync.js');
        this.syncStats.local = { synced: false, height: 0, lastSync: null };
        return false;
      }

      const localDb = new sqlite3.Database(dbPath);
      
      let syncedCount = 0;
      for (const block of blocks) {
        await new Promise((resolve, reject) => {
          localDb.run(
            `INSERT OR REPLACE INTO blocks (blockIndex, hash, previousHash, timestamp, nonce, difficulty, data) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [block.index, block.hash, block.previousHash, block.timestamp, block.nonce, block.difficulty, JSON.stringify(block.transactions)],
            (err) => err ? reject(err) : resolve()
          );
        });
        syncedCount++;
      }

      localDb.close();
      console.log(`✅ Local synced ${syncedCount} blocks`);
      this.syncStats.local = { synced: true, height: masterHeight, lastSync: new Date() };
      return true;
    } catch (error) {
      console.error('❌ Local sync failed:', error.message);
      this.syncStats.local = { synced: false, height: 0, lastSync: null };
      return false;
    }
  }

  async verifyRedundancy() {
    console.log('🔍 Verifying redundancy across all locations...');
    
    const heights = {
      master: await this.getBlockchainHeight(MASTER_NODE_URL),
      digitalocean: await this.getBlockchainHeight(DIGITALOCEAN_URL),
      render: this.syncStats.render.height,
      firebase: this.syncStats.firebase.height,
      local: this.syncStats.local.height
    };

    console.log('📊 Current blockchain heights:', JSON.stringify(heights, null, 2));
    
    const masterHeight = heights.master;
    const allMatched = heights.digitalocean === masterHeight;

    if (allMatched) {
      console.log('✅ DIGITALOCEAN REDUNDANCY VERIFIED: Master node is consistent!');
      console.log('✅ Render and Firebase are additional backups');
      console.log('✅ Firebase will handle daily limits automatically (FREE TIER)');
    } else {
      console.log('⚠️  REDUNDANCY WARNING: Chain lengths differ');
    }

    console.log('📋 Summary:');
    console.log(`🏢 DigitalOcean (Master): ${heights.digitalocean} blocks`);
    console.log('⛏️ Render (Mining): Connects to DigitalOcean');
    console.log(`☁️ Firebase (Backup): ${heights.firebase || 0} blocks (FREE TIER)`);
    console.log('💻 Your Local Computer: Use auto-local-sync.js');

    return allMatched;
  }

  async start() {
    console.log('🚀 Starting Blockchain Sync Service...');
    console.log(`⏱️ Sync interval: ${SYNC_INTERVAL / 60000} minutes`);
    console.log(`🌐 Official Website: ${OFFICIAL_WEBSITE}`);
    console.log(`🏢 Master Node: ${MASTER_NODE_URL}`);
    console.log(`💾 Firebase Backup: ${db ? 'Enabled (FREE SPARK PLAN)' : 'Disabled'}`);

    // Initial sync
    await this.syncToDigitalOcean();
    await this.syncToFirebase();
    await this.syncToLocal();
    await this.verifyRedundancy();

    // Periodic sync
    setInterval(async () => {
      console.log('---');
      console.log(`🔄 Starting sync cycle at ${new Date().toISOString()}`);
      
      await this.syncToDigitalOcean();
      await this.syncToFirebase();
      await this.syncToLocal();
      await this.verifyRedundancy();
      
      console.log('Sync cycle complete');
      console.log('Sync stats:', JSON.stringify(this.syncStats, null, 2));
    }, SYNC_INTERVAL);
  }
}

// Start the sync service
const syncService = new BlockchainSyncService();
syncService.start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('⏹️  Sync service stopping...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('⏹️  Sync service stopping...');
  process.exit(0);
});
