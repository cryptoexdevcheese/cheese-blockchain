/**
 * CHEESE Blockchain - Advanced P2P Network
 * Enterprise-grade peer-to-peer networking with:
 * - Multi-protocol transport (TCP, WebSocket, WebRTC)
 * - Kademlia DHT discovery
 * - Gossipsub message propagation
 * - Peer authentication
 * - Rate limiting
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

const NetworkManager = require('./network-manager');
const MultiTransport = require('./transport/multi-transport');
const WebRTCTransport = require('./transport/webrtc-transport');
const SignalingServer = require('./transport/signaling-server');
const DHTDiscovery = require('./discovery/dht-discovery');
const BootstrapDiscovery = require('./discovery/bootstrap-discovery');
const GossipSub = require('./protocols/gossipsub');
const RequestResponse = require('./protocols/request-response');
const PeerAuth = require('./security/peer-auth');
const RateLimiter = require('./security/rate-limiter');
const P2PIntegration = require('./p2p-integration');

module.exports = {
    NetworkManager,
    MultiTransport,
    WebRTCTransport,
    SignalingServer,
    DHTDiscovery,
    BootstrapDiscovery,
    GossipSub,
    RequestResponse,
    PeerAuth,
    RateLimiter,
    P2PIntegration
};
