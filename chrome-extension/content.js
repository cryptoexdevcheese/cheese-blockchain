// content.js - DOM Messaging Bridge for Cheese Wallet Extension

// Inject inpage.js into the target document context
try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inpage.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
} catch (e) {
    console.error('Cheese Wallet: Failed to inject inpage script:', e);
}

// Listen for message events from inpage.js
window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'CHEESE_RPC_REQUEST') return;

    const { requestId, method, params } = event.data;

    try {
        // Send request to background script
        chrome.runtime.sendMessage({ method, params }, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
                window.postMessage({
                    type: 'CHEESE_RPC_RESPONSE',
                    requestId,
                    error: lastError.message
                }, '*');
                return;
            }

            if (response && response.error) {
                window.postMessage({
                    type: 'CHEESE_RPC_RESPONSE',
                    requestId,
                    error: response.error
                }, '*');
            } else {
                window.postMessage({
                    type: 'CHEESE_RPC_RESPONSE',
                    requestId,
                    result: response ? response.result : null
                }, '*');
            }
        });
    } catch (err) {
        window.postMessage({
            type: 'CHEESE_RPC_RESPONSE',
            requestId,
            error: err.message
        }, '*');
    }
});

// Forward accountsChanged or chainChanged events from service worker to page context
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ACCOUNTS_CHANGED') {
        window.postMessage({
            type: 'CHEESE_ACCOUNTS_CHANGED',
            accounts: message.accounts
        }, '*');
    } else if (message.type === 'CHAIN_CHANGED') {
        window.postMessage({
            type: 'CHEESE_CHAIN_CHANGED',
            chainId: message.chainId
        }, '*');
    }
});
