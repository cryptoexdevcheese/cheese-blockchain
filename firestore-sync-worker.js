/**
 * 🧀 CHEESE BLOCKCHAIN — FIRESTORE CLOUD SYNC WORKER
 * Continuously mirrors all blocks and transactions from SQLite to Google Firestore
 * Seamlessly auto-refreshes OAuth access token using Firebase CLI
 */

const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const PROJECT_ID = 'cheese-blockchain';
const DB_PATH = '/Users/cheeseblockchain/CascadeProjects/cheese-blockchain/cheese-blockchain.db';
const CONFIGSTORE_PATH = '/Users/cheeseblockchain/.config/configstore/firebase-tools.json';
const BATCH_SIZE = 50;

function getValidToken() {
    try {
        let data = JSON.parse(fs.readFileSync(CONFIGSTORE_PATH, 'utf8'));
        const expiresAt = data.tokens?.expires_at || 0;
        
        // If expired or expiring in next 5 minutes, refresh via firebase CLI
        if (!data.tokens?.access_token || Date.now() > (expiresAt - 300000)) {
            console.log('🔄 Refreshing Google Cloud OAuth token via Firebase CLI...');
            execSync('npx -y firebase-tools projects:list', { stdio: 'ignore' });
            data = JSON.parse(fs.readFileSync(CONFIGSTORE_PATH, 'utf8'));
        }
        return data.tokens?.access_token;
    } catch (e) {
        console.error('❌ Error getting valid token:', e.message);
        return null;
    }
}

function firestoreCommit(writes) {
    return new Promise(async (resolve, reject) => {
        const token = getValidToken();
        if (!token) return reject(new Error('No valid token available'));

        const body = JSON.stringify({ writes });

        const req = https.request({
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let respBody = '';
            res.on('data', chunk => respBody += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(respBody) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: respBody });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function sqliteQuery(query) {
    const result = execSync(`sqlite3 "${DB_PATH}" "${query}"`, { maxBuffer: 50 * 1024 * 1024 });
    return result.toString().trim();
}

async function syncBlocksToFirestore() {
    const totalBlocks = parseInt(sqliteQuery('SELECT COUNT(*) FROM blocks;'));
    const maxIndex = parseInt(sqliteQuery('SELECT MAX(blockIndex) FROM blocks;'));

    console.log(`🔥 FIRESTORE SYNC: SQLite contains ${totalBlocks} blocks (Max: #${maxIndex})`);

    let offset = 0;
    while (offset < totalBlocks) {
        const blockRows = sqliteQuery(
            `SELECT json_group_array(json_object(` +
            `'blockIndex', blockIndex, ` +
            `'hash', hash, ` +
            `'previousHash', previousHash, ` +
            `'timestamp', timestamp, ` +
            `'nonce', nonce, ` +
            `'difficulty', difficulty, ` +
            `'data', data` +
            `)) FROM (SELECT * FROM blocks ORDER BY blockIndex ASC LIMIT ${BATCH_SIZE} OFFSET ${offset});`
        );

        let blocks = [];
        try { blocks = JSON.parse(blockRows); } catch (e) {}
        if (!blocks.length) break;

        const writes = blocks.map(b => {
            let dataStr = b.data || '{}';
            return {
                update: {
                    name: `projects/${PROJECT_ID}/databases/(default)/documents/cheese-blockchain-blocks/${b.blockIndex}`,
                    fields: {
                        blockIndex: { integerValue: String(b.blockIndex) },
                        hash: { stringValue: b.hash || '0' },
                        previousHash: { stringValue: b.previousHash || '0' },
                        timestamp: { integerValue: String(b.timestamp || Date.now()) },
                        nonce: { integerValue: String(b.nonce || 0) },
                        difficulty: { integerValue: String(b.difficulty || 4) },
                        data: { stringValue: dataStr },
                        syncedAt: { integerValue: String(Date.now()) }
                    }
                }
            };
        });

        try {
            const res = await firestoreCommit(writes);
            if (res.status === 200) {
                process.stdout.write(`\r🔥 [Firestore Mirror] Synced blocks #${blocks[0].blockIndex} - #${blocks[blocks.length-1].blockIndex} (${Math.min(offset + BATCH_SIZE, totalBlocks)}/${totalBlocks})...  `);
            } else if (res.status === 429) {
                // If rate limited, pause for 2 seconds and continue
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (err) {
            console.error('\n❌ Firestore commit error:', err.message);
        }

        offset += BATCH_SIZE;
        await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n✅ Firestore bulk sync complete.');
}

async function startDaemon() {
    console.log('🚀 Starting Cheese Blockchain ↔ Firestore Continuous Sync Daemon');
    await syncBlocksToFirestore();

    // Check for new blocks every 30 seconds
    setInterval(async () => {
        try {
            const maxIndex = parseInt(sqliteQuery('SELECT MAX(blockIndex) FROM blocks;'));
            const blockRows = sqliteQuery(
                `SELECT json_group_array(json_object(` +
                `'blockIndex', blockIndex, ` +
                `'hash', hash, ` +
                `'previousHash', previousHash, ` +
                `'timestamp', timestamp, ` +
                `'nonce', nonce, ` +
                `'difficulty', difficulty, ` +
                `'data', data` +
                `)) FROM (SELECT * FROM blocks ORDER BY blockIndex DESC LIMIT 10);`
            );

            let blocks = [];
            try { blocks = JSON.parse(blockRows); } catch (e) {}
            if (blocks.length) {
                const writes = blocks.map(b => ({
                    update: {
                        name: `projects/${PROJECT_ID}/databases/(default)/documents/cheese-blockchain-blocks/${b.blockIndex}`,
                        fields: {
                            blockIndex: { integerValue: String(b.blockIndex) },
                            hash: { stringValue: b.hash || '0' },
                            previousHash: { stringValue: b.previousHash || '0' },
                            timestamp: { integerValue: String(b.timestamp || Date.now()) },
                            nonce: { integerValue: String(b.nonce || 0) },
                            difficulty: { integerValue: String(b.difficulty || 4) },
                            data: { stringValue: b.data || '{}' },
                            syncedAt: { integerValue: String(Date.now()) }
                        }
                    }
                }));
                await firestoreCommit(writes);
                console.log(`[${new Date().toLocaleTimeString()}] ☁️ Mirrored latest blocks up to #${maxIndex} to Firestore`);
            }
        } catch (e) {
            console.error('Daemon periodic sync notice:', e.message);
        }
    }, 30000);
}

if (require.main === module) {
    startDaemon().catch(console.error);
}

module.exports = { syncBlocksToFirestore, startDaemon };
