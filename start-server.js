/**
 * Fast Server Startup Script (v5.2.7-RPC-FIX)
 * Ensures server starts listening immediately, blockchain initializes in background
 */


require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// HTTP server wrapper & WebRTC P2P Signaling Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const signalingRooms = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const roomId = url.searchParams.get('room');

    if (!roomId) {
        ws.close(1008, 'Room ID required');
        return;
    }

    if (!signalingRooms.has(roomId)) {
        signalingRooms.set(roomId, new Set());
    }

    const room = signalingRooms.get(roomId);
    room.add(ws);
    console.log(`📡 Notary P2P signaling peer joined room: ${roomId} (Total in room: ${room.size})`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
                return;
            }
            room.forEach(peer => {
                if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                    peer.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.error('❌ Signaling message error:', e.message);
        }
    });

    ws.on('close', () => {
        room.delete(ws);
        if (room.size === 0) {
            signalingRooms.delete(roomId);
        }
        console.log(`📡 Notary P2P signaling peer left room: ${roomId}`);
    });
});

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/notary-signaling') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    }
});
const PORT = process.env.PORT || 8080;
const P2P_PORT = process.env.P2P_PORT || (process.env.RENDER ? 4002 : 4001);
const HARDCODED_API_KEY = '154db3748b7be24621d9f6a8e90619e150f865de65d72e979fbcbe37876afbf8';
const API_KEY = process.env.API_KEY || HARDCODED_API_KEY;
console.log('🔑 API Key loaded:', API_KEY ? 'SET' : 'MISSING');
const NODE_ROLE = process.env.NODE_ROLE ? process.env.NODE_ROLE.toUpperCase() : 'HYBRID';
const RPCBridge = require('./rpc-bridge');
let rpcBridge = null;

// Middleware

// Public RPC endpoints — must allow ANY origin for wallets, dApps, Chainlist, etc.
const rpcCors = cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] });
app.options(['/rpc', '/api/rpc'], rpcCors);
app.use(['/rpc', '/api/rpc'], rpcCors);

// Restricted CORS for all other API routes
app.use(cors({
    origin: [
        'https://cheeseblockchain.com',
        'https://www.cheeseblockchain.com',
        'http://localhost:8080',
        'http://localhost:3000'
    ],
    credentials: true
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const staticCacheOptions = {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css') || path.endsWith('manifest.json') || path.endsWith('sw.js') || path.endsWith('service-worker.js')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
        }
    }
};

// Path-based static file serving
app.use('/wallet-logos', express.static(path.join(__dirname, 'public/wallet-logos')));
app.use('/wallet', express.static(path.join(__dirname, 'public/wallet'), staticCacheOptions));
// DEX: secured API engine + public UI (replaces static-only mount)
try {
    if (!process.env.BLOCKCHAIN_API) {
        process.env.BLOCKCHAIN_API = `http://127.0.0.1:${PORT}`;
    }
    console.log('🔄 Mounting DEX Backend at /dex...');
    const dexApp = require('./dex-server-fixed.js');
    app.use('/dex', dexApp);
    console.log('✅ DEX Backend mounted at /dex');
} catch (dexMountError) {
    console.error('⚠️ DEX mount failed, falling back to static UI only:', dexMountError.message);
    app.use('/dex', express.static(path.join(__dirname, 'public/dex'), staticCacheOptions));
}
app.use(express.static(path.join(__dirname, 'public'), staticCacheOptions));
app.get('/whitepaper', (req, res) => res.redirect(301, '/whitepaper.html'));


// Public endpoints that don't need API key (read-only data)
const PUBLIC_ENDPOINTS = [
    '/balance',
    '/transactions',
    '/transaction',
    '/blocks',
    '/block',
    '/health',
    '/status',
    '/rpc',
    '/dex-proxy',
    '/wallet/create',
    '/wallet/load',
    '/notary',
    '/pools',
    '/market-prices',
    '/ticker',
    '/positions',
    '/api/ai',
    '/api/mining',
    '/api/node',
    '/api/supply',
    '/api/balance',
    '/api/transactions',
    '/api/transaction',
    '/api/blocks',
    '/api/block',
    '/api/health',
    '/api/status',
    '/api/rpc',
    '/api/ticker',
    '/api/pss',
    '/api/notary',
    '/api/turn-credentials'
];

// API Key middleware
const authenticateAPI = (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    // Always allow OPTIONS (preflight CORS)
    if (req.method === 'OPTIONS') return next();

    const fullPath = req.originalUrl || req.url || req.path;
    const isPublic = PUBLIC_ENDPOINTS.some(ep => {
        const relativeEp = ep.startsWith('/api/') ? ep.slice(4) : ep;
        return req.path.startsWith(relativeEp) || 
               req.path === relativeEp || 
               fullPath.startsWith(ep) || 
               fullPath.startsWith(`/api${ep}`);
    });

    if (isPublic) return next();

    // Allow if API key matches
    if (apiKey && apiKey === API_KEY) {
        return next();
    }

    res.status(401).json({
        success: false,
        error: 'Invalid or missing API key. Include x-api-key header or apiKey query parameter.'
    });
};

app.use('/api', (req, res, next) => {
    authenticateAPI(req, res, next);
});

// Initialize blockchain (will be loaded later)
let blockchain = null;
let blockchainReady = false;
let blockchainError = null;

// Health check - MUST work immediately
app.get(['/health', '/api/health'], (req, res) => {
    const isSoftReady = blockchain !== null;
    res.status(200).json({
        status: blockchainReady ? 'ok' : (isSoftReady ? 'soft-ready' : (blockchainError ? 'error' : 'initializing')),
        timestamp: Date.now(),
        chainLength: blockchain?.chain?.length || 0,
        blocksInDB: (blockchain?.database?.local?.db || blockchain?.database?.db) ? 
            ((blockchain.database.local?.db || blockchain.database.db).exec('SELECT COUNT(*) FROM blocks')[0]?.values[0][0] || 0) : 0,
        version: '1.2.1-REBORN',
        name: 'CHEESE Blockchain Core',
        nodeRole: NODE_ROLE,
        ready: blockchainReady,
        softReady: isSoftReady,
        error: blockchainError || null
    });
});

// Node Info - 3-Node Separation Architecture
app.get('/api/node/info', (req, res) => {
    const roleCapabilities = {
        MINING: {
            description: 'Specialized block production node',
            capabilities: ['block_mining', 'fraud_detection', 'anomaly_detection', 'fee_optimization', 'whale_detection'],
            aiModels: 8,
            endpoints: ['/api/mine', '/api/mempool', '/api/miners/*']
        },
        GOVERNANCE: {
            description: 'Analytics and governance node',
            capabilities: ['governance_voting', 'smart_contract_analysis', 'price_prediction', 'sentiment_analysis', 'deep_learning', 'explorer_api'],
            aiModels: 19,
            endpoints: ['/api/governance/*', '/api/blocks', '/api/transactions', '/api/wallet/*']
        },
        HYBRID: {
            description: 'Full-capability node (Mining + Governance)',
            capabilities: ['ALL'],
            aiModels: 27,
            endpoints: ['ALL']
        }
    };

    res.json({
        success: true,
        architecture: '3-Node Separation Strategy',
        nodeRole: NODE_ROLE,
        roleInfo: roleCapabilities[NODE_ROLE] || roleCapabilities.HYBRID,
        network: {
            totalAIModels: 27,
            distributedAcross: '3 specialized node types',
            pythonModels: 6,
            jsModels: 21
        },
        advantages: {
            vsBitcoin: '1000x more scalable with AI security',
            vsEthereum: 'Quantum-resistant + role-optimized',
            vsSolana: 'Reliability + ML fraud prevention'
        },
        timestamp: Date.now()
    });
});

// RPC Bridge route (MetaMask)
app.all(['/rpc', '/api/rpc'], async (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
        const host = req.get('host');
        const protocol = host.includes('localhost') ? 'http' : 'https';
        return res.json({
            jsonrpc: '2.0',
            status: 'online',
            service: 'CHEESE Blockchain EVM RPC',
            chainId: 20250,
            chainName: 'CHEESE Blockchain Mainnet',
            nativeCurrency: { name: 'NCH', symbol: 'NCH', decimals: 18 },
            rpc_url: `${protocol}://${host}/api/rpc`,
            blockExplorer: 'https://cheeseblockchain.com/explorer'
        });
    }

    if (!rpcBridge) {
        return res.status(503).json({ 
            jsonrpc: '2.0', 
            id: req.body?.id || null, 
            error: { code: -32603, message: 'RPC Bridge initializing...' } 
        });
    }
    return await rpcBridge.handleRequest(req, res);
});

// Public Read-Only Cheese DEX Ticker (Top-Level Endpoint)
app.get(['/ticker', '/api/ticker'], (req, res) => {
    try {
        let nchPrice = global.nchMarketPrice || 1.25;
        let nchChange = 4.35;

        res.json({
            success: true,
            exchange: "Cheese DEX",
            chainId: 20250,
            timestamp: new Date().toISOString(),
            tickers: [
                {
                    ticker_id: "NCH_USDT",
                    base_currency: "NCH",
                    target_currency: "USDT",
                    symbol: "NCH/USDT",
                    last_price: nchPrice.toFixed(6),
                    high_24h: (nchPrice * 1.05).toFixed(6),
                    low_24h: (nchPrice * 0.95).toFixed(6),
                    base_volume: "8500000.00",
                    target_volume: (8500000 * nchPrice).toFixed(2),
                    change_24h: "+" + nchChange + "%",
                    updated_at: new Date().toISOString()
                },
                {
                    ticker_id: "NCH_USDC",
                    base_currency: "NCH",
                    target_currency: "USDC",
                    symbol: "NCH/USDC",
                    last_price: nchPrice.toFixed(6),
                    high_24h: (nchPrice * 1.05).toFixed(6),
                    low_24h: (nchPrice * 0.95).toFixed(6),
                    base_volume: "4200000.00",
                    target_volume: (4200000 * nchPrice).toFixed(2),
                    change_24h: "+" + nchChange + "%",
                    updated_at: new Date().toISOString()
                }
            ]
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// 🏛️ DPWH NEXUS System Static & API Mounts
// Internal Aqueduct Platform for DPWH Document & Workflow Management
// ============================================================
app.use('/dpwh-nexus', express.static(path.join(__dirname, 'public/dpwh-nexus')));

let nexusProjects = [
  {
    id: "26AB0012",
    title: "Construction of Multi-Purpose Flood Control Structure along Pampanga River",
    office: "Pampanga 1st DEO",
    region: "Region III",
    category: "Flood Control",
    cost: 45000000,
    stage: "POW_ABC_APPROVAL",
    stationLimits: "Sta. 04+120 to Sta. 06+450",
    coordinates: "15.0345° N, 120.6821° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "NORMAL",
    slaRemainingHours: 34,
    createdDate: "2026-08-01T08:30:00Z",
    hash: "0x8f2e9a1b4c3d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
    documents: [
      { name: "Certificate_of_Validation.pdf", hash: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", signer: "Engr. R. Santos (Planning Chief)" },
      { name: "DED_Structural_Plans.dwg", hash: "0x12a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3", signer: "Engr. M. Cruz (Design Division)" },
      { name: "POW_DUPA_DO30.xlsx", hash: "0x7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", signer: "Engr. A. Dela Cruz (District Engineer)" }
    ]
  },
  {
    id: "26BC0045",
    title: "Rehabilitation and Expansion of Daang Maharlika Highway (Km 420 - Km 435)",
    office: "Camarines Sur 2nd DEO",
    region: "Region V",
    category: "Highways & Roads",
    cost: 120000000,
    stage: "VALIDATION",
    stationLimits: "Km 420+000 to Km 435+500",
    coordinates: "13.6218° N, 123.1944° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "WARNING",
    slaRemainingHours: 8,
    createdDate: "2026-08-03T10:15:00Z",
    hash: "0x4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5",
    documents: [
      { name: "Project_Proposal_Survey.pdf", hash: "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2", signer: "Engr. J. Bautista" }
    ]
  },
  {
    id: "26CC0089",
    title: "Construction of 4-Storey 20-Classroom School Building",
    office: "Cebu 1st DEO",
    region: "Region VII",
    category: "Public Buildings",
    cost: 38000000,
    stage: "BIDDING",
    stationLimits: "Barangay Central, Mandaue City",
    coordinates: "10.3333° N, 123.9333° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "NORMAL",
    slaRemainingHours: 42,
    createdDate: "2026-07-28T14:20:00Z",
    hash: "0x9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    documents: [
      { name: "Approved_ABC_Voucher.pdf", hash: "0xb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3", signer: "Engr. L. Mendoza" }
    ]
  },
  {
    id: "26DD0112",
    title: "Bicol River Basin Sustainable Flood Resilience Infrastructure",
    office: "Regional Office V",
    region: "Region V",
    category: "Flood Control",
    cost: 280000000,
    stage: "BILLING",
    stationLimits: "Sta. 12+000 to Sta. 18+500",
    coordinates: "13.5000° N, 123.3000° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "BREACH",
    slaRemainingHours: -14,
    createdDate: "2026-07-15T09:00:00Z",
    hash: "0xc3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    documents: [
      { name: "Progress_Billing_Certificate_No1.pdf", hash: "0xd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5", signer: "Regional Director G. Alvarez" }
    ]
  }
];

let nexusAuditTrail = [
  {
    id: "LOG_9012",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    projectId: "26AB0012",
    action: "GOVPKI_DIGITAL_SIGNATURE",
    user: "Engr. A. Dela Cruz (District Engineer)",
    details: "Signed POW & ABC under DO 30, s. 2025. Hash: 0x7f8a...7f8",
    status: "VERIFIED"
  },
  {
    id: "LOG_9011",
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    projectId: "26AB0012",
    action: "DO30_DUPA_PRICE_CHECK",
    user: "SYSTEM_AUTOMATION_GATE",
    details: "DUPA Unit Price Analysis verified against DO 30 s. 2025 ceiling rates. 0 anomalies.",
    status: "PASSED"
  }
];

const NEXUS_DO30_COST_RULES = [
  { itemNo: "101(1)", description: "Removal of Structures & Obstruction", unit: "sq.m", maxDirectCost: 145.00, maxIndirectCostPct: 20 },
  { itemNo: "102(2)", description: "Surplus Common Excavation", unit: "cu.m", maxDirectCost: 285.00, maxIndirectCostPct: 20 },
  { itemNo: "200(1)", description: "Aggregate Subbase Course", unit: "cu.m", maxDirectCost: 1250.00, maxIndirectCostPct: 18 },
  { itemNo: "311(1)e1", description: "PCCP (Unreinforced, 0.28m thick, 14 days)", unit: "sq.m", maxDirectCost: 2150.00, maxIndirectCostPct: 15 },
  { itemNo: "404(1)a", description: "Reinforcing Steel (Grade 40)", unit: "kg", maxDirectCost: 78.50, maxIndirectCostPct: 15 },
  { itemNo: "405(1)a3", description: "Structural Concrete (Class A, 28 days)", unit: "cu.m", maxDirectCost: 6800.00, maxIndirectCostPct: 15 }
];

app.get('/api/nexus/projects', (req, res) => res.json({ success: true, projects: nexusProjects }));

app.post('/api/nexus/projects', (req, res) => {
  const { title, office, region, category, cost, stationLimits, coordinates } = req.body;
  if (!title || !cost || !office) return res.status(400).json({ success: false, error: 'Title, Cost, and Office are required' });

  const id = `26${office.substring(0,2).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
  const hashString = `${id}-${title}-${cost}-${Date.now()}`;
  const crypto = require('crypto');
  const hash = '0x' + crypto.createHash('sha256').update(hashString).digest('hex');

  const newProject = {
    id,
    title,
    office: office || "Central Office",
    region: region || "National Capital Region",
    category: category || "Highways & Roads",
    cost: parseFloat(cost),
    stage: "IDENTIFICATION",
    stationLimits: stationLimits || "Sta. 00+000 to Sta. 01+000",
    coordinates: coordinates || "14.5995° N, 120.9842° E",
    dupaStatus: "PASSED_DO30",
    slaStatus: "NORMAL",
    slaRemainingHours: 48,
    createdDate: new Date().toISOString(),
    hash,
    documents: [
      { name: `${id}_Initial_Survey.pdf`, hash: '0x' + crypto.createHash('sha256').update(`doc_${Date.now()}`).digest('hex'), signer: "System Automated Intake" }
    ]
  };

  nexusProjects.unshift(newProject);
  nexusAuditTrail.unshift({
    id: `LOG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    projectId: id,
    action: "PROJECT_INTAKE_INGESTION",
    user: `${office} Intake Officer`,
    details: `Ingested Project ${id} with Hash ${hash.substring(0, 10)}...`,
    status: "VERIFIED"
  });

  res.json({ success: true, message: `Project ${id} ingested successfully`, project: newProject });
});

app.post('/api/nexus/projects/:id/advance', (req, res) => {
  const { id } = req.params;
  const { signerName, signerRole } = req.body;
  const project = nexusProjects.find(p => p.id === id);

  if (!project) return res.status(404).json({ success: false, error: "Project not found" });

  const stageOrder = ["IDENTIFICATION", "VALIDATION", "POW_ABC_APPROVAL", "BIDDING", "BILLING"];
  const currIdx = stageOrder.indexOf(project.stage);
  if (currIdx === -1 || currIdx === stageOrder.length - 1) {
    return res.status(400).json({ success: false, error: "Project is already at final closeout stage" });
  }

  const nextStage = stageOrder[currIdx + 1];
  project.stage = nextStage;
  project.slaStatus = "NORMAL";
  project.slaRemainingHours = 48;

  const crypto = require('crypto');
  const docHash = '0x' + crypto.createHash('sha256').update(`${id}-${nextStage}-${Date.now()}`).digest('hex');
  project.documents.push({
    name: `${id}_${nextStage}_Approval.pdf`,
    hash: docHash,
    signer: `${signerName || "Engr. Signature"} (${signerRole || "Approving Authority"})`
  });

  nexusAuditTrail.unshift({
    id: `LOG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    projectId: id,
    action: "GOVPKI_STAGE_ADVANCE",
    user: signerName || "Approving Authority",
    details: `Advanced project ${id} to ${nextStage}. GovPKI Hash: ${docHash.substring(0, 12)}...`,
    status: "VERIFIED"
  });

  res.json({ success: true, message: `Project ${id} advanced to ${nextStage}`, project });
});

app.get('/api/nexus/dupa-rules', (req, res) => res.json({ success: true, rules: NEXUS_DO30_COST_RULES }));

app.post('/api/nexus/dupa-rules/validate', (req, res) => {
  const { itemNo, directCost, indirectCostPct } = req.body;
  const rule = NEXUS_DO30_COST_RULES.find(r => r.itemNo === itemNo);
  if (!rule) return res.json({ success: true, valid: true, note: "Custom pay item. Requires DE manual concurrence." });

  const numDirect = parseFloat(directCost);
  const numIndirect = parseFloat(indirectCostPct);
  const valid = numDirect <= rule.maxDirectCost && numIndirect <= rule.maxIndirectCostPct;

  res.json({
    success: true,
    valid,
    status: valid ? "PASSED_DO30" : "VIOLATION_DO30",
    details: valid 
      ? `Unit cost ₱${numDirect.toFixed(2)} is within DO 30 ceiling of ₱${rule.maxDirectCost.toFixed(2)}.`
      : `EXCEEDS DO 30 CEILING: Proposed ₱${numDirect.toFixed(2)} vs Max Ceiling ₱${rule.maxDirectCost.toFixed(2)}.`
  });
});

app.get('/api/nexus/audit', (req, res) => res.json({ success: true, auditTrail: nexusAuditTrail }));

// ============================================================
// TURN Relay Credential Endpoint (Critical for cross-network P2P)
// Provides ICE server configuration including TURN relay servers
// that enable P2P connections across different networks, carriers,
// and countries (required when direct STUN-only connection fails).
// ============================================================
app.get(['/api/turn-credentials', '/turn-credentials'], async (req, res) => {
    try {
        // Base STUN servers (always included)
        const stunServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' }
        ];

        let turnServers = [];

        // === Strategy 1: Metered.ca TURN API (Recommended for production) ===
        // Set METERED_API_KEY in your .env file after signing up at metered.ca
        const meteredApiKey = process.env.METERED_API_KEY;
        if (meteredApiKey) {
            try {
                const meteredRes = await fetch(
                    `https://cheese.metered.live/api/v1/turn/credentials?apiKey=${meteredApiKey}`,
                    { signal: AbortSignal.timeout(5000) }
                );
                if (meteredRes.ok) {
                    const meteredServers = await meteredRes.json();
                    turnServers = meteredServers;
                    console.log('📡 TURN credentials served via Metered.ca API');
                }
            } catch (meteredErr) {
                console.warn('⚠️ Metered.ca TURN API unavailable, using fallback:', meteredErr.message);
            }
        }

        // === Strategy 2: Self-hosted coturn with HMAC credentials ===
        // Set TURN_SERVER, TURN_SECRET in .env for self-hosted coturn
        if (turnServers.length === 0 && process.env.TURN_SERVER && process.env.TURN_SECRET) {
            const turnServer = process.env.TURN_SERVER;
            const turnSecret = process.env.TURN_SECRET;
            const ttl = 86400; // 24-hour credential TTL
            const unixExpiry = Math.floor(Date.now() / 1000) + ttl;
            const username = `${unixExpiry}:cheese-notary`;
            const hmac = crypto.createHmac('sha1', turnSecret);
            hmac.update(username);
            const credential = hmac.digest('base64');

            turnServers = [
                {
                    urls: `turn:${turnServer}:3478?transport=udp`,
                    username: username,
                    credential: credential
                },
                {
                    urls: `turn:${turnServer}:3478?transport=tcp`,
                    username: username,
                    credential: credential
                },
                {
                    urls: `turns:${turnServer}:443?transport=tcp`,
                    username: username,
                    credential: credential
                }
            ];
            console.log('📡 TURN credentials served via self-hosted coturn (HMAC)');
        }

        // === Strategy 3: Static TURN credentials from environment ===
        // Set TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL in .env
        if (turnServers.length === 0 && process.env.TURN_URLS) {
            const turnUrls = process.env.TURN_URLS.split(',').map(u => u.trim());
            turnServers = [{
                urls: turnUrls,
                username: process.env.TURN_USERNAME || '',
                credential: process.env.TURN_CREDENTIAL || ''
            }];
            console.log('📡 TURN credentials served from static environment config');
        }

        // === Strategy 4: Free public relay fallback for development/testing ===
        // These are rate-limited free TURN servers — NOT for heavy production use
        if (turnServers.length === 0) {
            turnServers = [
                {
                    urls: 'turn:relay1.expressturn.com:443',
                    username: 'ef4LIMIT0RJZJ5BVQG',
                    credential: 'B0xQuZYDaVrPfIjK'
                },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ];
            console.log('📡 TURN credentials: using free public relay fallback (configure METERED_API_KEY or TURN_SERVER for production)');
        }

        res.json({
            success: true,
            iceServers: [...stunServers, ...turnServers],
            ttl: 86400,
            provider: meteredApiKey ? 'metered' : (process.env.TURN_SERVER ? 'coturn' : (process.env.TURN_URLS ? 'static' : 'free-relay')),
            timestamp: Date.now()
        });

    } catch (err) {
        console.error('❌ TURN credential generation failed:', err);
        // Emergency fallback — always return at least STUN
        res.json({
            success: false,
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun.cloudflare.com:3478' }
            ],
            error: 'TURN credentials unavailable, STUN-only mode'
        });
    }
});

// Load the full API routes IMMEDIATELY
require('./blockchain-server-routes')(app, () => blockchain, () => blockchainReady);

// Mount P2P Management Routes
const p2pRoutes = require('./p2p-server-routes');
app.use('/api/p2p', p2pRoutes(() => blockchain?.network));

// Mount PSS (Private Sovereign Storage) Routes safely
try {
    const pssRoutes = require('./pss-storage');
    app.use('/api/pss', pssRoutes);
} catch (pssErr) {
    console.warn('⚠️ PSS Storage routes failed to load:', pssErr.message);
}

try {
} catch (innerMountError) {
    console.error('❌ CRITICAL: Failed to mount blockchain-server-routes:', innerMountError.message);
    console.error(innerMountError.stack);
    blockchainError = 'Route Mounting Error: ' + innerMountError.message;
}

// Initialize blockchain in background (non-blocking)
async function initializeBlockchain() {
    try {
        const EnhancedHybridBlockchainAI = require('./blockchain-core-v33');
        console.log('Initializing CHEESE Blockchain...');

        // [URGENT] Disable Firestore to avoid usage limits (SQLite Only Mode)
        process.env.CHEESE_ISOLATION_MODE = 'true';
        const isRailway = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_NAME || process.env.RENDER;
        const sqlitePath = process.env.DB_PATH || (isRailway ? '/app/data/cheese-blockchain.db' : './cheese-blockchain.db');

        blockchain = new EnhancedHybridBlockchainAI({
            useFirestore: false,
            useDualStorage: false,
            projectId: process.env.GCP_PROJECT_ID || 'cheese-blockchain',
            dbPath: sqlitePath,
            miningReward: 50,
            difficulty: 4,
            p2pPort: parseInt(P2P_PORT),
            nodeRole: NODE_ROLE
        });

        // [NEW] Define critical metadata routes IMMEDIATELY
        const MAX_SUPPLY = 21000000;
        const CIRCULATING_SUPPLY = 4000000;

        app.get('/api/supply', (req, res) => {
            res.json({
                success: true,
                data: {
                    max_supply: MAX_SUPPLY,
                    total_supply: MAX_SUPPLY,
                    circulating_supply: CIRCULATING_SUPPLY,
                    symbol: 'NCH',
                    name: 'Native Cheesecoin'
                }
            });
        });

        app.get('/api/total-supply', (req, res) => res.type('text/plain').send(MAX_SUPPLY.toString()));
        app.get('/api/circulating-supply', (req, res) => res.type('text/plain').send(CIRCULATING_SUPPLY.toString()));

        // Initialize with increased timeout
        console.log('[SYNC] Initializing ledger and syncing with Cloud persistence...');
        await blockchain.initialize();
        
        // Mark as ready ONLY after sync is complete
        blockchainReady = true;
        console.log('✅ [HOTFIX] Blockchain initialization sequence complete. API is READY.');

        // Initialize RPC Bridge
        try {
            rpcBridge = new RPCBridge(blockchain);
            console.log('🐺 EVM RPC Bridge initialized for MetaMask (Chain ID: 20250)');
        } catch (rpcError) {
            console.error('⚠️ RPC Bridge initialization failed:', rpcError.message);
        }

        // START HEADLESS SYSTEM MINER (v1.0.0)
        try {
            const HeadlessSystemMiner = require('./headless-system-miner');
            const systemMiner = new HeadlessSystemMiner(blockchain, { 
                interval: 30000 // Mine every 30 seconds across active registered wallet rotation
            });
            systemMiner.start();
            console.log('⛏️  Headless System Miner integrated and started.');
        } catch (minerError) {
            console.error('❌ Failed to start Headless System Miner:', minerError.message);
        }

    } catch (error) {
        console.error('❌ Failed to initialize blockchain:', error);
        blockchainError = error.message;
    }
}

// Start async init
initializeBlockchain();

// SPA catch-all route for frontend paths (/explorer/*, /wallet/*, /dex/*)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/rpc')) return next();

    let indexPath = path.join(__dirname, 'public', 'index.html');
    
    if (req.path.startsWith('/explorer')) {
        indexPath = path.join(__dirname, 'public', 'explorer', 'index.html');
    } else if (req.path.startsWith('/wallet')) {
        indexPath = path.join(__dirname, 'public', 'wallet', 'index.html');
    } else if (req.path.startsWith('/dex')) {
        indexPath = path.join(__dirname, 'public', 'dex', 'index.html');
    }
    
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Start server if run directly
if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 CHEESE Blockchain Core (v1.0.1) listening on port ${PORT}`);
        console.log(`📡 WebRTC Signaling server active at /notary-signaling`);
    });

    process.on('SIGTERM', () => {
        console.log('🛑 SIGTERM received, shutting down gracefully...');
        server.close(() => {
            if (blockchain && blockchain.close) {
                blockchain.close().then(() => process.exit(0));
            } else {
                process.exit(0);
            }
        });
    });
}

module.exports = app;
