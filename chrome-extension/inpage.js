// inpage.js - EIP-1193 Ethereum Injected Provider for Cheese Wallet
(() => {
    class CheeseProvider {
        constructor() {
            this.isCheese = true;
            this.isMetaMask = true; // Mask as MetaMask to enable auto-detection on generic DApps
            this.connected = false;
            this._listeners = {};
        }

        async request(args) {
            if (!args || typeof args !== 'object') {
                throw new Error('CheeseProvider request: Expected a single object argument');
            }
            const { method, params } = args;
            
            return new Promise((resolve, reject) => {
                const requestId = Math.random().toString(36).substring(2);
                
                // Set up one-time response listener
                const handler = (event) => {
                    if (event.source !== window || !event.data || event.data.type !== 'CHEESE_RPC_RESPONSE') return;
                    if (event.data.requestId === requestId) {
                        window.removeEventListener('message', handler);
                        if (event.data.error) {
                            reject(new Error(event.data.error));
                        } else {
                            resolve(event.data.result);
                        }
                    }
                };
                window.addEventListener('message', handler);

                // Dispatch event to content script
                window.postMessage({
                    type: 'CHEESE_RPC_REQUEST',
                    requestId,
                    method,
                    params
                }, '*');
            });
        }

        on(event, callback) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(callback);
            return this;
        }

        removeListener(event, callback) {
            if (!this._listeners[event]) return this;
            this._listeners[event] = this._listeners[event].filter(l => l !== callback);
            return this;
        }

        _emit(event, data) {
            if (this._listeners[event]) {
                this._listeners[event].forEach(callback => callback(data));
            }
        }
    }

    const provider = new CheeseProvider();
    
    // Inject window.ethereum and window.cheese
    window.cheese = provider;
    
    if (!window.ethereum) {
        window.ethereum = provider;
    }

    // Listen for accountsChanged and chainChanged events from content script
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'CHEESE_ACCOUNTS_CHANGED') {
            provider._emit('accountsChanged', event.data.accounts);
        } else if (event.data.type === 'CHEESE_CHAIN_CHANGED') {
            provider._emit('chainChanged', event.data.chainId);
        }
    });

    console.log('🧀 Cheese Injected Provider Active (window.ethereum / window.cheese)');
})();
