// background.js - Service Worker for Cheese Wallet Extension
importScripts('ethers.min.js');

// Config
const CHAIN_ID = '0x4F1A'; // 20250 in decimal
const RPC_URL = 'https://cheeseblockchain.com/api'; // Or local fallback

// Pending requests mapping
const pendingRequests = new Map();

// Helper to get active wallet from session storage
async function getActiveWallet() {
    const session = await chrome.storage.session.get(['privateKey', 'address']);
    if (session.privateKey && session.address) {
        return new ethers.Wallet(session.privateKey);
    }
    return null;
}

// Intercept RPC messages from content scripts (DApps)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleRPCRequest(request, sender)
        .then(result => sendResponse({ result }))
        .catch(err => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
});

// RPC handler router
async function handleRPCRequest(request, sender) {
    const { method, params } = request;
    const origin = sender.tab ? new URL(sender.tab.url).origin : 'unknown';

    const storedNet = await chrome.storage.local.get('activeNetworkKey');
    const netKey = storedNet.activeNetworkKey || 'cheese';
    
    // Map of chain configurations
    const chainIds = {
        cheese: '0x4F1A',
        bsc: '0x38',
        ethereum: '0x1'
    };
    const netVersions = {
        cheese: '20250',
        bsc: '56',
        ethereum: '1'
    };

    switch (method) {
        case 'eth_chainId':
            return chainIds[netKey] || '0x4F1A';
        case 'net_version':
            return netVersions[netKey] || '20250';
        case 'eth_blockNumber':
            return '0x1'; // Mock or fetch block from RPC
        case 'eth_accounts':
            const wallet = await getActiveWallet();
            return wallet ? [wallet.address] : [];

        case 'eth_requestAccounts':
            const activeWallet = await getActiveWallet();
            if (activeWallet) {
                return [activeWallet.address];
            }
            // Trigger approval popup window if locked/not connected
            return await requestUserApproval('eth_requestAccounts', params, origin);

        case 'personal_sign':
            return await requestUserApproval('personal_sign', params, origin);

        case 'eth_sendTransaction':
            return await requestUserApproval('eth_sendTransaction', params, origin);

        default:
            throw new Error(`Unsupported method: ${method}`);
    }
}

// Spawns a popup window for transaction/connection user approvals
async function requestUserApproval(method, params, origin) {
    // If wallet is not setup/imported, direct user to setup
    const stored = await chrome.storage.local.get('cheeseWallet');
    if (!stored.cheeseWallet) {
        throw new Error('Wallet not initialized. Please set up your wallet in the extension popup.');
    }

    const session = await chrome.storage.session.get('privateKey');
    if (!session.privateKey) {
        throw new Error('Wallet locked. Please unlock your wallet in the extension popup.');
    }

    return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(2);
        
        pendingRequests.set(requestId, { resolve, reject, method, params, origin });

        // Open custom transaction confirmation dialog window
        chrome.windows.create({
            url: `confirm.html?requestId=${requestId}`,
            type: 'popup',
            width: 375,
            height: 600
        });
    });
}

// Receive messages from confirm.html popup approval window
chrome.runtime.onMessageExternal ? 
chrome.runtime.onMessageExternal.addListener : 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'APPROVE_CONFIRMATION') {
        const { requestId, result } = message;
        const request = pendingRequests.get(requestId);
        if (request) {
            if (request.method === 'personal_sign') {
                // Execute personal sign locally in service worker
                getActiveWallet().then(wallet => {
                    if (wallet) {
                        let hexMsg = request.params[0];
                        let msg = hexMsg;
                        if (hexMsg.startsWith('0x')) {
                            // Convert hex to string if needed
                            try {
                                const bytes = ethers.utils.arrayify(hexMsg);
                                msg = ethers.utils.toUtf8String(bytes);
                            } catch(e) {}
                        }
                        wallet.signMessage(msg).then(sig => {
                            request.resolve(sig);
                        }).catch(err => request.reject(err));
                    } else {
                        request.reject(new Error('Wallet locked'));
                    }
                });
            } else if (request.method === 'eth_sendTransaction') {
                // Return transaction hash mock or relay to custom blockchain API
                request.resolve(result.txHash);
            } else {
                request.resolve(result);
            }
            pendingRequests.delete(requestId);
        }
        sendResponse({ success: true });
    } else if (message.type === 'REJECT_CONFIRMATION') {
        const { requestId } = message;
        const request = pendingRequests.get(requestId);
        if (request) {
            request.reject(new Error('User rejected the transaction/connection request'));
            pendingRequests.delete(requestId);
        }
        sendResponse({ success: true });
    } else if (message.type === 'GET_PENDING_REQUEST') {
        const { requestId } = message;
        const req = pendingRequests.get(requestId);
        if (req) {
            sendResponse({
                success: true,
                method: req.method,
                params: req.params,
                origin: req.origin
            });
        } else {
            sendResponse({ success: false, error: 'Request not found' });
        }
    }
});
