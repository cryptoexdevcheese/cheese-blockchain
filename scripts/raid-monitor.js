/**
 * SENTINEL MATRIX: Raid Monitor v1.0
 * 🛡️ Purpose: Scans for "Old Cheese" triggers and alerts the coordinator.
 */

const fs = require('fs');
const path = require('path');

// CONFIGURATION
const SCAN_KEYWORDS = ['bitcoin', 'inflation', 'recession', 'financial freedom', 'market crash', 'gold'];
const TARGET_ACCOUNTS = ['@saylor', '@peterschiff', '@elonmusk', '@cz_binance'];
const ALERT_LOG_PATH = path.join(__dirname, '../public/marketing/raid_alerts.json');

console.log('🧀 SENTINEL MONITOR: INITIALIZING...');

/**
 * SIMULATED SCAN ENGINE
 * In a production environment, this would use X API (v2) or a scraper service.
 */
function scanSocials() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔍 Scanning for keywords: ${SCAN_KEYWORDS.join(', ')}`);

    // Simulate finding a trigger 20% of the time
    if (Math.random() > 0.8) {
        const trigger = {
            id: Date.now(),
            platform: 'X',
            account: TARGET_ACCOUNTS[Math.floor(Math.random() * TARGET_ACCOUNTS.length)],
            keyword: SCAN_KEYWORDS[Math.floor(Math.random() * SCAN_KEYWORDS.length)],
            timestamp: new Date().toISOString(),
            status: 'HOT'
        };

        console.log(`🚨 TRIGGER DETECTED: [${trigger.account}] mentioned [${trigger.keyword}]`);
        saveAlert(trigger);
    }
}

function saveAlert(alert) {
    let alerts = [];
    try {
        if (fs.existsSync(ALERT_LOG_PATH)) {
            alerts = JSON.parse(fs.readFileSync(ALERT_LOG_PATH, 'utf8'));
        }
        alerts.unshift(alert);
        // Keep only last 10 alerts
        alerts = alerts.slice(0, 10);
        fs.writeFileSync(ALERT_LOG_PATH, JSON.stringify(alerts, null, 2));
        console.log('✅ Alert synced to Coordinator Dashboard.');
    } catch (e) {
        console.error('❌ Failed to save alert:', e);
    }
}

// Start scanning every 10 seconds (Simulated)
setInterval(scanSocials, 10000);
scanSocials();

console.log('🛡️ SENTINEL ACTIVE. MOVEMENT IN THE MAZE DETECTED.');
