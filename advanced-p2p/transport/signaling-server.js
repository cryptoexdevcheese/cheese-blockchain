/**
 * CHEESE Blockchain - WebRTC Signaling Server
 * Helps WebRTC peers discover and connect to each other
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class SignalingServer extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            port: config.port || 30305,
            ...config
        };

        // Connected peers
        this.peers = new Map(); // peerId -> { ws, connectedAt }

        this.server = null;

        console.log('📡 Signaling Server initialized');
    }

    /**
     * Start signaling server
     */
    start() {
        return new Promise((resolve, reject) => {
            this.server = new WebSocket.Server({ port: this.config.port });

            this.server.on('connection', (ws) => {
                this.handleConnection(ws);
            });

            this.server.on('listening', () => {
                console.log(`   Signaling server listening on port ${this.config.port}`);
                resolve();
            });

            this.server.on('error', (error) => {
                console.error('Signaling server error:', error);
                reject(error);
            });
        });
    }

    /**
     * Stop signaling server
     */
    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.peers.clear();
    }

    /**
     * Handle new connection
     */
    handleConnection(ws) {
        let peerId = null;

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());

                switch (message.type) {
                    case 'announce':
                        peerId = message.peerId;
                        this.peers.set(peerId, {
                            ws,
                            connectedAt: Date.now()
                        });

                        console.log(`   Peer announced: ${peerId.slice(0, 16)}...`);

                        // Send peer list
                        this.sendPeerList(ws, peerId);

                        // Notify other peers
                        this.broadcast({
                            type: 'peer-joined',
                            peerId: peerId
                        }, peerId);
                        break;

                    case 'offer':
                    case 'answer':
                    case 'ice-candidate':
                        this.relayMessage(message);
                        break;
                }
            } catch (e) {
                console.error('Invalid signaling message:', e.message);
            }
        });

        ws.on('close', () => {
            if (peerId) {
                console.log(`   Peer disconnected: ${peerId.slice(0, 16)}...`);
                this.peers.delete(peerId);

                // Notify other peers
                this.broadcast({
                    type: 'peer-left',
                    peerId: peerId
                }, peerId);
            }
        });

        ws.on('error', (error) => {
            console.error('Signaling connection error:', error.message);
        });
    }

    /**
     * Send peer list to new peer
     */
    sendPeerList(ws, excludePeerId) {
        const peerList = [];
        for (const [id, peer] of this.peers) {
            if (id !== excludePeerId) {
                peerList.push({ id });
            }
        }

        ws.send(JSON.stringify({
            type: 'peer-list',
            peers: peerList
        }));
    }

    /**
     * Relay message to target peer
     */
    relayMessage(message) {
        const targetPeer = this.peers.get(message.to);
        if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
            targetPeer.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Broadcast message to all peers
     */
    broadcast(message, excludePeerId = null) {
        for (const [peerId, peer] of this.peers) {
            if (peerId !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
                peer.ws.send(JSON.stringify(message));
            }
        }
    }

    /**
     * Get connected peer count
     */
    getPeerCount() {
        return this.peers.size;
    }
}

module.exports = SignalingServer;
