/**
 * P2P Network Layer for Distributed Blockchain
 * Uses WebSockets for peer-to-peer communication
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class BlockchainNetwork extends EventEmitter {
    constructor(port, blockchain, database, nodeRole = 'HYBRID') {
        super();
        this.port = port;
        this.blockchain = blockchain;
        this.database = database;
        this.nodeRole = nodeRole;
        this.server = null;
        this.peers = new Map();
        this.isServer = false;
    }

    // Start as server
    startServer() {
        this.isServer = true;
        this.server = new WebSocket.Server({ port: this.port });

        this.server.on('connection', (ws, req) => {
            const peerAddress = req.socket.remoteAddress;
            console.log(`New peer connected: ${peerAddress}`);

            this.peers.set(peerAddress, {
                ws,
                address: peerAddress,
                lastSeen: Date.now(),
                isActive: true
            });

            // Send current chain to new peer
            this.sendChain(ws);

            ws.on('message', async (message) => {
                await this.handleMessage(ws, message);
            });

            ws.on('close', () => {
                console.log(`Peer disconnected: ${peerAddress}`);
                this.peers.delete(peerAddress);
            });

            ws.on('error', (error) => {
                console.error(`Peer error: ${error.message}`);
            });
        });

        console.log(`🌐 P2P Network Server started on port ${this.port}`);
    }

    // Connect to peer
    connectToPeer(host, port) {
        return new Promise((resolve, reject) => {
            const url = `ws://${host}:${port}`;
            const ws = new WebSocket(url);

            ws.on('open', () => {
                console.log(`Connected to peer: ${url}`);
                this.peers.set(url, {
                    ws,
                    address: url,
                    lastSeen: Date.now(),
                    isActive: true
                });

                // Request chain from peer
                this.sendMessage(ws, { type: 'REQUEST_CHAIN' });
                resolve(ws);
            });

            ws.on('message', async (message) => {
                await this.handleMessage(ws, message);
            });

            ws.on('error', (error) => {
                console.error(`Connection error to ${url}: ${error.message}`);
                reject(error);
            });

            ws.on('close', () => {
                console.log(`Disconnected from peer: ${url}`);
                this.peers.delete(url);
            });
        });
    }

    async handleMessage(ws, message) {
        try {
            const data = JSON.parse(message.toString());

            switch (data.type) {
                case 'REQUEST_CHAIN':
                    this.sendChain(ws);
                    break;

                case 'CHAIN':
                    await this.handleReceivedChain(data.chain);
                    break;

                case 'NEW_BLOCK':
                    await this.handleNewBlock(data.block);
                    break;

                case 'NEW_TRANSACTION':
                    await this.handleNewTransaction(data.transaction);
                    break;

                case 'PING':
                    this.sendMessage(ws, { type: 'PONG' });
                    break;
                    
                case 'GOVERNANCE_VOTE':
                case 'SMART_CONTRACT_QUERY':
                    if (this.nodeRole === 'MINING') {
                        console.log(`🛡️ [MINING NODE] Ignored ${data.type} from ${data.senderRole || 'UNKNOWN'} to conserve resources.`);
                        return;
                    }
                    // Handle governance messages (placeholder for full implementation)
                    console.log(`[${this.nodeRole} NODE] Processing ${data.type}`);
                    break;

                default:
                    console.log(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error(`Error handling message: ${error.message}`);
        }
    }

    sendMessage(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            // Attach node role to every outbound message for traffic routing
            message.senderRole = this.nodeRole;
            ws.send(JSON.stringify(message));
        }
    }

    sendChain(ws) {
        const chain = this.blockchain.chain;
        this.sendMessage(ws, {
            type: 'CHAIN',
            chain: chain
        });
    }

    async handleReceivedChain(chain) {
        console.log('🛡️ SECURITY HARDENING: Automatic Chain Replacement DISABLED.');
        console.log('   Received chain length:', chain.length);
        console.log('   Current chain length:', this.blockchain.chain.length);

        // CRITICAL SECURITY FIX:
        // We are enforcing a Hard Fork (Block 58). 
        // We MUST NOT accept the old "longer" chain (234 blocks) that contains corrupted data.
        // For now, this node is Sovereign and will not accept history rewrites.

        if (chain.length > this.blockchain.chain.length) {
            console.warn('⚠️ Rejected longer chain (Potential Revert Attack or Old Fragment)');
        }

        /* 
        // ORIGINAL LOGIC (VULNERABLE TO REVERT ATTACK)
        if (chain.length > this.blockchain.chain.length) {
            console.log('Received longer chain, replacing current chain...');
            // Validate received chain
            if (this.isValidChain(chain)) {
                this.blockchain.chain = chain;
                // Save to database
                for (const block of chain) {
                    await this.database.saveBlock(block);
                }
                this.emit('chainUpdated', chain);
            }
        }
        */
    }

    async handleNewBlock(block) {
        console.log('Received new block from peer');
        // Validate and add block
        const latestBlock = this.blockchain.getLatestBlock();
        if (block.previousHash === latestBlock.hash) {
            // Validate block
            if (this.blockchain.isChainValid()) {
                this.blockchain.chain.push(block);
                await this.database.saveBlock(block);
                this.emit('blockAdded', block);
            }
        }
    }

    async handleNewTransaction(transaction) {
        console.log('Received new transaction from peer');
        // Add to pending transactions if valid
        const result = this.blockchain.createTransaction(
            transaction.from,
            transaction.to,
            transaction.amount,
            transaction.data
        );

        if (result.success) {
            await this.database.saveTransaction(result.transaction);
            this.emit('transactionAdded', result.transaction);
        }
    }

    broadcastBlock(block) {
        const message = {
            type: 'NEW_BLOCK',
            block: block
        };

        this.broadcast(message);
    }

    broadcastTransaction(transaction) {
        const message = {
            type: 'NEW_TRANSACTION',
            transaction: transaction
        };

        this.broadcast(message);
    }

    broadcast(message) {
        this.peers.forEach((peer) => {
            if (peer.isActive && peer.ws.readyState === WebSocket.OPEN) {
                this.sendMessage(peer.ws, message);
            }
        });
    }

    isValidChain(chain) {
        // Basic chain validation
        for (let i = 1; i < chain.length; i++) {
            const currentBlock = chain[i];
            const previousBlock = chain[i - 1];

            if (currentBlock.previousHash !== previousBlock.hash) {
                return false;
            }
        }
        return true;
    }

    getPeers() {
        return Array.from(this.peers.values());
    }

    async syncWithPeers() {
        // Request chains from all peers
        this.peers.forEach((peer) => {
            if (peer.isActive && peer.ws.readyState === WebSocket.OPEN) {
                this.sendMessage(peer.ws, { type: 'REQUEST_CHAIN' });
            }
        });
    }
}

module.exports = BlockchainNetwork;



