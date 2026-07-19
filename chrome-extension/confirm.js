// confirm.js - Interceptor dialog script for transaction/signature approvals

const API_URL = 'https://cheeseblockchain.com/api';

const urlParams = new URLSearchParams(window.location.search);
const requestId = urlParams.get('requestId');

const views = {
    connect: document.getElementById('connectView'),
    sign: document.getElementById('signView'),
    tx: document.getElementById('txView')
};

let activeMethod = '';
let activeParams = [];

// Populate request content from background worker cache
async function loadRequestDetails() {
    if (!requestId) {
        alert('Invalid Request ID');
        window.close();
        return;
    }

    chrome.runtime.sendMessage({ type: 'GET_PENDING_REQUEST', requestId }, (response) => {
        if (!response || !response.success) {
            alert('Request details expired or not found');
            window.close();
            return;
        }

        const { method, params, origin } = response;
        activeMethod = method;
        activeParams = params;

        document.getElementById('originText').textContent = origin;

        // Route to sub-view
        if (method === 'eth_requestAccounts') {
            views.connect.style.display = 'block';
        } else if (method === 'personal_sign') {
            views.sign.style.display = 'block';
            let hexMsg = params[0];
            let msg = hexMsg;
            if (hexMsg.startsWith('0x')) {
                try {
                    // Try decoding message if it is hex-encoded
                    const bytes = arrayify(hexMsg);
                    msg = toUtf8String(bytes);
                } catch(e) {}
            }
            document.getElementById('messageText').textContent = msg;
        } else if (method === 'eth_sendTransaction') {
            views.tx.style.display = 'block';
            const txData = params[0];
            document.getElementById('txToText').textContent = txData.to || 'No Recipient Specified';
            
            // Format gas and value
            let val = '0.00 NCH';
            if (txData.value) {
                // simple hex string decoding to integer
                const valueDec = parseInt(txData.value, 16);
                val = (valueDec / 1e18).toFixed(4) + ' NCH';
            }
            document.getElementById('txAmountText').textContent = val;
        }
    });
}

// Simple arrayify and toUtf8String implementation to decode hex values without dependencies
function arrayify(hex) {
    if (!hex.startsWith('0x')) return new Uint8Array();
    const str = hex.slice(2);
    const arr = new Uint8Array(str.length / 2);
    for (let i = 0; i < str.length; i += 2) {
        arr[i / 2] = parseInt(str.substr(i, 2), 16);
    }
    return arr;
}
function toUtf8String(bytes) {
    return new TextDecoder().decode(bytes);
}

// Action listener: Approve Request
document.getElementById('btnApprove').addEventListener('click', async () => {
    let result = null;

    if (activeMethod === 'eth_requestAccounts') {
        const session = await chrome.storage.session.get('address');
        result = [session.address];
    } else if (activeMethod === 'eth_sendTransaction') {
        const txData = activeParams[0];
        const session = await chrome.storage.session.get(['privateKey', 'address']);
        
        const btn = document.getElementById('btnApprove');
        btn.textContent = 'Executing...';
        btn.disabled = true;

        try {
            // Relays transaction executing signature to Cheese Blockchain Node API
            let valueDecimal = 0;
            if (txData.value) {
                valueDecimal = parseInt(txData.value, 16) / 1e18;
            }
            
            const response = await fetch(`${API_URL}/send-tx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: session.address,
                    to: txData.to,
                    amount: valueDecimal,
                    currency: 'NCH',
                    privateKey: session.privateKey
                })
            });

            const data = await response.json();
            if (data.success || data.txHash) {
                result = { txHash: data.txHash };
            } else {
                throw new Error(data.error || 'Failed to dispatch transaction to the blockchain');
            }
        } catch (e) {
            alert('Tx Error: ' + e.message);
            btn.textContent = 'Approve Request';
            btn.disabled = false;
            return;
        }
    } else {
        result = { approved: true };
    }

    chrome.runtime.sendMessage({
        type: 'APPROVE_CONFIRMATION',
        requestId,
        result
    }, () => {
        window.close();
    });
});

// Action listener: Reject Request
document.getElementById('btnReject').addEventListener('click', () => {
    chrome.runtime.sendMessage({
        type: 'REJECT_CONFIRMATION',
        requestId
    }, () => {
        window.close();
    });
});

// Load immediately on load
document.addEventListener('DOMContentLoaded', loadRequestDetails);
