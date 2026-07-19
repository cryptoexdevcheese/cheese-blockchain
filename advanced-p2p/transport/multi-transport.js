/**
 * CHEESE Blockchain - Multi-Protocol Transport Layer
 * Supports TCP, WebSocket, and WebRTC connections
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const net = require('net');
const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');

class MultiTransport extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            tcpPort: config.listenPort || 30303,
            wsPort: config.wsPort || 30304,
            host: config.host || '0.0.0.0',
            maxConnections: config.maxPeers || 50,
            connectionTimeout: config.connectionTimeout || 10000,
            ...config
        };

        // Servers
        this.tcpServer = null;
        this.wsServer = null;

        // Connections by peer ID
        this.connections = new Map();

        // Protocol handlers
        this.protocols = {
            tcp: this.createTCPConnection.bind(this),
            ws: this.createWSConnection.bind(this),
            websocket: this.createWSConnection.bind(this)
        };

        console.log('🚀 Multi-Transport Layer initialized');
    }

    /**
     * Start all transport servers
     */
    async start() {
        await this.startTCPServer();
        await this.startWSServer();
        console.log(`✅ Transport listening on TCP:${this.config.tcpPort} WS:${this.config.wsPort}`);
    }

    /**
     * Stop all transport servers
     */
    async stop() {
        // Close all connections
        this.connections.forEach((conn, peerId) => {
            this.disconnect(peerId);
        });

        // Close servers
        if (this.tcpServer) {
            this.tcpServer.close();
            this.tcpServer = null;
        }

        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }

        console.log('Transport servers stopped');
    }

    /**
     * Start TCP server
     */
    startTCPServer() {
        return new Promise((resolve, reject) => {
            this.tcpServer = net.createServer((socket) => {
                this.handleTCPConnection(socket);
            });

            this.tcpServer.on('error', (error) => {
                console.error('TCP Server error:', error);
                reject(error);
            });

            this.tcpServer.listen(this.config.tcpPort, this.config.host, () => {
                console.log(`   TCP server listening on ${this.config.host}:${this.config.tcpPort}`);
                resolve();
            });
        });
    }

    /**
     * Start WebSocket server
     */
    startWSServer() {
        return new Promise((resolve, reject) => {
            try {
                this.wsServer = new WebSocket.Server({
                    port: this.config.wsPort,
                    host: this.config.host
                });

                this.wsServer.on('connection', (ws, req) => {
                    this.handleWSConnection(ws, req);
                });

                this.wsServer.on('error', (error) => {
                    console.error('WebSocket Server error:', error);
                    reject(error);
                });

                this.wsServer.on('listening', () => {
                    console.log(`   WebSocket server listening on ${this.config.host}:${this.config.wsPort}`);
                    resolve();
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handle incoming TCP connection
     */
    handleTCPConnection(socket) {
        const peerId = this.generatePeerId();
        const address = socket.remoteAddress;
        const port = socket.remotePort;

        console.log(`📥 Incoming TCP connection from ${address}:${port}`);

        // Buffer for handling fragmented messages
        let buffer = '';

        const conn = {
            id: peerId,
            socket: socket,
            protocol: 'tcp',
            address: address,
            port: port,
            isIncoming: true,
            connectedAt: Date.now()
        };

        this.connections.set(peerId, conn);

        socket.on('data', (data) => {
            buffer += data.toString();

            // Process complete messages (newline-delimited JSON)
            const messages = buffer.split('\n');
            buffer = messages.pop(); // Keep incomplete message in buffer

            messages.forEach(msg => {
                if (msg.trim()) {
                    try {
                        const parsed = JSON.parse(msg);
                        this.emit('message', peerId, parsed);
                    } catch (e) {
                        console.error('Invalid TCP message:', e.message);
                    }
                }
            });
        });

        socket.on('close', () => {
            this.handleDisconnect(peerId);
        });

        socket.on('error', (error) => {
            console.error(`TCP socket error (${peerId}):`, error.message);
            this.handleDisconnect(peerId);
        });

        // Emit peer connect event
        this.emit('peer:connect', {
            id: peerId,
            address: address,
            port: port,
            protocol: 'tcp'
        });
    }

    /**
     * Handle incoming WebSocket connection
     */
    handleWSConnection(ws, req) {
        const peerId = this.generatePeerId();
        const address = req.socket.remoteAddress;
        const port = req.socket.remotePort;

        console.log(`📥 Incoming WebSocket connection from ${address}:${port}`);

        const conn = {
            id: peerId,
            socket: ws,
            protocol: 'websocket',
            address: address,
            port: port,
            isIncoming: true,
            connectedAt: Date.now()
        };

        this.connections.set(peerId, conn);

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.emit('message', peerId, message);
            } catch (e) {
                console.error('Invalid WebSocket message:', e.message);
            }
        });

        ws.on('close', () => {
            this.handleDisconnect(peerId);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error (${peerId}):`, error.message);
            this.handleDisconnect(peerId);
        });

        // Emit peer connect event
        this.emit('peer:connect', {
            id: peerId,
            address: address,
            port: port,
            protocol: 'websocket'
        });
    }

    /**
     * Connect to a peer
     */
    async connect(address, port, protocol = 'tcp') {
        const handler = this.protocols[protocol.toLowerCase()];
        if (!handler) {
            throw new Error(`Unsupported protocol: ${protocol}`);
        }

        return await handler(address, port);
    }

    /**
     * Create TCP connection to peer
     */
    createTCPConnection(address, port) {
        return new Promise((resolve, reject) => {
            const peerId = this.generatePeerId();
            const socket = new net.Socket();

            const timeout = setTimeout(() => {
                socket.destroy();
                reject(new Error('Connection timeout'));
            }, this.config.connectionTimeout);

            socket.connect(port, address, () => {
                clearTimeout(timeout);

                console.log(`📤 Connected to peer via TCP: ${address}:${port}`);

                let buffer = '';

                const conn = {
                    id: peerId,
                    socket: socket,
                    protocol: 'tcp',
                    address: address,
                    port: port,
                    isIncoming: false,
                    connectedAt: Date.now()
                };

                this.connections.set(peerId, conn);

                socket.on('data', (data) => {
                    buffer += data.toString();
                    const messages = buffer.split('\n');
                    buffer = messages.pop();

                    messages.forEach(msg => {
                        if (msg.trim()) {
                            try {
                                const parsed = JSON.parse(msg);
                                this.emit('message', peerId, parsed);
                            } catch (e) {
                                console.error('Invalid TCP message:', e.message);
                            }
                        }
                    });
                });

                socket.on('close', () => {
                    this.handleDisconnect(peerId);
                });

                socket.on('error', (error) => {
                    console.error(`TCP error (${peerId}):`, error.message);
                    this.handleDisconnect(peerId);
                });

                this.emit('peer:connect', {
                    id: peerId,
                    address: address,
                    port: port,
                    protocol: 'tcp'
                });

                resolve({
                    id: peerId,
                    address: address,
                    port: port,
                    protocol: 'tcp'
                });
            });

            socket.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    /**
     * Create WebSocket connection to peer
     */
    createWSConnection(address, port) {
        return new Promise((resolve, reject) => {
            const peerId = this.generatePeerId();
            const url = `ws://${address}:${port}`;

            const ws = new WebSocket(url, {
                handshakeTimeout: this.config.connectionTimeout
            });

            const timeout = setTimeout(() => {
                ws.terminate();
                reject(new Error('Connection timeout'));
            }, this.config.connectionTimeout);

            ws.on('open', () => {
                clearTimeout(timeout);

                console.log(`📤 Connected to peer via WebSocket: ${address}:${port}`);

                const conn = {
                    id: peerId,
                    socket: ws,
                    protocol: 'websocket',
                    address: address,
                    port: port,
                    isIncoming: false,
                    connectedAt: Date.now()
                };

                this.connections.set(peerId, conn);

                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.emit('message', peerId, message);
                    } catch (e) {
                        console.error('Invalid WebSocket message:', e.message);
                    }
                });

                ws.on('close', () => {
                    this.handleDisconnect(peerId);
                });

                ws.on('error', (error) => {
                    console.error(`WebSocket error (${peerId}):`, error.message);
                    this.handleDisconnect(peerId);
                });

                this.emit('peer:connect', {
                    id: peerId,
                    address: address,
                    port: port,
                    protocol: 'websocket'
                });

                resolve({
                    id: peerId,
                    address: address,
                    port: port,
                    protocol: 'websocket'
                });
            });

            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    /**
     * Send message to peer
     */
    send(peerId, message) {
        const conn = this.connections.get(peerId);
        if (!conn) {
            console.warn(`Cannot send to unknown peer: ${peerId}`);
            return false;
        }

        const data = typeof message === 'string' ? message : JSON.stringify(message);

        try {
            if (conn.protocol === 'tcp') {
                conn.socket.write(data + '\n');
            } else if (conn.protocol === 'websocket') {
                if (conn.socket.readyState === WebSocket.OPEN) {
                    conn.socket.send(data);
                } else {
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error(`Send error to ${peerId}:`, error.message);
            return false;
        }
    }

    /**
     * Disconnect from peer
     */
    disconnect(peerId) {
        const conn = this.connections.get(peerId);
        if (!conn) return;

        try {
            if (conn.protocol === 'tcp') {
                conn.socket.destroy();
            } else if (conn.protocol === 'websocket') {
                conn.socket.terminate();
            }
        } catch (error) {
            console.error(`Disconnect error for ${peerId}:`, error.message);
        }

        this.connections.delete(peerId);
    }

    /**
     * Handle disconnection
     */
    handleDisconnect(peerId) {
        if (!this.connections.has(peerId)) return;

        this.connections.delete(peerId);
        this.emit('peer:disconnect', peerId);
    }

    /**
     * Generate unique peer ID
     */
    generatePeerId() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Get connection info
     */
    getConnection(peerId) {
        return this.connections.get(peerId);
    }

    /**
     * Get all connections
     */
    getConnections() {
        return Array.from(this.connections.values());
    }

    /**
     * Get connection count
     */
    getConnectionCount() {
        return this.connections.size;
    }
}

module.exports = MultiTransport;
