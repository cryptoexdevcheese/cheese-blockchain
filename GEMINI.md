# 🚨 STRICT ARCHITECTURAL INSTRUCTIONS FOR AI AGENTS & DEVELOPERS 🚨

## ⚠️ MANDATORY RULES — DO NOT BREAK UNDER ANY CIRCUMSTANCES

You are working on **CHEESE Blockchain L1 Engine**. This repository operates on a live Layer 1 decentralized financial network. The following architectural rules are **IMMUTABLE** and **STRICTLY ENFORCED**:

---

### 1. 💾 PERSISTENCE & DATABASE INTEGRITY (CRITICAL)
- **NEVER** bypass SQLite immediate disk persistence. Every block write in `blockchain-database-sqlite.js` **MUST** call `this.saveToDisk()` synchronously.
- **NEVER** set `CHEESE_ISOLATION_MODE = 'true'` in production files or entrypoints (`start-server.js`, `blockchain-core-v33.js`).
- **NEVER** hardcode, reset, delete, or recreate `cheese-blockchain.db`. 
- Master DB path on the production DigitalOcean droplet is `/opt/cheese-blockchain/cheese-blockchain.db` and is placed outside the Git repository to prevent data loss on `git reset`.
- Do **NOT** replace real blockchain state with synthetic or mocked data.

---

### 2. ☁️ DUAL STORAGE & FIRESTORE CLOUD MIRRORING
- The architecture uses `DualStorage` (`dual-storage.js`) connecting SQLite (local fast execution) and Google Firestore (immutable cloud mirror).
- Continuous sync is maintained via `firestore-sync-worker.js`.
- If Firestore credentials fail or rate-limit, do **NOT** disable DualStorage globally or reset block height — handle errors gracefully with retry backoff.

---

### 3. ⛏️ MINING & REWARD TOKENOMICS
- Default native mining reward is locked at **500 NCH per block** (verified in `start-server.js` and `blockchain-core-v33.js`).
- Mining cadence is **30 seconds per block** (`MINING_INTERVAL = 30000`).
- The 4 core sovereign system addresses (Founder, Treasury, Liquidity Vault, Primary Miner) must remain valid across all chain validations and auto-heals.

---

### 4. 💱 DEX & GAS ORACLE
- Gas fees are dynamically priced at **$1.00 USD worth of NCH** via the live DEX price oracle (computed every 60s in `start-server.js`).
- Do **NOT** restore obsolete hardcoded price fallbacks ($0.05 / $0.005) which create arbitrage exploits.

---

### 5. 🚀 DEPLOYMENT PROTOCOL
- DigitalOcean Droplet: `165.22.252.113` (port 8080)
- Production directory: `/opt/cheese-blockchain/cheese-blockchain/`
- Master database: `/opt/cheese-blockchain/cheese-blockchain.db`
- PM2 process name: `cheese-blockchain`
- Always verify live blockchain height at `https://cheeseblockchain.com/api/blockchain` before and after any deployment.

---

**ANY VIOLATION OF THESE RULES THREATENS LEDGER INTEGRITY AND WILL RESULT IN REJECTION OF YOUR CODE.**
