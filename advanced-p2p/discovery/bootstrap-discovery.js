/**
 * CHEESE Blockchain - Bootstrap Node Discovery
 * Connects to known bootstrap nodes for initial peer discovery
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');

class BootstrapDiscovery extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            bootstrapNodes: config.bootstrapNodes || [],
            retryInterval: config.retryInterval || 30000,
            maxRetries: config.maxRetries || 5,
            ...config
        };

        this.connectedNodes = new Set();
        this.failedNodes = new Map(); // nodeAddress -> retry count

        console.log('🌱 Bootstrap Discovery initialized');
    }

    /**
     * Connect to bootstrap nodes
     */
    async connect(bootstrapNodes = null) {
        const nodes = bootstrapNodes || this.config.bootstrapNodes;

        if (nodes.length === 0) {
            console.log('   No bootstrap nodes configured');
            return [];
        }

        console.log(`   Connecting to ${nodes.length} bootstrap nodes...`);

        const results = [];

        for (const node of nodes) {
            try {
                const result = await this.connectToNode(node);
                if (result) {
                    results.push(result);
                    this.connectedNodes.add(node.address || node);
                }
            } catch (error) {
                console.warn(`   Failed to connect to bootstrap: ${node.address || node}`);
                this.trackFailure(node);
            }
        }

        console.log(`   Connected to ${results.length}/${nodes.length} bootstrap nodes`);

        // Start retry timer for failed nodes
        if (this.failedNodes.size > 0) {
            this.startRetryTimer();
        }

        return results;
    }

    /**
     * Connect to a single bootstrap node
     */
    async connectToNode(node) {
        const address = typeof node === 'string' ? node : node.address;
        const port = typeof node === 'object' ? node.port : 30303;
        const protocol = typeof node === 'object' ? node.protocol : 'tcp';

        this.emit('connect', {
            address,
            port,
            protocol
        });

        return {
            address,
            port,
            protocol,
            connectedAt: Date.now()
        };
    }

    /**
     * Track connection failure
     */
    trackFailure(node) {
        const address = typeof node === 'string' ? node : node.address;
        const retryCount = (this.failedNodes.get(address) || 0) + 1;
        this.failedNodes.set(address, retryCount);
    }

    /**
     * Start retry timer
     */
    startRetryTimer() {
        if (this.retryTimer) return;

        this.retryTimer = setInterval(() => {
            this.retryFailedNodes();
        }, this.config.retryInterval);
    }

    /**
     * Retry failed nodes
     */
    async retryFailedNodes() {
        const toRetry = [];

        this.failedNodes.forEach((retryCount, address) => {
            if (retryCount < this.config.maxRetries) {
                toRetry.push(address);
            }
        });

        if (toRetry.length === 0) {
            this.stopRetryTimer();
            return;
        }

        console.log(`🔄 Retrying ${toRetry.length} failed bootstrap nodes...`);

        for (const address of toRetry) {
            try {
                await this.connectToNode({ address });
                this.connectedNodes.add(address);
                this.failedNodes.delete(address);
            } catch (error) {
                this.trackFailure({ address });
            }
        }
    }

    /**
     * Stop retry timer
     */
    stopRetryTimer() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }
    }

    /**
     * Add bootstrap node
     */
    addBootstrapNode(node) {
        this.config.bootstrapNodes.push(node);
    }

    /**
     * Get connected bootstrap nodes
     */
    getConnectedNodes() {
        return Array.from(this.connectedNodes);
    }

    /**
     * Get failed nodes
     */
    getFailedNodes() {
        return Array.from(this.failedNodes.entries()).map(([address, retries]) => ({
            address,
            retries
        }));
    }
}

module.exports = BootstrapDiscovery;
