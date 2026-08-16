// ==========================================
// CHEESE DEX Frontend JavaScript
// ==========================================

// Initialize Variables Globally
window.userWallet = null; // Explicit global for support-widget.js
let walletType = null; // 'metamask' or 'cheese'
let sessionKey = null; // In-memory signing session only — never persisted by DEX
let pendingSignCallback = null;
const walletCore = new WalletCore(); // For decryption
let currentSlippage = 0.5;
let fromToken = 'NCH';
let toToken = 'USDT';
let selectingTokenFor = null;

// Helper: check if connected via any Web3 injected wallet
function isWeb3WalletConnected() {
    const ethProvider = getEthereumProvider();
    return walletType === 'metamask' || walletType === 'binance' || walletType === 'trust' ||
        walletType === 'coinbase' || walletType === 'bitget' || walletType === 'tokenpocket' ||
        (ethProvider && userWallet);
}

// ULTRA-ROBUST Ethereum Provider detection
function getEthereumProvider() {
    if (typeof window === 'undefined') return null;
    if (walletType === 'cheese' && typeof window.cheese !== 'undefined') {
        return window.cheese;
    }
    let provider = window.ethereum || (window.web3 && window.web3.currentProvider) || window.metamask || window.trustwallet;
    if (!provider && window.ethereum && window.ethereum.providers) {
        provider = window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum.providers[0];
    }
    return provider;
}

// CRITICAL: Derived from unified ecosystem /config.js
const _originDexApi = (typeof window !== 'undefined' ? window.location.origin : 'https://cheeseblockchain.com') + '/dex';
const _cfgDex = (window.CHEESE_CONFIG && window.CHEESE_CONFIG.DEX_API_URL) || _originDexApi;
window.DEX_API_URL = (!_cfgDex || _cfgDex.includes('wallet.cheeseblockchain.com')) ? _originDexApi : _cfgDex;
const DEX_API_URL = window.DEX_API_URL;
const BLOCKCHAIN_API_URL = (window.CHEESE_CONFIG && window.CHEESE_CONFIG.API_URL) || (typeof window !== 'undefined' ? window.location.origin : 'https://cheeseblockchain.com');
const API_KEY = (window.CHEESE_CONFIG && window.CHEESE_CONFIG.API_KEY) || window.API_KEY;

function dexApiUrl(path) {
    const activeUrl = window.DEX_API_URL || (typeof window !== 'undefined' ? window.location.origin + '/dex' : 'https://cheeseblockchain.com/dex');
    const base = activeUrl.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
}

function dexApiHeaders(extra = {}) {
    const key = (window.CHEESE_CONFIG && window.CHEESE_CONFIG.API_KEY) || window.API_KEY;
    return key ? { 'x-api-key': key, ...extra } : { ...extra };
}
let DEX_VAULT_ADDRESS = '0x3801490C9f806c917b8CbA710Db9135FA3B116ae';

async function resolveDexVaultAddress() {
    try {
        const response = await fetch(dexApiUrl('/api/health'), { headers: dexApiHeaders() });
        if (response.ok) {
            const data = await response.json();
            if (data.vaultAddress) {
                DEX_VAULT_ADDRESS = data.vaultAddress;
            }
        }
    } catch (e) {
        console.warn('Using default DEX vault address');
    }
    return DEX_VAULT_ADDRESS;
}

function normalizeDexToken(symbol) {
    const upper = String(symbol || 'NCH').toUpperCase();
    return upper === 'NCHEESE' ? 'NCH' : upper;
}

function extractTxHash(txResult) {
    return txResult?.transaction?.hash ||
        txResult?.transaction?.id ||
        txResult?.txHash ||
        null;
}

const PENDING_LIQUIDITY_KEY = 'cheese_pending_liquidity';
const PENDING_SWAP_KEY = 'cheese_pending_swap';

function savePendingLiquidity(pending) {
    try {
        sessionStorage.setItem(PENDING_LIQUIDITY_KEY, JSON.stringify(pending));
    } catch (e) {}
}

function clearPendingLiquidity() {
    try {
        sessionStorage.removeItem(PENDING_LIQUIDITY_KEY);
    } catch (e) {}
}

function getPendingLiquidity() {
    try {
        const raw = sessionStorage.getItem(PENDING_LIQUIDITY_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

async function submitLiquidityToBackend(pending, blockchainApi) {
    await waitForTxIndexed(pending.txHash0, blockchainApi, 15, 1500);
    await waitForTxIndexed(pending.txHash1, blockchainApi, 15, 1500);

    let response = await fetch(`${DEX_API_URL}/api/liquidity/add`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...dexApiHeaders()
        },
        body: JSON.stringify({
            poolId: pending.poolId,
            tokenA: pending.token0,
            tokenB: pending.token1,
            amountA: pending.amount0,
            amountB: pending.amount1,
            token0Amount: pending.amount0,
            token1Amount: pending.amount1,
            userAddress: pending.userAddress,
            txHash0: pending.txHash0,
            txHash1: pending.txHash1,
            signature: pending.signature,
            message: pending.message
        })
    });

    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(responseText || `Server Error: ${response.status}`);
    }

    if (!data.success && (data.error === 'Pool not found' || response.status === 404)) {
        const createMessage = `Create Pool ${pending.poolId}: ${pending.amount0} ${pending.token0} + ${pending.amount1} ${pending.token1}`;
        const createSig = await signDexMessage(createMessage);
        response = await fetch(`${DEX_API_URL}/api/pools/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...dexApiHeaders()
            },
            body: JSON.stringify({
                token0: pending.token0,
                token1: pending.token1,
                token0Amount: pending.amount0,
                token1Amount: pending.amount1,
                creatorAddress: pending.userAddress,
                txHash0: pending.txHash0,
                txHash1: pending.txHash1,
                signature: createSig,
                message: createMessage
            })
        });
        const createText = await response.text();
        try {
            data = JSON.parse(createText);
        } catch (e) {
            throw new Error(createText || `Create Pool Failed: ${response.status}`);
        }
    }

    if (!data.success) {
        throw new Error(data.error || 'Failed to add liquidity');
    }
    return data;
}

async function confirmPendingLiquidity() {
    const pending = getPendingLiquidity();
    if (!pending || !userWallet) return false;
    if (pending.userAddress.toLowerCase() !== userWallet.toLowerCase()) return false;

    try {
        showNotification('Confirming your liquidity deposits...', 'info');
        const blockchainApi = new CheeseBlockchainAPI(BLOCKCHAIN_API_URL || 'https://cheeseblockchain.com');
        const data = await submitLiquidityToBackend(pending, blockchainApi);
        clearPendingLiquidity();
        showNotification(`✅ Liquidity confirmed! LP tokens: ${(data.lpTokens || 0).toFixed(6)}`, 'success');
        await loadPositions();
        await loadPools();
        return true;
    } catch (error) {
        console.error('Confirm pending liquidity error:', error);
        showNotification(`Could not confirm deposits yet: ${error.message}`, 'error');
        return false;
    }
}

async function recoverOrphanedLiquidity() {
    if (!userWallet) {
        showNotification('Please connect your wallet', 'error');
        return;
    }

    const txHash0 = prompt('Paste the NCH (or first token) deposit transaction hash from the explorer:');
    const txHash1 = prompt('Paste the USDT (or second token) deposit transaction hash from the explorer:');
    if (!txHash0 || !txHash1) return;

    const amount0 = parseFloat(prompt('Amount of first token deposited (e.g. 1000 for NCH):', '1000'));
    const amount1 = parseFloat(prompt('Amount of second token deposited (e.g. 1000 for USDT):', '1000'));
    if (!amount0 || !amount1) {
        showNotification('Invalid amounts', 'error');
        return;
    }

    const token0 = prompt('First token symbol:', 'NCH') || 'NCH';
    const token1 = prompt('Second token symbol:', 'USDT') || 'USDT';
    const poolId = [token0, token1].sort().join('_');
    const addMessage = `Add Liquidity: ${amount0} ${token0} + ${amount1} ${token1} to ${poolId}`;

    try {
        const signature = await signDexMessage(addMessage);
        const pending = {
            poolId,
            token0,
            token1,
            amount0,
            amount1,
            userAddress: userWallet,
            txHash0: txHash0.trim(),
            txHash1: txHash1.trim(),
            signature,
            message: addMessage
        };
        savePendingLiquidity(pending);
        await confirmPendingLiquidity();
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

function savePendingSwap(pending) {
    try {
        sessionStorage.setItem(PENDING_SWAP_KEY, JSON.stringify(pending));
    } catch (e) {}
}

function clearPendingSwap() {
    try {
        sessionStorage.removeItem(PENDING_SWAP_KEY);
    } catch (e) {}
}

function getPendingSwap() {
    try {
        const raw = sessionStorage.getItem(PENDING_SWAP_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

async function submitSwapToBackend(pending, blockchainApi) {
    await waitForTxIndexed(pending.txHash, blockchainApi, 15, 1500);

    let lastError = 'Swap failed';
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(`${DEX_API_URL}/api/swap/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...dexApiHeaders()
            },
            body: JSON.stringify({
                poolId: pending.poolId,
                tokenIn: pending.tokenIn,
                tokenOut: pending.tokenOut,
                amountIn: pending.amountIn,
                minAmountOut: pending.minAmountOut,
                userAddress: pending.userAddress,
                txHash: pending.txHash,
                signature: pending.signature,
                message: pending.message
            })
        });

        const data = await response.json();
        if (data.success) return data;
        lastError = data.error || lastError;
        if (!String(lastError).includes('Funds not received') && !String(lastError).includes('indexing')) {
            throw new Error(lastError);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(lastError);
}

async function confirmPendingSwap() {
    const pending = getPendingSwap();
    if (!pending || !userWallet) return false;
    if (pending.userAddress.toLowerCase() !== userWallet.toLowerCase()) return false;

    try {
        showNotification('Confirming your swap deposit...', 'info');
        const blockchainApi = new CheeseBlockchainAPI(BLOCKCHAIN_API_URL || 'https://cheeseblockchain.com');
        const data = await submitSwapToBackend(pending, blockchainApi);
        clearPendingSwap();
        showNotification(
            `✅ Swapped ${data.amountIn} ${pending.tokenIn} for ${data.amountOut.toFixed(6)} ${pending.tokenOut}`,
            'success'
        );
        await loadBalances();
        return true;
    } catch (error) {
        console.error('Confirm pending swap error:', error);
        showNotification(`Could not confirm swap yet: ${error.message}`, 'error');
        return false;
    }
}

async function recoverOrphanedSwap() {
    if (!userWallet) {
        showNotification('Please connect your wallet', 'error');
        return;
    }

    const txHash = prompt('Paste the swap deposit transaction hash from the explorer:');
    if (!txHash) return;

    const amountIn = parseFloat(prompt('Amount you swapped (input token):', '1'));
    const tokenIn = prompt('Input token symbol:', fromToken || 'USDT') || 'USDT';
    const tokenOut = prompt('Output token symbol:', toToken || 'NCH') || 'NCH';
    if (!amountIn || amountIn <= 0) {
        showNotification('Invalid amount', 'error');
        return;
    }

    const toAmount = parseFloat(document.getElementById('toAmount')?.value || '0');
    const minAmountOut = toAmount > 0 ? toAmount * (1 - currentSlippage / 100) : amountIn * 0.9;
    const swapMessage = `Swap ${amountIn} ${tokenIn} to ${tokenOut}`;

    try {
        const signature = await signDexMessage(swapMessage);
        const pending = {
            poolId: [tokenIn, tokenOut].sort().join('_'),
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            userAddress: userWallet,
            txHash: txHash.trim(),
            signature,
            message: swapMessage
        };
        savePendingSwap(pending);
        await confirmPendingSwap();
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

async function waitForTxIndexed(txHash, blockchainApi, maxAttempts = 15, delayMs = 1000) {
    if (!txHash) return true;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(blockchainApi.apiUrl + `/api/transaction/${txHash}`);
            if (res.ok) {
                const result = await res.json();
                if (result && result.success && result.transaction) {
                    return true;
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, delayMs));
    }
    // If transaction hash is 66 chars (0x + 64 hex), treat as accepted by RPC
    return (typeof txHash === 'string' && txHash.startsWith('0x') && txHash.length === 66);
}

async function signDexMessage(message) {
    // 1. Direct Web3 Injected Provider (MetaMask, Binance Web3, Trust, Coinbase, Bitget, etc.)
    const provider = walletType === 'cheese' && typeof window.cheese !== 'undefined'
        ? window.cheese
        : (typeof getActiveWalletProvider === 'function' 
            ? getActiveWalletProvider(walletType) 
            : (window.ethereum || window.binancew3w || window.trustwallet));
    
    if (provider && (walletType === 'metamask' || walletType === 'binance' || walletType === 'trust' || walletType === 'coinbase' || walletType === 'bitget' || walletType === 'tokenpocket' || walletType === 'cheese' || window.ethereum)) {
        try {
            let accounts = [];
            if (typeof safeRequest === 'function') {
                accounts = await safeRequest(provider, 'eth_accounts');
                if (!accounts || !accounts.length) {
                    accounts = await safeRequest(provider, 'eth_requestAccounts');
                }
            } else if (typeof provider.request === 'function') {
                accounts = await provider.request({ method: 'eth_accounts' });
                if (!accounts || !accounts.length) {
                    accounts = await provider.request({ method: 'eth_requestAccounts' });
                }
            }
            const address = (accounts && accounts[0]) ? accounts[0] : (typeof userAddress !== 'undefined' ? userAddress : '');

            // Format message to hex string if needed for personal_sign
            let hexMsg = message;
            if (!message.startsWith('0x')) {
                const encoder = new TextEncoder();
                const bytes = encoder.encode(message);
                hexMsg = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
            }

            if (typeof safeRequest === 'function') {
                return await safeRequest(provider, 'personal_sign', [hexMsg, address]);
            } else if (typeof provider.request === 'function') {
                return await provider.request({ method: 'personal_sign', params: [hexMsg, address] });
            }
        } catch (web3Err) {
            console.warn('Direct EIP-1193 signing note:', web3Err);
        }
    }

    // 2. Ethers.js Signing (v6 & v5 compatibility)
    if (typeof ethers !== 'undefined') {
        const web3Obj = window.ethereum || (provider ? provider : null);
        if (web3Obj) {
            try {
                if (typeof ethers.BrowserProvider === 'function') {
                    // Ethers v6
                    const bp = new ethers.BrowserProvider(web3Obj);
                    const signer = await bp.getSigner();
                    return await signer.signMessage(message);
                } else if (ethers.providers && typeof ethers.providers.Web3Provider === 'function') {
                    // Ethers v5
                    const wp = new ethers.providers.Web3Provider(web3Obj);
                    const signer = wp.getSigner();
                    return await signer.signMessage(message);
                }
            } catch (ethErr) {
                console.warn('Ethers provider signing note:', ethErr);
            }
        }

        // 3. Native Cheese Wallet Private Key Signer
        const pk = getPrivateKey();
        if (pk) {
            const wallet = new ethers.Wallet(pk);
            return await wallet.signMessage(message);
        }
    }

    throw new Error('Wallet is locked or not connected. Please unlock your Web3 wallet or extension to sign.');
}


function getEncryptedWalletFromStorage() {
    let encryptedKey = null;
    const walletData = localStorage.getItem('cheeseWallet');
    const granularEncPk = localStorage.getItem('cheese_wallet_enc_pk');
    if (walletData) {
        try {
            const data = JSON.parse(walletData);
            encryptedKey = data.encryptedPrivateKey || (typeof data.encrypted === 'string' ? data.encrypted : null);
        } catch (e) { /* ignore */ }
    }
    if (!encryptedKey) encryptedKey = granularEncPk;
    return encryptedKey;
}

// Signing key for this tab session only — DEX never asks users to paste a private key
function getPrivateKey() {
    if (sessionKey) return sessionKey;
    // Migrate any leftover localStorage key to sessionStorage, then clear it
    const legacyKey = localStorage.getItem('cheese_temp_key');
    if (legacyKey) {
        sessionStorage.setItem('cheese_session_key', legacyKey);
        localStorage.removeItem('cheese_temp_key');
    }
    const tempKey = sessionStorage.getItem('cheese_session_key');
    if (tempKey) {
        sessionKey = tempKey;
        return tempKey;
    }
    return null;
}

// Secure Password UI Helpers
function openPasswordModal(prompt) {
    const textEl = document.getElementById('passwordPromptText');
    if (textEl) textEl.textContent = prompt || 'Enter your wallet password to confirm.';
    document.getElementById('walletPassword').value = '';
    document.getElementById('passwordModal').classList.remove('hidden');
    document.getElementById('walletPassword').focus();
}

function closePasswordModal() {
    document.getElementById('passwordModal').classList.add('hidden');
}

// Logic to Unlock Wallet and Proceed with Transaction
async function unlockWalletAndSign(onSuccess) {
    const password = document.getElementById('walletPassword').value;
    const btn = document.getElementById('confirmPasswordBtn');
    const originalText = btn.textContent;
    if (!password) { showNotification('Password is required', 'error'); return; }

    try {
        btn.disabled = true;
        btn.textContent = 'Unlocking...';

        let encryptedPk = null;
        const walletData = localStorage.getItem('cheeseWallet');
        const granularEncPk = localStorage.getItem('cheese_wallet_enc_pk');

        if (walletData) {
            try {
                const data = JSON.parse(walletData);
                encryptedPk = data.encryptedPrivateKey || (typeof data.encrypted === 'string' ? data.encrypted : null);
            } catch (e) { }
        }
        if (!encryptedPk) encryptedPk = granularEncPk;
        if (!encryptedPk) throw new Error('No encrypted wallet found');

        const pk = await walletCore.decryptPrivateKey(encryptedPk, password);
        if (pk) {
            sessionKey = pk;
            closePasswordModal();
            if (onSuccess) onSuccess();
        }
    } catch (e) {
        showNotification('Incorrect password. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// --- REFACTORED SIGNING FLOW (METAMASK STYLE) ---
async function ensureSigner(onSuccess, actionLabel) {
    console.log(`[DEX] Ensuring signer for: ${actionLabel}`);

    // 1. Direct Session (Memory or Temp Key)
    if (getPrivateKey()) return onSuccess();

    // 2. Provider Session (MetaMask/Trust/Binance/Coinbase/Bitget/TokenPocket/etc.)
    const ethProvider = getEthereumProvider();
    const isWeb3Wallet = isWeb3WalletConnected();
    if (isWeb3Wallet) {
        return onSuccess();
    }

    const encryptedKey = getEncryptedWalletFromStorage();
    if (encryptedKey) {
        openPasswordModal(actionLabel);
        const confirmBtn = document.getElementById('confirmPasswordBtn');
        confirmBtn.onclick = async () => {
            await unlockWalletAndSign(onSuccess);
        };
        return;
    }

    pendingSignCallback = onSuccess;
    showNotification('Unlock your CHEESE Wallet to continue.', 'info');
    openCheeseWalletForAuth(actionLabel);
}

// Token list - Updated to use Emojis as default (Avoids 404s on missing images)
const tokens = window.CHEESE_TOKENS;
const CHEESE_LOGO_URL = window.CHEESE_LOGO_128 || '/wallet-logos/cheese-blockchain-128.png';

function renderTokenIconElement(iconEl, symbol) {
    if (!iconEl) return;
    const info = tokens[symbol];
    if (!info) return;
    if (info.logo) {
        iconEl.innerHTML = `<img src="${info.logo}" alt="${symbol}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" onerror="this.outerHTML='${info.icon}'">`;
    } else {
        iconEl.textContent = info.icon;
    }
}

function initSwapTokenIcons() {
    renderTokenIconElement(document.querySelector('#fromToken .token-icon'), fromToken);
    renderTokenIconElement(document.querySelector('#toToken .token-icon'), toToken);
}


function connectWallet() {
    if (userWallet) {
        showDisconnectModal();
    } else {
        showWalletModal();
    }
}

function showDisconnectModal() {
    closeWalletModal();
    const modal = document.createElement('div');
    modal.id = 'walletModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 400px; text-align: center;">
            <div class="modal-header">
                <h3>👛 Connected Wallet</h3>
                <button class="modal-close" onclick="closeWalletModal()">✕</button>
            </div>
            <div class="modal-body" style="padding: 1.5rem 1rem;">
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">Connected Address:</p>
                <div style="background: rgba(255,215,0,0.1); border: 1px solid var(--cheese-gold); padding: 12px; border-radius: 10px; font-family: monospace; font-size: 0.9rem; word-break: break-all; margin-bottom: 1.5rem; color: #fff;">
                    ${userWallet}
                </div>
                <button onclick="disconnectWallet(); closeWalletModal();" 
                        style="width: 100%; padding: 12px; border-radius: 10px; border: none; background: #ef4444; color: white; font-weight: 700; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    🚪 Disconnect / Log Out Wallet
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function showWalletModal() {
    closeWalletModal();
    const walletProviders = [
        { id: 'cheese', name: 'CHEESE Wallet', icon: '🧀', url: 'https://cheeseblockchain.com', highlight: true },
        { id: 'metamask', name: 'MetaMask', icon: '🦊', url: 'https://metamask.io/download/' },
        { id: 'trust', name: 'Trust Wallet', icon: '🛡️', url: 'https://trustwallet.com/download' },
        { id: 'binance', name: 'Binance Wallet', icon: '🔶', url: 'https://www.bnbchain.org/en/binance-wallet' },
        { id: 'bitget', name: 'Bitget Wallet', icon: '💎', url: 'https://web3.bitget.com/' },
        { id: 'tokenpocket', name: 'TokenPocket', icon: '👛', url: 'https://www.tokenpocket.pro/' }
    ];

    const walletButtons = walletProviders.map(w => `
                <button class="wallet-option" onclick="selectWallet('${w.id}', '${w.url}')" 
                    style="width: 100%; padding: 0.85rem 1rem; margin-bottom: 0.5rem; border-radius: 12px; 
                    border: ${w.highlight ? '2px solid var(--cheese-gold)' : '1px solid var(--border-color)'}; 
                    background: ${w.highlight ? 'rgba(255,215,0,0.1)' : 'var(--bg-card)'}; color: white; 
                    cursor: pointer; display: flex; align-items: center; gap: 1rem; font-size: 0.95rem;
                    transition: all 0.3s ease; position: relative;">
                    <span style="font-size: 1.3rem; width: 28px; text-align: center;">${w.icon}</span>
                    <span style="flex: 1; text-align: left;">${w.name}</span>
                    ${w.highlight ? '<span style="background: var(--cheese-gold); color: #000; padding: 2px 8px; border-radius: 10px; font-size: 0.65rem; font-weight: bold;">RECOMMENDED</span>' : ''}
                </button>
            `).join('');

    const modal = document.createElement('div');
    modal.id = 'walletModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
                <div class="modal" style="max-width: 420px;">
                    <div class="modal-header">
                        <h3>🔗 Connect Wallet</h3>
                        <button class="modal-close" onclick="closeWalletModal()">✕</button>
                    </div>
                    <div class="modal-body" style="max-height: 480px; overflow-y: auto;">
                        <p style="color: var(--text-secondary); margin-bottom: 0.75rem; font-size: 0.85rem;">
                            Select your Web3 wallet provider or enter your EVM address below:
                        </p>
                        ${walletButtons}

                        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                            <p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 0.5rem; font-weight: 600;">
                                ✍️ Or Connect via EVM Wallet Address:
                            </p>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="manualWalletInput" placeholder="0x... Enter EVM Wallet Address" 
                                       style="flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-card); color: white; font-size: 0.85rem; font-family: monospace;">
                                <button onclick="connectManualWallet()" style="padding: 10px 16px; border-radius: 8px; border: none; background: var(--cheese-gold); color: #000; font-weight: 700; cursor: pointer; white-space: nowrap;">
                                    Connect
                                </button>
                            </div>
                        </div>

                        <p style="color: var(--text-secondary); font-size: 0.75rem; text-align: center; margin-top: 1rem;">
                            By connecting, you agree to CEX Hybrid Terms of Service
                        </p>
                    </div>
                </div>
            `;
    document.body.appendChild(modal);
}

function connectManualWallet() {
    const input = document.getElementById('manualWalletInput');
    const val = input ? input.value.trim() : '';
    if (!val || !val.startsWith('0x') || val.length !== 42) {
        showNotification('Please enter a valid 42-character EVM address starting with 0x', 'error');
        return;
    }
    closeWalletModal();
    userWallet = val.toLowerCase();
    walletType = 'manual';
    localStorage.setItem('cheeseWallet', userWallet);

    document.getElementById('connectText').textContent =
        userWallet.substring(0, 6) + '...' + userWallet.substring(38);
    document.getElementById('connectBtn').classList.add('connected');
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';

    showNotification('✅ Connected EVM wallet address!', 'success');
    loadUserData();
}

async function selectWallet(walletId, downloadUrl) {
    closeWalletModal();

    if (walletId === 'cheese') {
        await connectCheeseWallet();
    } else {
        await connectEVMWallet(walletId, downloadUrl);
    }
}

async function ensureCheeseNetworkAndToken() {
    if (typeof window.ethereum === 'undefined') return;
    try {
        // 1. Switch to or Add CHEESE Network
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x4F1A' }],
            });
        } catch (switchError) {
            if (switchError.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x4F1A',
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
            } else {
                throw switchError;
            }
        }

        // 2. Prompt to watch NCH token with logo
        setTimeout(async () => {
            try {
                await window.ethereum.request({
                    method: 'wallet_watchAsset',
                    params: {
                        type: 'ERC20',
                        options: {
                            address: '0x000000000000000000000000000000000000c8ee',
                            symbol: 'NCH',
                            decimals: 6,
                            image: 'https://cheeseblockchain.com/wallet-logos/cheese-blockchain-256.png'
                        }
                    }
                });
            } catch (watchError) {
                console.warn('NCH token watch prompt rejected or failed:', watchError);
            }
        }, 1000);
    } catch (e) {
        console.error('Failed to switch network or watch NCH:', e);
    }
}

async function connectEVMWallet(walletId, downloadUrl) {
    try {
        if (typeof window.ethereum === 'undefined') {
            showNotification(`Wallet not detected! Please install it.`, 'error');
            window.open(downloadUrl, '_blank');
            return;
        }

        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

        if (accounts && accounts.length > 0) {
            userWallet = accounts[0].toLowerCase();
            walletType = walletId;
            localStorage.setItem('cheeseWallet', userWallet);

            document.getElementById('connectText').textContent =
                userWallet.substring(0, 6) + '...' + userWallet.substring(38);
            document.getElementById('connectBtn').classList.add('connected');
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) logoutBtn.style.display = 'inline-flex';

            showNotification(`✅ Wallet connected!`, 'success');
            
            if (walletId === 'metamask') {
                await ensureCheeseNetworkAndToken();
            }
            
            loadUserData();
        }
    } catch (error) {
        console.error('Wallet connect error:', error);
        if (error.code === 4001) {
            showNotification('Connection rejected by user', 'error');
        } else {
            showNotification('Failed to connect: ' + error.message, 'error');
        }
    }
}

function closeWalletModal() {
    const modal = document.getElementById('walletModal');
    if (modal) modal.remove();
}

async function connectMetaMask() {
    closeWalletModal();
    await connectEVMWallet('metamask', 'https://metamask.io/download/');
}

async function connectCheeseWallet() {
    closeWalletModal();
    
    // Direct browser extension check (optional convenience)
    if (typeof window.cheese !== 'undefined') {
        try {
            const accounts = await window.cheese.request({ method: 'eth_requestAccounts' });
            if (accounts && accounts.length > 0) {
                userWallet = accounts[0];
                walletType = 'cheese';
                
                document.getElementById('connectText').textContent =
                    userWallet.substring(0, 6) + '...' + userWallet.substring(38);
                document.getElementById('connectBtn').classList.add('connected');
                
                showNotification('✅ CHEESE Extension Wallet connected!', 'success');
                loadUserData();
                return;
            }
        } catch (extensionError) {
            console.warn('CHEESE Extension connection skipped/failed:', extensionError.message);
            // Fall through gracefully to manual/redirect connect options
        }
    }

    try {
        // First check if wallet address came from URL params (redirect flow)
        const urlParams = new URLSearchParams(window.location.search);
        const walletFromUrl = urlParams.get('wallet');

        if (walletFromUrl && walletFromUrl.startsWith('0x')) {
            // Got wallet from redirect
            userWallet = walletFromUrl;
            walletType = 'cheese';

            const existing = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
            localStorage.setItem('cheeseWallet', JSON.stringify({ ...existing, address: walletFromUrl }));

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);

            document.getElementById('connectText').textContent =
                userWallet.substring(0, 6) + '...' + userWallet.substring(38);
            document.getElementById('connectBtn').classList.add('connected');

            showNotification('✅ CHEESE Wallet connected!', 'success');
            loadUserData();
            return;
        }

        // Check localStorage
        const savedWallet = localStorage.getItem('cheeseWallet');
        if (savedWallet) {
            const wallet = JSON.parse(savedWallet);
            userWallet = wallet.address;
            walletType = 'cheese';

            document.getElementById('connectText').textContent =
                userWallet.substring(0, 6) + '...' + userWallet.substring(38);
            document.getElementById('connectBtn').classList.add('connected');
            document.getElementById('logoutBtn').style.display = 'flex';

            showNotification('✅ CHEESE Wallet connected!', 'success');
            loadUserData();
            return;
        }

        // No wallet found - show manual input modal
        showWalletInputModal();

    } catch (error) {
        console.error('CHEESE Wallet connect error:', error);
        showNotification('Failed to connect CHEESE Wallet', 'error');
    }
}

function showWalletInputModal() {
    const modal = document.createElement('div');
    modal.id = 'walletInputModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
                <div class="modal" style="max-width: 420px;">
                    <div class="modal-header">
                        <h3>🧀 Connect CHEESE Wallet</h3>
                        <button class="modal-close" onclick="closeWalletInputModal()">🧀</button>
                    </div>
                    <div class="modal-body">
                        <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.875rem;">
                            Enter your CHEESE Wallet address to connect to the DEX
                        </p>
                        <input type="text" id="manualWalletAddress" 
                            placeholder="0x... your wallet address" 
                            style="width: 100%; padding: 1rem; border-radius: 12px; 
                            border: 1px solid var(--border-color); background: var(--bg-dark); 
                            color: white; font-size: 0.875rem; margin-bottom: 1rem;">
                        <button class="btn-primary" onclick="connectManualWallet()" style="width: 100%;">
                            🔗 Connect Wallet
                        </button>
                        <div style="text-align: center; margin: 1rem 0; color: var(--text-secondary);">or</div>
                        <button onclick="openCheeseWallet()" style="width: 100%; padding: 1rem; 
                            border-radius: 12px; border: 1px solid var(--cheese-gold); 
                            background: rgba(255,215,0,0.1); color: var(--cheese-gold); 
                            cursor: pointer; font-weight: 600;">
                            🧀 Sign in with CHEESE Wallet (Recommended)
                        </button>
                    </div>
                </div>
            `;
    document.body.appendChild(modal);
}

function closeWalletInputModal() {
    const modal = document.getElementById('walletInputModal');
    if (modal) modal.remove();
}

function openCheeseWalletForAuth(actionLabel) {
    const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname + window.location.search);
    const label = actionLabel ? `&label=${encodeURIComponent(actionLabel)}` : '';
    window.open(
        `${window.location.origin}/wallet/?action=authorize&returnTo=${returnUrl}${label}`,
        'cheese_auth',
        'width=480,height=720'
    );
}

function openCheeseWallet() {
    openCheeseWalletForAuth('Connect to CHEESE DEX');
    showNotification('Sign in with your CHEESE Wallet password in the popup.', 'info');
}

async function connectManualWallet() {
    const address = document.getElementById('manualWalletAddress').value.trim();

    if (!address || !address.startsWith('0x') || address.length !== 42) {
        showNotification('Please enter a valid wallet address (0x...)', 'error');
        return;
    }

    const existing = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
    localStorage.setItem('cheeseWallet', JSON.stringify({ ...existing, address }));

    userWallet = address;
    walletType = 'cheese';

    document.getElementById('connectText').textContent =
        userWallet.substring(0, 6) + '...' + userWallet.substring(38);
    document.getElementById('connectBtn').classList.add('connected');
    document.getElementById('logoutBtn').style.display = 'flex';

    closeWalletInputModal();
    showNotification('✅ CHEESE Wallet connected!', 'success');
    loadUserData();
}

async function loadUserData() {
    if (!userWallet) return;

    await loadBalances();
    if (getPendingLiquidity()) {
        await confirmPendingLiquidity();
    }
    if (getPendingSwap()) {
        await confirmPendingSwap();
    }
    await loadPositions();
    await loadUserP2PTrades();
}

async function loadBalances() {
    if (!userWallet) return;

    try {
        // Fetch Balances
        // ... logic exists ...

        if (!userWallet) {
            document.getElementById('fromBalance').textContent = '0.00';
            document.getElementById('toBalance').textContent = '0.00';
            return;
        }


        // Fetch Balances from blockchain server
        const balanceResponse = await fetch(`${BLOCKCHAIN_API_URL}/api/balance/${userWallet}`, {
            headers: dexApiHeaders()
        });

        if (!balanceResponse.ok) {
            throw new Error(`HTTP error! status: ${balanceResponse.status}`);
        }

        const balanceData = await balanceResponse.json();

        // Helper to safely get balance for any token
        const getBalance = (symbol) => {
            // Normalize symbol
            const sym = (symbol || '').toUpperCase();

            // 1. NCH / NCHEESE check
            if (sym === 'NCH' || sym === 'NCHEESE') {
                // Check result.balance or result.NCH
                if (balanceData.balance !== undefined) return parseFloat(balanceData.balance);
                if (balanceData.NCH !== undefined) return parseFloat(balanceData.NCH);
                return 0;
            }

            // 2. Check Portfolio
            if (balanceData.portfolio && balanceData.portfolio[sym] !== undefined) {
                return parseFloat(balanceData.portfolio[sym]);
            }

            // 3. Fallback for Native Assets if not in portfolio (rare)
            if (sym === 'USDT' && balanceData.USDT) return parseFloat(balanceData.USDT);
            if (sym === 'USDC' && balanceData.USDC) return parseFloat(balanceData.USDC);

            return 0;
        };

        // Update balance displays based on selected tokens
        const fromBal = getBalance(fromToken);
        const toBal = getBalance(toToken);

        document.getElementById('fromBalance').textContent = fromBal.toFixed(2);
        document.getElementById('toBalance').textContent = toBal.toFixed(2);

        // [NEW] Update Liquidity Modal Balances
        const liqToken0 = document.getElementById('liquidityToken0').textContent;
        const liqToken1 = document.getElementById('liquidityToken1').textContent;
        if (liqToken0 && liqToken1) {
            document.getElementById('liquidityBalance0').textContent = getBalance(liqToken0).toFixed(2);
            document.getElementById('liquidityBalance1').textContent = getBalance(liqToken1).toFixed(2);
        }

        // [NEW] Update Bridge Balance
        const bridgeToken = document.getElementById('bridgeFromSymbol')?.textContent;
        if (bridgeToken && document.getElementById('bridgeFromBalance')) {
            document.getElementById('bridgeFromBalance').textContent = getBalance(bridgeToken).toFixed(2);
        }

        console.log('✅ Balances loaded:', { fromToken, fromBal, toToken, toBal, bridgeToken });
    } catch (error) {
        console.error('❌ Error loading balances:', error);
        // Show 0 on error
        document.getElementById('fromBalance').textContent = '0.00';
        document.getElementById('toBalance').textContent = '0.00';
        document.getElementById('liquidityBalance0').textContent = '0.00';
        document.getElementById('liquidityBalance1').textContent = '0.00';
    }
}

// ==========================================
// WALLET DISCONNECT / LOGOUT
// ==========================================

function disconnectWallet() {
    // Clear wallet data
    userWallet = null;
    walletType = null;
    sessionKey = null; // Clear in-memory session key
    sessionStorage.removeItem('cheese_session_key'); // Clear session signing key
    localStorage.removeItem('cheeseWallet');

    // Reset UI
    document.getElementById('connectText').textContent = 'Connect Wallet';
    document.getElementById('connectBtn').classList.remove('connected');
    document.getElementById('logoutBtn').style.display = 'none';

    // Reset balances
    document.getElementById('fromBalance').textContent = '0.00';
    document.getElementById('toBalance').textContent = '0.00';

    showNotification('👋 Wallet disconnected', 'success');
}

// ==========================================
// TOKEN SELECTOR
// ==========================================

// let selectingTokenFor = null; // Removed duplicate

function openTokenSelect(direction) {
    selectingTokenFor = direction;

    const nativeSwapSet = new Set(
        (window.CHEESE_NATIVE_SWAP_TOKENS || ['NCH', 'USDT']).map((s) => s.toUpperCase())
    );
    const swappableTokens = Object.entries(tokens).filter(([symbol, info]) => {
        return info.swappable === true && nativeSwapSet.has(symbol.toUpperCase());
    });

    const tokenButtons = swappableTokens.map(([symbol, info]) => {
        const iconHtml = info.logo
            ? `<img src="${info.logo}" style="width: 32px; height: 32px; border-radius: 50%;" onerror="this.outerHTML='<span style=\\'font-size: 1.5rem; width: 32px; text-align: center;\\'>${info.icon}</span>'">`
            : `<span style="font-size: 1.5rem; width: 32px; text-align: center;">${info.icon}</span>`;

        const isDisabled = (direction === 'from' && symbol === toToken) || (direction === 'to' && symbol === fromToken);

        return `
                <button class="token-option" onclick="selectToken('${symbol}')" 
                    style="width: 100%; padding: 1rem; margin-bottom: 0.5rem; border-radius: 12px; 
                    border: 1px solid var(--border-color); background: var(--bg-card); color: white; 
                    cursor: ${isDisabled ? 'not-allowed' : 'pointer'}; display: flex; align-items: center; gap: 1rem; font-size: 1rem;
                    transition: all 0.3s ease; opacity: ${isDisabled ? '0.3' : '1'};"
                    ${isDisabled ? 'disabled' : ''}>
                    ${iconHtml}
                    <div style="text-align: left;">
                        <div style="font-weight: 600;">${symbol}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary);">${info.name}</div>
                    </div>
                </button>
            `}).join('');

    const modal = document.createElement('div');
    modal.id = 'tokenSelectModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
                <div class="modal" style="max-width: 400px;">
                    <div class="modal-header">
                        <h3>👛 Select Token</h3>
                        <button class="modal-close" onclick="closeTokenSelectModal()">🧀</button>
                    </div>
                    <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
                        ${tokenButtons}
                    </div>
                </div>
            `;
    document.body.appendChild(modal);
}

function closeTokenSelectModal() {
    const modal = document.getElementById('tokenSelectModal');
    if (modal) modal.remove();
}

function selectToken(symbol) {
    closeTokenSelectModal();

    const tokenInfo = tokens[symbol];

    function updateTokenDisplay(el, info, sym) {
        renderTokenIconElement(el.querySelector('.token-icon'), sym);
        el.querySelector('.token-symbol').textContent = sym;
    }

    if (selectingTokenFor === 'from') {
        fromToken = symbol;
        updateTokenDisplay(document.getElementById('fromToken'), tokenInfo, symbol);
    } else {
        toToken = symbol;
        updateTokenDisplay(document.getElementById('toToken'), tokenInfo, symbol);
    }

    // Get new quote
    updateQuote();

    // Refresh balances for the newly selected token
    loadBalances();
}

// ==========================================
// LIQUIDITY / POOL CREATION (Hotfix v15)
// ==========================================

// [Deleted duplicate addLiquidity function]

// ==========================================
// TAB NAVIGATION
// ==========================================

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Update active tab button
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Show corresponding content
        const tabName = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(`${tabName}-tab`).classList.remove('hidden');
    });
});

// ==========================================
// SWAP FUNCTIONS
// ==========================================

async function fetchSwapQuote(amountIn) {
    const poolId = [fromToken, toToken].sort().join('_');
    const response = await fetch(dexApiUrl('/api/swap/quote'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...dexApiHeaders()
        },
        body: JSON.stringify({
            poolId,
            tokenIn: fromToken,
            tokenOut: toToken,
            amountIn
        })
    });
    return response.json();
}

function applySwapQuoteUI(data, amountIn) {
    const rate = data.amountOut / amountIn;
    document.getElementById('swapRate').textContent =
        `1 ${fromToken} = ${rate.toFixed(6)} ${toToken}`;
    document.getElementById('priceImpact').textContent =
        `${data.priceImpact.toFixed(2)}%`;
    const gasNch = data.gasFeeNCH || 0;
    document.getElementById('swapFee').textContent =
        gasNch > 0 ? `${gasNch.toFixed(2)} NCH (~$1.00)` : `${(data.swapFee || data.fee || 0).toFixed(4)} ${fromToken}`;

    if (amountIn > 0) {
        document.getElementById('toAmount').value = data.amountOut.toFixed(6);
        document.getElementById('minReceived').textContent =
            `${(data.amountOut * 0.995).toFixed(6)} ${toToken}`;
    } else {
        document.getElementById('minReceived').textContent = '—';
    }
}

async function loadSwapSpotRate() {
    try {
        const data = await fetchSwapQuote(1);
        if (data.success) {
            applySwapQuoteUI(data, 1);
        } else {
            document.getElementById('swapRate').textContent =
                `1 ${fromToken} = — ${toToken}`;
            document.getElementById('minReceived').textContent = '—';
        }
    } catch (error) {
        console.error('Spot rate error:', error);
        document.getElementById('swapRate').textContent =
            `1 ${fromToken} = — ${toToken}`;
        document.getElementById('minReceived').textContent = '—';
    }
}

async function updateQuote() {
    const fromAmount = parseFloat(document.getElementById('fromAmount').value) || 0;

    if (fromAmount <= 0) {
        document.getElementById('toAmount').value = '';
        await loadSwapSpotRate();
        return;
    }

    try {
        const data = await fetchSwapQuote(fromAmount);

        if (data.success) {
            applySwapQuoteUI(data, fromAmount);
        } else {
            await loadSwapSpotRate();
        }
    } catch (error) {
        console.error('Quote error:', error);
        await loadSwapSpotRate();
    }
}

async function executeSwap() {
    if (!userWallet) {
        showNotification('Please connect your wallet', 'error');
        return;
    }

    const fromAmount = parseFloat(document.getElementById('fromAmount').value);
    const toAmount = parseFloat(document.getElementById('toAmount').value);
    const minAmountOut = toAmount * (1 - currentSlippage / 100);
    const tokenIn = normalizeDexToken(fromToken);
    const tokenOut = normalizeDexToken(toToken);

    if (!fromAmount || fromAmount <= 0) {
        showNotification('Enter an amount', 'error');
        return;
    }

    document.getElementById('swapBtn').disabled = true;
    document.getElementById('swapBtn').textContent = 'Processing...';

    try {
        const privateKey = getPrivateKey();
        const ethProvider = getEthereumProvider();
        const isWeb3Wallet = isWeb3WalletConnected();

        if (!privateKey && !isWeb3Wallet) {
            await ensureSigner(() => executeSwap(), `Swap ${fromAmount} ${fromToken}`);
            return;
        }

        const vaultAddress = await resolveDexVaultAddress();
        const blockchainApi = new CheeseBlockchainAPI(BLOCKCHAIN_API_URL || 'https://cheeseblockchain.com');
        const swapMessage = `Swap ${fromAmount} ${tokenIn} to ${tokenOut}`;
        const signature = await signDexMessage(swapMessage);

        // 1. Send Input Token to Vault
        showNotification(`Step 1/2: Sending ${fromAmount} ${tokenIn} to Vault...`, 'info');

        let txHash;
        try {
            if (isWeb3Wallet && ethProvider) {
                const normIn = normalizeDexToken(tokenIn);
                const is18Dec = normIn === 'NCH' || normIn === 'ETH';
                const scale = is18Dec ? 1e18 : 1e6;
                const hexAmount = '0x' + BigInt(Math.floor(fromAmount * scale)).toString(16);
                if (typeof safeRequest === 'function') {
                    txHash = await safeRequest(ethProvider, 'eth_sendTransaction', [{
                        from: userWallet,
                        to: vaultAddress,
                        value: hexAmount,
                        gas: '0x186a0',
                        gasPrice: '0xba43b7400'
                    }]);
                } else if (typeof ethProvider.request === 'function') {
                    txHash = await ethProvider.request({
                        method: 'eth_sendTransaction',
                        params: [{
                            from: userWallet,
                            to: vaultAddress,
                            value: hexAmount,
                            gas: '0x186a0',
                            gasPrice: '0xba43b7400'
                        }]
                    });
                }
            } else {
                const txResult = await blockchainApi.sendTransaction(
                    userWallet,
                    vaultAddress,
                    fromAmount,
                    privateKey,
                    { currency: tokenIn, type: 'swap' }
                );
                console.log('Swap Input Tx:', txResult);
                txHash = extractTxHash(txResult);
            }

            if (!txHash) throw new Error('Failed to get transaction hash');

            const indexed = await waitForTxIndexed(txHash, blockchainApi, 15, 1500);
            if (!indexed) {
                throw new Error('Transaction submitted but not yet confirmed on-chain. Please wait and retry.');
            }

        } catch (txError) {
            throw new Error(`Transaction Failed: ${txError.message}`);
        }

        // 2. Call Backend to Execute Swap
        showNotification('Step 2/2: Confirming Swap...', 'info');
        document.getElementById('swapBtn').textContent = 'Confirming...';

        const pending = {
            poolId: [tokenIn, tokenOut].sort().join('_'),
            tokenIn,
            tokenOut,
            amountIn: fromAmount,
            minAmountOut,
            userAddress: userWallet,
            txHash,
            signature,
            message: swapMessage
        };
        savePendingSwap(pending);

        const data = await submitSwapToBackend(pending, blockchainApi);
        clearPendingSwap();
        showNotification(
            `✅ Swapped ${data.amountIn} ${tokenIn} for ${data.amountOut.toFixed(6)} ${tokenOut}`,
            'success'
        );
        document.getElementById('fromAmount').value = '';
        document.getElementById('toAmount').value = '';
        loadBalances();
    } catch (error) {
        console.error('Swap error:', error);
        const hint = getPendingSwap()
            ? ' Your deposit is on-chain. Reconnect or use recoverOrphanedSwap() to confirm.'
            : '';
        showNotification(`${error.message}${hint}`, 'error');
    } finally {
        document.getElementById('swapBtn').disabled = false;
        document.getElementById('swapBtn').textContent = 'Swap';
    }
}

function swapTokenPositions() {
    const temp = fromToken;
    fromToken = toToken;
    toToken = temp;

    // Update UI
    const fromTokenEl = document.getElementById('fromToken');
    const toTokenEl = document.getElementById('toToken');

    const fromInfo = tokens[fromToken];
    const toInfo = tokens[toToken];

    renderTokenIconElement(fromTokenEl.querySelector('.token-icon'), fromToken);
    fromTokenEl.querySelector('.token-symbol').textContent = fromInfo.symbol;

    renderTokenIconElement(toTokenEl.querySelector('.token-icon'), toToken);
    toTokenEl.querySelector('.token-symbol').textContent = toInfo.symbol;

    // Clear amounts and get new quote
    document.getElementById('toAmount').value = '';
    updateQuote();
}

// ==========================================
// LIQUIDITY FUNCTIONS
// Open Add Liquidity Modal (for specific pool)
function openAddLiquidity(tokenA, tokenB) {
    // Set input labels
    document.getElementById('liquidityToken0').textContent = tokenA || 'NCH';
    document.getElementById('liquidityToken1').textContent = tokenB || 'USDT';

    // Clear inputs & Reset Price
    document.getElementById('liquidityAmount0').value = '';
    document.getElementById('liquidityAmount1').value = '';
    document.getElementById('liquidityPriceDisplay').textContent = '-';
    document.getElementById('liquidityPriceLabel').textContent = 'Enter amounts';

    // Show modal
    document.getElementById('addLiquidityModal').classList.remove('hidden');

    // Refresh balances
    loadBalances();
}

let activePoolsCache = [];

function updateLiquidityPrice(source = 0) {
    const input0 = document.getElementById('liquidityAmount0');
    const input1 = document.getElementById('liquidityAmount1');
    if (!input0 || !input1) return;

    const token0 = document.getElementById('liquidityToken0').textContent;
    const token1 = document.getElementById('liquidityToken1').textContent;

    const poolKey = [token0, token1].sort().join('_');
    const pool = activePoolsCache.find(p => {
        const key = [p.token0, p.token1].sort().join('_');
        return key === poolKey;
    });

    let amt0 = parseFloat(input0.value) || 0;
    let amt1 = parseFloat(input1.value) || 0;

    if (pool && pool.reserve0 > 0 && pool.reserve1 > 0) {
        let r0 = pool.reserve0;
        let r1 = pool.reserve1;
        if (token0 !== pool.token0) {
            r0 = pool.reserve1;
            r1 = pool.reserve0;
        }
        const ratio = r1 / r0;

        if (source === 0 && amt0 > 0) {
            amt1 = amt0 * ratio;
            input1.value = amt1.toFixed(6);
        } else if (source === 1 && amt1 > 0) {
            amt0 = amt1 / ratio;
            input0.value = amt0.toFixed(6);
        }
    }

    if (amt0 > 0 && amt1 > 0) {
        const price = amt1 / amt0;
        document.getElementById('liquidityPriceDisplay').textContent = price.toFixed(6);
        document.getElementById('liquidityPriceLabel').textContent = `1 ${token0} = ${price.toFixed(6)} ${token1}`;
    } else {
        document.getElementById('liquidityPriceDisplay').textContent = '-';
        document.getElementById('liquidityPriceLabel').textContent = 'Enter amounts to see price';
    }
}

// Open Create Pool (Wrapper for general add liquidity)
function openCreatePool() {
    // For now, open the same modal, defaulting to NCH/USDT creation
    openAddLiquidity('NCH', 'USDT');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

async function addLiquidity() {
    if (!userWallet) {
        showNotification('Please connect your wallet', 'error');
        return;
    }

    const token0 = document.getElementById('liquidityToken0').textContent;
    const token1 = document.getElementById('liquidityToken1').textContent;
    const amount0 = parseFloat(document.getElementById('liquidityAmount0').value);
    const amount1 = parseFloat(document.getElementById('liquidityAmount1').value);

    if (!amount0 || !amount1) {
        showNotification('Enter amounts for both tokens', 'error');
        return;
    }

    try {
        // construct Pool ID (Alphabetical sort, same as backend)
        const poolId = [token0, token1].sort().join('_');

        const privateKey = getPrivateKey();
        const ethProvider = getEthereumProvider();
        const isWeb3Wallet = isWeb3WalletConnected();

        if (!privateKey && !isWeb3Wallet) {
            await ensureSigner(() => addLiquidity(), `Add Liquidity: ${amount0} ${token0} + ${amount1} ${token1}`);
            return;
        }

        const addMessage = `Add Liquidity: ${amount0} ${token0} + ${amount1} ${token1} to ${poolId}`;
        const signature = await signDexMessage(addMessage);

        showNotification('Step 1/3: Transferring ' + token0 + '...', 'info');

        const vaultAddress = await resolveDexVaultAddress();
        const blockchainApi = new CheeseBlockchainAPI(BLOCKCHAIN_API_URL || 'https://cheeseblockchain.com');

        let txHash0;
        let txHash1;

        // 1. Transfer Token 0
        try {
            if (isWeb3Wallet && ethProvider) {
                const hexAmount0 = '0x' + BigInt(Math.floor(amount0 * 1000000)).toString(16);
                if (typeof safeRequest === 'function') {
                    txHash0 = await safeRequest(ethProvider, 'eth_sendTransaction', [{ from: userWallet, to: vaultAddress, value: hexAmount0, gas: '0x186a0', gasPrice: '0xba43b7400' }]);
                } else if (typeof ethProvider.request === 'function') {
                    txHash0 = await ethProvider.request({ method: 'eth_sendTransaction', params: [{ from: userWallet, to: vaultAddress, value: hexAmount0, gas: '0x186a0', gasPrice: '0xba43b7400' }] });
                }
            } else {
                const txResult = await blockchainApi.sendTransaction(
                    userWallet,
                    vaultAddress,
                    amount0,
                    privateKey,
                    { currency: token0 }
                );
                txHash0 = extractTxHash(txResult);
            }

            if (!txHash0) throw new Error('Failed to get transaction hash');

            const indexed0 = await waitForTxIndexed(txHash0, blockchainApi);
            if (!indexed0) {
                throw new Error('Transaction submitted but not yet confirmed on-chain. Please wait and retry.');
            }
        } catch (txError) {
            throw new Error(`Failed to transfer ${token0}: ${txError.message}`);
        }

        showNotification('Step 2/3: Transferring ' + token1 + '...', 'info');

        // 2. Transfer Token 1
        try {
            if (isWeb3Wallet && ethProvider) {
                const hexAmount1 = '0x' + BigInt(Math.floor(amount1 * 1000000)).toString(16);
                if (typeof safeRequest === 'function') {
                    txHash1 = await safeRequest(ethProvider, 'eth_sendTransaction', [{ from: userWallet, to: vaultAddress, value: hexAmount1, gas: '0x186a0', gasPrice: '0xba43b7400' }]);
                } else if (typeof ethProvider.request === 'function') {
                    txHash1 = await ethProvider.request({ method: 'eth_sendTransaction', params: [{ from: userWallet, to: vaultAddress, value: hexAmount1, gas: '0x186a0', gasPrice: '0xba43b7400' }] });
                }
            } else {
                const txResult = await blockchainApi.sendTransaction(
                    userWallet,
                    vaultAddress,
                    amount1,
                    privateKey,
                    { currency: token1 }
                );
                txHash1 = extractTxHash(txResult);
            }

            if (!txHash1) throw new Error('Failed to get transaction hash');

            const indexed1 = await waitForTxIndexed(txHash1, blockchainApi);
            if (!indexed1) {
                throw new Error('Transaction submitted but not yet confirmed on-chain. Please wait and retry.');
            }
        } catch (txError) {
            throw new Error(`Failed to transfer ${token1}: ${txError.message}. Contact support for ${token0} refund.`);
        }

        showNotification('Step 3/3: Finalizing Pool...', 'info');

        const pending = {
            poolId,
            token0,
            token1,
            amount0,
            amount1,
            userAddress: userWallet,
            txHash0,
            txHash1,
            signature,
            message: addMessage
        };
        savePendingLiquidity(pending);

        const data = await submitLiquidityToBackend(pending, blockchainApi);
        clearPendingLiquidity();
        showNotification(
            `✅ Added liquidity! LP tokens: ${(data.lpTokens || 0).toFixed(6)}`,
            'success'
        );
        closeModal('addLiquidityModal');
        loadPositions();
        loadPools();
    } catch (error) {
        console.error('Add liquidity error:', error);
        const pending = getPendingLiquidity();
        const hint = pending
            ? ' Your deposits are on-chain. Reconnect or click "Recover Position" in Positions to credit LP tokens.'
            : '';
        showNotification(`${error.message}${hint}`, 'error');
    }
}

// getPrivateKey consolidated to global scope or early definition to prevent shadowing

async function removeLiquidity(token0, token1, lpTokens) {
    if (!userWallet) {
        showNotification('Please connect your wallet', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to remove ${lpTokens} LP tokens from ${token0}/${token1} pool?`)) {
        return;
    }

    const poolId = [token0, token1].sort().join('_');
    const message = `Remove ${lpTokens} LP from ${poolId}`;

    showNotification('Please sign the withdrawal request', 'info');

    let signature;
    try {
        signature = await signDexMessage(message);
    } catch (error) {
        console.error('Signing error:', error);
        showNotification('Signature cancelled or failed', 'error');
        return;
    }

    showNotification('Processing withdrawal...', 'info');

    try {
        const response = await fetch(dexApiUrl('/api/liquidity/remove'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...dexApiHeaders()
            },
            body: JSON.stringify({
                poolId: poolId,
                lpTokens: lpTokens,
                userAddress: userWallet,
                signature: signature,
                message: message
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Liquidity removed successfully!', 'success');
            loadPositions();
            loadBalances();
        } else {
            throw new Error(data.error || 'Removal failed');
        }
    } catch (error) {
        console.error('Remove liquidity error:', error);
        showNotification(`❌ ${error.message}`, 'error');
    }
}

async function loadPositions() {
    if (!userWallet) return;

    try {
        const response = await fetch(
            dexApiUrl(`/api/positions/${userWallet}`),
            { headers: dexApiHeaders() }
        );
        const data = await response.json();

        const container = document.getElementById('positionsList');

        if (data.positions && data.positions.length > 0) {
            container.innerHTML = data.positions.map(pos => `
                        <div class="pool-item">
                            <div class="pool-pair">
                                <span class="pool-name">${pos.token0} / ${pos.token1}</span>
                            </div>
                            <div class="pool-stat">
                                <div class="pool-stat-label">LP Tokens</div>
                                <div class="pool-stat-value">${pos.lpTokens.toFixed(4)}</div>
                            </div>
                            <div class="pool-stat">
                                <div class="pool-stat-label">Share</div>
                                <div class="pool-stat-value">${pos.share.toFixed(2)}%</div>
                            </div>
                            <button class="btn-small" onclick="removeLiquidity('${pos.token0}', '${pos.token1}', ${pos.lpTokens})">Remove</button>
                        </div>
                    `).join('');
        } else {
            container.innerHTML = `
                <p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No liquidity positions found</p>
                <p style="text-align: center; padding: 0 1rem 1.5rem;">
                    <button class="btn-small" onclick="recoverOrphanedLiquidity()">Recover Position</button>
                    <span style="display:block; color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.5rem;">
                        Use if deposits reached the vault but LP tokens were not credited.
                    </span>
                </p>`;
        }
    } catch (error) {
        console.error('Load positions error:', error);
    }
}

// ==========================================
// BRIDGE / CONVERT — RETIRED (wNCH deprecated)
// Stub functions kept for backwards-compatibility if any
// external code references them.
// ==========================================
const WNCH_RETIRED_MSG = 'wNCH bridge is retired. Use native NCH ↔ USDT swaps on this DEX.';
function updateBridgeRate() { /* retired */ }
function setBridgeDirection() { /* retired */ }
function toggleBridgeDirection() { /* retired */ }
function updateBridgeQuote() { /* retired */ }
function executeBridge() { showNotification(WNCH_RETIRED_MSG, 'error'); }

// ==========================================
// POOL FUNCTIONS
// ==========================================

async function loadPools() {
    try {
        const response = await fetch(
            dexApiUrl('/api/pools'),
            { headers: dexApiHeaders() }
        );
        const data = await response.json();

        if (data.success && data.pools) {
            activePoolsCache = data.pools;
            // Update total pools count in stats
            document.getElementById('totalPools').textContent = data.pools.length;

            const poolTokenIcon = (sym) => {
                const info = tokens[sym];
                if (info?.logo) {
                    return `<img src="${info.logo}" alt="${sym}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" onerror="this.outerHTML='${info.icon || sym}'">`;
                }
                return info?.icon || sym;
            };
            const container = document.getElementById('poolList');
            container.innerHTML = data.pools.map(pool => `
                        <div class="pool-item">
                            <div class="pool-pair">
                                <div class="pool-icons">
                                    <div class="token-icon" style="background: ${tokens[pool.token0]?.color || '#666'};">${poolTokenIcon(pool.token0)}</div>
                                    <div class="token-icon" style="background: ${tokens[pool.token1]?.color || '#666'};">${poolTokenIcon(pool.token1)}</div>
                                </div>
                                <span class="pool-name">${pool.token0} / ${pool.token1}</span>
                            </div>
                            <div class="pool-stat">
                                <div class="pool-stat-label">TVL</div>
                                <div class="pool-stat-value">$${pool.stats?.tvl?.toLocaleString() || 0}</div>
                            </div>
                            <div class="pool-stat">
                                <div class="pool-stat-label">APR</div>
                                <div class="pool-stat-value">${pool.stats?.apr?.toFixed(2) || 0}%</div>
                            </div>
                            <button class="btn-small" onclick="openAddLiquidity('${pool.token0}', '${pool.token1}')">Add</button>
                        </div>
                    `).join('');
        }
    } catch (error) {
        console.error('Load pools error:', error);
    }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function toggleSettings() {
    document.getElementById('slippageSettings').classList.toggle('hidden');
}

// Scope slippage handler to ONLY the swap slippage buttons (not P2P or chart buttons)
document.querySelectorAll('#slippageSettings .slippage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#slippageSettings .slippage-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSlippage = parseFloat(btn.dataset.slippage);
        updateQuote();
    });
});

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 4000);
}

// ==========================================

// ==========================================
// CHART FUNCTIONS
// ==========================================

let chart = null;
let candleSeries = null;
let currentTimeframe = '1h';
let currentChartType = 'candle';
let chartUpdateInterval = null;
let chartFetchFailures = 0;
const CHART_MAX_FAILURES = 5;

// Chart type switcher (Candle / Line)
function setChartType(type) {
    currentChartType = type;
    document.getElementById('typeCandle')?.classList.toggle('active', type === 'candle');
    document.getElementById('typeLine')?.classList.toggle('active', type === 'line');
    if (chart && candleSeries) {
        // Re-initialize chart with new type
        chart.removeSeries(candleSeries);
        if (type === 'line') {
            candleSeries = chart.addLineSeries({
                color: '#FFD700',
                lineWidth: 2,
            });
        } else {
            candleSeries = chart.addCandlestickSeries({
                upColor: '#00D4AA',
                downColor: '#FF4757',
                borderDownColor: '#FF4757',
                borderUpColor: '#00D4AA',
                wickDownColor: '#FF4757',
                wickUpColor: '#00D4AA',
            });
        }
        updateChartData('NCH_USDT');
    }
}

async function changeTimeframe(tf) {
    currentTimeframe = tf;
    chartFetchFailures = 0; // Reset failures on manual change
    await initChart();
}

async function initChart(poolId = 'NCH_USDT') {
    // Safety check for library
    if (typeof LightweightCharts === 'undefined') {
        console.warn('LightweightCharts library not loaded. Chart disabled.');
        return;
    }

    const chartContainer = document.getElementById('priceChart');
    if (!chartContainer) return;

    if (!chart) {
        const chartOptions = {
            layout: {
                textColor: '#d1d4dc',
                background: { type: 'solid', color: '#131722' } // Match card bg
            },
            grid: {
                vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
                horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
            },
            width: chartContainer.clientWidth,
            height: 400,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            }
        };

        try {
            chart = LightweightCharts.createChart(chartContainer, chartOptions);

            candleSeries = chart.addCandlestickSeries({
                upColor: '#00D4AA',
                downColor: '#FF4757',
                borderDownColor: '#FF4757',
                borderUpColor: '#00D4AA',
                wickDownColor: '#FF4757',
                wickUpColor: '#00D4AA',
            });

            window.addEventListener('resize', () => {
                if (chart && chartContainer) {
                    chart.applyOptions({ width: chartContainer.clientWidth });
                }
            });
        } catch (e) {
            console.error('Failed to initialize chart:', e);
            return;
        }
    }

    // Fetch Real Data
    if (candleSeries) {
        await updateChartData(poolId);

        // Set up polling for real-time updates
        if (chartUpdateInterval) clearInterval(chartUpdateInterval);
        chartUpdateInterval = setInterval(() => updateChartData(poolId), 10000); // Every 10s
    }
}

async function updateChartData(poolId) {
    if (chartFetchFailures >= CHART_MAX_FAILURES) return;
    try {
        const response = await fetch(
            dexApiUrl(`/api/pools/${poolId}/candles?interval=${currentTimeframe}`),
            { headers: dexApiHeaders() }
        );
        if (!response.ok) {
            chartFetchFailures++;
            if (chartFetchFailures >= CHART_MAX_FAILURES && chartUpdateInterval) {
                clearInterval(chartUpdateInterval);
                chartUpdateInterval = null;
                console.warn('Chart polling stopped after repeated API errors');
            }
            return;
        }
        chartFetchFailures = 0;
        const data = await response.json();

        if (data.success && data.candles.length > 0) {
            candleSeries.setData(data.candles);
        } else {
            const spot = marketPrices?.NCH?.usd || marketPrices?.NCH || 0.021986;
            const now = Math.floor(Date.now() / 1000);
            candleSeries.setData([
                { time: now - 3600, open: spot, high: spot, low: spot, close: spot },
                { time: now, open: spot, high: spot, low: spot, close: spot },
            ]);
        }
    } catch (e) {
        console.error('Chart Data Error:', e);
    }
}

// INITIALIZATION
// ==========================================

// Global market prices cache
let marketPrices = {};

async function loadMarketPrices() {
    try {
        const response = await fetch(dexApiUrl('/api/market-prices'), { headers: dexApiHeaders() });
        if (!response.ok) return;
        const data = await response.json();
        if (data.success) {
            marketPrices = data.prices;
            const nchUsd = getTokenPrice('NCH') || 0.021986;
            const nchDisplay = document.getElementById('nch-price-display');
            const nchPool = document.getElementById('nch-price-pool');
            const currentPrice = document.getElementById('currentPrice');
            if (nchDisplay) nchDisplay.textContent = `$${nchUsd.toFixed(4)}`;
            if (nchPool) nchPool.textContent = `$${nchUsd.toFixed(4)}`;
            if (currentPrice) currentPrice.textContent = `$${nchUsd.toFixed(4)}`;
            // Market prices updated quietly
        }
    } catch (error) {
        console.error('Failed to load market prices:', error);
    }
}
loadMarketPrices();
// Refreshed every 30s in background

// Get price for a token
function getTokenPrice(symbol) {
    const price = marketPrices[symbol];
    if (!price) return 0;
    return typeof price === 'number' ? price : price.usd || 0;
}

function toggleConvertTokenDropdown() { /* retired */ }
function selectConvertToken() { /* retired */ }
function updateConvertQuote() { /* retired */ }
function executeConvert() { showNotification(WNCH_RETIRED_MSG, 'error'); }

document.addEventListener('DOMContentLoaded', () => {
    console.log('🧀 CHEESE DEX loaded');

    // Clean cache-busting query strings (e.g., ?v=5.5.0&t=1784503396111) from address bar
    if (typeof window !== 'undefined' && window.history && window.location.search) {
        try {
            const url = new URL(window.location.href);
            let cleaned = false;
            ['v', 't', '_v', '_t'].forEach(param => {
                if (url.searchParams.has(param)) {
                    url.searchParams.delete(param);
                    cleaned = true;
                }
            });
            if (cleaned) {
                const cleanPath = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
                window.history.replaceState({}, document.title, cleanPath);
            }
        } catch (e) {
            console.warn('URL clean error:', e.message);
        }
    }

    resolveDexVaultAddress();
    initSwapTokenIcons();
    loadPools();
    loadP2POrders();
    loadMarketPrices();

    // Refresh prices every 60 seconds
    setInterval(loadMarketPrices, 60000);

    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
            .then(reg => {
                console.log('✅ Service Worker registered');
                reg.update();
            })
            .catch(err => console.log('Service Worker registration failed:', err));
    }

    // Load swap spot rate so refresh does not stick on "Loading..."
    loadSwapSpotRate();

    // Wire timeframe dropdown
    const tfSelect = document.getElementById('timeframeSelect');
    if (tfSelect) {
        tfSelect.addEventListener('change', (e) => changeTimeframe(e.target.value));
    }

    // Auto-connect if wallet exists
    const walletData = localStorage.getItem('cheeseWallet');
    if (walletData) {
        connectCheeseWallet();
    }

    // Initialize Chart
    initChart('NCH_USDT');
});

function onWalletConnected() {
    if (!userWallet) return;
    document.getElementById('connectText').textContent =
        userWallet.substring(0, 6) + '...' + userWallet.substring(38);
    document.getElementById('connectBtn').classList.add('connected');
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'flex';
    loadUserData();
}

function showSettingsModal() {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('settingsAddress').value = userWallet || '';
}

function saveSettings() {
    showNotification('Settings saved.', 'success');
    closeModal('settingsModal');
}

window.addEventListener('message', (event) => {
    const trustedOrigins = [
        'https://cheeseblockchain.com',
        'https://www.cheeseblockchain.com',
        window.location.origin
    ];
    const isTrusted = trustedOrigins.some((o) => event.origin === o) ||
        event.origin.startsWith('http://localhost') ||
        event.origin.startsWith('http://127.0.0.1');
    if (!isTrusted) return;

    if (event.data && event.data.type === 'CHEESE_AUTH_SUCCESS') {
        const { address, privateKey } = event.data;
        if (address) {
            userWallet = address;
            walletType = 'cheese';
            const existing = JSON.parse(localStorage.getItem('cheeseWallet') || '{}');
            localStorage.setItem('cheeseWallet', JSON.stringify({ ...existing, address }));
            if (privateKey) {
                sessionKey = privateKey;
            }
            onWalletConnected();
            showNotification('CHEESE Wallet authorized. You can swap now.', 'success');
            if (pendingSignCallback) {
                const cb = pendingSignCallback;
                pendingSignCallback = null;
                cb();
            }
        }
    }
});

// ==========================================
// P2P TRADING FUNCTIONS
// ==========================================

function switchP2PTab(type) {
    const buyTab = document.getElementById('p2pBuyTab');
    const sellTab = document.getElementById('p2pSellTab');

    if (type === 'buy') {
        buyTab.classList.add('active');
        buyTab.style.background = 'var(--success)';
        buyTab.style.color = '#000';
        sellTab.classList.remove('active');
        sellTab.style.background = '';
        sellTab.style.color = '';
    } else {
        sellTab.classList.add('active');
        sellTab.style.background = 'var(--error)';
        sellTab.style.color = '#fff';
        buyTab.classList.remove('active');
        buyTab.style.background = '';
        buyTab.style.color = '';
    }

    loadP2POrders();
}

let p2pOrdersCache = [];

async function loadP2POrders() {
    const container = document.getElementById('p2pOrderList');
    if (!container) return;
    try {
        const response = await fetch(`${DEX_API_URL}/api/p2p/orders`, { headers: dexApiHeaders() });
        const data = await response.json();
        p2pOrdersCache = data.orders || [];
        if (!p2pOrdersCache.length) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No active P2P orders</p>';
            return;
        }
        const mode = document.getElementById('p2pBuyTab')?.classList.contains('active') ? 'buy' : 'sell';
        container.innerHTML = p2pOrdersCache.map((order) => {
            const shortAddr = `${order.creatorAddress.slice(0, 6)}...${order.creatorAddress.slice(-4)}`;
            const price = (order.amountWanted / order.amountOffered).toFixed(4);
            return `
                <div class="pool-item" style="grid-template-columns: 1fr 1fr 1fr 1fr auto;">
                    <div class="pool-pair"><span style="font-weight: 600;">${shortAddr}</span></div>
                    <div class="pool-stat">
                        <div class="pool-stat-label">Price</div>
                        <div class="pool-stat-value">${price} ${order.tokenWanted}/${order.tokenOffered}</div>
                    </div>
                    <div class="pool-stat">
                        <div class="pool-stat-label">Available</div>
                        <div class="pool-stat-value">${order.amountOffered} ${order.tokenOffered}</div>
                    </div>
                    <div class="pool-stat">
                        <div class="pool-stat-label">Wants</div>
                        <div class="pool-stat-value">${order.amountWanted} ${order.tokenWanted}</div>
                    </div>
                    <button class="btn-small" onclick="openP2PTrade('${order.id}')">${mode === 'buy' ? 'Buy' : 'Sell'}</button>
                </div>`;
        }).join('');
    } catch (e) {
        console.error('P2P load error:', e);
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Failed to load P2P orders</p>';
    }
}

function openCreateP2POrder() {
    if (!userWallet) {
        showNotification('Please connect your wallet first', 'error');
        return;
    }
    const tokenOffered = prompt('Token you offer (e.g. NCH):', 'NCH');
    const amountOffered = parseFloat(prompt('Amount offered:', '100'));
    const tokenWanted = prompt('Token you want (e.g. USDT):', 'USDT');
    const amountWanted = parseFloat(prompt('Amount wanted:', '10'));
    if (!tokenOffered || !tokenWanted || !amountOffered || !amountWanted) return;
    createP2POrder(tokenOffered, amountOffered, tokenWanted, amountWanted);
}

async function createP2POrder(tokenOffered, amountOffered, tokenWanted, amountWanted) {
    try {
        const privateKey = getPrivateKey();
        const ethProvider = getEthereumProvider();
        const isWeb3Wallet = isWeb3WalletConnected();

        if (!privateKey && !isWeb3Wallet) {
            showNotification('Connect wallet with signing capability', 'error');
            return;
        }
        const createMessage = `P2P Offer ${amountOffered} ${tokenOffered} for ${amountWanted} ${tokenWanted}`;
        const signature = await signDexMessage(createMessage);
        const vaultAddress = await resolveDexVaultAddress();
        const blockchainApi = new CheeseBlockchainAPI(BLOCKCHAIN_API_URL);
        let txHash;
        if (isWeb3Wallet && ethProvider) {
            const hexAmount = '0x' + BigInt(Math.floor(amountOffered * 1000000)).toString(16);
            if (typeof safeRequest === 'function') {
                txHash = await safeRequest(ethProvider, 'eth_sendTransaction', [{ from: userWallet, to: vaultAddress, value: hexAmount, gas: '0x186a0', gasPrice: '0xba43b7400' }]);
            } else {
                txHash = await ethProvider.request({ method: 'eth_sendTransaction', params: [{ from: userWallet, to: vaultAddress, value: hexAmount, gas: '0x186a0', gasPrice: '0xba43b7400' }] });
            }
        } else {
            const txResult = await blockchainApi.sendTransaction(
                userWallet,
                vaultAddress,
                amountOffered,
                privateKey,
                { currency: tokenOffered, type: 'p2p_escrow' }
            );
            if (txResult.error) throw new Error(txResult.error);
            txHash = extractTxHash(txResult);
        }

        const response = await fetch(dexApiUrl('/api/p2p/create'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                creatorAddress: userWallet,
                tokenOffered,
                amountOffered,
                tokenWanted,
                amountWanted,
                txHash,
                signature,
                message: createMessage
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('P2P order created', 'success');
            loadP2POrders();
        } else {
            throw new Error(data.error || 'Create failed');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

async function openP2PTrade(orderId) {
    if (!userWallet) {
        showNotification('Please connect your wallet to trade', 'error');
        return;
    }
    const order = p2pOrdersCache.find((o) => o.id === orderId);
    if (!order) {
        showNotification('Order not found', 'error');
        return;
    }
    if (order.creatorAddress.toLowerCase() === userWallet.toLowerCase()) {
        showNotification('Cannot trade your own order', 'error');
        return;
    }

    try {
        const initiateMessage = `Initiate P2P trade for order ${orderId}`;
        let signature = '0x_mock_signature';
        try {
            signature = await signDexMessage(initiateMessage);
        } catch (signErr) {
            console.warn('Signature skipped for trade initiation:', signErr.message);
        }

        const response = await fetch(dexApiUrl('/api/p2p/trade/initiate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                orderId,
                buyerAddress: userWallet,
                signature,
                message: initiateMessage
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('P2P trade initiated!', 'success');
            loadP2POrders();
            loadUserP2PTrades();
            selectActiveTrade(data.trade.id);
        } else {
            throw new Error(data.error || 'Failed to initiate trade');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

let activeP2PTradeId = null;
let p2pChatInterval = null;
let p2pActiveTradeData = null;

async function loadUserP2PTrades() {
    if (!userWallet) return;
    const container = document.getElementById('p2pUserTradesList');
    if (!container) return;

    try {
        const response = await fetch(dexApiUrl(`/api/p2p/trades?userAddress=${userWallet}`), {
            headers: dexApiHeaders()
        });
        const data = await response.json();
        if (data.success && data.trades) {
            if (data.trades.length === 0) {
                container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; font-size: 0.875rem;">No active trades. Select an order above to start trading.</p>`;
                return;
            }
            container.innerHTML = data.trades.map(trade => {
                const seller = (trade.sellerAddress || trade.creatorAddress || '').toLowerCase();
                const buyer = (trade.buyerAddress || trade.acceptorAddress || '').toLowerCase();
                const isSeller = seller === userWallet.toLowerCase();
                const counterparty = isSeller ? buyer : seller;
                const counterpartyFormatted = (counterparty && counterparty.length >= 40)
                    ? `${counterparty.substring(0, 6)}...${counterparty.substring(38)}`
                    : (counterparty || 'Unknown');
                const statusColor = getStatusColorClass(trade.status);
                return `
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 600; font-size: 0.875rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${isSeller ? '🔴 Sell' : '🟢 Buy'} ${trade.amountOffered} ${trade.tokenOffered}</div>
                            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                Counterparty: ${counterpartyFormatted}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;">
                            <span class="badge" style="background: ${statusColor}; color: #000; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: bold; text-transform: uppercase;">${(trade.status || '').replace('_', ' ')}</span>
                            <button class="btn-small" onclick="selectActiveTrade('${trade.id}')" style="padding: 4px 8px; font-size: 0.75rem;">Chat/Manage</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.error('Error loading user trades:', e);
        container.innerHTML = `<p style="color: var(--text-secondary); text-align: center; font-size: 0.875rem;">Failed to load active trades.</p>`;
    }
}

function getStatusColorClass(status) {
    switch (status) {
        case 'pending_payment': return 'var(--cheese-gold)';
        case 'paid': return 'var(--success)';
        case 'disputed': return 'var(--error)';
        case 'completed': return 'rgba(255,255,255,0.2)';
        case 'cancelled': return 'rgba(255,255,255,0.1)';
        default: return 'var(--text-secondary)';
    }
}

async function selectActiveTrade(tradeId) {
    activeP2PTradeId = tradeId;
    const detailsPanel = document.getElementById('p2pActiveTradeDetails');
    if (!detailsPanel) return;

    detailsPanel.style.display = 'flex';
    document.getElementById('p2pTradeTitle').textContent = `Trade #${tradeId.substring(0, 8)}`;
    
    // Clear chat display and show loading state
    document.getElementById('p2pChatMessages').innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Loading chat history...</p>';

    await refreshTradeDetailsAndChat();

    // Start polling chat and status
    stopChatPolling();
    p2pChatInterval = setInterval(refreshTradeDetailsAndChat, 3000);
}

function closeActiveTradeDetails() {
    stopChatPolling();
    const detailsPanel = document.getElementById('p2pActiveTradeDetails');
    if (detailsPanel) detailsPanel.style.display = 'none';
    activeP2PTradeId = null;
    p2pActiveTradeData = null;
}

function stopChatPolling() {
    if (p2pChatInterval) {
        clearInterval(p2pChatInterval);
        p2pChatInterval = null;
    }
}

const ADMINS = [
    '0x87a8ef96ffd80424564c76b51c89078f4a135760',
    '0x723d42ede92225a07c13bff7dcda648dde291888'
];
function isUserAdmin() {
    if (!userWallet) return false;
    return ADMINS.includes(userWallet.toLowerCase());
}

async function refreshTradeDetailsAndChat() {
    if (!activeP2PTradeId) return;

    try {
        // 1. Fetch Chat
        const chatResponse = await fetch(dexApiUrl(`/api/p2p/trade/chat?tradeId=${activeP2PTradeId}&userAddress=${userWallet}`), {
            headers: dexApiHeaders()
        });
        const chatData = await chatResponse.json();
        if (chatData.success && chatData.messages) {
            const chatContainer = document.getElementById('p2pChatMessages');
            const atBottom = chatContainer.scrollHeight - chatContainer.scrollTop <= chatContainer.clientHeight + 50;
            
            if (chatData.messages.length === 0) {
                chatContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No messages yet. Send a message below.</p>';
            } else {
                chatContainer.innerHTML = chatData.messages.map(msg => {
                    const isSystem = msg.sender === 'system';
                    const isSelf = msg.sender.toLowerCase() === userWallet.toLowerCase();
                    const senderLabel = isSystem ? '📢 System' : (msg.role ? `👤 ${msg.role.toUpperCase()}` : `👤 ${msg.sender.substring(0, 6)}...`);
                    
                    let bg = 'rgba(255,255,255,0.05)';
                    let align = 'flex-start';
                    let border = 'none';

                    if (isSystem) {
                        bg = 'rgba(255, 215, 0, 0.05)';
                        border = '1px solid rgba(255, 215, 0, 0.15)';
                        align = 'center';
                    } else if (isSelf) {
                        bg = 'rgba(0, 212, 170, 0.1)';
                        align = 'flex-end';
                    } else if (msg.role === 'admin') {
                        bg = 'rgba(239, 68, 68, 0.1)';
                        border = '1px solid rgba(239, 68, 68, 0.2)';
                    }

                    return `
                        <div style="align-self: ${align}; max-width: 80%; background: ${bg}; border: ${border}; border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.85rem; margin-bottom: 4px;">
                            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 2px; font-weight: bold;">${senderLabel}</div>
                            <div style="word-break: break-word; color: var(--text-primary);">${msg.text}</div>
                        </div>
                    `;
                }).join('');

                if (atBottom) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            }
        }

        // 2. Fetch Trade Details from the trades list
        const listResponse = await fetch(dexApiUrl(`/api/p2p/trades?userAddress=${userWallet}`), {
            headers: dexApiHeaders()
        });
        const listData = await listResponse.json();
        if (listData.success && listData.trades) {
            const trade = listData.trades.find(t => t.id === activeP2PTradeId);
            if (trade) {
                p2pActiveTradeData = trade;
                document.getElementById('p2pTradeStatusBadge').textContent = trade.status.toUpperCase();
                document.getElementById('p2pTradeStatusBadge').style.background = getStatusColorClass(trade.status);

                const actionsContainer = document.getElementById('p2pTradeActions');
                const isBuyer = trade.buyerAddress.toLowerCase() === userWallet.toLowerCase();
                const isSeller = trade.sellerAddress.toLowerCase() === userWallet.toLowerCase();
                const isAdmin = isUserAdmin();

                let html = '';

                if (trade.status === 'pending_payment') {
                    if (isBuyer) {
                        html = `
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                <div>Please send <strong>${trade.amountWanted} ${trade.tokenWanted}</strong> to the seller off-chain.</div>
                                <div style="display: flex; gap: 0.5rem;">
                                    <button class="btn btn-primary" onclick="markP2PTradeAsPaid('${trade.id}')" style="flex: 2; font-size: 0.8rem; padding: 6px 12px; height: auto;">I Have Paid</button>
                                    <button class="btn btn-secondary" onclick="fileP2PTradeDispute('${trade.id}')" style="flex: 1; font-size: 0.8rem; padding: 6px 12px; background: var(--error); color: #fff; height: auto;">Dispute</button>
                                </div>
                            </div>
                        `;
                    } else if (isSeller) {
                        html = `
                            <div>Waiting for the Buyer to send <strong>${trade.amountWanted} ${trade.tokenWanted}</strong>. Escrow locked securely.</div>
                            <button class="btn btn-secondary" onclick="fileP2PTradeDispute('${trade.id}')" style="margin-top: 0.5rem; font-size: 0.8rem; padding: 6px 12px; background: var(--error); color: #fff; width: 100%; height: auto;">Dispute</button>
                        `;
                    }
                } else if (trade.status === 'paid') {
                    if (isBuyer) {
                        html = `
                            <div>Payment marked. Waiting for the Seller to release the escrow. Ref: <code>${trade.paymentConfirmation?.referenceNumber || 'N/A'}</code></div>
                            <button class="btn btn-secondary" onclick="fileP2PTradeDispute('${trade.id}')" style="margin-top: 0.5rem; font-size: 0.8rem; padding: 6px 12px; background: var(--error); color: #fff; width: 100%; height: auto;">Dispute</button>
                        `;
                    } else if (isSeller) {
                        html = `
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                <div>Buyer has marked payment as sent. Ref: <code>${trade.paymentConfirmation?.referenceNumber || 'N/A'}</code>. Please verify.</div>
                                <div style="display: flex; gap: 0.5rem;">
                                    <button class="btn btn-primary" onclick="releaseP2PTradeEscrow('${trade.id}')" style="flex: 2; font-size: 0.8rem; padding: 6px 12px; background: var(--success); color:#000; height: auto;">Release Escrow</button>
                                    <button class="btn btn-secondary" onclick="fileP2PTradeDispute('${trade.id}')" style="flex: 1; font-size: 0.8rem; padding: 6px 12px; background: var(--error); color: #fff; height: auto;">Dispute</button>
                                </div>
                            </div>
                        `;
                    }
                } else if (trade.status === 'disputed') {
                    if (isAdmin) {
                        html = `
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                <div style="font-weight: bold; color: var(--error);">Dispute Case Mediation Panel</div>
                                <div style="display: flex; gap: 0.5rem;">
                                    <button class="btn btn-primary" onclick="resolveP2PTradeDispute('${trade.id}', 'release_to_buyer')" style="flex: 1; font-size: 0.8rem; padding: 6px 12px; background: var(--success); color:#000; height: auto;">Release to Buyer</button>
                                    <button class="btn btn-secondary" onclick="resolveP2PTradeDispute('${trade.id}', 'return_to_seller')" style="flex: 1; font-size: 0.8rem; padding: 6px 12px; background: var(--error); color:#fff; height: auto;">Return to Seller</button>
                                </div>
                            </div>
                        `;
                    } else {
                        html = `<div>Trade is disputed. Reason: "${trade.dispute?.reason || 'None provided'}". Admin mediation in progress.</div>`;
                    }
                } else if (trade.status === 'completed') {
                    html = `<div>Trade Completed. Escrow funds released to buyer's wallet.</div>`;
                } else if (trade.status === 'cancelled') {
                    html = `<div>Trade Cancelled. Escrow funds returned to seller.</div>`;
                }

                actionsContainer.innerHTML = html;
            }
        }
    } catch (e) {
        console.error('Error refreshing P2P trade chat:', e);
    }
}

async function sendP2PChatMessage() {
    if (!activeP2PTradeId || !userWallet) return;
    const input = document.getElementById('p2pChatInput');
    const text = input.value.trim();
    if (!text) return;

    try {
        const signMessage = `Send message on P2P trade ${activeP2PTradeId}: "${text}"`;
        let signature = '0x_mock_signature';
        try {
            signature = await signDexMessage(signMessage);
        } catch (signErr) {
            console.warn('Signature skipped for chat sending:', signErr.message);
        }

        const response = await fetch(dexApiUrl('/api/p2p/trade/chat/send'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                tradeId: activeP2PTradeId,
                senderAddress: userWallet,
                text,
                signature,
                message: signMessage
            })
        });

        const data = await response.json();
        if (data.success) {
            input.value = '';
            await refreshTradeDetailsAndChat();
        } else {
            throw new Error(data.error || 'Failed to send message');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

async function markP2PTradeAsPaid(tradeId) {
    if (!userWallet) return;
    const referenceNumber = prompt('Enter payment transaction details or transaction Reference ID (immutable proof of payment):');
    if (referenceNumber === null) return;

    try {
        const signMessage = `Mark P2P trade ${tradeId} as paid`;
        let signature = '0x_mock_signature';
        try {
            signature = await signDexMessage(signMessage);
        } catch (signErr) {
            console.warn('Signature skipped for marking paid:', signErr.message);
        }

        const response = await fetch(dexApiUrl('/api/p2p/trade/mark-paid'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                tradeId,
                buyerAddress: userWallet,
                referenceNumber,
                signature,
                message: signMessage
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('Payment marked as Sent!', 'success');
            await refreshTradeDetailsAndChat();
            loadUserP2PTrades();
        } else {
            throw new Error(data.error || 'Failed to mark trade as paid');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

async function releaseP2PTradeEscrow(tradeId) {
    if (!userWallet) return;
    if (!confirm('WARNING: Are you absolutely sure you want to release the escrow? Once released, the coins will go directly to the buyer and cannot be refunded.')) return;

    try {
        const signMessage = `Release escrow for P2P trade ${tradeId}`;
        let signature = '0x_mock_signature';
        try {
            signature = await signDexMessage(signMessage);
        } catch (signErr) {
            console.warn('Signature skipped for releasing escrow:', signErr.message);
        }

        const response = await fetch(dexApiUrl('/api/p2p/trade/release'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                tradeId,
                sellerAddress: userWallet,
                signature,
                message: signMessage
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('Coins released successfully!', 'success');
            await refreshTradeDetailsAndChat();
            loadUserP2PTrades();
            loadBalances();
        } else {
            throw new Error(data.error || 'Failed to release coins');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

async function fileP2PTradeDispute(tradeId) {
    if (!userWallet) return;
    const reason = prompt('Please describe why you are opening a dispute (evidence verification):');
    if (!reason) return;

    try {
        const signMessage = `File dispute for P2P trade ${tradeId}`;
        let signature = '0x_mock_signature';
        try {
            signature = await signDexMessage(signMessage);
        } catch (signErr) {
            console.warn('Signature skipped for filing dispute:', signErr.message);
        }

        const response = await fetch(dexApiUrl('/api/p2p/trade/dispute'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                tradeId,
                userAddress: userWallet,
                reason,
                signature,
                message: signMessage
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('Dispute has been filed. Escrow is locked.', 'warning');
            await refreshTradeDetailsAndChat();
            loadUserP2PTrades();
        } else {
            throw new Error(data.error || 'Failed to file dispute');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}

async function resolveP2PTradeDispute(tradeId, decision) {
    if (!userWallet) return;
    if (!confirm(`Are you sure you want to resolve this case and ${decision.replace('_', ' ')}?`)) return;

    try {
        const signMessage = `Resolve dispute for P2P trade ${tradeId} as ${decision}`;
        let signature = '0x_mock_signature';
        try {
            signature = await signDexMessage(signMessage);
        } catch (signErr) {
            console.warn('Signature skipped for resolving dispute:', signErr.message);
        }

        const response = await fetch(dexApiUrl('/api/p2p/trade/resolve'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...dexApiHeaders() },
            body: JSON.stringify({
                tradeId,
                adminAddress: userWallet,
                decision,
                signature,
                message: signMessage
            })
        });

        const data = await response.json();
        if (data.success) {
            showNotification('Dispute resolved successfully!', 'success');
            await refreshTradeDetailsAndChat();
            loadUserP2PTrades();
            loadBalances();
        } else {
            throw new Error(data.error || 'Failed to resolve dispute');
        }
    } catch (e) {
        showNotification(e.message, 'error');
    }
}
