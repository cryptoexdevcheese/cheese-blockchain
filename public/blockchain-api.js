/* 
 * 🚨 STRICT SYNC LOCK - DO NOT ALTER WITHOUT ARCHITECTURAL AUDIT 🚨
 * ----------------------------------------------------------------
 * This script is SHARED across the entire CHEESE ecosystem.
 * MODIFICATION WARNING: Any change here must be mirrored in /wallet/blockchain-api.js
 * and verified against the Unified Configuration (config.js).
 * 
 * Failure to maintain synchronization will break cross-component transaction logic.
 * ----------------------------------------------------------------
 */
/**
 * CHEESE Blockchain API Client
 * Handle communication with the blockchain backend.
 */


class CheeseBlockchainAPI {
    constructor(apiUrl, apiKey) {
        // Prefer injected configuration from unified config.js
        const config = window.CHEESE_CONFIG || {};

        // Production blockchain server URL as fallback
        const productionUrl = config.API_URL || 'https://cheeseblockchain.com';
        // Local development URL as fallback
        const localDevUrl = 'http://https://cheeseblockchain.com';

        // Auto-detect environment: use localhost for local dev, production for deployed
        const isLocalDev = window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1';

        // Set API URL prioritising passed argument, then injected config, then auto-detect/fallback
        if (apiUrl) {
            this.apiUrl = apiUrl;
        } else if (config.API_URL) {
            this.apiUrl = config.API_URL;
        } else {
            // CRITICAL: Default to Production URL, but prefer dynamic origin if served from same domain
            if (window.location.hostname.includes('cheeseblockchain.com')) {
                this.apiUrl = window.location.origin;
            } else {
                this.apiUrl = productionUrl;
            }

            // Only use localhost if explicitly running locally AND NOT file:// protocol
            if (isLocalDev && window.location.protocol !== 'file:') {
                this.apiUrl = localDevUrl;
                console.log('🌐 Environment: Localhost detected and using Local API for testing');
            }
        }

        // Use the API Key passed in or the default one from config
        this.apiKey = apiKey || config.API_KEY || 'REDACTED_DEX_API_KEY';

        // Log which environment we're using
        console.log('🌐 Connected to Blockchain Node:', this.apiUrl);
        
        // CRITICAL: Cache versioning to force purge old ghost tokens
        this.cacheVersion = '4.2';
        this.purgeOldCache();
        
        console.log('✅ Blockchain API initialized (Version: ' + this.cacheVersion + ')');
    }

    // Purge old cache entries to remove ghost tokens
    purgeOldCache() {
        try {
            const currentVersion = localStorage.getItem('cheese_cache_version');
            if (currentVersion !== this.cacheVersion) {
                console.log('🧹 Purging old cache for version:', this.cacheVersion);
                // Find and remove all portfolio and balance cache keys
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('cheese_portfolio_') || 
                        key.startsWith('cheese_balance_') ||
                        key === 'cheeseUserTokens' ||
                        key === 'cheeseTokenPrices' ||
                        key === 'cheeseTokenPricesTime') {
                        console.log('🗑 Removing stale cache key:', key);
                        localStorage.removeItem(key);
                    }
                });
                localStorage.setItem('cheese_cache_version', this.cacheVersion);
            }
        } catch (e) {
            console.error('Failed to purge cache:', e);
        }
    }


    async request(endpoint, options = {}) {
        // Send apiKey via headers instead to avoid Cloudflare WAF issues
        const url = `${this.apiUrl}${endpoint}`;

        // CRITICAL: Log the full URL to debug
        console.log('🔍 API Request:', url);

        const headers = {
            'x-api-key': this.apiKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...options.headers
        };

        // Add timeout handling (default 30 seconds, configurable via options.timeout)
        const timeout = options.timeout || 30000; // 30 seconds default
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.warn(`⏱️ Request timeout after ${timeout}ms: ${endpoint}`);
            controller.abort();
        }, timeout);

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorData;
                let errorText = '';
                try {
                    errorText = await response.text();
                    console.error('❌ API Error Response Text:', errorText);
                    errorData = errorText ? JSON.parse(errorText) : { error: response.statusText };
                } catch (e) {
                    console.error('❌ Failed to parse error response:', e);
                    errorData = { error: errorText || response.statusText || 'Unknown error' };
                }

                const errorMessage = errorData.error || errorData.reason || errorData.message || errorText || `HTTP ${response.status}`;
                console.error('❌ API Error Details:', {
                    status: response.status,
                    statusText: response.statusText,
                    endpoint: endpoint,
                    errorMessage: errorMessage,
                    fullError: errorData,
                    rawResponse: errorText
                });
                throw new Error(errorMessage);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);

            // Check if it's a timeout/abort error
            if (error.name === 'AbortError' || error.message.includes('aborted')) {
                const timeoutError = new Error(`Request timeout after ${timeout}ms. The server may be slow or unavailable. Please try again.`);
                timeoutError.name = 'TimeoutError';
                console.error('⏱️ Request timeout:', endpoint);
                throw timeoutError;
            }

            console.error('API Request Error:', error);
            // Provide more helpful error messages
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                throw new Error('Cannot connect to blockchain server. Please check your internet connection.');
            }
            throw error;
        }
    }

    // Wallet Operations
    async createWallet(password = null) {
        return await this.request('/api/wallet/create', {
            method: 'POST',
            body: JSON.stringify({ password })
        });
    }

    async loadWallet(address, password = null) {
        return await this.request('/api/wallet/load', {
            method: 'POST',
            body: JSON.stringify({ address, password })
        });
    }

    async getBalance(address, forceSync = false) {
        if (!address) return 0;
        const cacheKey = `cheese_balance_${address.toLowerCase()}`;
        
        try {
            console.log('🔍 API: Fetching balance for address:', address, forceSync ? '(FORCE SYNC)' : '');
            const endpoint = `/api/balance/${address}${forceSync ? '?sync=true' : ''}`;
            const result = await this.request(endpoint);
            
            // CRITICAL FIX: Extract balance from response object
            let balance;
            if (typeof result === 'object' && result !== null) {
                balance = result.balance;
            } else if (typeof result === 'number') {
                balance = result;
            } else {
                balance = 0;
            }

            // Ensure balance is a number
            if (typeof balance !== 'number' || isNaN(balance)) {
                balance = parseFloat(balance) || 0;
            }

            // [EMERGENCY CACHE] Save for offline fallback
            localStorage.setItem(cacheKey, JSON.stringify({
                balance,
                timestamp: Date.now()
            }));

            return balance;
        } catch (error) {
            console.warn('⚠️ API: Error fetching balance, trying cache:', error.message);
            
            // [OFFLINE FALLBACK] Read from localStorage cache
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const data = JSON.parse(cached);
                    console.log('💾 API: Using cached balance from:', new Date(data.timestamp).toLocaleString());
                    // Return the balance but tag it so the UI knows it's cached
                    // Note: We return just the number if possible for compatibility, 
                    // but many parts of the wallet handle objects too.
                    return data.balance;
                } catch (e) {}
            }
            throw error;
        }
    }

    async getPortfolio(address, forceSync = false) {
        if (!address) return { portfolio: { 'NCHEESE': 0 } };
        try {
            // Support forceSync via query param
            const result = await this.request(`/api/balance/${address}${forceSync ? '?sync=true' : ''}`);
            return result;
        } catch (error) {
            console.error('❌ API: Error fetching portfolio:', error.message);
            return { portfolio: {} };
        }
    }

    // Transaction Operations
    // Transaction Operations
    async sendTransaction(from, to, amount, privateKey, data = {}, ethProvider = null) {
        // Log IMMEDIATELY - first thing in function
        console.log('📦 ========== BLOCKCHAIN API: sendTransaction() CALLED ==========');
        console.log('📦 Function entry point reached');
        console.log('📦 Parameters received:', {
            from: from ? from.substring(0, 10) + '...' : 'null',
            to: to ? to.substring(0, 10) + '...' : 'null',
            amount: amount,
            hasPrivateKey: !!privateKey && privateKey !== 'null',
            hasData: !!data,
            hasEthProvider: !!ethProvider
        });

        const isKeyless = !privateKey || privateKey === 'null' || privateKey === 'undefined' || privateKey === '';

        // If Web3 wallet (MetaMask, Binance Web3, Trust Wallet) is connected and keyless:
        const activeProvider = ethProvider || (typeof getActiveWalletProvider === 'function' ? getActiveWalletProvider() : (typeof window !== 'undefined' ? (window.ethereum || window.binancew3w || window.trustwallet) : null));

        if (isKeyless && activeProvider) {
            console.log('🌐 EVM Web3 Provider detected, submitting on-chain via Web3 wallet...');
            try {
                // Hex-encoded value in Wei (6 decimals for NCH native)
                const amountVal = Number(amount) || 0;
                const hexVal = '0x' + BigInt(Math.floor(amountVal * 1000000)).toString(16);
                
                let txHash;
                if (typeof safeRequest === 'function') {
                    txHash = await safeRequest(activeProvider, 'eth_sendTransaction', [{
                        from: from,
                        to: to,
                        value: hexVal
                    }]);
                } else if (typeof activeProvider.request === 'function') {
                    txHash = await activeProvider.request({
                        method: 'eth_sendTransaction',
                        params: [{ from: from, to: to, value: hexVal }]
                    });
                }

                if (txHash) {
                    return { success: true, transactionHash: txHash, hash: txHash };
                }
            } catch (web3TxErr) {
                console.warn('EVM eth_sendTransaction failed/cancelled, falling back to signature route:', web3TxErr);
                if (web3TxErr && web3TxErr.code === 4001) {
                    throw new Error('Transaction cancelled in wallet.');
                }
            }
        }

        const transactionData = {
            from,
            to,
            amount,
            timestamp: Date.now(),
            data: data || {},
            fee: 0.05
        };

        let signature;
        try {
            signature = await this.signTransaction(transactionData, privateKey);
        } catch (signError) {
            console.error('❌ signTransaction() FAILED:', signError);
            throw signError;
        }

        const requestBody = {
            from,
            to,
            amount,
            currency: transactionData.data?.currency || 'NCH',
            fee: transactionData.fee || 0.05,
            signature,
            data: transactionData.data,
            timestamp: transactionData.timestamp
        };

        return await this.request('/api/transaction', {
            method: 'POST',
            body: JSON.stringify(requestBody),
            timeout: 60000
        });
    }

    // Recover Legacy Assets (Auto-Migration)
    async recoverLegacyAssets(privateKey) {
        console.log('🔄 Calling Legacy Recovery API...');
        return await this.request('/api/recover-legacy', {
            method: 'POST',
            body: JSON.stringify({ privateKey }),
            timeout: 60000
        });
    }

    // Sign transaction data with private key (matches blockchain format)
    async signTransaction(transactionData, privateKey) {
        console.log('📦 ========== signTransaction() ENTRY POINT ==========');
        const isKeyless = !privateKey || privateKey === 'null' || privateKey === 'undefined' || privateKey === '';

        // 0. Web3 Injected Wallet fallback if privateKey is not provided
        if (isKeyless && typeof window !== 'undefined') {
            const provider = typeof getActiveWalletProvider === 'function'
                ? getActiveWalletProvider()
                : (window.ethereum || window.binancew3w || window.trustwallet);

            if (provider && transactionData && transactionData.from) {
                console.log('🌐 Web3 Provider detected for keyless signing via personal_sign');
                const msg = JSON.stringify(transactionData);
                let hexMsg = msg;
                if (!msg.startsWith('0x')) {
                    const encoder = new TextEncoder();
                    const bytes = encoder.encode(msg);
                    hexMsg = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
                }

                let sigHex;
                if (typeof safeRequest === 'function') {
                    sigHex = await safeRequest(provider, 'personal_sign', [hexMsg, transactionData.from]);
                } else if (typeof provider.request === 'function') {
                    sigHex = await provider.request({ method: 'personal_sign', params: [hexMsg, transactionData.from] });
                }

                if (sigHex) {
                    return {
                        r: sigHex.substring(2, 66) || '00',
                        s: sigHex.substring(66, 130) || '00',
                        v: parseInt(sigHex.substring(130, 132), 16) || 27,
                        signature: sigHex,
                        publicKey: transactionData.from,
                        signerAddress: transactionData.from,
                        isWeb3Signed: true
                    };
                }
            }
            throw new Error('Private key is missing and no Web3 wallet is available to sign transaction.');
        }

        const safePrivateKey = (privateKey || '').toString();

        // Use elliptic curve cryptography (secp256k1) to match blockchain
        // Load elliptic library dynamically if needed
        console.log('📦 Checking window.elliptic...');
        console.log('📦 typeof window:', typeof window);
        console.log('📦 window.elliptic exists?', typeof window !== 'undefined' && !!window.elliptic);

        // LOCAL FILE APPROACH: Try to load elliptic dynamically if not loaded
        if (typeof window !== 'undefined' && !window.elliptic) {
            console.log('📦 Elliptic not loaded yet, loading dynamically...');
            try {
                await this.loadEllipticLibrary();
            } catch (loadError) {
                console.error('❌ Failed to load elliptic library dynamically:', loadError);
            }

            // Short fallback verification
            if (!window.elliptic) {
                console.log('📦 Waiting up to 5 seconds for elliptic library to initialize...');
                let loaded = false;
                for (let i = 0; i < 50; i++) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    if (window.elliptic) {
                        loaded = true;
                        break;
                    }
                    if (window.ellipticjs || window.Elliptic) {
                        window.elliptic = window.ellipticjs || window.Elliptic;
                        loaded = true;
                        break;
                    }
                }
                if (!loaded) {
                    throw new Error('Elliptic library failed to initialize.');
                }
            }
        } else {
            console.log('✅ Elliptic library already available');
        }

        console.log('📦 Final check: window.elliptic?', typeof window !== 'undefined' && !!window.elliptic);

        if (typeof window === 'undefined' || !window.elliptic) {
            console.error('❌ CRITICAL: Elliptic library still not available!');
            throw new Error('Elliptic library is required for transaction signing but is not available. Please refresh the page.');
        }

        // CRITICAL: Try to get public key even if elliptic seems unavailable
        let keyPair = null;
        let publicKeyHex = null;

        console.log('📦 About to create keyPair...');
        try {
            // Use elliptic if available (matches blockchain format exactly)
            if (typeof window !== 'undefined' && window.elliptic) {
                console.log('📦 window.elliptic is available');
                console.log('📦 window.elliptic.ec exists?', !!window.elliptic.ec);
                const EC = window.elliptic.ec;
                console.log('📦 EC constructor:', typeof EC);
                const ec = new EC('secp256k1');
                console.log('📦 EC instance created');
                console.log('📦 About to create keyPair from private key...');
                const privateKeyHex = safePrivateKey.replace(/^0x/, '');
                console.log('📦 Private key hex length:', privateKeyHex.length);
                keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
                console.log('✅ keyPair created');

                // Get public key in uncompressed format (130 hex chars starting with 04)
                console.log('📦 Getting public key...');
                publicKeyHex = keyPair.getPublic(false, 'hex'); // false = uncompressed
                console.log('✅ Public key obtained, length:', publicKeyHex.length);
                console.log('📦 Public key starts with 04?', publicKeyHex.startsWith('04'));

                // Validate it's the correct format
                if (publicKeyHex.length !== 130 || !publicKeyHex.startsWith('04')) {
                    console.warn('⚠️ Public key format issue, trying alternative...');
                    // If not correct, try alternative method
                    const publicKey = keyPair.getPublic('hex');
                    if (publicKey.length === 130 && publicKey.startsWith('04')) {
                        publicKeyHex = publicKey;
                    } else {
                        // Force uncompressed format
                        publicKeyHex = keyPair.getPublic(false, 'hex');
                    }
                }

                // Final validation
                if (publicKeyHex.length !== 130 || !publicKeyHex.startsWith('04')) {
                    console.warn('⚠️ Public key format issue:', {
                        length: publicKeyHex.length,
                        startsWith04: publicKeyHex.startsWith('04'),
                        firstChars: publicKeyHex.substring(0, 10)
                    });
                    throw new Error('Invalid public key format');
                }
            } else {
                throw new Error('Elliptic library not available');
            }
        } catch (error) {
            console.error('❌ Failed to initialize elliptic or get public key:', error);
            // Try one more time to load elliptic
            if (typeof window !== 'undefined' && !window.elliptic) {
                console.log('🔄 Retrying elliptic library load...');
                await this.loadEllipticLibrary();
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait for library to initialize

                if (typeof window !== 'undefined' && window.elliptic) {
                    try {
                        const EC = window.elliptic.ec;
                        const ec = new EC('secp256k1');
                        keyPair = ec.keyFromPrivate(privateKey.replace(/^0x/, ''), 'hex');
                        publicKeyHex = keyPair.getPublic(false, 'hex');

                        if (publicKeyHex.length !== 130 || !publicKeyHex.startsWith('04')) {
                            throw new Error('Invalid public key format after retry');
                        }
                    } catch (retryError) {
                        console.error('❌ Retry also failed:', retryError);
                        throw new Error('Cannot sign transaction: Elliptic library unavailable and public key cannot be derived');
                    }
                } else {
                    throw new Error('Cannot sign transaction: Elliptic library unavailable and public key cannot be derived');
                }
            } else {
                throw new Error('Cannot sign transaction: ' + error.message);
            }
        }

        // Now sign the transaction
        try {
            // Create transaction data object (matches blockchain format)
            // CRITICAL: Property order MUST match server-side exactly!
            // Server uses: { from, to, amount, timestamp, data }
            const data = {
                from: transactionData.from,
                to: transactionData.to,
                amount: transactionData.amount,
                timestamp: transactionData.timestamp,
                data: transactionData.data || {}
            };

            // Helper for deterministic hashing (Matches Server Logic)
            const sortObjectKeys = (obj) => {
                if (obj === null || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(item => sortObjectKeys(item));
                const sorted = {};
                Object.keys(obj).sort().forEach(key => {
                    sorted[key] = sortObjectKeys(obj[key]);
                });
                return sorted;
            };

            // UPDATE: Added 'fee' to sorted keys to enforce fee signing
            const sortedKeys = ['amount', 'data', 'fee', 'from', 'timestamp', 'to']; // Explicit order

            // Ensure data object is also consistently stringified
            const normalizedData = {
                amount: data.amount,
                data: sortObjectKeys(data.data || {}), // <--- APPLY SORT HERE
                fee: data.fee || 0.05, // Default fee if missing
                from: data.from,
                timestamp: data.timestamp,
                to: data.to
            };

            console.log('📦 About to stringify transaction data...');
            const dataString = `{` +
                `"amount":${JSON.stringify(normalizedData.amount)},` +
                `"data":${JSON.stringify(normalizedData.data)},` +
                `"fee":${JSON.stringify(normalizedData.fee)},` +
                `"from":${JSON.stringify(normalizedData.from)},` +
                `"timestamp":${JSON.stringify(normalizedData.timestamp)},` +
                `"to":${JSON.stringify(normalizedData.to)}` +
                `}`;
            console.log('✅ Transaction data stringified');
            console.log('🔍 Client: Transaction data string:', dataString);
            console.log('🔍 Client: Transaction data object:', normalizedData);

            console.log('📦 About to create hash...');
            const encoder = new TextEncoder();
            const dataBytes = encoder.encode(dataString);
            console.log('✅ Data encoded to bytes');
            const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
            console.log('✅ Hash buffer created');
            const msgHash = Array.from(new Uint8Array(hashBuffer))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            console.log('✅ Message hash created:', msgHash.substring(0, 20) + '...');

            // Sign with keyPair
            console.log('📦 About to sign with keyPair...');
            if (!keyPair) {
                console.error('❌ KeyPair is null!');
                throw new Error('KeyPair not initialized');
            }
            console.log('✅ KeyPair exists, signing...');
            const signature = keyPair.sign(msgHash);
            console.log('✅ Signature created');

            // Return signature in blockchain format (object, not string)
            // CRITICAL: publicKey is ALWAYS included (never null)
            return {
                r: signature.r.toString('hex'),
                s: signature.s.toString('hex'),
                recoveryParam: signature.recoveryParam,
                publicKey: publicKeyHex // Uncompressed public key (130 hex chars starting with 04) - ALWAYS present
            };
        } catch (error) {
            console.error('❌ Signing error:', error);
            throw new Error('Failed to sign transaction: ' + error.message);
        }
    }
    // Load elliptic library dynamically
    async loadEllipticLibrary() {
        console.log('📦 ========== loadEllipticLibrary() called ==========');

        return new Promise((resolve, reject) => {
            console.log('📦 Checking if elliptic already loaded...');
            if (typeof window !== 'undefined' && window.elliptic) {
                console.log('✅ Elliptic library already loaded');
                resolve();
                return;
            }

            console.log('📦 Elliptic not loaded, checking for existing script tag...');
            // Check if script is already being loaded
            const existingScript = document.querySelector('script[src*="elliptic"]');
            if (existingScript) {
                console.log('📦 Found existing script tag');
                console.log('📦 Script src:', existingScript.src);
                console.log('📦 Script readyState:', existingScript.readyState);
                console.log('📦 Script onload exists?', !!existingScript.onload);
                console.log('📦 Script onerror exists?', !!existingScript.onerror);

                // Check if script already loaded but window.elliptic not set
                if (existingScript.readyState === 'complete' || existingScript.readyState === 'loaded') {
                    console.log('📦 Script tag shows as loaded, but window.elliptic not available');
                    console.log('📦 Checking window object for elliptic...');
                    console.log('📦 window keys containing "elliptic":', Object.keys(window).filter(k => k.toLowerCase().includes('elliptic')));

                    // Try waiting a bit more - sometimes library needs time to initialize
                    // Use setInterval instead of await in Promise constructor
                    let waitCount = 0;
                    const waitInterval = setInterval(() => {
                        waitCount++;
                        if (typeof window !== 'undefined' && window.elliptic) {
                            clearInterval(waitInterval);
                            console.log(`✅ Elliptic library available after ${waitCount * 200}ms wait`);
                            resolve();
                            return;
                        }

                        if (waitCount >= 10) {
                            clearInterval(waitInterval);

                            // Script loaded but elliptic not available - check if it's a different global name
                            console.log('📦 Script loaded but window.elliptic not found');
                            console.log('📦 Checking for alternative global names...');
                            console.log('📦 window.ellipticjs?', typeof window !== 'undefined' && !!window.ellipticjs);
                            console.log('📦 window.Elliptic?', typeof window !== 'undefined' && !!window.Elliptic);

                            // Try to access via different methods
                            if (typeof window !== 'undefined') {
                                const possibleNames = ['elliptic', 'ellipticjs', 'Elliptic', 'EC'];
                                for (const name of possibleNames) {
                                    if (window[name]) {
                                        console.log(`✅ Found elliptic at window.${name}, assigning to window.elliptic`);
                                        window.elliptic = window[name];
                                        resolve();
                                        return;
                                    }
                                }
                            }

                            // Script loaded but elliptic not available - remove and reload
                            console.log('📦 Removing failed script tag and trying new CDN...');
                            existingScript.remove();
                            // Continue to create new script below
                        }
                    }, 200);
                    return; // Exit early, will continue below if needed
                } else {
                    console.log('📦 Script tag not yet loaded, waiting...');
                    const checkInterval = setInterval(() => {
                        if (typeof window !== 'undefined' && window.elliptic) {
                            clearInterval(checkInterval);
                            console.log('✅ Elliptic library loaded from existing script');
                            resolve();
                        }
                    }, 100);

                    // Timeout after 10 seconds
                    setTimeout(() => {
                        clearInterval(checkInterval);
                        if (typeof window !== 'undefined' && window.elliptic) {
                            console.log('✅ Elliptic library loaded (timeout check)');
                            resolve();
                        } else {
                            console.error('❌ Existing script tag did not load elliptic in time');
                            console.error('❌ Removing failed script and trying alternative...');
                            existingScript.remove();
                            // Continue to create new script below
                        }
                    }, 10000);

                    existingScript.onerror = () => {
                        clearInterval(checkInterval);
                        console.error('❌ Existing script tag failed to load');
                        existingScript.remove();
                        // Continue to create new script below
                    };

                    // If script is still loading, wait for it
                    if (existingScript.readyState !== 'complete' && existingScript.readyState !== 'loaded') {
                        return; // Wait for timeout or onload
                    }
                }
            }

            console.log('📦 Creating new script tag...');
            // Try local file first, then CDNs as fallback
            const cdnUrls = [
                '/wallet/elliptic.min.js',  // Local file (same domain, absolute path, no CORS issues)
                'https://cdn.jsdelivr.net/npm/elliptic@6.5.4/dist/elliptic.min.js',
                'https://unpkg.com/elliptic@6.5.4/dist/elliptic.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/elliptic/6.5.4/elliptic.min.js'
            ];

            const tryLoadFromCDN = (index) => {
                if (index >= cdnUrls.length) {
                    reject(new Error('All CDN sources failed to load elliptic library'));
                    return;
                }

                console.log(`📦 Trying CDN ${index + 1}/${cdnUrls.length}: ${cdnUrls[index]}`);
                const script = document.createElement('script');
                script.src = cdnUrls[index];
                script.async = false;
                script.crossOrigin = 'anonymous';

                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        console.error(`❌ CDN ${index + 1} timeout, trying next...`);
                        script.remove();
                        if (index + 1 < cdnUrls.length) {
                            tryLoadFromCDN(index + 1);
                        } else {
                            reject(new Error('All CDN sources timed out'));
                        }
                    }
                }, 10000); // 10 second timeout per CDN

                script.onload = () => {
                    if (resolved) return;
                    clearTimeout(timeout);
                    // Wait longer for library to initialize
                    setTimeout(() => {
                        if (typeof window !== 'undefined' && window.elliptic) {
                            console.log(`✅ Elliptic library loaded successfully from CDN ${index + 1}`);
                            resolved = true;
                            resolve();
                        } else {
                            console.error(`❌ CDN ${index + 1} script loaded but window.elliptic not available`);
                            script.remove();
                            if (index + 1 < cdnUrls.length) {
                                console.log(`📦 Trying next CDN...`);
                                tryLoadFromCDN(index + 1);
                            } else {
                                resolved = true;
                                reject(new Error('All CDNs loaded but window.elliptic not available'));
                            }
                        }
                    }, 1000); // Wait 1 second for library to initialize
                };

                script.onerror = () => {
                    if (resolved) return;
                    clearTimeout(timeout);
                    console.error(`❌ CDN ${index + 1} failed, trying next...`);
                    script.remove();
                    if (index + 1 < cdnUrls.length) {
                        tryLoadFromCDN(index + 1);
                    } else {
                        resolved = true;
                        reject(new Error('All CDN sources failed to load'));
                    }
                };

                console.log(`📦 Appending script to document.head (CDN ${index + 1})...`);
                document.head.appendChild(script);
                console.log(`✅ Script tag appended, waiting for load...`);
            };

            // Start loading from first CDN
            tryLoadFromCDN(0);
        });
    }

    // Helper: Convert hex string to ArrayBuffer
    hexToArrayBuffer(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes.buffer;
    }

    async getTransactionHistory(address) {
        try {
            console.log(`📜 Fetching full transaction history for: ${address}`);
            const result = await this.request(`/api/transactions/${address}`);
            
            if (result && result.success && result.transactions) {
                console.log(`✅ Received ${result.transactions.length} transactions (confirmed + pending)`);
                return result.transactions;
            }
            
            // Fallback for unexpected format
            if (Array.isArray(result)) return result;
            if (result && Array.isArray(result.transactions)) return result.transactions;
            
            throw new Error('Invalid transaction history response format');
        } catch (error) {
            console.warn('⚠️ Dedicated transaction history endpoint failed, falling back to manual block scan:', error);
            
            // FALLBACK: Manual scan (original logic)
            try {
                const blockchain = await this.getBlockchainInfo();
                const transactions = [];

                if (blockchain.chain) {
                    blockchain.chain.forEach(block => {
                        if (block.transactions) {
                            block.transactions.forEach(tx => {
                                const txFrom = (tx.from || '').toLowerCase();
                                const txTo = (tx.to || '').toLowerCase();
                                const targetAddress = address.toLowerCase();
                                if (txFrom === targetAddress || txTo === targetAddress) {
                                    transactions.push({
                                        ...tx,
                                        blockIndex: block.index,
                                        blockHash: block.hash,
                                        timestamp: block.timestamp
                                    });
                                }
                            });
                        }
                    });
                }
                return transactions.sort((a, b) => b.timestamp - a.timestamp);
            } catch (fallbackError) {
                console.error('❌ Manual transaction scan also failed:', fallbackError);
                return [];
            }
        }
    }

    // Blockchain Info
    async getBlockchainInfo() {
        return await this.request('/api/blockchain');
    }

    // Alias for getChain (used by mobile miner)
    async getChain() {
        return await this.getBlockchainInfo();
    }

    // Get pending transactions
    async getPendingTransactions() {
        try {
            const response = await this.request('/api/transactions/pending');
            return response.transactions || [];
        } catch (error) {
            // If endpoint doesn't exist, try alternative endpoint or return empty array
            if (error.message.includes('404') || error.message.includes('not found') || error.message.includes('Endpoint not found')) {
                console.warn('⚠️ Pending transactions endpoint not available, trying alternative...');
                try {
                    // Try to get from blockchain info if it includes pending transactions
                    const blockchainInfo = await this.getBlockchainInfo();
                    if (blockchainInfo && blockchainInfo.pendingTransactions) {
                        return blockchainInfo.pendingTransactions;
                    }
                } catch (e) {
                    // Ignore
                }
                // Return empty array if no alternative available
                return [];
            }
            throw error;
        }
    }

    async getNetworkStatus() {
        return await this.request('/api/network/peers');
    }

    async getPortfolio(address, forceSync = false) {
        const endpoint = `/api/balance/${address}${forceSync ? '?sync=true' : ''}`;
        return this.request(endpoint);
    }

    async getTokenomics() {
        return await this.request('/api/tokenomics');
    }

    // Mining
    async mineBlock(minerAddress, blockData = null) {
        try {
            if (!minerAddress) {
                throw new Error('Miner address is required');
            }

            // Validate address format
            const cleanAddress = minerAddress.replace(/^0x/, '');
            if (!/^[0-9a-fA-F]{40}$/.test(cleanAddress)) {
                throw new Error('Invalid miner address format');
            }

            if (blockData) {
                // Submit pre-mined block
                return await this.request('/api/mine', {
                    method: 'POST',
                    body: JSON.stringify({
                        minerAddress: minerAddress,
                        block: blockData
                    })
                });
            } else {
                // Server-side mining - ensure minerAddress is sent correctly
                const requestBody = { minerAddress: minerAddress };
                console.log('⛏️ Mining request to:', this.apiUrl + '/api/mine');
                console.log('⛏️ Mining request body:', requestBody);

                const result = await this.request('/api/mine', {
                    method: 'POST',
                    body: JSON.stringify(requestBody)
                });

                console.log('⛏️ Mining response:', result);

                // Handle different response formats
                if (result.block) {
                    return { success: true, block: result.block };
                } else if (result.success !== undefined) {
                    return result;
                } else {
                    // If response is a block directly
                    return { success: true, block: result };
                }
            }
        } catch (error) {
            console.error('❌ Mine block error:', error);
            console.error('Error details:', {
                message: error.message,
                endpoint: this.apiUrl + '/api/mine',
                minerAddress: minerAddress
            });

            // Provide better error message
            if (error.message.includes('minerAddress') || error.message.includes('Miner address')) {
                throw new Error('Mining failed: Miner address is required');
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                throw new Error('Cannot connect to blockchain server. Please check your internet connection.');
            } else if (error.message.includes('503') || error.message.includes('initializing')) {
                throw new Error('Blockchain server is initializing. Please try again in a moment.');
            }
            throw error;
        }
    }

    async getMiningStatus() {
        return await this.request('/api/mining/status');
    }

    // Health Check
    async healthCheck() {
        return await this.request('/api/health');
    }

    // Bridge Operations
    async mintTokens(toAddress, amount, reason = 'bridge_in') {
        // Mint tokens for bridge-in operations
        return await this.request('/api/bridge/mint', {
            method: 'POST',
            body: JSON.stringify({
                to: toAddress,
                amount: amount,
                reason: reason
            })
        });
    }

    async verifyBridgeTransaction(fromChain, transactionHash, amount, recipient) {
        // Verify bridge transaction on backend
        return await this.request('/api/bridge/verify', {
            method: 'POST',
            body: JSON.stringify({
                fromChain: fromChain,
                transactionHash: transactionHash,
                amount: amount,
                recipient: recipient
            })
        });
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CheeseBlockchainAPI;
}
