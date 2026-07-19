/**
 * CHEESE Blockchain - WebRTC Transport
 * Enables browser-to-browser peer connections without a central server
 * Uses signaling server for initial connection, then direct P2P
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class WebRTCTransport extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            signalingServer: config.signalingServer,
            iceServers: config.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            maxConnections: config.maxConnections || 10,
            dataChannelOptions: {
                ordered: false, // For faster block propagation
                maxRetransmits: 3
            },
            ...config
        };

        // Peer connections
        this.connections = new Map(); // peerId -> { pc, dataChannel, state }

        // Pending offers/answers
        this.pendingConnections = new Map();

        // Signaling connection
        this.signalingWs = null;

        // Local peer ID
        this.localPeerId = this.generatePeerId();

        console.log('📡 WebRTC Transport initialized');
        console.log(`   Local Peer ID: ${this.localPeerId.slice(0, 16)}...`);
    }

    /**
     * Start WebRTC transport
     */
    async start() {
        if (this.config.signalingServer) {
            await this.connectToSignalingServer();
        }
        console.log('   WebRTC transport ready');
    }

    /**
     * Stop WebRTC transport
     */
    async stop() {
        // Close all peer connections
        for (const [peerId, conn] of this.connections) {
            this.closeConnection(peerId);
        }

        // Close signaling server connection
        if (this.signalingWs) {
            this.signalingWs.close();
            this.signalingWs = null;
        }
    }

    /**
     * Connect to signaling server for peer discovery
     */
    async connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            try {
                const WebSocket = require('ws');
                this.signalingWs = new WebSocket(this.config.signalingServer);

                this.signalingWs.on('open', () => {
                    console.log('   Connected to signaling server');

                    // Announce ourselves
                    this.sendSignaling({
                        type: 'announce',
                        peerId: this.localPeerId
                    });

                    resolve();
                });

                this.signalingWs.on('message', (data) => {
                    const message = JSON.parse(data.toString());
                    this.handleSignalingMessage(message);
                });

                this.signalingWs.on('close', () => {
                    console.log('   Signaling server disconnected');
                    // Attempt reconnect
                    setTimeout(() => this.connectToSignalingServer(), 5000);
                });

                this.signalingWs.on('error', (error) => {
                    console.error('Signaling error:', error.message);
                    reject(error);
                });

            } catch (error) {
                // WebSocket not available (browser environment might use native WebSocket)
                console.warn('   Signaling server not configured or unavailable');
                resolve();
            }
        });
    }

    /**
     * Handle signaling message
     */
    handleSignalingMessage(message) {
        switch (message.type) {
            case 'peer-list':
                this.handlePeerList(message.peers);
                break;

            case 'offer':
                this.handleOffer(message.from, message.offer);
                break;

            case 'answer':
                this.handleAnswer(message.from, message.answer);
                break;

            case 'ice-candidate':
                this.handleIceCandidate(message.from, message.candidate);
                break;

            case 'peer-joined':
                console.log(`   New peer available: ${message.peerId.slice(0, 16)}...`);
                this.emit('peer:discovered', message.peerId);
                break;

            case 'peer-left':
                console.log(`   Peer left: ${message.peerId.slice(0, 16)}...`);
                break;
        }
    }

    /**
     * Send signaling message
     */
    sendSignaling(message) {
        if (this.signalingWs && this.signalingWs.readyState === 1) {
            this.signalingWs.send(JSON.stringify(message));
        }
    }

    /**
     * Handle peer list from signaling server
     */
    handlePeerList(peers) {
        console.log(`   Discovered ${peers.length} peers via signaling`);
        for (const peer of peers) {
            if (peer.id !== this.localPeerId) {
                this.emit('peer:discovered', peer.id);
            }
        }
    }

    /**
     * Connect to a peer
     */
    async connect(peerId) {
        if (this.connections.has(peerId)) {
            return this.connections.get(peerId);
        }

        console.log(`   Initiating WebRTC connection to ${peerId.slice(0, 16)}...`);

        // Create RTCPeerConnection (node-webrtc or browser WebRTC)
        const pc = this.createPeerConnection(peerId);

        // Create data channel
        const dataChannel = pc.createDataChannel('cheese-p2p', this.config.dataChannelOptions);
        this.setupDataChannel(peerId, dataChannel);

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Store pending connection
        this.pendingConnections.set(peerId, { pc, dataChannel });

        // Send offer via signaling
        this.sendSignaling({
            type: 'offer',
            to: peerId,
            from: this.localPeerId,
            offer: pc.localDescription
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingConnections.delete(peerId);
                reject(new Error('WebRTC connection timeout'));
            }, 30000);

            dataChannel.onopen = () => {
                clearTimeout(timeout);

                this.connections.set(peerId, {
                    pc,
                    dataChannel,
                    state: 'connected',
                    connectedAt: Date.now()
                });

                this.pendingConnections.delete(peerId);

                this.emit('peer:connect', {
                    id: peerId,
                    protocol: 'webrtc'
                });

                resolve({
                    id: peerId,
                    protocol: 'webrtc'
                });
            };
        });
    }

    /**
     * Handle incoming offer
     */
    async handleOffer(fromPeerId, offer) {
        console.log(`   Received offer from ${fromPeerId.slice(0, 16)}...`);

        const pc = this.createPeerConnection(fromPeerId);

        // Set remote description
        await pc.setRemoteDescription(offer);

        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Store connection
        this.pendingConnections.set(fromPeerId, { pc });

        // Send answer
        this.sendSignaling({
            type: 'answer',
            to: fromPeerId,
            from: this.localPeerId,
            answer: pc.localDescription
        });

        // Handle data channel
        pc.ondatachannel = (event) => {
            this.setupDataChannel(fromPeerId, event.channel);

            event.channel.onopen = () => {
                this.connections.set(fromPeerId, {
                    pc,
                    dataChannel: event.channel,
                    state: 'connected',
                    connectedAt: Date.now()
                });

                this.pendingConnections.delete(fromPeerId);

                this.emit('peer:connect', {
                    id: fromPeerId,
                    protocol: 'webrtc'
                });
            };
        };
    }

    /**
     * Handle answer
     */
    async handleAnswer(fromPeerId, answer) {
        console.log(`   Received answer from ${fromPeerId.slice(0, 16)}...`);

        const pending = this.pendingConnections.get(fromPeerId);
        if (pending && pending.pc) {
            await pending.pc.setRemoteDescription(answer);
        }
    }

    /**
     * Handle ICE candidate
     */
    async handleIceCandidate(fromPeerId, candidate) {
        const pending = this.pendingConnections.get(fromPeerId);
        const conn = this.connections.get(fromPeerId);
        const pc = (pending && pending.pc) || (conn && conn.pc);

        if (pc && candidate) {
            await pc.addIceCandidate(candidate);
        }
    }

    /**
     * Create RTCPeerConnection
     */
    createPeerConnection(peerId) {
        // Use wrtc for Node.js, or native for browser
        let RTCPeerConnection;
        try {
            const wrtc = require('wrtc');
            RTCPeerConnection = wrtc.RTCPeerConnection;
        } catch (e) {
            // Browser environment
            RTCPeerConnection = global.RTCPeerConnection || global.webkitRTCPeerConnection;
        }

        if (!RTCPeerConnection) {
            throw new Error('WebRTC not available');
        }

        const pc = new RTCPeerConnection({
            iceServers: this.config.iceServers
        });

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignaling({
                    type: 'ice-candidate',
                    to: peerId,
                    from: this.localPeerId,
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(peerId);
            }
        };

        return pc;
    }

    /**
     * Setup data channel event handlers
     */
    setupDataChannel(peerId, dataChannel) {
        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.emit('message', peerId, message);
            } catch (e) {
                console.error('Invalid WebRTC message:', e.message);
            }
        };

        dataChannel.onerror = (error) => {
            console.error(`WebRTC data channel error (${peerId}):`, error);
        };

        dataChannel.onclose = () => {
            this.closeConnection(peerId);
        };
    }

    /**
     * Send message to peer
     */
    send(peerId, message) {
        const conn = this.connections.get(peerId);
        if (!conn || !conn.dataChannel) {
            return false;
        }

        if (conn.dataChannel.readyState !== 'open') {
            return false;
        }

        try {
            const data = typeof message === 'string' ? message : JSON.stringify(message);
            conn.dataChannel.send(data);
            return true;
        } catch (error) {
            console.error(`WebRTC send error to ${peerId}:`, error.message);
            return false;
        }
    }

    /**
     * Close connection to peer
     */
    closeConnection(peerId) {
        const conn = this.connections.get(peerId);
        if (conn) {
            if (conn.dataChannel) {
                conn.dataChannel.close();
            }
            if (conn.pc) {
                conn.pc.close();
            }
            this.connections.delete(peerId);
            this.emit('peer:disconnect', peerId);
        }

        this.pendingConnections.delete(peerId);
    }

    /**
     * Generate peer ID
     */
    generatePeerId() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Get connection count
     */
    getConnectionCount() {
        return this.connections.size;
    }

    /**
     * Get all connections
     */
    getConnections() {
        return Array.from(this.connections.entries()).map(([peerId, conn]) => ({
            peerId,
            state: conn.state,
            connectedAt: conn.connectedAt
        }));
    }
}

module.exports = WebRTCTransport;
