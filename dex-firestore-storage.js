const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

class DEXFirestoreStorage {
    constructor(serviceAccountPath) {
        this.filePath = path.join(__dirname, 'dex-data.json');
        this.data = { pools: [], positions: {} };
        this.initialized = false;
        this.useFirestore = false;
        this.db = null;
        this.serviceAccountPath = serviceAccountPath;
    }

    async initialize() {
        console.log('💾 Initializing DEX Storage...');

        // 1. Try to initialize Firestore
        try {
            if (!admin.apps.length) {
                let serviceAccount;
                if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
                    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
                } else if (fs.existsSync(this.serviceAccountPath)) {
                    serviceAccount = require(path.resolve(this.serviceAccountPath));
                }

                if (serviceAccount) {
                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount)
                    });
                    this.db = admin.firestore();
                    this.useFirestore = true;
                    console.log('✅ Firestore connected for DEX');
                }
            } else {
                this.db = admin.firestore();
                this.useFirestore = true;
                console.log('✅ Firestore (existing app) connected for DEX');
            }
        } catch (error) {
            console.warn('⚠️ Firestore initialization failed, falling back to JSON:', error.message);
        }

        // 2. Load initial data from JSON (always keep as backup/cache)
        try {
            if (fs.existsSync(this.filePath)) {
                this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
            if (!this.data.positions) this.data.positions = {};
            await this.loadPositions();
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('JSON storage error:', error);
            return false;
        }
    }

    saveData() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('Save data error:', error);
        }
    }

    // ==========================================
    // POOLS & POSITIONS
    // ==========================================

    async loadPools() {
        if (this.useFirestore) {
            try {
                const snapshot = await this.db.collection('dex_pools').get();
                const pools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (pools.length > 0) this.data.pools = pools;
                return pools;
            } catch (e) {
                console.error('Error loading pools from Firestore:', e.message);
            }
        }
        return this.data.pools || [];
    }

    async savePool(pool) {
        // Local Cache
        const idx = this.data.pools.findIndex(p => p.id === pool.id);
        if (idx >= 0) this.data.pools[idx] = pool;
        else this.data.pools.push(pool);
        this.saveData();

        // Firestore
        if (this.useFirestore) {
            try {
                await this.db.collection('dex_pools').doc(pool.id).set(pool);
            } catch (e) {
                console.error('Error saving pool to Firestore:', e.message);
            }
        }
    }

    normalizeAddress(address) {
        return String(address || '').toLowerCase();
    }

    async loadPositions() {
        if (this.useFirestore) {
            try {
                const snapshot = await this.db.collection('dex_positions').get();
                snapshot.docs.forEach((doc) => {
                    const user = this.normalizeAddress(doc.id);
                    const positions = doc.data().positions || [];
                    if (!positions.length) return;
                    this.data.positions[user] = positions;
                });
            } catch (e) {
                console.error('Error loading positions from Firestore:', e.message);
            }
        }
        return this.data.positions;
    }

    findPoolForPosition(pos, pools = []) {
        let pool = pools.find((pl) => pl.id === pos.poolId);
        if (pool) return pool;
        const parts = String(pos.poolId || '').split('_');
        if (parts.length === 2) {
            pool = pools.find((pl) =>
                (pl.token0 === parts[0] && pl.token1 === parts[1]) ||
                (pl.token0 === parts[1] && pl.token1 === parts[0])
            );
            if (pool) return pool;
        }
        if (String(pos.poolId).includes('NCH') && String(pos.poolId).includes('USDT')) {
            return pools.find((pl) =>
                (pl.token0 === 'NCH' && pl.token1 === 'USDT') ||
                (pl.token0 === 'USDT' && pl.token1 === 'NCH')
            );
        }
        return null;
    }

    async addPosition(user, poolId, amount) {
        user = this.normalizeAddress(user);
        if (!this.data.positions[user]) this.data.positions[user] = [];
        let pos = this.data.positions[user].find(p => p.poolId === poolId);
        if (pos) pos.amount += amount;
        else this.data.positions[user].push({ poolId, amount, updatedAt: Date.now() });
        this.saveData();

        if (this.useFirestore) {
            try {
                const docRef = this.db.collection('dex_positions').doc(user);
                const doc = await docRef.get();
                let positions = doc.exists ? doc.data().positions || [] : [];
                let pIdx = positions.findIndex(p => p.poolId === poolId);
                if (pIdx >= 0) positions[pIdx].amount += amount;
                else positions.push({ poolId, amount, updatedAt: Date.now() });
                await docRef.set({ positions });
            } catch (e) {
                console.error('Error saving position to Firestore:', e.message);
            }
        }
    }

    async updatePosition(user, poolId, amountChange) {
        user = this.normalizeAddress(user);
        if (this.useFirestore) {
            try {
                const docRef = this.db.collection('dex_positions').doc(user);
                const doc = await docRef.get();
                if (doc.exists) {
                    let positions = doc.data().positions || [];
                    let pIdx = positions.findIndex(p => p.poolId === poolId);
                    if (pIdx >= 0) {
                        positions[pIdx].amount += amountChange;
                        if (positions[pIdx].amount < 0) positions[pIdx].amount = 0;
                        await docRef.set({ positions });
                    }
                }
            } catch (e) { console.error('Error updating position in Firestore:', e.message); }
        }

        // Local sync
        if (this.data.positions[user]) {
            let pos = this.data.positions[user].find(p => p.poolId === poolId);
            if (pos) {
                pos.amount += amountChange;
                if (pos.amount < 0) pos.amount = 0;
                this.saveData();
            }
        }
    }

    getUserPositions(user) {
        return this.data.positions[this.normalizeAddress(user)] || [];
    }

    getLpBalance(user, poolId) {
        const positions = this.data.positions[this.normalizeAddress(user)] || [];
        const pos = positions.find((p) => p.poolId === poolId);
        return pos ? pos.amount : 0;
    }

    getEnrichedUserPositions(user, pools = []) {
        const positions = this.data.positions[this.normalizeAddress(user)] || [];
        return positions
            .filter((p) => p.amount > 0)
            .map((pos) => {
                const pool = this.findPoolForPosition(pos, pools);
                if (!pool) {
                    const parts = String(pos.poolId).split('_');
                    return {
                        poolId: pos.poolId,
                        token0: parts[0] || 'NCH',
                        token1: parts[1] || 'USDT',
                        lpTokens: pos.amount,
                        share: 0
                    };
                }
                const share = pool.totalLiquidity > 0 ? (pos.amount / pool.totalLiquidity) * 100 : 0;
                return {
                    poolId: pos.poolId,
                    token0: pool.token0,
                    token1: pool.token1,
                    lpTokens: pos.amount,
                    share,
                    reserve0: pool.reserve0,
                    reserve1: pool.reserve1
                };
            });
    }

    async deletePool(poolId) {
        this.data.pools = (this.data.pools || []).filter((p) => p.id !== poolId);
        this.saveData();
        if (this.useFirestore) {
            try {
                await this.db.collection('dex_pools').doc(poolId).delete();
            } catch (e) {
                console.error('Error deleting pool from Firestore:', e.message);
            }
        }
    }

    // ==========================================
    // P2P, BRIDGE, CONVERT (FIRESTORE EXCLUSIVE)
    // ==========================================

    collection(name) {
        if (this.useFirestore) {
            return this.db.collection(name);
        }

        // Initialize local collection cache if not present
        if (!this.data[name]) {
            this.data[name] = {};
        }

        return {
            get: async () => {
                const docs = Object.values(this.data[name] || {});
                return {
                    docs: docs.map(d => ({
                        id: d.id,
                        data: () => d
                    })),
                    empty: docs.length === 0
                };
            },
            add: async (docData) => {
                const id = 'mock_' + Math.random().toString(36).substring(2, 15);
                const docWithMeta = {
                    ...docData,
                    id,
                    timestamp: docData.timestamp || Date.now()
                };
                this.data[name][id] = docWithMeta;
                this.saveData();
                return { 
                    id, 
                    get: async () => ({ 
                        exists: true, 
                        data: () => docWithMeta 
                    }) 
                };
            },
            doc: (id) => {
                return {
                    get: async () => {
                        const exists = !!this.data[name][id];
                        return {
                            exists,
                            data: () => this.data[name][id]
                        };
                    },
                    update: async (updateData) => {
                        if (this.data[name][id]) {
                            this.data[name][id] = { ...this.data[name][id], ...updateData };
                            this.saveData();
                        }
                    },
                    set: async (setData) => {
                        this.data[name][id] = setData;
                        this.saveData();
                    }
                };
            },
            where: (field, op, value) => {
                const allDocs = Object.values(this.data[name] || {});
                let filteredDocs = [];
                if (op === '==') {
                    filteredDocs = allDocs.filter(d => d[field] === value);
                }
                return {
                    get: async () => {
                        return {
                            docs: filteredDocs.map(d => ({
                                id: d.id,
                                data: () => d
                            })),
                            empty: filteredDocs.length === 0
                        };
                    }
                };
            }
        };
    }

    getTimestamp() {
        if (this.useFirestore) {
            return admin.firestore.FieldValue.serverTimestamp();
        }
        return new Date().toISOString();
    }
}

module.exports = DEXFirestoreStorage;
