// EMERGENCY CACHE BUSTER v5.4.4
(function () {
    const EXPECTED_VERSION = '5.4.4';
    const currentVersion = localStorage.getItem('dexVersion');

    // Check if we are running the old broken version
    if (currentVersion !== EXPECTED_VERSION) {
        console.warn('🚨 DETECTED STALE VERSION - FORCING UPDATE TO ' + EXPECTED_VERSION);

        // 1. Unregister all service workers immediately
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for (let registration of registrations) { registration.unregister(); }
            });
        }

        // 2. Clear cache
        if ('caches' in window) {
            caches.keys().then(names => {
                for (let name of names) caches.delete(name);
            });
        }

        // 3. Set flag
        localStorage.setItem('dexVersion', EXPECTED_VERSION);

        // 4. Force Reload with Cache Busting Param
        setTimeout(() => {
            const url = new URL(window.location.href);
            url.searchParams.set('v', EXPECTED_VERSION);
            url.searchParams.set('force', 'true');
            url.searchParams.set('t', Date.now()); // random timestamp
            window.location.replace(url.toString());
        }, 100);
    }
})();

// AI Support Widget Logic
// Depends on DEX_API_URL being defined in main script

const styleLink = document.createElement('link');
styleLink.rel = 'stylesheet';
styleLink.href = '/dex/support-widget.css'; // Use absolute path
document.head.appendChild(styleLink);

// Inject HTML
const widgetHTML = `
<div class="support-widget">
    <div class="support-window" id="supportWindow">
        <div class="support-header">
            <div class="agent-avatar">🤖</div>
            <div class="agent-info">
                <h3>CHEESE Support</h3>
                <span>AI Assistant • Online</span>
            </div>
            <button onclick="toggleSupport()" style="background:none;border:none;color:#fff;margin-left:auto;cursor:pointer;">✕</button>
        </div>
        <div class="support-messages" id="supportMessages">
            <div class="message agent">
                Hello! I'm CHEESE Support 🧀. I can help verify transactions, check order status, or explain DEX features. How can I help you today?
            </div>
        </div>
        <div class="support-input-area">
            <input type="text" class="support-input" id="supportInput" placeholder="Type your question..." onkeypress="handleSupportKey(event)">
            <button class="support-send" onclick="sendSupportMessage()">➤</button>
        </div>
    </div>
    <button class="support-toggle" onclick="toggleSupport()">💬</button>
</div>
`;

document.body.insertAdjacentHTML('beforeend', widgetHTML);

function toggleSupport() {
    const supportWin = document.getElementById('supportWindow');
    supportWin.classList.toggle('active');
    if (supportWin.classList.contains('active')) {
        document.getElementById('supportInput').focus();
    }
}

function handleSupportKey(e) {
    if (e.key === 'Enter') sendSupportMessage();
}

async function sendSupportMessage() {
    const input = document.getElementById('supportInput');
    const text = input.value.trim();
    if (!text) return;

    // Add User Message
    addMessage(text, 'user');
    input.value = '';

    // Show Typing Indicator
    const typingId = showTyping();

    try {
        // Call Backend AI
        const response = await fetch(`${DEX_API_URL}/api/dex/support/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                userAddress: userWallet || 'guest' // userWallet from index.html scope
            })
        });

        const data = await response.json();

        // Remove Typing Indicator
        removeTyping(typingId);

        if (data.success) {
            addMessage(data.reply, 'agent');
        } else {
            addMessage("I'm having a bit of a brain freeze 🥶. While I recover, here are some quick tips:\n- Check your NCH balance in the top right.\n- Ensure you have at least 0.1 NCH for gas.\n- Try refreshing the page if the chart is stuck.", 'agent');
        }

    } catch (error) {
        removeTyping(typingId);
        console.error('Support Error:', error);
        addMessage("Connection slightly unstable. Check your internet or try refreshing! 🔌", 'agent');
    }
}

function addMessage(text, type) {
    const container = document.getElementById('supportMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;

    // XSS PROTECTION: Use textNode for content, then linkify safely
    // 1. Create text node to escape all HTML
    const contentSpan = document.createElement('span');
    contentSpan.textContent = text;

    // 2. If it contains a TxHash, make it clickable (Safe replacement)
    // We get the escaped HTML from the span
    let safeHtml = contentSpan.innerHTML;

    // Replace TxHash with clickable span (Safe because we already escaped the source text)
    safeHtml = safeHtml.replace(/(0x[a-fA-F0-9]{40,})/g, '<span style="font-family:monospace;background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;cursor:pointer;" onclick="navigator.clipboard.writeText(\'$1\');showNotification(\'Copied!\', \'success\')">$1</span>');

    msgDiv.innerHTML = safeHtml;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function showTyping() {
    const container = document.getElementById('supportMessages');
    const id = 'typing-' + Date.now();
    const typingHTML = `
        <div class="typing-indicator" id="${id}">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', typingHTML);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeTyping(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}
