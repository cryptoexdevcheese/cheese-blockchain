/**
 * CHEESE Blockchain - P2P Network API Routes
 * Express routes for P2P network management and monitoring
 * 
 * Usage: 
 *   const p2pRoutes = require('./p2p-server-routes');
 *   app.use('/api/p2p', p2pRoutes(p2pIntegration));
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const express = require('express');

function createP2PRoutes(p2pGetter) {
    const router = express.Router();
    
    // Helper to get p2p instance safely
    const getP2P = () => {
        return typeof p2pGetter === 'function' ? p2pGetter() : p2pGetter;
    };

    // ==================== P2P STATUS ====================

    /**
     * GET /api/p2p/status
     * Get P2P network status
     */
    router.get('/status', (req, res) => {
        try {
            const status = getP2P().getStatus();
            res.json({
                success: true,
                p2p: status
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /api/p2p/peers
     * Get list of connected peers
     */
    router.get('/peers', (req, res) => {
        try {
            const peers = getP2P().getPeers();
            res.json({
                success: true,
                count: peers.length,
                peers: peers.map(p => ({
                    id: p.id ? p.id.slice(0, 16) + '...' : 'unknown',
                    address: p.address,
                    protocol: p.protocol,
                    latency: p.latency,
                    reputation: p.reputation,
                    connectedAt: p.connectedAt
                }))
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ==================== P2P ACTIONS ====================

    /**
     * POST /api/p2p/connect
     * Connect to a specific peer
     */
    router.post('/connect', async (req, res) => {
        try {
            const { address, port } = req.body;

            if (!address || !port) {
                return res.status(400).json({
                    success: false,
                    error: 'Address and port required'
                });
            }

            const result = await getP2P().connectToPeer(address, port);

            if (result) {
                res.json({
                    success: true,
                    message: 'Connected to peer',
                    peer: {
                        id: result.id,
                        address: address,
                        port: port
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Failed to connect to peer'
                });
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/p2p/broadcast/block
     * Broadcast a block to the network (admin only)
     */
    router.post('/broadcast/block', (req, res) => {
        try {
            const { block } = req.body;

            if (!block) {
                return res.status(400).json({
                    success: false,
                    error: 'Block data required'
                });
            }

            getP2P().broadcastBlock(block);

            res.json({
                success: true,
                message: 'Block broadcast initiated'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /api/p2p/broadcast/transaction
     * Broadcast a transaction to the network
     */
    router.post('/broadcast/transaction', (req, res) => {
        try {
            const { transaction } = req.body;

            if (!transaction) {
                return res.status(400).json({
                    success: false,
                    error: 'Transaction data required'
                });
            }

            getP2P().broadcastTransaction(transaction);

            res.json({
                success: true,
                message: 'Transaction broadcast initiated'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // ==================== NETWORK STATS ====================

    /**
     * GET /api/p2p/stats
     * Get detailed network statistics
     */
    router.get('/stats', (req, res) => {
        try {
            const status = getP2P().getStatus();

            res.json({
                success: true,
                stats: {
                    running: status.running,
                    nodeId: status.nodeId,
                    networkId: status.networkId,
                    peerCount: status.peerCount,
                    messagesReceived: status.stats?.messagesReceived || 0,
                    messagesSent: status.stats?.messagesSent || 0,
                    blocksReceived: status.stats?.blocksReceived || 0,
                    transactionsReceived: status.stats?.transactionsReceived || 0,
                    uptime: status.stats?.startTime
                        ? Math.floor((Date.now() - status.stats.startTime) / 1000)
                        : 0,
                    webrtc: status.webrtc
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /api/p2p/discovery
     * Trigger peer discovery
     */
    router.get('/discovery', async (req, res) => {
        try {
            const p2p = getP2P();
            if (p2p && p2p.network && p2p.network.discoverPeers) {
                await p2p.network.discoverPeers();
                res.json({
                    success: true,
                    message: 'Peer discovery initiated'
                });
            } else {
                res.status(503).json({
                    success: false,
                    error: 'P2P network not running'
                });
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createP2PRoutes;
