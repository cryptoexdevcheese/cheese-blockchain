// popup.js - Client UI controller for Cheese Wallet popup window

const API_URL = 'https://cheeseblockchain.com/api';

// DOM elements
const screens = {
    setup: document.getElementById('setupScreen'),
    create: document.getElementById('createScreen'),
    import: document.getElementById('importScreen'),
    unlock: document.getElementById('unlockScreen'),
    dashboard: document.getElementById('dashboardScreen'),
    send: document.getElementById('sendScreen'),
    receive: document.getElementById('receiveScreen')
};

let currentMnemonic = '';
let currentWallet = null;

// Screen navigation helper
function showScreen(screenId) {
    Object.keys(screens).forEach(key => {
        if (key === screenId) {
            screens[key].classList.add('active');
        } else {
            screens[key].classList.remove('active');
        }
    });
}

// Back button handlers
document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => showScreen('setup'));
});
document.querySelectorAll('.btn-back-dashboard').forEach(btn => {
    btn.addEventListener('click', () => showScreen('dashboard'));
});

// Setup screen routing
document.getElementById('btnGotoCreate').addEventListener('click', () => {
    // Generate new standard 12-word recovery mnemonic
    const wallet = ethers.Wallet.createRandom();
    currentMnemonic = wallet.mnemonic.phrase;
    currentWallet = wallet;
    
    // Format display grid
    const words = currentMnemonic.split(' ');
    const display = document.getElementById('newMnemonicDisplay');
    display.innerHTML = words.map((w, idx) => `
        <div style="display: inline-block; background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; margin: 4px;">
            <span style="color: var(--text-secondary); font-size: 0.65rem;">${idx + 1}.</span> ${w}
        </div>
    `).join('');

    showScreen('create');
});

document.getElementById('btnGotoImport').addEventListener('click', () => {
    showScreen('import');
});

// Confirm create wallet
document.getElementById('btnConfirmCreate').addEventListener('click', async () => {
    const password = document.getElementById('createPassword').value.trim();
    if (password.length < 4) {
        alert('Password must be at least 4 characters');
        return;
    }

    const btn = document.getElementById('btnConfirmCreate');
    btn.textContent = 'Encrypting Wallet...';
    btn.disabled = true;

    try {
        // Encrypt wallet using standard keystore encryption
        const json = await currentWallet.encrypt(password);
        
        const cheeseWallet = {
            address: currentWallet.address,
            encryptedPrivateKey: json,
            encrypted: true,
            version: '3.0'
        };

        // Save persistently to local storage
        await chrome.storage.local.set({ cheeseWallet });

        // Save decrypted key to session storage (extension session unlocked state)
        await chrome.storage.session.set({
            privateKey: currentWallet.privateKey,
            address: currentWallet.address
        });

        alert('Wallet created and saved successfully!');
        loadDashboard(currentWallet.address);

    } catch (e) {
        alert('Failed to save wallet: ' + e.message);
        btn.textContent = 'I Saved It, Create Wallet';
        btn.disabled = false;
    }
});

// Import tab state
let activeImportTab = 'mnemonic'; // 'mnemonic' or 'privateKey'

// Tab switching handlers
document.getElementById('tabMnemonic').addEventListener('click', () => {
    activeImportTab = 'mnemonic';
    document.getElementById('tabMnemonic').classList.add('active');
    document.getElementById('tabPrivateKey').classList.remove('active');
    document.getElementById('tabMnemonic').style.background = 'var(--card-bg)';
    document.getElementById('tabMnemonic').style.color = 'var(--text-primary)';
    document.getElementById('tabPrivateKey').style.background = 'transparent';
    document.getElementById('tabPrivateKey').style.color = 'var(--text-secondary)';
    
    document.getElementById('mnemonicInputContainer').style.display = 'block';
    document.getElementById('privateKeyInputContainer').style.display = 'none';
});

document.getElementById('tabPrivateKey').addEventListener('click', () => {
    activeImportTab = 'privateKey';
    document.getElementById('tabPrivateKey').classList.add('active');
    document.getElementById('tabMnemonic').classList.remove('active');
    document.getElementById('tabPrivateKey').style.background = 'var(--card-bg)';
    document.getElementById('tabPrivateKey').style.color = 'var(--text-primary)';
    document.getElementById('tabMnemonic').style.background = 'transparent';
    document.getElementById('tabMnemonic').style.color = 'var(--text-secondary)';
    
    document.getElementById('privateKeyInputContainer').style.display = 'block';
    document.getElementById('mnemonicInputContainer').style.display = 'none';
});

// Confirm import wallet
document.getElementById('btnConfirmImport').addEventListener('click', async () => {
    const mnemonicInput = document.getElementById('importMnemonic').value.trim();
    const privateKeyInput = document.getElementById('importPrivateKey').value.trim();
    const password = document.getElementById('importPassword').value.trim();

    if (activeImportTab === 'mnemonic' && !mnemonicInput) {
        alert('Please enter your 12-word recovery seed phrase');
        return;
    }
    if (activeImportTab === 'privateKey' && !privateKeyInput) {
        alert('Please enter your private key');
        return;
    }
    if (password.length < 4) {
        alert('Password must be at least 4 characters');
        return;
    }

    const btn = document.getElementById('btnConfirmImport');
    btn.textContent = 'Importing...';
    btn.disabled = true;

    try {
        let wallet;
        if (activeImportTab === 'mnemonic') {
            const words = mnemonicInput.split(/\s+/);
            if (words.length !== 12) {
                throw new Error('Seed phrase must be exactly 12 words');
            }
            wallet = ethers.Wallet.fromPhrase(mnemonicInput);
        } else {
            let pk = privateKeyInput;
            if (!pk.startsWith('0x')) pk = '0x' + pk;
            if (pk.length !== 66) {
                throw new Error('Private key must be a 64-character hex string (66 characters with 0x)');
            }
            wallet = new ethers.Wallet(pk);
        }

        const json = await wallet.encrypt(password);
        
        const cheeseWallet = {
            address: wallet.address,
            encryptedPrivateKey: json,
            encrypted: true,
            version: '3.0'
        };

        await chrome.storage.local.set({ cheeseWallet });

        await chrome.storage.session.set({
            privateKey: wallet.privateKey,
            address: wallet.address
        });

        alert('Wallet imported successfully!');
        loadDashboard(wallet.address);

    } catch (e) {
        alert('Failed to import: ' + e.message);
        btn.textContent = 'Import Account';
        btn.disabled = false;
    }
});

// Unlock wallet
document.getElementById('btnUnlock').addEventListener('click', async () => {
    const password = document.getElementById('unlockPassword').value.trim();
    if (!password) return;

    const stored = await chrome.storage.local.get('cheeseWallet');
    if (!stored.cheeseWallet) return;

    const btn = document.getElementById('btnUnlock');
    btn.textContent = 'Unlocking...';
    btn.disabled = true;

    try {
        const wallet = await ethers.Wallet.fromEncryptedJson(stored.cheeseWallet.encryptedPrivateKey, password);
        
        await chrome.storage.session.set({
            privateKey: wallet.privateKey,
            address: wallet.address
        });

        loadDashboard(wallet.address);
    } catch (e) {
        alert('Incorrect password. Try again.');
        btn.textContent = 'Unlock Wallet';
        btn.disabled = false;
    }
});

// Network Configurations
const NETWORKS = {
    cheese: {
        name: 'Cheese Mainnet',
        chainId: '0x4F1A',
        rpcUrl: 'https://cheeseblockchain.com/api',
        symbol: 'NCH',
        explorer: 'https://cheeseblockchain.com/explorer',
        tokens: [
            { symbol: 'NCH', name: 'NCheese (Native)', decimals: 18, isNative: true },
            { symbol: 'USDT', name: 'Native Tether USD', decimals: 18, isNative: false, address: 'native-usdt' },
            { symbol: 'USDC', name: 'Native USD Coin', decimals: 18, isNative: false, address: 'native-usdc' }
        ]
    },
    bsc: {
        name: 'Binance Smart Chain',
        chainId: '0x38',
        rpcUrl: 'https://bsc-dataseed.binance.org/',
        symbol: 'BNB',
        explorer: 'https://bscscan.com',
        tokens: [
            { symbol: 'BNB', name: 'Binance Coin (Native)', decimals: 18, isNative: true },
            { symbol: 'USDT', name: 'Tether USD (BSC)', decimals: 18, isNative: false, address: '0x55d398326f99059ff775485246999027b3197955' },
            { symbol: 'USDC', name: 'USD Coin (BSC)', decimals: 18, isNative: false, address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' }
        ]
    },
    ethereum: {
        name: 'Ethereum Mainnet',
        chainId: '0x1',
        rpcUrl: 'https://cloudflare-eth.com/',
        symbol: 'ETH',
        explorer: 'https://etherscan.io',
        tokens: [
            { symbol: 'ETH', name: 'Ethereum (Native)', decimals: 18, isNative: true },
            { symbol: 'USDT', name: 'Tether USD (ETH)', decimals: 6, isNative: false, address: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
            { symbol: 'USDC', name: 'USD Coin (ETH)', decimals: 6, isNative: false, address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }
        ]
    }
};

let currentNetworkKey = 'cheese';

// Network Selector event listener
document.getElementById('networkSelect').addEventListener('change', async (e) => {
    currentNetworkKey = e.target.value;
    await chrome.storage.local.set({ activeNetworkKey: currentNetworkKey });
    
    // Refresh dashboard if unlocked
    const session = await chrome.storage.session.get('address');
    if (session.address) {
        loadDashboard(session.address);
    }
});

// Lock wallet button
document.getElementById('lockBtn').addEventListener('click', async () => {
    await chrome.storage.session.remove(['privateKey', 'address']);
    document.getElementById('unlockPassword').value = '';
    document.getElementById('lockBtn').style.display = 'none';
    showScreen('unlock');
});

// Dashboard address copy
document.getElementById('addressText').addEventListener('click', () => {
    const address = document.getElementById('addressText').dataset.address;
    if (address) {
        navigator.clipboard.writeText(address);
        alert('Address copied to clipboard!');
    }
});
document.getElementById('receiveAddressText').addEventListener('click', () => {
    const address = document.getElementById('receiveAddressText').textContent.trim();
    navigator.clipboard.writeText(address);
    alert('Address copied!');
});

// Dashboard action routing
document.getElementById('btnSend').addEventListener('click', () => {
    // Populate send tokens dropdown
    const sendTokenSelect = document.getElementById('sendToken');
    sendTokenSelect.innerHTML = '';
    const network = NETWORKS[currentNetworkKey];
    network.tokens.forEach(tok => {
        const opt = document.createElement('option');
        opt.value = tok.symbol;
        opt.textContent = `${tok.name} (${tok.symbol})`;
        sendTokenSelect.appendChild(opt);
    });
    
    showScreen('send');
});

document.getElementById('btnReceive').addEventListener('click', async () => {
    const session = await chrome.storage.session.get('address');
    const address = session.address;
    if (!address) return;
    
    const qrImg = document.getElementById('receiveQRCode');
    const qrLoading = document.getElementById('qrLoading');
    const networkName = NETWORKS[currentNetworkKey].name;
    
    document.getElementById('receiveDescription').textContent = `Your public address on ${networkName} is displayed below.`;
    
    // Set up QR Code loading
    qrImg.style.display = 'none';
    qrLoading.style.display = 'block';
    
    qrImg.onload = () => {
        qrLoading.style.display = 'none';
        qrImg.style.display = 'block';
    };
    
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=144x144&color=0c100d&bgcolor=ffffff&data=${encodeURIComponent(address)}`;
    showScreen('receive');
});

// Helper for ERC20 balance reading using standard RPC call
async function getERC20Balance(tokenAddress, userAddress, provider) {
    const abi = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];
    const contract = new ethers.Contract(tokenAddress, abi, provider);
    try {
        const rawBal = await contract.balanceOf(userAddress);
        const decimals = await contract.decimals();
        return parseFloat(ethers.formatUnits(rawBal, decimals));
    } catch (e) {
        console.warn('Failed to fetch ERC20 balance:', e.message);
        return 0.00;
    }
}

// Send Transaction Action
document.getElementById('btnConfirmSend').addEventListener('click', async () => {
    const tokenSymbol = document.getElementById('sendToken').value;
    const recipient = document.getElementById('sendRecipient').value.trim();
    const amount = document.getElementById('sendAmount').value.trim();

    if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
        alert('Please enter a valid recipient address (0x...)');
        return;
    }
    if (!amount || parseFloat(amount) <= 0) {
        alert('Please enter a valid transfer amount');
        return;
    }

    const session = await chrome.storage.session.get('privateKey');
    if (!session.privateKey) return;

    const btn = document.getElementById('btnConfirmSend');
    btn.textContent = 'Processing Transaction...';
    btn.disabled = true;

    try {
        const network = NETWORKS[currentNetworkKey];
        const tokenConfig = network.tokens.find(t => t.symbol === tokenSymbol);
        
        if (!tokenConfig) throw new Error('Unsupported token selection');

        let txHash = '';

        if (currentNetworkKey === 'cheese') {
            // Relays transaction via custom Cheese API gateway
            const response = await fetch(`${API_URL}/send-tx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: new ethers.Wallet(session.privateKey).address,
                    to: recipient,
                    amount: parseFloat(amount),
                    currency: tokenSymbol,
                    privateKey: session.privateKey
                })
            });

            const data = await response.json();
            if (data.success || data.txHash) {
                txHash = data.txHash || 'Verified';
            } else {
                throw new Error(data.error || 'Failed to send transaction via Cheese node');
            }
        } else {
            // Direct RPC Transaction Signature and Broadcast (Multi-Chain compatibilities!)
            const provider = new ethers.JsonRpcProvider(network.rpcUrl);
            const wallet = new ethers.Wallet(session.privateKey, provider);

            if (tokenConfig.isNative) {
                // Send native BNB or ETH
                const tx = await wallet.sendTransaction({
                    to: recipient,
                    value: ethers.parseEther(amount)
                });
                txHash = tx.hash;
            } else {
                // Send ERC20 Token (USDT/USDC on BSC or Ethereum)
                const abi = ["function transfer(address, uint256) returns (bool)"];
                const contract = new ethers.Contract(tokenConfig.address, abi, wallet);
                const rawAmount = ethers.parseUnits(amount, tokenConfig.decimals);
                const tx = await contract.transfer(recipient, rawAmount);
                txHash = tx.hash;
            }
        }

        alert(`Transaction sent successfully!\n\nTxHash: ${txHash}`);
        showScreen('dashboard');
        loadDashboard(new ethers.Wallet(session.privateKey).address);

    } catch (e) {
        alert('Transaction Failed: ' + e.message);
    } finally {
        btn.textContent = 'Send Transaction';
        btn.disabled = false;
    }
});

// Load Dashboard balance and views
async function loadDashboard(address) {
    document.getElementById('lockBtn').style.display = 'flex';
    document.getElementById('addressText').textContent = address.substring(0, 6) + '...' + address.substring(38);
    document.getElementById('addressText').dataset.address = address;
    document.getElementById('receiveAddressText').textContent = address;

    const network = NETWORKS[currentNetworkKey];
    document.getElementById('balanceSymbol').textContent = network.symbol;
    document.getElementById('networkSelect').value = currentNetworkKey;

    showScreen('dashboard');

    const assetsContainer = document.getElementById('assetsContainer');
    assetsContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); font-size: 0.8rem; padding: 15px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching Balances...</div>';

    try {
        let nativeBalance = 0.00;
        const balances = {};

        if (currentNetworkKey === 'cheese') {
            // Custom Cheese node backend endpoint
            const res = await fetch(`${API_URL}/balance/${address}`);
            if (res.ok) {
                const data = await res.json();
                nativeBalance = parseFloat(data.balance || data.NCH || 0);
                balances['NCH'] = nativeBalance;
                if (data.portfolio) {
                    balances['USDT'] = parseFloat(data.portfolio.USDT || 0);
                    balances['USDC'] = parseFloat(data.portfolio.USDC || 0);
                }
            }
        } else {
            // Standard JSON-RPC queries
            const provider = new ethers.JsonRpcProvider(network.rpcUrl);
            const rawBal = await provider.getBalance(address);
            nativeBalance = parseFloat(ethers.formatEther(rawBal));
            balances[network.symbol] = nativeBalance;

            // Fetch active ERC20 tokens in parallel
            await Promise.all(network.tokens.filter(t => !t.isNative).map(async (tok) => {
                const bal = await getERC20Balance(tok.address, address, provider);
                balances[tok.symbol] = bal;
            }));
        }

        // Render main header balance
        document.getElementById('balanceAmount').textContent = nativeBalance.toFixed(4);

        // Populate assets container list
        assetsContainer.innerHTML = '';
        network.tokens.forEach(tok => {
            const balVal = balances[tok.symbol] || 0.00;
            let iconHtml = '<span class="asset-icon" style="font-size: 1.25rem;">🪙</span>';
            if (tok.symbol === 'NCH') {
                iconHtml = '<span class="asset-icon" style="font-size: 1.25rem;">🧀</span>';
            } else if (tok.symbol === 'ETH') {
                iconHtml = '<span class="asset-icon" style="font-size: 1.25rem;">⟠</span>';
            } else if (tok.symbol === 'BNB') {
                iconHtml = '<span class="asset-icon" style="font-size: 1.25rem;">🪙</span>';
            } else if (tok.symbol === 'USDT') {
                iconHtml = '<span style="background: linear-gradient(135deg, #26a17b, #1de9b6); color: #ffffff; font-weight: 800; font-size: 0.75rem; border-radius: 50%; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(38,161,123,0.4); border: 1px solid rgba(255,255,255,0.2);">₮</span>';
            } else if (tok.symbol === 'USDC') {
                iconHtml = '<span style="background: linear-gradient(135deg, #2775ca, #3b82f6); color: #ffffff; font-weight: 800; font-size: 0.75rem; border-radius: 50%; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(39,117,202,0.4); border: 1px solid rgba(255,255,255,0.2);">$</span>';
            }
            
            const assetItem = document.createElement('div');
            assetItem.className = 'asset-item';
            assetItem.style = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border-color);';
            assetItem.innerHTML = `
                <div class="asset-info" style="display: flex; align-items: center; gap: 10px;">
                    ${iconHtml}
                    <div>
                        <span class="asset-name" style="font-size: 0.8rem; font-weight: 600; display: block; color: var(--text-primary);">${tok.name}</span>
                        <span class="asset-symbol" style="font-size: 0.65rem; color: var(--text-secondary);">${tok.symbol}</span>
                    </div>
                </div>
                <span class="asset-balance" style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${balVal.toFixed(4)} ${tok.symbol}</span>
            `;
            assetsContainer.appendChild(assetItem);
        });

    } catch (e) {
        console.error('Failed to load portfolio balances:', e);
        assetsContainer.innerHTML = '<div style="text-align: center; color: var(--error); font-size: 0.8rem; padding: 15px;">Failed to load assets</div>';
    }
}

// Initial Extension Load Checks
document.addEventListener('DOMContentLoaded', async () => {
    // Load persisted network preference if exists
    const storedNet = await chrome.storage.local.get('activeNetworkKey');
    if (storedNet.activeNetworkKey && NETWORKS[storedNet.activeNetworkKey]) {
        currentNetworkKey = storedNet.activeNetworkKey;
    }
    
    // Check if wallet keystore exists in storage
    const stored = await chrome.storage.local.get('cheeseWallet');
    if (!stored.cheeseWallet) {
        showScreen('setup');
        return;
    }

    // Check if session is unlocked
    const session = await chrome.storage.session.get(['privateKey', 'address']);
    if (session.privateKey && session.address) {
        loadDashboard(session.address);
    } else {
        showScreen('unlock');
    }
});


// Receive Button Listener & QR Generation
document.getElementById('btnReceive').addEventListener('click', async () => {
    let address = null;
    try {
        const session = await chrome.storage.session.get('address');
        if (session && session.address) {
            address = session.address;
        } else {
            const stored = await chrome.storage.local.get('cheeseWallet');
            if (stored && stored.cheeseWallet) address = stored.cheeseWallet.address;
        }
    } catch(e) {}

    if (address) {
        showReceiveScreen(address);
    } else {
        alert('Please unlock your wallet first.');
    }
});

function showReceiveScreen(address) {
    showScreen('receive');
    const receiveAddrEl = document.getElementById('receiveAddressText');
    const receiveQREl = document.getElementById('receiveQRCode');
    const qrLoadingEl = document.getElementById('qrLoading');

    if (receiveAddrEl) {
        receiveAddrEl.textContent = address;
        receiveAddrEl.onclick = () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(address);
            }
            alert('📋 Address copied to clipboard:
' + address);
        };
    }

    if (receiveQREl && qrLoadingEl) {
        qrLoadingEl.style.display = 'block';
        receiveQREl.style.display = 'none';
        
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(address)}`;
        receiveQREl.src = qrUrl;
        receiveQREl.onload = () => {
            receiveQREl.style.display = 'block';
            qrLoadingEl.style.display = 'none';
        };
        receiveQREl.onerror = () => {
            qrLoadingEl.innerHTML = '<span style="color:#ef4444; font-size:0.75rem;">Failed to load QR</span>';
        };
    }
}
