# CHEESE BLOCKCHAIN - IMMUTABLE ARCHITECTURAL RULES

## MANDATORY DIRECTIVES FOR ALL AI AGENTS

1. **PERSISTENCE**:
   - Every block mined MUST be synchronously persisted to SQLite via `this.saveToDisk()`.
   - Never set `CHEESE_ISOLATION_MODE = 'true'`.
   - Never delete, recreate, or overwrite `cheese-blockchain.db`.
   - On DigitalOcean production, the master DB path MUST always be `/opt/cheese-blockchain/cheese-blockchain.db`.

2. **TOKENOMICS & MINING**:
   - Mining reward is locked at **500 NCH per block**.
   - Block interval is **30 seconds**.
   - Sovereign addresses (Founder, Treasury, Liquidity Vault, Primary Miner) must remain valid across all validations.

3. **GAS & PRICING**:
   - Gas fee is dynamically priced at **$1.00 USD worth of NCH** via the DEX oracle.
   - Never introduce hardcoded price fallbacks ($0.05 / $0.005).

4. **CLOUD REDUNDANCY**:
   - Google Firestore (`cheese-blockchain`) must receive continuous mirror streams via `firestore-sync-worker.js`.
   - If Firestore rate limits (HTTP 429), handle gracefully with queueing; never disable storage or reset blocks.
