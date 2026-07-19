/**
 * CHEESE Blockchain - Request/Response Protocol
 * Handles chain sync, block requests, and peer queries
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class RequestResponse extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            timeout: config.requestTimeout || 30000, // 30 seconds
            maxConcurrent: config.maxConcurrentRequests || 10,
            ...config
        };

        // Pending requests
        this.pendingRequests = new Map(); // requestId -> { resolve, reject, timer, peerId }

        // Request statistics
        this.stats = {
            requestsSent: 0,
            responsesReceived: 0,
            requestsTimedOut: 0,
            requestsHandled: 0
        };

        console.log('📨 Request/Response Protocol initialized');
    }

    /**
     * Send request to peer
     */
    send(peerId, request) {
        return new Promise((resolve, reject) => {
            const requestId = this.generateRequestId();

            // Create request message
            const message = {
                type: 'REQUEST',
                id: requestId,
                method: request.type || request.method,
                params: request.params || request,
                timestamp: Date.now()
            };

            // Set timeout
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                this.stats.requestsTimedOut++;
                reject(new Error(`Request timeout: ${message.method}`));
            }, this.config.timeout);

            // Store pending request
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timer,
                peerId,
                method: message.method,
                sentAt: Date.now()
            });

            this.stats.requestsSent++;

            // Emit to transport
            this.emit('send', peerId, message);
        });
    }

    /**
     * Respond to a request
     */
    respond(peerId, requestId, data) {
        const response = {
            type: 'RESPONSE',
            id: requestId,
            data: data,
            timestamp: Date.now()
        };

        this.emit('send', peerId, response);
    }

    /**
     * Handle incoming request
     */
    handleRequest(peerId, data) {
        this.stats.requestsHandled++;

        // Emit for network manager to handle
        this.emit('request', peerId, {
            id: data.id,
            method: data.method,
            params: data.params
        });
    }

    /**
     * Handle incoming response
     */
    handleResponse(peerId, data) {
        const pending = this.pendingRequests.get(data.id);

        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(data.id);
            this.stats.responsesReceived++;

            // Calculate latency
            const latency = Date.now() - pending.sentAt;

            pending.resolve({
                data: data.data,
                latency,
                peerId
            });

            this.emit('response', peerId, {
                requestId: data.id,
                data: data.data,
                latency
            });
        }
    }

    /**
     * Request chain info from peer
     */
    async getChainInfo(peerId) {
        return await this.send(peerId, {
            type: 'GET_CHAIN_INFO'
        });
    }

    /**
     * Request blocks from peer
     */
    async getBlocks(peerId, fromIndex, count = 10) {
        return await this.send(peerId, {
            type: 'GET_BLOCKS',
            params: { fromIndex, count }
        });
    }

    /**
     * Request specific block by hash
     */
    async getBlockByHash(peerId, hash) {
        return await this.send(peerId, {
            type: 'GET_BLOCK_BY_HASH',
            params: { hash }
        });
    }

    /**
     * Request pending transactions
     */
    async getPendingTransactions(peerId) {
        return await this.send(peerId, {
            type: 'GET_PENDING_TRANSACTIONS'
        });
    }

    /**
     * Request peer's peer list
     */
    async getPeers(peerId) {
        return await this.send(peerId, {
            type: 'GET_PEERS'
        });
    }

    /**
     * Request node info
     */
    async getNodeInfo(peerId) {
        return await this.send(peerId, {
            type: 'GET_NODE_INFO'
        });
    }

    /**
     * Cancel pending request
     */
    cancel(requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(requestId);
            pending.reject(new Error('Request cancelled'));
        }
    }

    /**
     * Cancel all pending requests for peer
     */
    cancelAllForPeer(peerId) {
        for (const [requestId, pending] of this.pendingRequests) {
            if (pending.peerId === peerId) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(requestId);
                pending.reject(new Error('Peer disconnected'));
            }
        }
    }

    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return crypto.randomBytes(8).toString('hex');
    }

    /**
     * Get number of pending requests
     */
    getPendingCount() {
        return this.pendingRequests.size;
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            pendingRequests: this.pendingRequests.size
        };
    }
}

module.exports = RequestResponse;
