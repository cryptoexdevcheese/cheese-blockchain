/**
 * CHEESE Blockchain - P2P Integration Helper
 * Easy integration of P2P network with existing blockchain server
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

// Import directly to avoid circular dependency
const NetworkManager = require('./network-manager');
const SignalingServer = require('./transport/signaling-server');

class P2PIntegration {
    constructor(blockchain, config = {}) {
        this.blockchain = blockchain;

        this.config = {
            enableP2P: config.enableP2P !== false,
            enableWebRTC: config.enableWebRTC || false,
            tcpPort: config.tcpPort || 30303,
            wsPort: config.wsPort || 30304,
            signalingPort: config.signalingPort || 30305,
            networkId: config.networkId || 'cheese-mainnet',
            bootstrapNodes: config.bootstrapNodes || [],
            maxPeers: config.maxPeers || 50,
            ...config
        };

        this.network = null;
        this.signaling = null;
        this.isRunning = false;

        console.log('🔗 P2P Integration initialized');
    }

    /**
     * Start P2P networking
     */
    async start() {
        if (!this.config.enableP2P) {
            console.log('   P2P disabled by configuration');
            return false;
        }

        console.log('🌐 Starting P2P Network Integration...');

        try {
            // Create network manager
            this.network = new NetworkManager({
                listenPort: this.config.tcpPort,
                wsPort: this.config.wsPort,
                networkId: this.config.networkId,
                bootstrapNodes: this.config.bootstrapNodes,
                maxPeers: this.config.maxPeers,
                enableDHT: true,
                enableGossip: true,
                enableEncryption: true
            });

            // Connect blockchain
            this.network.setBlockchain(this.blockchain);

            // Setup event handlers
            this.setupEventHandlers();

            // Start network
            await this.network.start();

            // Start signaling server for WebRTC if enabled
            if (this.config.enableWebRTC) {
                this.signaling = new SignalingServer({
                    port: this.config.signalingPort
                });
                await this.signaling.start();
            }

            this.isRunning = true;
            console.log('✅ P2P Network Integration ACTIVE');

            return true;

        } catch (error) {
            console.error('❌ Failed to start P2P:', error.message);
            return false;
        }
    }

    /**
     * Stop P2P networking
     */
    async stop() {
        if (this.network) {
            await this.network.stop();
            this.network = null;
        }

        if (this.signaling) {
            this.signaling.stop();
            this.signaling = null;
        }

        this.isRunning = false;
        console.log('   P2P network stopped');
    }

    /**
     * Setup event handlers for blockchain synchronization
     */
    setupEventHandlers() {
        // Handle received blocks
        this.network.on('block:received', async (block, from) => {
            console.log(`📦 Received block #${block.index} from ${from.slice(0, 16)}...`);

            try {
                // Validate and add block to local chain
                if (this.blockchain && this.blockchain.chain) {
                    const latestBlock = this.blockchain.chain[this.blockchain.chain.length - 1];

                    // Check if this is the next block
                    if (block.index === latestBlock.index + 1 &&
                        block.previousHash === latestBlock.hash) {

                        // Add block
                        this.blockchain.chain.push(block);

                        // Save to database if available
                        if (this.blockchain.database) {
                            await this.blockchain.database.saveBlock(block);
                        }

                        console.log(`   ✅ Block #${block.index} added to chain`);
                    }
                }
            } catch (error) {
                console.error('   Failed to process block:', error.message);
            }
        });

        // Handle received transactions
        this.network.on('transaction:received', async (transaction, from) => {
            console.log(`💸 Received transaction from ${from.slice(0, 16)}...`);

            try {
                // Add to pending transactions
                if (this.blockchain && this.blockchain.pendingTransactions) {
                    // Check if not duplicate
                    const exists = this.blockchain.pendingTransactions.some(
                        tx => tx.id === transaction.id
                    );

                    if (!exists) {
                        this.blockchain.pendingTransactions.push(transaction);
                        console.log(`   ✅ Transaction added to mempool`);
                    }
                }
            } catch (error) {
                console.error('   Failed to process transaction:', error.message);
            }
        });

        // Handle new peer connections
        this.network.on('peer:connected', (peer) => {
            console.log(`🔗 New P2P peer: ${peer.id.slice(0, 16)}...`);
        });

        // Handle peer disconnect
        this.network.on('peer:disconnected', (peerId) => {
            console.log(`🔌 P2P peer left: ${peerId.slice(0, 16)}...`);
        });
    }

    /**
     * Broadcast new block to network
     */
    broadcastBlock(block) {
        if (this.network && this.isRunning) {
            this.network.broadcastBlock(block);
        }
    }

    /**
     * Broadcast new transaction to network
     */
    broadcastTransaction(transaction) {
        if (this.network && this.isRunning) {
            this.network.broadcastTransaction(transaction);
        }
    }

    /**
     * Get network status
     */
    getStatus() {
        if (!this.network) {
            return {
                enabled: false,
                running: false
            };
        }

        const status = this.network.getStatus();

        return {
            enabled: true,
            running: this.isRunning,
            ...status,
            webrtc: {
                enabled: this.config.enableWebRTC,
                signalingPort: this.config.signalingPort,
                connectedPeers: this.signaling ? this.signaling.getPeerCount() : 0
            }
        };
    }

    /**
     * Get connected peers
     */
    getPeers() {
        return this.network ? this.network.getPeers() : [];
    }

    /**
     * Connect to specific peer
     */
    async connectToPeer(address, port) {
        if (this.network) {
            return await this.network.connectToPeer(address, port);
        }
        return null;
    }
}

module.exports = P2PIntegration;
