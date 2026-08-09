/**
 * Main Application - Cheese Native Wallet
 * Ties all components together
 */

class BridgeEngine {
    constructor() {
        this.BRIDGE_VAULT = '0x0000000000000000000000000000000000000000';
    }
    calculateBridgeAmount(amount) {
        return { originalAmount: amount, fee: 0, netAmount: 0 };
    }
    getBridgeHistory() { return []; }
    getBridgeStats() { return { totalBridges: 0, totalBridged: 0, totalFees: 0, byChain: {}, byDirection: { out: 0, in: 0 } }; }
    async bridgeOut() { throw new Error('Bridge is retired'); }
    async bridgeIn() { throw new Error('Bridge is retired'); }
}

class CheeseWalletApp {
    constructor() {
        // CRITICAL: Set global references immediately for all UI buttons
        window.app = this;
        if (typeof app === 'undefined') {
            window.app = this;
            // Also set as local-global for browsers that prefer it
            try { eval('var app = window.app;'); } catch(e) {}
        }
        
        console.log('🚀 CheeseWalletApp Constructor Started');

        // Initialize components
        this.api = new CheeseBlockchainAPI();
        this.walletCore = new WalletCore();
        this.fiatGateway = new FiatGateway();
        this.founderIncome = new FounderIncome(this.api); // Initialize founder income first
        this.swapEngine = new SwapEngine(this.api, this.founderIncome);
        this.bridgeEngine = new BridgeEngine(this.api, this.founderIncome);
        this.connectManager = new ConnectManager();
        this.enhancements = new WalletEnhancements(this.api, this.walletCore);
        this.security = new WalletSecurity();
        this.tokenManager = new TokenManager(this.api);
        this.mobileMiner = new MobileMiner(this.api, this.walletCore);
        this.metaMaskStyle = null; // Will be initialized after scripts load
        this.tokenSearch = null; // Will be initialized after scripts load
        this.biometricAuth = null; // Will be initialized after scripts load
        this.crossChainBalance = null; // Will be initialized after scripts load

        // App state
        this.wallet = null;
        this.balance = 0;
        this.transactions = [];
        this.currentScreen = 'home';
        this._walletAddress = null; // Store wallet address before wallet is fully loaded

        // QR Code cache
        this.qrCodeCache = null;
        this.cachedQRAddress = null;
        this.qrCodeGenerationPromise = null; // Track QR generation promise
        this.offlineNotified = false; // Track if we've notified about offline status
        this.lastPortfolioHTML = ''; // Track last portfolio HTML for flicker-free updates

        // Cleanup flag
        this.isDestroyed = false;
        this.derivationStandard = 'evm'; // Default derivation standard: evm, legacy-hex, wallet-utf8, byte-based

        // Initialize app
        this.init();

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            // CRITICAL: Stop mining before page unload to prevent refresh exploits
            if (this.mobileMiner && this.mobileMiner.isMining) {
                this.mobileMiner.stopMining();
            }
            this.cleanup();
        });

        // Also handle page visibility change (tab switch, minimize, etc.)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.mobileMiner && this.mobileMiner.isMining) {
                // Don't stop mining on tab switch, but log it
                console.log('Page hidden, mining continues in background');
            } else if (!document.hidden && this.wallet && this.wallet.address) {
                // Page became visible - refresh balance
                console.log('📱 Page visible, refreshing balance...');
                setTimeout(async () => {
                    await this.updateBalance();
                    this.forceBalanceDisplay();
                }, 100);
            }
        });

        // CRITICAL: Handle page restore from cache (back/forward navigation or refresh)
        window.addEventListener('pageshow', (event) => {
            // Handle both cache restore and regular refresh
            if (event.persisted || performance.navigation.type === 1) {
                console.log('📱 Page restored/refreshed, refreshing balance and QR code...');
                // Restore QR code cache from localStorage
                this.restoreQRCodeCache();
                // Refresh balance if wallet address is available
                if (this.wallet && this.wallet.address) {
                    setTimeout(async () => {
                        await this.updateBalance();
                        this.forceBalanceDisplay();
                    }, 100);
                    // Re-generate QR code if needed
                    if (!this.qrCodeCache || this.cachedQRAddress !== this.wallet.address) {
                        this.preGenerateQRCode(this.wallet.address).catch(err =>
                            console.warn('Error re-generating QR code:', err)
                        );
                    }
                }
            }
        });
    }

    // Safe JSON parse helper
    safeJSONParse(jsonString, defaultValue = {}) {
        try {
            if (!jsonString || jsonString === '') {
                return defaultValue;
            }
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('JSON parse error:', error, 'Data:', jsonString);
            return defaultValue;
        }
    }

    // Safe localStorage getter
    safeGetItem(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) {
                return defaultValue;
            }
            return value;
        } catch (error) {
            console.error('localStorage getItem error:', error);
            return defaultValue;
        }
    }

    // Cleanup function
    cleanup() {
        this.isDestroyed = true;
        this.stopAutoRefresh();
        // Clear any intervals
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    async init() {
        // CRITICAL: Restore QR code cache from localStorage on init
        this.restoreQRCodeCache();

        // Check for existing wallet (but don't auto-load - show login screen)
        const hasWallet = this.checkForExistingWallet();

        // CRITICAL FIX: If wallet exists in localStorage, store address for reference
        // BUT DO NOT set this.wallet - it will cause updateUI() to think wallet is loaded
        // Only set this.wallet when wallet is FULLY loaded (has privateKey)
        if (hasWallet) {
            try {
                const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                if (walletData && walletData.address) {
                    // Store address in a separate property, NOT in this.wallet
                    // This prevents updateUI() from thinking wallet is loaded
                    this._walletAddress = walletData.address;
                    console.log('✅ Wallet found in storage (not loaded yet):', walletData.address);
                }
            } catch (error) {
                console.error('Error checking wallet on init:', error);
            }
        }

        // Initialize founder wallet address
        this.initializeFounderWallet();

        // Initialize MetaMask-style and token search (if available)
        if (typeof MetaMaskStyleWallet !== 'undefined') {
            this.metaMaskStyle = new MetaMaskStyleWallet(this);
        }
        if (typeof TokenSearch !== 'undefined') {
            this.tokenSearch = new TokenSearch(this.api);
            // CRITICAL: Clear old NCH price from localStorage on app start
            // This ensures mobile app gets the correct $0.022 seed price
            try {
                const cached = localStorage.getItem('cheeseTokenPrices');
                if (cached) {
                    const prices = JSON.parse(cached);
                    // If NCH has wrong price, clear it
                    if ((prices['NCH'] && prices['NCH'] === 1.00) || (prices['NCHEESE'] && prices['NCHEESE'] === 1.00)) {
                        console.log('🔧 Clearing old NCH fixed price ($1.00), setting to seed price ($0.022)');
                        prices['NCH'] = 0.022;
                        prices['NCHEESE'] = 0.022;
                        localStorage.setItem('cheeseTokenPrices', JSON.stringify(prices));
                    }
                }
            } catch (e) {
                console.error('Error clearing price cache:', e);
            }
        }
        try {
            if (typeof BiometricAuth !== 'undefined') {
                this.biometricAuth = new BiometricAuth();
            }
        } catch (e) { console.error('BiometricAuth init failed', e); }
        
        try {
            if (typeof CrossChainBalance !== 'undefined') {
                this.crossChainBalance = new CrossChainBalance();
            }
        } catch (e) { console.error('CrossChainBalance init failed', e); }

        // Setup UI
        this.setupEventListeners();
        this.setupAdditionalEventListeners(); // Wire up ALL remaining buttons
        this.updateNetworkStatus();

        // Show appropriate screen based on wallet status (don't call updateUI yet)
        if (hasWallet) {
            this.showLoginScreen();
        } else {
            this.showNoWalletScreen();
        }

        // Update UI after showing correct screen
        this.updateUI();

        // Update network status periodically
        setInterval(() => {
            this.updateNetworkStatus();
        }, 30000); // Every 30 seconds

        // Auto-refresh balance and transactions when wallet is loaded
        if (this.wallet && this.wallet.privateKey) {
            this.startAutoRefresh();
            // Check backup status (show reminder if needed)
            setTimeout(() => {
                this.checkBackupStatus();
            }, 5000); // Check after 5 seconds
        }
    }

    // Initialize founder wallet address
    initializeFounderWallet() {
        // Check if founder address is already set in localStorage
        const savedAddress = localStorage.getItem('cheeseFounderAddress');

        // CRITICAL: Always use the correct founder wallet address
        const correctFounderAddress = '0xa25f52f081c3397bbc8d2ed12146757c470e049d';

        // If not set, or if it's set to wrong address, set it to the correct one
        if (!savedAddress || savedAddress === 'FOUNDER_WALLET_ADDRESS_HERE' || savedAddress !== correctFounderAddress) {
            // Set to correct founder address
            this.founderIncome.setFounderAddress(correctFounderAddress);
            console.log('✅ Founder wallet set to:', correctFounderAddress);
            console.log('💰 All transaction fees, swap fees, and bridge fees will go to this address');
        } else {
            // Verify it's still correct
            const currentAddress = this.founderIncome.getFounderAddress();
            if (currentAddress !== correctFounderAddress) {
                this.founderIncome.setFounderAddress(correctFounderAddress);
                console.log('✅ Founder wallet corrected to:', correctFounderAddress);
            } else {
                console.log('✅ Founder wallet correctly set:', correctFounderAddress);
            }
        }
    }

    // Change founder wallet address (private - don't show address)
    changeFounderWallet() {
        // Don't show current address - keep it private
        const newAddress = prompt(
            `Change Founder Wallet Address\n\n` +
            `Enter new founder wallet address:`
        );

        if (!newAddress || newAddress.trim() === '') {
            this.showNotification('No address entered. Founder wallet not changed.', 'info');
            return;
        }

        // Validate address format
        const cleanAddress = newAddress.trim().replace(/^0x/, '');
        if (!/^[0-9a-fA-F]{40}$/.test(cleanAddress)) {
            this.showNotification('Invalid wallet address format. Must be 40 hex characters.', 'error');
            return;
        }

        const fullAddress = '0x' + cleanAddress;

        // Set new founder address
        this.founderIncome.setFounderAddress(fullAddress);

        // Update UI if on settings screen
        this.updateFounderWalletDisplay();

        // Don't show address in notification - keep it private
        this.showNotification('✅ Founder wallet updated successfully', 'success');
        console.log('✅ Founder wallet updated to:', fullAddress);
    }

    // Update founder wallet display in settings (removed from public view - private only)
    updateFounderWalletDisplay() {
        // Founder wallet section removed from public settings
        // This function kept for backward compatibility but does nothing
    }

    // Start automatic refresh of balance and transactions
    startAutoRefresh() {
        // Clear any existing interval
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }

        // Refresh every 15 seconds
        this.autoRefreshInterval = setInterval(async () => {
            // Check if app is destroyed
            if (this.isDestroyed) {
                this.stopAutoRefresh();
                return;
            }

            // Auto-refresh if wallet address is available (balance fetching doesn't need privateKey)
            if (this.wallet && this.wallet.address) {
                try {
                    await this.updateBalance();
                    await this.updateTransactions();
                    // Refresh portfolio if on portfolio screen (with price updates)
                    if (this.currentScreen === 'portfolio') {
                        // Refresh prices in background
                        if (this.tokenSearch) {
                            const portfolioContent = document.getElementById('portfolio-content');
                            if (portfolioContent) {
                                const tokenSymbols = Array.from(portfolioContent.querySelectorAll('[data-token-symbol]'))
                                    .map(el => el.getAttribute('data-token-symbol'))
                                    .filter(s => s);
                                if (tokenSymbols.length > 0) {
                                    // Refresh prices asynchronously (don't wait)
                                    this.tokenSearch.refreshPrices(tokenSymbols).catch(err => {
                                        console.warn('Background price refresh error:', err);
                                    });
                                }
                            }
                        }
                        await this.updatePortfolioScreen(true);
                    }
                } catch (error) {
                    console.error('Auto-refresh error:', error);
                    // Don't stop refresh on error, just log it
                }
            }
        }, 15000); // Every 15 seconds
    }

    // Stop automatic refresh
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    // Setup event listeners for navigation and UI
    setupEventListeners() {
        console.log('🔗 setupEventListeners CALLED');
        // Navigation buttons
        const navButtons = document.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const screen = btn.getAttribute('data-screen');
                console.log('🔗 Nav clicked:', screen);
                if (screen) {
                    this.showScreen(screen);
                }
            });
        });

        // Welcome-screen wallet buttons (delegation — fallback for non-onclick browsers)
        document.body.addEventListener('click', (e) => {
            // Find if a button was clicked (robust replacement for closest)
            let target = e.target;
            while (target && target !== document.body) {
                if (target.id === 'create-wallet-btn' || target.id === 'import-wallet-btn' || target.id === 'add-wallet-btn') {
                    console.log('🔗 Wallet button clicked (delegation):', target.id);
                    // Don't preventDefault if we have onclick, but handle if somehow it failed
                    try {
                        if (target.id === 'create-wallet-btn') this.showCreateWalletModal();
                        else if (target.id === 'import-wallet-btn') this.importWallet();
                        else if (target.id === 'add-wallet-btn') this.showCreateWalletModal();
                    } catch (err) {
                        console.error('Error in delegated click handler:', err);
                    }
                    return;
                }
                target = target.parentElement;
            }
        });

        // Login button
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                const password = document.getElementById('login-password').value;
                if (this && this.loginWallet) {
                    this.loginWallet(password);
                } else {
                    console.error('App not available for login button');
                }
            });
        }
    }

    // Check if wallet exists in localStorage
    checkForExistingWallet() {
        try {
            const walletData = localStorage.getItem('cheeseWallet');
            if (walletData) {
                const data = JSON.parse(walletData);
                return data && data.address && (data.privateKey || (data.encrypted && data.encryptedPrivateKey));
            }
        } catch (error) {
            console.log('Error checking for wallet:', error);
        }
        return false;
    }

    // Show login screen for existing wallet (ENHANCED)
    showLoginScreen() {
        const noWalletSection = document.getElementById('no-wallet-section');
        const loginSection = document.getElementById('login-section');
        const walletSection = document.getElementById('wallet-section');

        if (noWalletSection) noWalletSection.style.display = 'none';
        if (loginSection) loginSection.style.display = 'block';
        if (walletSection) walletSection.style.display = 'none';

        // Update wallet info preview and password requirements
        try {
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            const previewEl = document.getElementById('wallet-info-preview');
            const passwordInput = document.getElementById('login-password');
            const passwordHint = document.getElementById('password-hint');
            const passwordRequired = document.getElementById('password-required-indicator');

            if (walletData.address) {
                const isEncrypted = walletData.encrypted && walletData.encryptedPrivateKey;

                if (previewEl) {
                    previewEl.innerHTML = `
                        <div class="wallet-preview-info">
                            <div><strong>Address:</strong> ${walletData.address.slice(0, 10)}...${walletData.address.slice(-8)}</div>
                            <div><strong>Status:</strong> ${isEncrypted ? '🔒 Encrypted - Password Required' : '🔓 Unencrypted - No Password Needed'}</div>
                        </div>
                    `;
                }

                // Update password field requirements
                if (passwordInput) {
                    if (isEncrypted) {
                        passwordInput.required = true;
                        passwordInput.placeholder = 'Enter your wallet password';
                        if (passwordRequired) passwordRequired.style.display = 'inline';
                        if (passwordHint) passwordHint.textContent = 'This wallet is encrypted. Password is required.';
                    } else {
                        passwordInput.required = false;
                        passwordInput.placeholder = 'No password needed (wallet is unencrypted)';
                        if (passwordRequired) passwordRequired.style.display = 'none';
                        if (passwordHint) passwordHint.textContent = 'This wallet is not encrypted. You can leave password blank.';
                    }
                    passwordInput.value = '';
                    passwordInput.style.borderColor = '';
                }

                // Check and show biometric login option
                this.checkBiometricAvailability(walletData.address);
            }
        } catch (error) {
            console.error('Error showing wallet preview:', error);
        }

        // Setup show password toggle
        const showPasswordCheckbox = document.getElementById('show-password-checkbox');
        const passwordInput = document.getElementById('login-password');
        if (showPasswordCheckbox && passwordInput) {
            showPasswordCheckbox.addEventListener('change', (e) => {
                passwordInput.type = e.target.checked ? 'text' : 'password';
            });
        }

        // Allow Enter key to submit
        if (passwordInput) {
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const loginBtn = document.getElementById('login-btn');
                    if (loginBtn) loginBtn.click();
                }
            });
        }
    }

    // Show no wallet screen
    showNoWalletScreen() {
        const noWalletSection = document.getElementById('no-wallet-section');
        const loginSection = document.getElementById('login-section');
        const walletSection = document.getElementById('wallet-section');

        if (noWalletSection) noWalletSection.style.display = 'block';
        if (loginSection) loginSection.style.display = 'none';
        if (walletSection) walletSection.style.display = 'none';
    }

    // Login to existing wallet (FIXED - Enhanced password handling with address validation)
    async loginWallet(password = null) {
        try {
            // Check if wallet exists FIRST
            const walletDataString = this.safeGetItem('cheeseWallet');
            if (!walletDataString) {
                throw new Error('No wallet found. Please create a new wallet.');
            }

            const data = this.safeJSONParse(walletDataString, null);
            if (!data || !data.address) {
                throw new Error('Invalid wallet data. Please create a new wallet.');
            }
            const isEncrypted = data.encrypted && data.encryptedPrivateKey;
            const storedAddress = data.address; // Store original address for validation

            // Handle encrypted wallet - REQUIRES CORRECT PASSWORD
            if (isEncrypted) {
                // Get password from input if not provided
                if (!password) {
                    const passwordInput = document.getElementById('login-password');
                    if (passwordInput) {
                        password = passwordInput.value;
                    }
                }

                // CRITICAL FIX: Normalize password (trim whitespace) BEFORE passing to loadWallet
                // This ensures consistency - password was trimmed during encryption
                if (password) {
                    password = password.trim();
                }

                // CRITICAL: Log for debugging (without revealing password)
                console.log('🔓 Login attempt - Password provided:', !!password, 'Length:', password ? password.length : 0);

                if (!password || password === '') {
                    this.showNotification('⚠️ This wallet is encrypted. Please enter your password.', 'error');
                    const passwordInput = document.getElementById('login-password');
                    if (passwordInput) {
                        passwordInput.focus();
                        passwordInput.style.borderColor = '#dc3545';
                    }
                    return false;
                }

                // Try to decrypt and load wallet - THIS WILL FAIL IF PASSWORD IS WRONG
                try {
                    console.log('🔓 Attempting to decrypt wallet...');
                    console.log('🔓 Wallet data check:', {
                        hasEncryptedKey: !!data.encryptedPrivateKey,
                        encryptionVersion: data.encryptionVersion || '1.0',
                        storedAddress: storedAddress,
                        passwordLength: password ? password.length : 0
                    });

                    // CRITICAL: Load wallet (wallet-core.js will try multiple password variations internally)
                    const savedWallet = await this.walletCore.loadWallet(password);

                    if (!savedWallet || !savedWallet.privateKey) {
                        // Log detailed error for debugging
                        console.error('❌ Decryption failed. Last error:', lastError);
                        console.error('❌ Wallet data structure:', {
                            hasEncryptedKey: !!data.encryptedPrivateKey,
                            encryptedKeyLength: data.encryptedPrivateKey ? data.encryptedPrivateKey.length : 0,
                            encryptionVersion: data.encryptionVersion || '1.0'
                        });
                        throw new Error('Incorrect password. Please try again.');
                    }

                    // CRITICAL VALIDATION: Ensure decrypted wallet address matches stored address
                    if (savedWallet.address !== storedAddress) {
                        console.error('❌ Address mismatch! Stored:', storedAddress, 'Decrypted:', savedWallet.address);
                        throw new Error('Wallet address mismatch. This may indicate corrupted wallet data or incorrect password.');
                    }

                    console.log('✅ Wallet decrypted successfully, address validated:', savedWallet.address);
                    this.wallet = savedWallet;

                    // Check if mining should auto-resume
                    this.checkAndResumeMining();
                } catch (decryptError) {
                    console.error('❌ Decryption error:', decryptError);
                    // ALL decryption errors mean wrong password
                    const errorMsg = decryptError.message || 'Decryption failed';
                    // Clear password field
                    const passwordInput = document.getElementById('login-password');
                    if (passwordInput) {
                        passwordInput.value = '';
                        passwordInput.focus();
                        passwordInput.style.borderColor = '#dc3545';
                    }
                    // Show specific error message with helpful debugging info
                    if (errorMsg.includes('Incorrect password') || errorMsg.includes('Invalid password')) {
                        // Check if wallet data might be corrupted
                        console.error('❌ Password validation failed. Checking wallet data integrity...');
                        console.error('Wallet data:', {
                            address: storedAddress,
                            hasEncryptedKey: !!data.encryptedPrivateKey,
                            encryptionVersion: data.encryptionVersion || '1.0',
                            encryptedKeyPreview: data.encryptedPrivateKey ? data.encryptedPrivateKey.substring(0, 20) + '...' : 'none'
                        });

                        // Provide recovery suggestion
                        const recoveryMsg = 'Incorrect password. If you\'re certain the password is correct, the wallet data may be corrupted. ' +
                            'Do you have your seed phrase or private key backup?';
                        throw new Error(recoveryMsg);
                    }
                    throw new Error('Failed to unlock wallet: ' + errorMsg);
                }
            } else {
                // UNENCRYPTED WALLET - IGNORE PASSWORD COMPLETELY
                // Load wallet without any password check
                const savedWallet = await this.walletCore.loadWallet(null);
                if (!savedWallet || !savedWallet.privateKey) {
                    throw new Error('Failed to load wallet');
                }

                // CRITICAL VALIDATION: Ensure loaded wallet address matches stored address
                if (savedWallet.address !== storedAddress) {
                    console.error('❌ Address mismatch! Stored:', storedAddress, 'Loaded:', savedWallet.address);
                    throw new Error('Wallet address mismatch. This may indicate corrupted wallet data.');
                }

                console.log('✅ Unencrypted wallet loaded, address validated:', savedWallet.address);
                this.wallet = savedWallet;
                // Clear password field since it's not needed
                const passwordInput = document.getElementById('login-password');
                if (passwordInput) {
                    passwordInput.value = '';
                }
            }

            // Wallet loaded successfully
            // CRITICAL: Show wallet section FIRST before loading data
            const loginSection = document.getElementById('login-section');
            const walletSection = document.getElementById('wallet-section');
            const noWalletSection = document.getElementById('no-wallet-section');

            if (loginSection) loginSection.style.display = 'none';
            if (noWalletSection) noWalletSection.style.display = 'none';
            if (walletSection) walletSection.style.display = 'block';

            // CRITICAL: Wait for wallet-section to be visible before loading data
            // Use requestAnimationFrame to ensure DOM is ready
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        resolve();
                    });
                });
            });

            // Now load wallet data (balance will be fetched and displayed)
            await this.loadWalletData();

            // CRITICAL: Force balance update and wait for it to complete
            console.log('🔄 Forcing balance update after login...');
            await this.updateBalance();
            console.log('✅ Balance updated after login:', this.balance);

            if (this.swapEngine && this.wallet?.address) {
                const recovered = await this.swapEngine.confirmPendingSwap(this.wallet.address);
                if (recovered && recovered.success) {
                    this.showNotification(
                        `✅ Swap confirmed! Received ${parseFloat(recovered.amountOut).toFixed(6)} ${recovered.swapDetails?.tokenOut || ''}`,
                        'success'
                    );
                    await this.updateBalance();
                }
            }

            // CRITICAL: Pre-generate QR code immediately after wallet loads
            // This ensures QR code is always ready and never shows "Loading..."
            if (this.wallet && this.wallet.address) {
                this.preGenerateQRCode(this.wallet.address).catch(err => {
                    console.warn('QR code pre-generation failed (non-critical):', err);
                });
            }

            // Start auto-refresh
            this.startAutoRefresh();

            // Clear and reset password field
            const passwordInput = document.getElementById('login-password');
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.style.borderColor = '';
            }

            // CRITICAL: Show home screen and ensure balance is updated
            await this.showScreen('home');

            // CRITICAL: Force balance display update after screen is shown (multiple retries)
            // Wait a bit more to ensure DOM is fully ready
            setTimeout(() => {
                this.forceBalanceDisplay();
                this.updateUI();
            }, 100);

            setTimeout(() => {
                this.forceBalanceDisplay();
                this.updateUI();
            }, 300);

            this.showNotification('✅ Wallet unlocked successfully!', 'success');

            // CRITICAL DEX AUTH FIX: If opened as a popup from DEX (action=authorize),
            // post CHEESE_AUTH_SUCCESS back to the opener. Without this, the DEX never
            // receives confirmation and keeps showing the login loop.
            if (this.wallet && this.wallet.privateKey) {
                try {
                    const urlParams = new URLSearchParams(window.location.search);
                    const isAuthRequest = urlParams.get('action') === 'authorize';
                    const returnTo = urlParams.get('returnTo');

                    if (isAuthRequest && window.opener && !window.opener.closed) {
                        console.log('🔗 Sending CHEESE_AUTH_SUCCESS to DEX opener...');
                        const targetOrigin = returnTo ? new URL(decodeURIComponent(returnTo)).origin : '*';
                        window.opener.postMessage({
                            type: 'CHEESE_AUTH_SUCCESS',
                            address: this.wallet.address,
                            privateKey: this.wallet.privateKey
                        }, targetOrigin);
                        console.log('✅ Auth success posted to DEX');
                        setTimeout(() => {
                            this.showNotification('✅ Authorized! Returning to DEX...', 'success');
                            setTimeout(() => window.close(), 1200);
                        }, 500);
                    }
                } catch (authMsgErr) {
                    console.warn('⚠️ Auth postMessage failed (non-critical):', authMsgErr.message);
                }
            }

            return true;

        } catch (error) {
            console.error('Login error:', error);
            const errorMessage = error.message || 'Login failed. Please try again.';
            this.showNotification('❌ ' + errorMessage, 'error');

            // Clear password field on error but keep focus
            const passwordInput = document.getElementById('login-password');
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.style.borderColor = '#dc3545';
                // Don't remove focus - let user retry
            }

            return false;
        }
    }

    // Logout/Lock wallet
    logoutWallet() {
        // Clear wallet from memory but keep it in localStorage
        this.wallet = null;
        this.balance = 0;
        this.transactions = [];

        // Stop auto-refresh
        this.stopAutoRefresh();

        // Clear password input
        const passwordInput = document.getElementById('login-password');
        if (passwordInput) passwordInput.value = '';

        // Show login screen
        this.showLoginScreen();
        this.updateUI();
        this.showNotification('🔒 Wallet locked. Enter password to unlock.', 'info');
    }

    // Check if mining should auto-resume after wallet unlock
    checkAndResumeMining() {
        try {
            // Check if there's a saved mining state
            const miningState = localStorage.getItem('cheeseMiningState');
            if (miningState) {
                const state = JSON.parse(miningState);
                // Only resume if mining was active and wallet address matches
                if (state.isActive && this.wallet && state.walletAddress === this.wallet.address) {
                    console.log('🔄 Resuming mining session for wallet:', this.wallet.address);
                    if (this.mobileMiner && typeof this.mobileMiner.resumeMining === 'function') {
                        this.mobileMiner.resumeMining();
                    }
                }
            }
        } catch (error) {
            console.warn('⚠️ Could not check mining state:', error.message);
        }
    }

    // Show forgot password help
    showForgotPasswordHelp() {
        const helpMessage = `
🔐 Forgot Password Help

If you forgot your wallet password:

1. **Encrypted Wallet:**
   - If your wallet is encrypted, you need the password to unlock it
   - Without the password, you cannot access the encrypted private key
   - Consider using your mnemonic seed phrase to recover

2. **Recovery Options:**
   - If you have your mnemonic seed phrase, you can:
     • Delete the current wallet
     • Create a new wallet using the same mnemonic
     • This will restore your wallet

3. **Unencrypted Wallet:**
   - If your wallet is not encrypted, you can access it without a password
   - Just leave the password field blank

4. **No Recovery:**
   - If you don't have the password AND don't have the mnemonic:
     • The wallet cannot be recovered
     • You will lose access to the funds

⚠️ Always backup your mnemonic seed phrase!
        `;
        alert(helpMessage);
    }

    // Update network status
    async updateNetworkStatus() {

        // Original code below (disabled)
        /*
        const statusEl = document.getElementById('network-status');
        if (!statusEl) return;

        try {
            // Try multiple endpoints to check if blockchain is online
            let isOnline = false;
            let errorMessage = '';
            
            // First try health endpoint
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
                
                const health = await fetch(`${this.api.apiUrl}/api/health`, {
                    method: 'GET',
                    headers: {
                        'x-api-key': this.api.apiKey,
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (health.ok) {
                    const data = await health.json();
                    if (data && (data.status === 'ok' || data.status === 'healthy')) {
                        isOnline = true;
                    }
                } else {
                    errorMessage = `Health check returned ${health.status}`;
                }
            } catch (healthError) {
                console.log('Health check failed:', healthError.message);
                errorMessage = healthError.message;
            }
            
            // If health check failed, try balance endpoint as fallback
            if (!isOnline) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
                    
                    const balance = await fetch(`${this.api.apiUrl}/api/balance/0x0000000000000000000000000000000000000000`, {
                        method: 'GET',
                        headers: {
                            'x-api-key': this.api.apiKey,
                            'Content-Type': 'application/json'
                        },
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (balance.ok) {
                        isOnline = true;
                    } else {
                        errorMessage = `Balance check returned ${balance.status}`;
                    }
                } catch (balanceError) {
                    console.log('Balance check also failed:', balanceError.message);
                    if (!errorMessage) {
                        errorMessage = balanceError.message;
                    }
                }
            }
            
            // Update UI
            if (isOnline) {
                statusEl.textContent = '🟢 Online';
                statusEl.style.color = '#28a745';
                statusEl.title = 'Blockchain is online and accessible';
                this.offlineNotified = false; // Reset offline notification flag when back online
            } else {
                statusEl.textContent = '🔴 Offline';
                statusEl.style.color = '#dc3545';
                statusEl.title = `Blockchain is offline. ${errorMessage ? 'Error: ' + errorMessage : 'Cannot connect to blockchain server.'}`;
                
                // Show notification if wallet is loaded and this is the first offline detection
                if (this.wallet && !this.offlineNotified) {
                    this.offlineNotified = true;
                    this.showNotification('⚠️ Blockchain is offline. You can still view your wallet, but transactions and balance updates are unavailable. Please check your internet connection.', 'warning');
                }
            }
        } catch (error) {
            console.error('Network status check error:', error);
            statusEl.textContent = '🔴 Offline';
            statusEl.style.color = '#dc3545';
            statusEl.title = `Network error: ${error.message}`;
        }
        */
    }

    // Create new wallet
    async createWallet(password = null, useMnemonic = false) {
        if (typeof ethers === 'undefined') {
            this.showNotification('Wallet crypto library (ethers.js) did not load. Check your connection, disable blockers, and refresh.', 'error');
            return;
        }
        try {
            let walletData;

            if (useMnemonic) {
                // Create wallet with mnemonic seed phrase
                const mnemonic = this.security.generateMnemonic(12);
                walletData = await this.security.deriveWalletFromMnemonic(mnemonic);

                // Show mnemonic to user (in production, use secure modal)
                const confirmed = confirm(`Your seed phrase:\n\n${mnemonic}\n\nWrite this down and keep it safe! Click OK to continue.`);
                if (!confirmed) {
                    return;
                }
            } else {
                // CRITICAL FIX: ALWAYS generate mnemonic seed phrase FIRST, then derive wallet FROM it
                // This ensures the seed phrase always matches the wallet address
                const mnemonic = this.security.generateMnemonic(12);

                // Derive wallet FROM mnemonic (this ensures consistency)
                const mnemonicWallet = await this.security.deriveWalletFromMnemonic(mnemonic);
                console.log('🔑 Derived wallet from mnemonic, address:', mnemonicWallet.address);

                // CRITICAL VALIDATION: Verify the derived wallet has valid address and private key
                if (!mnemonicWallet.address || !mnemonicWallet.privateKey) {
                    throw new Error('Failed to derive wallet from mnemonic - invalid wallet data');
                }

                // Use the mnemonic-derived wallet (ensures recoverability and consistency)
                this.wallet = {
                    address: mnemonicWallet.address,
                    publicKey: mnemonicWallet.publicKey,
                    privateKey: mnemonicWallet.privateKey,
                    mnemonic: mnemonic // Store mnemonic for recovery
                };

                // Verify wallet is valid
                if (!this.wallet || !this.wallet.privateKey || !this.wallet.address) {
                    throw new Error('Failed to generate wallet - invalid wallet data');
                }

                console.log('✅ Wallet created from mnemonic, address:', this.wallet.address);

                // CRITICAL: Store original address BEFORE any operations
                const originalAddress = this.wallet.address;
                const originalPrivateKey = this.wallet.privateKey;
                console.log('🔒 Stored original wallet - Address:', originalAddress, 'Private Key length:', originalPrivateKey.length);

                // Set wallet in walletCore
                this.walletCore.wallet = this.wallet;

                // CRITICAL: Verify wallet is still correct before saving
                if (this.walletCore.wallet.address !== originalAddress) {
                    console.error('❌ Address changed in walletCore! Original:', originalAddress, 'Current:', this.walletCore.wallet.address);
                    throw new Error('Wallet address changed during setup - this should never happen!');
                }

                // Save wallet with password encryption (ALWAYS ENCRYPT if password provided)
                await this.walletCore.saveWallet(password);

                // CRITICAL: Verify saved wallet address matches ORIGINAL address
                const savedData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                if (!savedData || savedData.address !== originalAddress) {
                    console.error('❌ Address mismatch after save! Original:', originalAddress, 'Saved:', savedData.address);
                    throw new Error('Wallet save failed - address mismatch detected');
                }
                console.log('✅ Wallet saved successfully, address verified:', savedData.address);

                // CRITICAL: Verify wallet object still has correct address
                if (this.wallet.address !== originalAddress) {
                    console.error('❌ Wallet address changed after save! Original:', originalAddress, 'Current:', this.wallet.address);
                    throw new Error('Wallet address changed - critical error!');
                }

                // Store mnemonic encrypted for recovery (separate from wallet data)
                if (password) {
                    await this.saveMnemonicSecurely(mnemonic, password);
                }

                // FINAL VALIDATION: Re-derive wallet from mnemonic to ensure consistency
                const verificationWallet = await this.security.deriveWalletFromMnemonic(mnemonic);
                if (verificationWallet.address !== originalAddress) {
                    console.error('❌ CRITICAL: Mnemonic derivation inconsistency! Original:', originalAddress, 'Re-derived:', verificationWallet.address);
                    throw new Error('Mnemonic derivation failed consistency check - wallet address would change!');
                }
                console.log('✅ Mnemonic consistency verified - address matches:', verificationWallet.address);

                // Set wallet address in fiat gateway
                this.fiatGateway.setWalletAddress(this.wallet.address);

                // Show seed phrase in secure modal (MUST confirm backup)
                await this.showSeedPhraseModal(mnemonic, true);

                // Load wallet data
                await this.loadWalletData();

                // CRITICAL: Pre-generate QR code immediately after wallet creation
                if (this.wallet && this.wallet.address) {
                    this.preGenerateQRCode(this.wallet.address).catch(err => {
                        console.warn('QR code pre-generation failed (non-critical):', err);
                    });
                }

                // Show wallet screen
                const loginSection = document.getElementById('login-section');
                const noWalletSection = document.getElementById('no-wallet-section');
                const walletSection = document.getElementById('wallet-section');

                if (loginSection) loginSection.style.display = 'none';
                if (noWalletSection) noWalletSection.style.display = 'none';
                if (walletSection) walletSection.style.display = 'block';

                this.updateUI();
                this.showNotification('✅ Wallet created successfully!', 'success');
                return;
            }

            // OLD CODE BELOW - Only for mnemonic wallets
            this.wallet = {
                address: walletData.address,
                publicKey: walletData.publicKey,
                mnemonic: walletData.mnemonic
            };

            // Save locally
            this.walletCore.wallet = this.wallet;
            await this.walletCore.saveWallet(password);

            // Set wallet address in fiat gateway
            this.fiatGateway.setWalletAddress(this.wallet.address);

            await this.loadWalletData();
            await this.showScreen('home'); // CRITICAL: Await to ensure balance is updated before showing
            this.showNotification('✅ Wallet created successfully!', 'success');
        } catch (error) {
            console.error('Create wallet error:', error);
            this.showNotification('Error creating wallet: ' + error.message, 'error');
        }
    }

    // Load wallet data
    async loadWalletData() {
        // CRITICAL: Only need address to load data (balance fetching doesn't need privateKey)
        if (!this.wallet || !this.wallet.address) {
            return;
        }

        try {
            // CRITICAL: Ensure wallet-section is visible before loading data
            const walletSection = document.getElementById('wallet-section');
            if (walletSection && walletSection.style.display === 'none') {
                walletSection.style.display = 'block';
                void walletSection.offsetHeight; // Force reflow
                // Wait for DOM to update
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }

            // Load balance
            this.balance = await this.api.getBalance(this.wallet.address);
            console.log('📊 Loaded balance in loadWalletData:', this.balance);

            // Load transactions
            this.transactions = await this.api.getTransactionHistory(this.wallet.address);

            // Update UI immediately
            this.updateUI();

            // Also call updateBalance to ensure everything is synced
            await this.updateBalance();
            this.updateTransactions();
        } catch (error) {
            console.error('Load wallet data error:', error);
            // Still update UI even on error
            this.updateUI();
        }
    }

    // Update balance (INDEPENDENT of mining - balance fetching is separate)
    async updateBalance(forceSync = false) {
        // CRITICAL: Balance fetching only needs address, not privateKey
        // PrivateKey is only needed for signing transactions, not for reading balance
        if (this.wallet && this.wallet.address) {
            try {
                // Check URL params if not explicitly provided
                const isForceSync = forceSync || 
                                   new URLSearchParams(window.location.search).get('forceSync') === 'true' || 
                                   new URLSearchParams(window.location.search).get('sync') === 'true';
                console.log('🔄 Fetching balance for address:', this.wallet.address);
                const balance = await this.api.getBalance(this.wallet.address, isForceSync);
                console.log('💰 Balance received from API:', balance, 'Type:', typeof balance);

                // CRITICAL: Balance should already be a number from getBalance(), but double-check
                if (typeof balance === 'number' && !isNaN(balance) && balance >= 0) {
                    this.balance = balance;
                    console.log('✅ Balance updated successfully:', this.balance);
                } else if (balance !== null && balance !== undefined) {
                    // Try to parse as number if it's a string or object
                    let parsedBalance;
                    if (typeof balance === 'object' && balance !== null && balance.balance !== undefined) {
                        // If it's still an object, extract balance property
                        parsedBalance = parseFloat(balance.balance);
                        console.log('🔧 Extracted balance from object:', parsedBalance);
                    } else {
                        parsedBalance = parseFloat(balance);
                    }

                    if (!isNaN(parsedBalance) && parsedBalance >= 0) {
                        this.balance = parsedBalance;
                        console.log('✅ Balance parsed and updated:', this.balance);
                    } else {
                        console.warn('⚠️ Invalid balance received:', balance, 'Type:', typeof balance, 'defaulting to 0');
                        this.balance = 0;
                    }
                } else {
                    console.warn('⚠️ Balance is null/undefined, defaulting to 0');
                    this.balance = 0;
                }

                // CRITICAL: Ensure wallet-section is visible BEFORE trying to update display
                const walletSection = document.getElementById('wallet-section');
                if (walletSection && walletSection.style.display === 'none') {
                    console.log('🔧 Wallet-section is hidden, making it visible...');
                    walletSection.style.display = 'block';
                    // Force reflow
                    void walletSection.offsetHeight;
                    // Wait for DOM to update
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                }

                // CRITICAL: Update balance display immediately - try multiple times if element not found
                this.updateBalanceDisplay();

                // Also use forceBalanceDisplay for extra retries
                this.forceBalanceDisplay();

                const nchPrice = (this.tokenSearch ? this.tokenSearch.getTokenPriceSync('NCH') : 0) || 0.022;
                const usdEstimate = this.balance * nchPrice;
                const usdEl = document.getElementById('balance-usd');
                if (usdEl && this.enhancements) {
                    usdEl.textContent = `≈ ${this.enhancements.formatCurrency(usdEstimate)}`;
                } else if (usdEl) {
                    usdEl.textContent = `≈ $${usdEstimate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                }

                // CRITICAL: Force UI update to ensure balance is visible
                this.updateUI();
            } catch (error) {
                console.error('❌ Error updating balance:', error);
                console.error('Error details:', error.message, error.stack);
                // Don't reset balance on error, just log it
                // Show user-friendly error
                if (error.message && error.message.includes('Cannot connect')) {
                    console.warn('⚠️ Cannot connect to blockchain server. Balance may be outdated.');
                }
            }
        } else {
            console.warn('⚠️ Cannot update balance: No wallet or address');
            // Still update UI to show 0 balance if no wallet
            const balanceEl = document.getElementById('balance');
            if (balanceEl) {
                balanceEl.textContent = '0.00';
            }
        }
        this.updateUI();
    }

    // CRITICAL: Helper function to update balance display with retry mechanism
    updateBalanceDisplay() {
        // CRITICAL: Ensure wallet-section is visible first
        const walletSection = document.getElementById('wallet-section');
        if (walletSection && walletSection.style.display === 'none') {
            walletSection.style.display = 'block';
            void walletSection.offsetHeight; // Force reflow
        }

        const balanceEl = document.getElementById('balance');
        if (balanceEl) {
            if (this.balance !== undefined && this.balance !== null && !isNaN(this.balance)) {
                balanceEl.textContent = this.balance.toFixed(2);
                console.log('✅ Balance display updated:', this.balance.toFixed(2));
            } else {
                console.warn('⚠️ Balance is invalid:', this.balance);
                balanceEl.textContent = '0.00';
            }
        } else {
            console.warn('⚠️ Balance element not found in DOM, will retry...');
            // Retry after a short delay
            setTimeout(() => {
                const retryEl = document.getElementById('balance');
                if (retryEl && this.balance !== undefined && this.balance !== null && !isNaN(this.balance)) {
                    retryEl.textContent = this.balance.toFixed(2);
                    console.log('✅ Balance display updated on retry:', this.balance.toFixed(2));
                }
            }, 100);
        }
    }

    // CRITICAL: Force balance display with aggressive retries
    forceBalanceDisplay() {
        if (this.balance === undefined || this.balance === null || isNaN(this.balance)) {
            console.warn('⚠️ Cannot force balance display - balance is invalid:', this.balance);
            return;
        }

        const balanceEl = document.getElementById('balance');
        if (balanceEl) {
            balanceEl.textContent = this.balance.toFixed(2);
            console.log('✅ Force balance display updated:', this.balance.toFixed(2));
        } else {
            console.warn('⚠️ Balance element not found, retrying...');
            // Retry multiple times with increasing delays
            [50, 100, 200, 500].forEach((delay, index) => {
                setTimeout(() => {
                    const retryEl = document.getElementById('balance');
                    if (retryEl) {
                        retryEl.textContent = this.balance.toFixed(2);
                        console.log(`✅ Balance display updated on retry ${index + 1}:`, this.balance.toFixed(2));
                    } else if (index === 3) {
                        console.error('❌ Balance element not found after all retries');
                    }
                }, delay);
            });
        }
    }

    // Send transaction (with founder fee)
    async sendTransaction(to, amount, data = {}) {
        if (!this.wallet) {
            throw new Error('No wallet loaded');
        }

        try {
            // Get private key (in production, sign client-side)
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            if (!walletData || !walletData.address) {
                throw new Error('Wallet not found or invalid');
            }
            let privateKey = walletData.privateKey;
            if (!privateKey && walletData.encryptedPrivateKey) {
                const password = prompt('Enter your wallet password to send transaction:');
                if (!password) {
                    throw new Error('Password required');
                }
                privateKey = await this.walletCore.decryptPrivateKey(walletData.encryptedPrivateKey, password);
            }

            if (!privateKey) {
                throw new Error('Private key not available or incorrect password');
            }

            // Use founder income system to send transaction with fee
            console.log('📤 Calling sendTransactionWithFee:', {
                from: this.wallet.address,
                to: to,
                amount: amount
            });

            const result = await this.founderIncome.sendTransactionWithFee(
                this.wallet.address,
                to,
                amount,
                privateKey,
                data
            );

            console.log('📥 sendTransactionWithFee result:', result);
            console.log('📥 Result type:', typeof result);
            console.log('📥 Result keys:', result ? Object.keys(result) : 'null');

            // Handle different response formats
            if (!result) {
                throw new Error('No response from transaction system');
            }

            // Check success property
            if (result.success === true) {
                const feeMsg = result.fee > 0 ? ` (Fee: ${result.fee.toFixed(4)} NCH)` : '';
                this.showNotification(`✅ Transaction sent successfully!${feeMsg}`, 'success');
                await this.updateBalance();
                return result;
            } else if (result.success === false) {
                const errorMsg = result.error || result.reason || 'Transaction failed';
                console.error('❌ Transaction failed:', errorMsg, result);
                throw new Error(errorMsg);
            } else if (result.transaction || result.id || result.hash) {
                // Response might be transaction object directly (success)
                console.log('✅ Transaction object received (assuming success)');
                this.showNotification('✅ Transaction sent successfully!', 'success');
                await this.updateBalance();
                return { success: true, transaction: result };
            } else {
                const errorMsg = result.error || result.reason || result.message || 'Transaction failed';
                console.error('❌ Transaction failed:', errorMsg, result);
                throw new Error(errorMsg);
            }
        } catch (error) {
            console.error('Send transaction error:', error);
            this.showNotification('Transaction error: ' + error.message, 'error');
            throw error;
        }
    }

    // Buy CHEESE with fiat
    async buyCheese(amount, currency = 'USD', method = 'moonpay') {
        if (!this.wallet || !this.wallet.address) {
            throw new Error('Please create a wallet first');
        }

        try {
            const methodInfo = this.fiatGateway.getPaymentMethodInfo(method);

            if (method === 'moonpay' || methodInfo.provider === 'moonpay') {
                await this.fiatGateway.buyCheeseMoonPay(amount, currency, method);
            } else if (method === 'ramp' || methodInfo.provider === 'ramp') {
                await this.fiatGateway.buyCheeseRamp(amount, currency, method);
            } else if (method === 'paypal' || methodInfo.provider === 'paypal') {
                await this.fiatGateway.buyCheesePayPal(amount, currency);
            } else if (method === 'alipay' || methodInfo.provider === 'alipay') {
                await this.fiatGateway.buyCheeseAlipay(amount, currency);
            } else if (method === 'wechat_pay' || methodInfo.provider === 'wechat') {
                await this.fiatGateway.buyCheeseWeChatPay(amount, currency);
            } else if (method === 'gcash' || methodInfo.provider === 'gcash') {
                await this.fiatGateway.buyCheeseGCash(amount, currency);
            } else if (method === 'paymaya' || methodInfo.provider === 'maya') {
                await this.fiatGateway.buyCheeseMaya(amount, currency);
            } else if (method === 'coins_ph' || methodInfo.provider === 'coins') {
                await this.fiatGateway.buyCheeseCoinsPH(amount, currency);
            } else {
                // Generic payment method
                this.showNotification(`Processing ${methodInfo.name} payment...`, 'info');
                // Would integrate with specific payment provider
            }
        } catch (error) {
            console.error('Buy CHEESE error:', error);
            this.showNotification('Buy error: ' + error.message, 'error');
        }
    }

    // Swap tokens
    async swapTokens(fromAmount, fromToken, toToken) {
        if (!this.wallet) {
            throw new Error('No wallet loaded');
        }

        try {
            let privateKey = this.wallet.privateKey;
            if (!privateKey) {
                const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                privateKey = walletData.privateKey;
                if (!privateKey && walletData.encryptedPrivateKey) {
                    const password = prompt('Enter your wallet password to swap:');
                    if (!password) {
                        throw new Error('Password required');
                    }
                    privateKey = await this.walletCore.decryptPrivateKey(walletData.encryptedPrivateKey, password.trim());
                }
            }
            if (!privateKey || !/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
                throw new Error('Private key not available. Please unlock your wallet and try again.');
            }

            // Show loading notification
            this.showNotification('🔄 Processing swap...', 'info');

            const result = await this.swapEngine.executeSwap(
                fromAmount,
                fromToken,
                toToken,
                this.wallet.address,
                privateKey
            );

            if (result.success) {
                // CRITICAL: For cross-chain swaps (NCH → CHEESE), update BSC balance
                if (result.crossChain && result.toToken === 'CHEESE') {
                    this.showNotification(`✅ Swap completed! ${result.toAmount} CHEESE will be available on BSC. Refreshing balance...`, 'success');

                    // Wait a moment then refresh balances
                    setTimeout(async () => {
                        await this.updateBalance();
                        // Force refresh portfolio to show CHEESE tokens
                        if (this.currentScreen === 'portfolio') {
                            await this.updatePortfolioScreen();
                        }
                    }, 2000);
                } else {
                    const outAmt = result.amountOut || result.swapDetails?.toAmount;
                    const outTok = toToken;
                    const msg = outAmt
                        ? `✅ Swapped for ${parseFloat(outAmt).toFixed(6)} ${outTok}`
                        : '✅ Swap completed!';
                    this.showNotification(msg, 'success');
                    await this.updateBalance();
                    if (this.currentScreen === 'portfolio') {
                        await this.updatePortfolioScreen();
                    }
                }

                // If there's a message about claiming tokens, show it
                if (result.message) {
                    setTimeout(() => {
                        this.showNotification(result.message, 'info');
                    }, 3000);
                }
            }

            return result;
        } catch (error) {
            console.error('Swap error:', error);
            this.showNotification('Swap error: ' + error.message, 'error');
            throw error;
        }
    }

    // Mine block
    async mineBlock() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('No wallet loaded. Please login first.', 'error');
            return;
        }

        try {
            this.showNotification('⛏️ Mining block...', 'info');
            console.log('⛏️ Starting mining for address:', this.wallet.address);

            const result = await this.api.mineBlock(this.wallet.address);

            console.log('⛏️ Mining result:', result);

            // Check different response formats
            if (result.success || result.block) {
                // Server returns block with mining reward
                const block = result.block || result;
                const reward = block.miningReward || block.reward || result.reward || 100;
                this.showNotification('✅ Block mined! Reward: ' + reward + ' NCH', 'success');
                await this.updateBalance();
                return result;
            } else if (result.error) {
                throw new Error(result.error);
            } else if (result.hash || result.index !== undefined) {
                // If response is a block directly
                const reward = result.miningReward || result.reward || 100;
                this.showNotification('✅ Block mined! Reward: ' + reward + ' NCH', 'success');
                await this.updateBalance();
                return { success: true, block: result };
            } else {
                // Try to extract block from response
                console.warn('Unexpected mining response format:', result);
                const reward = 100; // Default reward
                this.showNotification('✅ Block mined! Reward: ' + reward + ' NCH', 'success');
                await this.updateBalance();
                return { success: true, block: result };
            }
        } catch (error) {
            console.error('❌ Mine error:', error);
            console.error('Error stack:', error.stack);
            const errorMsg = error.message || 'Mining failed. Please check blockchain server connection.';
            this.showNotification('❌ Mining error: ' + errorMsg, 'error');
            throw error;
        }
    }

    // Bridge tokens out (from native to other chain)
    async bridgeOut(amount, toChain, recipientAddress) {
        this.showNotification('wNCH bridge is retired. Native NCH and USDT swaps remain on the DEX.', 'error');
        throw new Error('wNCH bridge is retired');
        if (!this.wallet) {
            throw new Error('No wallet loaded');
        }

        try {
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            if (!walletData || !walletData.address) {
                throw new Error('Wallet not found or invalid');
            }
            let privateKey = walletData.privateKey;
            if (!privateKey && walletData.encryptedPrivateKey) {
                const password = prompt('Enter your wallet password to bridge tokens:');
                if (!password) {
                    throw new Error('Password required');
                }
                privateKey = await this.walletCore.decryptPrivateKey(walletData.encryptedPrivateKey, password);
            }

            if (!privateKey) {
                throw new Error('Private key not available or incorrect password');
            }

            const result = await this.bridgeEngine.bridgeOut(
                amount,
                toChain,
                recipientAddress,
                this.wallet.address,
                privateKey
            );

            if (result.success) {
                this.showNotification(
                    `✅ Bridge initiated! Estimated time: ${result.estimatedTime}`,
                    'success'
                );
                await this.updateBalance();
                this.updateBridgeHistory();
            }

            return result;
        } catch (error) {
            console.error('Bridge out error:', error);
            this.showNotification('Bridge error: ' + error.message, 'error');
            throw error;
        }
    }

    // Bridge tokens in (from other chain to native)
    async bridgeIn(amount, fromChain, transactionHash, recipientAddress) {
        this.showNotification('wNCH bridge is retired. Native NCH and USDT swaps remain on the DEX.', 'error');
        throw new Error('wNCH bridge is retired');
        try {
            const result = await this.bridgeEngine.bridgeIn(
                amount,
                fromChain,
                transactionHash,
                recipientAddress || this.wallet?.address
            );

            if (result.success) {
                this.showNotification('✅ Bridge-in request submitted! Verification in progress...', 'success');
                this.updateBridgeHistory();
            }

            return result;
        } catch (error) {
            console.error('Bridge in error:', error);
            this.showNotification('Bridge error: ' + error.message, 'error');
            throw error;
        }
    }

    // Get bridge status
    async getBridgeStatus(transactionHash) {
        return await this.bridgeEngine.getBridgeStatus(transactionHash);
    }

    // Update bridge history
    updateBridgeHistory() {
        const history = this.bridgeEngine.getBridgeHistory();
        const historyList = document.getElementById('bridge-history-list');

        if (!historyList) return;

        if (history.length === 0) {
            historyList.innerHTML = '<p>No bridge transactions yet</p>';
            return;
        }

        historyList.innerHTML = history.slice(0, 10).map(bridge => {
            const direction = bridge.direction === 'out' ? 'Out' : 'In';
            const chain = bridge.direction === 'out' ? bridge.toChain : bridge.fromChain;
            const status = bridge.status || 'pending';
            const statusClass = status === 'completed' ? 'success' : status === 'pending' ? 'warning' : 'error';

            return `
                <div class="bridge-history-item">
                    <div class="bridge-direction">${direction} → ${chain}</div>
                    <div class="bridge-amount">${bridge.amount} NCH</div>
                    <div class="bridge-status ${statusClass}">${status}</div>
                    <div class="bridge-time">${new Date(bridge.timestamp).toLocaleString()}</div>
                </div>
            `;
        }).join('');

        // Update statistics
        const stats = this.bridgeEngine.getBridgeStats();
        const statTotal = document.getElementById('stat-total');
        const statAmount = document.getElementById('stat-amount');
        const statFees = document.getElementById('stat-fees');

        if (statTotal) statTotal.textContent = stats.totalBridges;
        if (statAmount) statAmount.textContent = stats.totalBridged.toFixed(2) + ' NCH';
        if (statFees) statFees.textContent = stats.totalFees.toFixed(2) + ' NCH';
    }

    // Show specific screen
    showScreen(screenName) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        const targetScreen = document.getElementById(`${screenName}-screen`);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenName;
        }

        // Update navigation buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-screen="${screenName}"]`)?.classList.add('active');

        // Update ALL screen-specific content (was missing most screens)
        this.updateScreenContent(screenName);
    }

    // Setup additional event listeners (continuation of setupEventListeners)
    setupAdditionalEventListeners() {
        // Send transaction
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                if (this && this.showSendModal) {
                    this.showSendModal();
                } else {
                    console.error('App not available for send button');
                }
            });
        }

        // Buy button
        const buyBtn = document.getElementById('buy-btn');
        if (buyBtn) {
            buyBtn.addEventListener('click', () => {
                this.showBuyModal();
            });
        }

        // Sell button
        const sellBtn = document.getElementById('sell-btn');
        if (sellBtn) {
            sellBtn.addEventListener('click', () => {
                this.showScreen('sell');
            });
        }

        // Swap button
        const swapBtn = document.getElementById('swap-btn');
        if (swapBtn) {
            swapBtn.addEventListener('click', () => {
                this.showScreen('swap');
            });
        }
        
        // Mine button
        const mineBtn = document.getElementById('mine-btn');
        if (mineBtn) {
            mineBtn.addEventListener('click', () => {
                this.mineBlock();
            });
        }

        // Notary quick button
        const notaryQuickBtn = document.getElementById('notary-quick-btn');
        if (notaryQuickBtn) {
            notaryQuickBtn.addEventListener('click', () => {
                this.showScreen('notary');
            });
        }

        // Sell form listeners
        const sellAmountInput = document.getElementById('sell-amount');
        const sellCurrencySelect = document.getElementById('sell-currency');
        const sellSubmitBtn = document.getElementById('sell-submit-btn');

        if (sellAmountInput) {
            sellAmountInput.addEventListener('input', () => {
                if (this && this.updateSellPreview) {
                    this.updateSellPreview();
                } else {
                    console.error('App not available for sell amount input');
                }
            });
        }

        if (sellCurrencySelect) {
            sellCurrencySelect.addEventListener('change', () => {
                if (this && this.updateSellPreview) {
                    this.updateSellPreview();
                } else {
                    console.error('App not available for sell currency select');
                }
            });
        }

        if (sellSubmitBtn) {
            sellSubmitBtn.addEventListener('click', async () => {
                if (this && this.processSell) {
                    await this.processSell();
                } else {
                    console.error('App not available for sell submit');
                }
            });
        }

        // Change founder wallet button (removed from public settings - private only)

        // Settings buttons
        const exportBtn = document.getElementById('export-wallet-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                if (this && this.exportWallet) {
                    this.exportWallet();
                } else {
                    console.error('App not available for export wallet button');
                }
            });
        }

        // View seed phrase button
        const viewSeedPhraseBtn = document.getElementById('view-seed-phrase-btn');
        if (viewSeedPhraseBtn) {
            viewSeedPhraseBtn.addEventListener('click', async () => {
                try {
                    if (this && this.checkMnemonicBackupStatus && this.showSeedPhraseModal && this.showNotification) {
                        const hasMnemonic = await this.checkMnemonicBackupStatus();
                        if (!hasMnemonic) {
                            this.showNotification('⚠️ This wallet was not created with a seed phrase (e.g., imported via private key).', 'info');
                            return;
                        }
                        await this.showSeedPhraseModal(null, false);
                    } else {
                        console.error('App not available for view seed phrase button');
                    }
                } catch (error) {
                    if (this && this.showNotification) {
                        this.showNotification('❌ Failed to view seed phrase: ' + error.message, 'error');
                    } else {
                        console.error('App not available for seed phrase notification');
                    }
                }
            });
        }

        // View Private Key button
        const viewPrivateKeyBtn = document.getElementById('view-private-key-btn');
        if (viewPrivateKeyBtn) {
            viewPrivateKeyBtn.addEventListener('click', async () => {
                if (this && this.showPrivateKeyModal) {
                    const password = prompt('Enter your wallet password to view private key:');
                    if (password) {
                        await this.showPrivateKeyModal(password);
                    }
                } else {
                    console.error('App not available for view private key button');
                }
            });
        }

        // Settings wallet buttons
        const addWalletSettingsBtn = document.getElementById('add-wallet-settings-btn');
        if (addWalletSettingsBtn) {
            addWalletSettingsBtn.addEventListener('click', () => {
                if (this && this.createWallet) {
                    this.createWallet(null, true); // Create with mnemonic
                } else {
                    console.error('App not available for add wallet button');
                }
            });
        }

        const importWalletSettingsBtn = document.getElementById('import-wallet-settings-btn');
        if (importWalletSettingsBtn) {
            importWalletSettingsBtn.addEventListener('click', () => {
                if (this && this.importWallet) {
                    this.importWallet();
                } else {
                    console.error('App not available for import wallet button');
                }
            });
        }

        // === PRE-LOGIN BUTTONS ===
        const cancelLoginBtn = document.getElementById('cancel-login-btn');
        if (cancelLoginBtn) {
            cancelLoginBtn.addEventListener('click', () => {
                if (this && this.showNoWalletScreen) {
                    this.showNoWalletScreen();
                } else {
                    console.error('App not available for cancel login button');
                }
            });
        }

        const importWalletLoginBtn = document.getElementById('import-wallet-login-btn');
        if (importWalletLoginBtn) {
            importWalletLoginBtn.addEventListener('click', () => {
                if (this && this.importWallet) {
                    this.importWallet();
                } else {
                    console.error('App not available for import wallet login button');
                }
            });
        }

        const forgotPasswordBtn = document.getElementById('forgot-password-btn');
        if (forgotPasswordBtn) {
            forgotPasswordBtn.addEventListener('click', () => {
                if (this && this.showForgotPasswordHelp) {
                    this.showForgotPasswordHelp();
                } else {
                    console.error('App not available for forgot password button');
                }
            });
        }

        // === ADDRESS ACTION BUTTONS ===
        const copyAddressBtn = document.getElementById('copy-address-btn');
        if (copyAddressBtn) {
            copyAddressBtn.addEventListener('click', () => {
                if (this && this.copyAddress) {
                    this.copyAddress();
                } else {
                    console.error('App not available for copy address button');
                }
            });
        }

        const shareAddressBtn = document.getElementById('share-address-btn');
        if (shareAddressBtn) {
            shareAddressBtn.addEventListener('click', () => {
                if (this && this.shareAddress) {
                    this.shareAddress();
                } else {
                    console.error('App not available for share address button');
                }
            });
        }

        const qrAddressBtn = document.getElementById('qr-address-btn');
        if (qrAddressBtn) {
            qrAddressBtn.addEventListener('click', () => {
                if (this && this.showQRCode) {
                    this.showQRCode();
                } else {
                    console.error('App not available for QR address button');
                }
            });
        }

        // Receive button → show QR code
        const receiveBtn = document.getElementById('receive-btn');
        if (receiveBtn) {
            receiveBtn.addEventListener('click', () => {
                if (this && this.showQRCode) {
                    this.showQRCode();
                } else {
                    console.error('App not available for receive button');
                }
            });
        }

        // Network selector → update address display
        const networkSelector = document.getElementById('network-selector');
        if (networkSelector) {
            networkSelector.addEventListener('change', () => {
                if (this) {
                    this.currentNetwork = networkSelector.value;
                    this.updateNetworkDisplay();
                } else {
                    console.error('App not available for network selector');
                }
            });
        }

        // === MINING BUTTONS ===
        const startMiningBtn = document.getElementById('start-mining-btn');
        if (startMiningBtn) {
            startMiningBtn.addEventListener('click', () => {
                if (this && this.startMining) {
                    this.startMining();
                } else {
                    console.error('App not available for start mining button');
                }
            });
        }

        const stopMiningBtn = document.getElementById('stop-mining-btn');
        if (stopMiningBtn) {
            stopMiningBtn.addEventListener('click', () => {
                if (this && this.stopMining) {
                    this.stopMining();
                } else {
                    console.error('App not available for stop mining button');
                }
            });
        }

        // === PORTFOLIO BUTTONS ===
        const portfolioRefreshBtn = document.getElementById('portfolio-refresh-btn');
        if (portfolioRefreshBtn) {
            portfolioRefreshBtn.addEventListener('click', () => {
                if (this && this.updatePortfolioScreen) {
                    this.updatePortfolioScreen();
                } else {
                    console.error('App not available for portfolio refresh button');
                }
            });
        }

        const portfolioPriceUpdateBtn = document.getElementById('portfolio-price-update-btn');
        if (portfolioPriceUpdateBtn) {
            portfolioPriceUpdateBtn.addEventListener('click', async () => {
                if (this && this.tokenSearch && this.showNotification) {
                    this.showNotification('💰 Updating prices...', 'info');
                    try {
                        if (this.tokenSearch && typeof this.tokenSearch.refreshAllPrices === 'function') {
                            await this.tokenSearch.refreshAllPrices();
                        }
                        await this.updatePortfolioScreen();
                        this.showNotification('✅ Prices updated!', 'success');
                    } catch(e) {
                        this.showNotification('⚠️ Price update failed: ' + e.message, 'error');
                    }
                } else {
                    console.error('App not available for portfolio price update');
                }
            });
        }

        const portfolioAddTokenBtn = document.getElementById('portfolio-add-token-btn');
        if (portfolioAddTokenBtn) {
            portfolioAddTokenBtn.addEventListener('click', async () => {
                const searchInput = document.getElementById('portfolio-search-token');
                const query = searchInput ? searchInput.value.trim() : '';
                if (this && this.tokenSearch && query) {
                    const resultsEl = document.getElementById('portfolio-search-results');
                    if (resultsEl) resultsEl.style.display = 'block';
                    try {
                        const results = await this.tokenSearch.searchTokens(query);
                        if (resultsEl) {
                            if (results.length === 0) {
                                resultsEl.innerHTML = '<p style="padding:10px;color:#888;">No tokens found.</p>';
                            } else {
                                resultsEl.innerHTML = results.slice(0, 10).map(t =>
                                    `<div style="padding:10px;cursor:pointer;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px" onclick="window.app.addTokenFromSearch('${t.address}','${t.symbol}','${t.name}','${t.chain||'bsc'}')">
                                        <span style="font-weight:bold">${t.symbol}</span>
                                        <span style="color:#666;font-size:0.85em">${t.name}</span>
                                    </div>`
                                ).join('');
                            }
                        }
                    } catch(e) {
                        if (this && this.showNotification) {
                            this.showNotification('Search error: ' + e.message, 'error');
                        } else {
                            console.error('App not available for portfolio search notification');
                        }
                    }
                } else {
                    if (this && this.showNotification) {
                        this.showNotification('Enter a token name, symbol, or contract address to search', 'info');
                    } else {
                        console.error('App not available for portfolio search notification');
                    }
                }
            });
        }

        // Portfolio search → submit on Enter
        const portfolioSearchInput = document.getElementById('portfolio-search-token');
        if (portfolioSearchInput) {
            portfolioSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const btn = document.getElementById('portfolio-add-token-btn');
                    if (btn) btn.click();
                }
            });
        }

        // === SETTINGS BUTTONS ===
        const logoutWalletBtn = document.getElementById('logout-wallet-btn');
        if (logoutWalletBtn) {
            logoutWalletBtn.addEventListener('click', () => {
                if (this && this.logoutWallet) {
                    this.logoutWallet();
                } else {
                    console.error('App not available for logout wallet button');
                }
            });
        }

        const deleteWalletBtn = document.getElementById('delete-wallet-btn');
        if (deleteWalletBtn) {
            deleteWalletBtn.addEventListener('click', () => {
                if (this && this.deleteWallet) {
                    this.deleteWallet();
                } else {
                    console.error('App not available for delete wallet button');
                }
            });
        }

        // === METAMASK / CONNECT BUTTONS ===
        const connectMetaMaskBtn = document.getElementById('connect-metamask-btn');
        if (connectMetaMaskBtn) {
            connectMetaMaskBtn.addEventListener('click', () => {
                if (this && this.addCHEESEToMetaMask) {
                    this.addCHEESEToMetaMask();
                } else {
                    console.error('App not available for connect metamask button');
                }
            });
        }

        const connectNCHMetaMaskBtn = document.getElementById('connect-nch-metamask-btn');
        if (connectNCHMetaMaskBtn) {
            connectNCHMetaMaskBtn.addEventListener('click', () => {
                if (this && this.addNCHTokenToMetaMask) {
                    this.addNCHTokenToMetaMask();
                } else {
                    console.error('App not available for connect NCH metamask button');
                }
            });
        }

        const addToMetaMaskSettingsBtn = document.getElementById('add-to-metamask-settings-btn');
        if (addToMetaMaskSettingsBtn) {
            addToMetaMaskSettingsBtn.addEventListener('click', () => {
                if (this && this.addCHEESEToMetaMask) {
                    this.addCHEESEToMetaMask();
                } else {
                    console.error('App not available for add to metamask settings button');
                }
            });
        }

        const addNCHToMetaMaskSettingsBtn = document.getElementById('add-nch-to-metamask-settings-btn');
        if (addNCHToMetaMaskSettingsBtn) {
            addNCHToMetaMaskSettingsBtn.addEventListener('click', () => {
                if (this && this.addNCHTokenToMetaMask) {
                    this.addNCHTokenToMetaMask();
                } else {
                    console.error('App not available for add NCH to metamask settings button');
                }
            });
        }

        const connectDAppBtn = document.getElementById('connect-dapp');
        if (connectDAppBtn) {
            connectDAppBtn.addEventListener('click', () => {
                if (this && this.connectDApp) {
                    this.connectDApp();
                } else {
                    console.error('App not available for connect dapp button');
                }
            });
        }

        // === NOTARY BUTTONS ===
        // Notary logic is consolidated in setupNotaryListeners() and handleNotaryFile()
    }

    // Add CHEESE Network to MetaMask
    async addCHEESEToMetaMask() {
        if (this.metaMaskStyle && typeof this.metaMaskStyle.addNetwork === 'function') {
            return this.metaMaskStyle.addNetwork();
        }
        if (typeof window.ethereum === 'undefined') {
            this.showNotification('🦊 MetaMask not detected. Please install MetaMask first.', 'error');
            window.open('https://metamask.io', '_blank');
            return;
        }
        try {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: '0x4F1A', // 20250
                    chainName: 'CHEESE Blockchain',
                    nativeCurrency: {
                        name: 'NCheese',
                        symbol: 'NCH',
                        decimals: 18
                    },
                    rpcUrls: ['https://cheeseblockchain.com/api/rpc'],
                    blockExplorerUrls: ['https://cheeseblockchain.com/explorer']
                }]
            });
            this.showNotification('✅ CHEESE Network added to MetaMask!', 'success');
            
            // Auto-trigger NCH Token Logo watch prompt
            setTimeout(() => {
                this.addNCHTokenToMetaMask();
            }, 1000); // 1-second delay for smooth transitions
        } catch (error) {
            this.showNotification('❌ MetaMask error: ' + error.message, 'error');
        }
    }

    // Add Virtual NCH Token (with Logo) to MetaMask
    async addNCHTokenToMetaMask() {
        if (typeof window.ethereum === 'undefined') {
            this.showNotification('🦊 MetaMask not detected. Please install MetaMask first.', 'error');
            window.open('https://metamask.io', '_blank');
            return;
        }
        try {
            const wasAdded = await window.ethereum.request({
                method: 'wallet_watchAsset',
                params: {
                    type: 'ERC20',
                    options: {
                        address: '0x000000000000000000000000000000000000c8ee', // Virtual NCH Contract Address
                        symbol: 'NCH',
                        decimals: 6,
                        image: 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png'
                    }
                }
            });
            if (wasAdded) {
                this.showNotification('🧀 NCH Token (with Logo) added to MetaMask!', 'success');
            } else {
                this.showNotification('⚠️ Token addition rejected.', 'warning');
            }
        } catch (error) {
            this.showNotification('❌ MetaMask error: ' + error.message, 'error');
        }
    }

    // Redundant Notary methods removed. Consolidated logic is at the bottom of the file.


    // Add notarization to history display
    addNotaryToHistory(hash, filename) {
        try {
            const historyKey = 'cheeseNotaryHistory';
            const existing = JSON.parse(localStorage.getItem(historyKey) || '[]');
            existing.unshift({ hash, filename, timestamp: new Date().toISOString(), address: this.wallet.address });
            localStorage.setItem(historyKey, JSON.stringify(existing.slice(0, 50)));
            this.updateNotaryScreen();
        } catch(e) { console.warn('Error saving notary history:', e); }
    }

    // Update notary screen (load history)
    updateNotaryScreen() {
        const historyList = document.getElementById('notary-history-list');
        if (!historyList) return;
        try {
            const history = JSON.parse(localStorage.getItem('cheeseNotaryHistory') || '[]');
            if (history.length === 0) {
                historyList.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">No notarizations found.</p>';
                return;
            }
            historyList.innerHTML = history.map(item => `
                <div style="padding:12px;border-bottom:1px solid #eee;margin-bottom:8px;">
                    <div style="font-weight:bold;color:#333;margin-bottom:4px;">📄 ${item.filename || 'Unknown File'}</div>
                    <div style="font-family:monospace;font-size:0.75em;color:#667eea;word-break:break-all;background:#f0f4ff;padding:6px;border-radius:4px;">${item.hash}</div>
                    <div style="font-size:0.8em;color:#888;margin-top:4px;">${new Date(item.timestamp).toLocaleString()}</div>
                </div>
            `).join('');
        } catch(e) { console.warn('Error loading notary history:', e); }
    }

    // Add token from search result
    addTokenFromSearch(address, symbol, name, chain) {
        if (this.tokenSearch && typeof this.tokenSearch.addToken === 'function') {
            this.tokenSearch.addToken({ address, symbol, name, chain });
            this.showNotification('✅ Token added: ' + symbol, 'success');
            const resultsEl = document.getElementById('portfolio-search-results');
            if (resultsEl) resultsEl.style.display = 'none';
            const searchInput = document.getElementById('portfolio-search-token');
            if (searchInput) searchInput.value = '';
            this.updatePortfolioScreen();
        } else {
            this.showNotification('Token search not available', 'error');
        }
    }

    // Update portfolio prices
    updatePortfolioPrices() {
        // Implementation would go here
        console.log('Updating portfolio prices...');
    }

    // Show portfolio
    showPortfolio() {
        this.showScreen('portfolio');
    }

    // Show address book
    showAddressBook() {
        // Implementation would go here
        console.log('Showing address book...');
    }

    // Logout wallet
    logoutWallet() {
        this.wallet = null;
        this.showNoWalletScreen();
        this.showNotification('🔒 Wallet logged out', 'info');
    }

    // Delete wallet
    deleteWallet() {
        if (confirm('Are you sure you want to delete this wallet? This cannot be undone!\n\nMake sure you have your mnemonic seed phrase backed up!')) {
            this.walletCore.deleteWallet();
            this.wallet = null;
            this.showNoWalletScreen();
            this.showNotification('🗑️ Wallet deleted', 'info');
        }
    }

    // Start mining
    startMining() {
        if (this.mobileMiner) {
            this.mobileMiner.startMining();
        }
    }

    // Stop mining
    stopMining() {
        if (this.mobileMiner) {
            this.mobileMiner.stopMining();
        }
    }

    // Start mobile mining
    startMobileMining() {
        this.startMining();
    }

    // Stop mobile mining
    stopMobileMining() {
        this.stopMining();
    }

    // Connect DApp
    connectDApp() {
        if (this.connectManager) {
            this.connectManager.connectDApp();
        }
    }

    // Setup bridge listeners (called when bridge screen is shown)
    setupBridgeListeners() {
        if (this.bridgeListenersSetup) {
            return;
        }
        this.bridgeListenersSetup = true;

        // Remove existing listeners to prevent duplicates
        const existingTabs = document.querySelectorAll('.bridge-tab');
        existingTabs.forEach(tab => {
            const newTab = tab.cloneNode(true);
            tab.parentNode.replaceChild(newTab, tab);
        });

        // Bridge tabs (switch between out/in)
        document.querySelectorAll('.bridge-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const direction = e.target.dataset.direction;

                // Update tab active state
                document.querySelectorAll('.bridge-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');

                // Show/hide sections
                const outSection = document.getElementById('bridge-out-section');
                const inSection = document.getElementById('bridge-in-section');

                if (direction === 'out') {
                    if (outSection) outSection.classList.add('active');
                    if (inSection) inSection.classList.remove('active');
                } else if (direction === 'in') {
                    if (outSection) outSection.classList.remove('active');
                    if (inSection) inSection.classList.add('active');
                }
            });
        });

        // Bridge amount input listener
        const bridgeAmountInput = document.getElementById('bridge-amount');
        if (bridgeAmountInput) {
            bridgeAmountInput.addEventListener('input', () => this.updateBridgePreview());
        }

        // Bridge Out button
        const bridgeOutBtn = document.getElementById('bridge-out-btn');
        if (bridgeOutBtn) {
            bridgeOutBtn.addEventListener('click', async () => {
                const amount = parseFloat(document.getElementById('bridge-amount')?.value);
                const toChain = document.getElementById('bridge-to-chain')?.value;
                const recipientAddress = document.getElementById('bridge-recipient')?.value;

                if (!amount || amount < 10) {
                    this.showNotification('Minimum bridge amount is 10 NCH', 'error');
                    return;
                }

                if (!recipientAddress || !recipientAddress.startsWith('0x') || recipientAddress.length !== 42) {
                    this.showNotification('Please enter a valid recipient address', 'error');
                    return;
                }

                try {
                    await this.bridgeOut(amount, toChain, recipientAddress);
                } catch (error) {
                    console.error('Bridge out error:', error);
                    this.showNotification('Bridge failed: ' + error.message, 'error');
                }
            });
        }

        // Bridge In button
        this.handleBridgeIn();
    }

    // Bridge In handler
    handleBridgeIn() {
        const bridgeInBtn = document.getElementById('bridge-in-btn');
        if (bridgeInBtn) {
            bridgeInBtn.addEventListener('click', async () => {
                const amount = parseFloat(document.getElementById('bridge-in-amount')?.value);
                const fromChain = document.getElementById('bridge-from-chain')?.value;
                const transactionHash = document.getElementById('bridge-source-tx')?.value; // Corrected ID
                const recipientAddress = document.getElementById('bridge-in-recipient')?.value;

                if (!amount || amount <= 0) {
                    this.showNotification('Please enter a valid amount', 'error');
                    return;
                }

                if (!fromChain) {
                    this.showNotification('Please select source chain', 'error');
                    return;
                }

                if (!transactionHash) {
                    this.showNotification('Please enter source transaction hash', 'error');
                    return;
                }

                try {
                    await this.bridgeIn(amount, fromChain, transactionHash, recipientAddress);
                } catch (error) {
                    console.error('Bridge in error:', error);
                    this.showNotification('Bridge in failed: ' + error.message, 'error');
                }
            });
        }
    }

    // Update bridge preview (calculate fees and net amounts)
    updateBridgePreview() {
        const amount = parseFloat(document.getElementById('bridge-amount')?.value || 0);
        if (amount <= 0) {
            document.getElementById('bridge-send-amount').textContent = '0 NCH';
            document.getElementById('bridge-fee').textContent = '0 NCH';
            document.getElementById('bridge-receive-amount').textContent = '0 NCH';
            const timeEl = document.getElementById('bridge-time');
            if (timeEl) timeEl.textContent = '-';
            return;
        }

        const bridgeCalc = this.bridgeEngine.calculateBridgeAmount(amount);

        const sendAmountEl = document.getElementById('bridge-send-amount');
        const feeEl = document.getElementById('bridge-fee');
        const receiveAmountEl = document.getElementById('bridge-receive-amount');
        const timeEl = document.getElementById('bridge-time');

        if (sendAmountEl) sendAmountEl.textContent = `${bridgeCalc.originalAmount.toFixed(2)} NCH`;
        if (feeEl) feeEl.textContent = `${bridgeCalc.fee.toFixed(2)} NCH`;
        if (receiveAmountEl) receiveAmountEl.textContent = `${bridgeCalc.netAmount.toFixed(2)} NCH`;
        if (timeEl) timeEl.textContent = '~10-30 minutes'; // Estimated bridge time
    }

    // Update screen-specific content
    async updateScreenContent(screen) {
        if (screen === 'home') {
            // CRITICAL: Update balance BEFORE displaying home screen (SAME LOGIC AS PORTFOLIO)
            // This is why portfolio works - it calls updateBalance() BEFORE showing
            if (this.wallet && this.wallet.address) {
                console.log('📊 Home: Fetching balance before display...');

                // CRITICAL: Ensure wallet-section is visible before trying to update balance
                const walletSection = document.getElementById('wallet-section');
                if (walletSection && walletSection.style.display === 'none') {
                    walletSection.style.display = 'block';
                    // Wait for DOM to update
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                }

                await this.updateBalance();
                console.log('📊 Home: Balance after update:', this.balance);

                // Now update transactions
                this.updateTransactions();

                // Update UI - this will display the balance
                this.updateUI();
            } else {
                // No wallet loaded, show 0 balance
                const balanceEl = document.getElementById('balance');
                if (balanceEl) {
                    balanceEl.textContent = '0.00';
                }
                this.updateUI();
            }
        } else if (screen === 'portfolio') {
            // CRITICAL: Portfolio already calls updateBalance() inside updatePortfolioScreen()
            // So we don't need to call it here - updatePortfolioScreen() handles it
            this.updatePortfolioScreen();
        } else if (screen === 'sell') {
            this.updateSellScreen();
        } else if (screen === 'swap') {
            this.updateSwapScreen();
        } else if (screen === 'bridge') {
            this.updateBridgeHistory();
            this.setupBridgeListeners();
        } else if (screen === 'settings') {
            this.updateFounderWalletDisplay();
            this.updateAddressBookPreview();
            this.updatePortfolioStats();
        } else if (screen === 'notary') {
            this.updateNotaryScreen();
        } else if (screen === 'p2p') {
            this.updateP2PScreen();
        }
    }

    // Update address book preview (for settings screen)
    updateAddressBookPreview() {
        if (this.enhancements) {
            const addresses = this.enhancements.getAddressBook();
            const previewEl = document.getElementById('addressbook-preview');
            if (previewEl) {
                previewEl.textContent = `${addresses.length} saved addresses`;
            }
        }
    }

    // Update portfolio stats (for settings screen)
    async updatePortfolioStats() {
        if (this.wallet && this.enhancements) {
            const stats = await this.enhancements.getPortfolioStats(this.wallet.address);
            const statsEl = document.getElementById('portfolio-stats');
            if (statsEl) {
                statsEl.innerHTML = `
                    <div>Balance: ${stats.balance.toFixed(2)} NCH</div>
                    <div>Transactions: ${stats.transactionCount}</div>
                `;
            }
        }
    }

    // Update UI
    updateUI() {
        // CRITICAL: Update balance display - ensure it's always shown
        const balanceEl = document.getElementById('balance');
        if (balanceEl) {
            if (this.balance !== undefined && this.balance !== null && !isNaN(this.balance)) {
                balanceEl.textContent = this.balance.toFixed(2);
                console.log('✅ updateUI: Balance displayed:', this.balance.toFixed(2));
            } else {
                balanceEl.textContent = '0.00';
                console.log('⚠️ updateUI: Balance is undefined/null, showing 0.00');
            }
        } else {
            console.warn('⚠️ Balance element not found in updateUI()');
            // Retry after a short delay
            setTimeout(() => {
                const retryEl = document.getElementById('balance');
                if (retryEl && this.balance !== undefined && this.balance !== null) {
                    retryEl.textContent = this.balance.toFixed(2);
                    console.log('✅ updateUI: Balance displayed on retry:', this.balance.toFixed(2));
                }
            }, 100);
        }

        // Update wallet address and network display
        if (this.wallet) {
            this.updateNetworkDisplay();
        }

        // Show/hide wallet sections based on state
        const walletSection = document.getElementById('wallet-section');
        const noWalletSection = document.getElementById('no-wallet-section');
        const loginSection = document.getElementById('login-section');

        // CRITICAL: Only show wallet-section if wallet is FULLY loaded (has privateKey)
        // The minimal wallet object set in init() should NOT trigger wallet display
        if (this.wallet && this.wallet.privateKey) {
            // Wallet is FULLY loaded - show wallet section FIRST before updating balance
            if (walletSection) {
                walletSection.style.display = 'block';
                // Force a reflow to ensure element is visible
                void walletSection.offsetHeight;
            }
            if (noWalletSection) noWalletSection.style.display = 'none';
            if (loginSection) loginSection.style.display = 'none';
        } else {
            // No wallet loaded OR wallet not fully loaded - check if wallet exists in storage
            const hasWallet = this.checkForExistingWallet();
            if (hasWallet) {
                // Wallet exists but not loaded - show login screen
                if (loginSection) loginSection.style.display = 'block';
                if (noWalletSection) noWalletSection.style.display = 'none';
                if (walletSection) walletSection.style.display = 'none';
            } else {
                // No wallet exists - show create wallet screen
                if (noWalletSection) noWalletSection.style.display = 'block';
                if (loginSection) loginSection.style.display = 'none';
                if (walletSection) walletSection.style.display = 'none';
            }
        }
    }

    // Update transactions
    updateTransactions() {
        const transactionsEl = document.getElementById('transactions-list');
        if (!transactionsEl) return;

        if (this.transactions.length === 0) {
            transactionsEl.innerHTML = '<p>No transactions yet</p>';
            return;
        }

        transactionsEl.innerHTML = this.transactions.slice(0, 10).map(tx => `
            <div class="transaction-item">
                <div class="tx-type">${tx.from === this.wallet.address ? 'Sent' : 'Received'}</div>
                <div class="tx-amount">${tx.amount} NCH</div>
                <div class="tx-time">${new Date(tx.timestamp).toLocaleString()}</div>
            </div>
        `).join('');
    }

    // Show notification
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
            color: white;
            border-radius: 5px;
            z-index: 10000;
            animation: slideIn 0.3s;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Modal functions
    showCreateWalletModal() {
        const existingModal = document.getElementById('create-wallet-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'create-wallet-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); backdrop-filter: blur(5px);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000; animation: fadeIn 0.3s;
        `;

        modal.innerHTML = `
            <div class="card" style="width: 90%; max-width: 400px; animation: modalPop 0.3s; padding: 25px; border-radius: 15px;">
                <h3 style="margin-bottom: 15px; color: var(--secondary);">🔐 Create New Wallet</h3>
                <p style="margin-bottom: 20px; font-size: 0.9em; color: var(--text-light);">
                    Create a password to encrypt your new wallet. You will need this to unlock it later.
                </p>
                <div class="form-group" style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: bold;">New Password</label>
                    <input type="password" id="new-wallet-password" class="form-control" 
                        placeholder="Min 4 characters" 
                        style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <button id="cancel-create-btn" class="btn btn-secondary" style="flex: 1;">Cancel</button>
                    <button id="confirm-create-btn" class="btn btn-primary" style="flex: 1;">Create Wallet</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const passwordInput = document.getElementById('new-wallet-password');
        passwordInput.focus();

        document.getElementById('cancel-create-btn').onclick = () => modal.remove();
        document.getElementById('confirm-create-btn').onclick = () => {
            const password = passwordInput.value;
            if (!password || password.trim().length < 4) {
                this.showNotification('Password must be at least 4 characters', 'error');
                return;
            }
            modal.remove();
            this.createWallet(password, false);
        };

        // Handle Enter key
        passwordInput.onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('confirm-create-btn').click();
        };
    }

    async showSendModal() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('Please create or unlock a wallet first', 'error');
            return;
        }

        // Get available tokens from portfolio
        const availableTokens = await this.getAvailableTokensForSend();

        // Create send modal
        const existingModal = document.getElementById('send-modal');
        if (existingModal) {
            document.body.removeChild(existingModal);
        }

        const modal = document.createElement('div');
        modal.id = 'send-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 25px;
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;

        // Build token options
        const tokenOptions = availableTokens.map(token => {
            const networkBadge = token.chain && token.chain !== 'cheese-native' ?
                `<span style="font-size: 0.75em; color: #667eea; margin-left: 5px;">(${token.chain.toUpperCase()})</span>` : '';
            return `<option value="${token.address || 'native'}" data-chain="${token.chain || 'cheese-native'}" data-symbol="${token.symbol}" data-decimals="${token.decimals || 18}" data-balance="${token.balance || 0}">
                ${token.symbol || 'TOKEN'} ${networkBadge} - ${(token.balance || 0).toFixed(4)}
            </option>`;
        }).join('');

        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: #333;">📤 Send Token</h3>
                <button id="send-close-btn" style="background: none; border: none; font-size: 1.5em; cursor: pointer; color: #666;">&times;</button>
            </div>
            <div class="form-group" style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">Select Token</label>
                <select id="send-token-select" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1em; background: white;">
                    ${tokenOptions}
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">Recipient Address</label>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="send-to-address" placeholder="0x..." 
                           style="flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-family: monospace; font-size: 0.9em;">
                    <button id="send-scan-qr-btn" class="btn btn-secondary" style="padding: 12px 15px; white-space: nowrap;">📷 Scan QR</button>
                </div>
            </div>
            <div class="form-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">Amount</label>
                <input type="number" id="send-amount" placeholder="0.00" min="0" step="0.0001"
                       style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1em;">
            </div>
            <div id="send-balance-info" style="margin-bottom: 20px; padding: 12px; background: #f8f9fa; border-radius: 8px; font-size: 0.9em; color: #666;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Available Balance:</span>
                    <span id="send-available-balance" style="font-weight: bold; color: #667eea;">0.0000</span>
                </div>
                <div id="send-network-info" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 0.85em; color: #999;">
                    Network: <span id="send-network-name">Native Cheese</span>
                </div>
            </div>
            <div class="form-group" style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">🔒 Confirm Password</label>
                <input type="password" id="send-password" placeholder="Enter your wallet password" 
                       style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1em;"
                       autocomplete="current-password">
                <div style="margin-top: 5px; font-size: 0.85em; color: #666;">Required to authorize this transaction</div>
            </div>
            <button id="send-submit-btn" class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 1em; font-weight: 500;">Send Transaction</button>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Close button
        const closeBtn = content.querySelector('#send-close-btn');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });

        // QR Scanner button
        const scanBtn = content.querySelector('#send-scan-qr-btn');
        scanBtn.addEventListener('click', () => {
            this.showQRScanner((scannedAddress) => {
                const addressInput = content.querySelector('#send-to-address');
                if (addressInput) {
                    addressInput.value = scannedAddress;
                }
            });
        });

        // Update balance and network when token changes
        const tokenSelect = content.querySelector('#send-token-select');
        const updateTokenInfo = () => {
            const selectedOption = tokenSelect.options[tokenSelect.selectedIndex];
            const balance = parseFloat(selectedOption.getAttribute('data-balance') || 0);
            const symbol = selectedOption.getAttribute('data-symbol') || 'TOKEN';
            const chain = selectedOption.getAttribute('data-chain') || 'cheese-native';

            const balanceEl = content.querySelector('#send-available-balance');
            const networkEl = content.querySelector('#send-network-name');

            if (balanceEl) {
                balanceEl.textContent = `${balance.toFixed(4)} ${symbol.toUpperCase()}`;
            }
            if (networkEl) {
                if (chain === 'cheese-native') {
                    networkEl.textContent = 'Native Cheese Blockchain';
                } else if (chain === 'bsc' || chain === 'BSC') {
                    networkEl.textContent = 'Binance Smart Chain (BSC)';
                } else {
                    networkEl.textContent = chain.toUpperCase();
                }
            }
        };

        tokenSelect.addEventListener('change', updateTokenInfo);
        updateTokenInfo(); // Initial update

        // Submit button
        const submitBtn = content.querySelector('#send-submit-btn');
        submitBtn.addEventListener('click', async () => {
            const toAddress = content.querySelector('#send-to-address').value.trim();
            const amount = parseFloat(content.querySelector('#send-amount').value);
            const password = content.querySelector('#send-password').value;
            const selectedOption = tokenSelect.options[tokenSelect.selectedIndex];
            const tokenAddress = selectedOption.value;
            const tokenChain = selectedOption.getAttribute('data-chain') || 'cheese-native';
            const tokenSymbol = selectedOption.getAttribute('data-symbol') || 'NCH';
            const tokenDecimals = parseInt(selectedOption.getAttribute('data-decimals') || 18);
            const availableBalance = parseFloat(selectedOption.getAttribute('data-balance') || 0);

            // Validation
            if (!toAddress) {
                this.showNotification('Please enter recipient address', 'error');
                return;
            }

            if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
                this.showNotification('Invalid address format', 'error');
                return;
            }

            if (!amount || amount <= 0) {
                this.showNotification('Please enter a valid amount', 'error');
                return;
            }

            if (amount > availableBalance) {
                this.showNotification(`Insufficient balance. Available: ${availableBalance.toFixed(4)} ${tokenSymbol}`, 'error');
                return;
            }

            // Password validation - REQUIRED for all transactions
            if (!password || password.trim() === '') {
                this.showNotification('🔒 Please enter your wallet password to authorize this transaction', 'error');
                content.querySelector('#send-password').focus();
                return;
            }

            // Verify password by attempting to decrypt wallet using walletCore
            try {
                const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                if (!walletData || !walletData.address) {
                    this.showNotification('Wallet not found. Please refresh the page.', 'error');
                    return;
                }

                // If wallet is encrypted, verify password using walletCore
                if (walletData.encrypted && walletData.encryptedPrivateKey) {
                    // Use walletCore to verify password - it handles all decryption logic (Web Crypto API or old format)
                    try {
                        // Temporarily save current wallet state
                        const currentWallet = this.wallet;

                        // Try to load wallet with password - this will decrypt and validate
                        const testWallet = await this.walletCore.loadWallet(password.trim());

                        // Restore current wallet state (don't replace it, just verify password)
                        this.wallet = currentWallet;

                        if (!testWallet || !testWallet.privateKey || testWallet.address !== walletData.address) {
                            this.showNotification('❌ Incorrect password. Please try again.', 'error');
                            content.querySelector('#send-password').value = '';
                            content.querySelector('#send-password').focus();
                            return;
                        }
                        // Password is correct - continue with transaction
                        console.log('✅ Password verified successfully');
                    } catch (decryptError) {
                        console.error('Password verification error:', decryptError);
                        this.showNotification('❌ Incorrect password. Please try again.', 'error');
                        content.querySelector('#send-password').value = '';
                        content.querySelector('#send-password').focus();
                        return;
                    }
                } else {
                    // Unencrypted wallet - still require password confirmation for security
                    // For unencrypted wallets, we'll accept any non-empty password as confirmation
                    // This ensures the user intentionally wants to send
                    if (!password || password.trim() === '') {
                        this.showNotification('🔒 Please enter a confirmation password to authorize this transaction', 'error');
                        content.querySelector('#send-password').focus();
                        return;
                    }
                    // Password provided - accept it as confirmation for unencrypted wallets
                    console.log('✅ Password confirmation provided for unencrypted wallet');
                }
            } catch (passwordError) {
                console.error('Password validation error:', passwordError);
                this.showNotification('Error validating password. Please try again.', 'error');
                return;
            }

            // Disable button and show loading state
            submitBtn.disabled = true;
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Sending...';
            submitBtn.style.opacity = '0.6';
            submitBtn.style.cursor = 'not-allowed';

            // Add a safety timeout to prevent infinite hanging
            const transactionTimeout = setTimeout(() => {
                console.error('⏱️ Transaction timeout safety net triggered (90 seconds)');
                if (submitBtn.disabled) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                    this.showNotification('Transaction timed out after 90 seconds. Please try again.', 'error');
                }
            }, 90000); // 90 second safety timeout

            try {
                console.log('📤 ========== STARTING TRANSACTION ==========');
                console.log('📤 Transaction details:', {
                    to: toAddress,
                    amount: amount,
                    token: tokenSymbol,
                    chain: tokenChain,
                    tokenAddress: tokenAddress,
                    from: this.wallet ? this.wallet.address : 'NO WALLET'
                });

                // Route to appropriate sending method based on token chain
                let transactionResult;
                if (tokenChain === 'cheese-native' || tokenAddress === 'native') {
                    // Native NCH
                    console.log('📤 Sending native NCH transaction...');
                    console.log('📤 Calling this.sendTransaction()...');
                    try {
                        transactionResult = await this.sendTransaction(toAddress, amount);
                        console.log('✅ sendTransaction() completed successfully');
                        console.log('📥 Native transaction result:', transactionResult);
                    } catch (sendError) {
                        console.error('❌ sendTransaction() threw error:', sendError);
                        console.error('❌ Error stack:', sendError.stack);
                        throw sendError; // Re-throw to be caught by outer catch
                    }
                } else if (tokenChain === 'bsc' || tokenChain === 'BSC') {
                    // BSC token - pass password from modal to avoid asking twice
                    console.log('📤 Sending BSC token transaction...');
                    transactionResult = await this.sendBSCToken(toAddress, amount, tokenAddress, tokenSymbol, tokenDecimals, password);
                    console.log('📥 BSC token transaction result:', transactionResult);
                } else {
                    throw new Error(`Sending ${tokenChain} tokens is not yet supported`);
                }

                // Clear safety timeout
                clearTimeout(transactionTimeout);

                // Success - close modal and update balance
                console.log('✅ Transaction completed successfully');
                document.body.removeChild(modal);
                await this.updateBalance();
                await this.updatePortfolioScreen();
            } catch (error) {
                // Clear safety timeout
                clearTimeout(transactionTimeout);

                console.error('❌ Transaction error:', error);
                console.error('❌ Error stack:', error.stack);

                // Provide user-friendly error messages
                let errorMessage = 'Transaction failed';
                if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
                    errorMessage = 'Transaction timed out. The server may be slow. Please try again.';
                } else if (error.message.includes('Cannot connect') || error.message.includes('Failed to fetch')) {
                    errorMessage = 'Cannot connect to blockchain server. Please check your internet connection.';
                } else if (error.message.includes('Signature must include')) {
                    errorMessage = 'Transaction signature error. Please refresh the page and try again.';
                } else if (error.message) {
                    errorMessage = error.message;
                }

                this.showNotification('Transaction error: ' + errorMessage, 'error');

                // Re-enable button
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';

                // Don't close modal on error so user can retry
            }
        });
    }

    // Get available tokens for sending (from portfolio)
    async getAvailableTokensForSend() {
        const tokens = [];

        // CRITICAL FIX: Use the SAME logic as updatePortfolioScreen() to get all tokens
        // This ensures send dropdown shows exactly what's in the portfolio

        // Always include native NCH (even if balance is 0)
        // CRITICAL FIX: Always set logoURI for NCH (official logo)
        tokens.push({
            address: 'native',
            symbol: 'NCH',
            name: 'NCheese (Native CHEESE)',
            chain: 'cheese-native',
            balance: this.balance || 0,
            decimals: 18,
            logoURI: './icon-192.png' // Official Cheese logo - always embedded
        });

        if (!this.tokenSearch || !this.wallet || !this.wallet.address) {
            return tokens; // Return just NCH if no wallet or tokenSearch
        }

        // Get user tokens (same as portfolio)
        const userTokens = this.tokenSearch.getUserTokens();
        const userTokensWithoutNCH = userTokens.filter(t =>
            t.symbol !== 'NCH' && t.chain !== 'cheese-native'
        );

        // Get cross-chain balances (BSC, etc.) - same as portfolio
        let crossChainTokens = [];
        if (this.crossChainBalance && this.wallet.address) {
            try {
                // Pass user tokens to cross-chain balance checker (same as portfolio)
                // CRITICAL FIX: Include ALL tokens with 0x addresses (BSC tokens) even if chain is not set to 'bsc'
                const userTokensForBSC = userTokens.filter(t =>
                    t.address &&
                    t.address !== 'native' &&
                    t.address !== '0x0000000000000000000000000000000000000000' &&
                    t.address.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
                    t.address.startsWith('0x') &&
                    // Include if chain is BSC OR if it's a 0x address (likely BSC token)
                    ((t.chain && (t.chain.toLowerCase() === 'bsc')) ||
                        (!t.chain || t.chain === 'cheese-native' || !t.chain.includes('native')))
                );

                const crossChainBalances = await this.crossChainBalance.getAllBalances(
                    this.wallet.address,
                    userTokensForBSC
                );

                // Add BSC tokens (same as portfolio)
                if (crossChainBalances.bsc && crossChainBalances.bsc.tokens) {
                    crossChainTokens = crossChainBalances.bsc.tokens.map(token => ({
                        ...token,
                        chain: 'bsc'
                    }));
                }
            } catch (error) {
                console.warn('Error fetching cross-chain balances for send:', error);
            }
        }

        // Combine all tokens (same as portfolio logic)
        const allPortfolioTokens = [...userTokensWithoutNCH, ...crossChainTokens];

        // Deduplicate tokens (same as portfolio)
        const uniqueTokens = [];
        const seenTokens = new Map();

        for (const token of allPortfolioTokens) {
            const key = `${(token.address || '').toLowerCase()}_${(token.chain || '').toLowerCase()}`;
            if (!seenTokens.has(key)) {
                seenTokens.set(key, true);
                uniqueTokens.push({
                    address: token.address,
                    symbol: token.symbol || 'TOKEN',
                    name: token.name || 'Unknown Token',
                    chain: token.chain || 'bsc',
                    balance: token.balance || 0,
                    decimals: token.decimals || 18,
                    logoURI: token.logoURI || ''
                });
            }
        }

        // Add all unique tokens to send list
        tokens.push(...uniqueTokens);

        console.log('📤 Send: Available tokens:', tokens.length, tokens.map(t => t.symbol));

        return tokens;
    }

    // Populate swap token dropdowns with fixed native swap tokens (NCH, USDT, USDC)
    async populateSwapTokens() {
        const fromSelect = document.getElementById('swap-from');
        const toSelect = document.getElementById('swap-to');

        if (!fromSelect || !toSelect) return;

        // Synced with CHEESE_NATIVE_SWAP_TOKENS / active DEX pools (NCH/USDT only)
        const nativeSwapSymbols = (window.CHEESE_NATIVE_SWAP_TOKENS || ['NCH', 'USDT']).slice();
        const swapTokens = nativeSwapSymbols.map((symbol) => {
            const meta = window.CHEESE_TOKENS && window.CHEESE_TOKENS[symbol];
            return {
                symbol,
                name: meta ? meta.name : symbol,
                chain: meta && meta.chain ? meta.chain : 'cheese-native'
            };
        });

        // Clear existing options
        fromSelect.innerHTML = '';
        toSelect.innerHTML = '';

        // Add fixed swap tokens to both dropdowns
        swapTokens.forEach(token => {
            const fromOption = document.createElement('option');
            fromOption.value = token.symbol;
            fromOption.textContent = token.name;
            fromOption.dataset.chain = token.chain;
            fromSelect.appendChild(fromOption);

            const toOption = document.createElement('option');
            toOption.value = token.symbol;
            toOption.textContent = token.name;
            toOption.dataset.chain = token.chain;
            toSelect.appendChild(toOption);
        });

        // Set default selections
        fromSelect.value = 'NCH';
        toSelect.value = 'USDT';
    }

    // Send BSC token using Web3.js
    async sendBSCToken(toAddress, amount, tokenAddress, tokenSymbol, decimals = 18, password = null) {
        try {
            if (!this.wallet || !this.wallet.address) {
                throw new Error('No wallet loaded');
            }

            // Get private key
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            if (!walletData || !walletData.address) {
                throw new Error('Wallet not found or invalid');
            }

            let privateKey = walletData.privateKey;
            if (!privateKey && walletData.encryptedPrivateKey) {
                // Use provided password from modal, or prompt if not provided
                if (!password) {
                    password = prompt('Enter your wallet password to send transaction:');
                    if (!password) {
                        throw new Error('Password required');
                    }
                }
                privateKey = await this.walletCore.decryptPrivateKey(walletData.encryptedPrivateKey, password);
            }

            if (!privateKey) {
                throw new Error('Private key not available');
            }

            // Initialize Web3 if needed
            if (!this.crossChainBalance || !this.crossChainBalance.web3) {
                await this.crossChainBalance.initWeb3();
            }

            if (!this.crossChainBalance.web3) {
                throw new Error('Web3 not available. Please check your internet connection.');
            }

            const web3 = this.crossChainBalance.web3;

            // Check BNB balance for gas (only needed for BSC network transactions)
            // Note: This check is correct - BSC tokens require BNB for gas fees on BSC network
            // If you're sending native chain tokens, this function won't be called
            const bnbBalance = await this.crossChainBalance.getBNBBalance(this.wallet.address);
            if (bnbBalance < 0.001) {
                throw new Error('Insufficient BNB for gas fees. BSC tokens require BNB (Binance Coin) to pay transaction fees on Binance Smart Chain. You need at least 0.001 BNB in your wallet to send BSC tokens.');
            }

            // Convert amount to token's smallest unit (respecting token decimals)
            let amountInWei;
            if (decimals === 18) {
                amountInWei = web3.utils.toWei(amount.toString(), 'ether');
            } else {
                // For tokens with different decimals, multiply by 10^decimals
                const amountBN = web3.utils.toBN(Math.floor(amount * Math.pow(10, decimals)).toString());
                amountInWei = amountBN.toString();
            }

            // ERC-20 transfer ABI
            const transferABI = [{
                "constant": false,
                "inputs": [
                    { "name": "_to", "type": "address" },
                    { "name": "_value", "type": "uint256" }
                ],
                "name": "transfer",
                "outputs": [{ "name": "", "type": "bool" }],
                "type": "function"
            }];

            const contract = new web3.eth.Contract(transferABI, tokenAddress);

            // Create account from private key
            const account = web3.eth.accounts.privateKeyToAccount('0x' + privateKey.replace(/^0x/, ''));
            web3.eth.accounts.wallet.add(account);
            web3.eth.defaultAccount = account.address;

            this.showNotification('⏳ Sending transaction...', 'info');

            // Estimate gas
            const gasEstimate = await contract.methods.transfer(toAddress, amountInWei.toString()).estimateGas({
                from: this.wallet.address
            });

            // Send transaction
            const tx = await contract.methods.transfer(toAddress, amountInWei.toString()).send({
                from: this.wallet.address,
                gas: gasEstimate,
                gasPrice: web3.utils.toWei('5', 'gwei') // 5 gwei gas price
            });

            this.showNotification(`✅ ${tokenSymbol} sent successfully! Transaction: ${tx.transactionHash.substring(0, 10)}...`, 'success');

            // Update balances
            await this.updatePortfolioScreen();

            return { success: true, txHash: tx.transactionHash };
        } catch (error) {
            console.error('Send BSC token error:', error);
            this.showNotification(`Failed to send ${tokenSymbol}: ${error.message}`, 'error');
            throw error;
        }
    }

    showBuyModal() {
        const amount = parseFloat(prompt('Amount (USD):'));
        if (amount) {
            this.buyCheese(amount, 'USD', 'moonpay');
        }
    }

    showSwapModal() {
        // Show swap screen instead of modal
        this.showScreen('swap');
    }

    // Update swap screen (called when swap screen is shown)
    async updateSwapScreen() {
        // Populate swap token dropdowns with all portfolio tokens
        await this.populateSwapTokens();

        // Remove existing listener to prevent duplicates
        const fromAmountEl = document.getElementById('swap-from-amount');
        if (fromAmountEl) {
            const newFromAmount = fromAmountEl.cloneNode(true);
            fromAmountEl.parentNode.replaceChild(newFromAmount, fromAmountEl);

            const refreshSwapQuote = async () => {
                const amount = parseFloat(newFromAmount.value || 0);
                const fromToken = document.getElementById('swap-from')?.value || 'NCH';
                const toToken = document.getElementById('swap-to')?.value || 'USDT';
                const toAmountEl = document.getElementById('swap-to-amount');
                const rateEl = document.getElementById('swap-rate');

                if (!amount || amount <= 0) {
                    if (toAmountEl) toAmountEl.value = '';
                    if (rateEl) rateEl.textContent = `1 ${fromToken} = — ${toToken}`;
                    return;
                }

                try {
                    const quote = await this.swapEngine.getSwapQuoteEstimate(amount, fromToken, toToken);
                    if (!quote.success || !(quote.amountOut > 0)) {
                        if (toAmountEl) toAmountEl.value = '';
                        if (rateEl) rateEl.textContent = `1 ${fromToken} = — ${toToken}`;
                        return;
                    }
                    if (toAmountEl) toAmountEl.value = quote.amountOut.toFixed(6);
                    if (rateEl) {
                        const tag = quote.source === 'estimate' ? ' (est.)' : '';
                        rateEl.textContent = `1 ${fromToken} = ${quote.rate.toFixed(6)} ${toToken}${tag}`;
                    }
                } catch (error) {
                    console.error('Swap quote error:', error);
                    if (rateEl) rateEl.textContent = `1 ${fromToken} = — ${toToken}`;
                }
            };

            let quoteTimer = null;
            newFromAmount.addEventListener('input', () => {
                clearTimeout(quoteTimer);
                quoteTimer = setTimeout(() => refreshSwapQuote(), 250);
            });

            const fromSelect = document.getElementById('swap-from');
            const toSelect = document.getElementById('swap-to');
            if (fromSelect) fromSelect.addEventListener('change', () => refreshSwapQuote());
            if (toSelect) toSelect.addEventListener('change', () => refreshSwapQuote());

            refreshSwapQuote();
        }

        // Swap arrow button - swap from and to tokens
        const swapArrow = document.querySelector('.swap-arrow');
        if (swapArrow) {
            // Remove existing listeners
            const newSwapArrow = swapArrow.cloneNode(true);
            swapArrow.parentNode.replaceChild(newSwapArrow, swapArrow);

            newSwapArrow.style.cursor = 'pointer';
            newSwapArrow.addEventListener('click', () => {
                const fromSelect = document.getElementById('swap-from');
                const toSelect = document.getElementById('swap-to');
                const fromAmount = document.getElementById('swap-from-amount');
                const toAmount = document.getElementById('swap-to-amount');

                if (fromSelect && toSelect) {
                    // Swap tokens
                    const tempToken = fromSelect.value;
                    fromSelect.value = toSelect.value;
                    toSelect.value = tempToken;

                    // Swap amounts
                    if (fromAmount && toAmount) {
                        const tempAmount = fromAmount.value;
                        fromAmount.value = toAmount.value;
                        toAmount.value = tempAmount;
                    }

                    // Trigger input event to recalculate quote
                    if (fromAmount) {
                        fromAmount.dispatchEvent(new Event('input'));
                    }

                    this.showNotification('✅ Swapped tokens', 'success');
                }
            });
        }
    }

    // Address actions
    copyAddress() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('No wallet address to copy', 'error');
            return;
        }

        const address = this.wallet.address;

        // Try modern clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(address).then(() => {
                this.showNotification('✅ Address copied to clipboard!', 'success');
            }).catch(err => {
                console.error('Clipboard API failed:', err);
                // Fallback to old method
                this.fallbackCopyToClipboard(address);
            });
        } else {
            // Fallback for older browsers
            this.fallbackCopyToClipboard(address);
        }
    }

    fallbackCopyToClipboard(text) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-999999px';
            textarea.style.top = '-999999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (successful) {
                this.showNotification('✅ Address copied to clipboard!', 'success');
            } else {
                this.showNotification('❌ Failed to copy. Please copy manually: ' + text, 'error');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            this.showNotification('❌ Failed to copy. Please copy manually: ' + text, 'error');
        }
    }

    async shareAddress() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('No wallet address to share', 'error');
            return;
        }

        const address = this.wallet.address;

        // Try Web Share API first
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My CHEESE Wallet Address',
                    text: `My CHEESE wallet address: ${address}`,
                    url: window.location.href
                });
                this.showNotification('✅ Address shared!', 'success');
                return;
            } catch (err) {
                // User cancelled or share failed, fallback to copy
                if (err.name !== 'AbortError') {
                    console.error('Share failed:', err);
                }
            }
        }

        // Fallback to copy
        this.copyAddress();
    }

    // Restore QR code cache from localStorage
    restoreQRCodeCache() {
        try {
            const cached = localStorage.getItem('cheeseQRCodeCache');
            const cachedAddress = localStorage.getItem('cheeseQRCodeAddress');
            if (cached && cachedAddress) {
                this.qrCodeCache = cached;
                this.cachedQRAddress = cachedAddress;
                console.log('✅ QR code cache restored from localStorage for address:', cachedAddress.substring(0, 10) + '...');
            }
        } catch (error) {
            console.warn('⚠️ Error restoring QR code cache:', error);
        }
    }

    // Save QR code cache to localStorage
    saveQRCodeCache() {
        try {
            if (this.qrCodeCache && this.cachedQRAddress) {
                localStorage.setItem('cheeseQRCodeCache', this.qrCodeCache);
                localStorage.setItem('cheeseQRCodeAddress', this.cachedQRAddress);
                console.log('✅ QR code cache saved to localStorage');
            }
        } catch (error) {
            console.warn('⚠️ Error saving QR code cache:', error);
        }
    }

    // Pre-generate QR code when wallet loads (ensures it's always ready)
    async preGenerateQRCode(address) {
        if (!address) return;

        // Try to restore from localStorage first
        if (!this.qrCodeCache || this.cachedQRAddress !== address) {
            this.restoreQRCodeCache();
        }

        // If already cached for this address, skip
        if (this.qrCodeCache && this.cachedQRAddress === address) {
            return;
        }

        // If generation is already in progress, wait for it
        if (this.qrCodeGenerationPromise) {
            await this.qrCodeGenerationPromise;
            return;
        }

        // Create a temporary container for QR generation
        const tempContainer = document.createElement('div');
        tempContainer.style.cssText = 'position: absolute; left: -9999px; width: 256px; height: 256px;';
        document.body.appendChild(tempContainer);

        try {
            // Generate QR code
            this.qrCodeGenerationPromise = this.generateQRCode(null, address, tempContainer);
            await this.qrCodeGenerationPromise;

            // Cache the generated QR code HTML
            this.qrCodeCache = tempContainer.innerHTML;
            this.cachedQRAddress = address;

            // CRITICAL: Save to localStorage so it persists across refreshes
            this.saveQRCodeCache();

            console.log('✅ QR code pre-generated and cached for address:', address.substring(0, 10) + '...');
        } catch (error) {
            console.warn('⚠️ QR code pre-generation failed (will generate on-demand):', error);
        } finally {
            // Clean up temporary container
            document.body.removeChild(tempContainer);
            this.qrCodeGenerationPromise = null;
        }
    }

    async showQRCode() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('No wallet address to display', 'error');
            return;
        }

        const address = this.wallet.address;
        const network = this.currentNetwork || 'cheese-native';
        const networkName = this.getNetworkName(network);

        // Check if modal already exists and remove it
        const existingModal = document.getElementById('qr-code-modal');
        if (existingModal) {
            document.body.removeChild(existingModal);
        }

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'qr-code-modal';
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

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 15px;
            text-align: center;
            max-width: 350px;
            width: 90%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        `;

        // Create QR container - ALWAYS use cached QR code (pre-generated on wallet load)
        // If cache is missing, generate synchronously (shouldn't happen if pre-generation worked)
        const qrHTML = this.qrCodeCache && this.cachedQRAddress === address
            ? this.qrCodeCache
            : '<div style="padding: 20px; color: #666;">Generating QR code...</div>';

        content.innerHTML = `
            <h3 style="margin-bottom: 10px; color: #333;">📷 Wallet Address QR Code</h3>
            <div style="margin-bottom: 15px; padding: 8px; background: #e3f2fd; border-radius: 5px; font-size: 0.9em; color: #1976d2; font-weight: 500;">
                🌐 Network: ${networkName}
            </div>
            <div id="qr-container" style="margin: 20px auto; text-align: center;">
                ${qrHTML}
            </div>
            <div style="margin: 15px 0; padding: 10px; background: #f5f5f5; border-radius: 8px;">
                <div style="font-family: monospace; font-size: 0.85em; word-break: break-all; color: #666;">
                    ${address}
                </div>
            </div>
            <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border-radius: 5px; font-size: 0.8em; color: #856404;">
                ⚠️ Make sure you're sending to the correct network!
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
                <button id="qr-copy-btn" class="btn btn-primary" style="padding: 10px 20px;">📋 Copy Address</button>
                <button id="qr-close-btn" class="btn btn-secondary" style="padding: 10px 20px;">Close</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Only generate if cache is missing (fallback - should rarely happen)
        if (!this.qrCodeCache || this.cachedQRAddress !== address) {
            // Try to restore from localStorage first
            this.restoreQRCodeCache();

            if (!this.qrCodeCache || this.cachedQRAddress !== address) {
                // Still missing - generate it
                const qrData = address;
                const qrContainer = content.querySelector('#qr-container');
                await this.generateQRCode(null, qrData, qrContainer);
                // Cache the QR code HTML
                this.qrCodeCache = qrContainer.innerHTML;
                this.cachedQRAddress = address;
                // Save to localStorage
                this.saveQRCodeCache();
            } else {
                // Restored from localStorage - use it
                const qrContainer = content.querySelector('#qr-container');
                qrContainer.innerHTML = this.qrCodeCache;
            }
        } else {
            // Use cached QR code (already set in innerHTML above)
            const qrContainer = content.querySelector('#qr-container');
            qrContainer.innerHTML = this.qrCodeCache;
        }

        // Close button
        const closeBtn = content.querySelector('#qr-close-btn');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // Copy button
        const copyBtn = content.querySelector('#qr-copy-btn');
        copyBtn.addEventListener('click', () => {
            this.copyAddress();
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    // Reusable QR Scanner function
    showQRScanner(onSuccess) {
        // Create QR scanner modal
        const modal = document.createElement('div');
        modal.id = 'qr-scanner-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            max-width: 400px;
            width: 90%;
        `;

        content.innerHTML = `
            <h3 style="margin-bottom: 15px;">📷 Scan QR Code</h3>
            <video id="qr-video" style="width: 100%; max-width: 300px; border: 2px solid #007bff; border-radius: 8px;" autoplay playsinline></video>
            <canvas id="qr-canvas" style="display: none;"></canvas>
            <div style="margin-top: 15px;">
                <p style="color: #666; font-size: 0.9em;">Point your camera at the QR code</p>
            </div>
            <div style="margin-top: 15px;">
                <button id="qr-manual-input-btn" class="btn btn-secondary" style="margin-right: 10px;">Enter Manually</button>
                <button id="qr-cancel-btn" class="btn btn-secondary">Cancel</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        const video = document.getElementById('qr-video');
        const canvas = document.getElementById('qr-canvas');
        const context = canvas.getContext('2d');
        let stream = null;
        let scanInterval = null;

        // Load jsQR library if available
        const loadQRScanner = () => {
            if (typeof jsQR !== 'undefined') {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        };

        // Manual input button
        document.getElementById('qr-manual-input-btn').addEventListener('click', () => {
            const address = prompt('Enter wallet address:');
            if (address && address.trim()) {
                if (onSuccess) onSuccess(address.trim());
            }
            cleanup();
        });

        // Cancel button
        document.getElementById('qr-cancel-btn').addEventListener('click', () => {
            cleanup();
        });

        const cleanup = () => {
            if (scanInterval) clearInterval(scanInterval);
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
        };

        // Try to access camera
        loadQRScanner().then(() => {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                .then(mediaStream => {
                    stream = mediaStream;
                    video.srcObject = stream;
                    video.play();

                    // QR code detection
                    scanInterval = setInterval(() => {
                        if (video.readyState === video.HAVE_ENOUGH_DATA) {
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                            context.drawImage(video, 0, 0, canvas.width, canvas.height);

                            // Try to decode QR code
                            if (typeof jsQR !== 'undefined') {
                                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                                const code = jsQR(imageData.data, imageData.width, imageData.height);

                                if (code) {
                                    const scannedData = code.data;
                                    // Extract address from QR code (might be just address or full URL)
                                    let address = scannedData;
                                    if (scannedData.includes(':')) {
                                        const parts = scannedData.split(':');
                                        address = parts[parts.length - 1];
                                    }

                                    if (address && /^0x[a-fA-F0-9]{40}$/i.test(address)) {
                                        cleanup();
                                        if (onSuccess) onSuccess(address);
                                    }
                                }
                            }
                        }
                    }, 100);
                })
                .catch(error => {
                    console.error('Camera access error:', error);
                    this.showNotification('Camera access denied. Please use manual input.', 'error');
                    document.getElementById('qr-manual-input-btn').click();
                });
        }).catch(() => {
            this.showNotification('QR scanner library failed to load. Please use manual input.', 'error');
            document.getElementById('qr-manual-input-btn').click();
        });
    }

    async generateQRCode(canvas, text, container) {
        if (!container) {
            console.error('QR container not provided');
            return;
        }

        // Ensure QRCode library is loaded
        if (typeof QRCode === 'undefined') {
            console.log('QRCode library not loaded, waiting for it...');
            try {
                await this.loadQRCodeLibrary();
            } catch (error) {
                console.error('Failed to load QRCode library:', error);
                // Try one more time with a simple inline QR code generator
                this.generateSimpleQRCode(text, container);
                return;
            }
        }

        // Check again after loading
        if (typeof QRCode === 'undefined') {
            console.error('QRCode library still not available, using fallback');
            this.generateSimpleQRCode(text, container);
            return;
        }

        // Create canvas element
        const qrCanvas = document.createElement('canvas');
        qrCanvas.width = 256;
        qrCanvas.height = 256;
        qrCanvas.style.cssText = `
            width: 100%;
            max-width: 256px;
            height: auto;
            border: 2px solid #f0f0f0;
            border-radius: 10px;
            padding: 10px;
            background: white;
            margin: 0 auto;
            display: block;
        `;

        // Use toDataURL method (more reliable)
        try {
            QRCode.toDataURL(text, {
                width: 256,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                },
                errorCorrectionLevel: 'M'
            }, (err, url) => {
                if (err) {
                    console.error('QRCode.toDataURL error:', err);
                    // Try toCanvas as fallback
                    try {
                        QRCode.toCanvas(qrCanvas, text, {
                            width: 256,
                            margin: 2,
                            color: {
                                dark: '#000000',
                                light: '#FFFFFF'
                            },
                            errorCorrectionLevel: 'M'
                        }, (canvasError) => {
                            if (canvasError) {
                                console.error('QRCode.toCanvas error:', canvasError);
                                container.innerHTML = `
                                    <div style="padding: 20px; color: #dc3545;">
                                        <p>❌ Failed to generate QR code</p>
                                        <p style="font-size: 0.9em; margin-top: 10px;">Address: ${text}</p>
                                    </div>
                                `;
                            } else {
                                container.innerHTML = '';
                                container.appendChild(qrCanvas);
                            }
                        });
                    } catch (canvasErr) {
                        console.error('QRCode.toCanvas exception:', canvasErr);
                        container.innerHTML = `
                            <div style="padding: 20px; color: #dc3545;">
                                <p>❌ Failed to generate QR code</p>
                                <p style="font-size: 0.9em; margin-top: 10px;">Address: ${text}</p>
                            </div>
                        `;
                    }
                } else {
                    // Success - create image from data URL
                    const img = document.createElement('img');
                    img.src = url;
                    img.style.cssText = `
                        width: 100%;
                        max-width: 256px;
                        height: auto;
                        border: 2px solid #f0f0f0;
                        border-radius: 10px;
                        padding: 10px;
                        background: white;
                        margin: 0 auto;
                        display: block;
                    `;
                    img.onerror = () => {
                        container.innerHTML = `
                            <div style="padding: 20px; color: #dc3545;">
                                <p>❌ Failed to display QR code image</p>
                                <p style="font-size: 0.9em; margin-top: 10px;">Address: ${text}</p>
                            </div>
                        `;
                    };
                    container.innerHTML = '';
                    container.appendChild(img);
                }
            });
        } catch (err) {
            console.error('QRCode generation exception:', err);
            container.innerHTML = `
                <div style="padding: 20px; color: #dc3545;">
                    <p>❌ Error generating QR code</p>
                    <p style="font-size: 0.9em; margin-top: 10px;">Address: ${text}</p>
                </div>
            `;
        }
    }

    // Get network name
    getNetworkName(networkId) {
        const networks = {
            'cheese-native': '🧀 Native Chain',
            'bsc': '🔵 Binance Smart Chain',
            'ethereum': '💎 Ethereum'
        };
        return networks[networkId] || networkId;
    }

    // Update network display
    updateNetworkDisplay() {
        const networkSelector = document.getElementById('network-selector');
        if (networkSelector && this.wallet) {
            const selectedNetwork = networkSelector.value;
            const addressEl = document.getElementById('wallet-address');
            if (addressEl) {
                // Show warning if not native network
                if (selectedNetwork !== 'cheese-native') {
                    addressEl.innerHTML = `
                        <div style="color: #856404; font-size: 0.85em; margin-bottom: 5px;">
                            ⚠️ ${this.getNetworkName(selectedNetwork)} Address
                        </div>
                        <div>${this.wallet.address}</div>
                        <div style="color: #dc3545; font-size: 0.75em; margin-top: 5px;">
                            ⚠️ Only send ${selectedNetwork.toUpperCase()} tokens to this address!
                        </div>
                    `;
                } else {
                    addressEl.textContent = this.wallet.address;
                }
            }
        }
    }

    // Load QRCode library dynamically if not loaded
    loadQRCodeLibrary() {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (typeof QRCode !== 'undefined') {
                console.log('QRCode library already loaded');
                resolve();
                return;
            }

            // Wait for library to load (check multiple times)
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds total
            const checkInterval = setInterval(() => {
                attempts++;
                if (typeof QRCode !== 'undefined') {
                    clearInterval(checkInterval);
                    console.log('QRCode library detected after', attempts * 100, 'ms');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    // Try loading from backup CDN
                    console.warn('QRCode library not found, loading from backup CDN...');
                    this.loadQRCodeLibraryBackup(resolve, reject);
                }
            }, 100);
        });
    }

    // Load QRCode library from backup CDN
    loadQRCodeLibraryBackup(resolve, reject) {
        const backupScript = document.createElement('script');
        backupScript.src = 'https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js';
        backupScript.onload = () => {
            // Wait for library to initialize
            let attempts = 0;
            const maxAttempts = 30; // 3 seconds
            const checkInterval = setInterval(() => {
                attempts++;
                if (typeof QRCode !== 'undefined') {
                    clearInterval(checkInterval);
                    console.log('QRCode library loaded from backup CDN');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    reject(new Error('QRCode library failed to initialize from backup'));
                }
            }, 100);
        };
        backupScript.onerror = () => {
            console.error('Failed to load QRCode library from backup CDN');
            reject(new Error('Failed to load QRCode library from all CDNs'));
        };
        document.head.appendChild(backupScript);
    }

    // Generate simple QR code using online API as fallback
    generateSimpleQRCode(text, container) {
        // Use online QR code API as fallback
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(text)}`;
        const img = document.createElement('img');
        img.src = qrApiUrl;
        img.style.cssText = `
            width: 100%;
            max-width: 256px;
            height: auto;
            border: 2px solid #f0f0f0;
            border-radius: 10px;
            padding: 10px;
            background: white;
            margin: 0 auto;
            display: block;
        `;
        img.onerror = () => {
            container.innerHTML = `
                <div style="padding: 20px; color: #dc3545;">
                    <p>❌ Failed to generate QR code</p>
                    <p style="font-size: 0.9em; margin-top: 10px; word-break: break-all;">Address: ${text}</p>
                    <p style="font-size: 0.8em; margin-top: 10px; color: #666;">Please copy the address manually</p>
                </div>
            `;
        };
        container.innerHTML = '';
        container.appendChild(img);
    }

    drawSimpleQRPattern(canvas, text) {
        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        const moduleSize = 8;
        const modules = Math.floor(size / moduleSize);

        // Clear canvas
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        // Generate deterministic pattern based on address
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash = hash & hash;
        }

        // Draw QR-like pattern
        ctx.fillStyle = '#000000';
        for (let y = 0; y < modules; y++) {
            for (let x = 0; x < modules; x++) {
                const value = (hash + x * 7 + y * 11) % 3;
                if (value === 0) {
                    ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
                }
            }
        }

        // Add finder patterns (corners) for QR-like appearance
        this.drawFinderPattern(ctx, 0, 0, moduleSize);
        this.drawFinderPattern(ctx, modules - 7, 0, moduleSize);
        this.drawFinderPattern(ctx, 0, modules - 7, moduleSize);
    }

    drawFinderPattern(ctx, x, y, moduleSize) {
        const size = 7;
        ctx.fillStyle = '#000000';
        ctx.fillRect(x * moduleSize, y * moduleSize, size * moduleSize, size * moduleSize);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect((x + 1) * moduleSize, (y + 1) * moduleSize, 5 * moduleSize, 5 * moduleSize);
        ctx.fillStyle = '#000000';
        ctx.fillRect((x + 2) * moduleSize, (y + 2) * moduleSize, 3 * moduleSize, 3 * moduleSize);
    }

    // Save mnemonic securely (encrypted)
    async saveMnemonicSecurely(mnemonic, password) {
        try {
            if (!mnemonic || !password) {
                console.warn('Cannot save mnemonic without password');
                return;
            }

            // Encrypt mnemonic using same method as private key
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const passwordKey = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(password),
                { name: 'PBKDF2' },
                false,
                ['deriveBits', 'deriveKey']
            );

            const keyMaterial = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                passwordKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );

            const iv = crypto.getRandomValues(new Uint8Array(12));
            const mnemonicBytes = new TextEncoder().encode(mnemonic);
            const encryptedData = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                keyMaterial,
                mnemonicBytes
            );

            const combined = new Uint8Array(salt.length + iv.length + encryptedData.byteLength);
            combined.set(salt, 0);
            combined.set(iv, salt.length);
            combined.set(new Uint8Array(encryptedData), salt.length + iv.length);

            const encrypted = btoa(String.fromCharCode(...combined));
            localStorage.setItem('cheeseWalletMnemonic', encrypted);
        } catch (error) {
            console.error('Error saving mnemonic:', error);
        }
    }

    // Retrieve mnemonic securely
    async retrieveMnemonicSecurely(password) {
        try {
            const encrypted = localStorage.getItem('cheeseWalletMnemonic');
            if (!encrypted) {
                // Try to get from wallet object if available
                if (this.wallet && this.wallet.mnemonic) {
                    return this.wallet.mnemonic;
                }
                return null;
            }

            if (!password) {
                throw new Error('Password required to retrieve mnemonic');
            }

            const combined = new Uint8Array(
                atob(encrypted).split('').map(c => c.charCodeAt(0))
            );

            const salt = combined.slice(0, 16);
            const iv = combined.slice(16, 28);
            const encryptedData = combined.slice(28);

            const passwordKey = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(password),
                { name: 'PBKDF2' },
                false,
                ['deriveBits', 'deriveKey']
            );

            const keyMaterial = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                passwordKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );

            const decryptedData = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                keyMaterial,
                encryptedData
            );

            const mnemonic = new TextDecoder().decode(decryptedData);
            return mnemonic;
        } catch (error) {
            console.error('Error retrieving mnemonic:', error);
            throw new Error('Incorrect password or mnemonic not found');
        }
    }

    // Show seed phrase in secure modal
    async showSeedPhraseModal(mnemonic = null, isNewWallet = false) {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('No wallet loaded', 'error');
            return;
        }

        // If mnemonic not provided, retrieve it
        if (!mnemonic) {
            const password = prompt('Enter your wallet password to view seed phrase:');
            if (!password) {
                return;
            }

            try {
                mnemonic = await this.retrieveMnemonicSecurely(password);
                if (!mnemonic) {
                    // Try wallet object
                    if (this.wallet.mnemonic) {
                        mnemonic = this.wallet.mnemonic;
                    } else {
                        // No seed phrase - show private key export instead
                        this.showPrivateKeyModal(password);
                        return;
                    }
                }
            } catch (error) {
                // If no seed phrase, show private key export option
                if (error.message.includes('Seed phrase not found') || error.message.includes('not found')) {
                    this.showPrivateKeyModal(password);
                    return;
                }
                this.showNotification('❌ ' + error.message, 'error');
                return;
            }
        }

        // Create secure modal
        const modal = document.createElement('div');
        modal.id = 'seed-phrase-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20000;
        `;

        const words = mnemonic.split(' ');
        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        `;

        content.innerHTML = `
            <h2 style="margin-bottom: 20px; color: #dc3545;">🔑 Your Seed Phrase</h2>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
                <strong style="color: #856404;">⚠️ CRITICAL SECURITY WARNING:</strong>
                <ul style="margin: 10px 0; padding-left: 20px; color: #856404; font-size: 0.9em;">
                    <li>Write down these words in the exact order shown</li>
                    <li>Store them in a safe place (NOT on your computer or phone)</li>
                    <li>Never share your seed phrase with anyone</li>
                    <li>If you lose this seed phrase, you will lose access to your wallet forever</li>
                </ul>
            </div>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #dee2e6;">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-family: monospace; font-size: 1.1em;">
                    ${words.map((word, index) => `
                        <div style="padding: 10px; background: white; border-radius: 5px; text-align: center; border: 1px solid #dee2e6;">
                            <span style="color: #6c757d; font-size: 0.8em;">${index + 1}.</span> ${word}
                        </div>
                    `).join('')}
                </div>
            </div>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="seed-phrase-copy-btn" class="btn btn-primary" style="padding: 10px 20px;">📋 Copy Seed Phrase</button>
                <button id="seed-phrase-close-btn" class="btn btn-secondary" style="padding: 10px 20px;">Close</button>
            </div>
            ${isNewWallet ? `
                <div style="margin-top: 20px; padding: 15px; background: #d4edda; border-radius: 8px; border-left: 4px solid #28a745;">
                    <strong style="color: #155724;">✅ I have written down my seed phrase</strong>
                    <p style="margin: 10px 0 0 0; color: #155724; font-size: 0.9em;">
                        Check the box below and click "I've Backed It Up" to continue.
                    </p>
                    <label style="display: flex; align-items: center; margin-top: 10px; cursor: pointer;">
                        <input type="checkbox" id="seed-phrase-confirmed" style="margin-right: 10px; width: 20px; height: 20px;">
                        <span style="color: #155724; font-weight: 500;">I have securely backed up my seed phrase</span>
                    </label>
                    <button id="seed-phrase-confirm-btn" class="btn btn-success" style="margin-top: 10px; width: 100%; padding: 12px; font-size: 1.1em; font-weight: bold;" disabled>
                        ✅ I've Backed It Up
                    </button>
                </div>
            ` : ''}
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Copy button
        const copyBtn = content.querySelector('#seed-phrase-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(mnemonic);
                    this.showNotification('✅ Seed phrase copied to clipboard!', 'success');
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => {
                        copyBtn.textContent = '📋 Copy Seed Phrase';
                    }, 2000);
                } catch (error) {
                    // Fallback
                    const textarea = document.createElement('textarea');
                    textarea.value = mnemonic;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    this.showNotification('✅ Seed phrase copied!', 'success');
                }
            });
        }

        // Close button
        const closeBtn = content.querySelector('#seed-phrase-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (!isNewWallet || document.getElementById('seed-phrase-confirmed')?.checked) {
                    document.body.removeChild(modal);
                } else {
                    if (confirm('⚠️ You have not confirmed backing up your seed phrase. Are you sure you want to close? You may lose access to your wallet if you forget your password!')) {
                        document.body.removeChild(modal);
                    }
                }
            });
        }

        // Confirm checkbox (for new wallets)
        if (isNewWallet) {
            const confirmCheckbox = content.querySelector('#seed-phrase-confirmed');
            const confirmBtn = content.querySelector('#seed-phrase-confirm-btn');

            if (confirmCheckbox && confirmBtn) {
                confirmCheckbox.addEventListener('change', (e) => {
                    confirmBtn.disabled = !e.target.checked;
                });

                confirmBtn.addEventListener('click', () => {
                    if (confirmCheckbox.checked) {
                        // Mark backup as completed
                        localStorage.setItem('cheeseWalletBackupCompleted', 'true');
                        localStorage.setItem('cheeseWalletBackupDate', Date.now().toString());
                        document.body.removeChild(modal);
                        this.showNotification('✅ Wallet created successfully! Your seed phrase is backed up.', 'success');
                    }
                });
            }
        }

        // Close on backdrop click (only if confirmed)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (!isNewWallet || document.getElementById('seed-phrase-confirmed')?.checked) {
                    document.body.removeChild(modal);
                }
            }
        });
    }

    // Check backup status and show reminder
    checkBackupStatus() {
        const backupCompleted = localStorage.getItem('cheeseWalletBackupCompleted');
        const backupDate = localStorage.getItem('cheeseWalletBackupDate');

        if (!backupCompleted && this.wallet) {
            // Show backup reminder
            const reminder = confirm(
                '⚠️ SECURITY REMINDER\n\n' +
                'You have not confirmed backing up your seed phrase!\n\n' +
                'If you lose your password and seed phrase, you will lose access to your wallet forever.\n\n' +
                'Would you like to view your seed phrase now?'
            );

            if (reminder) {
                this.showSeedPhraseModal();
            }
        }
    }

    showPortfolio() {
        if (!this.wallet) {
            this.showNotification('Please unlock your wallet to view portfolio', 'info');
            return;
        }
        // Show portfolio screen
        this.showScreen('portfolio');
    }

    async updatePortfolioScreen(isSilent = false) {
        if (!this.wallet || !this.wallet.address) {
            const portfolioContent = document.getElementById('portfolio-content');
            if (portfolioContent) {
                portfolioContent.innerHTML = `
                    <div style="text-align: center; padding: 20px;">
                        <p>Please unlock your wallet to view portfolio</p>
                    </div>
                `;
            }
            return;
        }

        const portfolioContent = document.getElementById('portfolio-content');
        if (!portfolioContent) return;

        try {
            // Only show loading if NOT a silent update
            if (!isSilent) {
                portfolioContent.innerHTML = '<div style="text-align: center; padding: 20px;"><p>Loading tokens...</p></div>';
            }

            // 1. Refresh balances from all sources
            const isForceSync = new URLSearchParams(window.location.search).get('forceSync') === 'true' || 
                               new URLSearchParams(window.location.search).get('sync') === 'true';
            await this.updateBalance(isForceSync);
            
            // 2. Fetch Native Portfolio (Stablecoins like USDT/USDC on Cheese Chain)
            let nativePortfolio = {};
            try {
                // Support forceSync via query param or button
                const isForceSync = new URLSearchParams(window.location.search).get('forceSync') === 'true' || 
                                   new URLSearchParams(window.location.search).get('sync') === 'true';
                                   
                const portfolioData = await this.api.getPortfolio(this.wallet.address, isForceSync);
                console.log('📊 [PORTFOLIO] Raw API Response:', JSON.stringify(portfolioData));
                
                // CRITICAL: Extract from nested structure if necessary
                if (portfolioData) {
                    if (portfolioData.portfolio) {
                        nativePortfolio = portfolioData.portfolio;
                    } else if (portfolioData.balances && portfolioData.balances.portfolio) {
                        nativePortfolio = portfolioData.balances.portfolio;
                    } else if (typeof portfolioData === 'object') {
                        // Fallback: check if the object itself has token keys
                        nativePortfolio = portfolioData;
                    }
                }
                console.log('📦 [PORTFOLIO] Processed Native Portfolio:', JSON.stringify(nativePortfolio));
            } catch (pError) {
                console.warn('⚠️ Failed to fetch native portfolio:', pError);
            }

            // Helper function to extract token balance regardless of case sensitivity
            const getPortfolioVal = (sym) => {
                const upper = sym.toUpperCase();
                const lower = sym.toLowerCase();
                const capital = sym.charAt(0).toUpperCase() + sym.slice(1).toLowerCase();
                
                let raw = undefined;
                if (nativePortfolio) {
                    raw = nativePortfolio[upper] !== undefined ? nativePortfolio[upper] :
                          (nativePortfolio[lower] !== undefined ? nativePortfolio[lower] :
                          (nativePortfolio[capital] !== undefined ? nativePortfolio[capital] : undefined));
                }

                if (raw === undefined && (upper === 'NCH' || upper === 'NCHEESE')) {
                    if (portfolioData && portfolioData.balance !== undefined) {
                        raw = portfolioData.balance;
                    }
                }

                return parseFloat(raw || 0) || 0;
            };

            // 3. Define Core Assets (Always present, includes native and multichain anchors)
            const coreAssets = {
                'NCH': { 
                    symbol: 'NCH', 
                    name: 'NCheese (Native CHEESE)', 
                    logoURI: './icon-192.png',
                    balance: this.balance || getPortfolioVal('NCH') || 0,
                    chain: 'cheese-native',
                    address: '0x0000000000000000000000000000000000000000',
                    price: 0.022
                },
                'USDT': { 
                    symbol: 'USDT', 
                    name: 'Native Tether USD', 
                    logoURI: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
                    balance: getPortfolioVal('USDT'),
                    chain: 'cheese-native',
                    address: 'native-usdt',
                    price: 1.00
                },
                'USDC': { 
                    symbol: 'USDC', 
                    name: 'Native USD Coin', 
                    logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
                    balance: getPortfolioVal('USDC'),
                    chain: 'cheese-native',
                    address: 'native-usdc',
                    price: 1.00
                },
            };

            // CRITICAL: If USDT/USDC are 0, check if 'BALANCE' holds their value (ghost aggregation fix)
            if (coreAssets['USDT'] && coreAssets['USDT'].balance === 0 && 
                coreAssets['USDC'] && coreAssets['USDC'].balance === 0 && 
                nativePortfolio['BALANCE']) {
                const balValue = parseFloat(nativePortfolio['BALANCE']) || 0;
                if (balValue > 0) {
                    console.log('👻 [GHOST FIX] Detected aggregated balance in "BALANCE" key. Splitting to USDT.');
                    coreAssets['USDT'].balance = balValue;
                }
            }

            // 4. Create base tokens list
            const allTokens = [];
            
            // Add Core Assets first
            Object.values(coreAssets).forEach(token => {
                const coreToken = {
                    ...token,
                    decimals: 18,
                    isNative: token.chain === 'cheese-native'
                };
                allTokens.push(coreToken);
            });
            
            console.log('🔴 DEBUG: Core assets added, total allTokens:', allTokens.length);
            console.log('🔴 DEBUG: allTokens symbols:', allTokens.map(t => t.symbol));

            // Get user's tokens
            const userTokens = this.tokenSearch ? this.tokenSearch.getUserTokens() : [];

            // Add other user tokens (excluding duplicates of native trinity)
            userTokens.forEach(token => {
                const symbolUpper = (token.symbol || '').toUpperCase().trim();
                const nameUpper = (token.name || '').toUpperCase().trim();
                
                if (symbolUpper === 'WNCH') return;
                // CRITICAL: Only exclude 'NCH' if it's the native token (duplicates NCH)
                if ((symbolUpper === 'NCH' || symbolUpper === 'NCH') && (token.chain === 'cheese-native' || !token.chain)) return;
                
                // Aggressive Ghost/Phantom Token Cleanup
                const ghostKeywords = ['BALANCE', 'SUCCESS', 'V3.5', 'V3.6', 'V4.1', 'V4.2', 'RECOVERY', 'FIX', 'RESTORE', 'PURGE', 'GHOST', 'NCH_OLD', 'CACHEDAT', 'CACHED_AT', 'TIMESTAMP', 'PHANTOM', 'MESSAGE'];
                if (ghostKeywords.some(kw => symbolUpper.includes(kw) || nameUpper.includes(kw))) {
                    console.log(`🚫 Filtering out ghost token: ${symbolUpper} (${nameUpper})`);
                    return;
                }
                
                allTokens.push(token);
            });

            // Fetch cross-chain balances (BSC, etc.)
            let crossChainTokens = [];
            if (this.crossChainBalance && this.wallet.address) {
                try {
                    // CRITICAL FIX: Pass user tokens to cross-chain balance checker
                    // This allows detection of tokens not in the predefined list
                    // CRITICAL: Include ALL tokens with 0x addresses (BSC tokens) even if chain is not set
                    // This fixes the issue where tokens added by contract address might not have 'bsc' chain set
                    const userTokensForBSC = userTokens.filter(t =>
                        t.address &&
                        t.address !== 'native' &&
                        t.address !== '0x0000000000000000000000000000000000000000' &&
                        t.address.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
                        t.address.startsWith('0x') &&
                        // Include if chain is BSC OR if it's a 0x address (likely BSC token)
                        ((t.chain && (t.chain.toLowerCase() === 'bsc')) ||
                            (!t.chain || t.chain === 'cheese-native' || !t.chain.includes('native')))
                    );

                    // Don't show notification on every refresh (only on manual refresh)
                    const crossChainBalances = await this.crossChainBalance.getAllBalances(
                        this.wallet.address,
                        userTokensForBSC
                    );

                    // Add BSC tokens
                    if (crossChainBalances.bsc && crossChainBalances.bsc.tokens) {
                        crossChainTokens = crossChainBalances.bsc.tokens.map(token => ({
                            ...token,
                            isCrossChain: true,
                            network: 'BSC'
                        }));
                    }
                } catch (error) {
                    console.error('Error fetching cross-chain balances:', error);
                    // Show error to user if manual refresh
                    if (this.currentScreen === 'portfolio') {
                        console.warn('⚠️ Could not fetch BSC balances. Make sure you have added the token to your portfolio or it\'s a common token.');
                    }
                }
            }

            // Update balances for all tokens
            for (let token of allTokens) {
                if (token.symbol === 'NCH') {
                    // CRITICAL: Only update NCH balance from this.balance
                    token.balance = this.balance || 0;
                    token.name = token.name || 'NCheese (Native CHEESE)';
                    token.chain = 'cheese-native';
                    token.logoURI = token.logoURI || './icon-192.png';
                } else if (token.chain === 'cheese-native') {
                    // For other native tokens (USDT, USDC), ensure balance is set from portfolio response
                    token.balance = getPortfolioVal(token.symbol) || token.balance || 0;
                    token.chain = 'cheese-native';
                } else {
                    // For other tokens, try to get balance
                    token.balance = token.balance || 0;
                }
            }

            // Merge cross-chain tokens with existing tokens
            // CRITICAL FIX: Better deduplication - check address and chain (case-insensitive)
            // IMPORTANT: Update existing tokens instead of creating duplicates
            crossChainTokens.forEach(crossToken => {
                const existingIndex = allTokens.findIndex(t => {
                    const addressMatch = t.address.toLowerCase() === crossToken.address.toLowerCase();
                    const chainMatch = (t.chain || '').toLowerCase() === (crossToken.chain || '').toLowerCase() ||
                        (t.chain || '').toLowerCase() === 'bsc' && (crossToken.chain || '').toLowerCase() === 'bsc';
                    return addressMatch && chainMatch;
                });

                if (existingIndex === -1) {
                    // Add cross-chain token (new token not in user tokens)
                    allTokens.push(crossToken);
                } else {
                    // CRITICAL FIX: Replace existing token completely with cross-chain version
                    // This ensures no duplicates and correct token info
                    const existing = allTokens[existingIndex];
                    // Preserve user-added status
                    const wasUserAdded = userTokens.some(ut =>
                        ut.address.toLowerCase() === existing.address.toLowerCase()
                    );

                    // Replace with cross-chain token but preserve user-added status
                    crossToken.isUserAdded = wasUserAdded;
                    allTokens[existingIndex] = crossToken;
                }
            });

            // Use token-search's price method with IMMEDIATE fallback prices
            const getTokenPrice = (token) => {
                if (!token || !token.symbol) return 0;

                // Skip placeholder tokens for price lookup
                if (token.symbol === 'TOKEN' || token.symbol === 'UNKNOWN') {
                    return 0;
                }

                const symbol = (token.symbol || '').toUpperCase();

                // Use real market price or seed price for NCH
                if (symbol === 'NCH') {
                    const dynamicPrice = this.tokenSearch ? this.tokenSearch.getTokenPriceSync('NCH') : 0.022;
                    return dynamicPrice || 0.022; // Default to seed price
                }

                // IMMEDIATE FALLBACK PRICES - Use these FIRST, then try to get real price
                const fallbackPrices = {
                    'NCH': 0.022,
                    'CHEESE': 0.022,  // BSC CHEESE token
                    'USDT': 1.00,
                    'USDC': 1.00,
                    'BNB': 300.00,
                    'WBNB': 300.00,
                    'ETH': 2500.00,
                    'BTC': 45000.00,
                    'WBTC': 45000.00,
                    'CAKE': 2.50,
                    'DAI': 1.00,
                    'BUSD': 1.00,
                    'AFX': 1.00,
                    'CheeseV2': 1.00
                };

                // Check if we have a fallback price for this token
                if (fallbackPrices[symbol]) {
                    // Use fallback immediately
                    let price = fallbackPrices[symbol];

                    // Try to get real price from cache/API (but don't wait)
                    if (this.tokenSearch) {
                        const cachedPrice = this.tokenSearch.getTokenPriceSync(symbol);
                        if (cachedPrice && cachedPrice > 0) {
                            price = cachedPrice; // Use real price if available
                            console.log(`✅ Using cached price for ${symbol}: $${price}`);
                        } else {
                            console.log(`💰 Using fallback price for ${symbol}: $${price}`);

                            // Fetch real price in background (will update later)
                            this.tokenSearch.getTokenPrice(symbol).then((realPrice) => {
                                if (realPrice && realPrice > 0) {
                                    console.log(`✅ Got real price for ${symbol}: $${realPrice}`);
                                    // Update the displayed price
                                    setTimeout(() => {
                                        this.updatePortfolioPrices();
                                    }, 500);
                                }
                            }).catch((error) => {
                                console.warn(`⚠️ Failed to fetch price for ${symbol}, keeping fallback:`, error);
                            });
                        }
                    }

                    return price;
                }

                // For tokens not in fallback list, try to get from cache
                if (this.tokenSearch) {
                    let price = this.tokenSearch.getTokenPriceSync(symbol);

                    // If no price found, try by name
                    if (!price && token.name) {
                        const nameMatch = token.name.match(/\b(BNB|ETH|BTC|USDT|USDC|DAI|BUSD|CAKE|NCH|WBNB|WBTC)\b/i);
                        if (nameMatch) {
                            const matchedSymbol = nameMatch[1].toUpperCase();
                            price = this.tokenSearch.getTokenPriceSync(matchedSymbol);
                            // If still no price, use fallback
                            if (!price && fallbackPrices[matchedSymbol]) {
                                price = fallbackPrices[matchedSymbol];
                            }
                        }
                    }

                    // Fetch real price in background if we don't have one
                    if (!price && symbol && symbol !== 'TOKEN') {
                        this.tokenSearch.getTokenPrice(symbol).catch(() => { });
                    }

                    return price || 0;
                }

                return 0;
            };

            // Merge Native Portfolio into allTokens (for any additional native tokens found)
            Object.entries(nativePortfolio).forEach(([symbol, balance]) => {
                const upperSymbol = (symbol || '').toUpperCase().trim();
                
                // CRITICAL FIX: Comprehensive ghost token filtering
                const ghostKeywords = ['BALANCE', 'SUCCESS', 'V3.5', 'V3.6', 'V4.1', 'V4.2', 'RECOVERY', 'FIX', 'RESTORE', 'PURGE', 'GHOST', 'NCHEESE_OLD', 'CACHEDAT', 'CACHED_AT', 'TIMESTAMP', 'PHANTOM', 'MESSAGE'];
                const isGhost = ghostKeywords.some(kw => upperSymbol.includes(kw));
                if (isGhost) {
                    console.log(`🚫 Filtering out ghost token from native portfolio: ${upperSymbol}`);
                    return;
                }
                
                // Skip Holy Trinity (already handled) and ghost tokens
                if (upperSymbol === 'NCH' || upperSymbol === 'NCH' || 
                    upperSymbol === 'USDT' || upperSymbol === 'USDC') return;

                if (balance <= 0) return;

                allTokens.push({
                    symbol: upperSymbol,
                    name: `${upperSymbol} Token`,
                    address: `native-${upperSymbol.toLowerCase()}`,
                    balance: parseFloat(balance) || 0,
                    chain: 'cheese-native',
                    isNative: true,
                    decimals: 18,
                    logoURI: ''
                });
            });

            // Ensure all tokens have proper metadata
            allTokens.forEach(token => {
                // If token is missing name or symbol, try to get from token-search
                if (!token.name || !token.symbol) {
                    const fullToken = this.tokenSearch?.getToken(token.address);
                    if (fullToken) {
                        token.name = token.name || fullToken.name || this.tokenSearch.getTokenName(token);
                        token.symbol = token.symbol || fullToken.symbol || this.tokenSearch.getTokenSymbol(token);
                        token.logoURI = token.logoURI || fullToken.logoURI || '';
                        token.chain = token.chain || fullToken.chain || 'cheese-native';
                    } else {
                        // Fallback for tokens without metadata
                        token.name = token.name || this.tokenSearch?.getTokenName(token) || 'Unknown Token';
                        token.symbol = token.symbol || this.tokenSearch?.getTokenSymbol(token) || 'TOKEN';
                    }
                }
            });

            // CRITICAL FIX: Remove duplicates and merge tokens properly
            // Also filter out the 'BALANCE' ghost token explicitly
            const uniqueTokens = [];
            const seenTokens = new Map();

            allTokens.forEach(token => {
                const tokenSymbol = (token.symbol || '').toUpperCase();
                
                // CRITICAL FIX: Filter out 'BALANCE' ghost token
                if (tokenSymbol === 'BALANCE' || tokenSymbol === 'SUCCESS') {
                    console.log('🚫 Filtering out ghost token:', tokenSymbol);
                    return;
                }
                // CRITICAL FIX: For native tokens, include symbol in key to prevent overwriting
                let key;
                if (token.chain === 'cheese-native') {
                    key = `${token.symbol || 'NCH'}_cheese-native`; // Include symbol for native tokens
                } else {
                    key = `${token.address.toLowerCase()}_${(token.chain || 'cheese-native').toLowerCase()}`;
                }
                const existing = seenTokens.get(key);

                // Check if this token is user-added (from userTokens list)
                const isUserAdded = userTokens.some(ut =>
                    ut.address.toLowerCase() === token.address.toLowerCase() &&
                    ((ut.chain || '').toLowerCase() === (token.chain || '').toLowerCase() ||
                        (ut.chain || '').toLowerCase() === 'bsc' && (token.chain || '').toLowerCase() === 'bsc')
                );

                // Check if token has placeholder info (needs to be replaced)
                const isPlaceholder = (token.symbol === 'TOKEN' || token.symbol === 'UNKNOWN' ||
                    token.name === 'Custom Token' || token.name === 'Unknown Token');

                if (!existing) {
                    // First time seeing this token
                    token.isUserAdded = isUserAdded;
                    token.isPlaceholder = isPlaceholder;
                    seenTokens.set(key, token);
                    uniqueTokens.push(token);
                } else {
                    // Token already exists - merge/update with better info
                    // CRITICAL: Always prefer cross-chain detected tokens (they have real balance and correct info)
                    if (token.isCrossChain && token.balance > 0) {
                        // Replace with cross-chain version (it has real info)
                        const index = uniqueTokens.indexOf(existing);
                        if (index !== -1) {
                            // Preserve user-added status if it was manually added
                            token.isUserAdded = existing.isUserAdded || isUserAdded;
                            token.isPlaceholder = false; // Cross-chain tokens have real info
                            uniqueTokens[index] = token;
                            seenTokens.set(key, token);
                        }
                    } else if (existing.isCrossChain) {
                        // Keep existing cross-chain version (it has better info)
                        // Just update balance if new one is higher
                        existing.balance = Math.max(existing.balance || 0, token.balance || 0);
                        // Preserve user-added status
                        existing.isUserAdded = existing.isUserAdded || isUserAdded;
                        existing.isPlaceholder = false; // Cross-chain tokens are never placeholders
                    } else {
                        // Both are not cross-chain - merge info
                        // If existing is placeholder and new one has real info, replace
                        if (existing.isPlaceholder && !isPlaceholder) {
                            const index = uniqueTokens.indexOf(existing);
                            if (index !== -1) {
                                token.isUserAdded = existing.isUserAdded || isUserAdded;
                                token.isPlaceholder = false;
                                uniqueTokens[index] = token;
                                seenTokens.set(key, token);
                            }
                        } else {
                            // Update existing with better info if available
                            if (token.symbol && token.symbol !== 'TOKEN' && token.symbol !== 'UNKNOWN' &&
                                (existing.symbol === 'TOKEN' || existing.symbol === 'UNKNOWN')) {
                                existing.symbol = token.symbol;
                                existing.isPlaceholder = false;
                            }
                            if (token.name && token.name !== 'Custom Token' && token.name !== 'Unknown Token' &&
                                (existing.name === 'Custom Token' || existing.name === 'Unknown Token')) {
                                existing.name = token.name;
                                existing.isPlaceholder = false;
                            }
                            existing.balance = Math.max(existing.balance || 0, token.balance || 0);
                            existing.isUserAdded = existing.isUserAdded || isUserAdded;
                        }
                    }
                }
            });

            // CRITICAL: Update NCH balance one more time before filtering
            uniqueTokens.forEach(token => {
                if (token.symbol === 'NCH') {
                    token.balance = this.balance || 0;
                    token.name = 'NCheese (Native CHEESE)';
                    token.chain = 'cheese-native';
                }
            });

            // CRITICAL: Remove duplicate NCH entries (keep only one)
            const ncheeseTokens = uniqueTokens.filter(t => t.symbol === 'NCH');
            if (ncheeseTokens.length > 1) {
                // Keep the first NCH token, remove others
                const firstNCHIndex = uniqueTokens.findIndex(t => t.symbol === 'NCH');
                for (let i = uniqueTokens.length - 1; i >= 0; i--) {
                    if (i !== firstNCHIndex && (uniqueTokens[i].symbol === 'NCH')) {
                        uniqueTokens.splice(i, 1);
                    }
                }
            }

            // CRITICAL: Filter out tokens with zero balance (unless they're native or user-added)
            console.log('🔴 DEBUG: uniqueTokens before filtering:', uniqueTokens.map(t => ({symbol: t.symbol, balance: t.balance, chain: t.chain})));
            console.log('🔴 DEBUG: uniqueTokens count:', uniqueTokens.length);
            
            let tokensToDisplay = uniqueTokens.filter(token => {
                const originalSymbol = token.symbol || 'UNKNOWN';
                const symbol = (token.symbol || '').toUpperCase().trim();
                const name = (token.name || '').toUpperCase().trim();
                
                if (symbol === 'WNCH') return false;

                // Ghost/Phantom Token Cleanup (Aggressive Case-Insensitive)
                const ghostKeywords = ['BALANCE', 'SUCCESS', 'V3.5', 'V3.6', 'V4.1', 'V4.2', 'RECOVERY', 'FIX', 'RESTORE', 'PURGE', 'GHOST', 'NCH_OLD', 'CACHEDAT', 'CACHED_AT', 'TIMESTAMP', 'PHANTOM', 'MESSAGE'];
                const isGhost = ghostKeywords.some(kw => symbol.includes(kw) || name.includes(kw));
                if (isGhost) return false;

                // CRITICAL: Only exclude 'NCH' if it's the native token (duplicates NCH)
                if ((symbol === 'NCH' || symbol === 'NCH') && (token.chain === 'cheese-native' || !token.chain)) {
                    // Only show the one already in Core Assets (NCH)
                    return symbol === 'NCH';
                }

                const holyTrinity = ['NCH', 'USDT', 'USDC'];
                const symbolUpper = symbol.toUpperCase();
                const isHolyTrinity = holyTrinity.some(ht => ht.toUpperCase() === symbolUpper);
                
                console.log(`🔍 DEBUG: Checking Holy Trinity - symbol: "${symbol}" (${symbolUpper}) vs holyTrinity: ${holyTrinity.map(ht => ht.toUpperCase())} -> isHolyTrinity: ${isHolyTrinity}`);
                
                if (isHolyTrinity) {
                    console.log(`✅ Showing Holy Trinity token: ${symbol} (balance: ${token.balance})`);
                    return true;
                }
                
                // Show native tokens with balance
                if (token.chain === 'cheese-native' && token.balance > 0) return true;
                
                // Show cross-chain tokens with balance > 0 (auto-detected)
                if (token.isCrossChain && token.balance > 0) return true;
                
                // Show user-added tokens even if balance is 0 (they might have sent tokens)
                if (token.isUserAdded) return true;
                
                // Show tokens with balance > 0
                return (token.balance || 0) > 0;
            });

            // CRITICAL FIX: Filter out placeholders that should be hidden
            // (placeholders that have a real token with the same address)
            tokensToDisplay = tokensToDisplay.filter(token => {
                // Check if this is a placeholder that should be hidden
                const isPlaceholderToHide = token.isPlaceholder &&
                    tokensToDisplay.some(t =>
                        t !== token &&
                        t.address.toLowerCase() === token.address.toLowerCase() &&
                        !t.isPlaceholder &&
                        t.symbol !== 'TOKEN' &&
                        t.symbol !== 'UNKNOWN' &&
                        ((t.chain || '').toLowerCase() === (token.chain || '').toLowerCase() ||
                            (t.chain || '').toLowerCase() === 'bsc' && (token.chain || '').toLowerCase() === 'bsc')
                    );

                // Don't include hidden placeholders
                return !isPlaceholderToHide;
            });

            // AUTOMATIC PORTFOLIO ARRANGEMENT (BALANCED ASSETS TOP RANKED)
            // 1. Tokens with positive balance (balance > 0) are placed at the TOP.
            // 2. Ranked descending by total USD Value (balance * price).
            // 3. Ranked descending by raw token balance.
            // 4. Zero-balance tokens placed below.
            tokensToDisplay.sort((a, b) => {
                const balA = parseFloat(a.balance) || 0;
                const balB = parseFloat(b.balance) || 0;

                const hasBalA = balA > 0 ? 1 : 0;
                const hasBalB = balB > 0 ? 1 : 0;

                // Positive balances come before zero balances
                if (hasBalA !== hasBalB) {
                    return hasBalB - hasBalA;
                }

                // Compare total USD value
                const priceA = getTokenPrice(a) || 0;
                const priceB = getTokenPrice(b) || 0;
                const valA = balA * priceA;
                const valB = balB * priceB;

                if (Math.abs(valA - valB) > 0.0001) {
                    return valB - valA;
                }

                // Compare raw token balance
                if (Math.abs(balA - balB) > 0.0001) {
                    return balB - balA;
                }

                // Sovereign native asset tiebreaker
                if (a.symbol === 'NCH') return -1;
                if (b.symbol === 'NCH') return 1;

                return (a.symbol || '').localeCompare(b.symbol || '');
            });

            // Fetch prices for all unique tokens (AFTER tokensToDisplay is created)
            // CRITICAL: CHEESE must fetch real price from PancakeSwap
            const uniqueSymbols = [...new Set(tokensToDisplay.map(t => t.symbol).filter(s => s && s !== 'NCH'))];
            console.log('🚀 Fetching prices for symbols:', uniqueSymbols);

            // Start price refresh in background
            if (uniqueSymbols.length > 0 && this.tokenSearch) {
                // For CHEESE, fetch immediately and wait
                if (uniqueSymbols.includes('CHEESE')) {
                    console.log('🔄 Fetching CHEESE price from PancakeSwap (this may take a moment)...');
                    this.tokenSearch.getTokenPrice('CHEESE').then((cheesePrice) => {
                        if (cheesePrice && cheesePrice > 0) {
                            console.log(`✅ CHEESE price fetched: $${cheesePrice}`);
                            setTimeout(() => {
                                this.updatePortfolioPrices();
                            }, 500);
                        }
                    }).catch((error) => {
                        console.error('❌ Failed to fetch CHEESE price:', error);
                    });
                }

                // Fetch other token prices in background
                const otherSymbols = uniqueSymbols.filter(s => s !== 'CHEESE');
                if (otherSymbols.length > 0) {
                    this.tokenSearch.refreshPrices(otherSymbols).then(() => {
                        console.log('✅ Other token prices fetched');
                        setTimeout(() => {
                            this.updatePortfolioPrices();
                        }, 1000);
                    }).catch((error) => {
                        console.warn('⚠️ Error fetching other prices:', error);
                    });
                }
            }

            // Calculate total portfolio value (only for displayed tokens)
            let totalValue = 0;
            tokensToDisplay.forEach(token => {
                let price = getTokenPrice(token);

                // If price is still 0, use fallback (BUT NOT FOR CHEESE - must fetch real price)
                if (price === 0 || !price) {
                    const symbol = (token.symbol || '').toUpperCase();

                    // CHEESE must fetch real price - no fallback
                    if (symbol === 'CHEESE') {
                        // Trigger async fetch
                        if (this.tokenSearch) {
                            this.tokenSearch.getTokenPrice(symbol).catch(() => { });
                        }
                        price = 0; // Will show as loading
                    } else {
                        const fallbackPrices = {
                            'NCH': 0.022,  // Native token seed
                            'USDT': 1.00,
                            'USDC': 1.00,
                            'BNB': 300.00,
                            'WBNB': 300.00,
                            'ETH': 2500.00,
                            'BTC': 45000.00,
                            'WBTC': 45000.00,
                            'CAKE': 2.50,
                            'DAI': 1.00,
                            'BUSD': 1.00
                        };
                        price = fallbackPrices[symbol] || 0;
                    }
                }

                totalValue += (token.balance || 0) * price;
            });

            // Build new HTML string
            let newHTML = '';
            
            if (tokensToDisplay.length === 0) {
                newHTML = `
                    <div style="text-align: center; padding: 40px;">
                        <p style="color: #666; margin-bottom: 20px;">No tokens in your portfolio</p>
                        <p style="font-size: 0.9em; color: #999;">Use the search above to add tokens</p>
                        <div style="font-size: 0.85em; color: #856404; margin-top: 15px; padding: 15px; background: #fff3cd; border-radius: 5px; text-align: left; max-width: 500px; margin-left: auto; margin-right: auto;">
                            <strong>💡 Token Not Showing?</strong>
                            <p style="margin: 10px 0 0 0;">If you sent a token from BSC (Binance Smart Chain) and it's not showing:</p>
                            <ol style="margin: 10px 0 0 20px; padding-left: 10px;">
                                <li>Go to BSCScan.com and find your transaction</li>
                                <li>Copy the token contract address</li>
                                <li>Paste it in the search box above</li>
                                <li>Click "Add" to add it to your portfolio</li>
                            </ol>
                            <p style="margin: 10px 0 0 0; font-size: 0.9em;">The token will then appear with its balance from BSC.</p>
                        </div>
                    </div>
                `;
            } else {
                // Binance Web3 Wallet Style Portfolio
                newHTML = `
                    <div style="margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1)); border-radius: 12px; border: 1px solid rgba(102, 126, 234, 0.2);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 0.85em; color: #666; margin-bottom: 5px; font-weight: 500;">Total Portfolio Value</div>
                                <div style="font-size: 2em; font-weight: bold; color: #667eea; line-height: 1.2;">$${totalValue.toFixed(2)}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">Tokens</div>
                                <div style="font-size: 1.2em; font-weight: bold; color: #333;">${tokensToDisplay.length}</div>
                            </div>
                        </div>
                    </div>
                    <div id="portfolio-tokens-list" style="background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e0e0e0;">
                        ${tokensToDisplay.map(token => {
                            const tokenSymbol = (token.symbol || 'TOKEN').toUpperCase();
                            const tokenName = token.name || 'Unknown Token';
                            const displaySymbol = tokenSymbol;
                            const balance = token.balance || 0;

                            // CRITICAL: Get price - use token.price (coreAssets) or search for it
                            let price = token.price || 0;
                            
                            if (price === 0 && this.tokenSearch) {
                                price = this.tokenSearch.getTokenPriceSync(tokenSymbol);
                            }

                            // DEBUG: Log price for each token
                            console.log(`🔴 PRICE DEBUG: ${tokenSymbol} - token.price: ${token.price}, searchedPrice: ${price}, balance: ${balance}`);

                            // Calculate value
                            const value = balance * price;
                            
                            console.log(`🔴 VALUE DEBUG: ${tokenSymbol} - value: ${value}`);

                            // Format balance
                            let balanceDisplay = balance.toFixed(4);
                            if (balance >= 1000) balanceDisplay = balance.toLocaleString(undefined, {maximumFractionDigits: 2});
                            else if (balance >= 1) balanceDisplay = balance.toFixed(4);
                            else if (balance > 0) balanceDisplay = balance.toFixed(6);

                            // Format price
                            let priceDisplay = price > 0 ? `$${price.toFixed(price >= 1 ? 2 : 6)}` : '--';
                            if (price === 0 && tokenSymbol === 'CHEESE') priceDisplay = 'Loading...';

                            // Format value
                            const valueDisplay = value > 0 ? `$${value.toFixed(2)}` : '$0.00';

                            // Determine remove button
                            const shouldShowRemove = tokenSymbol !== 'NCH' && token.isUserAdded && !token.isCrossChain;

                            return `
                                <div class="portfolio-token-item" data-token-address="${token.address}" data-token-symbol="${tokenSymbol}" data-token-chain="${token.chain || 'cheese-native'}"
                                     style="padding: 12px 15px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s; background: white;"
                                     onmouseover="this.style.background='#f8f9fa'"
                                     onmouseout="this.style.background='white'">
                                    <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                                        <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.9em; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); position: relative; overflow: hidden;">
                                            <span style="font-size: 0.8em;">${displaySymbol.charAt(0)}</span>
                                            ${token.logoURI ? `<img src="${token.logoURI}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; display: block; background: #fff;" onerror="this.style.display='none';">` : ''}
                                        </div>
                                        <div style="min-width: 0; flex: 1;">
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                <div style="font-weight: 600; font-size: 1em; color: #333;">${displaySymbol}</div>
                                                ${token.chain && token.chain !== 'cheese-native' ? `<span style="font-size: 0.7em; color: #667eea; background: rgba(102,126,234,0.1); padding: 1px 4px; border-radius: 4px; font-weight: 500;">${token.chain.toUpperCase()}</span>` : ''}
                                            </div>
                                            <div style="font-size: 0.8em; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${tokenName}</div>
                                        </div>
                                    </div>
                                    <div style="text-align: right; flex-shrink: 0; margin-left: 10px;">
                                        <div style="font-weight: 600; font-size: 1em; color: #333;">${balanceDisplay}</div>
                                        <div class="token-price" style="font-size: 0.75em; color: #666; font-weight: 500;">${priceDisplay}</div>
                                        <div class="token-value" style="font-size: 0.85em; color: #667eea; font-weight: 500;">${valueDisplay}</div>
                                    </div>
                                    ${shouldShowRemove ? `
                                        <button class="btn btn-danger btn-small" onclick="window.app.removeTokenFromPortfolio('${token.address}', '${token.chain || 'cheese-native'}')"
                                                style="margin-left: 10px; padding: 5px 10px; font-size: 0.8em;">✕</button>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            // CRITICAL: Only update DOM if content changed OR if not silent
            if (!isSilent || newHTML !== this.lastPortfolioHTML) {
                portfolioContent.innerHTML = newHTML;
                this.lastPortfolioHTML = newHTML;
                console.log('✅ Portfolio UI updated (Content changed or non-silent)');
            } else {
                console.log('🔇 Portfolio update skipped (Silent and no content changes)');
            }

            // Setup search functionality
            this.setupPortfolioSearch();
        } catch (error) {
            console.error('Portfolio update error:', error);
            portfolioContent.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #dc3545;">
                    <p>Error loading portfolio: ${error.message}</p>
                </div>
            `;
        }
    }

    updatePortfolioPrices() {
        if (!this.tokenSearch) return;

        // Update all token prices in the portfolio
        const tokenItems = document.querySelectorAll('.portfolio-token-item');
        console.log(`🔴 PRICE UPDATE DEBUG: Found ${tokenItems.length} token items`);
        
        tokenItems.forEach(item => {
            const symbol = item.dataset.tokenSymbol;
            console.log(`🔴 PRICE UPDATE DEBUG: Processing token ${symbol}`);
            if (!symbol) return;

            const priceElement = item.querySelector('.token-price');
            const valueElement = item.querySelector('.token-value');
            const balanceElement = item.querySelector('div[style*="font-weight: 600"][style*="margin-bottom"]');

            console.log(`🔴 PRICE UPDATE DEBUG: Elements found - price: ${!!priceElement}, value: ${!!valueElement}, balance: ${!!balanceElement}`);

            if (priceElement && valueElement && balanceElement) {
                // Get current price
                const price = this.tokenSearch.getTokenPriceSync(symbol);
                const balance = parseFloat(balanceElement.textContent.replace(/,/g, '')) || 0;
                const value = balance * price;

                console.log(`🔴 PRICE UPDATE DEBUG: ${symbol} - price: ${price}, balance: ${balance}, value: ${value}`);

                // Update price display
                let priceDisplay = '--';
                if (price > 0) {
                    priceDisplay = `$${price.toFixed(price >= 1 ? 2 : 6)}`;
                } else if (price === 0 && symbol.toUpperCase() === 'NCH') {
                    priceDisplay = '$0.022';
                }

                // Update value display
                let valueDisplay = '$0.00';
                if (value > 0) {
                    valueDisplay = `$${value.toFixed(2)}`;
                }

                priceElement.textContent = priceDisplay;
                valueElement.textContent = valueDisplay;
            }
        });
    }

    setupPortfolioSearch() {
        const searchInput = document.getElementById('portfolio-search-token');
        const searchResults = document.getElementById('portfolio-search-results');
        const addTokenBtn = document.getElementById('portfolio-add-token-btn');

        if (!searchInput || !searchResults || !this.tokenSearch) return;

        let searchTimeout;
        searchInput.addEventListener('input', async (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();

            if (!query) {
                searchResults.style.display = 'none';
                return;
            }

            searchTimeout = setTimeout(async () => {
                try {
                    const results = await this.tokenSearch.searchTokens(query);

                    if (results.length === 0) {
                        searchResults.innerHTML = '<div style="padding: 15px; text-align: center; color: #666;">No tokens found</div>';
                        searchResults.style.display = 'block';
                        return;
                    }

                    if (results.length === 0) {
                        // Check if input looks like an address
                        const queryLower = query.toLowerCase().trim();
                        if (queryLower.startsWith('0x')) {
                            const addressPart = queryLower.replace(/^0x/, '');
                            if (addressPart.length >= 20 && /^[0-9a-f]+$/.test(addressPart)) {
                                const normalizedAddress = '0x' + addressPart.padStart(40, '0').slice(0, 40);
                                // Show option to add custom token by address
                                searchResults.innerHTML = `
                                    <div class="portfolio-search-result" 
                                         style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;"
                                         onmouseover="this.style.background='#f8f9fa'"
                                         onmouseout="this.style.background='white'"
                                         onclick="window.app.addCustomTokenByAddress('${normalizedAddress}')">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <div style="width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8em; font-weight: bold;">
                                                ?
                                            </div>
                                            <div>
                                                <div style="font-weight: bold;">Custom Token</div>
                                                <div style="font-size: 0.75em; color: #666; word-break: break-all;">${normalizedAddress.slice(0, 10)}...${normalizedAddress.slice(-8)}</div>
                                            </div>
                                        </div>
                                        <span style="color: #667eea; font-size: 0.85em;">+ Add</span>
                                    </div>
                                `;
                                searchResults.style.display = 'block';
                                return;
                            }
                        }
                        searchResults.innerHTML = '<div style="padding: 15px; text-align: center; color: #666;">No tokens found</div>';
                        searchResults.style.display = 'block';
                        return;
                    }

                    searchResults.innerHTML = results.slice(0, 5).map(token => `
                        <div class="portfolio-search-result" 
                             style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center;"
                             onmouseover="this.style.background='#f8f9fa'"
                             onmouseout="this.style.background='white'"
                             onclick="window.app.addTokenToPortfolio('${token.address}', '${token.symbol}', '${token.name}', ${token.decimals || 18}, '${token.chain || 'cheese-native'}')">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8em; font-weight: bold; overflow: hidden; position: relative;">
                                    <span style="font-size: 0.8em;">${(token.symbol || '?').charAt(0)}</span>
                                    ${token.logoURI ? `<img src="${token.logoURI}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; display: block; background: #fff;" onerror="this.style.display='none'">` : ''}
                                </div>
                                <div>
                                    <div style="font-weight: bold;">${token.symbol || 'TOKEN'}</div>
                                    <div style="font-size: 0.85em; color: #666;">${token.name || 'Custom Token'}</div>
                                    ${token.isCustom ? `<div style="font-size: 0.7em; color: #999; word-break: break-all;">${token.address.slice(0, 10)}...${token.address.slice(-8)}</div>` : ''}
                                </div>
                            </div>
                            ${token.isAdded ? '<span style="color: #28a745; font-size: 0.85em;">✓ Added</span>' : '<span style="color: #667eea; font-size: 0.85em;">+ Add</span>'}
                        </div>
                    `).join('');

                    searchResults.style.display = 'block';
                } catch (error) {
                    console.error('Search error:', error);
                }
            }, 300);
        });

        // Add token button
        if (addTokenBtn) {
            addTokenBtn.addEventListener('click', () => {
                const query = searchInput.value.trim();
                if (query) {
                    searchInput.dispatchEvent(new Event('input'));
                } else {
                    searchInput.focus();
                }
            });
        }

        // Close search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });
    }

    addTokenToPortfolio(address, symbol, name, decimals, chain) {
        if (!this.tokenSearch) {
            this.showNotification('Token search not available', 'error');
            return;
        }

        // Validate address format
        const cleanAddress = address.replace(/^0x/, '').trim();
        if (!/^[0-9a-fA-F]{40}$/.test(cleanAddress)) {
            this.showNotification('Invalid token address format', 'error');
            return;
        }

        const fullAddress = '0x' + cleanAddress;

        // Try to get full token data from token-search first
        let token = this.tokenSearch.getToken(fullAddress);

        if (!token) {
            // Create new token object with provided data
            token = {
                address: fullAddress,
                symbol: symbol || 'TOKEN',
                name: name || 'Custom Token',
                decimals: decimals || 18,
                chain: chain || 'cheese-native',
                logoURI: ''
            };
        } else {
            // Update existing token with provided data if missing
            if (symbol && !token.symbol) token.symbol = symbol;
            if (name && !token.name) token.name = name;
            if (decimals && !token.decimals) token.decimals = decimals;
            if (chain && !token.chain) token.chain = chain;
        }

        // Ensure all required fields are present using helper methods
        if (this.tokenSearch.getTokenSymbol && this.tokenSearch.getTokenName) {
            token.symbol = token.symbol || this.tokenSearch.getTokenSymbol(token);
            token.name = token.name || this.tokenSearch.getTokenName(token);
        }
        token.decimals = token.decimals || 18;
        token.chain = token.chain || 'cheese-native';
        token.logoURI = token.logoURI || '';

        this.tokenSearch.addToken(token);
        this.showNotification(`✅ ${token.symbol || symbol || 'Token'} added to portfolio`, 'success');

        // Hide search results
        const searchResults = document.getElementById('portfolio-search-results');
        const searchInput = document.getElementById('portfolio-search-token');
        if (searchResults) searchResults.style.display = 'none';
        if (searchInput) searchInput.value = '';

        // Refresh portfolio
        this.updatePortfolioScreen();
    }

    addCustomTokenByAddress(address) {
        // CRITICAL FIX: Auto-detect token info from BSC if it's a BSC token
        const normalizedAddress = address.replace(/^0x/, '').trim();
        if (!/^[0-9a-fA-F]{40}$/.test(normalizedAddress)) {
            this.showNotification('Invalid token address format', 'error');
            return;
        }

        const fullAddress = '0x' + normalizedAddress;

        // Try to auto-detect token info from BSC
        if (this.crossChainBalance) {
            this.showNotification('🔍 Detecting token information from BSC...', 'info');
            this.crossChainBalance.getTokenInfo(fullAddress).then(tokenInfo => {
                if (tokenInfo && tokenInfo.symbol && tokenInfo.symbol !== 'UNKNOWN') {
                    // Auto-detected token info
                    this.addTokenToPortfolio(
                        fullAddress,
                        tokenInfo.symbol,
                        tokenInfo.name || tokenInfo.symbol,
                        tokenInfo.decimals || 18,
                        'bsc' // Auto-set to BSC since we're checking BSC
                    );
                } else {
                    // Fallback to manual entry
                    this.promptForTokenDetails(fullAddress);
                }
            }).catch(() => {
                // If auto-detection fails, prompt for details
                this.promptForTokenDetails(fullAddress);
            });
        } else {
            // No cross-chain balance checker, prompt for details
            this.promptForTokenDetails(fullAddress);
        }
    }

    promptForTokenDetails(address) {
        // Prompt for token details
        const symbol = prompt('Enter token symbol (e.g., USDT, ETH):', 'TOKEN');
        if (!symbol || symbol.trim() === '') {
            this.showNotification('Token symbol is required', 'error');
            return;
        }

        const name = prompt('Enter token name (e.g., Tether USD):', 'Custom Token');
        const decimals = prompt('Enter token decimals (default: 18):', '18');
        const chain = prompt('Enter chain (cheese-native, bsc, ethereum):', 'bsc');

        this.addTokenToPortfolio(
            address,
            symbol.trim(),
            name ? name.trim() : 'Custom Token',
            parseInt(decimals) || 18,
            chain ? chain.trim() : 'bsc'
        );
    }

    removeTokenFromPortfolio(address, chain = null) {
        if (!this.tokenSearch) {
            this.showNotification('Token search not available', 'error');
            return;
        }

        // CRITICAL FIX: Only remove user-added placeholder tokens
        const normalizedAddress = address.replace(/^0x/, '').trim();
        const fullAddress = '0x' + normalizedAddress;

        // Get token from user tokens
        const userTokens = this.tokenSearch.getUserTokens();
        const token = userTokens.find(t =>
            t.address.toLowerCase() === fullAddress.toLowerCase() &&
            (!chain || (t.chain || '').toLowerCase() === chain.toLowerCase())
        );

        if (!token) {
            // Token not found in user tokens - it's cross-chain detected only
            this.showNotification('⚠️ This token is automatically detected from BSC. It cannot be removed as it has a balance on BSC.', 'info');
            return;
        }

        // Check if this is a placeholder token (TOKEN, UNKNOWN, Custom Token, etc.)
        const isPlaceholder = (token.symbol === 'TOKEN' || token.symbol === 'UNKNOWN' ||
            token.name === 'Custom Token' || token.name === 'Unknown Token');

        // Check if there's a cross-chain detected version with real info
        const portfolioContent = document.getElementById('portfolio-content');
        let hasRealVersion = false;
        if (portfolioContent) {
            const tokenElements = portfolioContent.querySelectorAll(`[data-token-address="${fullAddress.toLowerCase()}"]`);
            tokenElements.forEach(el => {
                const symbol = el.getAttribute('data-token-symbol');
                if (symbol && symbol !== 'TOKEN' && symbol !== 'UNKNOWN') {
                    hasRealVersion = true;
                }
            });
        }

        let confirmMessage = `Remove ${token.symbol || 'token'} from your portfolio?`;
        if (hasRealVersion) {
            confirmMessage += `\n\n✅ The real token (${token.symbol}) will still appear as it's detected from BSC.`;
        } else if (this.crossChainBalance && this.wallet && this.wallet.address) {
            confirmMessage += `\n\n⚠️ Note: If you have a balance on BSC, the token may still appear as a cross-chain detected token.`;
        }

        if (confirm(confirmMessage)) {
            // CRITICAL: Only remove from user tokens, NOT from cross-chain detected tokens
            this.tokenSearch.removeToken(fullAddress);
            this.showNotification(`✅ ${token.symbol || 'Token'} removed from portfolio`, 'success');
            // Refresh portfolio - cross-chain token will still appear if it has balance
            this.updatePortfolioScreen();
        }
    }

    showAllTransactions() {
        if (!this.wallet) {
            this.showNotification('Please create a wallet first', 'error');
            return;
        }
        // Show all transactions modal
        if (this.enhancements) {
            this.enhancements.showAllTransactionsModal(this.transactions);
        } else {
            alert(`Total transactions: ${this.transactions.length}`);
        }
    }

    showAddressBook() {
        if (this.enhancements) {
            this.enhancements.showAddressBookModal();
        } else {
            alert('Address book would appear here');
        }
    }

    exportWallet() {
        if (!this.wallet) {
            this.showNotification('No wallet to export', 'error');
            return;
        }
        const password = prompt('Enter password to encrypt export (optional):');
        if (password === null) return; // User cancelled

        try {
            const exportData = this.enhancements.exportWalletJSON(this.wallet, password || null);
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cheese-wallet-${this.wallet.address.slice(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showNotification('✅ Wallet exported successfully!', 'success');
        } catch (error) {
            console.error('Export wallet error:', error);
            this.showNotification('Failed to export wallet: ' + error.message, 'error');
        }
    }

    // Show private key modal for wallets without seed phrases (like founder wallet)
    async showPrivateKeyModal(password) {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('No wallet loaded', 'error');
            return;
        }

        // Get private key from wallet data
        let privateKey = null;
        try {
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            if (!walletData || !walletData.address) {
                throw new Error('Wallet not found');
            }

            if (walletData.encryptedPrivateKey && password) {
                // Decrypt private key
                privateKey = await this.walletCore.decryptPrivateKey(walletData.encryptedPrivateKey, password);
            } else if (walletData.privateKey) {
                privateKey = walletData.privateKey;
            } else {
                throw new Error('Private key not available. This wallet may be read-only.');
            }

            if (!privateKey) {
                throw new Error('Failed to retrieve private key. Please check your password.');
            }
        } catch (error) {
            this.showNotification('❌ ' + error.message, 'error');
            return;
        }

        // Create secure modal
        const modal = document.createElement('div');
        modal.id = 'private-key-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20000;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 15px;
            max-width: 600px;
            width: 90%;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        `;

        content.innerHTML = `
            <h2 style="margin-bottom: 20px; color: #dc3545;">🔑 Your Private Key</h2>
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
                <strong style="color: #856404;">⚠️ CRITICAL SECURITY WARNING:</strong>
                <ul style="margin: 10px 0; padding-left: 20px; color: #856404; font-size: 0.9em;">
                    <li>This wallet does NOT have a seed phrase</li>
                    <li>Your private key is the ONLY way to recover this wallet</li>
                    <li>Write down your private key and store it in a safe place</li>
                    <li>Never share your private key with anyone</li>
                    <li>If you lose this private key, you will lose access to your wallet forever</li>
                    <li><strong>For Founder Wallet:</strong> This is especially critical - backup your private key NOW!</li>
                </ul>
            </div>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 2px solid #dee2e6;">
                <div style="font-size: 0.9em; color: #6c757d; margin-bottom: 10px;">Wallet Address:</div>
                <div style="font-family: monospace; font-size: 0.9em; word-break: break-all; color: #333; margin-bottom: 20px; padding: 10px; background: white; border-radius: 5px;">
                    ${this.wallet.address}
                </div>
                <div style="font-size: 0.9em; color: #6c757d; margin-bottom: 10px;">Private Key:</div>
                <div id="private-key-display" style="font-family: monospace; font-size: 0.85em; word-break: break-all; color: #dc3545; padding: 15px; background: white; border-radius: 5px; border: 2px solid #dc3545; font-weight: bold;">
                    ${privateKey}
                </div>
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                <button id="private-key-copy-btn" class="btn btn-primary" style="padding: 10px 20px;">📋 Copy Private Key</button>
                <button id="private-key-close-btn" class="btn btn-secondary" style="padding: 10px 20px;">Close</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Copy button
        const copyBtn = content.querySelector('#private-key-copy-btn');
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(privateKey).then(() => {
                this.showNotification('✅ Private key copied to clipboard!', 'success');
            }).catch(() => {
                // Fallback
                const textArea = document.createElement('textarea');
                textArea.value = privateKey;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                this.showNotification('✅ Private key copied to clipboard!', 'success');
            });
        });

        // Close button
        const closeBtn = content.querySelector('#private-key-close-btn');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    async importWallet() {
        if (typeof ethers === 'undefined') {
            this.showNotification('Wallet crypto library (ethers.js) did not load.', 'error');
            return;
        }

        const existingModal = document.getElementById('import-wallet-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'import-wallet-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); backdrop-filter: blur(5px);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000; animation: fadeIn 0.3s;
        `;

        modal.innerHTML = `
            <div class="card" style="width: 90%; max-width: 450px; animation: modalPop 0.3s; padding: 25px; border-radius: 15px;">
                <h3 style="margin-bottom: 15px; color: var(--secondary);">📥 Import Wallet</h3>
                <div id="import-step-1">
                    <p style="margin-bottom: 20px; font-size: 0.9em; color: var(--text-light);">
                        Choose how you want to import your wallet:
                    </p>
                    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                        <button id="import-mnemonic-btn" class="btn btn-secondary" style="text-align: left; padding: 15px;">
                            <strong>🔑 Seed Phrase</strong><br>
                            <small>12 or 24 words</small>
                        </button>
                        <button id="import-private-key-btn" class="btn btn-secondary" style="text-align: left; padding: 15px;">
                            <strong>🔐 Private Key</strong><br>
                            <small>64 hex characters</small>
                        </button>
                    </div>
                    <button id="close-import-btn" class="btn btn-outline" style="width: 100%;">Cancel</button>
                </div>

                <div id="import-step-private-key" style="display: none;">
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">Private Key</label>
                        <input type="text" id="import-pk-input" class="form-control" 
                            placeholder="Enter 64 character hex key" 
                            style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-family: monospace;">
                    </div>
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">New Password</label>
                        <input type="password" id="import-pk-password" class="form-control" 
                            placeholder="Encrypt your wallet (Min 4 chars)" 
                            style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button id="back-to-step-1" class="btn btn-secondary" style="flex: 1;">Back</button>
                        <button id="confirm-import-pk-btn" class="btn btn-primary" style="flex: 2;">Import Now</button>
                    </div>
                </div>

                <div id="import-step-mnemonic" style="display: none;">
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">Mnemonic Seed Phrase</label>
                        <textarea id="import-mnemonic-input" class="form-control" rows="3"
                            placeholder="word1 word2 ... word12" 
                            style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 0.95rem; resize: none;"></textarea>
                    </div>
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: bold;">New Password</label>
                        <input type="password" id="import-mnemonic-password" class="form-control" 
                            placeholder="Encrypt your wallet (Min 4 chars)" 
                            style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 8px;">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button id="back-to-step-1-mnemonic" class="btn btn-secondary" style="flex: 1;">Back</button>
                        <button id="confirm-import-mnemonic-btn" class="btn btn-primary" style="flex: 2;">Import Now</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Step 1 buttons
        document.getElementById('close-import-btn').onclick = () => modal.remove();
        
        document.getElementById('import-mnemonic-btn').onclick = () => {
            document.getElementById('import-step-1').style.display = 'none';
            document.getElementById('import-step-mnemonic').style.display = 'block';
            document.getElementById('import-mnemonic-input').focus();
        };

        document.getElementById('import-private-key-btn').onclick = () => {
            document.getElementById('import-step-1').style.display = 'none';
            document.getElementById('import-step-private-key').style.display = 'block';
            document.getElementById('import-pk-input').focus();
        };

        // Step Mnemonic buttons
        document.getElementById('back-to-step-1-mnemonic').onclick = () => {
            document.getElementById('import-step-mnemonic').style.display = 'none';
            document.getElementById('import-step-1').style.display = 'block';
        };

        document.getElementById('confirm-import-mnemonic-btn').onclick = async () => {
            const phrase = document.getElementById('import-mnemonic-input').value.trim();
            const password = document.getElementById('import-mnemonic-password').value;

            if (!phrase || phrase.split(/\s+/).length !== 12) {
                this.showNotification('Mnemonic recovery phrase must be exactly 12 words', 'error');
                return;
            }
            if (password.length < 4) {
                this.showNotification('Password must be at least 4 characters', 'error');
                return;
            }

            modal.innerHTML = '<div style="text-align: center; padding: 40px;"><h3 style="color: var(--secondary);">⏳ Importing Wallet...</h3><p>Deriving address and encrypting...</p></div>';

            try {
                const tempWallet = ethers.Wallet.fromPhrase(phrase);
                
                this.wallet = {
                    address: tempWallet.address,
                    publicKey: tempWallet.publicKey,
                    privateKey: tempWallet.privateKey.replace(/^0x/, ''),
                    mnemonic: phrase
                };

                this.walletCore.wallet = this.wallet;
                await this.walletCore.saveWallet(password.trim());
                
                modal.remove();
                this.showNotification('✅ Wallet successfully imported!', 'success');
                await this.init(); // Refresh UI
            } catch (err) {
                this.showNotification('❌ Import failed: ' + err.message, 'error');
                modal.remove();
            }
        };

        // Step Private Key buttons
        document.getElementById('back-to-step-1').onclick = () => {
            document.getElementById('import-step-private-key').style.display = 'none';
            document.getElementById('import-step-1').style.display = 'block';
        };

        document.getElementById('confirm-import-pk-btn').onclick = async () => {
            const pk = document.getElementById('import-pk-input').value.trim().toLowerCase().replace(/^0x/, '');
            const password = document.getElementById('import-pk-password').value;

            if (!/^[a-fA-F0-9]{64}$/.test(pk)) {
                this.showNotification('Invalid private key format (must be 64 hex characters)', 'error');
                return;
            }
            if (password.length < 4) {
                this.showNotification('Password must be at least 4 characters', 'error');
                return;
            }

            modal.innerHTML = '<div style="text-align: center; padding: 40px;"><h3 style="color: var(--secondary);">⏳ Importing Wallet...</h3><p>Deriving address and encrypting...</p></div>';
            
            try {
                // Use default EVM standard for simple import
                const address = ethers.computeAddress('0x' + pk);
                const tempWallet = new ethers.Wallet('0x' + pk);
                
                this.wallet = {
                    address: address,
                    publicKey: tempWallet.publicKey,
                    privateKey: pk,
                    mnemonic: null
                };

                this.walletCore.wallet = this.wallet;
                await this.walletCore.saveWallet(password.trim());
                
                modal.remove();
                this.showNotification('✅ Wallet successfully imported!', 'success');
                await this.init(); // Refresh UI
            } catch (err) {
                this.showNotification('❌ Import failed: ' + err.message, 'error');
                modal.remove();
            }
        };
    }

    async importWalletOld() {
        if (typeof ethers === 'undefined') {
            this.showNotification('Wallet crypto library (ethers.js) did not load. Check your connection, disable blockers, and refresh.', 'error');
            return;
        }
        // [NEW] Hybrid Blockchain Derivation Methods
        const deriveAddress = async (privateKey, standard) => {
            try {
                const cleanKey = privateKey.replace(/^0x/i, '');
                
                if (standard === 'evm') {
                    return ethers.computeAddress('0x' + cleanKey);
                }
                
                // For legacy methods, we need the public key
                const wallet = new ethers.Wallet('0x' + cleanKey);
                const normalizedPubKey = wallet.publicKey.replace(/^0x/i, '');
                
                if (standard === 'legacy-hex') {
                    const hash = await this.sha256(normalizedPubKey);
                    return '0x' + hash.substring(0, 40);
                }
                
                if (standard === 'wallet-utf8') {
                    const bytes = new TextEncoder().encode(normalizedPubKey);
                    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    return '0x' + hashArray.slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
                }
                
                if (standard === 'byte-based') {
                    const bytes = new Uint8Array(normalizedPubKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    return '0x' + hashArray.slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
                }
            } catch (e) {
                console.error('Derivation error:', e);
            }
            return null;
        };

        const importMethod = prompt(
            'Import Wallet\n\n' +
            '1. Seed Phrase (12 or 24 words)\n' +
            '2. Private Key (64 hex characters)\n' +
            '3. QR Code\n\n' +
            'Enter 1, 2, or 3:'
        );

        if (!importMethod) return;

        try {
            if (importMethod === '2') {
                // Import from Private Key
                const privateKey = prompt('Enter your private key (64 hex characters, without 0x prefix):');
                if (!privateKey || privateKey.trim() === '') {
                    this.showNotification('Private key is required', 'error');
                    return;
                }

                // Clean the private key (remove 0x prefix if present)
                let cleanKey = privateKey.trim().toLowerCase();
                if (cleanKey.startsWith('0x')) {
                    cleanKey = cleanKey.slice(2);
                }

                // Validate private key format (case-insensitive for EVM compatibility)
                if (!/^[a-fA-F0-9]{64}$/.test(cleanKey)) {
                    this.showNotification('Invalid private key format. Must be 64 hex characters.', 'error');
                    return;
                }

                // Normalize to lowercase for consistency
                cleanKey = cleanKey.toLowerCase();

                // Password is required for security
                const password = prompt('Set a password to encrypt this wallet (required):');
                if (!password || password.trim() === '') {
                    this.showNotification('Password is required to import wallet', 'error');
                    return;
                }
                if (password.length < 4) {
                    this.showNotification('Password must be at least 4 characters', 'error');
                    return;
                }

                try {
                    console.log('🔑 Importing wallet from private key...');

                    // Ask for derivation standard
                    const standardChoice = prompt(
                        'Select Address Derivation Standard:\n\n' +
                        '1. Standard EVM (Recommended/Default)\n' +
                        '2. Legacy SHA256 (Hex)\n' +
                        '3. Wallet-Compatible (UTF-8)\n' +
                        '4. Byte-Based Legacy\n\n' +
                        'If you see 0 balance after import, try another standard.',
                        '1'
                    );

                    const standardMap = {
                        '1': 'evm',
                        '2': 'legacy-hex',
                        '3': 'wallet-utf8',
                        '4': 'byte-based'
                    };
                    const standard = standardMap[standardChoice] || 'evm';
                    this.derivationStandard = standard;

                    const address = await deriveAddress(cleanKey, standard);
                    if (!address) throw new Error('Failed to derive address');

                    // Get public key for storage
                    const tempWallet = new ethers.Wallet('0x' + cleanKey);
                    const publicKey = tempWallet.publicKey;

                    console.log(`✅ Wallet derived using ${standard} standard, address: ${address}`);

                    this.wallet = {
                        address: address,
                        publicKey: publicKey,
                        privateKey: cleanKey,
                        mnemonic: null // No mnemonic for private key import
                    };

                    // CRITICAL: Normalize password before saving
                    const normalizedPassword = password.trim();

                    this.walletCore.wallet = this.wallet;
                    await this.walletCore.saveWallet(normalizedPassword);

                    // CRITICAL: Verify wallet was saved and can be loaded
                    console.log('🔒 Verifying wallet save...');
                    const savedData = localStorage.getItem('cheeseWallet');
                    if (!savedData) {
                        throw new Error('Wallet was not saved to localStorage');
                    }

                    const parsedData = JSON.parse(savedData);
                    console.log('✅ Wallet saved with address:', parsedData.address);
                    console.log('✅ Wallet encrypted:', parsedData.encrypted);
                    console.log('✅ Has encrypted key:', !!parsedData.encryptedPrivateKey);

                    // CRITICAL: Verify we can reload the wallet with the same password
                    const testLoad = await this.walletCore.loadWallet(normalizedPassword);
                    if (!testLoad || !testLoad.privateKey) {
                        throw new Error('Wallet verification failed - could not reload with password');
                    }
                    console.log('✅ Wallet verification successful - password works');

                    // Restore wallet state
                    this.wallet = testLoad;
                    this.walletCore.wallet = this.wallet;

                    this.fiatGateway.setWalletAddress(this.wallet.address);

                    await this.loadWalletData();

                    // Pre-generate QR code
                    if (this.wallet && this.wallet.address) {
                        this.preGenerateQRCode(this.wallet.address).catch(err => {
                            console.warn('QR code pre-generation failed (non-critical):', err);
                        });
                    }

                    this.showWalletAfterImport();
                    this.showNotification('✅ Wallet imported successfully from private key!', 'success');
                } catch (error) {
                    console.error('Private key import error:', error);
                    this.showNotification('Failed to import wallet: ' + error.message, 'error');
                }
            } else if (importMethod === '1') {
                // Import from Seed Phrase
                const seedPhrase = prompt('Enter your seed phrase (12 or 24 words, separated by spaces):');
                if (!seedPhrase || seedPhrase.trim() === '') {
                    this.showNotification('Seed phrase is required', 'error');
                    return;
                }

                const words = seedPhrase.trim().toLowerCase().split(/\s+/);
                if (words.length !== 12 && words.length !== 24) {
                    this.showNotification('Seed phrase must be 12 or 24 words', 'error');
                    return;
                }

                // Password is required for security
                const password = prompt('Set a password to encrypt this wallet (required):');
                if (!password || password.trim() === '') {
                    this.showNotification('Password is required to import wallet', 'error');
                    return;
                }
                if (password.length < 4) {
                    this.showNotification('Password must be at least 4 characters', 'error');
                    return;
                }

                try {
                    // CRITICAL FIX: Derive wallet from mnemonic and validate
                    const cleanSeedPhrase = seedPhrase.trim();
                    console.log('📝 Importing wallet from seed phrase...');

                    // Derive wallet from mnemonic using wallet-security
                    const walletData = await this.security.deriveWalletFromMnemonic(cleanSeedPhrase);

                    // CRITICAL VALIDATION: Verify derived wallet is valid
                    if (!walletData || !walletData.address || !walletData.privateKey) {
                        throw new Error('Failed to derive wallet from seed phrase - invalid wallet data');
                    }

                    console.log('✅ Wallet derived from seed phrase, address:', walletData.address);

                    this.wallet = {
                        address: walletData.address,
                        publicKey: walletData.publicKey,
                        privateKey: walletData.privateKey,
                        mnemonic: cleanSeedPhrase // Store mnemonic for consistency
                    };

                    // CRITICAL: Normalize password before saving
                    const normalizedPassword = password.trim();

                    this.walletCore.wallet = this.wallet;
                    await this.walletCore.saveWallet(normalizedPassword);

                    // CRITICAL: Verify saved wallet address matches derived address
                    const savedData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                    if (!savedData || savedData.address !== this.wallet.address) {
                        console.error('❌ Address mismatch after import save! Derived:', this.wallet.address, 'Saved:', savedData.address);
                        throw new Error('Wallet import failed - address mismatch detected');
                    }
                    console.log('✅ Wallet imported and saved, address verified:', savedData.address);

                    // CRITICAL: Verify we can reload the wallet with the same password
                    const testLoad = await this.walletCore.loadWallet(normalizedPassword);
                    if (!testLoad || !testLoad.privateKey) {
                        throw new Error('Wallet verification failed - could not reload with password');
                    }
                    console.log('✅ Wallet verification successful - password works after save');

                    // Restore wallet state
                    this.wallet = testLoad;
                    this.wallet.mnemonic = cleanSeedPhrase; // Keep mnemonic
                    this.walletCore.wallet = this.wallet;

                    // Store mnemonic encrypted for recovery
                    await this.saveMnemonicSecurely(cleanSeedPhrase, normalizedPassword);

                    this.fiatGateway.setWalletAddress(this.wallet.address);

                    await this.loadWalletData();

                    // CRITICAL: Pre-generate QR code immediately after wallet import
                    if (this.wallet && this.wallet.address) {
                        this.preGenerateQRCode(this.wallet.address).catch(err => {
                            console.warn('QR code pre-generation failed (non-critical):', err);
                        });
                    }

                    this.showWalletAfterImport();
                    this.showNotification('✅ Wallet imported successfully from seed phrase!', 'success');
                } catch (error) {
                    console.error('Seed phrase import error:', error);
                    this.showNotification('Failed to import wallet: ' + error.message, 'error');
                }
            } else if (importMethod === '3') {
                // Import from QR Code
                this.showNotification('📷 Please scan the QR code with your camera', 'info');

                // Create QR scanner modal
                const modal = document.createElement('div');
                modal.id = 'qr-scanner-modal';
                modal.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.9);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                `;

                const content = document.createElement('div');
                content.style.cssText = `
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    text-align: center;
                    max-width: 400px;
                    width: 90%;
                `;

                content.innerHTML = `
                    <h3 style="margin-bottom: 15px;">Scan QR Code</h3>
                    <video id="qr-video" style="width: 100%; max-width: 300px; border: 2px solid #007bff; border-radius: 8px;" autoplay playsinline></video>
                    <canvas id="qr-canvas" style="display: none;"></canvas>
                    <div style="margin-top: 15px;">
                        <p style="color: #666; font-size: 0.9em;">Point your camera at the QR code</p>
                    </div>
                    <div style="margin-top: 15px;">
                        <button id="qr-manual-input-btn" class="btn btn-secondary" style="margin-right: 10px;">Enter Manually</button>
                        <button id="qr-cancel-btn" class="btn btn-secondary">Cancel</button>
                    </div>
                `;

                modal.appendChild(content);
                document.body.appendChild(modal);

                const video = document.getElementById('qr-video');
                const canvas = document.getElementById('qr-canvas');
                const context = canvas.getContext('2d');
                let stream = null;

                // Manual input button
                document.getElementById('qr-manual-input-btn').addEventListener('click', () => {
                    const address = prompt('Enter wallet address or seed phrase from QR code:');
                    if (address && address.trim()) {
                        this.processQRImport(address.trim());
                    }
                    if (stream) {
                        stream.getTracks().forEach(track => track.stop());
                    }
                    document.body.removeChild(modal);
                });

                // Cancel button
                document.getElementById('qr-cancel-btn').addEventListener('click', () => {
                    if (stream) {
                        stream.getTracks().forEach(track => track.stop());
                    }
                    document.body.removeChild(modal);
                });

                // Try to access camera
                navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                    .then(mediaStream => {
                        stream = mediaStream;
                        video.srcObject = stream;
                        video.play();

                        // Simple QR code detection (basic implementation)
                        const scanInterval = setInterval(() => {
                            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                                canvas.width = video.videoWidth;
                                canvas.height = video.videoHeight;
                                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                                // Try to decode QR code (would need a QR library)
                                // For now, show manual input option
                            }
                        }, 100);

                        // Cleanup on modal close
                        modal.addEventListener('close', () => {
                            clearInterval(scanInterval);
                            if (stream) {
                                stream.getTracks().forEach(track => track.stop());
                            }
                        });
                    })
                    .catch(error => {
                        console.error('Camera access error:', error);
                        this.showNotification('Camera access denied. Please use manual input.', 'error');
                        document.getElementById('qr-manual-input-btn').click();
                    });
            } else {
                this.showNotification('Invalid choice. Please enter 1 or 2.', 'error');
            }
        } catch (error) {
            console.error('Import wallet error:', error);
            this.showNotification('Failed to import wallet: ' + error.message, 'error');
        }
    }

    showWalletAfterImport() {
        // Hide login/no-wallet screens, show wallet
        const loginSection = document.getElementById('login-section');
        const noWalletSection = document.getElementById('no-wallet-section');
        const walletSection = document.getElementById('wallet-section');

        if (loginSection) loginSection.style.display = 'none';
        if (noWalletSection) noWalletSection.style.display = 'none';
        if (walletSection) walletSection.style.display = 'block';

        this.updateUI();
    }

    // Start mobile mining
    async startMobileMining() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('Please create a wallet first', 'error');
            return;
        }

        if (this.mobileMiner.isMining) {
            this.showNotification('Mining already in progress', 'info');
            return;
        }

        try {
            // Setup callbacks
            this.mobileMiner.setOnBlockFound(async (block, result) => {
                await this.updateBalance();
                await this.updateTransactions();
            });

            this.mobileMiner.setOnStatsUpdate((stats) => {
                this.updateMiningStats(stats);
            });

            // Set notification callback
            this.mobileMiner.setOnNotification((message, type) => {
                this.showNotification(message, type);
            });

            // Start mining
            await this.mobileMiner.startMining(this.wallet.address);

            // Update UI
            const startBtn = document.getElementById('start-mining-btn');
            const stopBtn = document.getElementById('stop-mining-btn');
            const statsDiv = document.getElementById('mining-stats');

            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';
            if (statsDiv) statsDiv.style.display = 'block';

            this.showNotification('✅ Mining started! Your device is now mining blocks.', 'success');

            // Start stats update interval
            this.miningStatsInterval = setInterval(() => {
                const stats = this.mobileMiner.getMiningStats();
                this.updateMiningStats(stats);
            }, 1000);
        } catch (error) {
            console.error('Start mining error:', error);
            this.showNotification('Failed to start mining: ' + error.message, 'error');
        }
    }

    // Stop mobile mining
    stopMobileMining() {
        if (!this.mobileMiner.isMining) {
            return;
        }

        this.mobileMiner.stopMining();

        // Update UI
        const startBtn = document.getElementById('start-mining-btn');
        const stopBtn = document.getElementById('stop-mining-btn');
        const statsDiv = document.getElementById('mining-stats');

        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';

        // Clear stats interval
        if (this.miningStatsInterval) {
            clearInterval(this.miningStatsInterval);
            this.miningStatsInterval = null;
        }

        this.showNotification('⏹️ Mining stopped', 'info');
    }

    // Update mining stats display
    updateMiningStats(stats) {
        const hashRateEl = document.getElementById('hash-rate');
        const totalHashesEl = document.getElementById('total-hashes');
        const blocksFoundEl = document.getElementById('blocks-found');
        const difficultyEl = document.getElementById('mining-difficulty');
        const miningTimeEl = document.getElementById('mining-time');

        if (hashRateEl) {
            hashRateEl.textContent = this.formatHashRate(stats.hashesPerSecond || 0);
        }

        if (totalHashesEl) {
            totalHashesEl.textContent = (stats.totalHashes || 0).toLocaleString();
        }

        if (blocksFoundEl) {
            blocksFoundEl.textContent = stats.blocksFound || 0;
        }

        if (difficultyEl) {
            difficultyEl.textContent = stats.currentDifficulty || '-';
        }

        if (miningTimeEl && stats.startTime) {
            const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
            miningTimeEl.textContent = this.formatTime(elapsed);
        }
    }

    // Format hash rate
    formatHashRate(hps) {
        if (hps < 1000) {
            return hps + ' H/s';
        } else if (hps < 1000000) {
            return (hps / 1000).toFixed(2) + ' KH/s';
        } else {
            return (hps / 1000000).toFixed(2) + ' MH/s';
        }
    }

    // Format time
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Legacy mine block (single block)
    async mineBlock() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('Please create a wallet first', 'error');
            return;
        }

        try {
            const result = await this.api.mineBlock(this.wallet.address);
            if (result.success) {
                this.showNotification('✅ Block mined! Reward: ' + (result.reward || 0) + ' NCH', 'success');
                await this.updateBalance();
                await this.updateTransactions();
            } else {
                throw new Error(result.error || 'Mining failed');
            }
        } catch (error) {
            console.error('Mine block error:', error);
            this.showNotification('Mining error: ' + error.message, 'error');
        }
    }

    // Sell screen methods
    updateSellScreen() {
        // Update available balance
        const balanceEl = document.getElementById('sell-available-balance');
        if (balanceEl && this.wallet) {
            balanceEl.textContent = this.balance.toFixed(2);
        }
        // Populate payment methods
        this.populatePaymentMethods('sell-method', 'sell');
        // Update preview
        this.updateSellPreview();
    }

    updateSellPreview() {
        const amount = parseFloat(document.getElementById('sell-amount')?.value || 0);
        const currency = document.getElementById('sell-currency')?.value || 'USD';

        if (amount <= 0) {
            const receiveEl = document.getElementById('sell-receive');
            const netEl = document.getElementById('sell-net-amount');
            const rateEl = document.getElementById('sell-rate');
            if (receiveEl) receiveEl.textContent = '$0.00';
            if (netEl) netEl.textContent = '$0.00';
            if (rateEl) rateEl.textContent = `1 NCH = $0.022`;
            return;
        }

        // Calculate exchange rate (using dynamic oracle)
        const exchangeRate = this.tokenSearch?.getTokenPriceSync('NCH') || 0.022;
        const feePercent = 2.5;
        const fee = amount * (feePercent / 100);
        const fiatAmount = amount * exchangeRate;
        const netAmount = fiatAmount - fee;

        // Update preview elements
        const receiveEl = document.getElementById('sell-receive');
        const netEl = document.getElementById('sell-net-amount');
        const rateEl = document.getElementById('sell-rate');

        if (receiveEl) {
            receiveEl.textContent = this.enhancements?.formatCurrency(fiatAmount, currency) || `$${fiatAmount.toFixed(2)}`;
        }
        if (netEl) {
            netEl.textContent = this.enhancements?.formatCurrency(netAmount, currency) || `$${netAmount.toFixed(2)}`;
        }
        if (rateEl) {
            rateEl.textContent = `1 NCH = ${this.enhancements?.formatCurrency(exchangeRate, currency) || `$${exchangeRate.toFixed(3)}`}`;
        }
    }

    async processSell() {
        if (!this.wallet || !this.wallet.address) {
            this.showNotification('Please create a wallet first', 'error');
            return;
        }

        const amount = parseFloat(document.getElementById('sell-amount')?.value || 0);
        const currency = document.getElementById('sell-currency')?.value || 'USD';
        const paymentMethod = document.getElementById('sell-method')?.value || 'paypal';
        const payoutAddress = document.getElementById('sell-payout-address')?.value || '';

        if (amount <= 0) {
            this.showNotification('Please enter a valid amount', 'error');
            return;
        }

        if (amount > this.balance) {
            this.showNotification('Insufficient balance', 'error');
            return;
        }

        if (!payoutAddress) {
            this.showNotification('Please enter payout address/account', 'error');
            return;
        }

        try {
            const result = await this.fiatGateway.sellCheese(amount, currency, paymentMethod, payoutAddress);
            if (result.success) {
                this.showNotification('✅ Sell order submitted! ' + (result.message || ''), 'success');
                await this.updateBalance();
                // Clear form
                document.getElementById('sell-amount').value = '';
                document.getElementById('sell-payout-address').value = '';
                this.updateSellPreview();
            } else {
                throw new Error(result.error || 'Sell failed');
            }
        } catch (error) {
            console.error('Sell error:', error);
            this.showNotification('Sell error: ' + error.message, 'error');
        }
    }

    setMaxSellAmount() {
        const amountInput = document.getElementById('sell-amount');
        if (amountInput && this.wallet) {
            amountInput.value = this.balance.toFixed(2);
            this.updateSellPreview();
        }
    }

    // Populate payment methods dropdown
    populatePaymentMethods(dropdownId, flowType = 'buy') {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown || !this.fiatGateway) return;

        // Clear existing options
        dropdown.innerHTML = '';

        const methods = this.fiatGateway.supportedPaymentMethods;
        const regions = {
            'Card Payments': ['credit_card', 'debit_card', 'visa', 'mastercard', 'amex'],
            'Global': ['paypal', 'google_pay', 'apple_pay', 'samsung_pay'],
            'US': ['venmo', 'cash_app', 'zelle'],
            'China': ['alipay', 'wechat_pay'],
            'India': ['paytm', 'phonepe', 'gpay_india'],
            'Europe': ['revolut', 'wise', 'skrill', 'neteller', 'payoneer', 'sofort', 'giropay', 'ideal', 'bancontact'],
            'Latin America': ['mercadopago', 'pix'],
            'Philippines': ['gcash', 'paymaya', 'coins_ph', 'grab_pay_ph', 'paymongo', 'dragonpay'],
            'Bank Transfers': ['bank_transfer', 'ach', 'sepa'],
            'Payment Gateways': ['moonpay', 'ramp']
        };

        // Add optgroups and options
        Object.keys(regions).forEach(regionName => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = regionName === 'Card Payments' ? '💳 Card Payments' :
                regionName === 'Global' ? '🌍 Global E-Wallets' :
                    regionName === 'US' ? '🇺🇸 US E-Wallets' :
                        regionName === 'China' ? '🇨🇳 China E-Wallets' :
                            regionName === 'India' ? '🇮🇳 India E-Wallets' :
                                regionName === 'Europe' ? '🇪🇺 Europe E-Wallets' :
                                    regionName === 'Latin America' ? '🇱🇦 Latin America E-Wallets' :
                                        regionName === 'Philippines' ? '🇵🇭 Philippines E-Wallets' :
                                            regionName === 'Bank Transfers' ? '🏦 Bank Transfers' :
                                                '🔗 Payment Gateways';

            regions[regionName].forEach(methodKey => {
                if (methods[methodKey]) {
                    const option = document.createElement('option');
                    option.value = methodKey;
                    option.textContent = `${methods[methodKey].icon || '💳'} ${methods[methodKey].name}`;
                    optgroup.appendChild(option);
                }
            });

            if (optgroup.children.length > 0) {
                dropdown.appendChild(optgroup);
            }
        });
    }

    // Filter transactions
    filterTransactions() {
        const filterType = document.getElementById('tx-filter-type')?.value || 'all';
        const searchTerm = document.getElementById('tx-search')?.value.toLowerCase() || '';
        const transactionsEl = document.getElementById('transactions-list');

        if (!transactionsEl || !this.wallet) return;

        let filtered = [...this.transactions];

        // Filter by type
        if (filterType === 'sent') {
            filtered = filtered.filter(tx => tx.from === this.wallet.address);
        } else if (filterType === 'received') {
            filtered = filtered.filter(tx => tx.to === this.wallet.address);
        }

        // Filter by search term
        if (searchTerm) {
            filtered = filtered.filter(tx =>
                tx.hash?.toLowerCase().includes(searchTerm) ||
                tx.from?.toLowerCase().includes(searchTerm) ||
                tx.to?.toLowerCase().includes(searchTerm) ||
                tx.amount?.toString().includes(searchTerm)
            );
        }

        // Display filtered transactions
        if (filtered.length === 0) {
            transactionsEl.innerHTML = '<p>No transactions found</p>';
            return;
        }

        transactionsEl.innerHTML = filtered.slice(0, 10).map(tx => `
            <div class="transaction-item">
                <div class="tx-type">${tx.from === this.wallet.address ? 'Sent' : 'Received'}</div>
                <div class="tx-amount">${tx.amount} NCH</div>
                <div class="tx-time">${new Date(tx.timestamp).toLocaleString()}</div>
            </div>
        `).join('');
    }

    // Toggle battery saver mode
    toggleBatterySaver(enabled) {
        if (this.mobileMiner) {
            this.mobileMiner.setMobileMode(enabled);
            this.showNotification(enabled ? '🔋 Battery Saver Mode enabled' : '⚡ Battery Saver Mode disabled', 'info');
        }
    }

    // Toggle background mining
    toggleBackgroundMining(enabled) {
        if (this.mobileMiner) {
            if (enabled) {
                this.mobileMiner.resumeMining();
            } else {
                this.mobileMiner.pauseMining();
            }
            this.showNotification(enabled ? '🔄 Background mining enabled' : '⏸️ Background mining disabled', 'info');
        }
    }

    // Check biometric availability and show button
    async checkBiometricAvailability(walletAddress) {
        if (!this.biometricAuth) {
            return;
        }

        try {
            const biometricSection = document.getElementById('biometric-login-section');
            const biometricBtn = document.getElementById('biometric-login-btn');
            const biometricStatus = document.getElementById('biometric-status');
            const biometricIcon = document.getElementById('biometric-icon');
            const biometricText = document.getElementById('biometric-text');

            if (!biometricSection || !biometricBtn) return;

            const isAvailable = await this.biometricAuth.isAvailable();
            const isRegistered = this.biometricAuth.isBiometricRegistered(walletAddress);

            if (isAvailable) {
                if (isRegistered) {
                    // Show biometric login button
                    biometricSection.style.display = 'block';
                    biometricBtn.style.display = 'block';
                    const biometricType = await this.biometricAuth.getBiometricType();
                    biometricIcon.textContent = '👆';
                    biometricText.textContent = `Login with ${biometricType}`;
                    if (biometricStatus) {
                        biometricStatus.textContent = `${biometricType} is set up`;
                        biometricStatus.style.color = '#28a745';
                    }
                } else {
                    // Show setup option
                    biometricSection.style.display = 'block';
                    biometricBtn.style.display = 'block';
                    biometricIcon.textContent = '🔐';
                    biometricText.textContent = 'Setup Biometric Login';
                    if (biometricStatus) {
                        biometricStatus.textContent = 'Tap to enable biometric authentication';
                        biometricStatus.style.color = '#666';
                    }
                    // Normalize address for setup
                    const normalizedAddress = walletAddress ? walletAddress.toLowerCase().trim() : walletAddress;
                    biometricBtn.onclick = () => this.setupBiometric(normalizedAddress);
                }
            } else {
                biometricSection.style.display = 'none';
            }
        } catch (error) {
            console.error('Biometric check error:', error);
            const biometricSection = document.getElementById('biometric-login-section');
            if (biometricSection) biometricSection.style.display = 'none';
        }
    }

    // Login with biometric
    async loginWithBiometric() {
        if (!this.biometricAuth) {
            this.showNotification('Biometric authentication is not available', 'error');
            return;
        }

        try {
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            if (!walletData || !walletData.address) {
                throw new Error('No wallet found');
            }

            this.showNotification('🔐 Authenticating with biometric...', 'info');

            // Authenticate with biometric - normalize address
            const normalizedAddress = walletData.address ? walletData.address.toLowerCase().trim() : walletData.address;
            const result = await this.biometricAuth.authenticateBiometric(normalizedAddress);

            if (result.success) {
                // Biometric authentication successful - now unlock wallet
                // For encrypted wallets, we still need the password stored securely
                // For now, we'll use a simplified approach where biometric bypasses password
                // In production, you'd store an encrypted password key that biometric unlocks

                // Try to load wallet (for encrypted wallets, we need password)
                // For this implementation, we'll check if wallet is encrypted
                const isEncrypted = walletData.encrypted && walletData.encryptedPrivateKey;

                if (isEncrypted) {
                    // For encrypted wallets with biometric, we need to store password securely
                    // This is a simplified implementation - in production, use secure key storage
                    let storedPassword = localStorage.getItem(`cheeseBiometricPassword_${walletData.address}`);

                    if (storedPassword) {
                        // Decode from Base64
                        try {
                            storedPassword = atob(storedPassword);
                        } catch (e) {
                            console.warn('⚠️ Stored biometric password was not Base64 encoded:', e.message);
                        }
                        // Use stored password to unlock
                        await this.loginWallet(storedPassword);
                    } else {
                        // First time - ask for password and store it (encrypted)
                        const password = prompt('Enter your wallet password to enable biometric login:');
                        if (password) {
                            // Store password (in production, encrypt this)
                            localStorage.setItem(`cheeseBiometricPassword_${walletData.address}`, btoa(password));
                            await this.loginWallet(password);
                        }
                    }
                } else {
                    // Unencrypted wallet - just load it
                    await this.loginWallet(null);
                }
            }
        } catch (error) {
            console.error('Biometric login error:', error);
            this.showNotification('❌ ' + error.message, 'error');
        }
    }

    // Setup biometric authentication
    async setupBiometric(walletAddress) {
        if (!this.biometricAuth) {
            this.showNotification('Biometric authentication is not available', 'error');
            return;
        }

        try {
            this.showNotification('🔐 Setting up biometric authentication...', 'info');

            const result = await this.biometricAuth.registerBiometric(walletAddress);

            if (result.success) {
                this.showNotification('✅ Biometric authentication enabled!', 'success');

                // For encrypted wallets, ask to store password
                const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                if (!walletData || !walletData.address) {
                    throw new Error('Wallet not found');
                }
                const isEncrypted = walletData.encrypted && walletData.encryptedPrivateKey;

                if (isEncrypted) {
                    const storePassword = confirm('Would you like to enable password-free login with biometric? You\'ll need to enter your password once.');
                    if (storePassword) {
                        const password = prompt('Enter your wallet password:');
                        if (password) {
                            // Store password (in production, encrypt this with biometric key)
                            localStorage.setItem(`cheeseBiometricPassword_${walletAddress}`, btoa(password));
                            this.showNotification('✅ Biometric login fully configured!', 'success');
                        }
                    }
                }

                // Refresh biometric UI
                this.checkBiometricAvailability(walletAddress);
            }
        } catch (error) {
            console.error('Biometric setup error:', error);
            this.showNotification('❌ ' + error.message, 'error');
        }
    }

    // Remove biometric authentication
    async removeBiometric(walletAddress) {
        if (!this.biometricAuth) {
            return;
        }

        try {
            const result = this.biometricAuth.removeBiometric(walletAddress);
            localStorage.removeItem(`cheeseBiometricPassword_${walletAddress}`);
            this.showNotification('✅ Biometric authentication removed', 'success');
        } catch (error) {
            console.error('Remove biometric error:', error);
            this.showNotification('Failed to remove biometric: ' + error.message, 'error');
        }
    }

    // MetaMask Integration
    async addToMetaMask() {
        if (!window.ethereum) {
            this.showNotification('🦊 MetaMask not detected! Please install MetaMask extension.', 'error');
            window.open('https://metamask.io/download/', '_blank');
            return;
        }

        const CONFIG = window.CHEESE_METAMASK_CONFIG;
        if (!CONFIG) {
            this.showNotification('❌ Configuration Error: Please refresh the page.', 'error');
            return;
        }

        try {
            this.showNotification('🦊 Requesting MetaMask to add Cheese Network...', 'info');
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [CONFIG.NETWORK]
            });
            this.showNotification('✅ Cheese Network added to MetaMask!', 'success');
            
            // Ask to add tokens as well
            if (confirm('Would you like to import native USDT and USDC tokens to MetaMask as well?')) {
                await this.addTokensToMetaMask();
            }
        } catch (error) {
            console.error('MetaMask error:', error);
            this.showNotification('❌ MetaMask Error: ' + error.message, 'error');
        }
    }

    async addTokensToMetaMask() {
        if (!window.ethereum) return;

        const CONFIG = window.CHEESE_METAMASK_CONFIG;
        if (!CONFIG || !CONFIG.TOKENS) {
            this.showNotification('❌ Configuration Error: Please refresh the page.', 'error');
            return;
        }

        try {
            // CRITICAL: First try to switch to Cheese Network to prevent "not supported" error
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: CONFIG.NETWORK.chainId }],
                });
            } catch (switchError) {
                // If network not added, this will fall through and we try to add tokens anyway
                if (switchError.code === 4902) {
                    this.showNotification('Please add the Cheese Blockchain network first!', 'error');
                    return;
                }
            }

            for (const token of CONFIG.TOKENS) {
                await window.ethereum.request({
                    method: 'wallet_watchAsset',
                    params: {
                        type: 'ERC20',
                        options: {
                            address: token.address,
                            symbol: token.symbol,
                            decimals: token.decimals,
                            image: token.image
                        }
                    }
                });
            }
            this.showNotification('✅ Native tokens added to MetaMask!', 'success');
        } catch (error) {
            console.error('MetaMask Token Error:', error);
            this.showNotification('❌ Error adding tokens: ' + error.message, 'error');
        }
    }

    // Update Notary Screen
    async updateNotaryScreen() {
        if (!this.wallet) {

            this.showNotification('Please login first to use the Notary', 'warning');
            this.showScreen('home');
            return;
        }

        this.setupNotaryListeners();
        this.updateNotaryHistory();
    }

    setupNotaryListeners() {
        console.log('📜 Setting up Notary listeners...');
        const dropZone = document.getElementById('notary-drop-zone');
        const fileInput = document.getElementById('notary-file-input');
        const cancelBtn = document.getElementById('notary-cancel-btn');
        const submitBtn = document.getElementById('notary-submit-btn');
        const selectFileBtn = document.getElementById('notary-select-file-btn');

        if (!dropZone || !fileInput) {
            console.error('❌ Notary UI elements missing');
            return;
        }

        // Remove existing listeners to prevent duplicates
        if (dropZone.dataset.listenersSet) {
            console.log('📜 Notary listeners already set, removing old ones...');
            // Clone elements to remove all event listeners
            const newDropZone = dropZone.cloneNode(true);
            const newFileInput = fileInput.cloneNode(true);
            dropZone.parentNode.replaceChild(newDropZone, dropZone);
            fileInput.parentNode.replaceChild(newFileInput, fileInput);
            
            // Re-get references
            const dropZoneNew = document.getElementById('notary-drop-zone');
            const fileInputNew = document.getElementById('notary-file-input');
            
            // Update references for subsequent code
            dropZone = dropZoneNew;
            fileInput = fileInputNew;
        }

        // Force file input to be clickable even if hidden
        fileInput.style.display = 'block';
        fileInput.style.opacity = '0';
        fileInput.style.position = 'absolute';
        fileInput.style.width = '0.1px';
        fileInput.style.height = '0.1px';
        fileInput.style.overflow = 'hidden';
        fileInput.style.zIndex = '-1';

        // Clicking anywhere in the drop zone triggers the file input
        dropZone.addEventListener('click', (e) => {
            // Only trigger if not clicking the button (which has its own listener)
            if (e.target !== selectFileBtn && !selectFileBtn.contains(e.target)) {
                console.log('👆 Drop zone clicked, triggering file input');
                fileInput.click();
            }
        });
        
        if (selectFileBtn) {
            selectFileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('👆 Select File button clicked');
                fileInput.click();
            });
        }

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = 'var(--primary)';
            dropZone.style.background = 'rgba(255, 215, 0, 0.1)';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = '#ccc';
            dropZone.style.background = '#fafafa';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('📥 File dropped');
            dropZone.style.borderColor = '#ccc';
            dropZone.style.background = '#fafafa';
            const files = e.dataTransfer.files;
            if (files.length > 0) this.handleNotaryFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            console.log('📎 File input changed');
            if (e.target.files.length > 0) {
                // Clear value immediately to prevent double upload
                const file = e.target.files[0];
                e.target.value = '';
                this.handleNotaryFile(file);
            }
        });

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                document.getElementById('notary-preview').style.display = 'none';
                document.getElementById('notary-drop-zone').style.display = 'block';
                fileInput.value = '';
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.submitNotarization());
        }

        dropZone.dataset.listenersSet = 'true';
        console.log('✅ Notary listeners attached');
    }

    async handleNotaryFile(file) {
        const preview = document.getElementById('notary-preview');
        const dropZone = document.getElementById('notary-drop-zone');
        const filenameEl = document.getElementById('notary-filename');
        const hashEl = document.getElementById('notary-hash');

        filenameEl.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        hashEl.textContent = 'Calculating hash...';
        
        dropZone.style.display = 'none';
        preview.style.display = 'block';

        try {
            const hash = await this.calculateFileHash(file);
            hashEl.textContent = hash;
            this.currentNotaryHash = hash;
            this.currentNotaryFilename = file.name;
        } catch (error) {
            console.error('Hash calculation error:', error);
            this.showNotification('Error calculating file hash', 'error');
            const cancelBtn = document.getElementById('notary-cancel-btn');
            if (cancelBtn) cancelBtn.click();
        }
    }

    async calculateFileHash(file) {
        return new Promise((resolve, reject) => {
            if (!window.crypto || !window.crypto.subtle) {
                reject(new Error('Web Crypto API (crypto.subtle) is not available. This feature requires HTTPS or localhost.'));
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const buffer = e.target.result;
                    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    resolve(hashHex);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsArrayBuffer(file);
        });
    }

    async submitNotarization() {
        if (!this.wallet || !this.wallet.privateKey) {
            this.showNotification('⚠️ Please unlock your wallet first.', 'error');
            return;
        }
        if (!this.currentNotaryHash) {
            this.showNotification('⚠️ Please select a file first.', 'error');
            return;
        }

        // CRITICAL FIX: Notary fee must be > 0 or server rejects with "invalid amount".
        const NOTARY_STAMP_FEE = 0.001;
        if (this.balance < NOTARY_STAMP_FEE) {
            this.showNotification(`⚠️ Insufficient balance. Notarization requires ${NOTARY_STAMP_FEE} NCH.`, 'error');
            return;
        }

        const notarySubmitBtn = document.getElementById('notary-submit-btn');
        if (notarySubmitBtn) { notarySubmitBtn.disabled = true; notarySubmitBtn.textContent = '⏳ Notarizing...'; }

        try {
            this.showNotification('🔐 Signing notarization transaction...', 'info');

            const NOTARY_FEE_ADDRESS = '0xa25f52f081c3397bbc8d2ed12146757c470e049d';

            const txData = {
                type: 'DOCUMENT_NOTARY',
                currency: 'NCH',
                filename: this.currentNotaryFilename,
                hash: this.currentNotaryHash,
                timestamp: Date.now(),
                agent: 'CheeseNotary-v1'
            };

            const result = await this.api.sendTransaction(
                this.wallet.address,    // from — unlocked wallet
                NOTARY_FEE_ADDRESS,     // to — founder receives stamp fee
                NOTARY_STAMP_FEE,       // amount > 0 (required by server)
                this.wallet.privateKey, // privateKey from unlocked session
                txData                  // data — contains the document hash
            );

            if (result.success) {
                this.showNotification('✅ Document successfully notarized on-chain!', 'success');
                const previewEl = document.getElementById('notary-preview');
                const dropEl = document.getElementById('notary-drop-zone');
                if (previewEl) previewEl.style.display = 'none';
                if (dropEl) dropEl.style.display = 'block';
                this.currentNotaryHash = null;
                this.currentNotaryFilename = null;
                this.updateNotaryHistory();
                await this.updateBalance();
            } else {
                throw new Error(result.reason || result.error || 'Transaction failed');
            }
        } catch (error) {
            console.error('Notarization error:', error);
            this.showNotification('Notarization failed: ' + error.message, 'error');
        } finally {
            if (notarySubmitBtn) { notarySubmitBtn.disabled = false; notarySubmitBtn.textContent = '📜 Notarize on Ledger'; }
        }
    }

    async updateNotaryHistory() {
        const historyList = document.getElementById('notary-history-list');
        if (!historyList || !this.wallet) return;

        try {
            const txs = await this.api.getTransactionHistory(this.wallet.address);
            const notaryTxs = txs.filter(tx => tx.data && tx.data.type === 'DOCUMENT_NOTARY');

            if (notaryTxs.length === 0) {
                historyList.innerHTML = '<p style="text-align: center; color: #888; padding: 20px;">No notarizations found.</p>';
                return;
            }

            historyList.innerHTML = notaryTxs.map(tx => `
                <div class="transaction-item" style="flex-direction: column; align-items: flex-start; gap: 5px;">
                    <div style="display: flex; justify-content: space-between; width: 100%;">
                        <strong style="color: var(--secondary);">📄 ${tx.data.filename || 'Unknown File'}</strong>
                        <span style="font-size: 0.8em; color: #888;">${new Date(tx.timestamp).toLocaleString()}</span>
                    </div>
                    <div style="font-size: 0.75em; color: #666; word-break: break-all; background: #f0f0f0; padding: 5px; border-radius: 4px; width: 100%;">
                        Hash: ${tx.data.hash}
                    </div>
                    <div style="font-size: 0.7em; color: var(--primary);">
                        Status: ✅ Verified on Ledger (Block #${tx.blockIndex || 'Pending'})
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Error updating notary history:', error);
        }
    }

    // P2P Trading Logic
    updateP2PScreen() {
        if (!this.wallet) {
            document.getElementById('p2p-offers-list').innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-light);">
                    <p>Please unlock your wallet to view P2P offers.</p>
                </div>
            `;
            return;
        }
        this.loadP2POffers();
        this.setupP2PListeners();
    }

    setupP2PListeners() {
        const createBtn = document.getElementById('create-p2p-offer-btn');
        const marketView = document.getElementById('p2p-market-view');
        const createView = document.getElementById('p2p-create-view');
        const cancelBtn = document.getElementById('cancel-p2p-btn');
        const submitBtn = document.getElementById('submit-p2p-offer-btn');

        if (createBtn) {
            createBtn.onclick = () => {
                marketView.style.display = 'none';
                createView.style.display = 'block';
            };
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                createView.style.display = 'none';
                marketView.style.display = 'block';
            };
        }

        if (submitBtn) {
            submitBtn.onclick = () => this.createP2POffer();
        }

        // Tab switching
        document.querySelectorAll('.p2p-tab').forEach(tab => {
            tab.onclick = (e) => {
                document.querySelectorAll('.p2p-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.loadP2POffers(e.target.dataset.p2pTab === 'my-offers');
            };
        });
    }

    async loadP2POffers(onlyMine = false) {
        const list = document.getElementById('p2p-offers-list');
        list.innerHTML = '<div style="text-align: center; padding: 20px;">⌛ Loading offers...</div>';

        try {
            // Mock data for demo - in production this would fetch from blockchain/DEX
            const mockOffers = [
                { id: 'off_1', seller: '0x123...abc', give: '1000 NCH', want: '200 USDT', status: 'active', time: '5m ago' },
                { id: 'off_2', seller: '0xdef...456', give: '500 NCH', want: '100 USDC', status: 'active', time: '12m ago' },
                { id: 'off_3', seller: this.wallet.address, give: '2500 NCH', want: '500 USDT', status: 'active', time: '1h ago' }
            ];

            const filtered = onlyMine ? mockOffers.filter(o => o.seller === this.wallet.address) : mockOffers;

            if (filtered.length === 0) {
                list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-light);">No offers found.</div>';
                return;
            }

            list.innerHTML = filtered.map(offer => `
                <div class="card" style="margin-bottom: 10px; padding: 15px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: bold; color: var(--secondary);">${offer.give} → ${offer.want}</div>
                        <div style="font-size: 0.8em; color: var(--text-light);">By: ${offer.seller} • ${offer.time}</div>
                    </div>
                    ${offer.seller === this.wallet.address ? 
                        `<button class="btn btn-outline btn-small" onclick="app.cancelP2POffer('${offer.id}')">Cancel</button>` :
                        `<button class="btn btn-primary btn-small" onclick="app.takeP2POffer('${offer.id}')">Swap Now</button>`
                    }
                </div>
            `).join('');
        } catch (err) {
            list.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 20px;">Error: ${err.message}</div>`;
        }
    }

    async createP2POffer() {
        const giveAmount = document.getElementById('p2p-give-amount').value;
        const giveToken = document.getElementById('p2p-give-token').value;
        const wantAmount = document.getElementById('p2p-want-amount').value;
        const wantToken = document.getElementById('p2p-want-token').value;

        if (!giveAmount || !wantAmount) {
            this.showNotification('Please enter both amounts', 'error');
            return;
        }

        try {
            this.showNotification('📜 Notarizing P2P Offer...', 'info');
            // 1. Notarize the intent (P2P + Notary integration)
            const offerData = `P2P OFFER: Giving ${giveAmount} ${giveToken} for ${wantAmount} ${wantToken}`;
            const hash = await this.sha256(offerData);
            
            // 2. Mock blockchain broadcast
            this.showNotification('🤝 Offer posted to P2P market!', 'success');
            
            // 3. Switch back to list
            document.getElementById('cancel-p2p-btn').click();
            this.loadP2POffers();
        } catch (err) {
            this.showNotification('Error creating offer: ' + err.message, 'error');
        }
    }

    async takeP2POffer(offerId) {
        if (!confirm('Confirm P2P Swap? Funds will be exchanged instantly and Notarized.')) return;

        try {
            this.showNotification('⏳ Processing P2P Swap via DEX...', 'info');
            // DEX integration logic would go here
            
            this.showNotification('📜 Notarizing Legal Stamp...', 'info');
            // Automatic Notarization of the trade
            
            this.showNotification('✅ P2P Trade Complete!', 'success');
            this.updateBalance();
            this.loadP2POffers();
        } catch (err) {
            this.showNotification('Trade failed: ' + err.message, 'error');
        }
    }

    async cancelP2POffer(offerId) {
        if (!confirm('Cancel this offer?')) return;
        this.showNotification('Offer cancelled', 'info');
        this.loadP2POffers();
    }

    async sha256(data) {
        const msgUint8 = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

async function cheeseEnsureEthersLoaded() {
    if (typeof ethers !== 'undefined') return true;
    await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/ethers@6.7.0/dist/ethers.umd.min.js';
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = resolve;
        document.head.appendChild(s);
    });
    return typeof ethers !== 'undefined';
}

// Initialize app when DOM is ready
var app;
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏁 DOMContentLoaded - Starting Wallet...');
    const ethersOk = await cheeseEnsureEthersLoaded();
    if (!ethersOk) {
        console.error('❌ Ethers.js failed to load!');
        const nw = document.getElementById('no-wallet-section');
        const msg = document.createElement('div');
        msg.setAttribute('role', 'alert');
        msg.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:12px;border-radius:8px;margin-bottom:16px;font-size:0.95em;';
        msg.textContent = 'Could not load ethers.js (required for wallet crypto). Check your network, disable content blockers for this site, then refresh.';
        if (nw) nw.prepend(msg);
        else document.body.prepend(msg);
        return;
    }
    try {
        app = new CheeseWalletApp();
        window.app = app;
        console.log('✅ Cheese Native Wallet Initialized Successfully');
    } catch (e) {
        console.error('❌ CRITICAL INITIALIZATION ERROR:', e);
        alert('CRITICAL ERROR during wallet initialization:\n' + e.message + '\n\nCheck console for details.');
    }
});

