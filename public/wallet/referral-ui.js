/**
 * Referral System UI Component for CHEESE Blockchain Wallet
 * Auto-generates referral code from wallet address
 * Displays code and allows easy sharing
 */

// Generate referral code from wallet address
function generateReferralCode(walletAddress) {
    if (!walletAddress || walletAddress.length < 10) return null;
    return `CHEESE-${walletAddress.slice(2, 10).toUpperCase()}`;
}

// Display referral code in UI
function displayReferralCode(walletAddress) {
    const code = generateReferralCode(walletAddress);
    if (!code) return;

    // Update referral code display
    const codeDisplay = document.getElementById('referralCode');
    if (codeDisplay) {
        codeDisplay.textContent = code;
    }

    // Generate shareable link
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?ref=${code}`;

    const linkInput = document.getElementById('referralShareLink');
    if (linkInput) {
        linkInput.value = shareUrl;
    }

    console.log(`📋 Referral Code: ${code}`);
    console.log(`🔗 Share Link: ${shareUrl}`);
}

// Copy referral code to clipboard
function copyReferralCode() {
    const code = document.getElementById('referralCode')?.textContent;
    if (!code) return;

    navigator.clipboard.writeText(code).then(() => {
        showNotification('✅ Referral code copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Copy failed:', err);
        showNotification('Failed to copy code', 'error');
    });
}

// Copy share link to clipboard
function copyShareLink() {
    const link = document.getElementById('referralShareLink')?.value;
    if (!link) return;

    navigator.clipboard.writeText(link).then(() => {
        showNotification('✅ Share link copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Copy failed:', err);
        showNotification('Failed to copy link', 'error');
    });
}

// Check for referral code in URL on page load
function checkReferralCodeInURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');

    if (refCode) {
        console.log(`🎁 Referral code detected: ${refCode}`);

        // Save to localStorage for use during registration
        localStorage.setItem('pendingReferralCode', refCode);

        // Show notification
        showNotification(`🎁 Referral code ${refCode} will be applied during registration!`, 'info');

        // Auto-fill referral input if it exists
        const refInput = document.getElementById('referralCodeInput');
        if (refInput) {
            refInput.value = refCode;
        }
    }
}

// Get pending referral code from localStorage
function getPendingReferralCode() {
    return localStorage.getItem('pendingReferralCode');
}

// Clear pending referral code after use
function clearPendingReferralCode() {
    localStorage.removeItem('pendingReferralCode');
}

// Fetch referral stats for current wallet
async function fetchReferralStats(walletAddress) {
    try {
        // This would connect to a future API endpoint
        // For now, return placeholder
        return {
            totalReferrals: 0,
            totalEarned: 0,
            recentReferrals: []
        };
    } catch (error) {
        console.error('Failed to fetch referral stats:', error);
        return null;
    }
}

// Show notification (uses existing notification system)
function showNotification(message, type = 'info') {
    if (window.app && window.app.showNotification) {
        window.app.showNotification(message, type);
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
        alert(message);
    }
}

// Initialize referral system on page load
window.addEventListener('load', () => {
    // Check for referral code in URL
    checkReferralCodeInURL();

    // Display user's referral code if wallet exists
    const walletAddress = localStorage.getItem('cheeseWalletAddress');
    if (walletAddress) {
        displayReferralCode(walletAddress);
    }
});

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateReferralCode,
        displayReferralCode,
        copyReferralCode,
        copyShareLink,
        checkReferralCodeInURL,
        getPendingReferralCode,
        clearPendingReferralCode,
        fetchReferralStats
    };
}
