// CEX Hybrid Web3 Wallet Helper & Modal Manager
(function() {
    function getConnectedWallet() {
        return localStorage.getItem('cex_connected_wallet') || localStorage.getItem('cheeseWallet') || '';
    }

    function setConnectedWallet(address) {
        if (!address) {
            localStorage.removeItem('cex_connected_wallet');
            localStorage.removeItem('cheeseWallet');
        } else {
            const normalized = address.toLowerCase();
            localStorage.setItem('cex_connected_wallet', normalized);
            localStorage.setItem('cheeseWallet', normalized);
        }
        window.dispatchEvent(new Event('storage'));
        window.location.reload();
    }

    window.openCexWalletModal = function() {
        const existing = document.getElementById('cexWalletModalOverlay');
        if (existing) existing.remove();

        const wallet = getConnectedWallet();
        const overlay = document.createElement('div');
        overlay.id = 'cexWalletModalOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center; p: 16px;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #0f172a; border: 1px solid #334155; border-radius: 20px;
            width: 100%; max-width: 440px; padding: 24px; color: #f8fafc;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); font-family: sans-serif;
        `;

        if (wallet) {
            modal.innerHTML = `
                <div style="display:flex; justify-between; align-items:center; margin-bottom: 20px;">
                    <h3 style="font-size: 18px; font-weight: 700; margin:0; color:#34d399;">🔑 Connected Web3 Wallet</h3>
                    <button id="closeCexModal" style="background:none; border:none; color:#94a3b8; font-size:24px; cursor:pointer;">&times;</button>
                </div>
                <div style="background:#1e293b; border:1px solid #334155; padding:12px; rounded-radius:12px; margin-bottom:20px; word-break:break-all; font-family:monospace; font-size:13px; color:#67e8f9;">
                    ${wallet}
                </div>
                <div style="display:flex; gap:10px;">
                    <button id="cexDisconnectBtn" style="flex:1; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:10px; font-weight:600; cursor:pointer; font-size:14px; transition:0.2s;">
                        🚪 Disconnect / Log Out Wallet
                    </button>
                </div>
            `;
        } else {
            modal.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
                    <h3 style="font-size: 18px; font-weight: 700; margin:0; color:#34d399;">⚡ Connect Web3 Wallet</h3>
                    <button id="closeCexModal" style="background:none; border:none; color:#94a3b8; font-size:24px; cursor:pointer;">&times;</button>
                </div>
                <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Connect any installed Web3 EVM extension or paste your 0x EVM wallet address below.</p>
                
                <button id="cexMetaMaskBtn" style="width:100%; background:#1e293b; border:1px solid #334155; color:#fff; padding:14px; border-radius:12px; font-weight:600; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:12px; transition:0.2s;">
                    <span style="font-size:18px;">⚡</span> Connect Web3 EVM Extension
                </button>
                <div style="font-size:11px; color:#64748b; text-align:center; margin-bottom:16px;">Supports MetaMask, Trust Wallet, SafePal, Coinbase, OKX, Rabby & Phantom.</div>
                
                <div style="display:flex; align-items:center; gap:10px; margin: 16px 0; color:#64748b; font-size:12px;">
                    <div style="flex:1; height:1px; background:#334155;"></div>
                    <span>OR MANUAL EVM ADDRESS</span>
                    <div style="flex:1; height:1px; background:#334155;"></div>
                </div>

                <div style="margin-bottom:16px;">
                    <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:6px; font-weight:500;">Enter EVM Address (Trust Wallet, SafePal, Mobile):</label>
                    <input type="text" id="cexManualAddressInput" placeholder="0x..." style="width:100%; background:#020617; border:1px solid #334155; color:#34d399; padding:12px; border-radius:10px; font-family:monospace; font-size:13px; box-sizing:border-box; outline:none;" />
                </div>

                <button id="cexManualConnectBtn" style="width:100%; background:linear-gradient(135deg, #10b981, #059669); border:none; color:#000; padding:12px; border-radius:10px; font-weight:700; cursor:pointer; font-size:14px;">
                    Connect Manual Wallet
                </button>
            `;
        }

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('closeCexModal').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        if (wallet) {
            document.getElementById('cexDisconnectBtn').onclick = () => {
                setConnectedWallet('');
            };
        } else {
            document.getElementById('cexMetaMaskBtn').onclick = async () => {
                if (window.ethereum) {
                    try {
                        const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
                        if (accs && accs[0]) setConnectedWallet(accs[0]);
                    } catch (err) {
                        alert('MetaMask Connection Error: ' + err.message);
                    }
                } else {
                    window.open('https://metamask.io/download/', '_blank');
                }
            };

            document.getElementById('cexManualConnectBtn').onclick = () => {
                const val = (document.getElementById('cexManualAddressInput').value || '').trim();
                if (!val || val.length < 42 || !val.startsWith('0x')) {
                    alert('Please enter a valid 42-character EVM address starting with 0x');
                    return;
                }
                setConnectedWallet(val);
            };
        }
    };

    // Inject Disconnect button into header & make all notification popups 100% exit-able
    function syncHeaderUI() {
        const wallet = getConnectedWallet();
        
        // Find header navigation across all pages (React SPA & HTML DEX)
        const headers = document.querySelectorAll('header, nav, .header, [class*="header"], [class*="Navbar"]');
        headers.forEach(header => {
            let container = header.querySelector('.wallet-btn-container, .nav-right, .flex.items-center.gap-2');
            if (!container) {
                const connectBtn = Array.from(header.querySelectorAll('button')).find(b => 
                    b.textContent.includes('Connect') || b.textContent.includes('0x') || b.id === 'connectBtn'
                );
                if (connectBtn) container = connectBtn.parentElement;
            }

            if (container) {
                let logoutBtn = container.querySelector('#logoutBtn') || container.querySelector('.global-disconnect-btn');
                if (wallet) {
                    if (!logoutBtn) {
                        logoutBtn = document.createElement('button');
                        logoutBtn.id = 'logoutBtn';
                        logoutBtn.className = 'logout-btn global-disconnect-btn';
                        logoutBtn.innerHTML = '🔌 Disconnect';
                        logoutBtn.title = 'Disconnect Wallet';
                        logoutBtn.style.cssText = `
                            background: rgba(239, 68, 68, 0.15) !important;
                            border: 1px solid rgba(239, 68, 68, 0.4) !important;
                            color: #ef4444 !important;
                            padding: 0.4rem 0.8rem !important;
                            border-radius: 20px !important;
                            font-size: 0.8rem !important;
                            font-weight: 700 !important;
                            cursor: pointer !important;
                            display: inline-flex !important;
                            align-items: center !important;
                            gap: 0.3rem !important;
                            margin-left: 0.5rem !important;
                            transition: all 0.2s ease !important;
                            z-index: 999 !important;
                        `;
                        logoutBtn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setConnectedWallet('');
                            if (typeof window.disconnectWallet === 'function') {
                                window.disconnectWallet();
                            } else {
                                window.location.reload();
                            }
                        };
                        container.appendChild(logoutBtn);
                    } else {
                        logoutBtn.style.display = 'inline-flex';
                    }
                } else if (logoutBtn) {
                    logoutBtn.style.display = 'none';
                }
            }
        });

        // Sync header connect button text & class
        const connectTexts = document.querySelectorAll('#connectText');
        connectTexts.forEach(txt => {
            if (wallet) {
                txt.textContent = wallet.substring(0, 6) + '...' + wallet.substring(38);
                const parentBtn = txt.closest('button');
                if (parentBtn) parentBtn.classList.add('connected');
            } else {
                txt.textContent = 'Connect Wallet';
                const parentBtn = txt.closest('button');
                if (parentBtn) parentBtn.classList.remove('connected');
            }
        });

        // Ensure all DOM notifications are click-dismissible and have a close button
        const notes = document.querySelectorAll('.notification, [role="alert"], [class*="notification"], [class*="toast"]');
        notes.forEach(note => {
            if (!note.dataset.exitHandlerAttached) {
                note.dataset.exitHandlerAttached = 'true';
                note.style.cursor = 'pointer';
                if (!note.querySelector('.note-close-btn')) {
                    const closeBtn = document.createElement('span');
                    closeBtn.className = 'note-close-btn';
                    closeBtn.innerHTML = ' &times;';
                    closeBtn.style.cssText = 'float:right; font-weight:bold; font-size:18px; margin-left:10px; cursor:pointer; opacity:0.8;';
                    note.appendChild(closeBtn);
                }
                const removeNote = (e) => {
                    if (e) e.stopPropagation();
                    note.style.opacity = '0';
                    note.style.transform = 'translateY(-10px)';
                    note.style.transition = 'all 0.2s ease-out';
                    setTimeout(() => note.remove(), 200);
                };
                note.addEventListener('click', removeNote);
            }
        });
    }

    setInterval(syncHeaderUI, 500);
})();
