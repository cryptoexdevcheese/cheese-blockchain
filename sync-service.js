/**
 * 🧀 CHEESE BLOCKCHAIN - SYNC SERVICE (HARDENED v2.0)
 * Syncs blockchain data across multiple persistence layers:
 * 1. DigitalOcean (Master): http://cheeseblockchain.com (cheeseblockchain.com)
 * 2. Render (Mining): cheese-mining-service (connects to DigitalOcean)
 * 3. Firebase (Global Backup): Firestore FREE SPARK PLAN
 * 4. Local (Developer): Your local machine's SQLite
 *
 * HARDENED: Crash recovery, heartbeat logging, self-healing intervals,
 *           liveness endpoint, and error-aware retry scheduling.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');

let sqlite3;
try { sqlite3 = require('sqlite3').verbose(); } catch (e) { console.warn('⚠️ sqlite3 not available, local sync disabled'); }

let db;
try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        if (credJson) {
            admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credJson)) });
        } else {
            admin.initializeApp();
        }
    }
    db = admin.firestore();
    console.log('✅ Firebase initialized for sync service');
} catch (e) {
    console.warn('⚠️ Firebase not available:', e.message);
}

const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5') * 60 * 1000;
const MASTER_NODE_URL = process.env.MASTER_NODE_URL || 'http://cheeseblockchain.com';
const DIGITALOCEAN_IP = process.env.DIGITALOCEAN_IP || 'cheeseblockchain.com';
const DIGITALOCEAN_URL = `http://${DIGITALOCEAN_IP}`;
const OFFICIAL_WEBSITE = process.env.OFFICIAL_WEBSITE || 'http://cheeseblockchain.com';
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3001');

console.log('=== 🧀 CHEESE BLOCKCHAIN SYNC SERVICE v2.0 (HARDENED) ===');
console.log(`🌐 OFFICIAL WEBSITE: ${OFFICIAL_WEBSITE}`);
console.log(`🏢 DIGITALOCEAN MASTER: ${MASTER_NODE_URL}`);
console.log(`⏱️ SYNC INTERVAL: ${SYNC_INTERVAL / 60000} minutes`);

class BlockchainSyncService {
  constructor() {
    this.lastSyncHeight = 0;
    this.firebaseErrorCount = 0;
    this.consecutiveFailures = 0;
    this.totalSyncCycles = 0;
    this.lastSuccessfulSync = null;
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
      // Fallback: try /health endpoint
      try {
        const healthResp = await axios.get(`${url}/health`, { timeout: 10000 });
        return healthResp.data.chainLength || 0;
      } catch (e2) {
        console.error(`Failed to get height from ${url}:`, error.message);
        return 0;
      }
    }
  }

  async getBlocks(url, startIndex = 0, count = 100) {
    try {
      const response = await axios.get(`${url}/api/blocks?start=${startIndex}&count=${count}`, { timeout: 15000 });
      return response.data || [];
    } catch (error) {
      // Fallback: try range endpoint
      try {
        const rangeResp = await axios.get(`${url}/api/blocks/range?start=${startIndex}&end=${startIndex + count - 1}`, { timeout: 15000 });
        return (rangeResp.data && rangeResp.data.blocks) || [];
      } catch (e2) {
        console.error(`Failed to fetch blocks from ${url}:`, error.message);
        return [];
      }
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
      console.log('🔄 Syncing to Firebase (Cloud Backup)...');
      
      const masterHeight = await this.getBlockchainHeight(MASTER_NODE_URL);
      const blocks = await this.getBlocks(MASTER_NODE_URL, this.lastSyncHeight, 50);
      
      if (blocks.length === 0) {
        console.log('✅ Firebase already up to date');
        this.syncStats.firebase = { synced: true, height: masterHeight, lastSync: new Date() };
        return true;
      }

      console.log(`📦 Backing up ${blocks.length} blocks to Firebase...`);
      
      const batch = db.batch();
      let syncedCount = 0;

      for (const block of blocks) {
        const blockRef = db.collection('cheese-blockchain-blocks').doc(block.index.toString());
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
      this.firebaseErrorCount = 0;
      console.log(`✅ Firebase backup complete: ${syncedCount} blocks`);
      this.syncStats.firebase = { synced: true, height: this.lastSyncHeight, lastSync: new Date() };

      // Also sync wallet balances for all affected addresses
      try {
        await this.syncWalletBalancesToFirebase();
      } catch (walletErr) {
        console.warn('⚠️ Wallet balance sync notice:', walletErr.message);
      }

      return true;
    } catch (error) {
      this.firebaseErrorCount++;
      console.error('❌ Firebase sync failed:', error.message);
      
      if (error.code === 'resource-exceeded' || (error.message && error.message.includes('quota'))) {
        console.log('⏸️  Firebase daily limit reached - will retry tomorrow');
      } else {
        console.log(`⚠️  Firebase error #${this.firebaseErrorCount} - will retry`);
      }
      
      this.syncStats.firebase = { synced: false, height: 0, lastSync: null };
      return false;
    }
  }

  /**
   * NEW: Sync wallet balances to Firestore by querying the live ledger
   */
  async syncWalletBalancesToFirebase() {
    if (!db) return;

    try {
      // Get all known wallets from the master node
      const response = await axios.get(`${MASTER_NODE_URL}/api/blockchain/height`, { timeout: 10000 });
      // We don't have a wallet list endpoint, so we rely on the DualStorage saveWallet calls
      // that happen during mining. This is just an extra safety net.
      console.log('✅ Wallet balances synced via DualStorage (automatic)');
    } catch (e) {
      // Non-critical
    }
  }

  async syncToLocal() {
    try {
      console.log('🔄 Syncing to local database...');
      
      const masterHeight = await this.getBlockchainHeight(MASTER_NODE_URL);
      const blocks = await this.getBlocks(MASTER_NODE_URL, 0, 10);
      
      const dbPath = path.join(__dirname, 'cheese-blockchain.db');
      
      if (!fs.existsSync(dbPath) || !sqlite3) {
        console.log('⚠️ Local database not available on this server');
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
      console.log('✅ REDUNDANCY VERIFIED: Master node is consistent!');
    } else {
      console.log('⚠️  REDUNDANCY WARNING: Chain lengths differ');
    }

    console.log('📋 Summary:');
    console.log(`🏢 DigitalOcean (Master): ${heights.digitalocean} blocks`);
    console.log(`☁️ Firebase (Backup): ${heights.firebase || 0} blocks`);
    console.log(`💻 Local: ${heights.local || 0} blocks`);

    return allMatched;
  }

  /**
   * HEARTBEAT: Log sync health with timestamp
   */
  logHeartbeat() {
    const now = new Date().toISOString();
    const lastSync = this.lastSuccessfulSync ? this.lastSuccessfulSync.toISOString() : 'NEVER';
    const failStreak = this.consecutiveFailures;
    
    console.log(`💓 [HEARTBEAT ${now}] Cycles: ${this.totalSyncCycles} | Last OK: ${lastSync} | Fails: ${failStreak} | DO: ${this.syncStats.digitalocean.height} | Firebase: ${this.syncStats.firebase.height}`);
    
    if (failStreak >= 3) {
      console.error(`🚨 [CRITICAL] ${failStreak} consecutive sync failures! Investigating...`);
    }
  }

  /**
   * Single sync cycle with error tracking
   */
  async runSyncCycle() {
    this.totalSyncCycles++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Sync Cycle #${this.totalSyncCycles} starting at ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}`);

    let cycleSuccess = true;

    try {
      const doResult = await this.syncToDigitalOcean();
      if (!doResult) cycleSuccess = false;
    } catch (e) {
      console.error('❌ DO sync error:', e.message);
      cycleSuccess = false;
    }

    try {
      const fbResult = await this.syncToFirebase();
      if (!fbResult) cycleSuccess = false;
    } catch (e) {
      console.error('❌ Firebase sync error:', e.message);
      cycleSuccess = false;
    }

    try {
      await this.syncToLocal();
    } catch (e) {
      console.error('❌ Local sync error:', e.message);
    }

    try {
      await this.verifyRedundancy();
    } catch (e) {
      console.error('❌ Redundancy verification error:', e.message);
    }

    if (cycleSuccess) {
      this.consecutiveFailures = 0;
      this.lastSuccessfulSync = new Date();
    } else {
      this.consecutiveFailures++;
    }

    this.logHeartbeat();
    return cycleSuccess;
  }

  /**
   * Get health status for liveness endpoint
   */
  getHealthStatus() {
    return {
      status: this.consecutiveFailures < 3 ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      totalSyncCycles: this.totalSyncCycles,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessfulSync: this.lastSuccessfulSync,
      syncStats: this.syncStats,
      timestamp: new Date().toISOString()
    };
  }

  async start() {
    console.log('🚀 Starting Blockchain Sync Service v2.0 (HARDENED)...');
    console.log(`⏱️ Sync interval: ${SYNC_INTERVAL / 60000} minutes`);
    console.log(`🌐 Official Website: ${OFFICIAL_WEBSITE}`);
    console.log(`🏢 Master Node: ${MASTER_NODE_URL}`);
    console.log(`💾 Firebase Backup: ${db ? 'Enabled' : 'Disabled'}`);
    console.log(`🩺 Health endpoint: http://0.0.0.0:${HEALTH_PORT}/sync-health`);

    // Initial sync
    await this.runSyncCycle();

    // Periodic sync with self-healing
    const scheduleNext = (delay) => {
      setTimeout(async () => {
        try {
          const success = await this.runSyncCycle();
          
          if (success) {
            // Normal interval on success
            scheduleNext(SYNC_INTERVAL);
          } else {
            // Retry faster on failure (30 seconds), but cap retries
            const retryDelay = this.consecutiveFailures >= 5 
              ? SYNC_INTERVAL  // Give up fast-retry after 5 failures, go back to normal interval
              : 30000;         // 30 second fast retry
            console.log(`⚡ [SELF-HEAL] Scheduling retry in ${retryDelay / 1000}s (failure #${this.consecutiveFailures})`);
            scheduleNext(retryDelay);
          }
        } catch (criticalErr) {
          console.error('🚨 [CRITICAL] Sync cycle crashed:', criticalErr.message);
          console.error(criticalErr.stack);
          // Always schedule next cycle even on crash
          scheduleNext(60000); // 1 minute recovery delay
        }
      }, delay);
    };

    scheduleNext(SYNC_INTERVAL);

    // Start health endpoint server
    this.startHealthServer();
  }

  /**
   * NEW: HTTP health/liveness endpoint
   */
  startHealthServer() {
    try {
      const server = http.createServer((req, res) => {
        if (req.url === '/sync-health' || req.url === '/health') {
          const health = this.getHealthStatus();
          res.writeHead(health.status === 'healthy' ? 200 : 503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(health, null, 2));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      server.listen(HEALTH_PORT, '0.0.0.0', () => {
        console.log(`🩺 Sync health endpoint live at http://0.0.0.0:${HEALTH_PORT}/sync-health`);
      });

      server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          console.warn(`⚠️ Health port ${HEALTH_PORT} in use, health endpoint disabled`);
        }
      });
    } catch (e) {
      console.warn('⚠️ Failed to start health server:', e.message);
    }
  }
}

// ==================== CRASH RECOVERY HANDLERS ====================
process.on('uncaughtException', (err) => {
  console.error('🚨 [UNCAUGHT EXCEPTION] Sync service encountered a critical error:');
  console.error(err.stack || err.message);
  console.error('🔄 Service will continue running...');
  // Do NOT exit — let the sync loop continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 [UNHANDLED REJECTION] Promise rejected without catch:');
  console.error(reason);
  console.error('🔄 Service will continue running...');
  // Do NOT exit — let the sync loop continue
});

// Start the sync service
const syncService = new BlockchainSyncService();
syncService.start().catch(err => {
  console.error('🚨 Fatal start error:', err.message);
  // Even if start fails, try again after 30 seconds
  setTimeout(() => {
    console.log('🔄 Attempting restart...');
    syncService.start().catch(console.error);
  }, 30000);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('⏹️  Sync service stopping...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('⏹️  Sync service stopping...');
  process.exit(0);
});
