// PM2 Ecosystem Configuration for CHEESE Blockchain
// This ensures the blockchain server runs permanently on the VM
// and automatically restarts if it crashes

module.exports = {
    apps: [{
        name: 'cheese-blockchain',
        script: 'blockchain-server.js',

        // Environment variables
        env: {
            NODE_ENV: 'production',
            PORT: 8080,
            USE_FIRESTORE: 'true',  // CRITICAL: Enable Firestore
            GOOGLE_CLOUD_PROJECT: 'cheese-blockchain',
            API_KEY: 'REDACTED_DEX_API_KEY'
        },

        // Process management
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',

        // Restart policy
        max_restarts: 10,
        restart_delay: 5000,
        min_uptime: '10s',

        // Logging
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        error_file: './logs/blockchain-error.log',
        out_file: './logs/blockchain-out.log',
        merge_logs: true,

        // Graceful shutdown
        kill_timeout: 5000,
        wait_ready: true,
        listen_timeout: 30000
    }]
};
