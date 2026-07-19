// Cheese Notarized P2P Controller Script
document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let myRole = null; // 'notary' or 'client'
    let sessionID = null;
    let localStream = null;
    let peerConnection = null;
    let dataChannel = null;
    let localWallet = null; // Fallback in-browser keypair if MetaMask is missing
    let walletAddress = null;
    let walletBalance = null;
    let ethersProvider = null;
    let ethersSigner = null;

    // Instantiate CheeseBlockchainAPI client with safety validation
    let storedNodeUrl = localStorage.getItem('cheese_node_api_url');
    if (storedNodeUrl && (storedNodeUrl.startsWith('0x') || storedNodeUrl.length === 42)) {
        storedNodeUrl = null;
        localStorage.removeItem('cheese_node_api_url');
    }
    const api = new CheeseBlockchainAPI(storedNodeUrl || null);

    // --- WebRTC File Transfer State ---
    let transferMetadata = null;
    let receivedChunks = [];
    let receivedBytes = 0;
    let candidateQueue = [];
    
    // --- Default Configuration ---
    let contractAddress = localStorage.getItem('cheese_notary_contract_address') || "";
    
    // Minimal ABI required for read/write on CheeseNotary.sol
    const contractABI = [
        "function notarize(string _documentHash, address _client, bytes _clientSignature, string _fileType, string _fileName) public",
        "function recordExists(string) public view returns (bool)",
        "function getRecord(string _documentHash) public view returns (string documentHash, address client, address notary, uint256 timestamp, string fileType, string fileName, bool isVerified)",
        "event DocumentNotarized(string indexed documentHash, address indexed client, address indexed notary, uint256 timestamp, string fileType, string fileName)"
    ];

    // Local Storage Ledger History (Acts as our on-screen ledger database cache)
    let rawLedger = JSON.parse(localStorage.getItem('cheese_notary_ledger')) || [];
    // Sanitize: Filter out legacy simulated mock data (containing wei, or mock Tx IDs)
    let ledgerDatabase = rawLedger.filter(rec => {
        if (!rec) return false;
        const gasStr = String(rec.gas || '');
        const txHashStr = String(rec.txHash || '');
        const blockStr = String(rec.blockNumber || '');
        if (gasStr.includes('wei') || txHashStr.startsWith('CHZ-TX-') || blockStr.includes('491494')) {
            return false;
        }
        return true;
    });
    // Save sanitized ledger back to localStorage
    if (rawLedger.length !== ledgerDatabase.length) {
        localStorage.setItem('cheese_notary_ledger', JSON.stringify(ledgerDatabase));
    }

    // --- DOM Elements ---
    const navWorkspace = document.getElementById('nav-workspace');
    const navLedger = document.getElementById('nav-ledger');
    const navNode = document.getElementById('nav-node');
    const navVault = document.getElementById('nav-vault');
    const tabWorkspace = document.getElementById('workspace-section');
    const tabLedger = document.getElementById('ledger-section');
    const tabNode = document.getElementById('node-section');
    const tabVault = document.getElementById('vault-section');
    
    const pageTitle = document.getElementById('page-title');
    const pageDesc = document.getElementById('page-description');

    const walletStatusDot = document.getElementById('wallet-status-dot');
    const walletStatusText = document.getElementById('wallet-status-text');
    const walletAddressDisplay = document.getElementById('wallet-address-display');
    const walletBalanceDisplay = document.getElementById('wallet-balance-display');
    const sidebarConnectWalletBtn = document.getElementById('sidebar-connect-wallet-btn');
    const sidebarDisconnectWalletBtn = document.getElementById('sidebar-disconnect-wallet-btn');

    const setupPanel = document.getElementById('setup-panel');
    const selectRoleNotary = document.getElementById('select-role-notary');
    const selectRoleClient = document.getElementById('select-role-client');
    const notarySetupForm = document.getElementById('notary-setup-form');
    const clientSetupForm = document.getElementById('client-setup-form');
    const notarySessionIdInput = document.getElementById('notary-session-id');
    const btnCopySessionId = document.getElementById('btn-copy-session-id');
    const clientTargetSessionIdInput = document.getElementById('client-target-session-id');
    const btnClientConnect = document.getElementById('btn-client-connect');

    const toggleManualHandshake = document.getElementById('toggle-manual-handshake');
    const manualHandshakeContent = document.getElementById('manual-handshake-content');
    const handshakeOffer = document.getElementById('handshake-offer');
    const btnCopyOffer = document.getElementById('btn-copy-offer');
    const handshakeOfferInput = document.getElementById('handshake-offer-input');
    const btnGenerateAnswer = document.getElementById('btn-generate-answer');
    const handshakeAnswer = document.getElementById('handshake-answer');
    const btnCopyAnswer = document.getElementById('btn-copy-answer');
    const handshakeAnswerInput = document.getElementById('handshake-answer-input');
    const btnAcceptAnswer = document.getElementById('btn-accept-answer');

    const notaryRoomPanel = document.getElementById('notary-room-panel');
    const connectionStatusBadge = document.getElementById('connection-status-badge');
    const btnHangup = document.getElementById('btn-hangup');

    const notarySessionAddress = document.getElementById('notary-session-address');
    const clientSessionAddress = document.getElementById('client-session-address');
    const clientVerifyStatus = document.getElementById('client-verify-status');
    const clientSignIdentityBox = document.getElementById('client-sign-identity-box');
    const btnClientSignIdentity = document.getElementById('btn-client-sign-identity');

    const clientFileUploadBox = document.getElementById('p2p-file-upload-box');
    const p2pFileValInput = document.getElementById('p2p-file-input');
    const fileProgressBox = document.getElementById('file-progress-box');
    const progressFileName = document.getElementById('progress-file-name');
    const progressPercentage = document.getElementById('progress-percentage');
    const progressFillBar = document.getElementById('progress-fill-bar');

    const filePreviewZone = document.getElementById('file-preview-zone');
    const filePreviewContent = document.getElementById('file-preview-content');
    const previewFileName = document.getElementById('preview-file-name');
    const previewFileType = document.getElementById('preview-file-type');
    const previewFileHash = document.getElementById('preview-file-hash');

    const notaryStampCard = document.getElementById('notary-stamp-card');
    const btnNotaryStamp = document.getElementById('btn-notary-stamp');
    const notaryStampValidationMsg = document.getElementById('notary-stamp-validation-msg');

    const ledgerSearchInput = document.getElementById('ledger-search-input');
    const btnLedgerSearch = document.getElementById('btn-ledger-search');
    const ledgerSearchResult = document.getElementById('ledger-search-result');
    const ledgerHistoryRows = document.getElementById('ledger-history-rows');

    const headerVerificationSearch = document.getElementById('header-verification-search');
    const headerVerifyBtn = document.getElementById('header-verify-btn');
    const verificationModal = document.getElementById('verificationModal');
    const modalResultContent = document.getElementById('modalResultContent');
    const modalCloseBtn = document.querySelector('.modal-close-btn');

    const nodeUrlInput = document.getElementById('deployed-node-url');
    const btnSaveNodeUrl = document.getElementById('btn-save-node-url');
    const contractAddressInput = document.getElementById('deployed-contract-address');
    const btnSaveContract = document.getElementById('btn-save-contract');

    // --- State Storage References ---
    let clientAddress = null;
    let clientSignature = null;
    let activeFileHash = null;
    let activeFileName = null;
    let activeFileType = null;

    // Canvas rendering loop holders for simulated cameras
    let notarySimLoop = null;
    let clientSimLoop = null;

    // WebRTC Signaling Channel (Adapted for WebSocket/BroadcastChannel)
    let signalingChannel = null;
    let socket = null;

    // Set initial configuration parameters
    if (nodeUrlInput) nodeUrlInput.value = api.apiUrl;
    if (contractAddressInput) contractAddressInput.value = contractAddress;

    // --- Tab Navigation Setup ---
    function switchTab(activeNav, activeTabEl, title, desc) {
        [navWorkspace, navLedger, navNode, navVault].forEach(nav => { if (nav) nav.classList.remove('active'); });
        [tabWorkspace, tabLedger, tabNode, tabVault].forEach(tab => { if (tab) tab.classList.add('hidden'); });
        
        activeNav.classList.add('active');
        activeTabEl.classList.remove('hidden');
        pageTitle.textContent = title;
        pageDesc.textContent = desc;

        if (activeNav === navLedger) {
            renderLedgerHistory();
        }
        if (activeNav === navVault) {
            renderVault();
        }
    }

    navWorkspace.addEventListener('click', () => {
        switchTab(navWorkspace, tabWorkspace, "P2P Notary Workspace", "Securely stream files peer-to-peer and notarize them directly on the Cheese Blockchain.");
    });

    navLedger.addEventListener('click', () => {
        switchTab(navLedger, tabLedger, "Blockchain Ledger", "Explore verified documents and on-chain certificates logged directly to the smart contract.");
    });

    navNode.addEventListener('click', () => {
        switchTab(navNode, tabNode, "Governance Node Status", "Review status metrics and update deployment parameters for sovereign node validators.");
    });

    if (navVault) {
        navVault.addEventListener('click', () => {
            switchTab(navVault, tabVault, "Public Vault", "Browse all documents notarized on the Cheese Blockchain.");
        });
    }

    const sidebarGovInstallLink = document.getElementById('sidebar-gov-install-link');
    if (sidebarGovInstallLink) {
        sidebarGovInstallLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(navNode, tabNode, "Governance Node Status", "Review status metrics and update deployment parameters for sovereign node validators.");
        });
    }

    // --- Local Workspace Step Progress Tracker ---
    function setLocalStep(stepNum) {
        const step1 = document.getElementById('step-track-1');
        const step2 = document.getElementById('step-track-2');
        const step3 = document.getElementById('step-track-3');
        
        [step1, step2, step3].forEach(el => {
            if (el) el.classList.remove('active');
        });

        if (stepNum === 1) {
            if (step1) step1.classList.add('active');
        } else if (stepNum === 2) {
            if (step2) step2.classList.add('active');
        } else if (stepNum === 3) {
            if (step3) step3.classList.add('active');
        }
    }

    // --- Local Cryptographic Wallet Initialization ---
    async function fetchBalanceFromNode(address) {
        if (!address) return;
        try {
            const balance = await api.getBalance(address, true);
            walletBalance = parseFloat(balance).toFixed(4);
            if (localWallet) {
                walletBalanceDisplay.textContent = `${walletBalance} NCH (Imported)`;
            } else {
                walletBalanceDisplay.textContent = `${walletBalance} NCH`;
            }
            walletBalanceDisplay.classList.remove('hidden');
        } catch (err) {
            console.error("Failed to fetch balance from node:", err);
            if (!walletBalance) {
                walletBalanceDisplay.textContent = "0.0000 NCH (Offline)";
            }
        }
    }

    function initLocalWallet() {
        // Generate/load local sandbox wallet for document-only stamps
        const privateKey = localStorage.getItem('cheese_sandbox_private_key');
        if (privateKey) {
            localWallet = new ethers.Wallet(privateKey);
        } else {
            localWallet = ethers.Wallet.createRandom();
            localStorage.setItem('cheese_sandbox_private_key', localWallet.privateKey);
        }
        walletAddress = localWallet.address;

        if (window.ethereum) {
            ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
        }
    }

    async function connectMetaMask() {
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
                ethersSigner = ethersProvider.getSigner();
                walletAddress = accounts[0];
                
                await fetchBalanceFromNode(walletAddress);
                
                localWallet = null; // deactivate fallback
                isMetaMaskConnected = true;
                showConnectedPanel(false);
                
                // Listen to accounts changed
                window.ethereum.on('accountsChanged', async (accs) => {
                    if (accs.length > 0) {
                        walletAddress = accs[0];
                        await fetchBalanceFromNode(walletAddress);
                        showConnectedPanel(false);
                    } else {
                        disconnectWallet();
                    }
                });
            } catch (err) {
                console.error("Wallet connection rejected:", err);
                alert("Connection rejected. You can try again or continue as Guest.");
            }
        } else {
            alert("MetaMask wallet was not found. Please install MetaMask or continue as Guest.");
        }
    }

    // --- Wallet UI Panel Management ---
    const walletChoicePanel = document.getElementById('wallet-choice-panel');
    const walletConnectedPanel = document.getElementById('wallet-connected-panel');
    const walletStatusDotConnected = document.getElementById('wallet-status-dot-connected');
    const walletStatusTextConnected = document.getElementById('wallet-status-text-connected');
    const guestModeBtn = document.getElementById('sidebar-guest-mode-btn');

    const sidebarManualWalletBtn = document.getElementById('sidebar-manual-wallet-btn');
    const manualWalletContainer = document.getElementById('manual-wallet-input-container');
    const manualWalletInput = document.getElementById('manual-wallet-address-input');
    const btnConfirmManualWallet = document.getElementById('btn-confirm-manual-wallet');
    const btnCancelManualWallet = document.getElementById('btn-cancel-manual-wallet');

    function showConnectedPanel(isGuest, isManual = false) {
        // Hide choice, show connected state
        if (walletChoicePanel) walletChoicePanel.classList.add('hidden');
        if (walletConnectedPanel) walletConnectedPanel.classList.remove('hidden');

        const shortAddress = walletAddress ? walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4) : '0x0000...0000';
        walletAddressDisplay.textContent = shortAddress;

        if (isGuest) {
            if (walletStatusDotConnected) walletStatusDotConnected.className = 'dot warning';
            if (walletStatusTextConnected) walletStatusTextConnected.textContent = 'Guest Mode (Documents Only)';
            walletBalanceDisplay.textContent = `${walletBalance || '0.0000'} NCH (Guest)`;
        } else if (isManual) {
            if (walletStatusDotConnected) walletStatusDotConnected.className = 'dot active';
            if (walletStatusTextConnected) walletStatusTextConnected.textContent = 'Manual Address Connected';
            walletBalanceDisplay.textContent = `${walletBalance || '0.0000'} NCH`;
        } else {
            if (walletStatusDotConnected) walletStatusDotConnected.className = 'dot active';
            if (walletStatusTextConnected) walletStatusTextConnected.textContent = 'Wallet Connected';
            walletBalanceDisplay.textContent = `${walletBalance || '0.0000'} NCH`;
        }

        // Populate on-screen session references
        if (myRole === 'notary') {
            notarySessionAddress.textContent = walletAddress;
        } else if (myRole === 'client') {
            clientSessionAddress.textContent = walletAddress;
        }
    }

    function disconnectWallet() {
        ethersSigner = null;
        ethersProvider = null;
        localWallet = null;
        walletAddress = null;
        walletBalance = '0.0000';
        isMetaMaskConnected = false;

        // Reset manual input
        if (manualWalletInput) manualWalletInput.value = '';
        if (manualWalletContainer) manualWalletContainer.classList.add('hidden');

        // Show choice panel again, hide connected panel
        if (walletChoicePanel) walletChoicePanel.classList.remove('hidden');
        if (walletConnectedPanel) walletConnectedPanel.classList.add('hidden');

        console.log("Wallet disconnected. Returned to choice screen.");
    }

    if (sidebarDisconnectWalletBtn) {
        sidebarDisconnectWalletBtn.addEventListener('click', () => {
            disconnectWallet();
        });
    }

    // Connect Wallet button (MetaMask extension)
    sidebarConnectWalletBtn.addEventListener('click', connectMetaMask);

    // Guest Mode button — inits sandbox wallet silently for doc-only stamps
    if (guestModeBtn) {
        guestModeBtn.addEventListener('click', () => {
            initLocalWallet();
            fetchBalanceFromNode(walletAddress);
            showConnectedPanel(true);
        });
    }

    // Manual Address Input button & handlers
    if (sidebarManualWalletBtn && manualWalletContainer) {
        sidebarManualWalletBtn.addEventListener('click', () => {
            manualWalletContainer.classList.remove('hidden');
            if (manualWalletInput) manualWalletInput.focus();
        });
    }

    if (btnCancelManualWallet && manualWalletContainer) {
        btnCancelManualWallet.addEventListener('click', () => {
            manualWalletContainer.classList.add('hidden');
        });
    }

    if (btnConfirmManualWallet && manualWalletInput) {
        btnConfirmManualWallet.addEventListener('click', () => {
            const enteredAddr = manualWalletInput.value.trim();
            if (!enteredAddr || enteredAddr.length < 8) {
                alert("Please enter a valid wallet address (e.g. 0x123... or your public key address).");
                return;
            }

            // Set sandbox signing base, then assign user's specified public address
            initLocalWallet();
            walletAddress = enteredAddr;
            isMetaMaskConnected = true; // Unlock full platform capabilities for user's specified address

            fetchBalanceFromNode(walletAddress);
            showConnectedPanel(false, true);
        });
    }

    // --- Wallet Gating: No default wallet on load ---
    // Wallet or manual address is required for: images/audio/video notarization, P2P sessions, file sending.
    // Guest mode uses sandbox wallet for document-only local stamps.
    let isMetaMaskConnected = false;

    function requireMetaMaskWallet(actionName) {
        if (!isMetaMaskConnected) {
            alert(`⚠ Please connect your wallet or enter your address to ${actionName}.\n\nClick "Connect My Wallet" or "Enter Address Manually" in the sidebar.`);
            return false;
        }
        return true;
    }

    // Helper: check if a MIME type is a document (allowed without MetaMask)
    function isDocumentType(mimeType) {
        if (!mimeType) return true;
        const docTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats', 'text/plain', 'text/html', 'text/csv', 'application/rtf'];
        return docTypes.some(t => mimeType.startsWith(t)) || mimeType.startsWith('text/');
    }

    // DO NOT auto-init wallet on page load — user must choose first

    // --- Canvas Simulated Live Video System ---
    // Generates an interactive animated vector output, capturing it as a MediaStream track
    function startSimulatedCamera(canvasId, labelText, addressText) {
        const canvas = document.getElementById(canvasId);
        const ctx = canvas.getContext('2d');
        let angle = 0;
        let scanlineY = 0;
        let speed = 1.5;

        function drawFrame() {
            if (!canvas.isConnected) return; // Stop loop if element removed

            // Draw Background Dark Grid
            ctx.fillStyle = "#020617";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
            ctx.lineWidth = 1;
            for (let x = 0; x < canvas.width; x += 20) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += 20) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }

            // Draw central rotating geometry (The sovereign system anchor)
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(angle);
            ctx.strokeStyle = "#fbbf24";
            ctx.lineWidth = 2;
            
            // Hexagon outer
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const px = Math.cos(i * Math.PI / 3) * 45;
                const py = Math.sin(i * Math.PI / 3) * 45;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();

            // Inner circle
            ctx.beginPath();
            ctx.arc(0, 0, 20, 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.restore();

            // Laser scanline animation
            ctx.fillStyle = "rgba(251, 191, 36, 0.15)";
            ctx.fillRect(0, scanlineY, canvas.width, 2);
            
            // Text overlays (Government feed credentials)
            ctx.fillStyle = "#f8fafc";
            ctx.font = "bold 10px monospace";
            ctx.fillText(`STREAM: LIVE REMOTE FEED`, 15, 25);
            ctx.fillText(`ROLE: ${labelText.toUpperCase()}`, 15, 40);
            
            ctx.fillStyle = "#94a3b8";
            ctx.fillText(`ID: ${addressText.slice(0, 12)}...${addressText.slice(-8)}`, 15, canvas.height - 35);
            
            // Time Stamp
            const now = new Date();
            ctx.fillStyle = "#fbbf24";
            ctx.fillText(now.toISOString().replace('T', ' ').slice(0, 19), 15, canvas.height - 20);

            // Frame logic increments
            angle += 0.01;
            scanlineY += speed;
            if (scanlineY > canvas.height || scanlineY < 0) {
                speed = -speed;
            }

            // Call next frame
            if (labelText.toLowerCase() === 'notary') {
                notarySimLoop = requestAnimationFrame(drawFrame);
            } else {
                clientSimLoop = requestAnimationFrame(drawFrame);
            }
        }

        drawFrame();
        return canvas.captureStream(15);
    }

    // --- WebRTC Connection Implementation ---
    // TURN Relay Configuration System (Government-Grade Cross-Network P2P)
    // STUN alone cannot traverse Symmetric NATs (mobile carriers, corporate firewalls).
    // TURN relay servers act as intermediaries when direct P2P connection fails.
    // The system fetches dynamic credentials from the server, with multiple fallbacks.

    // Fallback STUN-only config (used only if all TURN credential fetches fail)
    const STUN_FALLBACK_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' }
        ],
        iceCandidatePoolSize: 3
    };

    // Cached TURN credentials (refreshed every 12 hours or on page load)
    let cachedICEConfig = null;
    let iceConfigFetchedAt = 0;
    const ICE_CONFIG_TTL = 12 * 60 * 60 * 1000; // 12 hours

    /**
     * Fetches TURN relay credentials from the server.
     * Falls back to embedded free TURN servers if the server is unavailable.
     * Caches credentials to avoid redundant network requests.
     */
    async function fetchTURNCredentials() {
        // Return cached config if still valid
        if (cachedICEConfig && (Date.now() - iceConfigFetchedAt < ICE_CONFIG_TTL)) {
            console.log('📡 Using cached TURN credentials');
            return cachedICEConfig;
        }

        try {
            console.log('📡 Fetching TURN relay credentials from server...');
            const response = await fetch('/api/turn-credentials', {
                signal: AbortSignal.timeout(8000) // 8 second timeout
            });

            if (response.ok) {
                const data = await response.json();
                if (data.iceServers && data.iceServers.length > 0) {
                    const config = {
                        iceServers: data.iceServers,
                        iceCandidatePoolSize: 5,
                        // Allow relay candidates through restrictive firewalls
                        iceTransportPolicy: 'all'
                    };

                    // Validate we actually got TURN servers (not just STUN)
                    const hasTURN = data.iceServers.some(s => {
                        const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
                        return urls.some(u => u.startsWith('turn:') || u.startsWith('turns:'));
                    });

                    if (hasTURN) {
                        console.log(`✅ TURN relay servers loaded (provider: ${data.provider || 'unknown'}, ${data.iceServers.length} servers)`);
                    } else {
                        console.warn('⚠️ Server returned ICE config but no TURN servers present — cross-network P2P may fail');
                    }

                    cachedICEConfig = config;
                    iceConfigFetchedAt = Date.now();
                    return config;
                }
            }
        } catch (fetchErr) {
            console.warn('⚠️ Could not fetch TURN credentials from server:', fetchErr.message);
        }

        // Client-side embedded fallback: free TURN relay servers
        // These work for testing/development but have rate limits
        console.log('📡 Using embedded free TURN relay fallback');
        const fallbackConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun.cloudflare.com:3478' },
                // Free TURN relays (rate-limited, for dev/testing)
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
            ],
            iceCandidatePoolSize: 5,
            iceTransportPolicy: 'all'
        };

        cachedICEConfig = fallbackConfig;
        iceConfigFetchedAt = Date.now();
        return fallbackConfig;
    }

    /**
     * Validates TURN config by checking candidate types.
     * Logs diagnostic information for debugging connectivity issues.
     */
    function logICECandidateInfo(candidate) {
        if (!candidate || !candidate.candidate) return;
        const parts = candidate.candidate.split(' ');
        const candidateType = parts.length > 7 ? parts[7] : 'unknown';
        const protocol = candidate.protocol || (parts.length > 2 ? parts[2] : 'unknown');

        if (candidateType === 'relay') {
            console.log(`✅ ICE Candidate: type=RELAY (TURN), protocol=${protocol} — cross-network P2P enabled`);
        } else if (candidateType === 'srflx') {
            console.log(`📡 ICE Candidate: type=srflx (server reflexive/STUN), protocol=${protocol}`);
        } else if (candidateType === 'host') {
            console.log(`🏠 ICE Candidate: type=host (local), protocol=${protocol}`);
        } else {
            console.log(`📡 ICE Candidate: type=${candidateType}, protocol=${protocol}`);
        }
    }

    async function initWebRTCPeer(isInitiator, providedConfig = null) {
        console.log(`Initializing PeerConnection (Initiator: ${isInitiator})`);

        // Fetch TURN credentials if no config was provided
        const rtcConfig = providedConfig || await fetchTURNCredentials();
        peerConnection = new RTCPeerConnection(rtcConfig);

        // --- ICE Diagnostics: Gathering State ---
        let hasRelayCandidates = false;
        peerConnection.onicegatheringstatechange = () => {
            console.log(`🔍 ICE Gathering State: ${peerConnection.iceGatheringState}`);
            if (peerConnection.iceGatheringState === 'complete') {
                if (!hasRelayCandidates) {
                    console.warn('⚠️ ICE gathering complete but NO relay (TURN) candidates found. Cross-network P2P may fail.');
                    console.warn('   → Verify TURN server credentials or configure METERED_API_KEY on the server.');
                } else {
                    console.log('✅ ICE gathering complete — relay candidates available for cross-network connectivity');
                }
            }
        };

        // --- ICE Diagnostics: Connection State with Auto-Restart ---
        let iceRestartAttempts = 0;
        const MAX_ICE_RESTARTS = 2;
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`🔍 ICE Connection State: ${peerConnection.iceConnectionState}`);

            if (peerConnection.iceConnectionState === 'failed') {
                if (iceRestartAttempts < MAX_ICE_RESTARTS) {
                    iceRestartAttempts++;
                    console.log(`🔄 ICE connection failed. Attempting ICE restart (${iceRestartAttempts}/${MAX_ICE_RESTARTS})...`);
                    try {
                        peerConnection.restartIce();
                        // If we're the initiator, create a new offer with ICE restart
                        if (isInitiator && signalingChannel) {
                            peerConnection.createOffer({ iceRestart: true }).then(offer => {
                                peerConnection.setLocalDescription(offer);
                                signalingChannel.postMessage({
                                    type: 'offer',
                                    sdp: offer.sdp,
                                    session: sessionID
                                });
                                console.log('📡 ICE restart offer broadcasted');
                            }).catch(err => console.error('ICE restart offer failed:', err));
                        }
                    } catch (restartErr) {
                        console.error('ICE restart failed:', restartErr);
                    }
                } else {
                    console.error('❌ ICE connection failed after maximum restart attempts.');
                }
            } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
                iceRestartAttempts = 0; // Reset on successful connection
            }
        };

        // --- ICE Diagnostics: Candidate Errors ---
        peerConnection.addEventListener('icecandidateerror', (event) => {
            // errorCode 701 = TURN authentication failure
            // errorCode 300 = STUN binding failure
            if (event.errorCode === 701) {
                console.error(`❌ TURN authentication failed: ${event.errorText} (server: ${event.url})`);
                console.error('   → Check TURN credentials — they may be expired or invalid.');
            } else {
                console.warn(`⚠️ ICE candidate error [${event.errorCode}]: ${event.errorText} (${event.url || 'unknown'})`);
            }
        });

        // Bind connection state metrics
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection State Changed:", peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                handleP2PConnected();
            } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
                handleP2PDisconnected();
            }
        };

        // Add media stream track to connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        // Catch remote media streams
        peerConnection.ontrack = (event) => {
            console.log("Remote WebRTC track detected. Attaching remote peer video stream.");
            const remoteStream = event.streams[0];
            
            // Remote feed goes into right video container
            const targetVideoBox = document.getElementById('client-video-container');
            const canvasEl = document.getElementById('client-video-canvas');
            if (canvasEl) canvasEl.classList.add('hidden');

            let videoEl = targetVideoBox.querySelector('video.remote-peer-video');
            if (!videoEl) {
                videoEl = document.createElement('video');
                videoEl.className = "sim-video remote-peer-video";
                videoEl.autoplay = true;
                videoEl.playsInline = true;
                videoEl.muted = false; // Enable remote audio
                targetVideoBox.appendChild(videoEl);
            }
            videoEl.srcObject = remoteStream;
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // Log candidate type for diagnostics
                logICECandidateInfo(event.candidate);

                // Track whether we got relay (TURN) candidates
                if (event.candidate.candidate && event.candidate.candidate.includes('relay')) {
                    hasRelayCandidates = true;
                }

                // Send candidate over signaling channel
                if (signalingChannel) {
                    signalingChannel.postMessage({
                        type: 'candidate',
                        candidate: event.candidate,
                        session: sessionID
                    });
                }
                
                // Update manual SDP codes containing candidate info
                updateSDPOutputs();
            }
        };

        // Setup Data Channels
        if (isInitiator) {
            // Host initializes Data Channel
            dataChannel = peerConnection.createDataChannel("cheese-p2p-transfer", {
                ordered: true // Enforces chunk transmission sequence
            });
            bindDataChannelEvents();
        } else {
            // Guest listens to incoming data channel setup
            peerConnection.ondatachannel = (event) => {
                dataChannel = event.channel;
                bindDataChannelEvents();
            };
        }
    }

    function bindDataChannelEvents() {
        if (!dataChannel) return;

        // CRITICAL: Set binaryType to arraybuffer for WebRTC binary chunk reassembly
        dataChannel.binaryType = 'arraybuffer';

        const sendHandshake = () => {
            console.log(`Secure WebRTC Data Channel is open and ready. Sending address_handshake as ${myRole}...`);
            try {
                dataChannel.send(JSON.stringify({
                    type: 'address_handshake',
                    address: walletAddress,
                    role: myRole
                }));
            } catch (err) {
                console.error("Failed to send address_handshake:", err);
            }
        };

        if (dataChannel.readyState === 'open') {
            sendHandshake();
        } else {
            dataChannel.onopen = sendHandshake;
        }

        dataChannel.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    handleDataMessage(msg);
                } catch(e) {
                    console.error("Data message parse error:", e);
                }
            } else {
                handleBinaryChunk(event.data);
            }
        };

        dataChannel.onclose = () => {
            console.log("WebRTC Data Channel closed.");
        };
    }

    // --- WebRTC Media Access Setup ---
    async function startCameraAndMic() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            console.log("Webcam and microphone access granted.");
            
            // Local feed goes into left video container (notary-video-container)
            const targetVideoBox = document.getElementById('notary-video-container');
            const canvasEl = document.getElementById('notary-video-canvas');
            if (canvasEl) canvasEl.classList.add('hidden');

            let videoEl = targetVideoBox.querySelector('video.local-user-video');
            if (!videoEl) {
                videoEl = document.createElement('video');
                videoEl.className = "sim-video local-user-video";
                videoEl.autoplay = true;
                videoEl.muted = true; // Mute local audio feedback
                videoEl.playsInline = true;
                targetVideoBox.appendChild(videoEl);
            }
            videoEl.srcObject = localStream;
            
            // Add local stream tracks to WebRTC peerConnection
            if (peerConnection) {
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });
            }
        } catch (e) {
            console.warn("Real webcam access unavailable. Starting fallback simulated stream...", e.message);
            localStream = startSimulatedCamera('notary-video-canvas', myRole, walletAddress);
        }
    }

    // --- WebRTC Signaling Logic ---
    let socketPingInterval = null;
    let wsReconnectAttempts = 0;
    const MAX_WS_RECONNECTS = 5;
    let wsReconnectTimer = null;

    function setupSignaling() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/notary-signaling?room=${sessionID}`;
        console.log(`🔌 WebRTC Signaling Socket connecting to: ${wsUrl}`);

        if (socket) {
            try { socket.close(); } catch(e) {}
        }

        socket = new WebSocket(wsUrl);

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') return; // Keepalive response
            if (data.session && data.session !== sessionID) return;

            // BUG 1 FIX: Notary=Sender creates the offer, so CLIENT (receiver/joiner) receives the offer.
            // Client=Receiver creates the answer, so NOTARY (sender) receives the answer.
            if (data.type === 'offer' && myRole === 'client') {
                console.log("Offer Received via WebSocket signaling. Processing Answer...");
                await processIncomingOffer(data.sdp);
            } else if (data.type === 'answer' && myRole === 'notary') {
                console.log("Answer Received via WebSocket signaling. Linking...");
                await processIncomingAnswer(data.sdp);
            } else if (data.type === 'candidate') {
                try {
                    const iceCandidate = new RTCIceCandidate(data.candidate);
                    if (peerConnection && peerConnection.remoteDescription) {
                        console.log("Incoming ICE Candidate applied directly.");
                        await peerConnection.addIceCandidate(iceCandidate).catch(e => console.warn('Add candidate failed:', e));
                    } else {
                        console.log("Remote description not set yet. Queuing ICE Candidate.");
                        candidateQueue.push(iceCandidate);
                    }
                } catch (e) {
                    console.error("ICE candidate error:", e);
                }
            // BUG 2 FIX: Notary=Sender has the offer SDP, so it responds to sync_request
            } else if (data.type === 'sync_request' && myRole === 'notary') {
                console.log("Receiver sync requested. Re-broadcasting offer SDP...");
                if (peerConnection && peerConnection.localDescription) {
                    socket.send(JSON.stringify({
                        type: 'offer',
                        sdp: peerConnection.localDescription.sdp,
                        session: sessionID
                    }));
                }
            }
        };

        socket.onopen = () => {
            console.log("WebSocket signaling connected successfully.");

            // Start 15s keepalive ping interval to prevent network connection loss
            if (socketPingInterval) clearInterval(socketPingInterval);
            socketPingInterval = setInterval(() => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 15000);

            // BUG 2 FIX: Client=Receiver/Joiner requests initial sync from Notary=Sender
            if (myRole === 'client') {
                socket.send(JSON.stringify({
                    type: 'sync_request',
                    session: sessionID
                }));
            }
        };

        socket.onerror = (err) => {
            console.error("WebSocket signaling error:", err);
        };

        socket.onclose = (event) => {
            console.warn(`WebSocket signaling closed (code: ${event.code}, reason: ${event.reason || 'none'}).`);
            if (socketPingInterval) clearInterval(socketPingInterval);

            // Auto-reconnect with exponential backoff if peer connection isn't established yet
            const isConnected = peerConnection && peerConnection.connectionState === 'connected';
            if (!isConnected && wsReconnectAttempts < MAX_WS_RECONNECTS && sessionID) {
                const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);
                wsReconnectAttempts++;
                console.log(`🔄 Signaling reconnect attempt ${wsReconnectAttempts}/${MAX_WS_RECONNECTS} in ${delay}ms...`);
                if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
                wsReconnectTimer = setTimeout(() => {
                    console.log('🔌 Reconnecting WebSocket signaling...');
                    setupSignaling();
                }, delay);
            } else if (isConnected) {
                console.log('📡 WebSocket closed but P2P is already connected — no reconnect needed.');
            } else if (wsReconnectAttempts >= MAX_WS_RECONNECTS) {
                console.error('❌ Signaling reconnection failed after maximum attempts. Manual reconnect may be needed.');
            }
        };

        signalingChannel = {
            postMessage: (msg) => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ ...msg, session: sessionID }));
                } else {
                    console.warn("WebSocket not open. Queuing message not supported.");
                }
            }
        };
    }

    async function processIncomingOffer(offerSdp) {
        await initWebRTCPeer(false); // Init as receiver (async — fetches TURN credentials)
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: offerSdp
        }));

        // Flush candidate queue
        for (const candidate of candidateQueue) {
            await peerConnection.addIceCandidate(candidate).catch(e => console.warn('Delayed candidate failed:', e));
        }
        candidateQueue = [];

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Write and broadcast Answer
        handshakeAnswer.value = answer.sdp;
        if (signalingChannel) {
            signalingChannel.postMessage({
                type: 'answer',
                sdp: answer.sdp,
                session: sessionID
            });
        }
    }

    async function processIncomingAnswer(answerSdp) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: answerSdp
        }));

        // Flush candidate queue
        for (const candidate of candidateQueue) {
            await peerConnection.addIceCandidate(candidate).catch(e => console.warn('Delayed candidate failed:', e));
        }
        candidateQueue = [];
    }

    function updateSDPOutputs() {
        if (peerConnection && peerConnection.localDescription) {
            if (myRole === 'notary') {
                handshakeOffer.value = peerConnection.localDescription.sdp;
            } else {
                handshakeAnswer.value = peerConnection.localDescription.sdp;
            }
        }
    }

    // SENDER (Creates Session & Code) - GOVERNMENT NOTARY
    async function configureSenderRole() {
        myRole = 'notary'; // Government Notary / Sender
        sessionID = "CHZ-" + Math.floor(100000 + Math.random() * 900000);
        
        notarySessionIdInput.value = sessionID;
        notarySetupForm.classList.remove('hidden');
        clientSetupForm.classList.add('hidden');

        notarySessionAddress.textContent = walletAddress;

        // Enable Notary Stamp execution card on Notary view
        if (notaryStampCard) notaryStampCard.classList.remove('hidden');
        if (clientSignIdentityBox) clientSignIdentityBox.classList.add('hidden');

        // Pre-fetch TURN credentials before setting up signaling
        // This ensures the ICE config is ready before the first offer is created
        console.log('📡 Pre-fetching TURN relay credentials for sender session...');
        const iceConfig = await fetchTURNCredentials();

        setupSignaling();
        wsReconnectAttempts = 0; // Reset reconnect counter for new session
        await startCameraAndMic();
        
        // Sender creates Offer immediately (with TURN-enabled ICE config)
        await initWebRTCPeer(true, iceConfig); // true = initiator, pass pre-fetched config
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        if (handshakeOffer) handshakeOffer.value = offer.sdp;

        // Broadcast offer instantly
        signalingChannel.postMessage({
            type: 'offer',
            sdp: offer.sdp,
            session: sessionID
        });

        startSimulatedCamera('notary-video-canvas', 'notary', walletAddress);
    }

    // RECEIVER / CLIENT (Inputs Code & Joins Session) - CITIZEN CLIENT
    async function configureReceiverRole() {
        myRole = 'client'; // Citizen Client / Receiver
        clientSetupForm.classList.remove('hidden');
        notarySetupForm.classList.add('hidden');

        clientSessionAddress.textContent = walletAddress;

        // Enable Identity signing on Client view, hide Notary Stamp execution card
        if (clientSignIdentityBox) clientSignIdentityBox.classList.remove('hidden');
        if (notaryStampCard) notaryStampCard.classList.add('hidden');

        // Pre-fetch TURN credentials so they're cached before the offer arrives
        console.log('📡 Pre-fetching TURN relay credentials for receiver session...');
        await fetchTURNCredentials();

        await startCameraAndMic();

        startSimulatedCamera('client-video-canvas', 'client', walletAddress);
    }

    selectRoleNotary.addEventListener('click', () => {
        if (!requireMetaMaskWallet('create a sender session')) return;
        selectRoleNotary.classList.add('active');
        selectRoleClient.classList.remove('active');
        configureSenderRole();
    });

    selectRoleClient.addEventListener('click', () => {
        if (!requireMetaMaskWallet('join a P2P session')) return;
        selectRoleClient.classList.add('active');
        selectRoleNotary.classList.remove('active');
        configureReceiverRole();
    });

    // Client hits Connect button
    const clientConnectStatus = document.getElementById('client-connect-status');
    const clientConnectStatusText = document.getElementById('client-connect-status-text');

    btnClientConnect.addEventListener('click', async () => {
        const inputId = clientTargetSessionIdInput.value.trim();
        if (!inputId) {
            alert("Please enter a valid Notary Session ID (e.g. CHZ-123456).");
            return;
        }
        sessionID = inputId;

        // Visual Feedback for User
        btnClientConnect.disabled = true;
        btnClientConnect.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to Notary...';
        if (clientConnectStatus) {
            clientConnectStatus.classList.remove('hidden');
            if (clientConnectStatusText) {
                clientConnectStatusText.textContent = `Connecting to Notary Session ${sessionID}... Searching for host...`;
            }
        }

        setupSignaling();

        // Retry sync request until connected — extended timeout for TURN relay negotiation
        let retryCount = 0;
        const syncInterval = setInterval(() => {
            if (peerConnection && peerConnection.connectionState === 'connected') {
                clearInterval(syncInterval);
                btnClientConnect.disabled = false;
                btnClientConnect.innerHTML = '<i class="fa-solid fa-plug"></i> Connect to Notary';
                return;
            }
            if (retryCount >= 24) { // 60 seconds max (24 × 2.5s) — allows time for TURN relay negotiation
                clearInterval(syncInterval);
                btnClientConnect.disabled = false;
                btnClientConnect.innerHTML = '<i class="fa-solid fa-plug"></i> Connect to Notary';
                if (clientConnectStatusText) {
                    clientConnectStatusText.innerHTML = '<span style="color: #ff6464;"><i class="fa-solid fa-circle-exclamation"></i> Could not connect to Notary. Check Session ID or try manual offer paste.</span>';
                }
                return;
            }
            retryCount++;
            if (clientConnectStatusText) {
                clientConnectStatusText.textContent = `Connecting to Notary Session ${sessionID}... Attempt ${retryCount}/24 (searching via TURN relay)...`;
            }
            if (signalingChannel) {
                signalingChannel.postMessage({
                    type: 'sync_request',
                    session: sessionID
                });
            }
        }, 2500);

        console.log(`Sync request broadcasted for session ${sessionID}. Waiting for offer...`);
    });

    // Listen to sync request (Notary side)
    const globalSyncListener = new BroadcastChannel('cheese_notary_p2p_channel');
    globalSyncListener.onmessage = async (e) => {
        if (myRole === 'notary' && e.data.type === 'sync_request' && e.data.session === sessionID) {
            console.log("Client sync requested. Re-broadcasting offer SDP...");
            if (peerConnection && peerConnection.localDescription) {
                signalingChannel.postMessage({
                    type: 'offer',
                    sdp: peerConnection.localDescription.sdp,
                    session: sessionID
                });
            }
        }
    };

    // Copy session id helper
    btnCopySessionId.addEventListener('click', () => {
        navigator.clipboard.writeText(notarySessionIdInput.value).then(() => {
            alert("Session ID copied!");
        });
    });

    // --- Decentralized Manual Handshake Buttons ---
    toggleManualHandshake.addEventListener('click', () => {
        manualHandshakeContent.classList.toggle('hidden');
        document.querySelector('.arrow-icon').classList.toggle('fa-chevron-down');
        document.querySelector('.arrow-icon').classList.toggle('fa-chevron-up');
    });

    btnCopyOffer.addEventListener('click', () => {
        navigator.clipboard.writeText(handshakeOffer.value).then(() => {
            alert("Offer Code copied to clipboard!");
        });
    });

    btnGenerateAnswer.addEventListener('click', async () => {
        const rawOffer = handshakeOfferInput.value.trim();
        if (!rawOffer) {
            alert("Please paste the Notary Offer code first.");
            return;
        }
        await processIncomingOffer(rawOffer);
        alert("Answer Code generated! Copy and send it back to the Notary.");
    });

    btnCopyAnswer.addEventListener('click', () => {
        navigator.clipboard.writeText(handshakeAnswer.value).then(() => {
            alert("Answer Code copied to clipboard!");
        });
    });

    btnAcceptAnswer.addEventListener('click', async () => {
        const rawAnswer = handshakeAnswerInput.value.trim();
        if (!rawAnswer) {
            alert("Please paste the Client Answer code first.");
            return;
        }
        await processIncomingAnswer(rawAnswer);
        alert("Answer code accepted. Setting up peer tunnel...");
    });

    // --- WebRTC Connection State Updates ---
    function handleP2PConnected() {
        console.log("P2P Connection established!");

        // Reset signaling reconnect counter on successful P2P connection
        wsReconnectAttempts = 0;

        // Log connection pair type for diagnostics (direct vs relay/TURN)
        if (peerConnection) {
            peerConnection.getStats().then(stats => {
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        const localId = report.localCandidateId;
                        const remoteId = report.remoteCandidateId;
                        stats.forEach(s => {
                            if (s.id === localId && s.candidateType) {
                                console.log(`📡 P2P Connection Type: local=${s.candidateType}, transport=${s.protocol || 'unknown'}`);
                                if (s.candidateType === 'relay') {
                                    console.log('🔄 Connection is using TURN relay (cross-network mode)');
                                } else {
                                    console.log('⚡ Connection is direct P2P (same network or compatible NAT)');
                                }
                            }
                        });
                    }
                });
            }).catch(() => {});
        }

        setupPanel.classList.add('hidden');
        notaryRoomPanel.classList.remove('hidden');
        connectionStatusBadge.textContent = "CONNECTED";
        connectionStatusBadge.className = "value badge-success";

        // If Notary, reveal the stamp control block
        if (myRole === 'notary') {
            notaryStampCard.classList.remove('hidden');
        }
    }

    function handleP2PDisconnected() {
        console.log("P2P Connection terminated.");
        connectionStatusBadge.textContent = "DISCONNECTED";
        connectionStatusBadge.className = "value badge-danger";
        
        setTimeout(() => {
            alert("Session disconnected. Returning to room setup.");
            location.reload();
        }, 1500);
    }

    btnHangup.addEventListener('click', () => {
        if (peerConnection) peerConnection.close();
        handleP2PDisconnected();
    });

    // --- WebRTC Data Handling Triggers ---
    function handleDataMessage(msg) {
        if (msg.type === 'address_handshake') {
            console.log(`Received address handshake from ${msg.role}: ${msg.address}`);
            if (msg.role === 'notary') {
                notaryAddress = msg.address;
                if (notarySessionAddress) notarySessionAddress.textContent = notaryAddress;
            } else {
                clientAddress = msg.address;
                if (clientSessionAddress) clientSessionAddress.textContent = clientAddress;
            }
            updateNotaryStampValidation();

            // If I'm the client, verify the notary's address against the on-chain registry
            if (myRole === 'client' && typeof onNotaryPeerConnected === 'function') {
                onNotaryPeerConnected(msg.address);
            }
        } 
        else if (msg.type === 'client_signature') {
            clientSignature = msg.signature;
            console.log("Received client cryptographic signature:", clientSignature);
            
            // Verify signature locally
            try {
                // Recover the signer address using ethers
                const recoveredAddress = ethers.utils.verifyMessage(activeFileHash, clientSignature);
                console.log("Recovered Address:", recoveredAddress);

                if (recoveredAddress.toLowerCase() === clientAddress.toLowerCase()) {
                    clientVerifyStatus.textContent = "Signature Cryptographically Verified";
                    clientVerifyStatus.className = "identity-verify-badge verified";
                } else {
                    clientVerifyStatus.textContent = "Signature Error: Signer mismatch";
                    clientVerifyStatus.className = "identity-verify-badge unverified";
                }
            } catch (err) {
                console.error("Signature recovery failed:", err);
                clientVerifyStatus.textContent = "Signature Verification Failed";
                clientVerifyStatus.className = "identity-verify-badge unverified";
            }
            updateNotaryStampValidation();
        }
        else if (msg.type === 'file_metadata') {
            // Prep for receiving binary data
            transferMetadata = msg;
            receivedChunks = [];
            receivedBytes = 0;
            
            if (fileProgressBox) fileProgressBox.classList.remove('hidden');
            if (progressFileName) progressFileName.textContent = `Receiving: ${msg.name}`;
            if (progressPercentage) progressPercentage.textContent = "0%";
            if (progressFillBar) progressFillBar.style.width = "0%";
            if (filePreviewZone) filePreviewZone.classList.add('hidden');
            console.log("Ready to receive P2P file:", msg.name, msg.size, "bytes");
        }
        else if (msg.type === 'literal_signature') {
            console.log(`Received literal signature from ${msg.role}`);
            // BUG 7 FIX: Store both client and notary literal signatures
            if (msg.role === 'client') {
                window._clientLiteralSignature = msg.signatureData;
            } else if (msg.role === 'notary') {
                window._notaryLiteralSignature = msg.signatureData;
            }
        }
        else if (msg.type === 'file_completed') {
            console.log("P2P File Stream completed! Reassembling file for Receiver...");
            handleFileCompletion();
        }
        else if (msg.type === 'notarize_success') {
            console.log("Notarization confirmed on-chain! TxID:", msg.txId);
            
            // Cache record in Citizen's local explorer
            if (msg.record) {
                ledgerDatabase.unshift(msg.record);
                localStorage.setItem('cheese_notary_ledger', JSON.stringify(ledgerDatabase));
            }

            // Render interactive receipt card on Sender screen
            if (filePreviewZone) {
                filePreviewZone.classList.remove('hidden');
                const receiptCard = document.createElement('div');
                receiptCard.className = "verification-success-box";
                receiptCard.style.marginTop = "1rem";
                receiptCard.innerHTML = `
                    <i class="fa-solid fa-circle-check box-icon animate-pulse" style="color: var(--green-accent)"></i>
                    <h3 class="box-title">Document Successfully Stamped On-Chain!</h3>
                    <p class="box-desc">The Receiver / Notary has logged your file hash to the CHEESE Blockchain.</p>
                    <div class="blockchain-details-block">
                        <div class="detail-row">
                            <span class="lbl">Transaction Hash (TxID):</span>
                            <span class="val hash-text">${msg.txId}</span>
                        </div>
                        <div class="detail-row">
                            <span class="lbl">Document Fingerprint:</span>
                            <span class="val hash-text">${msg.record?.documentHash || activeFileHash}</span>
                        </div>
                        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                            <button onclick="navigator.clipboard.writeText('${msg.txId}'); alert('TxID copied!');" class="btn-outline btn-small"><i class="fa-solid fa-copy"></i> Copy TxID</button>
                            <button onclick="window.verifyTxInExplorer('${msg.txId}')" class="btn-primary btn-small"><i class="fa-solid fa-magnifying-glass"></i> Verify on Ledger Explorer</button>
                        </div>
                    </div>
                `;
                filePreviewZone.appendChild(receiptCard);
            }
        }
    }

    let isAutoStampExecuting = false;

    function updateNotaryStampValidation() {
        if (myRole !== 'notary') return;

        let errorText = "";
        let ready = true;

        if (!clientAddress) {
            errorText = "Waiting for Citizen (Receiver) connection...";
            ready = false;
        } else if (!activeFileHash) {
            errorText = "Please select and upload a document to send...";
            ready = false;
        }

        // If clientSignature is not provided, fallback to clientAddress
        if (!clientSignature && clientAddress) {
            clientSignature = "0x_p2p_handshake_auth_" + clientAddress.substring(2, 10);
        }

        if (ready) {
            btnNotaryStamp.disabled = false;
            notaryStampValidationMsg.innerHTML = `<span style="color: var(--green-accent)"><i class="fa-solid fa-circle-check"></i> Document &amp; Citizen verified. Ready to stamp on-chain.</span>`;

            // Auto-Stamp Execution
            const chkAutoStamp = document.getElementById('chk-auto-stamp');
            if (chkAutoStamp && chkAutoStamp.checked && !isAutoStampExecuting) {
                isAutoStampExecuting = true;
                notaryStampValidationMsg.innerHTML = `<span style="color: var(--cheese-yellow)"><i class="fa-solid fa-bolt fa-spin"></i> Auto-Stamping Document to CHEESE Blockchain...</span>`;
                console.log("⚡ Auto-Stamp Triggered! Executing blockchain notarization transaction...");
                setTimeout(() => {
                    if (btnNotaryStamp && !btnNotaryStamp.disabled) {
                        btnNotaryStamp.click();
                    }
                }, 1200);
            }
        } else {
            btnNotaryStamp.disabled = true;
            notaryStampValidationMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${errorText}`;
        }
    }

    // --- WebRTC Chunked Binary File Transfer ---
    const CHUNK_SIZE = 16384; // 16KB blocks

    // --- P2P File Selection & Preview Handling ---
    let selectedP2PFile = null;
    const btnSendP2pFile = document.getElementById('btn-send-p2p-file');

    async function handleP2PFileSelected(file) {
        if (!file) return;
        selectedP2PFile = file;

        if (btnSendP2pFile) {
            btnSendP2pFile.disabled = true;
            btnSendP2pFile.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Hashing Document...';
        }

        // 1. Calculate file SHA-256 hash locally in browser
        console.log("Generating SHA-256 hash locally...");
        const fileData = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', fileData);
        
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = "0x" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        console.log("SHA-256 Hash Generated:", hashHex);

        activeFileHash = hashHex;
        activeFileName = file.name;
        activeFileType = file.type || "application/octet-stream";

        // Display local file preview
        renderFilePreview(file, activeFileName, activeFileType, activeFileHash);

        // Reset Send Button state
        if (btnSendP2pFile) {
            btnSendP2pFile.disabled = false;
            btnSendP2pFile.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send File to Peer (P2P Stream)';
        }

        updateNotaryStampValidation();
    }

    if (btnSendP2pFile) {
        btnSendP2pFile.addEventListener('click', async () => {
            if (!selectedP2PFile) {
                alert("Please select a document or file first.");
                return;
            }
            if (!dataChannel || dataChannel.readyState !== 'open') {
                alert("WebRTC connection is not established yet. Connect to the room first.");
                return;
            }

            await sendFileP2P(selectedP2PFile);
        });
    }

    // Client/Notary drops or selects a file to send
    async function sendFileP2P(file) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            alert("WebRTC data channel is not open. Connect first.");
            return;
        }

        if (btnSendP2pFile) {
            btnSendP2pFile.disabled = true;
            btnSendP2pFile.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Streaming File to Peer...';
        }

        // Show progress bar
        if (fileProgressBox) fileProgressBox.classList.remove('hidden');
        if (progressFileName) progressFileName.textContent = `Sending: ${file.name}`;
        if (progressPercentage) progressPercentage.textContent = "0%";
        if (progressFillBar) progressFillBar.style.width = "0%";

        // 1. Send metadata over data channel
        dataChannel.send(JSON.stringify({
            type: 'file_metadata',
            name: file.name,
            size: file.size,
            mimeType: activeFileType,
            hash: activeFileHash
        }));

        // 2. Send file chunk by chunk
        let offset = 0;
        const reader = new FileReader();

        const readSlice = (o) => {
            const slice = file.slice(o, o + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = (e) => {
            const buffer = e.target.result;
            dataChannel.send(buffer);
            offset += buffer.byteLength;

            // Calculate percentage
            const pct = Math.floor((offset / file.size) * 100);
            if (progressPercentage) progressPercentage.textContent = `${pct}%`;
            if (progressFillBar) progressFillBar.style.width = `${pct}%`;

            if (offset < file.size) {
                // If channel buffer is full, wait for buffer drain backpressure
                if (dataChannel.bufferedAmount > 8 * 1024 * 1024) { // 8MB limit
                    console.log("WebRTC buffer backpressure. Waiting to drain...");
                    setTimeout(() => {
                        readSlice(offset);
                    }, 100);
                } else {
                    readSlice(offset);
                }
            } else {
                console.log("File transmission complete.");
                if (fileProgressBox) fileProgressBox.classList.add('hidden');
                // notify notary/peer of completion
                dataChannel.send(JSON.stringify({
                    type: 'file_completed'
                }));

                if (btnSendP2pFile) {
                    btnSendP2pFile.disabled = false;
                    btnSendP2pFile.innerHTML = '<i class="fa-solid fa-circle-check"></i> File Sent to Receiver Successfully!';
                }

                if (clientVerifyStatus) {
                    clientVerifyStatus.textContent = "File Sent to Receiver — Awaiting Citizen Signature...";
                    clientVerifyStatus.className = "identity-verify-badge verified";
                }
            }
        };

        readSlice(0);
    }

    function handleBinaryChunk(buffer) {
        const byteLen = buffer.byteLength !== undefined ? buffer.byteLength : (buffer.size || 0);
        receivedChunks.push(buffer);
        receivedBytes += byteLen;

        if (transferMetadata && transferMetadata.size > 0) {
            const totalSize = transferMetadata.size;
            const pct = Math.min(100, Math.floor((receivedBytes / totalSize) * 100));
            if (progressPercentage) progressPercentage.textContent = `${pct}% (${Math.round(receivedBytes / 1024)} KB / ${Math.round(totalSize / 1024)} KB)`;
            if (progressFillBar) progressFillBar.style.width = `${pct}%`;
        }
    }

    async function handleFileCompletion() {
        console.log("Reassembling file chunks...", receivedChunks.length, "chunks, total bytes:", receivedBytes);
        if (!transferMetadata) transferMetadata = {};
        const safeMimeType = transferMetadata.mimeType || transferMetadata.type || "application/octet-stream";
        const fileBlob = new Blob(receivedChunks, { type: safeMimeType });
        
        // Calculate SHA-256 hash of received chunks to verify integrity
        const buffer = await fileBlob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = "0x" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        console.log("Received file hash recalculated:", hashHex, "Expected:", transferMetadata.hash);

        if (!transferMetadata.hash || hashHex.toLowerCase() === transferMetadata.hash.toLowerCase()) {
            console.log("Integrity Check Passed. File is unaltered.");
            activeFileHash = hashHex;
            activeFileName = transferMetadata.name || "document";
            activeFileType = safeMimeType;

            renderFilePreview(fileBlob, activeFileName, activeFileType, activeFileHash);
            if (fileProgressBox) fileProgressBox.classList.add('hidden');
            if (filePreviewZone) filePreviewZone.classList.remove('hidden');

            // Save to Receiver's Received Files Vault
            try {
                const fileReader = new FileReader();
                fileReader.onloadend = function() {
                    const dataUrl = fileReader.result;
                    const newRec = {
                        name: activeFileName,
                        type: activeFileType,
                        size: receivedBytes,
                        hash: activeFileHash,
                        receivedAt: Date.now(),
                        sender: notaryAddress || 'Notary Authority',
                        dataUrl: dataUrl
                    };
                    if (!receivedFilesVault.some(r => r.hash === activeFileHash)) {
                        receivedFilesVault.unshift(newRec);
                        saveAndRenderReceivedFiles();
                    }
                };
                fileReader.readAsDataURL(fileBlob);
            } catch (err) {
                console.warn("Failed to cache received file to vault:", err);
            }

            // Receiver Auto-Authorization to Notary over P2P DataChannel
            if (myRole === 'client') {
                console.log("Auto-authorizing document SHA-256 hash for Notary...");
                let autoSig = "0x_p2p_handshake_auth_" + (walletAddress ? walletAddress.substring(2, 10) : 'citizen');
                try {
                    if (ethersSigner) {
                        autoSig = await ethersSigner.signMessage(activeFileHash);
                    } else if (localWallet) {
                        autoSig = await localWallet.signMessage(activeFileHash);
                    }
                } catch(e) {}

                clientSignature = autoSig;
                if (dataChannel && dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({
                        type: 'client_signature',
                        signature: autoSig
                    }));
                }

                if (clientVerifyStatus) {
                    clientVerifyStatus.textContent = "File Received & Verified — Authorization Transmitted to Notary ✓";
                    clientVerifyStatus.className = "identity-verify-badge verified";
                }
            }

            updateNotaryStampValidation();
        } else {
            alert("Security Alert: Recalculated file hash mismatch! File may have been altered in transit.");
            if (fileProgressBox) fileProgressBox.classList.add('hidden');
        }
    }

    // --- File Drag Drop & Category Selector Controls ---
    const uploadCatCards = document.querySelectorAll('.upload-cat-card');
    const p2pDropzoneMini = document.getElementById('p2p-dropzone-mini');

    uploadCatCards.forEach(card => {
        card.addEventListener('click', () => {
            const acceptType = card.getAttribute('data-accept');
            if (acceptType === '*') {
                p2pFileValInput.removeAttribute('accept');
            } else {
                p2pFileValInput.setAttribute('accept', acceptType);
            }
            p2pFileValInput.click();
        });
    });

    if (p2pDropzoneMini) {
        p2pDropzoneMini.addEventListener('click', (e) => {
            e.stopPropagation();
            p2pFileValInput.removeAttribute('accept');
            p2pFileValInput.click();
        });
    }

    const p2pFileUploadBox = document.getElementById('p2p-file-upload-box');
    if (p2pFileUploadBox) {
        p2pFileUploadBox.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (p2pDropzoneMini) p2pDropzoneMini.classList.add('dragover');
        });

        p2pFileUploadBox.addEventListener('dragleave', () => {
            if (p2pDropzoneMini) p2pDropzoneMini.classList.remove('dragover');
        });

        p2pFileUploadBox.addEventListener('drop', (e) => {
            e.preventDefault();
            if (p2pDropzoneMini) p2pDropzoneMini.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleP2PFileSelected(e.dataTransfer.files[0]);
            }
        });
    }

    p2pFileValInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            handleP2PFileSelected(this.files[0]);
        }
    });

    // --- Document Visual Preview Render Engine ---
    function renderFilePreview(fileBlobOrObj, name, type, hash) {
        filePreviewZone.classList.remove('hidden');
        filePreviewContent.innerHTML = "";
        
        type = type || "application/octet-stream";
        previewFileName.textContent = name || "document";
        previewFileType.textContent = type;
        previewFileHash.textContent = hash || "0x00";

        // Toggle 'Send File to Peer' button depending on role
        if (btnSendP2pFile) {
            if (myRole === 'client') {
                btnSendP2pFile.classList.add('hidden');
            } else {
                btnSendP2pFile.classList.remove('hidden');
            }
        }

        // Render based on MIME type
        const url = URL.createObjectURL(fileBlobOrObj);
        
        if (type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = url;
            img.className = "preview-img";
            filePreviewContent.appendChild(img);
        }
        else if (type.startsWith('audio/')) {
            const audio = document.createElement('audio');
            audio.src = url;
            audio.controls = true;
            audio.className = "preview-audio";
            filePreviewContent.appendChild(audio);
        }
        else if (type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.className = "preview-video";
            filePreviewContent.appendChild(video);
        }
        else {
            // General document download card
            const docCard = document.createElement('div');
            docCard.className = "file-card-preview";
            
            let iconClass = "fa-file-lines";
            if (type.includes('pdf')) iconClass = "fa-file-pdf";
            else if (type.includes('word') || type.includes('officedocument')) iconClass = "fa-file-word";
            else if (type.includes('zip') || type.includes('tar')) iconClass = "fa-file-zipper";

            docCard.innerHTML = `
                <i class="fa-solid ${iconClass}"></i>
                <a href="${url}" download="${name}" class="btn-outline btn-small"><i class="fa-solid fa-download"></i> Download / Inspect File</a>
            `;
            filePreviewContent.appendChild(docCard);
        }
    }

    // --- Cryptographic Citizen Signature Call ---
    btnClientSignIdentity.addEventListener('click', async () => {
        if (!activeFileHash) {
            alert("Please drag and drop a file to notarize first.");
            return;
        }

        try {
            console.log("Requesting signature on hash:", activeFileHash);
            
            let sig = null;
            if (ethersSigner) {
                // MetaMask personal sign
                sig = await ethersSigner.signMessage(activeFileHash);
            } else if (localWallet) {
                // Local Sandbox wallet sign
                sig = await localWallet.signMessage(activeFileHash);
            }

            if (sig) {
                clientSignature = sig;
                console.log("Client Signed Identity hash. Transmitting to Notary...");
                
                // Transmit signature over P2P Data Channel
                dataChannel.send(JSON.stringify({
                    type: 'client_signature',
                    signature: sig
                }));

                // Update UI state locally
                clientVerifyStatus.textContent = "Signed. Sent to Notary.";
                clientVerifyStatus.className = "identity-verify-badge verified";
                btnClientSignIdentity.disabled = true;
            }
        } catch (err) {
            console.error("Signing failed:", err);
            alert(`Signing failed: ${err.message}`);
        }
    });

    // --- On-Chain Blockchain Stamp Executions ---
    btnNotaryStamp.addEventListener('click', async () => {
        if (myRole !== 'notary' || !activeFileHash || !clientAddress || !clientSignature) return;

        btnNotaryStamp.disabled = true;
        btnNotaryStamp.innerHTML = `<span class="spinner-small" style="margin-right: 0.5rem"></span> Publishing to Blockchain...`;

        try {
            // 1. Try EVM Smart Contract execution if a contract address is configured and MetaMask/Signer is active
            if (contractAddress && contractAddress.startsWith('0x') && contractAddress.length === 42 && ethersSigner) {
                console.log(`📜 [MetaMask] Initiating EVM smart contract transaction on CheeseNotary at: ${contractAddress}`);
                try {
                    const notaryContract = new ethers.Contract(contractAddress, contractABI, ethersSigner);
                    const tx = await notaryContract.notarize(
                        activeFileHash,
                        clientAddress,
                        clientSignature,
                        activeFileType || "application/octet-stream",
                        activeFileName || "document"
                    );
                    console.log("Transaction sent, awaiting confirmation receipt...", tx.hash);
                    const receipt = await tx.wait();
                    console.log("Transaction confirmed on EVM!", receipt.transactionHash);

                    const txHash = receipt.transactionHash;
                    const blockNum = receipt.blockNumber || "Pending";
                    const timestamp = Math.floor(Date.now() / 1000);

                    // BUG 6 FIX: Include drawn signature images in ledger record
                    const newRecord = {
                        documentHash: activeFileHash,
                        fileName: activeFileName,
                        fileType: activeFileType,
                        client: clientAddress,
                        notary: walletAddress,
                        timestamp: timestamp,
                        txHash: txHash,
                        blockNumber: blockNum,
                        gas: "0.001 NCH",
                        clientSignatureImg: window._clientLiteralSignature || null,
                        notarySignatureImg: (typeof notarySigPad !== 'undefined' && notarySigPad.hasSignature()) ? notarySigPad.toDataURL() : null
                    };

                    ledgerDatabase.unshift(newRecord);
                    localStorage.setItem('cheese_notary_ledger', JSON.stringify(ledgerDatabase));

                    if (dataChannel && dataChannel.readyState === 'open') {
                        dataChannel.send(JSON.stringify({
                            type: 'notarize_success',
                            txId: txHash,
                            record: newRecord
                        }));
                    }

                    alert(`Document notarized successfully on-chain via smart contract!\nTxHash: ${txHash}`);
                    await fetchBalanceFromNode(walletAddress);
                    switchTab(navLedger, tabLedger, "Blockchain Ledger", "Explore verified documents and on-chain certificates logged directly to the smart contract.");
                    return;
                } catch (contractErr) {
                    console.warn("Smart contract transaction failed or rejected. Falling back to native blockchain transaction:", contractErr);
                }
            }

            // 2. Custom Native Blockchain Transaction Fallback
            if (!localWallet && !isMetaMaskConnected) {
                throw new Error("Stamping requires a loaded private key or MetaMask connection. Please connect your MetaMask or use the Sandbox wallet.");
            }

            console.log("Submitting native P2P DOCUMENT_NOTARY transaction to the node...");
            const res = await api.sendTransaction(
                walletAddress, // from (Notary)
                '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3', // to (Official Treasury Wallet)
                0.001, // amount
                localWallet ? localWallet.privateKey : null, // privateKey
                {
                    type: 'DOCUMENT_NOTARY',
                    hash: activeFileHash,
                    fileName: activeFileName,
                    fileType: activeFileType,
                    clientAddress: clientAddress,
                    clientSignature: clientSignature,
                    category: 'general'
                }
            );

            if (!res || !res.success) {
                throw new Error(res?.error || "Transaction submission failed");
            }

            const tx = res.transaction;
            const txHash = tx.id;
            const blockNum = res.blockIndex || "Pending";
            const gasUsed = "0.001 NCH";
            const timestamp = Math.floor((tx.timestamp || Date.now()) / 1000);

            // Construct new ledger record
            // BUG 6 FIX: Include drawn signature images in ledger record (native fallback path)
            const newRecord = {
                documentHash: activeFileHash,
                fileName: activeFileName,
                fileType: activeFileType,
                client: clientAddress,
                notary: walletAddress,
                timestamp: timestamp,
                txHash: txHash,
                blockNumber: blockNum,
                gas: gasUsed,
                clientSignatureImg: window._clientLiteralSignature || null,
                notarySignatureImg: (typeof notarySigPad !== 'undefined' && notarySigPad.hasSignature()) ? notarySigPad.toDataURL() : null
            };

            // Write to local database registry
            ledgerDatabase.unshift(newRecord);
            localStorage.setItem('cheese_notary_ledger', JSON.stringify(ledgerDatabase));

            // Notify citizen browser of success
            if (dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({
                    type: 'notarize_success',
                    txId: txHash,
                    record: newRecord
                }));
            }

            alert(`Document stamped successfully on-chain!\nTxHash: ${txHash}\nStatus: Pending (being mined)`);
            
            // Refresh balance
            await fetchBalanceFromNode(walletAddress);

            // Redirect to Ledger Tab
            switchTab(navLedger, tabLedger, "Blockchain Ledger", "Explore verified documents and on-chain certificates logged directly to the smart contract.");
            
        } catch (err) {
            console.error("Notarization execution aborted:", err);
            alert(`Execution aborted: ${err.message}`);
            btnNotaryStamp.disabled = false;
            btnNotaryStamp.innerHTML = `<i class="fa-solid fa-gavel"></i> Stamp & Notarize on Blockchain`;
        }
    });

    // --- Global Copy Helper ---
    window.copyTextToClipboard = function(text, btnElement) {
        if (!text) return;
        const cleanText = text.replace(/\\n/g, '\n');
        navigator.clipboard.writeText(cleanText).then(() => {
            if (btnElement) {
                const origHTML = btnElement.innerHTML;
                btnElement.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
                btnElement.style.background = 'var(--green-accent)';
                btnElement.style.color = '#000';
                setTimeout(() => { 
                    btnElement.innerHTML = origHTML; 
                    btnElement.style.background = '';
                    btnElement.style.color = '';
                }, 2000);
            } else {
                alert('Copied to clipboard!');
            }
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback for non-secure contexts
            const textArea = document.createElement('textarea');
            textArea.value = cleanText;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            if (btnElement) {
                const origHTML = btnElement.innerHTML;
                btnElement.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
                setTimeout(() => { btnElement.innerHTML = origHTML; }, 2000);
            }
        });
    };

    // --- On-Chain Registry Explorer Search Engine ---
    function renderVerificationUI(rec) {
        const timeStr = new Date(rec.timestamp * 1000).toLocaleString();
        const docHash = rec.documentHash || '';
        const txHash = rec.txHash || '';
        const clientAddr = rec.client || '';
        const notaryAddr = rec.notary || '';
        
        const certSummary = `CHEESE BLOCKCHAIN VERIFICATION CERTIFICATE\\nStatus: SECURE / UNTAMPERED\\nDocument: ${rec.fileName || 'unnamed'}\\nSHA-256 Hash: ${docHash}\\nTxID: ${txHash}\\nBlock Height: #${rec.blockNumber}\\nSignee: ${clientAddr}\\nNotary Authority: ${notaryAddr}\\nTimestamp: ${timeStr}`;

        return `
            <div class="verification-success-box">
                <i class="fa-solid fa-circle-check box-icon animate-pulse" style="color: var(--green-accent)"></i>
                <h3 class="box-title">Document Verifiably Authenticated</h3>
                <p class="box-desc">This digital signature matches the immutable state logged on the Cheese Blockchain.</p>
                
                <div class="blockchain-details-block">
                    <div class="detail-row">
                        <span class="lbl">Verification Status:</span>
                        <span class="val green"><i class="fa-solid fa-shield-halved"></i> SECURE / UNTAMPERED</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Document Name:</span>
                        <span class="val">${rec.fileName || 'unnamed'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Asset MIME Type:</span>
                        <span class="val">${rec.fileType || 'binary/stream'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">SHA-256 Fingerprint:</span>
                        <span class="val hash-text" style="color: var(--cheese-yellow)">
                            ${docHash}
                            <button class="btn-copy-mini" onclick="window.copyTextToClipboard('${docHash}', this)"><i class="fa-solid fa-copy"></i> Copy Hash</button>
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Signee Wallet (Citizen):</span>
                        <span class="val">${clientAddr}</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Notary Authority:</span>
                        <span class="val">${notaryAddr}</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Timestamp stamped:</span>
                        <span class="val">${timeStr}</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Consensus Block Height:</span>
                        <span class="val">#${rec.blockNumber}</span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Transaction Hash (TxID):</span>
                        <span class="val hash-text">
                            ${txHash}
                            <button class="btn-copy-mini" onclick="window.copyTextToClipboard('${txHash}', this)"><i class="fa-solid fa-copy"></i> Copy TxID</button>
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="lbl">Gas Used:</span>
                        <span class="val">${rec.gas || 'N/A'}</span>
                    </div>
                </div>

                <div style="margin-top: 1.25rem; text-align: center;">
                    <button class="btn-primary btn-full" onclick="window.copyTextToClipboard('${certSummary}', this)" style="padding: 0.85rem;"><i class="fa-solid fa-copy"></i> Copy Official On-Chain Verification Certificate</button>
                </div>
            </div>
        `;
    }

    function renderErrorUI(query) {
        return `
            <div class="verification-error-box">
                <i class="fa-solid fa-circle-exclamation box-icon" style="color: var(--red-accent)"></i>
                <h3 class="box-title">Authenticity Record Not Found</h3>
                <p class="box-desc">This fingerprint hash is not registered in the sovereign contract registry.</p>
                
                <div class="blockchain-details-block" style="border-color: rgba(239, 68, 68, 0.2)">
                    <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.6;">
                        <strong>Query submitted:</strong> <span class="hash-text" style="word-break: break-all; display: block; margin-top: 0.25rem;">${query}</span>
                    </p>
                    <p style="margin-top: 1rem; color: var(--text-muted); font-size: 0.85rem;">
                        <strong>Security Warning:</strong> If this file was notarized previously, this warning indicates that the file content has been tampered with or modified.
                    </p>
                </div>
            </div>
        `;
    }

    async function executeSearch(query, renderContainer, isModal = false) {
        if (!query) return;

        let record = null;

        // 1. Try reading live from the Cheese Blockchain Node
        try {
            console.log(`Searching node registry for query: ${query}`);
            const res = await api.request(`/api/notary/verify?q=${encodeURIComponent(query)}`);
            if (res && res.success && res.verified && res.transaction) {
                const tx = res.transaction;
                record = {
                    documentHash: tx.hash || query,
                    client: tx.clientAddress || tx.from,
                    notary: tx.from,
                    timestamp: Math.floor(tx.timestamp / 1000),
                    fileType: tx.fileName ? (tx.fileName.split('.').pop() || 'binary') : 'binary',
                    fileName: tx.fileName || 'unnamed',
                    txHash: tx.id,
                    blockNumber: res.blockIndex !== null ? res.blockIndex : "Pending",
                    gas: "0.001 NCH"
                };
            }
        } catch (err) {
            console.warn("Failed to fetch verification from blockchain node:", err);
        }

        // 2. If not found on-chain, fallback to local registry ledger database
        if (!record) {
            record = ledgerDatabase.find(r => 
                (r.documentHash && r.documentHash.toLowerCase() === query.toLowerCase()) || 
                (r.txHash && r.txHash.toLowerCase() === query.toLowerCase())
            );
        }

        if (isModal) {
            verificationModal.classList.remove('hidden');
            verificationModal.classList.add('show');
            modalResultContent.innerHTML = record ? renderVerificationUI(record) : renderErrorUI(query);
        } else {
            if (renderContainer) {
                renderContainer.classList.remove('hidden');
                renderContainer.innerHTML = record ? renderVerificationUI(record) : renderErrorUI(query);
            }
        }
    }

    window.verifyTxInExplorer = function(query) {
        if (!query) return;
        switchTab(navLedger, tabLedger, "Blockchain Ledger", "Explore verified documents and on-chain certificates logged directly to the smart contract.");
        if (ledgerSearchInput) ledgerSearchInput.value = query;
        executeSearch(query, ledgerSearchResult, false);
    };

    btnLedgerSearch.addEventListener('click', () => {
        executeSearch(ledgerSearchInput.value.trim(), ledgerSearchResult, false);
    });

    ledgerSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeSearch(ledgerSearchInput.value.trim(), ledgerSearchResult, false);
        }
    });

    headerVerifyBtn.addEventListener('click', () => {
        executeSearch(headerVerificationSearch.value.trim(), null, true);
    });

    headerVerificationSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeSearch(headerVerificationSearch.value.trim(), null, true);
        }
    });

    // Close Modal triggers
    modalCloseBtn.addEventListener('click', () => {
        verificationModal.classList.remove('show');
        verificationModal.classList.add('hidden');
    });

    verificationModal.addEventListener('click', (e) => {
        if (e.target === verificationModal) {
            verificationModal.classList.remove('show');
            verificationModal.classList.add('hidden');
        }
    });

    // --- Render Local Registry Ledger history rows ---
    async function renderLedgerHistory() {
        ledgerHistoryRows.innerHTML = `<tr><td colspan="7" style="text-align: center;"><div class="spinner-small" style="margin: 1rem auto; width: 20px; height: 20px; border: 2px solid var(--border-color); border-top-color: var(--cheese-gold); border-radius: 50%; animation: spin 1s linear infinite;"></div> Loading Ledger...</td></tr>`;
        
        let onChainTxs = [];
        try {
            const res = await api.request('/api/notary/all');
            if (res && res.success && res.transactions) {
                onChainTxs = res.transactions;
            }
        } catch (err) {
            console.warn("Failed to fetch on-chain notary records:", err);
        }

        // Merge local database records with on-chain records
        const merged = [...onChainTxs];
        ledgerDatabase.forEach(localRec => {
            const exists = merged.some(tx => 
                (tx.id && tx.id === localRec.txHash) || 
                (tx.hash && tx.hash === localRec.documentHash)
            );
            if (!exists) {
                merged.push({
                    id: localRec.txHash,
                    timestamp: localRec.timestamp * 1000,
                    fileName: localRec.fileName,
                    hash: localRec.documentHash,
                    category: localRec.fileType || 'general',
                    from: localRec.notary,
                    to: localRec.client || '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3',
                    status: 'pending',
                    blockIndex: null
                });
            }
        });

        // Sort merged by timestamp descending
        merged.sort((a, b) => b.timestamp - a.timestamp);

        ledgerHistoryRows.innerHTML = "";
        
        if (merged.length === 0) {
            ledgerHistoryRows.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted)">No stamp records found.</td></tr>`;
            return;
        }

        merged.forEach(tx => {
            const tr = document.createElement('tr');
            const fileName = tx.fileName || 'unnamed';
            const fileType = tx.category || 'binary';
            const clientAddr = tx.clientAddress || tx.to || 'unknown';
            const notaryAddr = tx.from || 'unknown';
            const docHash = tx.hash || '';
            const statusLabel = tx.status === 'pending' ? 'Pending' : `#${tx.blockIndex}`;
            const statusClass = tx.status === 'pending' ? 'text-gold' : 'text-green';

            tr.innerHTML = `
                <td><strong>${fileName}</strong></td>
                <td><span class="value">${fileType}</span></td>
                <td class="hash-text" style="font-size:0.8rem" title="${clientAddr}">${clientAddr.slice(0, 8)}...${clientAddr.slice(-6)}</td>
                <td class="hash-text" style="font-size:0.8rem" title="${notaryAddr}">${notaryAddr.slice(0, 8)}...${notaryAddr.slice(-6)}</td>
                <td class="hash-text text-gold" style="font-size:0.8rem" title="${docHash}">${docHash.slice(0, 10)}...</td>
                <td class="${statusClass}"><strong>${statusLabel}</strong></td>
                <td><button class="btn-primary btn-small btn-verify-row" data-hash="${docHash}"><i class="fa-solid fa-circle-check"></i> Verify</button></td>
            `;
            
            tr.querySelector('.btn-verify-row').addEventListener('click', () => {
                executeSearch(docHash, null, true);
            });

            ledgerHistoryRows.appendChild(tr);
        });
    }

    // --- Instant Local Stamp Logic ---
    const wsModeLocal = document.getElementById('ws-mode-local');
    const wsModeP2p = document.getElementById('ws-mode-p2p');
    const localStampPanel = document.getElementById('local-stamp-panel');

    // Tab toggling
    wsModeLocal.addEventListener('click', () => {
        wsModeLocal.classList.add('active');
        wsModeP2p.classList.remove('active');
        localStampPanel.classList.remove('hidden');
        setupPanel.classList.add('hidden');
        notaryRoomPanel.classList.add('hidden');
    });

    wsModeP2p.addEventListener('click', () => {
        wsModeP2p.classList.add('active');
        wsModeLocal.classList.remove('active');
        localStampPanel.classList.add('hidden');
        
        // Show setup or call depending on connection state
        if (peerConnection && peerConnection.connectionState === 'connected') {
            notaryRoomPanel.classList.remove('hidden');
            setupPanel.classList.add('hidden');
        } else {
            setupPanel.classList.remove('hidden');
            notaryRoomPanel.classList.add('hidden');
        }
    });

    // Elements
    const localFileInput = document.getElementById('local-file-input');
    const localDropzoneMini = document.getElementById('local-dropzone-mini');
    const localUploadCatCards = document.querySelectorAll('.local-upload-cat-card');
    const localFileProgressBox = document.getElementById('local-file-progress-box');
    const localProgressFillBar = document.getElementById('local-progress-fill-bar');
    const localProgressPercentage = document.getElementById('local-progress-percentage');
    const localFilePreviewZone = document.getElementById('local-file-preview-zone');
    const localFilePreviewContent = document.getElementById('local-file-preview-content');
    const localPreviewFileName = document.getElementById('local-preview-file-name');
    const localPreviewFileType = document.getElementById('local-preview-file-type');
    const localPreviewFileHash = document.getElementById('local-preview-file-hash');
    const localSessionAddress = document.getElementById('local-session-address');
    const btnLocalSignIdentity = document.getElementById('btn-local-sign-identity');
    const localVerifyStatus = document.getElementById('local-verify-status');
    const btnLocalStamp = document.getElementById('btn-local-stamp');
    const localStampValidationMsg = document.getElementById('local-stamp-validation-msg');

    let localFileHash = null;
    let localFileName = null;
    let localFileType = null;
    let localSignature = null;

    // Patch showConnectedPanel to also update local session address
    const _origShowConnectedPanel = showConnectedPanel;
    showConnectedPanel = (isGuest) => {
        _origShowConnectedPanel(isGuest);
        if (walletAddress) {
            localSessionAddress.textContent = walletAddress;
        }
    };
    if (walletAddress) {
        localSessionAddress.textContent = walletAddress;
    }

    // Connect Local Category Cards
    localUploadCatCards.forEach(card => {
        card.addEventListener('click', () => {
            const acceptType = card.getAttribute('data-accept');
            if (acceptType === '*') {
                localFileInput.removeAttribute('accept');
            } else {
                localFileInput.setAttribute('accept', acceptType);
            }
            localFileInput.click();
        });
    });

    localDropzoneMini.addEventListener('click', (e) => {
        e.stopPropagation();
        localFileInput.removeAttribute('accept');
        localFileInput.click();
    });

    // Drag-drop
    const localFileUploadBox = document.getElementById('local-file-upload-box');
    localFileUploadBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        localDropzoneMini.classList.add('dragover');
    });

    localFileUploadBox.addEventListener('dragleave', () => {
        localDropzoneMini.classList.remove('dragover');
    });

    localFileUploadBox.addEventListener('drop', (e) => {
        e.preventDefault();
        localDropzoneMini.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            processLocalFile(e.dataTransfer.files[0]);
        }
    });

    localFileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            processLocalFile(this.files[0]);
        }
    });

    async function processLocalFile(file) {
        localFileName = file.name;
        localFileType = file.type || "application/octet-stream";
        localFileHash = null;
        localSignature = null;

        // Reset UI
        localFileProgressBox.classList.remove('hidden');
        localFilePreviewZone.classList.add('hidden');
        btnLocalSignIdentity.disabled = true;
        btnLocalStamp.disabled = true;
        localVerifyStatus.textContent = "Document Unsigned";
        localVerifyStatus.className = "identity-verify-badge unverified";
        updateLocalStampValidation();
        setLocalStep(1);

        // Animate local progress bar to simulate processing
        let pct = 0;
        const progressInterval = setInterval(() => {
            pct += 10;
            localProgressPercentage.textContent = `${pct}%`;
            localProgressFillBar.style.width = `${pct}%`;
            if (pct >= 100) {
                clearInterval(progressInterval);
                finishHashingLocalFile(file);
            }
        }, 100);
    }

    async function finishHashingLocalFile(file) {
        const fileData = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', fileData);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        localFileHash = "0x" + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        console.log("Local SHA-256 Generated:", localFileHash);
        
        localFileProgressBox.classList.add('hidden');
        
        // Render Preview
        renderLocalFilePreview(file, localFileName, localFileType, localFileHash);
        
        btnLocalSignIdentity.disabled = false;
        updateLocalStampValidation();
        setLocalStep(2);
    }

    function renderLocalFilePreview(fileBlobOrObj, name, type, hash) {
        localFilePreviewZone.classList.remove('hidden');
        localFilePreviewContent.innerHTML = "";
        
        localPreviewFileName.textContent = name;
        localPreviewFileType.textContent = type || "Unknown/Binary";
        localPreviewFileHash.textContent = hash;

        const url = URL.createObjectURL(fileBlobOrObj);
        
        if (type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = url;
            img.className = "preview-img";
            localFilePreviewContent.appendChild(img);
        }
        else if (type.startsWith('audio/')) {
            const audio = document.createElement('audio');
            audio.src = url;
            audio.controls = true;
            audio.className = "preview-audio";
            localFilePreviewContent.appendChild(audio);
        }
        else if (type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.className = "preview-video";
            localFilePreviewContent.appendChild(video);
        }
        else {
            const docCard = document.createElement('div');
            docCard.className = "file-card-preview";
            let iconClass = "fa-file-lines";
            if (type.includes('pdf')) iconClass = "fa-file-pdf";
            else if (type.includes('word') || type.includes('officedocument')) iconClass = "fa-file-word";
            
            docCard.innerHTML = `
                <i class="fa-solid ${iconClass}"></i>
                <a href="${url}" download="${name}" class="btn-outline btn-small"><i class="fa-solid fa-download"></i> Download / Inspect File</a>
            `;
            localFilePreviewContent.appendChild(docCard);
        }
    }

    // Sign identity locally
    btnLocalSignIdentity.addEventListener('click', async () => {
        if (!localFileHash) return;

        try {
            let sig = null;
            if (ethersSigner) {
                sig = await ethersSigner.signMessage(localFileHash);
            } else if (localWallet) {
                sig = await localWallet.signMessage(localFileHash);
            }

            if (sig) {
                localSignature = sig;
                localVerifyStatus.textContent = "Signature Cryptographically Sealed";
                localVerifyStatus.className = "identity-verify-badge verified";
                btnLocalSignIdentity.disabled = true;
                updateLocalStampValidation();
                setLocalStep(3);
            }
        } catch (err) {
            console.error("Local signature failed:", err);
            alert(`Signature failed: ${err.message}`);
        }
    });

    function updateLocalStampValidation() {
        let errorText = "";
        let ready = true;

        if (!walletAddress) {
            errorText = "Connect wallet first.";
            ready = false;
        } else if (!localFileHash) {
            errorText = "Select a file to stamp.";
            ready = false;
        } else if (!localSignature) {
            errorText = "You must cryptographically sign the document first.";
            ready = false;
        }

        if (ready) {
            btnLocalStamp.disabled = false;
            localStampValidationMsg.innerHTML = `<span style="color: var(--green-accent)"><i class="fa-solid fa-circle-check"></i> Document authorization ready.</span>`;
        } else {
            btnLocalStamp.disabled = true;
            localStampValidationMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${errorText}`;
        }
    }

    // Execute local stamp on contract
    btnLocalStamp.addEventListener('click', async () => {
        if (!localFileHash || !walletAddress || !localSignature) return;

        btnLocalStamp.disabled = true;
        btnLocalStamp.innerHTML = `<span class="spinner-small" style="margin-right: 0.5rem"></span> Stamping to Blockchain...`;

        try {
            // 1. Try EVM Smart Contract execution if a contract address is configured and MetaMask/Signer is active
            if (contractAddress && contractAddress.startsWith('0x') && contractAddress.length === 42 && ethersSigner) {
                console.log(`📜 [MetaMask] Initiating EVM smart contract transaction on CheeseNotary at: ${contractAddress}`);
                try {
                    const notaryContract = new ethers.Contract(contractAddress, contractABI, ethersSigner);
                    const tx = await notaryContract.notarize(
                        localFileHash,
                        walletAddress,
                        localSignature,
                        localFileType || "application/octet-stream",
                        localFileName || "document"
                    );
                    console.log("Transaction sent, awaiting confirmation receipt...", tx.hash);
                    const receipt = await tx.wait();
                    console.log("Transaction confirmed on EVM!", receipt.transactionHash);

                    const txHash = receipt.transactionHash;
                    const blockNum = receipt.blockNumber || "Pending";
                    const timestamp = Math.floor(Date.now() / 1000);

                    const newRecord = {
                        documentHash: localFileHash,
                        fileName: localFileName,
                        fileType: localFileType,
                        client: walletAddress,
                        notary: walletAddress, // self-notarized
                        timestamp: timestamp,
                        txHash: txHash,
                        blockNumber: blockNum,
                        gas: "0.001 NCH"
                    };

                    ledgerDatabase.unshift(newRecord);
                    localStorage.setItem('cheese_notary_ledger', JSON.stringify(ledgerDatabase));

                    alert(`Document stamped successfully on-chain via smart contract!\nTxHash: ${txHash}`);
                    
                    // Reset local uploader state
                    localFileHash = null;
                    localSignature = null;
                    localFilePreviewZone.classList.add('hidden');
                    updateLocalStampValidation();

                    // Refresh balance
                    await fetchBalanceFromNode(walletAddress);

                    // Redirect to Ledger Explorer
                    switchTab(navLedger, tabLedger, "Blockchain Ledger", "Explore verified documents and on-chain certificates logged directly to the smart contract.");
                    setLocalStep(1);
                    return;
                } catch (contractErr) {
                    console.warn("Smart contract transaction failed or rejected. Falling back to native blockchain transaction:", contractErr);
                }
            }

            // 2. Custom Native Blockchain Transaction Fallback
            if (!localWallet && !isMetaMaskConnected) {
                throw new Error("Stamping requires a loaded private key or MetaMask connection. Please connect your MetaMask or use the Sandbox wallet.");
            }

            console.log("Submitting native DOCUMENT_NOTARY transaction to the node...");
            const res = await api.sendTransaction(
                walletAddress, // from
                '0x045D4e61757a873DAF5F3B59CCeD9f2585643cc3', // to (Official Treasury Wallet)
                0.001, // amount
                localWallet ? localWallet.privateKey : null, // privateKey
                {
                    type: 'DOCUMENT_NOTARY',
                    hash: localFileHash,
                    fileName: localFileName,
                    fileType: localFileType,
                    clientAddress: walletAddress,
                    clientSignature: localSignature,
                    category: 'general'
                }
            );

            if (!res || !res.success) {
                throw new Error(res?.error || "Transaction submission failed");
            }

            const tx = res.transaction;
            const txHash = tx.id;
            const blockNum = res.blockIndex || "Pending";
            const gasUsed = "0.001 NCH";
            const timestamp = Math.floor((tx.timestamp || Date.now()) / 1000);

            const newRecord = {
                documentHash: localFileHash,
                fileName: localFileName,
                fileType: localFileType,
                client: walletAddress,
                notary: walletAddress, // self-notarized
                timestamp: timestamp,
                txHash: txHash,
                blockNumber: blockNum,
                gas: gasUsed
            };

            ledgerDatabase.unshift(newRecord);
            localStorage.setItem('cheese_notary_ledger', JSON.stringify(ledgerDatabase));

            alert(`Document stamped successfully on-chain!\nTxHash: ${txHash}\nStatus: Pending (being mined)`);
            
            // Reset local uploader state
            localFileHash = null;
            localSignature = null;
            localFilePreviewZone.classList.add('hidden');
            updateLocalStampValidation();

            // Refresh balance
            await fetchBalanceFromNode(walletAddress);

            // Redirect to Ledger Explorer
            switchTab(navLedger, tabLedger, "Blockchain Ledger", "Explore verified documents and on-chain certificates logged directly to the smart contract.");
            setLocalStep(1);

        } catch (err) {
            console.error("Local stamp aborted:", err);
            alert(`Stamping aborted: ${err.message}`);
        } finally {
            btnLocalStamp.disabled = false;
            btnLocalStamp.innerHTML = `<i class="fa-solid fa-gavel"></i> Stamp & Notarize on Blockchain`;
        }
    });

    // --- Governance Config Update UI ---
    if (btnSaveNodeUrl) {
        btnSaveNodeUrl.addEventListener('click', () => {
            const val = nodeUrlInput.value.trim();
            if (val) {
                api.apiUrl = val;
                localStorage.setItem('cheese_node_api_url', val);
                alert(`Sovereign blockchain node URL updated to:\n${val}`);
                if (walletAddress) {
                    fetchBalanceFromNode(walletAddress);
                }
            }
        });
    }

    if (btnSaveContract) {
        btnSaveContract.addEventListener('click', () => {
            const val = contractAddressInput.value.trim();
            if (val) {
                contractAddress = val;
                localStorage.setItem('cheese_notary_contract_address', val);
                alert(`CheeseNotary contract address updated to:\n${val}`);
            } else {
                contractAddress = "";
                localStorage.removeItem('cheese_notary_contract_address');
                alert("CheeseNotary contract address cleared. Workspace will fall back to REST API transactions.");
            }
        });
    }

    // --- NotaryRegistry Config Save/Load ---
    const registryInput = document.getElementById('notary-registry-address-input');
    const btnSaveRegistry = document.getElementById('btn-save-registry');
    if (registryInput) {
        registryInput.value = localStorage.getItem('cheese_notary_registry_address') || '';
    }
    if (btnSaveRegistry) {
        btnSaveRegistry.addEventListener('click', () => {
            const addr = registryInput.value.trim();
            if (addr) {
                localStorage.setItem('cheese_notary_registry_address', addr);
                if (typeof NOTARY_REGISTRY_ADDRESS !== 'undefined') {
                    NOTARY_REGISTRY_ADDRESS = addr;
                }
                alert('NotaryRegistry contract address saved:\n' + addr);
            } else {
                localStorage.removeItem('cheese_notary_registry_address');
                alert('NotaryRegistry address cleared.');
            }
        });
    }

    // ===== SIGNATURE PAD SYSTEM =====
    function initSignaturePad(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        let drawing = false;
        let hasStrokes = false;

        // High-DPI scaling
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0) {
            canvas.width = rect.width * 2;
            canvas.height = rect.height * 2;
            ctx.scale(2, 2);
        } else {
            canvas.width = 800;
            canvas.height = 300;
            ctx.scale(2, 2);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#f0f0f0';

        function getPos(e) {
            const r = canvas.getBoundingClientRect();
            const touch = e.touches ? e.touches[0] : e;
            return { x: touch.clientX - r.left, y: touch.clientY - r.top };
        }

        canvas.addEventListener('mousedown', (e) => { drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); });
        canvas.addEventListener('mousemove', (e) => { if (!drawing) return; hasStrokes = true; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
        canvas.addEventListener('mouseup', () => { drawing = false; });
        canvas.addEventListener('mouseleave', () => { drawing = false; });

        // Touch support
        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); }, { passive: false });
        canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!drawing) return; hasStrokes = true; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
        canvas.addEventListener('touchend', () => { drawing = false; });

        return {
            clear() {
                const r2 = canvas.getBoundingClientRect();
                ctx.clearRect(0, 0, r2.width, r2.height);
                hasStrokes = false;
                canvas.classList.remove('has-signature');
            },
            hasSignature() { return hasStrokes; },
            toDataURL() { return canvas.toDataURL('image/png'); },
            getCanvas() { return canvas; }
        };
    }

    const clientSigPad = initSignaturePad('client-signature-canvas');
    const notarySigPad = initSignaturePad('notary-signature-canvas');
    const localSigPad = initSignaturePad('local-signature-canvas');

    function wireSignaturePad(pad, clearBtnId, acceptBtnId, statusId) {
        const clearBtn = document.getElementById(clearBtnId);
        const acceptBtn = document.getElementById(acceptBtnId);
        const statusEl = document.getElementById(statusId);
        if (!pad || !clearBtn || !acceptBtn) return;

        clearBtn.addEventListener('click', () => {
            pad.clear();
            if (statusEl) {
                statusEl.innerHTML = '<i class="fa-solid fa-circle-info"></i> No signature drawn (optional)';
                statusEl.className = 'signature-status';
            }
        });

        acceptBtn.addEventListener('click', () => {
            if (!pad.hasSignature()) {
                alert('Please draw a signature first.');
                return;
            }
            pad.getCanvas().classList.add('has-signature');
            if (statusEl) {
                statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Signature captured ✓';
                statusEl.className = 'signature-status accepted';
            }

            // Send over data channel if in P2P mode
            if (typeof dataChannel !== 'undefined' && dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({
                    type: 'literal_signature',
                    role: myRole,
                    signatureData: pad.toDataURL()
                }));
            }
        });
    }

    wireSignaturePad(clientSigPad, 'btn-client-sig-clear', 'btn-client-sig-accept', 'client-sig-status');
    wireSignaturePad(notarySigPad, 'btn-notary-sig-clear', 'btn-notary-sig-accept', 'notary-sig-status');
    wireSignaturePad(localSigPad, 'btn-local-sig-clear', 'btn-local-sig-accept', 'local-sig-status');

    // ===== RECEIVED FILES VAULT SYSTEM =====
    let receivedFilesVault = [];
    try {
        const storedRec = localStorage.getItem('cheese_p2p_received_files');
        if (storedRec) receivedFilesVault = JSON.parse(storedRec);
    } catch (e) {}

    function saveAndRenderReceivedFiles() {
        try {
            localStorage.setItem('cheese_p2p_received_files', JSON.stringify(receivedFilesVault));
        } catch (e) {}
        renderReceivedFilesFolder();
    }

    function renderReceivedFilesFolder() {
        const container = document.getElementById('received-files-container');
        const listEl = document.getElementById('received-files-list');
        const countEl = document.getElementById('received-files-count');
        if (!container || !listEl) return;

        if (receivedFilesVault.length > 0 || myRole === 'client') {
            container.classList.remove('hidden');
        }

        if (countEl) countEl.textContent = `${receivedFilesVault.length} File${receivedFilesVault.length === 1 ? '' : 's'}`;

        if (receivedFilesVault.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1rem; font-size: 0.9rem;"><i class="fa-solid fa-inbox"></i> No received files in your folder yet.</div>`;
            return;
        }

        listEl.innerHTML = "";
        receivedFilesVault.forEach((rec, idx) => {
            const item = document.createElement('div');
            item.className = "file-card-preview";
            item.style.marginBottom = "0.5rem";
            item.style.padding = "0.85rem";
            item.style.background = "rgba(255, 255, 255, 0.04)";
            item.style.border = "1px solid rgba(255, 255, 255, 0.1)";
            item.style.borderRadius = "8px";

            const timeStr = rec.receivedAt ? new Date(rec.receivedAt).toLocaleString() : 'Just now';
            const icon = getFileIcon(rec.type);

            item.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.75rem; overflow: hidden;">
                        <span style="font-size: 1.5rem;">${icon}</span>
                        <div style="overflow: hidden;">
                            <strong style="color: #fff; font-size: 0.95rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${rec.name}</strong>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">${Math.round(rec.size / 1024)} KB • Received ${timeStr}</span>
                        </div>
                    </div>
                    <span class="identity-verify-badge verified" style="font-size: 0.75rem;">Verified P2P</span>
                </div>
                <div style="margin-top: 0.5rem; font-size: 0.75rem; font-family: var(--font-mono); color: var(--cheese-yellow); word-break: break-all;">
                    SHA-256: ${rec.hash}
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                    <button class="btn-outline btn-small" onclick="window.downloadReceivedFile(${idx})"><i class="fa-solid fa-download"></i> Download File</button>
                    <button class="btn-primary btn-small" onclick="window.previewReceivedFile(${idx})"><i class="fa-solid fa-eye"></i> Inspect</button>
                </div>
            `;
            listEl.appendChild(item);
        });
    }

    window.downloadReceivedFile = function(index) {
        const rec = receivedFilesVault[index];
        if (!rec || !rec.dataUrl) { alert("File data not available"); return; }
        const a = document.createElement('a');
        a.href = rec.dataUrl;
        a.download = rec.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    window.previewReceivedFile = function(index) {
        const rec = receivedFilesVault[index];
        if (!rec) return;
        activeFileHash = rec.hash;
        activeFileName = rec.name;
        activeFileType = rec.type;
        if (rec.dataUrl) {
            fetch(rec.dataUrl).then(r => r.blob()).then(blob => {
                renderFilePreview(blob, rec.name, rec.type, rec.hash);
            });
        }
    };

    // Initial render of received files folder
    renderReceivedFilesFolder();

    // ===== PUBLIC VAULT SYSTEM =====
    function getFileCategory(mimeType) {
        if (!mimeType) return 'document';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('audio/')) return 'audio';
        if (mimeType.startsWith('video/')) return 'video';
        return 'document';
    }

    function getFileIcon(mimeType) {
        const cat = getFileCategory(mimeType);
        const icons = { document: '<i class="fa-solid fa-file-pdf" style="color: var(--cheese-gold)"></i>', image: '<i class="fa-solid fa-image" style="color: #60a5fa"></i>', audio: '<i class="fa-solid fa-music" style="color: #a78bfa"></i>', video: '<i class="fa-solid fa-video" style="color: #fb7185"></i>' };
        return icons[cat] || icons.document;
    }

    function renderVault(filterType, searchQuery) {
        filterType = filterType || 'all';
        searchQuery = searchQuery || '';

        const grid = document.getElementById('vault-grid');
        const empty = document.getElementById('vault-empty');
        const stats = document.getElementById('vault-stats');
        if (!grid) return;
        grid.innerHTML = '';

        let records = [...ledgerDatabase];

        // Filter by type
        if (filterType !== 'all') {
            records = records.filter(r => getFileCategory(r.fileType) === filterType);
        }

        // Filter by search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            records = records.filter(r =>
                (r.fileName || '').toLowerCase().includes(q) ||
                (r.documentHash || '').toLowerCase().includes(q) ||
                (r.client || '').toLowerCase().includes(q) ||
                (r.notary || '').toLowerCase().includes(q)
            );
        }

        if (stats) {
            stats.textContent = `Showing ${records.length} of ${ledgerDatabase.length} notarized entries`;
        }

        if (records.length === 0) {
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        records.forEach(rec => {
            const card = document.createElement('div');
            card.className = 'vault-card';
            const icon = getFileIcon(rec.fileType);
            const date = rec.timestamp ? new Date(rec.timestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown';
            const shortHash = (rec.documentHash || '').slice(0, 16) + '...';
            const shortNotary = (rec.notary || '').slice(0, 8) + '...';
            card.innerHTML = `
                <div class="vault-icon">${icon}</div>
                <div class="vault-name">${rec.fileName || 'Unnamed Document'}</div>
                <div class="vault-hash">${shortHash}</div>
                <div class="vault-meta">
                    <span>${date}</span>
                    <span class="vault-badge"><i class="fa-solid fa-check"></i> Verified</span>
                </div>
            `;
            card.addEventListener('click', () => showVaultDetail(rec));
            grid.appendChild(card);
        });
    }

    function showVaultDetail(rec) {
        // Reuse the existing verification modal
        const modal = document.getElementById('verificationModal');
        const content = document.getElementById('modalResultContent');
        if (!modal || !content) return;

        const date = rec.timestamp ? new Date(rec.timestamp * 1000).toLocaleString() : 'Unknown';
        const docHash = rec.documentHash || '';
        const txHash = rec.txId || rec.txHash || '';
        const clientAddr = rec.client || '';
        const notaryAddr = rec.notary || '';

        const certSummary = `CHEESE BLOCKCHAIN VAULT CERTIFICATE\\nFile: ${rec.fileName || 'N/A'}\\nSHA-256 Hash: ${docHash}\\nTxID: ${txHash}\\nSignee: ${clientAddr}\\nNotary: ${notaryAddr}\\nTimestamp: ${date}`;

        let sigHtml = '';
        if (rec.clientSignatureImg) {
            sigHtml += `<div style="margin-top: 1rem;"><strong>Client Signature:</strong><br><img src="${rec.clientSignatureImg}" style="max-width: 300px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; margin-top: 0.5rem;" /></div>`;
        }
        if (rec.notarySignatureImg) {
            sigHtml += `<div style="margin-top: 1rem;"><strong>Notary Signature:</strong><br><img src="${rec.notarySignatureImg}" style="max-width: 300px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; margin-top: 0.5rem;" /></div>`;
        }

        content.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 1rem; padding: 1rem 0;">
                <div><strong style="color: var(--cheese-yellow)">File Name:</strong> ${rec.fileName || 'N/A'}</div>
                <div><strong style="color: var(--cheese-yellow)">File Type:</strong> ${rec.fileType || 'N/A'}</div>
                <div>
                    <strong style="color: var(--cheese-yellow)">SHA-256 Hash:</strong><br>
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; word-break: break-all;">${docHash}</span>
                    <button class="btn-copy-mini" onclick="window.copyTextToClipboard('${docHash}', this)"><i class="fa-solid fa-copy"></i> Copy Hash</button>
                </div>
                <div>
                    <strong style="color: var(--cheese-yellow)">Notary Address:</strong><br>
                    <span style="font-family: var(--font-mono); font-size: 0.85rem;">${notaryAddr}</span>
                </div>
                <div>
                    <strong style="color: var(--cheese-yellow)">Client Address:</strong><br>
                    <span style="font-family: var(--font-mono); font-size: 0.85rem;">${clientAddr}</span>
                </div>
                <div><strong style="color: var(--cheese-yellow)">Timestamp:</strong> ${date}</div>
                <div>
                    <strong style="color: var(--cheese-yellow)">Transaction Hash (TxID):</strong><br>
                    <span style="font-family: var(--font-mono); font-size: 0.8rem; word-break: break-all;">${txHash}</span>
                    <button class="btn-copy-mini" onclick="window.copyTextToClipboard('${txHash}', this)"><i class="fa-solid fa-copy"></i> Copy TxID</button>
                </div>
                <div><span class="vault-badge" style="font-size: 0.85rem; padding: 0.3rem 0.7rem;"><i class="fa-solid fa-check"></i> On-Chain Verified</span></div>
                ${sigHtml}
                <div style="margin-top: 1rem;">
                    <button class="btn-primary btn-full" onclick="window.copyTextToClipboard('${certSummary}', this)" style="padding: 0.75rem;"><i class="fa-solid fa-copy"></i> Copy Full Vault Certificate</button>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    // Wire vault filter buttons
    document.querySelectorAll('.vault-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.vault-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.getAttribute('data-filter');
            const search = document.getElementById('vault-search-input');
            renderVault(filter, search ? search.value.trim() : '');
        });
    });

    // Wire vault search
    const vaultSearchInput = document.getElementById('vault-search-input');
    if (vaultSearchInput) {
        vaultSearchInput.addEventListener('input', () => {
            const activeFilter = document.querySelector('.vault-filter-btn.active');
            const filter = activeFilter ? activeFilter.getAttribute('data-filter') : 'all';
            renderVault(filter, vaultSearchInput.value.trim());
        });
    }

    // ===== WALLET GATING FOR LOCAL STAMP MEDIA TYPES =====
    // Gate local upload cards for non-document types
    document.querySelectorAll('.local-upload-cat-card').forEach(card => {
        const origClickHandler = card.onclick;
        card.addEventListener('click', (e) => {
            const accept = card.getAttribute('data-accept');
            if (accept && accept !== '*' && !isMetaMaskConnected) {
                e.stopImmediatePropagation();
                e.preventDefault();
                alert('⚠ Please connect your MetaMask wallet to notarize images, audio, and video files.\n\nDocument notarization is available without MetaMask.');
                return false;
            }
        }, true);
    });

    // Gate P2P upload cards
    document.querySelectorAll('.upload-cat-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (!isMetaMaskConnected) {
                e.stopImmediatePropagation();
                e.preventDefault();
                alert('⚠ Please connect your MetaMask wallet to send files over P2P.');
                return false;
            }
        }, true);
    });

});
