console.log('!!!!!!! BUILD VERIFICATION LOG: V3 !!!!!!!');
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;

// Create HTTP server from Express app
const server = http.createServer(app);

// Initialize WebSocket server for WebRTC signaling
const wss = new WebSocket.Server({ noServer: true });

// Store signaling rooms
const rooms = new Map(); // Map<roomId, Set<ws>>

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room');

    if (!roomId) {
        ws.close(1008, 'Room ID required');
        return;
    }

    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }

    const room = rooms.get(roomId);
    room.add(ws);
    console.log(`📡 Peer joined room: ${roomId} (Total: ${room.size})`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Broadcast to other peers in the same room
            room.forEach(peer => {
                if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                    peer.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.error('❌ Signaling error:', e.message);
        }
    });

    ws.on('close', () => {
        room.delete(ws);
        if (room.size === 0) {
            rooms.delete(roomId);
        }
        console.log(`📡 Peer left room: ${roomId}`);
    });
});


app.use(cors()); // Allow all origins for assets & API
// Serve static files from 'public' directory at the root level
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
}));

const serviceName = process.env.RAILWAY_SERVICE_NAME || '';
const serviceUrl = process.env.RAILWAY_STATIC_URL || '';
const identification = (serviceName + serviceUrl).toLowerCase();

console.log(`🧀 CHEESE Smart Proxy active`);
console.log(`📡 Identity: ${serviceName} | URL: ${serviceUrl}`);
console.log(`📡 Port: ${PORT} | Mode: ${process.env.NODE_ENV}`);

let mountingError = null;
let coreMounted = false;

// ==========================================
// UNIFIED HEALTH CHECK ENGINE (v5.2.3)
// ==========================================
// Standard Health Check
app.get(['/health', '/status', '/healthcheck'], (req, res) => {
    // console.log('💓 Health check received'); // Uncomment for deep debug, but cleaner logs preferred
    res.json({
        status: coreMounted ? 'ok' : (mountingError ? 'error' : 'proxy-only'),
        version: '5.2.8-render',
        service: serviceName || 'master-proxy',
        proxy: true,
        core: {
            mounted: coreMounted,
            error: mountingError
        },
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});
// Root Health Check (Sometimes Railway hits the root)
app.get('/', (req, res, next) => {
    // If it's a health check (No headers or specific UA), respond 200
    if (req.headers['user-agent']?.includes('Railway') || req.query.health === 'true') {
        return res.json({ status: 'ok', proxy: true, mode: 'root-health' });
    }
    next();
});

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        version: '5.2.6',
        service: serviceName || 'master-proxy',
        identification: identification,
        port: PORT,
        env: {
            NODE_ENV: process.env.NODE_ENV,
            RAILWAY_PROJECT_NAME: process.env.RAILWAY_PROJECT_NAME,
            RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME,
            STATIC_URL: serviceUrl
        },
        bridge: {
            active: (process.env.NODE_ENV === 'production' || process.env.START_BRIDGE === 'true'),
            hasPrivateKey: !!process.env.BRIDGE_PRIVATE_KEY
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// BACKGROUND BRIDGE WORKER (SIDE-CAR)
// ==========================================
// Start the Bridge Worker in background for ALL services
// This ensures the bridge is ALWAYS watching for deposits
// Do NOT start bridge on DEX (it runs on the main node)
if ((process.env.NODE_ENV === 'production' || process.env.START_BRIDGE === 'true') &&
    process.env.BRIDGE_PRIVATE_KEY &&
    !identification.includes('dex')) {
    console.log('🌉 Starting Background Bridge Worker Engine...');
    try {
        const { fork } = require('child_process');
        const path = require('path');
        const bridgeProcess = fork(path.join(__dirname, './bridge/cheese-bsc-bridge.js'), [], {
            env: { ...process.env },
            stdio: 'inherit' // Ensure bridge logs show up in main console
        });

        bridgeProcess.on('error', (err) => {
            console.error('❌ Bridge Worker Spawn Error:', err);
        });

        bridgeProcess.on('exit', (code) => {
            if (process.env.BRIDGE_PRIVATE_KEY) {
                console.warn(`⚠️ Bridge Worker exited with code ${code}. Restarting in 10s...`);
            }
        });
    } catch (e) {
        console.error('❌ Failed to spawn Bridge Worker:', e);
    }
}

// Simple health check for the proxy itself
if (process.env.CHECK_HEALTH === 'true') {
    console.log('🏥 Health check mode active');
}

// ==========================================
// ROUTING ENGINE
// ==========================================
// ==========================================
// UNIFIED ROUTING ENGINE (Multi-App on Single Domain)
// ==========================================

// Serve whitepaper at clean URL /whitepaper
app.get('/whitepaper', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'whitepaper.html'));
});

console.log('🔄 Mounting DEX Backend Matching Engine at /dex...');
try {
    const dexApp = require('./dex-server-fixed.js');
    app.use('/dex', dexApp);
} catch (e) {
    console.error('❌ Failed to mount DEX:', e.message);
}

console.log('🔄 Mounting Explorer Frontend at /explorer...');
try {
    // Inline Explorer sub-app (replaces missing deploy-explorer/server.js)
    const explorerApp = express.Router();
    explorerApp.use(express.static(path.join(__dirname, 'public', 'explorer'), {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.setHeader('Surrogate-Control', 'no-store');
            }
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            res.setHeader('X-XSS-Protection', '1; mode=block');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
        }
    }));
    // SPA fallback for /explorer/ and /explorer/block/123 etc.
    explorerApp.get('*', (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
        res.sendFile(path.join(__dirname, 'public', 'explorer', 'index.html'));
    });
    app.use('/explorer', explorerApp);
    console.log('✅ Explorer mounted (inline from public/explorer)');
} catch (e) {
    console.error('❌ Failed to mount Explorer:', e.message);
}

console.log('🔄 Mounting Wallet Frontend at /wallet...');
try {
    const walletApp = require('./deploy-wallet/server.js');
    app.use('/wallet', walletApp);
} catch (e) {
    console.error('❌ Failed to mount Wallet:', e.message);
}

console.log('🔄 Mounting Mining Frontend at /mining...');
try {
    const miningApp = require('./mining-frontend/server.js');
    app.use('/mining', miningApp);
} catch (e) {
    console.error('❌ Failed to mount Mining:', e.message);
}

// Security Headers Middleware
const securityHeaders = (req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self' https://firestore.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com;");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
};

// Default to Blockchain Server for CHEESE
// EDUCATIONAL BLOCKCHAIN PLATFORM - Clear branding for security
console.log('⛓️ Routing to Blockchain Core (v5.2.5 Full Mounting)...');
try {
    const coreApp = require('./start-server.js');
    app.use(securityHeaders);
    app.use('/', coreApp);
    coreMounted = true;
    console.log('✅ Blockchain Core mounted successfully');
} catch (e) {
    mountingError = {
        message: e.message,
        stack: e.stack,
        time: new Date().toISOString()
    };
    console.error('❌ Failed to mount Blockchain Core:', e.message);
    console.error(e.stack);
}

// ==========================================
// MASTER SERVER START (v5.2.4)
// ==========================================
// ALWAYS listen here to satisfy Railway's health monitor immediately.
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/notary-signaling') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Master Server (v5.2.4) listening on port ${PORT}`);
    console.log(`✅ ${serviceName || 'Master Proxy'} is now ONLINE`);
    console.log(`📡 WebRTC Signaling available at /notary-signaling`);
});

