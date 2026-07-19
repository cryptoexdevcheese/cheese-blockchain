/**
 * CHEESE Blockchain - Peer Authentication
 * Secure peer identity verification
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class PeerAuth extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            nodeId: config.nodeId,
            challengeTimeout: config.challengeTimeout || 10000,
            ...config
        };

        // Pending challenges
        this.pendingChallenges = new Map();

        // Authenticated peers
        this.authenticatedPeers = new Set();

        // Blacklist
        this.blacklist = new Set();

        console.log('🔐 Peer Authentication initialized');
    }

    /**
     * Start authentication service
     */
    async start() {
        console.log('   Peer authentication ready');
    }

    /**
     * Authenticate a peer
     */
    async authenticate(peer) {
        if (this.blacklist.has(peer.address)) {
            throw new Error('Peer is blacklisted');
        }

        // Generate challenge
        const challenge = crypto.randomBytes(32).toString('hex');

        // Store pending challenge
        this.pendingChallenges.set(peer.id, {
            challenge,
            timestamp: Date.now()
        });

        // Send challenge
        this.emit('send', peer.id, {
            type: 'AUTH',
            action: 'CHALLENGE',
            challenge: challenge
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingChallenges.delete(peer.id);
                reject(new Error('Authentication timeout'));
            }, this.config.challengeTimeout);

            // Store resolver
            const pending = this.pendingChallenges.get(peer.id);
            pending.resolve = () => {
                clearTimeout(timeout);
                resolve(true);
            };
            pending.reject = (err) => {
                clearTimeout(timeout);
                reject(err);
            };
        });
    }

    /**
     * Handle authentication message
     */
    handleMessage(peerId, message) {
        switch (message.action) {
            case 'CHALLENGE':
                this.handleChallenge(peerId, message.challenge);
                break;

            case 'RESPONSE':
                this.handleResponse(peerId, message.response, message.nodeId);
                break;

            case 'SUCCESS':
                this.handleSuccess(peerId);
                break;

            case 'FAILURE':
                this.handleFailure(peerId, message.reason);
                break;
        }
    }

    /**
     * Handle incoming challenge
     */
    handleChallenge(peerId, challenge) {
        // Create response (sign the challenge)
        const response = crypto.createHmac('sha256', this.config.nodeId)
            .update(challenge)
            .digest('hex');

        this.emit('send', peerId, {
            type: 'AUTH',
            action: 'RESPONSE',
            response: response,
            nodeId: this.config.nodeId
        });
    }

    /**
     * Handle challenge response
     */
    handleResponse(peerId, response, remoteNodeId) {
        const pending = this.pendingChallenges.get(peerId);

        if (!pending) {
            return;
        }

        // Verify response
        const expected = crypto.createHmac('sha256', remoteNodeId)
            .update(pending.challenge)
            .digest('hex');

        if (response === expected) {
            this.authenticatedPeers.add(peerId);
            this.pendingChallenges.delete(peerId);

            this.emit('send', peerId, {
                type: 'AUTH',
                action: 'SUCCESS'
            });

            if (pending.resolve) {
                pending.resolve();
            }

            console.log(`   ✅ Peer authenticated: ${peerId.slice(0, 16)}...`);
            this.emit('authenticated', peerId);
        } else {
            this.emit('send', peerId, {
                type: 'AUTH',
                action: 'FAILURE',
                reason: 'Invalid response'
            });

            if (pending.reject) {
                pending.reject(new Error('Authentication failed'));
            }

            console.log(`   ❌ Authentication failed: ${peerId.slice(0, 16)}...`);
        }
    }

    /**
     * Handle authentication success
     */
    handleSuccess(peerId) {
        this.authenticatedPeers.add(peerId);
        console.log(`   ✅ Authenticated with peer: ${peerId.slice(0, 16)}...`);
        this.emit('authenticated', peerId);
    }

    /**
     * Handle authentication failure
     */
    handleFailure(peerId, reason) {
        const pending = this.pendingChallenges.get(peerId);
        if (pending && pending.reject) {
            pending.reject(new Error(reason));
        }
        this.pendingChallenges.delete(peerId);
    }

    /**
     * Check if peer is authenticated
     */
    isAuthenticated(peerId) {
        return this.authenticatedPeers.has(peerId);
    }

    /**
     * Remove peer authentication
     */
    removePeer(peerId) {
        this.authenticatedPeers.delete(peerId);
        this.pendingChallenges.delete(peerId);
    }

    /**
     * Blacklist a peer
     */
    blacklistPeer(address) {
        this.blacklist.add(address);
        console.log(`   🚫 Blacklisted: ${address}`);
    }

    /**
     * Remove from blacklist
     */
    unblacklistPeer(address) {
        this.blacklist.delete(address);
    }

    /**
     * Check if address is blacklisted
     */
    isBlacklisted(address) {
        return this.blacklist.has(address);
    }

    /**
     * Get authentication stats
     */
    getStats() {
        return {
            authenticatedPeers: this.authenticatedPeers.size,
            pendingChallenges: this.pendingChallenges.size,
            blacklistedAddresses: this.blacklist.size
        };
    }
}

module.exports = PeerAuth;
