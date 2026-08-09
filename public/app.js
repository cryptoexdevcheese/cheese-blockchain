// CHEESE Wallet App Core
// Manages UI, wallet interactions, and state

// --- DEBUG LOGGING SYSTEM ---
const debugLogs = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function captureLog(type, args) {
    try {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        const logLine = `[${new Date().toLocaleTimeString()}] [${type}] ${msg}`;
        debugLogs.push(logLine);
        if (debugLogs.length > 500) debugLogs.shift();
    } catch (e) { }
}

console.log = function (...args) {
    captureLog('INFO', args);
    originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
    captureLog('ERROR', args);
    originalConsoleError.apply(console, args);
};

console.warn = function (...args) {
    captureLog('WARN', args);
    originalConsoleWarn.apply(console, args);
};

// Expose for UI
window.getDebugLogs = () => debugLogs.join('\n');

// Global Error Handler
window.onerror = function (message, source, lineno, colno, error) {
    console.error('🔥 Global Error:', message, 'at', source, lineno, ':', colno);
    // Don't alert for common network errors or passive ones
    if (message.includes('Script error.') || message.includes('ResizeObserver')) return false;

    // Show alert for critical app errors to help debugging
    if (source && (source.includes('app.js') || source.includes('wallet-') || source.includes('blockchain-api'))) {
        alert('🧀 Wallet Error:\n' + message + '\n\nFile: ' + source.split('/').pop() + '\nLine: ' + lineno);
    }
    return false;
};
// ----------------------------

const APP_VERSION = '1.1.4';
const API_BASE_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';

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
        // MINING REMOVED
        // this.mobileMiner = new MobileMiner(this.api, this.walletCore);

        // Multi-chain support - BSC, Ethereum, Polygon
        this.multiChain = typeof MultiChainProvider !== 'undefined' ? new MultiChainProvider() : null;
        this.multiChainBalances = {}; // Store balances from all networks

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

        // Cleanup flag
        this.isDestroyed = false;

        // Initialize app
        this.init();

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            // CRITICAL: Stop mining before page unload to prevent refresh exploits
            // Mining cleanup removed
            // if (this.mobileMiner && this.mobileMiner.isMining) {
            //    this.mobileMiner.stopMining();
            // }
            this.cleanup();
        });

        // Also handle page visibility change (tab switch, minimize, etc.)
        document.addEventListener('visibilitychange', () => {
            /* Mining logic removed 
              if (document.hidden && this.mobileMiner && this.mobileMiner.isMining) {
                  // Don't stop mining on tab switch, but log it
                  console.log('Page hidden, mining continues in background');
              } else */
            if (!document.hidden && this.wallet && this.wallet.address) {
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

        console.log('🚀 CheeseWalletApp constructor finished');
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
        // 1. SETUP UI LISTENERS FIRST - CRITICAL FOR RESPONSIVENESS
        // This ensures buttons work immediately, even if backend is slow
        try {
            this.setupEventListeners();
            console.log('✅ UI Event Listeners attached immediately');
        } catch (e) {
            console.error('❌ Failed to attach event listeners:', e);
        }

        // 2. RESTORE CACHE (Sync, fast)
        this.restoreQRCodeCache();

        // 3. INITIALIZE COMPONENTS (Non-blocking wrappers)

        // Founder wallet
        this.initializeFounderWallet();

        // Components
        if (typeof MetaMaskStyleWallet !== 'undefined') this.metaMaskStyle = new MetaMaskStyleWallet(this);
        if (typeof TokenSearch !== 'undefined') {
            this.tokenSearch = new TokenSearch(this.api);
            // Clear old price cache async
            setTimeout(() => this.clearOldPriceCache(), 0);
        }
        if (typeof BiometricAuth !== 'undefined') this.biometricAuth = new BiometricAuth();
        if (typeof CrossChainBalance !== 'undefined') this.crossChainBalance = new CrossChainBalance();

        // 4. CHECK WALLET STATUS (Async - don't block UI)
        setTimeout(async () => {
            const hasWallet = this.checkForExistingWallet();

            if (hasWallet) {
                try {
                    const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
                    if (walletData && walletData.address) {
                        this._walletAddress = walletData.address;
                        console.log('✅ Wallet found in storage:', walletData.address);
                    }
                    this.showLoginScreen();
                } catch (error) {
                    console.error('Error checking wallet on init:', error);
                    this.showNoWalletScreen();
                }
            } else {
                this.showNoWalletScreen();
            }

            // 5. UPDATE UI STATE
            this.updateUI();
        }, 10);

        // 6. START BACKGROUND TASKS
        this.updateNetworkStatus(); // First check

        setInterval(() => this.updateNetworkStatus(), 30000);

        // Balance Sync
        setInterval(() => {
            const balanceEl = document.getElementById('balance');
            if (balanceEl && this.balance !== undefined && this.balance !== null && !isNaN(this.balance)) {
                const currentDisplay = balanceEl.textContent;
                const expectedDisplay = this.balance.toFixed(2);
                if (currentDisplay !== expectedDisplay) {
                    balanceEl.textContent = expectedDisplay;
                }
            }
        }, 2000);

        // Auto-refresh validation
        if (this.wallet && this.wallet.privateKey) {
            this.startAutoRefresh();
            setTimeout(() => this.checkBackupStatus(), 5000);
        }
    }

    clearOldPriceCache() {
        try {
            const cached = localStorage.getItem('cheeseTokenPrices');
            if (cached) {
                const prices = JSON.parse(cached);
                if (prices['NCHEESE'] && prices['NCHEESE'] !== 0.022) {
                    prices['NCHEESE'] = 0.022;
                    localStorage.setItem('cheeseTokenPrices', JSON.stringify(prices));
                }
            }
        } catch (e) { console.error(e); }
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
                        await this.updatePortfolioScreen();
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

    // Check if wallet exists in localStorage
    checkForExistingWallet() {
        try {
            const walletData = localStorage.getItem('cheeseWallet');
            if (walletData) {
                const data = JSON.parse(walletData);
                return data && data.address;
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

            // CRITICAL DEX FIX: Allow other tabs (DEX) to access the unlocked key
            // This is cleared on "Log Out" / "Lock"
            if (this.wallet && this.wallet.privateKey) {
                console.log('🔓 Saving temps key for DEX access...');
                localStorage.setItem('cheese_temp_key', this.wallet.privateKey);
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

            // SAVE SESSION KEY FOR DEX (Shared Local Storage for Cross-Tab Access)
            if (this.wallet && this.wallet.privateKey) {
                localStorage.setItem('cheese_temp_key', this.wallet.privateKey);
            }

            this.showNotification('✅ Wallet unlocked successfully!', 'success');
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
    logoutWallet(isStrictLogout = false) {
        // Clear session key for security
        localStorage.removeItem('cheese_temp_key');

        // Clear wallet from memory
        this.wallet = null;
        this.balance = 0;
        this.transactions = [];

        // Stop auto-refresh
        this.stopAutoRefresh();

        // Clear UI Data strictly
        this.clearWalletView();

        // Clear password input
        const passwordInput = document.getElementById('login-password');
        if (passwordInput) passwordInput.value = '';

        // Show appropriate screen
        if (isStrictLogout) {
            // Strict Logout: Could go to "No Wallet" or just Login
            // For now, we go to Login but ensure Dashboard is HIDDEN
            this.showLoginScreen();
            this.showNotification('🚪 Logged out successfully.', 'info');
        } else {
            // Lock: Just show Login
            this.showLoginScreen();
            this.showNotification('🔒 Wallet locked. Enter password to unlock.', 'info');
        }

        // Ensure UI is updated and Dashboard HIDDEN
        const walletSection = document.getElementById('wallet-section');
        if (walletSection) walletSection.style.display = 'none';

        this.updateUI();
    }

    // Helper to clear sensitive data from view
    clearWalletView() {
        const balanceEl = document.getElementById('balance');
        if (balanceEl) balanceEl.textContent = '---';

        const txList = document.getElementById('transactions-list');
        if (txList) txList.innerHTML = '';

        // Hide wallet section immediately
        const walletSection = document.getElementById('wallet-section');
        if (walletSection) walletSection.style.display = 'none';
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
        console.log('🚀 createWallet started', { useMnemonic });

        // Show "loading" state if possible
        this.showNotification('⏳ Generating secure wallet...', 'info');

        try {
            let walletData;
            console.log('🛠️ Component check:', {
                api: !!this.api,
                walletCore: !!this.walletCore,
                security: !!this.security
            });

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
                console.log('📝 Generated mnemonic:', mnemonic);

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
        // SECURITY FIX: Do NOT load data if wallet is locked/null
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
    async updateBalance() {
        // CRITICAL DEBUG: Log entry point
        // console.log('🔴 DEBUG: updateBalance() CALLED');

        // SECURITY FIX: Abort immediately if wallet is locked/null to prevent Dashboard ghosting
        if (!this.wallet || !this.wallet.address) {
            // console.warn('⚠️ updateBalance aborted: Wallet is locked/null');
            return;
        }

        // CRITICAL: Balance fetching only needs address, not privateKey
        // PrivateKey is only needed for signing transactions, not for reading balance
        if (this.wallet && this.wallet.address) {
            try {
                console.log('🔄 Fetching balance for address:', this.wallet.address);

                // STEP 1: Always get the primary NCHEESE balance from the dedicated endpoint
                // This is the most reliable source of truth and prevents portfolio glitches from zeroing balance
                const rawBalance = await this.api.getBalance(this.wallet.address);
                console.log('💰 Primary Balance Fetched via getBalance:', rawBalance);

                let balance = rawBalance;
                // Initialize default portfolio with reliable balance
                let portfolio = { 'NCHEESE': rawBalance, 'NCH': rawBalance };

                // STEP 2: Fetch portfolio for OTHER assets (USDT, USDC, etc.)
                if (this.api && typeof this.api.getPortfolio === 'function') {
                    console.log('📊 Fetching full portfolio...');
                    try {
                        const fetchedPortfolio = await this.api.getPortfolio(this.wallet.address);

                        // CRITICAL FIX: Merge with existing portfolio to prevent asset disappearance
                        // if the API temporarily returns a partial list
                        const mergedPortfolio = {
                            ...(this.portfolio || {}),
                            ...fetchedPortfolio,
                            'NCHEESE': rawBalance,
                            'NCH': rawBalance
                        };

                        // SAFE PORTFOLIO UPDATE: Prevent zeroing out USDT/USDC due to API glitches
                        // Similar to the NCH balance protection below
                        const assetsToProtect = ['USDT', 'USDC', 'NCHEESE', 'NCH'];
                        assetsToProtect.forEach(asset => {
                            const newVal = parseFloat(mergedPortfolio[asset]) || 0;
                            const oldVal = parseFloat(this.portfolio?.[asset]) || 0;

                            if (newVal === 0 && oldVal > 0) {
                                // Check for recent outgoing transaction for THIS specific currency
                                const hasRecentOutgoing = this.transactions && this.transactions.some(tx =>
                                    (tx.from || '').toLowerCase() === this.wallet.address.toLowerCase() &&
                                    ((tx.currency || 'NCH').toUpperCase() === asset) &&
                                    (Date.now() - new Date(tx.timestamp).getTime() < 60000)
                                );

                                if (!hasRecentOutgoing) {
                                    console.warn(`⚠️ IGNORED suspicious ${asset} drop to 0 in updateBalance. Preserving old balance: ${oldVal}`);
                                    mergedPortfolio[asset] = oldVal;
                                }
                            }
                        });

                        this.portfolio = mergedPortfolio;

                        // Also check for USDT/USDC in simple balance response if structured differently
                        if (this.portfolio.USDT) console.log('✅ Portfolio has USDT:', this.portfolio.USDT);
                        if (this.portfolio.USDC) console.log('✅ Portfolio has USDC:', this.portfolio.USDC);
                    } catch (pError) {
                        console.warn('⚠️ Portfolio fetch failed, using basic balance:', pError);
                        // Use basic portfolio created above if we don't have one yet
                        if (!this.portfolio) this.portfolio = portfolio;
                    }
                } else {
                    // Fallback to simple balance
                    this.portfolio = portfolio;
                }

                console.log('💰 Balance updated:', balance);

                // Check types and parse if needed
                let newBalance = 0;
                if (typeof balance === 'number' && !isNaN(balance)) {
                    newBalance = balance;
                } else {
                    newBalance = parseFloat(balance) || 0;
                }

                // SAFE BALANCE UPDATE: Prevent zeroing out balance due to API glitches during auto-refresh
                // If we have a verified positive balance, and the new balance is 0,
                // and we haven't sent any transactions recently, assume it's a glitch and ignore it.
                let shouldUpdate = true;
                if (newBalance === 0 && this.balance > 0) {
                    // Check if we have a recent outgoing transaction (last 1 minute)
                    const hasRecentOutgoing = this.transactions && this.transactions.some(tx =>
                        (tx.from || '').toLowerCase() === this.wallet.address.toLowerCase() &&
                        (Date.now() - new Date(tx.timestamp).getTime() < 60000)
                    );

                    if (!hasRecentOutgoing) {
                        console.warn(`⚠️ IGNORED suspicious balance drop from ${this.balance} to 0. Preserving old balance.`);
                        shouldUpdate = false;
                    }
                }

                if (shouldUpdate) {
                    this.balance = newBalance;
                }

                // Cleaned up logic

                // CRITICAL: Ensure wallet-section is visible BEFORE trying to update display
                const walletSection = document.getElementById('wallet-section');
                // SECURITY FIX: Only show wallet section if wallet is ACTUALLY unlocked
                if (walletSection && walletSection.style.display === 'none' && this.wallet) {
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

                // Update USD estimate
                const usdEstimate = this.balance * 1.0; // Placeholder - would use real price API
                const usdEl = document.getElementById('balance-usd');
                if (usdEl && this.enhancements) {
                    usdEl.textContent = `≈ ${this.enhancements.formatCurrency(usdEstimate)}`;
                } else if (usdEl) {
                    usdEl.textContent = `≈ $${usdEstimate.toFixed(2)}`;
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
        // FIRST: Actually update the balance text
        const balanceEl = document.getElementById('balance');
        if (balanceEl && this.balance !== undefined && this.balance !== null && !isNaN(this.balance)) {
            balanceEl.textContent = this.balance.toFixed(2);
            console.log('✅ Balance display updated:', this.balance.toFixed(2), 'NCH');
        }
        // LEGACY WALLET WARNING SYSTEM PERMANENTLY REMOVED - DO NOT ADD BACK
    }

    // Recover Legacy Assets Logic
    async migrateAssets(sourceBtn = null) {
        if (!confirm("⚠️ This will scan the BSC blockchain for your locked BNB/USDT and credit them to your new CHEESE wallet.\n\nThis process is irreversible. Continue?")) return;

        // Use passed button or find the warning button
        const btn = sourceBtn || document.querySelector('#legacy-warning button');
        const originalText = btn ? btn.textContent : "Recover";

        if (btn) {
            btn.disabled = true;
            btn.textContent = "⏳ Scanning BSC Network... (Please Wait)";
        }

        try {
            if (!this.wallet || !this.wallet.privateKey) {
                throw new Error("Wallet not unlocked.");
            }

            const result = await this.api.recoverLegacyAssets(this.wallet.privateKey);

            if (result.success) {
                alert("✅ RECOVERY SUCCESSFUL!\n\n" + result.message + "\n\nYour wallet balance will update now.");
                window.location.reload();
            } else {
                throw new Error(result.error || result.message || "Unknown error");
            }
        } catch (e) {
            console.error(e);
            alert("❌ Recovery Failed: " + e.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }



    // NEW: Debug Console UI
    showDebugConsole() {
        const logs = window.getDebugLogs();
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:99999;display:flex;flex-direction:column;padding:20px;box-sizing:border-box;font-family:monospace;';

        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <h3 style="color:#ffd700;margin:0;">🐛 Debug Console</h3>
                <button id="close-debug-btn" class="btn btn-secondary" style="padding:5px 15px;">Close</button>
            </div>
            <textarea id="debug-log-area" readonly style="flex:1;background:#111;color:#0f0;border:1px solid #333;padding:10px;font-size:12px;white-space:pre-wrap;">${logs}</textarea>
            <div style="margin-top:10px;">
                <button id="copy-logs-btn" class="btn btn-primary" style="width:100%;">📋 Copy Logs to Clipboard</button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('close-debug-btn').onclick = () => modal.remove();
        document.getElementById('copy-logs-btn').onclick = () => {
            const textArea = document.getElementById('debug-log-area');
            textArea.select();
            document.execCommand('copy');
            alert('Logs copied! Please paste them into the chat.');
        };
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
            const privateKey = this.wallet.privateKey || walletData.privateKey || walletData.encryptedPrivateKey;

            if (!privateKey) {
                throw new Error('Private key not available');
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
                const feeMsg = result.fee > 0 ? ` (Fee: ${result.fee.toFixed(4)} NCHEESE)` : '';
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
            const walletData = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
            const privateKey = walletData.privateKey || walletData.encryptedPrivateKey;

            // Show loading notification
            this.showNotification('🔄 Processing swap via DEX...', 'info');

            let result;

            // Prefer DEX API swap for NCH/CHEESE/USDT pairs
            const dexTokens = ['NCH', 'NCHEESE', 'CHEESE', 'USDT'];
            const useDEX = dexTokens.includes(fromToken) && dexTokens.includes(toToken);

            if (useDEX && this.swapEngine.isDEXConnected && this.swapEngine.isDEXConnected()) {
                // Use DEX API for swap
                console.log('🔗 Using DEX API for swap');
                result = await this.swapEngine.executeSwapViaDEX(
                    fromToken,
                    toToken,
                    fromAmount,
                    this.wallet.address
                );
            } else {
                // Fallback to local swap engine
                console.log('⚙️ Using local swap engine');
                result = await this.swapEngine.executeSwap(
                    fromAmount,
                    fromToken,
                    toToken,
                    this.wallet.address,
                    privateKey
                );
            }

            if (result.success) {
                // CRITICAL: For cross-chain swaps (NCHEESE → CHEESE), update BSC balance
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
                    this.showNotification('✅ Swap completed!', 'success');
                    await this.updateBalance();
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
                const reward = block.miningReward || block.reward || 50;
                this.showNotification('✅ Block mined! Reward: ' + reward + ' NCHEESE', 'success');
                await this.updateBalance();
                return result;
            } else if (result.error) {
                throw new Error(result.error);
            } else if (result.hash || result.index !== undefined) {
                // If response is a block directly
                const reward = result.miningReward || result.reward || 1;
                this.showNotification('✅ Block mined! Reward: ' + reward + ' NCHEESE', 'success');
                await this.updateBalance();
                return { success: true, block: result };
            } else {
                // Try to extract block from response
                console.warn('Unexpected mining response format:', result);
                const reward = 100; // Default reward
                this.showNotification('✅ Block mined! Reward: ' + reward + ' NCHEESE', 'success');
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
        if (!this.wallet) {
            throw new Error('No wallet loaded');
        }

        try {
            const walletData = this.safeJSONParse(this.safeGetItem('cheeseWallet'), {});
            if (!walletData || !walletData.address) {
                throw new Error('Wallet not found or invalid');
            }

            // Resolve the actual private key (decrypt if needed)
            let privateKey = this.wallet.privateKey || walletData.privateKey;
            if (!privateKey && walletData.encryptedPrivateKey) {
                const password = prompt('Enter your wallet password to authorize the bridge:');
                if (!password) {
                    throw new Error('Password required to bridge tokens');
                }
                try {
                    privateKey = await this.walletCore.decryptPrivateKey(walletData.encryptedPrivateKey, password);
                } catch (e) {
                    throw new Error('Private key not available or incorrect password');
                }
            }

            if (!privateKey) {
                throw new Error('Private key not available');
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
                    <div class="bridge-amount">${bridge.amount} NCHEESE</div>
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
        if (statAmount) statAmount.textContent = stats.totalBridged.toFixed(2) + ' NCHEESE';
        if (statFees) statFees.textContent = stats.totalFees.toFixed(2) + ' NCHEESE';
    }

    // Setup event listeners with defensive programming
    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');
        let successCount = 0;
        let failCount = 0;

        const safeAddListener = (id, event, handler) => {
            try {
                // Handle both ID strings and direct elements
                const el = typeof id === 'string' ? document.getElementById(id) : id;
                if (el) {
                    el.addEventListener(event, (e) => {
                        console.log(`🖱️ Clicked: ${typeof id === 'string' ? id : el.className}`);
                        handler(e);
                    });
                    successCount++;
                    // console.log(`✅ Listener added to ${id}`);
                } else {
                    // console.warn(`⚠️ Element not found: ${id}`);
                    failCount++;
                }
            } catch (err) {
                console.error(`❌ Error adding listener to ${id}:`, err);
                failCount++;
            }
        };

        // Navigation (Class based)
        const navBtns = document.querySelectorAll('.nav-btn');
        if (navBtns.length > 0) {
            navBtns.forEach(btn => {
                safeAddListener(btn, 'click', (e) => {
                    const screen = e.target.getAttribute('data-screen') || e.target.parentElement.getAttribute('data-screen'); // Handle icon clicks
                    console.log('Navigating to:', screen);
                    if (screen) this.showScreen(screen);
                });
            });
            console.log(`✅ Added listeners to ${navBtns.length} nav buttons`);
        } else {
            console.warn('⚠️ No nav buttons found');
        }

        // Wallet Action Buttons
        safeAddListener('copy-address-btn', 'click', () => this.copyAddress());
        safeAddListener('share-address-btn', 'click', () => this.shareAddress());
        safeAddListener('qr-address-btn', 'click', () => this.showQRCode());
        safeAddListener('receive-btn', 'click', () => this.showQRCode());

        // Critical: Login Buttons
        safeAddListener('login-btn', 'click', async () => {
            console.log('🔓 Login button clicked');
            const passwordInput = document.getElementById('login-password');
            const password = passwordInput ? passwordInput.value : null;
            await this.loginWallet(password || null);
        });

        // Duplicate import listener removed
        // safeAddListener('import-wallet-btn', 'click', () => { ... });

        safeAddListener('cancel-login-btn', 'click', () => {
            this.showNoWalletScreen();
            const passwordInput = document.getElementById('login-password');
            if (passwordInput) passwordInput.value = '';
        });

        // Dashboard Actions
        safeAddListener('send-btn', 'click', () => this.showSendModal());
        safeAddListener('buy-btn', 'click', () => this.showBuyModal());
        safeAddListener('sell-btn', 'click', () => this.showScreen('sell'));
        safeAddListener('swap-btn', 'click', () => this.showScreen('swap'));
        safeAddListener('bridge-btn', 'click', () => this.showScreen('bridge')); // Add bridge button listener if exists

        // Social & Raid Utility
        safeAddListener('verify-social-btn', 'click', () => {
            console.log('🔱 Social Identity Verification Triggered');
            this.verifySocialIdentity();
        });

        // Settings Actions
        safeAddListener('import-wallet-settings-btn', 'click', () => {
            console.log('🔘 Import Wallet button clicked (Settings)');
            this.setupImport('privateKey'); // Default to private key
        });

        // Network Selector
        const networkSelector = document.getElementById('network-selector');
        if (networkSelector) {
            networkSelector.addEventListener('change', (e) => {
                this.currentNetwork = e.target.value;
                this.updateNetworkDisplay();
                this.showNotification(`🌐 Switched to ${e.target.options[e.target.selectedIndex].text}`, 'info');
            });
            successCount++;
        }

        console.log(`✅ Event Setup Complete: ${successCount} attached, ${failCount} missing elements.`);

        // Expose debug helper
        window.debugUI = () => {
            console.log('🔍 -- UI DEBUGGER --');
            console.log('App state:', this);
            console.log('Current Screen:', this.currentScreen);
            console.log('Body classes:', document.body.className);
            const overlay = document.querySelector('div[style*="z-index: 9999"]');
            console.log('Potential blocking overlays:', overlay);
        };
        // Continued setup...

        // Sell form listeners
        const sellAmountInput = document.getElementById('sell-amount');
        const sellCurrencySelect = document.getElementById('sell-currency');
        const sellSubmitBtn = document.getElementById('sell-submit-btn');

        if (sellAmountInput) {
            sellAmountInput.addEventListener('input', () => {
                this.updateSellPreview();
            });
        }

        if (sellCurrencySelect) {
            sellCurrencySelect.addEventListener('change', () => {
                this.updateSellPreview();
            });
        }

        if (sellSubmitBtn) {
            sellSubmitBtn.addEventListener('click', async () => {
                await this.processSell();
            });
        }

        // Change founder wallet button (removed from public settings - private only)

        // Settings buttons
        const exportBtn = document.getElementById('export-wallet-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportWallet();
            });
        }

        // View seed phrase button
        const viewSeedPhraseBtn = document.getElementById('view-seed-phrase-btn');
        if (viewSeedPhraseBtn) {
            viewSeedPhraseBtn.addEventListener('click', async () => {
                try {
                    const hasMnemonic = await this.checkMnemonicBackupStatus();
                    if (!hasMnemonic) {
                        this.showNotification('⚠️ This wallet was not created with a seed phrase (e.g., imported via private key).', 'info');
                        return;
                    }
                    await this.showSeedPhraseModal(null, false);
                } catch (error) {
                    this.showNotification('❌ Failed to view seed phrase: ' + error.message, 'error');
                }
            });
        }

        // View Private Key button
        const viewPrivateKeyBtn = document.getElementById('view-private-key-btn');
        if (viewPrivateKeyBtn) {
            viewPrivateKeyBtn.addEventListener('click', async () => {
                const password = prompt('Enter your wallet password to view private key:');
                if (password) {
                    await this.showPrivateKeyModal(password);
                }
            });
        }

        // Export Private Key button (for BSC transactions)
        const exportPrivateKeyBtn = document.getElementById('export-private-key-btn');
        if (exportPrivateKeyBtn) {
            exportPrivateKeyBtn.addEventListener('click', async () => {
                const password = prompt('Enter your wallet password to export private key:');
                if (password) {
                    await this.showPrivateKeyModal(password);
                }
            });
        }

        // Recover Legacy Assets button (BSC Incompatibility Fix)
        const recoverLegacyBtn = document.getElementById('recover-legacy-btn');
        if (recoverLegacyBtn) {
            recoverLegacyBtn.addEventListener('click', () => {
                this.migrateAssets();
            });
        }

        // Debug Export All Data button
        const debugExportBtn = document.getElementById('debug-export-btn');
        if (debugExportBtn) {
            debugExportBtn.addEventListener('click', () => {
                try {
                    const allData = {};
                    Object.keys(localStorage).forEach(key => {
                        // Include all keys
                        try {
                            const val = localStorage.getItem(key);
                            // Try to parse if JSON, otherwise keep strings
                            try {
                                allData[key] = JSON.parse(val);
                            } catch {
                                allData[key] = val;
                            }
                        } catch (e) {
                            allData[key] = 'Error reading';
                        }
                    });

                    const modal = document.createElement('div');
                    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:30000;';
                    modal.innerHTML = `
                        <div style="background:white;padding:20px;border-radius:10px;max-width:90%;max-height:90%;overflow:auto;">
                            <h3>All Wallet Data (Copy This)</h3>
                            <textarea id="debug-data-text" style="width:100%;height:300px;font-family:monospace;font-size:12px;">${JSON.stringify(allData, null, 2)}</textarea>
                            <div style="margin-top:10px;display:flex;gap:10px;">
                                <button onclick="navigator.clipboard.writeText(document.getElementById('debug-data-text').value);alert('Copied!');" class="btn btn-primary">📋 Copy All</button>
                                <button onclick="this.parentElement.parentElement.parentElement.remove();" class="btn btn-secondary">Close</button>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modal);
                } catch (e) {
                    alert('Error: ' + e.message);
                }
            });
        }

        const addWalletSettingsBtn = document.getElementById('add-wallet-settings-btn');
        if (addWalletSettingsBtn) {
            addWalletSettingsBtn.addEventListener('click', () => {
                this.createWallet(null, true); // Create with mnemonic
            });
        }

        const importWalletSettingsBtn = document.getElementById('import-wallet-settings-btn');
        if (importWalletSettingsBtn) {
            importWalletSettingsBtn.addEventListener('click', () => {
                this.importWallet();
            });
        }

        // Duplicate import listener removed
        // safeAddListener('import-wallet-btn', 'click', () => { ... });

        // Add wallet buttons (from no-wallet screen)
        safeAddListener('create-wallet-btn', 'click', () => {
            console.log('🔘 Create New Wallet button clicked');
            this.showCreateWalletModal();
        });

        safeAddListener('import-wallet-btn', 'click', () => {
            console.log('🔘 Import Wallet button clicked (Home)');
            this.importWallet();
        });

        safeAddListener('add-wallet-btn', 'click', () => {
            console.log('🔘 Add Wallet button clicked');
            this.createWallet(null, true); // Create with mnemonic
        });

        // Moved to safeAddListener block

        // Legacy direct listeners removed in favor of safeAddListener above

        const addressBookBtn = document.getElementById('manage-addressbook-btn');
        if (addressBookBtn) {
            addressBookBtn.addEventListener('click', () => {
                this.showAddressBook();
            });
        }

        const portfolioBtn = document.getElementById('view-portfolio-btn');
        if (portfolioBtn) {
            portfolioBtn.addEventListener('click', () => {
                this.showPortfolio();
            });
        }

        // Portfolio price update button
        const portfolioPriceUpdateBtn = document.getElementById('portfolio-price-update-btn');
        if (portfolioPriceUpdateBtn) {
            portfolioPriceUpdateBtn.addEventListener('click', async () => {
                portfolioPriceUpdateBtn.disabled = true;
                portfolioPriceUpdateBtn.textContent = '⏳ Updating...';
                try {
                    // Force refresh prices for all displayed tokens
                    if (this.tokenSearch) {
                        const portfolioContent = document.getElementById('portfolio-content');
                        if (portfolioContent) {
                            const tokenSymbols = Array.from(portfolioContent.querySelectorAll('[data-token-symbol]'))
                                .map(el => el.getAttribute('data-token-symbol'))
                                .filter(s => s); // Include NCHEESE for dynamic updates
                            if (tokenSymbols.length > 0) {
                                console.log('Manually updating prices for:', tokenSymbols);
                                await this.tokenSearch.refreshPrices(tokenSymbols);
                            }
                        }
                    }

                    // Update displayed prices immediately
                    this.updatePortfolioPrices();
                    this.showNotification('✅ Prices updated!', 'success');
                } catch (error) {
                    console.error('Price update error:', error);
                    this.showNotification('❌ Failed to update prices', 'error');
                } finally {
                    portfolioPriceUpdateBtn.disabled = false;
                    portfolioPriceUpdateBtn.textContent = '💰 Update Prices';
                }
            });
        }

        // Portfolio refresh button
        const portfolioRefreshBtn = document.getElementById('portfolio-refresh-btn');
        if (portfolioRefreshBtn) {
            portfolioRefreshBtn.addEventListener('click', async () => {
                portfolioRefreshBtn.disabled = true;
                portfolioRefreshBtn.textContent = '⏳ Refreshing...';
                try {
                    // Force refresh prices
                    if (this.tokenSearch) {
                        const portfolioContent = document.getElementById('portfolio-content');
                        if (portfolioContent) {
                            const tokenSymbols = Array.from(portfolioContent.querySelectorAll('[data-token-symbol]'))
                                .map(el => el.getAttribute('data-token-symbol'))
                                .filter(s => s);
                            if (tokenSymbols.length > 0) {
                                await this.tokenSearch.refreshPrices(tokenSymbols);
                            }
                        }
                    }

                    await this.updatePortfolioScreen();
                    // Update prices immediately after refresh
                    setTimeout(() => {
                        this.updatePortfolioPrices();
                    }, 500);
                    this.showNotification('✅ Portfolio refreshed with latest prices!', 'success');
                } catch (error) {
                    console.error('Portfolio refresh error:', error);
                    this.showNotification('❌ Failed to refresh portfolio', 'error');
                } finally {
                    portfolioRefreshBtn.disabled = false;
                    portfolioRefreshBtn.textContent = '🔄 Refresh';
                }
            });
        }

        // Logout/Lock wallet button
        const logoutBtn = document.getElementById('logout-wallet-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logoutWallet(true); // True = Strict Logout
            });
        }

        // Lock Wallet Button
        const lockBtn = document.getElementById('lock-wallet-btn');
        if (lockBtn) {
            lockBtn.addEventListener('click', () => {
                this.logoutWallet(false); // False = Just Lock
            });
        }



        const deleteBtn = document.getElementById('delete-wallet-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this wallet? This cannot be undone!\n\nMake sure you have your mnemonic seed phrase backed up!')) {
                    this.walletCore.deleteWallet();
                    this.wallet = null;
                    this.showNoWalletScreen();
                    this.updateUI();
                    this.showNotification('Wallet deleted. You can create a new wallet or import an existing one.', 'info');
                }
            });
        }

        // Mining buttons
        const startMiningBtn = document.getElementById('start-mining-btn');
        if (startMiningBtn) {
            startMiningBtn.addEventListener('click', () => {
                this.startMobileMining();
            });
        }

        const stopMiningBtn = document.getElementById('stop-mining-btn');
        if (stopMiningBtn) {
            stopMiningBtn.addEventListener('click', () => {
                this.stopMobileMining();
            });
        }

        // Connect buttons
        const connectDappBtn = document.getElementById('connect-dapp');
        if (connectDappBtn) {
            connectDappBtn.addEventListener('click', () => {
                if (this.connectManager) {
                    this.connectManager.connectDApp();
                }
            });
        }

        const openDebugBtn = document.getElementById('open-debug-console-btn');
        if (openDebugBtn) {
            openDebugBtn.addEventListener('click', () => this.showDebugConsole());
        }
    }

    // Setup bridge listeners (called when bridge screen is shown)
    setupBridgeListeners() {
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

        // Bridge Out button — use onclick to prevent listener stacking on re-navigation
        const bridgeOutBtn = document.getElementById('bridge-out-btn');
        if (bridgeOutBtn) {
            bridgeOutBtn.onclick = async () => {
                const amount = parseFloat(document.getElementById('bridge-amount')?.value);
                const toChain = document.getElementById('bridge-to-chain')?.value;
                const recipientAddress = document.getElementById('bridge-recipient')?.value;

                if (!amount || amount < 10) {
                    this.showNotification('Please enter a valid amount (minimum 10 NCHEESE)', 'error');
                    return;
                }

                if (!toChain) {
                    this.showNotification('Please select a destination chain', 'error');
                    return;
                }

                if (!recipientAddress) {
                    this.showNotification('Please enter recipient address', 'error');
                    return;
                }

                // Disable button immediately to prevent double-clicks
                bridgeOutBtn.disabled = true;
                try {
                    await this.bridgeOut(amount, toChain, recipientAddress);
                } catch (error) {
                    console.error('Bridge out error:', error);
                } finally {
                    bridgeOutBtn.disabled = false;
                }
            };
        }

        // Bridge In button — use onclick to prevent listener stacking on re-navigation
        const bridgeInBtn = document.getElementById('bridge-in-btn');
        if (bridgeInBtn) {
            bridgeInBtn.onclick = async () => {
                const amount = parseFloat(document.getElementById('bridge-in-amount')?.value);
                const fromChain = document.getElementById('bridge-from-chain')?.value;
                const transactionHash = document.getElementById('bridge-source-tx')?.value;
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

                // Disable button immediately to prevent double-clicks
                bridgeInBtn.disabled = true;
                try {
                    await this.bridgeIn(amount, fromChain, transactionHash, recipientAddress);
                } catch (error) {
                    console.error('Bridge in error:', error);
                } finally {
                    bridgeInBtn.disabled = false;
                }
            };
        }

        // Bridge amount input (for preview)
        const bridgeAmountInput = document.getElementById('bridge-amount');
        if (bridgeAmountInput) {
            bridgeAmountInput.addEventListener('input', () => {
                this.updateBridgePreview();
            });
        }
    }

    // Update bridge preview (calculate fees and net amounts)
    updateBridgePreview() {
        const amount = parseFloat(document.getElementById('bridge-amount')?.value || 0);
        if (amount <= 0) {
            document.getElementById('bridge-send-amount').textContent = '0 NCH';
            document.getElementById('bridge-fee').textContent = '0 NCH';
            document.getElementById('bridge-receive-amount').textContent = '0 wNCH';
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
        if (receiveAmountEl) receiveAmountEl.textContent = `${bridgeCalc.netAmount.toFixed(2)} wNCH`;
        if (timeEl) timeEl.textContent = '~10-30 minutes'; // Estimated bridge time
    }

    // Show screen
    async showScreen(screen) {
        this.currentScreen = screen;

        // Hide all screens
        document.querySelectorAll('.screen').forEach(s => {
            s.classList.remove('active');
        });

        // Show selected screen
        const targetScreen = document.getElementById(`${screen}-screen`);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }

        // Update nav
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === screen);
        });

        // Update data if needed
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
        }
    }

    // --- SOCIAL RAIDING & IDENTITY ---
    async verifySocialIdentity() {
        this.showNotification('🔍 Scanning Social Mesh for @cryptoexdevcheese...', 'info');

        // Simulate API check
        setTimeout(() => {
            const btn = document.getElementById('verify-social-btn');
            if (btn) {
                btn.innerHTML = '✅ Identity Linked: cryptoexdevcheese';
                btn.style.borderColor = '#2ecc71';
                btn.style.color = '#2ecc71';
                btn.disabled = true;
            }

            this.showNotification('✅ Universal Social Identity Linked! Social Mining active.', 'success');
            localStorage.setItem('cheese_social_linked', 'true');
            console.log('🔱 Social Mining: Activated for cryptoexdevcheese@gmail.com');
        }, 2000);
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
                    <div>Balance: ${stats.balance.toFixed(2)} NCHEESE</div>
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
                <div class="tx-type">${(tx.from || '').toLowerCase() === this.wallet.address.toLowerCase() ? 'Sent' : 'Received'}</div>
                <div class="tx-amount">${tx.amount} ${tx.currency || 'NCHEESE'}</div>
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
        console.log('🔓 showCreateWalletModal triggered');
        // Simple like MetaMask - just ask for password
        const password = prompt('Create a password to encrypt your wallet:\n\n(Password is required for security)');

        if (password === null) {
            console.log('❌ Password prompt cancelled');
            return;
        }

        if (password.trim() === '') {
            alert('Password is required to secure your wallet');
            this.showNotification('Password is required', 'error');
            return;
        }

        if (password.length < 4) {
            alert('Password must be at least 4 characters for security');
            this.showNotification('Password must be at least 4 characters', 'error');
            return;
        }

        console.log('✅ Password accepted, starting wallet creation...');
        this.createWallet(password, false);
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
            const tokenSymbol = selectedOption.getAttribute('data-symbol') || 'NCHEESE';
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
                    // Native NCHEESE
                    console.log('📤 Sending native NCHEESE transaction...');
                    console.log('📤 Calling this.sendTransaction()...');
                    try {
                        // CRITICAL FIX: Pass token symbol as currency in data object
                        // Use tokenSymbol (e.g., 'USDT', 'USDC') or default to 'NCH' if not set
                        const currency = tokenSymbol || 'NCH';
                        console.log(`📤 Sending with currency: ${currency}`);
                        transactionResult = await this.sendTransaction(toAddress, amount, { currency: currency });
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

        // Always include native NCHEESE (even if balance is 0)
        // CRITICAL FIX: Always set logoURI for NCHEESE (official logo)
        tokens.push({
            address: 'native',
            symbol: 'NCHEESE',
            name: 'NCheese (Native CHEESE)',
            chain: 'cheese-native',
            balance: this.balance || 0,
            decimals: 18,
            logoURI: './icon-192.png' // Official Cheese logo - always embedded
        });

        // CRITICAL FIX: Always include USDT/USDC from portfolio (native stablecoins)
        // These are on CHEESE blockchain, not from tokenSearch
        if (this.portfolio) {
            if (this.portfolio.USDT !== undefined) {
                tokens.push({
                    address: 'native-usdt',
                    symbol: 'USDT',
                    name: 'Tether USD (CHEESE Native)',
                    chain: 'cheese-native',
                    balance: this.portfolio.USDT || 0,
                    decimals: 18,
                    logoURI: ''
                });
            }
            if (this.portfolio.USDC !== undefined) {
                tokens.push({
                    address: 'native-usdc',
                    symbol: 'USDC',
                    name: 'USD Coin (CHEESE Native)',
                    chain: 'cheese-native',
                    balance: this.portfolio.USDC || 0,
                    decimals: 18,
                    logoURI: ''
                });
            }
        }

        if (!this.tokenSearch || !this.wallet || !this.wallet.address) {
            return tokens; // Return NCH + USDT/USDC if no wallet or tokenSearch
        }

        // Get user tokens (same as portfolio)
        const userTokens = this.tokenSearch.getUserTokens();
        const userTokensWithoutNCHEESE = userTokens.filter(t =>
            t.symbol !== 'NCHEESE' && t.chain !== 'cheese-native' &&
            t.symbol !== 'USDT' && t.symbol !== 'USDC' // Exclude USDT/USDC (already added above)
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
        const allPortfolioTokens = [...userTokensWithoutNCHEESE, ...crossChainTokens];

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

    // Populate swap token dropdowns with fixed swap tokens (NCH, wNCH, USDT)
    async populateSwapTokens() {
        const fromSelect = document.getElementById('swap-from');
        const toSelect = document.getElementById('swap-to');

        if (!fromSelect || !toSelect) return;

        // FIXED: Use hardcoded swap tokens instead of dynamic population
        // This ensures consistent swap options: NCH, USDT
        const swapTokens = [
            { symbol: 'NCH', name: 'NCH (Native CHEESE)', chain: 'cheese-native' },
            { symbol: 'USDT', name: 'USDT', chain: 'bsc' }
        ];

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

        // Set default selections: NCH -> USDT
        fromSelect.value = 'NCH';
        toSelect.value = 'USDT';
    }

    // Send BSC token using Web3.js
    async sendBSCToken(toAddress, amount, tokenAddress, tokenSymbol, decimals = 18, password = null) {
        try {
            if (!this.wallet || !this.wallet.address) {
                throw new Error('No wallet loaded');
            }

            // LEGACY WALLET CODE REMOVED - DO NOT ADD BACK

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

            // NOTE: BNB balance check moved to after address derivation to use correct BSC address

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
            const senderAddress = account.address;

            // Check if address matches wallet display address
            console.log('📤 Sender address from private key:', senderAddress);
            console.log('📤 Wallet display address:', this.wallet.address);

            // CRITICAL FIX: Use the derived address (senderAddress) for ALL BSC operations
            // The wallet display address might differ if it was created with old/wrong derivation
            // We use the correct BSC-compatible address derived from the private key
            if (senderAddress.toLowerCase() !== this.wallet.address.toLowerCase()) {
                console.warn('⚠️ Address differs from wallet display, using correct BSC address:', senderAddress);
                this.showNotification(`📍 Using BSC address: ${senderAddress.substring(0, 10)}...`, 'info');
            }

            // Check BNB balance for gas using the CORRECT derived address
            const bnbBalance = await this.crossChainBalance.getBNBBalance(senderAddress);
            console.log('📤 BNB balance at derived address:', bnbBalance);
            if (bnbBalance < 0.001) {
                throw new Error(`Insufficient BNB for gas fees. You need BNB at ${senderAddress} to pay transaction fees. Current balance: ${bnbBalance.toFixed(6)} BNB`);
            }

            this.showNotification('⏳ Preparing transaction...', 'info');

            // Get nonce for the account (use senderAddress for consistency)
            const nonce = await web3.eth.getTransactionCount(senderAddress, 'latest');
            console.log('📤 Nonce:', nonce);

            // Encode the transfer function call
            const transferData = contract.methods.transfer(toAddress, amountInWei.toString()).encodeABI();

            // Estimate gas (use senderAddress for consistency)
            let gasEstimate;
            try {
                gasEstimate = await web3.eth.estimateGas({
                    from: senderAddress,
                    to: tokenAddress,
                    data: transferData
                });
                console.log('📤 Gas estimate:', gasEstimate);
            } catch (gasError) {
                console.error('Gas estimation failed:', gasError);
                // Use default gas limit for token transfers
                gasEstimate = 60000;
                console.log('📤 Using default gas:', gasEstimate);
            }

            // Build transaction object with proper types for Web3 1.x
            const gasLimit = Math.ceil(Number(gasEstimate) * 1.2);
            const gasPriceWei = '3000000000'; // 3 gwei in wei as string

            console.log('📤 Gas limit:', gasLimit, 'Gas price:', gasPriceWei);

            const txObject = {
                nonce: Number(nonce),
                to: tokenAddress,
                value: '0x0',
                gas: gasLimit,
                gasPrice: gasPriceWei,
                data: transferData,
                chainId: 56 // BSC mainnet
            };

            console.log('📤 Transaction object:', JSON.stringify(txObject, null, 2));

            this.showNotification('⏳ Signing transaction...', 'info');

            // Sign the transaction locally
            const signedTx = await account.signTransaction(txObject);
            console.log('📤 Signed transaction hash:', signedTx.transactionHash);

            this.showNotification('⏳ Sending to BSC network...', 'info');

            // Send the signed transaction (uses eth_sendRawTransaction which public RPCs support)
            const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

            this.showNotification(`✅ ${tokenSymbol} sent successfully! TX: ${receipt.transactionHash.substring(0, 10)}...`, 'success');

            // Update balances
            await this.updatePortfolioScreen();

            return { success: true, txHash: receipt.transactionHash };
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

        // Update available balance display for selected token
        this.updateSwapBalance();

        // Remove existing listener to prevent duplicates
        const fromAmountEl = document.getElementById('swap-from-amount');
        if (fromAmountEl) {
            const newFromAmount = fromAmountEl.cloneNode(true);
            fromAmountEl.parentNode.replaceChild(newFromAmount, fromAmountEl);

            newFromAmount.addEventListener('input', () => {
                const amount = parseFloat(newFromAmount.value || 0);
                const fromToken = document.getElementById('swap-from')?.value || 'NCH';
                const toToken = document.getElementById('swap-to')?.value || 'USDT';
                const toAmountEl = document.getElementById('swap-to-amount');
                const rateEl = document.getElementById('swap-rate');

                if (toAmountEl) {
                    // Simple 1:1 rate (would use real exchange rate in production)
                    toAmountEl.value = amount.toFixed(2);
                }

                if (rateEl) {
                    rateEl.textContent = `1 ${fromToken} = 1 ${toToken}`;
                }
            });
        }

        // Update balance when from token changes
        const fromSelect = document.getElementById('swap-from');
        if (fromSelect) {
            fromSelect.addEventListener('change', () => this.updateSwapBalance());
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

                    // Update rate display
                    const rateEl = document.getElementById('swap-rate');
                    if (rateEl) {
                        rateEl.textContent = `1 ${fromSelect.value} = 1 ${toSelect.value}`;
                    }

                    // Update balance display for new from token
                    this.updateSwapBalance();

                    // Trigger input event to recalculate
                    if (fromAmount) {
                        fromAmount.dispatchEvent(new Event('input'));
                    }

                    this.showNotification('✅ Swapped tokens', 'success');
                }
            });
        }
    }

    // Update swap balance display based on selected from token
    updateSwapBalance() {
        const fromToken = document.getElementById('swap-from')?.value || 'NCH';
        const balanceEl = document.getElementById('swap-available-balance');
        const tokenEl = document.getElementById('swap-balance-token');

        if (!balanceEl || !tokenEl) return;

        let balance = 0;

        // NCH = NCHEESE (native token), use main wallet balance
        if (fromToken === 'NCH' || fromToken === 'NCHEESE') {
            balance = this.balance || 0;

        } else if (fromToken === 'USDT') {
            // USDT is on BSC
            balance = 0; // TODO: Fetch USDT balance from BSC
        }

        balanceEl.textContent = balance.toFixed(4);
        tokenEl.textContent = fromToken;
    }

    // Set max swap amount from available balance
    setMaxSwapAmount() {
        const fromToken = document.getElementById('swap-from')?.value || 'NCH';
        const fromAmountEl = document.getElementById('swap-from-amount');

        if (!fromAmountEl) return;

        let maxAmount = 0;

        if (fromToken === 'NCH' || fromToken === 'NCHEESE') {
            maxAmount = this.balance || 0;
        }
        // TODO: Add wNCH and USDT max amounts when cross-chain balance is available

        fromAmountEl.value = maxAmount.toFixed(4);
        fromAmountEl.dispatchEvent(new Event('input')); // Trigger calculation

        this.showNotification(`Max amount set: ${maxAmount.toFixed(4)} ${fromToken}`, 'info');
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
            // Generate QR code with standard format
            // CRITICAL FIX: Use ethereum: prefix for cross-wallet compatibility
            this.qrCodeGenerationPromise = this.generateQRCode(null, `ethereum:${address}`, tempContainer);
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
                // CRITICAL FIX: Use standard EIP-681/BIP-21 format for cross-wallet compatibility
                // Format: ethereum:0x... (recognized by MetaMask, Trust Wallet, etc.)
                const qrData = `ethereum:${address}`;
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

    /**
     * Checks if the current wallet has a mnemonic (seed phrase) available
     * for viewing or backup.
     * @returns {Promise<boolean>}
     */
    async checkMnemonicBackupStatus() {
        // 1. Check if we have one in this session (newly created)
        if (this.newlyCreatedMnemonic) return true;

        // 2. Check if we have an encrypted mnemonic stored
        const encryptedMnemonic = localStorage.getItem('cheeseWalletMnemonic');
        if (encryptedMnemonic) return true;

        // 3. Check legacy storage
        const legacyMnemonic = localStorage.getItem('cheeseMnemonic');
        if (legacyMnemonic) return true;

        // 4. If none of the above, check if the loaded wallet in local storage has one
        try {
            const walletData = JSON.parse(localStorage.getItem('cheeseWallet')) || {};
            if (walletData.encryptedMnemonic || walletData.mnemonic) return true;
        } catch (e) { }

        return false;
    }


    showPortfolio() {
        if (!this.wallet) {
            this.showNotification('Please unlock your wallet to view portfolio', 'info');
            return;
        }
        // Show portfolio screen
        this.showScreen('portfolio');
    }

    async updatePortfolioScreen() {
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
            // CRITICAL FIX: Only show loading if we don't have any content yet
            // This prevents the screen from flashing every 15 seconds
            const hasExistingContent = document.getElementById('portfolio-tokens-list');
            if (!hasExistingContent) {
                portfolioContent.innerHTML = '<div id="loading-tokens" style="text-align: center; padding: 20px;"><p>Loading tokens...</p></div>';
            }

            // CRITICAL: Update balance BEFORE displaying portfolio (INDEPENDENT of mining)
            console.log('📊 Portfolio: Fetching balance before display...');
            await this.updateBalance();
            console.log('📊 Portfolio: Balance after update:', this.balance);

            // CRITICAL: Also fetch full portfolio to get USDT/USDC balances
            try {
                if (this.api && this.api.getPortfolio) {
                    console.log('📊 Portfolio: Fetching full portfolio data...');
                    const fetchedPortfolio = await this.api.getPortfolio(this.wallet.address);

                    // SAFE PORTFOLIO MERGE: Prevent accidental zeroing of stablecoins
                    // Use same protection logic as in updateBalance()
                    const mergedPortfolio = {
                        ...(this.portfolio || {}),
                        ...fetchedPortfolio
                    };

                    const assetsToProtect = ['USDT', 'USDC', 'NCHEESE', 'NCH'];
                    assetsToProtect.forEach(asset => {
                        const newVal = parseFloat(mergedPortfolio[asset]) || 0;
                        const oldVal = parseFloat(this.portfolio?.[asset]) || 0;

                        if (newVal === 0 && oldVal > 0) {
                            // Only protect if no recent outgoing transactions
                            const hasRecentOutgoing = this.transactions && this.transactions.some(tx =>
                                (tx.from || '').toLowerCase() === this.wallet.address.toLowerCase() &&
                                ((tx.currency || 'NCH').toUpperCase() === asset) &&
                                (Date.now() - new Date(tx.timestamp).getTime() < 60000)
                            );

                            if (!hasRecentOutgoing) {
                                console.warn(`⚠️ IGNORED suspicious ${asset} drop to 0 in updatePortfolioScreen. Preserving: ${oldVal}`);
                                mergedPortfolio[asset] = oldVal;
                            }
                        }
                    });

                    this.portfolio = mergedPortfolio;
                    console.log('📊 Portfolio: Full data received and merged:', this.portfolio);
                }
            } catch (err) {
                console.warn('⚠️ Failed to fetch portfolio:', err);
            }

            // FORCE PRICE REFRESH: Pre-fetch prices for common tokens
            console.log('🚀 Pre-fetching common token prices...');
            const commonTokens = ['USDT', 'USDC', 'BNB', 'ETH', 'CAKE'];
            if (this.tokenSearch) {
                try {
                    await this.tokenSearch.refreshPrices(commonTokens);
                    console.log('✅ Pre-fetched common token prices');
                } catch (error) {
                    console.warn('⚠️ Failed to pre-fetch prices:', error);
                }
            }

            // Get user's tokens (default includes NCHEESE)
            const userTokens = this.tokenSearch ? this.tokenSearch.getUserTokens() : [];

            // CRITICAL FIX: Remove any existing NCHEESE or NCH from userTokens to prevent duplication
            const userTokensWithoutNCHEESE = userTokens.filter(t =>
                t.symbol !== 'NCHEESE' && t.symbol !== 'NCH' && t.chain !== 'cheese-native'
            );

            // Always include NCHEESE as default token (only once)
            // CRITICAL: Use this.balance which was just updated
            // CRITICAL FIX: Always set logoURI for NCHEESE (official logo with blue background)
            const ncheeseToken = {
                address: '0x0000000000000000000000000000000000000000',
                symbol: 'NCHEESE',
                name: 'NCheese (Native CHEESE)',
                decimals: 18,
                logoURI: './icon-192.png', // Official Cheese logo - always embedded
                chain: 'cheese-native',
                balance: this.balance || 0
            };

            // CRITICAL: Always include USDT and USDC as permanent options
            const usdtToken = {
                address: 'native_usdt', // consistent with token-search.js
                symbol: 'USDT',
                name: 'Native Tether USD',
                decimals: 6, // correct decimals for native USDT
                logoURI: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
                chain: 'cheese-native',
                // Use portfolio balance if available
                balance: (this.portfolio && (this.portfolio['USDT'] !== undefined)) ? parseFloat(this.portfolio['USDT']) : 0,
                isPermanent: true
            };

            const usdcToken = {
                address: 'native_usdc', // consistent with token-search.js
                symbol: 'USDC',
                name: 'Native USD Coin',
                decimals: 6, // correct decimals for native USDC
                logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
                chain: 'cheese-native',
                // Use portfolio balance if available
                balance: (this.portfolio && (this.portfolio['USDC'] !== undefined)) ? parseFloat(this.portfolio['USDC']) : 0,
                isPermanent: true
            };

            console.log('📊 Portfolio: Permanent tokens created (NCHEESE, USDT, USDC)');

            // Always add NCHEESE first, then USDT/USDC, then other tokens
            let allTokens = [ncheeseToken, usdtToken, usdcToken, ...userTokensWithoutNCHEESE];

            // 🚀 DISCOVERY: Add any tokens from this.portfolio that aren't already included
            if (this.portfolio) {
                Object.keys(this.portfolio).forEach(symbol => {
                    const balance = parseFloat(this.portfolio[symbol]) || 0;
                    if (balance > 0 && symbol !== 'NCHEESE' && symbol !== 'NCH' && symbol !== 'USDT' && symbol !== 'USDC') {
                        // Check if we already have it (case-insensitive)
                        const exists = allTokens.some(t =>
                            t.symbol.toUpperCase() === symbol.toUpperCase() &&
                            t.chain === 'cheese-native'
                        );
                        if (!exists) {
                            console.log(`🔍 Discovered native token: ${symbol} with balance ${balance}`);
                            allTokens.push({
                                address: `native_${symbol.toLowerCase()}`,
                                symbol: symbol.toUpperCase(),
                                name: `${symbol} Token`,
                                decimals: 18,
                                logoURI: '',
                                chain: 'cheese-native',
                                balance: balance,
                                isDiscovered: true
                            });
                        }
                    }
                });
            }

            console.log('📊 Portfolio: allTokens after discovery:', allTokens.map(t => t.symbol));

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
                if (token.symbol === 'NCHEESE') {
                    // CRITICAL: Always update NCHEESE balance from this.balance
                    token.balance = this.balance || 0;
                    // Ensure it's marked as NCHEESE
                    token.symbol = 'NCHEESE';
                    token.name = token.name || 'NCheese (Native CHEESE)';
                    token.chain = 'cheese-native';
                    // CRITICAL FIX: Always ensure NCHEESE has logoURI set (official logo)
                    token.logoURI = token.logoURI || './icon-192.png';
                } else if (token.chain === 'cheese-native' && this.portfolio && this.portfolio[token.symbol] !== undefined) {
                    // CRITICAL: Update Native Stablecoins (USDT/USDC) ONLY for native chain to avoid BSC conflict
                    token.balance = parseFloat(this.portfolio[token.symbol]) || 0;
                    console.log(`✅ Updated Native ${token.symbol} balance from portfolio: ${token.balance}`);
                } else {
                    // For other tokens (including BSC), preserve existing balance
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

                // CRITICAL: NCHEESE always uses dynamic price (seed: $0.022)
                if (symbol === 'NCHEESE') {
                    return this.tokenSearch ? this.tokenSearch.getTokenPriceSync('NCHEESE') || 0.022 : 0.022;
                }
                
                if (symbol === 'USDT' || symbol === 'USDC') {
                    return 1.00; // Always $1.00 for Native Stablecoins
                }

                // IMMEDIATE FALLBACK PRICES - Use these FIRST, then try to get real price
                const fallbackPrices = {
                    'NCHEESE': 0.022,
                    'CHEESE': 1.00,  // BSC CHEESE token
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
                        const nameMatch = token.name.match(/\b(BNB|ETH|BTC|USDT|USDC|DAI|BUSD|CAKE|NCHEESE|WBNB|WBTC)\b/i);
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
            // Group tokens by address (case-insensitive) and chain, keep the best one
            const uniqueTokens = [];
            const seenTokens = new Map();

            allTokens.forEach(token => {
                // CRITICAL FIX: For NCHEESE, use a special key to prevent duplication
                // NCHEESE should always be unique regardless of address variations
                let key;
                const symbolUpper = (token.symbol || '').toUpperCase();
                if (symbolUpper === 'NCHEESE' || symbolUpper === 'NCH') {
                    key = 'NCHEESE_cheese-native'; // Standardized key
                } else {
                    // Use fallback for missing address to prevent crash
                    const addr = (token.address || 'unknown').toLowerCase();
                    const chain = (token.chain || 'cheese-native').toLowerCase();
                    key = `${addr}_${chain}`;
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

            // CRITICAL: Update NCHEESE balance one more time before filtering
            uniqueTokens.forEach(token => {
                if (token.symbol === 'NCHEESE') {
                    token.balance = this.balance || 0;
                    token.symbol = 'NCHEESE';
                    token.name = 'NCheese (Native CHEESE)';
                    token.chain = 'cheese-native';
                }
            });

            // CRITICAL: Remove duplicate NCHEESE entries (keep only one)
            const ncheeseTokens = uniqueTokens.filter(t => t.symbol === 'NCHEESE');
            if (ncheeseTokens.length > 1) {
                // Keep the first NCHEESE token, remove others
                const firstNCHEESEIndex = uniqueTokens.findIndex(t => t.symbol === 'NCHEESE');
                for (let i = uniqueTokens.length - 1; i >= 0; i--) {
                    if (i !== firstNCHEESEIndex && (uniqueTokens[i].symbol === 'NCHEESE')) {
                        uniqueTokens.splice(i, 1);
                    }
                }
            }

            // CRITICAL: Filter out tokens with zero balance (unless they're permanent native assets)
            let tokensToDisplay = uniqueTokens.filter(token => {
                const symbol = (token.symbol || '').toUpperCase();
                const chain = (token.chain || '').toLowerCase();
                const name = (token.name || '').toUpperCase();

                // 1. CLEANUP: Filter out redundant BSC tokens with zero balance
                // This prevents confusion with Native assets (NCHEESE, Native USDT, etc.)
                const isBscVersion = chain === 'bsc' || name.includes('BSC') || name.includes('PANCAKESWAP');

                if (isBscVersion) {


                    if (symbol === 'CHEESE' || symbol === 'USDT' || symbol === 'USDC') {
                        if ((token.balance || 0) <= 0) {
                            return false; // DEFINITELY hide 0-balance BSC copies
                        }
                    }
                }

                // 2. PERMANENT NATIVE ASSETS: Always show these regardless of balance
                if (chain === 'cheese-native' || symbol === 'NCHEESE') {
                    if (symbol === 'NCHEESE' || symbol === 'USDT' || symbol === 'USDC') {
                        return true;
                    }
                }

                // 3. CROSS-CHAIN & USER ADDED: Only show if they have balance or were manually added
                if (token.balance > 0) return true;
                if (token.isUserAdded) return true;

                // Default: Hide zero balances
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

            // Fetch prices for all unique tokens (AFTER tokensToDisplay is created)
            // CRITICAL: CHEESE must fetch real price from PancakeSwap
            const uniqueSymbols = [...new Set(tokensToDisplay.map(t => t.symbol).filter(s => s && s !== 'NCHEESE'))];
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
                            'NCHEESE': 0.022,  // Native token seed
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

            // CRITICAL FIX: Removed early return for 'hasExistingContent'
            // This ensures that discovered tokens and balance updates always trigger
            // a full UI synchronization, preventing the 'disappearing tokens' bug.

            console.log(`🎨 Performing portfolio sync for ${tokensToDisplay.length} tokens...`);
            console.log('👀 Display Symbols:', tokensToDisplay.map(t => `${t.symbol}(${t.chain})`));

            // EMERGENCY DEBUG: Check specifically for USDT/USDC in display list
            const hasUSDT = tokensToDisplay.some(t => t.symbol === 'USDT' && t.chain === 'cheese-native');
            const hasUSDC = tokensToDisplay.some(t => t.symbol === 'USDC' && t.chain === 'cheese-native');
            console.log(`🧐 Native USDT in display? ${hasUSDT} | Native USDC in display? ${hasUSDC}`);

            // Display tokens
            if (tokensToDisplay.length === 0) {
                portfolioContent.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">
                        <i class="fas fa-coins" style="font-size: 3em; margin-bottom: 20px; opacity: 0.2;"></i>
                        <p>No tokens found in your wallet</p>
                        <button onclick="app.showScreen('add-token')" class="btn secondary" style="margin-top: 20px;">+ Add Token</button>
                    </div>
                `;
            } else {
                // Binance Web3 Wallet Style Portfolio
                portfolioContent.innerHTML = `
                    <div style="margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1)); border-radius: 12px; border: 1px solid rgba(102, 126, 234, 0.2);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 0.85em; color: #666; margin-bottom: 5px; font-weight: 500;">Total Portfolio Value</div>
                                <div style="font-size: 2em; font-weight: bold; color: #667eea; line-height: 1.2;">$${totalValue.toFixed(2)}</div>
                            </div>
                            <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                                <button onclick="this.disabled=true; this.innerHTML='🔄'; app.updateBalance().then(() => { this.disabled=false; this.innerHTML='↻'; })" 
                                        class="btn secondary" 
                                        style="padding: 4px 8px; font-size: 1.2em; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; margin-bottom: 5px; background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.2);" 
                                        title="Refresh Portfolio">↻</button>
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
                    const price = getTokenPrice(token);
                    const value = balance * price;

                    // Format balance
                    const balanceDisplay = Number(balance).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6
                    });

                    // Format price
                    let priceDisplay = '--';
                    if (price > 0) priceDisplay = `$${price.toFixed(price >= 1 ? 2 : 6)}`;
                    else if (tokenSymbol === 'NCHEESE') priceDisplay = '$0.022';
                    else if (tokenSymbol === 'USDT' || tokenSymbol === 'USDC') priceDisplay = '$1.00';

                    const valueDisplay = `$${value.toFixed(2)}`;
                    const shouldShowRemove = tokenSymbol !== 'NCHEESE' && token.isUserAdded && !token.isCrossChain;

                    return `
                        <div class="portfolio-token-item" data-token-address="${token.address}" data-token-symbol="${tokenSymbol}" data-token-chain="${token.chain || 'cheese-native'}"
                             style="padding: 12px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.2s; background: white;"
                             onmouseover="this.style.background='#f8f9fa'"
                             onmouseout="this.style.background='white'">
                            <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                                <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.8em; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); position: relative;">
                                    ${token.logoURI ? `<img src="${token.logoURI}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" onerror="this.style.display='none';">` : displaySymbol.charAt(0)}
                                </div>
                                <div style="min-width: 0; flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                                        <div style="font-weight: 600; font-size: 0.9em; color: #333;">${displaySymbol}</div>
                                        ${token.network || (token.chain && token.chain !== 'cheese-native') ? `
                                            <span style="font-size: 0.65em; color: #667eea; background: rgba(102, 126, 234, 0.1); padding: 1px 4px; border-radius: 3px; font-weight: 500; white-space: nowrap;">
                                                ${token.network || token.chain.toUpperCase()}
                                            </span>
                                        ` : `
                                            <span style="font-size: 0.65em; color: #4caf50; background: rgba(76, 175, 80, 0.1); padding: 1px 4px; border-radius: 3px; font-weight: 500; white-space: nowrap;">
                                                CHEESE
                                            </span>
                                        `}
                                    </div>
                                    <div style="font-size: 0.75em; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${tokenName}</div>
                                </div>
                            </div>
                            <div style="text-align: right; flex-shrink: 0; margin-left: 10px; max-width: 50%;">
                                <div style="font-weight: 600; font-size: 0.9em; color: #333; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${balanceDisplay} <span style="font-size: 0.8em; color: #666; font-weight: normal;">${displaySymbol}</span>
                                </div>
                                <div style="font-size: 0.75em; color: #666; display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                                    <div style="display: flex; align-items: center; gap: 2px;">
                                        <span style="font-size: 0.8em; opacity: 0.7;">Price:</span>
                                        <span class="token-price" style="font-weight: 500;">${priceDisplay}</span>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 2px;">
                                        <span style="font-size: 0.8em; opacity: 0.7;">Total:</span>
                                        <span class="token-value" style="color: ${value > 0 ? '#4caf50' : '#667eea'}; font-weight: 600;">${valueDisplay}</span>
                                    </div>
                                </div>
                            </div>
                            ${shouldShowRemove ? `
                                <button class="btn btn-danger btn-small" onclick="app.removeTokenFromPortfolio('${token.address}', '${token.chain || 'cheese-native'}')"
                                        style="margin-left: 10px; padding: 4px 8px; font-size: 0.75em; border-radius: 4px;">✕</button>
                            ` : token.isCrossChain ? `
                                <span style="margin-left: 10px; padding: 4px 6px; font-size: 0.7em; color: #6c757d; background: #f0f0f0; border-radius: 4px;" title="Auto-detected from BSC">🌐</span>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
                    </div>
                `;
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
        tokenItems.forEach(item => {
            const symbol = item.dataset.tokenSymbol;
            if (!symbol) return;

            const priceElement = item.querySelector('.token-price');
            const valueElement = item.querySelector('.token-value');
            const balanceElement = item.querySelector('div[style*="font-weight: 600"][style*="margin-bottom"]');

            if (priceElement && valueElement && balanceElement) {
                // Get current price
                const price = this.tokenSearch.getTokenPriceSync(symbol);
                const balance = parseFloat(balanceElement.textContent.replace(/,/g, '')) || 0;
                const value = balance * price;

                // Update price display
                let priceDisplay = '--';
                if (price > 0) {
                    priceDisplay = `$${price.toFixed(price >= 1 ? 2 : 6)}`;
                } else if (price === 0 && (symbol.toUpperCase() === 'NCHEESE' || symbol.toUpperCase() === 'USDT' || symbol.toUpperCase() === 'USDC')) {
                    priceDisplay = '$1.00';
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
                                         onclick="app.addCustomTokenByAddress('${normalizedAddress}')">
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
                             onclick="app.addTokenToPortfolio('${token.address}', '${token.symbol}', '${token.name}', ${token.decimals || 18}, '${token.chain || 'cheese-native'}')">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8em; font-weight: bold;">
                                    ${token.logoURI ? `<img src="${token.logoURI}" style="width: 100%; height: 100%; border-radius: 50%;" onerror="this.style.display='none'">` : (token.symbol || '?').charAt(0)}
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
        // 🔒 FOOLPROOF IMPORT GUARD: NEVER allow import if wallet already exists
        // This handles cases where this.hasWallet might be out of sync
        const isWalletLoaded = (this.hasWallet && this.wallet && this.wallet.address);
        const hasStoredWallet = localStorage.getItem('encrypted_seed_phrase') || localStorage.getItem('encrypted_private_key');

        if (isWalletLoaded || hasStoredWallet || window.IMPORT_BLOCKED) {
            console.log('🔒 Import Modal LOCKDOWN: Preventing re-trigger', {
                loaded: isWalletLoaded,
                stored: !!hasStoredWallet,
                blocked: !!window.IMPORT_BLOCKED
            });
            return; // ABORT - do not proceed to prompt the user
        }

        // Set global flag to prevent any simultaneous triggers
        window.IMPORT_BLOCKED = true;
        setTimeout(() => { if (!this.hasWallet) window.IMPORT_BLOCKED = false; }, 5000); // Clear after 5s if failed


        // Simple import options - like MetaMask
        const importMethod = prompt(
            'Import Wallet\n\n' +
            '1. Seed Phrase (12 or 24 words)\n' +
            '2. Private Key (64 hex characters)\n' +
            '3. QR Code\n\n' +
            'Enter 1, 2, or 3:'
        );

        if (!importMethod) return;

        // Map prompt choice to setupImport types for compatibility if we want to pipe it through the new modal
        // But for now, leave this legacy method as is for the "No Wallet" screen flow
        // and implement the new methods separately for the Settings screen.

        if (importMethod === '1') {
            // ... existing logic ...
            // We will keep this method as is for legacy/prompt compatibility but refactor if needed later.
            this.processLegacyImport('seed');
        } else if (importMethod === '2') {
            this.processLegacyImport('privateKey');
        } else if (importMethod === '3') {
            this.setupImport('qr'); // Reuse new modal for QR code as it needs camera
        }
    }

    // Legacy Prompt-based Import Processor (Refactored logic from original importWallet for cleaner code)
    // To preserve original behavior while cleaning up structure
    async processLegacyImport(method) {
        if (method === 'privateKey') {
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

            // Validate private key format
            if (!/^[a-fA-F0-9]{64}$.test(cleanKey)) {
                this.showNotification('Invalid private key format. Must be 64 hex characters.', 'error');
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

            await this.performImport(cleanKey, password, 'privateKey');
        } else if (method === 'seed') {
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

            await this.performImport(seedPhrase.trim(), password, 'seed');
        }
    }


    /* ==========================================
       NEW IMPORT MODAL LOGIC (Settings Screen)
       ========================================== */

    setupImport(type = 'privateKey') {
        const modal = document.getElementById('import-modal');
        const optionsView = document.getElementById('import-options-view');
        const inputView = document.getElementById('import-input-view');
        const qrView = document.getElementById('import-qr-view');
        const label = document.getElementById('import-label');
        const textInput = document.getElementById('import-text');

        if (!modal) return;

        this.currentImportType = type;
        modal.style.display = 'flex';

        // Helper to hide all views
        const hideAll = () => {
            if (optionsView) optionsView.style.display = 'none';
            if (inputView) inputView.style.display = 'none';
            if (qrView) qrView.style.display = 'none';
        };

        hideAll();

        if (type === 'qr') {
            if (qrView) qrView.style.display = 'block';
            // Start QR Scanner reusing the existing logic
            // We'll use a simple button in the view to trigger the reliable scanner for now
            // rather than trying to embed it immediately which can be buggy
            this.showNotification('Please use the visual scanner', 'info');
            this.showQRScanner((scannedData) => {
                // Close QR scanner modal first
                const scannerModal = document.getElementById('qr-scanner-modal');
                if (scannerModal && scannerModal.parentNode) scannerModal.parentNode.removeChild(scannerModal);

                // Determine if seed or key
                let importType = 'privateKey';
                if (scannedData.includes(' ')) importType = 'seed';

                // Fill input and switch to input view
                this.currentImportType = importType;
                hideAll();
                if (inputView) inputView.style.display = 'block';
                if (textInput) textInput.value = scannedData;
                if (label) label.textContent = importType === 'seed' ? 'Scanned Seed Phrase:' : 'Scanned Private Key:';
            });
            // Close the import modal since the full-screen scanner takes over
            modal.style.display = 'none';
        } else {
            if (inputView) inputView.style.display = 'block';
            if (textInput) {
                textInput.value = '';
                textInput.focus();

                if (type === 'seed') {
                    if (label) label.textContent = 'Enter Seed Phrase (12 or 24 words):';
                    textInput.placeholder = 'apple banana cherry ...';
                } else {
                    if (label) label.textContent = 'Enter Private Key:';
                    textInput.placeholder = 'Paste your 64-character hex key here...';
                }
            }
        }
    }

    resetImportModal() {
        const modal = document.getElementById('import-modal');
        const optionsView = document.getElementById('import-options-view');
        const inputView = document.getElementById('import-input-view');
        const qrView = document.getElementById('import-qr-view');
        const textInput = document.getElementById('import-text');
        const passwordInput = document.getElementById('import-password-input');

        // If currently in input/qr view, go back to options
        // If in options view, close modal
        if (optionsView && optionsView.style.display === 'none') {
            if (optionsView) optionsView.style.display = 'block';
            if (inputView) inputView.style.display = 'none';
            if (qrView) qrView.style.display = 'none';
            if (textInput) textInput.value = '';
            if (passwordInput) passwordInput.value = '';
        } else {
            if (modal) modal.style.display = 'none';
        }
    }

    async processImport() {
        const textInput = document.getElementById('import-text');
        const passwordInput = document.getElementById('import-password-input');

        if (!textInput || !passwordInput) return;

        const inputValue = textInput.value.trim();
        const password = passwordInput.value;
        const type = this.currentImportType || 'privateKey';

        // 1. Basic Validation
        if (!inputValue) {
            this.showNotification(`Please enter a ${type === 'seed' ? 'seed phrase' : 'private key'}`, 'error');
            return;
        }

        if (!password) {
            this.showNotification('Password is required to encrypt your wallet', 'error');
            return;
        }

        if (password.length < 4) {
            this.showNotification('Password must be at least 4 characters', 'error');
            return;
        }

        // 2. Format Validation
        let cleanInput = inputValue;
        if (type === 'privateKey') {
            // Remove 0x prefix
            if (cleanInput.toLowerCase().startsWith('0x')) {
                cleanInput = cleanInput.slice(2);
            }
            if (!/^[a-fA-F0-9]{64}$i.test(cleanInput)) {
                this.showNotification('Invalid private key format. Must be 64 hex characters.', 'error');
                return;
            }
        } else {
            // Seed phrase validation
            const wordCount = cleanInput.split(/\s+/).length;
            if (wordCount !== 12 && wordCount !== 24) {
                this.showNotification(`Invalid seed phrase. Found ${wordCount} words, expected 12 or 24.`, 'error');
                return;
            }
        }

        // 3. Perform Import
        try {
            this.showNotification('⏳ Importing wallet...', 'info');
            await this.performImport(cleanInput, password, type);

            // Close modal on success
            const modal = document.getElementById('import-modal');
            if (modal) modal.style.display = 'none';
            // Clear inputs
            textInput.value = '';
            passwordInput.value = '';

        } catch (error) {
            // Error is already shown by performImport usually, but ensure it
            console.error('Import failed:', error);
            // Notification already handled in performImport? No, let's double check.
            // performImport throws?
        }
    }

    // Unified Import Logic (Reused by both Prompt and Modal flows)
    async performImport(inputData, password, type) {
        try {
            let address, publicKey, privateKey;

            if (type === 'privateKey') {
                console.log('🔑 Importing wallet from private key...');
                if (typeof ethers === 'undefined') {
                    throw new Error('Ethers.js library not loaded');
                }
                const wallet = new ethers.Wallet(inputData);
                address = wallet.address;
                publicKey = wallet.publicKey;
                privateKey = inputData;

                this.wallet = {
                    address,
                    publicKey,
                    privateKey,
                    mnemonic: null
                };
            } else {
                console.log('📝 Importing wallet from seed phrase...');
                const walletData = await this.security.deriveWalletFromMnemonic(inputData);
                if (!walletData || !walletData.address || !walletData.privateKey) {
                    throw new Error('Failed to derive wallet from seed phrase');
                }

                this.wallet = {
                    address: walletData.address,
                    publicKey: walletData.publicKey,
                    privateKey: walletData.privateKey,
                    mnemonic: inputData
                };
            }

            // Save Wallet
            const normalizedPassword = password.trim();
            this.walletCore.wallet = this.wallet;
            await this.walletCore.saveWallet(normalizedPassword);

            // SAVE SESSION KEY FOR DEX (Shared Local Storage for Cross-Tab Access)
            if (this.wallet && this.wallet.privateKey) {
                localStorage.setItem('cheese_temp_key', this.wallet.privateKey);
            }

            // Verify Save
            const savedData = JSON.parse(localStorage.getItem('cheeseWallet'));
            if (!savedData || savedData.address !== this.wallet.address) {
                throw new Error('Wallet save verification failed');
            }

            // Encryption of mnemonic if applicable
            if (type === 'seed') {
                await this.saveMnemonicSecurely(inputData, normalizedPassword);
            }

            // Post-Import Setup
            this.fiatGateway.setWalletAddress(this.wallet.address);
            await this.loadWalletData();
            if (this.wallet && this.wallet.address) {
                this.preGenerateQRCode(this.wallet.address).catch(() => { });
            }

            this.showWalletAfterImport();
            this.showNotification(`✅ Wallet imported successfully!`, 'success');

        } catch (error) {
            console.error('Perform Import Error:', error);
            this.showNotification('Failed to import: ' + error.message, 'error');
            throw error; // Propagate so caller knows it failed
        }
    }

    // Legacy implementation - keeping interface but delegating
    async importWallet_LEGACY() {

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

                // Validate private key format
                if (!/^[a-fA-F0-9]{64}$.test(cleanKey)) {
                    this.showNotification('Invalid private key format. Must be 64 hex characters.', 'error');
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
                    console.log('🔑 Importing wallet from private key...');

                    // CRITICAL FIX: Use Ethers.js for Standard EVM Derivation (Matches Server & Generated Wallets)
                    // The previous elliptic implementation derived "Wallet-Compatible" addresses which caused mismatches
                    if (typeof ethers === 'undefined') {
                        throw new Error('Ethers.js library not loaded - cannot import wallet securely');
                    }

                    console.log('📍 Deriving address using Ethers.js (EVM-compatible)');
                    const wallet = new ethers.Wallet(cleanKey);
                    const address = wallet.address;
                    const publicKey = wallet.publicKey;

                    console.log('✅ Wallet derived from private key (EVM Standard), address:', address);

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

        if (loginSection) {
            loginSection.style.display = 'none';
            loginSection.classList.add('hidden'); // Extra safety
        }
        if (noWalletSection) {
            noWalletSection.style.display = 'none';
            noWalletSection.classList.add('hidden'); // Extra safety
        }
        if (walletSection) {
            walletSection.style.display = 'block';
            walletSection.classList.remove('hidden');
        }

        // CRITICAL: Ensure we stay in wallet view, prevent any prompts
        this.hasWallet = true;

        // DON'T call updateUI() here - it re-checks wallet.privateKey which might not be set yet
        // This causes updateUI() to show no-wallet section again, triggering import modal
        // The manual display control above is sufficient
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
                this.showNotification('✅ Block mined! Reward: ' + (result.reward || 1) + ' NCHEESE', 'success');
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
            if (rateEl) rateEl.textContent = `1 NCHEESE = $1.00`;
            return;
        }

        // Calculate exchange rate (placeholder - would use real API)
        const exchangeRate = 1.0; // 1 NCHEESE = $1.00
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
            rateEl.textContent = `1 NCHEESE = ${this.enhancements?.formatCurrency(exchangeRate, currency) || '$0.022'}`;
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
                <div class="tx-amount">${tx.amount} ${tx.currency || 'NCHEESE'}</div>
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

    // Refresh multi-chain balances from BSC, Ethereum, Polygon
    async refreshMultiChainBalances() {
        if (!this.multiChain || !this.wallet) {
            console.log('Multi-chain provider or wallet not available');
            return;
        }

        const address = this.wallet.address;
        console.log('🌐 Refreshing multi-chain balances for:', address);

        try {
            // Show loading state
            const elements = [
                'bsc-bnb-balance', 'bsc-usdt-balance', 'bsc-usdc-balance', 'bsc-cheese-balance',
                'eth-eth-balance', 'eth-usdt-balance', 'eth-usdc-balance',
                'polygon-matic-balance', 'polygon-usdt-balance', 'polygon-usdc-balance'
            ];
            elements.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '...';
            });

            // Fetch all balances
            const balances = await this.multiChain.getAllBalances(address);
            console.log('📊 Multi-chain balances:', balances);

            // Update BSC balances
            this.updateBalanceElement('bsc-bnb-balance', balances.bsc?.BNB);
            this.updateBalanceElement('bsc-usdt-balance', balances.bsc?.USDT);
            this.updateBalanceElement('bsc-usdc-balance', balances.bsc?.USDC);
            this.updateBalanceElement('bsc-cheese-balance', balances.bsc?.CHEESE);

            // Update Ethereum balances
            this.updateBalanceElement('eth-eth-balance', balances.ethereum?.ETH);
            this.updateBalanceElement('eth-usdt-balance', balances.ethereum?.USDT);
            this.updateBalanceElement('eth-usdc-balance', balances.ethereum?.USDC);

            // Update Polygon balances
            this.updateBalanceElement('polygon-matic-balance', balances.polygon?.MATIC);
            this.updateBalanceElement('polygon-usdt-balance', balances.polygon?.USDT);
            this.updateBalanceElement('polygon-usdc-balance', balances.polygon?.USDC);

            // Store balances
            this.multiChainBalances = balances;

            this.showNotification('✅ Multi-chain balances updated', 'success');
        } catch (error) {
            console.error('Error fetching multi-chain balances:', error);
            this.showNotification('Failed to fetch multi-chain balances', 'error');
        }
    }

    // Helper to update balance element
    updateBalanceElement(elementId, balance) {
        const el = document.getElementById(elementId);
        if (el) {
            if (balance === undefined || balance === null) {
                el.textContent = '0.00';
            } else if (balance < 0.0001 && balance > 0) {
                el.textContent = '<0.0001';
            } else {
                el.textContent = parseFloat(balance).toFixed(4);
            }
        }
    }

    // Send tokens on multi-chain (BSC, Ethereum, Polygon)
    async sendMultiChainTokens(network, token, toAddress, amount) {
        if (!this.multiChain || !this.wallet) {
            this.showNotification('Wallet not loaded', 'error');
            return;
        }

        try {
            // Get private key from storage
            const walletData = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
            const privateKey = walletData.privateKey || walletData.encryptedPrivateKey;

            if (!privateKey) {
                throw new Error('Private key not available');
            }

            this.showNotification(`📤 Sending ${amount} ${token} on ${network}...`, 'info');
            console.log(`🌐 Multi-chain send: ${amount} ${token} to ${toAddress} on ${network}`);

            const result = await this.multiChain.sendTransaction(
                this.wallet.address,
                toAddress,
                amount,
                privateKey,
                network,
                token !== 'BNB' && token !== 'ETH' && token !== 'MATIC' ? token : null
            );

            if (result.success) {
                this.showNotification(`✅ ${token} sent! TX: ${result.hash?.slice(0, 10)}...`, 'success');

                // Refresh balances
                setTimeout(() => this.refreshMultiChainBalances(), 3000);

                return result;
            } else {
                throw new Error(result.error || 'Transaction failed');
            }
        } catch (error) {
            console.error('Multi-chain send error:', error);
            this.showNotification(`❌ ${error.message}`, 'error');
            throw error;
        }
    }

    // Show multi-chain send modal
    showMultiChainSendModal() {
        const modal = document.createElement('div');
        modal.id = 'multichain-send-modal';
        modal.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 9999; display: flex; align-items: center; justify-content: center;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 25px; border-radius: 15px; width: 90%; max-width: 400px; color: white;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="margin: 0; color: #ffd700;">🌐 Multi-Chain Send</h3>
                        <button onclick="document.getElementById('multichain-send-modal').remove()" style="background: none; border: none; color: #fff; font-size: 24px; cursor: pointer;">×</button>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="color: #aaa; font-size: 0.85em;">Network</label>
                        <select id="mc-send-network" onchange="app.updateTokensForNetwork()" style="width: 100%; padding: 10px; border-radius: 8px; background: #0f0f1a; color: white; border: 1px solid #333;">
                            <option value="native">🧀 Native CHEESE</option>
                            <option value="bsc">🔶 BNB Smart Chain</option>
                            <option value="ethereum">💎 Ethereum</option>
                            <option value="polygon">💜 Polygon</option>
                        </select>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="color: #aaa; font-size: 0.85em;">Token</label>
                        <select id="mc-send-token" style="width: 100%; padding: 10px; border-radius: 8px; background: #0f0f1a; color: white; border: 1px solid #333;">
                            <option value="BNB">💛 BNB</option>
                            <option value="USDT">💵 USDT</option>
                            <option value="USDC">💲 USDC</option>
                            <option value="CHEESE">🧀 CHEESE</option>
                        </select>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <label style="color: #aaa; font-size: 0.85em;">Recipient Address</label>
                        <input type="text" id="mc-send-address" placeholder="0x..." style="width: 100%; padding: 10px; border-radius: 8px; background: #0f0f1a; color: white; border: 1px solid #333;">
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <label style="color: #aaa; font-size: 0.85em;">Amount</label>
                        <input type="number" id="mc-send-amount" placeholder="0.00" step="0.0001" style="width: 100%; padding: 10px; border-radius: 8px; background: #0f0f1a; color: white; border: 1px solid #333;">
                    </div>
                    
                    <button onclick="app.executeMultiChainSend()" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #ffd700 0%, #ffaa00 100%); border: none; border-radius: 8px; color: #000; font-weight: bold; cursor: pointer;">
                        📤 Send
                    </button>
                    
                    <p style="margin-top: 15px; font-size: 0.75em; color: #888; text-align: center;">
                        ⚠️ Requires gas fees in the native token (BNB/ETH/MATIC)
                    </p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Execute multi-chain send from modal
    async executeMultiChainSend() {
        const network = document.getElementById('mc-send-network').value;
        const token = document.getElementById('mc-send-token').value;
        const address = document.getElementById('mc-send-address').value;
        const amount = parseFloat(document.getElementById('mc-send-amount').value);

        if (!address || !amount) {
            this.showNotification('Please fill all fields', 'error');
            return;
        }

        try {
            await this.sendMultiChainTokens(network, token, address, amount);
            document.getElementById('multichain-send-modal')?.remove();
        } catch (error) {
            // Error already shown in sendMultiChainTokens
        }
    }

    // Update token options based on selected network
    updateTokensForNetwork() {
        const network = document.getElementById('mc-send-network')?.value;
        const tokenSelect = document.getElementById('mc-send-token');
        if (!tokenSelect) return;

        const tokensByNetwork = {
            'native': ['NCH'],
            'bsc': ['BNB', 'USDT', 'USDC', 'CHEESE', 'BUSD'],
            'ethereum': ['ETH', 'USDT', 'USDC'],
            'polygon': ['MATIC', 'USDT', 'USDC']
        };

        const tokens = tokensByNetwork[network] || [];
        tokenSelect.innerHTML = tokens.map(t => `<option value="${t}">${this.multiChain?.getTokenLogo(t) || '🪙'} ${t}</option>`).join('');
    }

    // Start auto-refresh for multi-chain balances (every 30 seconds)
    startMultiChainAutoRefresh() {
        if (this.multiChainRefreshInterval) {
            clearInterval(this.multiChainRefreshInterval);
        }

        this.multiChainRefreshInterval = setInterval(() => {
            if (this.wallet && this.multiChain) {
                console.log('🔄 Auto-refreshing multi-chain balances...');
                this.refreshMultiChainBalances();
            }
        }, 30000); // 30 seconds

        // Initial refresh
        if (this.wallet && this.multiChain) {
            this.refreshMultiChainBalances();
        }
    }

    // Get transaction history for multi-chain (uses explorer APIs)
    async getMultiChainTransactions(network = 'bsc') {
        if (!this.wallet) return [];

        const address = this.wallet.address;
        const explorerAPIs = {
            'bsc': `https://api.bscscan.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=YourApiKey`,
            'ethereum': `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc`,
            'polygon': `https://api.polygonscan.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc`
        };

        // For now, show message that explorer APIs need API keys
        console.log(`📜 Transaction history for ${network} requires explorer API key`);
        return [];
    }

    // Show multi-chain transaction history
    showMultiChainTransactions() {
        this.showNotification('📜 Transaction history: Check BSCscan, Etherscan, or Polygonscan for your address', 'info');
    }
}

// Initialize app with readiness check
let app;
function initApp() {
    if (window.app) return;
    console.log('🏁 Initializing CheeseWalletApp...');
    try {
        app = new CheeseWalletApp();
        window.app = app;
        console.log('✅ CheeseWalletApp mounted to window');
    } catch (e) {
        console.error('❌ CRITICAL: Failed to initialize CheeseWalletApp:', e);
        alert('Critical Error initializing wallet: ' + e.message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

console.log('📄 app.js fully loaded (v1.1.4)');

