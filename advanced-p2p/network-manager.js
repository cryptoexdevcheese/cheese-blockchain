/**
 * CHEESE Blockchain - Enterprise P2P Network Manager
 * Central orchestrator for all P2P networking subsystems
 * 
 * Features:
 * - Multi-protocol transport (TCP, WebSocket, WebRTC)
 * - Distributed Hash Table (DHT) for peer discovery
 * - Gossipsub for efficient message propagation
 * - Encrypted communications
 * - Rate limiting & DoS protection
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

// Import subsystems
const MultiTransport = require('./transport/multi-transport');
const DHTDiscovery = require('./discovery/dht-discovery');
const BootstrapDiscovery = require('./discovery/bootstrap-discovery');
const GossipSub = require('./protocols/gossipsub');
const RequestResponse = require('./protocols/request-response');
const PeerAuth = require('./security/peer-auth');
const RateLimiter = require('./security/rate-limiter');

class NetworkManager extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            nodeId: config.nodeId || this.generateNodeId(),
            listenPort: config.listenPort || 30303,
            wsPort: config.wsPort || 30304,
            maxPeers: config.maxPeers || 50,
            minPeers: config.minPeers || 5,
            bootstrapNodes: config.bootstrapNodes || [],
            enableDHT: config.enableDHT !== false,
            enableGossip: config.enableGossip !== false,
            enableEncryption: config.enableEncryption !== false,
            networkId: config.networkId || 'cheese-mainnet',
            ...config
        };

        // State
        this.peers = new Map();
        this.isRunning = false;
        this.blockchain = null;

        // Statistics
        this.stats = {
            messagesReceived: 0,
            messagesSent: 0,
            bytesReceived: 0,
            bytesSent: 0,
            peersConnected: 0,
            peersDisconnected: 0,
            blocksReceived: 0,
            transactionsReceived: 0,
            startTime: null
        };

        // Initialize subsystems
        this.transport = new MultiTransport(this.config);
        this.dht = new DHTDiscovery(this.config);
        this.bootstrap = new BootstrapDiscovery(this.config);
        this.gossip = new GossipSub(this.config);
        this.requestResponse = new RequestResponse(this.config);
        this.peerAuth = new PeerAuth(this.config);
        this.rateLimiter = new RateLimiter(this.config);

        this.setupEventHandlers();

        console.log(`🌐 CHEESE P2P Network Manager initialized`);
        console.log(`   Node ID: ${this.config.nodeId.slice(0, 16)}...`);
        console.log(`   Network: ${this.config.networkId}`);
    }

    /**
     * Generate unique node ID (64 hex chars)
     */
    generateNodeId() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Setup event handlers for all subsystems
     */
    setupEventHandlers() {
        // Transport events
        this.transport.on('peer:connect', (peer) => this.handlePeerConnect(peer));
        this.transport.on('peer:disconnect', (peerId) => this.handlePeerDisconnect(peerId));
        this.transport.on('message', (peerId, message) => this.handleMessage(peerId, message));
        this.transport.on('error', (error) => this.emit('error', error));

        // DHT events
        this.dht.on('peer:discovered', (peer) => this.handlePeerDiscovered(peer));
        this.dht.on('peer:updated', (peer) => this.handlePeerUpdated(peer));

        // Gossip events
        this.gossip.on('message', (topic, data, from) => this.handleGossipMessage(topic, data, from));

        // Request/Response events
        this.requestResponse.on('request', (peerId, request) => this.handleRequest(peerId, request));
        this.requestResponse.on('response', (peerId, response) => this.handleResponse(peerId, response));
    }

    /**
     * Start the P2P network
     */
    async start() {
        if (this.isRunning) {
            console.warn('Network already running');
            return;
        }

        console.log('🚀 Starting CHEESE P2P Network...');
        this.stats.startTime = Date.now();

        try {
            // Start transport layer
            await this.transport.start();
            console.log('   ✅ Transport layer started');

            // Start peer authentication
            await this.peerAuth.start();
            console.log('   ✅ Peer authentication ready');

            // Start rate limiter
            await this.rateLimiter.start();
            console.log('   ✅ Rate limiter active');

            // Connect to bootstrap nodes
            if (this.config.bootstrapNodes.length > 0) {
                await this.bootstrap.connect(this.config.bootstrapNodes);
                console.log(`   ✅ Connected to ${this.config.bootstrapNodes.length} bootstrap nodes`);
            }

            // Start DHT discovery
            if (this.config.enableDHT) {
                await this.dht.start();
                console.log('   ✅ DHT discovery active');
            }

            // Start Gossipsub
            if (this.config.enableGossip) {
                await this.gossip.start();
                this.gossip.subscribe('blocks');
                this.gossip.subscribe('transactions');
                this.gossip.subscribe('consensus');
                console.log('   ✅ Gossipsub protocol active');
            }

            // Start housekeeping
            this.startHousekeeping();

            this.isRunning = true;
            console.log('✅ CHEESE P2P Network is LIVE!');
            console.log(`   Listening: TCP:${this.config.listenPort} WS:${this.config.wsPort}`);

            this.emit('started');
            return true;

        } catch (error) {
            console.error('❌ Failed to start P2P network:', error.message || error);
            if (this.listenerCount('error') > 0) {
                this.emit('error', error);
            }
            return false;
        }
    }

    /**
     * Stop the P2P network
     */
    async stop() {
        if (!this.isRunning) return;

        console.log('🛑 Stopping P2P network...');

        this.stopHousekeeping();
        await this.gossip.stop();
        await this.dht.stop();
        await this.transport.stop();

        this.peers.clear();
        this.isRunning = false;

        console.log('   P2P network stopped');
        this.emit('stopped');
    }

    /**
     * Connect to a specific peer
     */
    async connectToPeer(address, port, protocol = 'tcp') {
        if (this.peers.size >= this.config.maxPeers) {
            console.warn('Max peers reached, cannot connect to new peer');
            return null;
        }

        try {
            const peer = await this.transport.connect(address, port, protocol);

            // Authenticate peer
            if (this.config.enableEncryption) {
                await this.peerAuth.authenticate(peer);
            }

            // Add to DHT
            if (this.config.enableDHT) {
                this.dht.addPeer(peer);
            }

            return peer;
        } catch (error) {
            console.error(`Failed to connect to ${address}:${port}:`, error.message);
            return null;
        }
    }

    /**
     * Handle new peer connection
     */
    handlePeerConnect(peer) {
        // Rate limit check
        if (!this.rateLimiter.allowConnection(peer.address)) {
            console.warn(`Rate limited connection from ${peer.address}`);
            this.transport.disconnect(peer.id);
            return;
        }

        // Max peers check
        if (this.peers.size >= this.config.maxPeers) {
            console.warn(`Max peers reached, rejecting ${peer.id}`);
            this.transport.disconnect(peer.id);
            return;
        }

        this.peers.set(peer.id, {
            ...peer,
            connectedAt: Date.now(),
            lastSeen: Date.now(),
            messageCount: 0,
            bytesSent: 0,
            bytesReceived: 0,
            reputation: 100
        });

        this.stats.peersConnected++;

        console.log(`🔗 Peer connected: ${peer.id.slice(0, 16)}... via ${peer.protocol}`);
        console.log(`   Active peers: ${this.peers.size}`);

        // Add to gossip mesh
        if (this.config.enableGossip) {
            this.gossip.addPeer(peer.id);
        }

        // Add to DHT if not already
        if (this.config.enableDHT) {
            this.dht.addPeer(peer);
        }

        this.emit('peer:connected', peer);

        // Request chain info from new peer
        this.requestResponse.send(peer.id, {
            type: 'GET_CHAIN_INFO'
        });
    }

    /**
     * Handle peer disconnection
     */
    handlePeerDisconnect(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        this.peers.delete(peerId);
        this.stats.peersDisconnected++;

        console.log(`🔌 Peer disconnected: ${peerId.slice(0, 16)}...`);
        console.log(`   Active peers: ${this.peers.size}`);

        // Remove from gossip mesh
        this.gossip.removePeer(peerId);

        // Update DHT
        this.dht.removePeer(peerId);

        this.emit('peer:disconnected', peerId);

        // Find new peers if below minimum
        if (this.peers.size < this.config.minPeers) {
            this.discoverPeers();
        }
    }

    /**
     * Handle incoming message
     */
    handleMessage(peerId, message) {
        // Rate limit check
        if (!this.rateLimiter.allowMessage(peerId)) {
            console.warn(`Rate limited message from ${peerId}`);
            return;
        }

        const peer = this.peers.get(peerId);
        if (peer) {
            peer.lastSeen = Date.now();
            peer.messageCount++;
            peer.bytesReceived += message.length || 0;
        }

        this.stats.messagesReceived++;
        this.stats.bytesReceived += message.length || 0;

        try {
            const data = typeof message === 'string' ? JSON.parse(message) : message;

            switch (data.type) {
                case 'GOSSIP':
                    this.gossip.handleMessage(peerId, data);
                    break;

                case 'REQUEST':
                    this.requestResponse.handleRequest(peerId, data);
                    break;

                case 'RESPONSE':
                    this.requestResponse.handleResponse(peerId, data);
                    break;

                case 'DHT':
                    this.dht.handleMessage(peerId, data);
                    break;

                case 'PING':
                    this.sendMessage(peerId, { type: 'PONG', timestamp: Date.now() });
                    break;

                case 'PONG':
                    this.handlePong(peerId, data);
                    break;

                default:
                    this.emit('message', peerId, data);
            }

        } catch (error) {
            console.error(`Invalid message from ${peerId}:`, error.message);
            this.decreaseReputation(peerId, 5);
        }
    }

    /**
     * Handle gossip message
     */
    handleGossipMessage(topic, data, from) {
        switch (topic) {
            case 'blocks':
                this.stats.blocksReceived++;
                this.emit('block:received', data, from);
                break;

            case 'transactions':
                this.stats.transactionsReceived++;
                this.emit('transaction:received', data, from);
                break;

            case 'consensus':
                this.emit('consensus:message', data, from);
                break;

            default:
                this.emit(`gossip:${topic}`, data, from);
        }
    }

    /**
     * Handle request from peer
     */
    handleRequest(peerId, request) {
        switch (request.method) {
            case 'GET_CHAIN_INFO':
                this.respondChainInfo(peerId, request.id);
                break;

            case 'GET_BLOCKS':
                this.respondBlocks(peerId, request.id, request.params);
                break;

            case 'GET_TRANSACTIONS':
                this.respondTransactions(peerId, request.id, request.params);
                break;

            case 'GET_PEERS':
                this.respondPeers(peerId, request.id);
                break;

            default:
                this.emit('request', peerId, request);
        }
    }

    /**
     * Handle response from peer
     */
    handleResponse(peerId, response) {
        this.emit('response', peerId, response);
    }

    /**
     * Handle peer discovered via DHT
     */
    handlePeerDiscovered(peer) {
        if (this.peers.has(peer.id)) return;
        if (peer.id === this.config.nodeId) return;

        console.log(`🔍 Discovered peer: ${peer.id.slice(0, 16)}... at ${peer.address}:${peer.port}`);

        // Connect if we need more peers
        if (this.peers.size < this.config.maxPeers) {
            this.connectToPeer(peer.address, peer.port, peer.protocol);
        }
    }

    /**
     * Handle peer info updated
     */
    handlePeerUpdated(peer) {
        if (this.peers.has(peer.id)) {
            const existing = this.peers.get(peer.id);
            this.peers.set(peer.id, { ...existing, ...peer });
        }
    }

    /**
     * Send message to specific peer
     */
    sendMessage(peerId, message) {
        const peer = this.peers.get(peerId);
        if (!peer) return false;

        const data = typeof message === 'string' ? message : JSON.stringify(message);

        this.stats.messagesSent++;
        this.stats.bytesSent += data.length;
        peer.bytesSent += data.length;

        return this.transport.send(peerId, data);
    }

    /**
     * Broadcast message to all peers
     */
    broadcast(message) {
        const data = typeof message === 'string' ? message : JSON.stringify(message);

        this.peers.forEach((peer, peerId) => {
            this.transport.send(peerId, data);
        });

        this.stats.messagesSent += this.peers.size;
        this.stats.bytesSent += data.length * this.peers.size;
    }

    /**
     * Publish to gossip topic
     */
    publish(topic, data) {
        if (!this.config.enableGossip) {
            this.broadcast({ type: 'GOSSIP', topic, data });
            return;
        }

        this.gossip.publish(topic, data);
    }

    /**
     * Broadcast new block to network
     */
    broadcastBlock(block) {
        console.log(`📦 Broadcasting block #${block.index}`);
        this.publish('blocks', block);
    }

    /**
     * Broadcast new transaction to network
     */
    broadcastTransaction(transaction) {
        console.log(`💸 Broadcasting transaction ${transaction.id?.slice(0, 8)}...`);
        this.publish('transactions', transaction);
    }

    /**
     * Discover more peers
     */
    async discoverPeers() {
        console.log('🔍 Discovering peers...');

        // Ask DHT for more peers
        if (this.config.enableDHT) {
            await this.dht.findPeers(10);
        }

        // Ask existing peers for their peers
        this.peers.forEach((peer, peerId) => {
            this.requestResponse.send(peerId, {
                type: 'GET_PEERS'
            });
        });
    }

    /**
     * Response helpers
     */
    respondChainInfo(peerId, requestId) {
        const info = this.blockchain ? {
            length: this.blockchain.chain.length,
            latestHash: this.blockchain.getLatestBlock()?.hash,
            difficulty: this.blockchain.difficulty,
            pendingTx: this.blockchain.pendingTransactions.length
        } : { error: 'Blockchain not connected' };

        this.requestResponse.respond(peerId, requestId, info);
    }

    respondBlocks(peerId, requestId, params) {
        if (!this.blockchain) {
            this.requestResponse.respond(peerId, requestId, { error: 'Blockchain not connected' });
            return;
        }

        const { fromIndex = 0, count = 10 } = params || {};
        const blocks = this.blockchain.chain.slice(fromIndex, fromIndex + count);
        this.requestResponse.respond(peerId, requestId, { blocks });
    }

    respondTransactions(peerId, requestId, params) {
        if (!this.blockchain) {
            this.requestResponse.respond(peerId, requestId, { error: 'Blockchain not connected' });
            return;
        }

        const transactions = this.blockchain.pendingTransactions.slice(0, 50);
        this.requestResponse.respond(peerId, requestId, { transactions });
    }

    respondPeers(peerId, requestId) {
        const peerList = Array.from(this.peers.values()).map(p => ({
            id: p.id,
            address: p.address,
            port: p.port,
            protocol: p.protocol
        }));

        this.requestResponse.respond(peerId, requestId, { peers: peerList });
    }

    /**
     * Handle pong (latency measurement)
     */
    handlePong(peerId, data) {
        const peer = this.peers.get(peerId);
        if (peer && data.timestamp) {
            peer.latency = Date.now() - data.timestamp;
        }
    }

    /**
     * Decrease peer reputation
     */
    decreaseReputation(peerId, amount) {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        peer.reputation = Math.max(0, peer.reputation - amount);

        // Disconnect if reputation too low
        if (peer.reputation <= 0) {
            console.warn(`Disconnecting ${peerId} due to low reputation`);
            this.transport.disconnect(peerId);
        }
    }

    /**
     * Start housekeeping tasks
     */
    startHousekeeping() {
        // Ping peers every 30 seconds
        this.pingInterval = setInterval(() => {
            this.peers.forEach((peer, peerId) => {
                this.sendMessage(peerId, { type: 'PING', timestamp: Date.now() });
            });
        }, 30000);

        // Clean stale peers every 60 seconds
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const staleThreshold = 120000; // 2 minutes

            this.peers.forEach((peer, peerId) => {
                if (now - peer.lastSeen > staleThreshold) {
                    console.log(`Removing stale peer: ${peerId.slice(0, 16)}...`);
                    this.transport.disconnect(peerId);
                }
            });
        }, 60000);

        // Find more peers if needed every 5 minutes
        this.discoveryInterval = setInterval(() => {
            if (this.peers.size < this.config.minPeers) {
                this.discoverPeers();
            }
        }, 300000);

        // Log stats every minute
        this.statsInterval = setInterval(() => {
            this.logStats();
        }, 60000);
    }

    /**
     * Stop housekeeping tasks
     */
    stopHousekeeping() {
        clearInterval(this.pingInterval);
        clearInterval(this.cleanupInterval);
        clearInterval(this.discoveryInterval);
        clearInterval(this.statsInterval);
    }

    /**
     * Log network statistics
     */
    logStats() {
        const uptime = this.stats.startTime ? Math.floor((Date.now() - this.stats.startTime) / 1000) : 0;

        console.log('📊 Network Stats:');
        console.log(`   Uptime: ${uptime}s | Peers: ${this.peers.size}`);
        console.log(`   Msgs: ↓${this.stats.messagesReceived} ↑${this.stats.messagesSent}`);
        console.log(`   Blocks: ${this.stats.blocksReceived} | Txs: ${this.stats.transactionsReceived}`);
    }

    /**
     * Get network status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            nodeId: this.config.nodeId,
            networkId: this.config.networkId,
            peerCount: this.peers.size,
            peers: Array.from(this.peers.values()).map(p => ({
                id: p.id,
                address: p.address,
                protocol: p.protocol,
                latency: p.latency,
                reputation: p.reputation
            })),
            stats: this.stats,
            config: {
                maxPeers: this.config.maxPeers,
                minPeers: this.config.minPeers,
                enableDHT: this.config.enableDHT,
                enableGossip: this.config.enableGossip,
                enableEncryption: this.config.enableEncryption
            }
        };
    }

    /**
     * Connect blockchain instance
     */
    setBlockchain(blockchain) {
        this.blockchain = blockchain;
        console.log('🔗 Blockchain connected to P2P network');
    }

    /**
     * Get peer by ID
     */
    getPeer(peerId) {
        return this.peers.get(peerId);
    }

    /**
     * Get all peers
     */
    getPeers() {
        return Array.from(this.peers.values());
    }
}

module.exports = NetworkManager;
