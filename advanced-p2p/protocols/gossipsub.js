/**
 * CHEESE Blockchain - Gossipsub Protocol
 * Efficient message propagation using mesh + fanout topology
 * Similar to Ethereum 2.0 and IPFS
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class GossipSub extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            nodeId: config.nodeId,
            D: config.D || 6, // Target mesh degree
            Dlo: config.Dlo || 4, // Low watermark
            Dhi: config.Dhi || 12, // High watermark
            Dlazy: config.Dlazy || 6, // Lazy push targets
            heartbeatInterval: config.heartbeatInterval || 1000,
            fanoutTTL: config.fanoutTTL || 60000, // 1 minute
            mcacheLen: config.mcacheLen || 5, // Message cache rounds
            mcacheGossip: config.mcacheGossip || 3, // Gossip history
            seenTTL: config.seenTTL || 120000, // 2 minutes
            ...config
        };

        // Topics and meshes
        this.topics = new Map(); // topic -> Set of subscribed peers
        this.mesh = new Map(); // topic -> Set of mesh peers
        this.fanout = new Map(); // topic -> Set of fanout peers
        this.fanoutLastPub = new Map(); // topic -> last publish time

        // Message cache
        this.mcache = new Map(); // messageId -> { data, topics, from, receivedAt }
        this.mcacheRounds = []; // Array of messageId Sets for each round

        // Seen messages (deduplication)
        this.seen = new Map(); // messageId -> timestamp

        // All subscribed peers per topic
        this.subscribedPeers = new Map(); // topic -> Set of peers

        // Peer scores for optimization
        this.peerScores = new Map(); // peerId -> score

        this.isRunning = false;

        console.log('📢 Gossipsub Protocol initialized');
    }

    /**
     * Start Gossipsub
     */
    async start() {
        this.isRunning = true;

        // Start heartbeat
        this.heartbeatTimer = setInterval(() => {
            this.heartbeat();
        }, this.config.heartbeatInterval);

        // Start message cache cleanup
        this.cacheTimer = setInterval(() => {
            this.cleanMessageCache();
        }, this.config.heartbeatInterval * this.config.mcacheLen);

        console.log('   Gossipsub started');
    }

    /**
     * Stop Gossipsub
     */
    async stop() {
        this.isRunning = false;

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.cacheTimer) {
            clearInterval(this.cacheTimer);
            this.cacheTimer = null;
        }
    }

    /**
     * Subscribe to a topic
     */
    subscribe(topic) {
        if (!this.topics.has(topic)) {
            this.topics.set(topic, new Set());
            this.mesh.set(topic, new Set());
            console.log(`   Subscribed to topic: ${topic}`);
        }

        // Notify peers of subscription
        this.emit('subscribe', topic);
    }

    /**
     * Unsubscribe from a topic
     */
    unsubscribe(topic) {
        this.topics.delete(topic);
        this.mesh.delete(topic);
        this.fanout.delete(topic);
        this.fanoutLastPub.delete(topic);

        console.log(`   Unsubscribed from topic: ${topic}`);

        // Notify peers
        this.emit('unsubscribe', topic);
    }

    /**
     * Publish message to topic
     */
    publish(topic, data) {
        const messageId = this.generateMessageId(data);

        // Check if already seen
        if (this.seen.has(messageId)) {
            return;
        }

        this.seen.set(messageId, Date.now());

        const message = {
            id: messageId,
            topics: [topic],
            data: data,
            from: this.config.nodeId,
            seqno: Date.now(),
            signature: null // Could add signature for verification
        };

        // Add to cache
        this.addToCache(message);

        // Get peers to send to
        let peersToSend = new Set();

        if (this.topics.has(topic)) {
            // We're subscribed - use mesh
            const meshPeers = this.mesh.get(topic) || new Set();
            peersToSend = new Set(meshPeers);
        } else {
            // Not subscribed - use fanout
            let fanoutPeers = this.fanout.get(topic);

            if (!fanoutPeers || fanoutPeers.size === 0) {
                // Build fanout
                const allPeers = this.subscribedPeers.get(topic) || new Set();
                fanoutPeers = this.selectRandomPeers(allPeers, this.config.D);
                this.fanout.set(topic, fanoutPeers);
            }

            this.fanoutLastPub.set(topic, Date.now());
            peersToSend = new Set(fanoutPeers);
        }

        // Send to selected peers
        for (const peerId of peersToSend) {
            this.emit('send', peerId, {
                type: 'GOSSIP',
                action: 'MESSAGE',
                message: message
            });
        }

        // Also do lazy push (IHAVE) to random peers not in mesh
        this.lazyPush(topic, messageId);

        console.log(`   Published to ${topic}: ${messageId.slice(0, 8)}... (${peersToSend.size} peers)`);
    }

    /**
     * Handle incoming message
     */
    handleMessage(peerId, data) {
        switch (data.action) {
            case 'MESSAGE':
                this.handleGossipMessage(peerId, data.message);
                break;

            case 'IHAVE':
                this.handleIHave(peerId, data.messageIds);
                break;

            case 'IWANT':
                this.handleIWant(peerId, data.messageIds);
                break;

            case 'GRAFT':
                this.handleGraft(peerId, data.topic);
                break;

            case 'PRUNE':
                this.handlePrune(peerId, data.topic);
                break;

            case 'SUBSCRIBE':
                this.handlePeerSubscribe(peerId, data.topic);
                break;

            case 'UNSUBSCRIBE':
                this.handlePeerUnsubscribe(peerId, data.topic);
                break;
        }
    }

    /**
     * Handle gossip message
     */
    handleGossipMessage(peerId, message) {
        const messageId = message.id;

        // Check if already seen
        if (this.seen.has(messageId)) {
            return;
        }

        this.seen.set(messageId, Date.now());

        // Add to cache
        this.addToCache(message);

        // Emit to application
        for (const topic of message.topics) {
            if (this.topics.has(topic)) {
                this.emit('message', topic, message.data, message.from);
            }
        }

        // Forward to mesh peers (except sender)
        for (const topic of message.topics) {
            const meshPeers = this.mesh.get(topic);
            if (meshPeers) {
                for (const peer of meshPeers) {
                    if (peer !== peerId) {
                        this.emit('send', peer, {
                            type: 'GOSSIP',
                            action: 'MESSAGE',
                            message: message
                        });
                    }
                }
            }
        }
    }

    /**
     * Handle IHAVE (lazy push notification)
     */
    handleIHave(peerId, messageIds) {
        const wanted = [];

        for (const msgId of messageIds) {
            if (!this.seen.has(msgId) && !this.mcache.has(msgId)) {
                wanted.push(msgId);
            }
        }

        if (wanted.length > 0) {
            this.emit('send', peerId, {
                type: 'GOSSIP',
                action: 'IWANT',
                messageIds: wanted
            });
        }
    }

    /**
     * Handle IWANT (message request)
     */
    handleIWant(peerId, messageIds) {
        for (const msgId of messageIds) {
            const cached = this.mcache.get(msgId);
            if (cached) {
                this.emit('send', peerId, {
                    type: 'GOSSIP',
                    action: 'MESSAGE',
                    message: cached
                });
            }
        }
    }

    /**
     * Handle GRAFT (join mesh)
     */
    handleGraft(peerId, topic) {
        const mesh = this.mesh.get(topic);
        if (mesh) {
            mesh.add(peerId);
            console.log(`   GRAFT from ${peerId.slice(0, 8)}... for ${topic}`);
        }
    }

    /**
     * Handle PRUNE (leave mesh)
     */
    handlePrune(peerId, topic) {
        const mesh = this.mesh.get(topic);
        if (mesh) {
            mesh.delete(peerId);
            console.log(`   PRUNE from ${peerId.slice(0, 8)}... for ${topic}`);
        }
    }

    /**
     * Handle peer subscription
     */
    handlePeerSubscribe(peerId, topic) {
        if (!this.subscribedPeers.has(topic)) {
            this.subscribedPeers.set(topic, new Set());
        }
        this.subscribedPeers.get(topic).add(peerId);
    }

    /**
     * Handle peer unsubscription
     */
    handlePeerUnsubscribe(peerId, topic) {
        const peers = this.subscribedPeers.get(topic);
        if (peers) {
            peers.delete(peerId);
        }

        const mesh = this.mesh.get(topic);
        if (mesh) {
            mesh.delete(peerId);
        }
    }

    /**
     * Add peer to gossip
     */
    addPeer(peerId) {
        // For each topic we're subscribed to, consider adding to mesh
        for (const [topic, mesh] of this.mesh) {
            if (mesh.size < this.config.D) {
                mesh.add(peerId);

                // Send GRAFT
                this.emit('send', peerId, {
                    type: 'GOSSIP',
                    action: 'GRAFT',
                    topic: topic
                });
            }
        }
    }

    /**
     * Remove peer from gossip
     */
    removePeer(peerId) {
        for (const [topic, mesh] of this.mesh) {
            mesh.delete(peerId);
        }

        for (const [topic, fanout] of this.fanout) {
            fanout.delete(peerId);
        }

        for (const [topic, peers] of this.subscribedPeers) {
            peers.delete(peerId);
        }
    }

    /**
     * Lazy push IHAVE to random peers
     */
    lazyPush(topic, messageId) {
        const allPeers = this.subscribedPeers.get(topic) || new Set();
        const meshPeers = this.mesh.get(topic) || new Set();

        // Get non-mesh peers
        const nonMeshPeers = new Set();
        for (const peer of allPeers) {
            if (!meshPeers.has(peer)) {
                nonMeshPeers.add(peer);
            }
        }

        // Select random peers
        const selected = this.selectRandomPeers(nonMeshPeers, this.config.Dlazy);

        for (const peerId of selected) {
            this.emit('send', peerId, {
                type: 'GOSSIP',
                action: 'IHAVE',
                messageIds: [messageId]
            });
        }
    }

    /**
     * Heartbeat - maintain mesh
     */
    heartbeat() {
        for (const [topic, mesh] of this.mesh) {
            // Too few peers - graft more
            if (mesh.size < this.config.Dlo) {
                const allPeers = this.subscribedPeers.get(topic) || new Set();
                const available = new Set();

                for (const peer of allPeers) {
                    if (!mesh.has(peer)) {
                        available.add(peer);
                    }
                }

                const needed = this.config.D - mesh.size;
                const toGraft = this.selectRandomPeers(available, needed);

                for (const peerId of toGraft) {
                    mesh.add(peerId);
                    this.emit('send', peerId, {
                        type: 'GOSSIP',
                        action: 'GRAFT',
                        topic: topic
                    });
                }
            }

            // Too many peers - prune some
            if (mesh.size > this.config.Dhi) {
                const excess = mesh.size - this.config.D;
                const toPrune = this.selectRandomPeers(mesh, excess);

                for (const peerId of toPrune) {
                    mesh.delete(peerId);
                    this.emit('send', peerId, {
                        type: 'GOSSIP',
                        action: 'PRUNE',
                        topic: topic
                    });
                }
            }
        }

        // Clean up expired fanout
        const now = Date.now();
        for (const [topic, lastPub] of this.fanoutLastPub) {
            if (now - lastPub > this.config.fanoutTTL) {
                this.fanout.delete(topic);
                this.fanoutLastPub.delete(topic);
            }
        }

        // Clean old seen messages
        for (const [msgId, timestamp] of this.seen) {
            if (now - timestamp > this.config.seenTTL) {
                this.seen.delete(msgId);
            }
        }
    }

    /**
     * Add message to cache
     */
    addToCache(message) {
        this.mcache.set(message.id, {
            ...message,
            receivedAt: Date.now()
        });
    }

    /**
     * Clean old messages from cache
     */
    cleanMessageCache() {
        const maxAge = this.config.heartbeatInterval * this.config.mcacheLen;
        const now = Date.now();

        for (const [msgId, msg] of this.mcache) {
            if (now - msg.receivedAt > maxAge) {
                this.mcache.delete(msgId);
            }
        }
    }

    /**
     * Generate message ID
     */
    generateMessageId(data) {
        const content = typeof data === 'string' ? data : JSON.stringify(data);
        return crypto.createHash('sha256')
            .update(content + Date.now() + Math.random())
            .digest('hex')
            .slice(0, 32);
    }

    /**
     * Select random peers from set
     */
    selectRandomPeers(peers, count) {
        const peerArray = Array.from(peers);
        const selected = new Set();

        while (selected.size < count && selected.size < peerArray.length) {
            const idx = Math.floor(Math.random() * peerArray.length);
            selected.add(peerArray[idx]);
        }

        return selected;
    }

    /**
     * Get stats
     */
    getStats() {
        const stats = {
            topics: [],
            totalMeshPeers: 0,
            cachedMessages: this.mcache.size,
            seenMessages: this.seen.size
        };

        for (const [topic, mesh] of this.mesh) {
            const topicStats = {
                topic,
                meshPeers: mesh.size,
                subscribedPeers: (this.subscribedPeers.get(topic) || new Set()).size
            };
            stats.topics.push(topicStats);
            stats.totalMeshPeers += mesh.size;
        }

        return stats;
    }
}

module.exports = GossipSub;
