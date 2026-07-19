/**
 * Connect Manager - WalletConnect and DApp Connection
 * Handles connections to external wallets and DApps
 */

class ConnectManager {
    constructor() {
        this.connections = new Map();
        this.walletConnect = null;
    }

    // Initialize WalletConnect
    async initWalletConnect() {
        // Load WalletConnect library
        if (!window.WalletConnect) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@walletconnect/client@latest/dist/umd/index.min.js';
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        return true;
    }

    // Connect via WalletConnect
    async connectWalletConnect() {
        try {
            await this.initWalletConnect();

            // Initialize WalletConnect
            this.walletConnect = new window.WalletConnect.default({
                bridge: 'https://bridge.walletconnect.org',
                qrcodeModal: {
                    open: (uri) => {
                        this.showQRCode(uri);
                    },
                    close: () => {
                        this.hideQRCode();
                    }
                }
            });

            // Check if already connected
            if (!this.walletConnect.connected) {
                await this.walletConnect.createSession();
            }

            // Subscribe to events
            this.walletConnect.on('connect', (error, payload) => {
                if (error) {
                    throw error;
                }
                this.onWalletConnect(payload);
            });

            this.walletConnect.on('session_request', (error, payload) => {
                if (error) {
                    throw error;
                }
                this.handleSessionRequest(payload);
            });

            this.walletConnect.on('call_request', (error, payload) => {
                if (error) {
                    throw error;
                }
                this.handleCallRequest(payload);
            });

            return this.walletConnect;
        } catch (error) {
            console.error('WalletConnect error:', error);
            throw error;
        }
    }

    // Show QR code
    showQRCode(uri) {
        // Create QR code modal
        const modal = document.createElement('div');
        modal.id = 'walletconnect-qr-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        // Load QR code library
        if (!window.QRCode) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode@latest/build/qrcode.min.js';
            script.onload = () => {
                this.renderQRCode(modal, uri);
            };
            document.head.appendChild(script);
        } else {
            this.renderQRCode(modal, uri);
        }

        document.body.appendChild(modal);
    }

    // Render QR code
    renderQRCode(modal, uri) {
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        `;

        const canvas = document.createElement('canvas');
        window.QRCode.toCanvas(canvas, uri, { width: 300 }, (error) => {
            if (error) {
                console.error('QR code error:', error);
                return;
            }
            content.appendChild(canvas);
        });

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => this.hideQRCode();
        content.appendChild(closeBtn);

        modal.appendChild(content);
    }

    // Hide QR code
    hideQRCode() {
        const modal = document.getElementById('walletconnect-qr-modal');
        if (modal) {
            modal.remove();
        }
    }

    // Handle WalletConnect connection
    onWalletConnect(payload) {
        console.log('WalletConnect connected:', payload);
        this.connections.set('walletconnect', payload);
    }

    // Handle session request
    handleSessionRequest(payload) {
        // Approve or reject session
        if (confirm('Approve connection request?')) {
            this.walletConnect.approveSession({
                chainId: 1,
                accounts: [window.app?.wallet?.address || '']
            });
        } else {
            this.walletConnect.rejectSession();
        }
    }

    // Handle call request (transaction, etc.)
    handleCallRequest(payload) {
        const { method, params } = payload.params[0];
        
        if (method === 'eth_sendTransaction') {
            // Handle transaction request
            this.handleTransactionRequest(params[0]);
        }
    }

    // Handle transaction request
    async handleTransactionRequest(tx) {
        if (window.app && window.app.wallet) {
            // Sign and send transaction
            const result = await window.app.sendTransaction(
                tx.to,
                tx.value,
                tx.data
            );
            
            // Return result to WalletConnect
            this.walletConnect.approveRequest({
                id: tx.id,
                result: result.hash
            });
        }
    }

    // Scan QR code
    async scanQRCode() {
        // Use HTML5 QR scanner
        if (!window.Html5Qrcode) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/html5-qrcode@latest/dist/html5-qrcode.min.js';
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        const scanner = new window.Html5Qrcode('qr-reader');
        scanner.start(
            { facingMode: 'environment' },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 }
            },
            (decodedText) => {
                scanner.stop();
                this.handleScannedQR(decodedText);
            },
            (errorMessage) => {
                // Ignore errors
            }
        );
    }

    // Handle scanned QR code
    handleScannedQR(data) {
        // Parse QR code data
        if (data.startsWith('ethereum:')) {
            // Ethereum address
            const address = data.split(':')[1];
            window.app?.fillSendForm(address);
        } else if (data.startsWith('wc:')) {
            // WalletConnect URI
            this.walletConnect?.connect({ uri: data });
        } else {
            // Try to parse as address
            if (data.startsWith('0x') && data.length === 42) {
                window.app?.fillSendForm(data);
            }
        }
    }

    // Connect to DApp
    async connectDApp() {
        try {
            // Show DApp browser or connection modal
            const dappUrl = prompt('Enter DApp URL:');
            if (!dappUrl) return;

            // Open DApp in iframe or new window
            const dappWindow = window.open(dappUrl, 'CHEESE DApp', 'width=800,height=600');
            
            if (dappWindow) {
                // Inject wallet provider
                dappWindow.addEventListener('load', () => {
                    // Inject Web3 provider or wallet connector
                    this.injectWalletProvider(dappWindow);
                });
            }

            return { success: true, url: dappUrl };
        } catch (error) {
            console.error('Connect DApp error:', error);
            throw error;
        }
    }

    // Inject wallet provider into DApp window
    injectWalletProvider(targetWindow) {
        try {
            // Inject Web3 provider or wallet connector script
            const script = targetWindow.document.createElement('script');
            script.textContent = `
                // Inject CHEESE wallet provider
                if (typeof window.ethereum === 'undefined') {
                    window.ethereum = {
                        isCHEESEWallet: true,
                        request: async (args) => {
                            // Forward requests to parent window
                            return window.opener.postMessage({
                                type: 'CHEESE_WALLET_REQUEST',
                                method: args.method,
                                params: args.params
                            }, '*');
                        }
                    };
                }
            `;
            targetWindow.document.head.appendChild(script);
        } catch (error) {
            console.error('Inject provider error:', error);
        }
    }

    // Disconnect
    disconnect(connectionId) {
        if (connectionId === 'walletconnect' && this.walletConnect) {
            this.walletConnect.killSession();
        }
        this.connections.delete(connectionId);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConnectManager;
}

