/**
 * CHEESE Blockchain - DHT (Kademlia) Peer Discovery
 * Distributed Hash Table for decentralized peer discovery
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class DHTDiscovery extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            nodeId: config.nodeId,
            k: config.k || 20, // Bucket size (standard Kademlia)
            alpha: config.alpha || 3, // Parallel lookups
            refreshInterval: config.refreshInterval || 3600000, // 1 hour
            ...config
        };

        // Routing table: 256 k-buckets (one for each bit)
        this.buckets = new Array(256).fill(null).map(() => []);

        // Known peers
        this.peers = new Map();

        // Pending lookups
        this.pendingLookups = new Map();

        console.log('🔍 DHT Discovery initialized');
    }

    /**
     * Start DHT
     */
    async start() {
        // Start periodic refresh
        this.refreshTimer = setInterval(() => {
            this.refreshBuckets();
        }, this.config.refreshInterval);

        console.log('   DHT started with Kademlia algorithm');
    }

    /**
     * Stop DHT
     */
    async stop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Add peer to DHT
     */
    addPeer(peer) {
        if (!peer.id || peer.id === this.config.nodeId) return;

        const bucketIndex = this.getBucketIndex(peer.id);
        const bucket = this.buckets[bucketIndex];

        // Check if peer already exists
        const existingIndex = bucket.findIndex(p => p.id === peer.id);
        if (existingIndex !== -1) {
            // Move to end (most recently seen)
            bucket.splice(existingIndex, 1);
            bucket.push(peer);
            return;
        }

        // Add to bucket if not full
        if (bucket.length < this.config.k) {
            bucket.push({
                id: peer.id,
                address: peer.address,
                port: peer.port,
                protocol: peer.protocol || 'tcp',
                addedAt: Date.now(),
                lastSeen: Date.now()
            });

            this.peers.set(peer.id, peer);
            this.emit('peer:discovered', peer);
        } else {
            // Bucket full - ping oldest, if no response replace with new
            const oldest = bucket[0];
            this.emit('peer:ping', oldest);
        }
    }

    /**
     * Remove peer from DHT
     */
    removePeer(peerId) {
        const bucketIndex = this.getBucketIndex(peerId);
        const bucket = this.buckets[bucketIndex];
        const index = bucket.findIndex(p => p.id === peerId);

        if (index !== -1) {
            bucket.splice(index, 1);
        }

        this.peers.delete(peerId);
    }

    /**
     * Find peers close to a target ID
     */
    async findPeers(count = 10, targetId = null) {
        const target = targetId || crypto.randomBytes(32).toString('hex');
        const closest = this.findClosestPeers(target, count);

        // For each closest peer, ask them for their closest peers
        for (const peer of closest) {
            this.emit('peer:query', peer, target);
        }

        return closest;
    }

    /**
     * Find closest peers to a target from local routing table
     */
    findClosestPeers(targetId, count = 20) {
        const allPeers = [];

        for (const bucket of this.buckets) {
            allPeers.push(...bucket);
        }

        // Sort by XOR distance
        allPeers.sort((a, b) => {
            const distA = this.xorDistance(a.id, targetId);
            const distB = this.xorDistance(b.id, targetId);
            return this.compareDistances(distA, distB);
        });

        return allPeers.slice(0, count);
    }

    /**
     * Handle FIND_NODE request
     */
    handleFindNode(targetId) {
        return this.findClosestPeers(targetId, this.config.k);
    }

    /**
     * Handle FIND_NODE response
     */
    handleFindNodeResponse(peers) {
        for (const peer of peers) {
            this.addPeer(peer);
        }
    }

    /**
     * Handle incoming DHT message
     */
    handleMessage(peerId, message) {
        switch (message.action) {
            case 'FIND_NODE':
                const closest = this.handleFindNode(message.targetId);
                this.emit('response', peerId, {
                    type: 'DHT',
                    action: 'FIND_NODE_RESPONSE',
                    requestId: message.requestId,
                    peers: closest
                });
                break;

            case 'FIND_NODE_RESPONSE':
                this.handleFindNodeResponse(message.peers);
                break;

            case 'PING':
                this.emit('response', peerId, {
                    type: 'DHT',
                    action: 'PONG',
                    requestId: message.requestId
                });
                break;

            case 'PONG':
                // Update last seen
                const peer = this.peers.get(peerId);
                if (peer) {
                    peer.lastSeen = Date.now();
                    this.emit('peer:updated', peer);
                }
                break;
        }
    }

    /**
     * Get bucket index for a peer ID
     */
    getBucketIndex(peerId) {
        const distance = this.xorDistance(this.config.nodeId, peerId);

        // Find first non-zero byte
        for (let i = 0; i < distance.length; i++) {
            if (distance[i] !== 0) {
                // Find first set bit in this byte
                for (let bit = 7; bit >= 0; bit--) {
                    if (distance[i] & (1 << bit)) {
                        return (distance.length - 1 - i) * 8 + bit;
                    }
                }
            }
        }

        return 0;
    }

    /**
     * Calculate XOR distance between two node IDs
     */
    xorDistance(id1, id2) {
        const buf1 = Buffer.from(id1, 'hex');
        const buf2 = Buffer.from(id2, 'hex');
        const result = Buffer.alloc(buf1.length);

        for (let i = 0; i < buf1.length; i++) {
            result[i] = buf1[i] ^ buf2[i];
        }

        return result;
    }

    /**
     * Compare two XOR distances
     */
    compareDistances(dist1, dist2) {
        for (let i = dist1.length - 1; i >= 0; i--) {
            if (dist1[i] < dist2[i]) return -1;
            if (dist1[i] > dist2[i]) return 1;
        }
        return 0;
    }

    /**
     * Refresh all buckets
     */
    refreshBuckets() {
        console.log('🔄 Refreshing DHT buckets...');

        for (let i = 0; i < this.buckets.length; i++) {
            if (this.buckets[i].length > 0) {
                // Generate random ID in this bucket's range and look it up
                const randomId = this.generateRandomIdForBucket(i);
                this.findPeers(this.config.k, randomId);
            }
        }
    }

    /**
     * Generate random ID that would fall into specific bucket
     */
    generateRandomIdForBucket(bucketIndex) {
        const myId = Buffer.from(this.config.nodeId, 'hex');
        const result = Buffer.from(myId);

        // Flip the bit at bucketIndex
        const byteIndex = Math.floor(bucketIndex / 8);
        const bitIndex = bucketIndex % 8;

        result[result.length - 1 - byteIndex] ^= (1 << bitIndex);

        // Randomize remaining less significant bits
        for (let i = result.length - byteIndex; i < result.length; i++) {
            result[i] = Math.floor(Math.random() * 256);
        }

        return result.toString('hex');
    }

    /**
     * Get routing table stats
     */
    getStats() {
        let totalPeers = 0;
        let nonEmptyBuckets = 0;

        for (const bucket of this.buckets) {
            if (bucket.length > 0) {
                totalPeers += bucket.length;
                nonEmptyBuckets++;
            }
        }

        return {
            totalPeers,
            nonEmptyBuckets,
            bucketSize: this.config.k
        };
    }

    /**
     * Get all known peers
     */
    getAllPeers() {
        return Array.from(this.peers.values());
    }
}

module.exports = DHTDiscovery;
