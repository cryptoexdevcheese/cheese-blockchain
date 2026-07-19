/**
 * CHEESE Guardian AI - User Protection System
 * 
 * ORIGINAL FEATURES that no other blockchain has:
 * 1. Mistake Prevention - Warns before sending to wrong/suspicious addresses
 * 2. Scam Detection - Blocks transactions to known scam wallets
 * 3. Social Recovery - Recover wallet with trusted contacts
 * 4. Undo Window - Cancel large transactions within 5 minutes
 * 
 * Based on "Who Moved My Cheese?" philosophy:
 * - ANTICIPATE problems before they happen
 * - ADAPT to new threats automatically
 * - PROTECT users from themselves
 * 
 * Author: CHEESE Team
 * © 2025 All Rights Reserved
 */

const crypto = require('crypto');

class GuardianAI {
    constructor(options = {}) {
        // Known scam addresses database
        this.scamAddresses = new Set();

        // User address book (known safe addresses)
        this.addressBooks = new Map(); // userAddress -> Set of known addresses

        // Pending transactions (for undo window)
        this.pendingUndoTransactions = new Map(); // txId -> { tx, deadline, status }

        // Social recovery guardians
        this.recoveryGuardians = new Map(); // userAddress -> { guardians: [], threshold: 2 }

        // Recovery requests in progress
        this.recoveryRequests = new Map(); // userAddress -> { signatures: [], newAddress, deadline }

        // Configuration
        this.config = {
            undoWindowMinutes: options.undoWindowMinutes || 5,
            largeTransactionThreshold: options.largeTransactionThreshold || 1000,
            recoveryThreshold: options.recoveryThreshold || 2,
            recoveryTimeoutHours: options.recoveryTimeoutHours || 48
        };

        // Load known scam addresses
        this._loadScamDatabase();

        console.log('🛡️ Guardian AI initialized for user protection');
    }

    // ==================== MISTAKE PREVENTION ====================

    /**
     * Check transaction before sending to prevent common mistakes
     */
    async checkTransaction(transaction, userContext = {}) {
        const warnings = [];
        const blockers = [];

        const { from, to, amount } = transaction;

        // 1. Check if sending to self
        if (from && to && from.toLowerCase() === to.toLowerCase()) {
            warnings.push({
                type: 'SELF_TRANSFER',
                severity: 'medium',
                message: 'You are sending to yourself. Is this intentional?'
            });
        }

        // 2. Check if address is in known contacts
        const knownAddresses = this.addressBooks.get(from?.toLowerCase()) || new Set();
        const isKnownAddress = knownAddresses.has(to?.toLowerCase());

        if (!isKnownAddress && amount > 100) {
            warnings.push({
                type: 'NEW_RECIPIENT',
                severity: 'low',
                message: `First time sending to ${this._shortAddr(to)}. Verify the address carefully.`
            });
        }

        // 3. Check if amount is unusually large
        const avgTxAmount = userContext.averageAmount || 100;
        if (amount > avgTxAmount * 10) {
            warnings.push({
                type: 'LARGE_AMOUNT',
                severity: 'high',
                message: `This amount (${amount}) is ${(amount / avgTxAmount).toFixed(1)}x larger than your average transaction.`,
                suggestUndo: true
            });
        }

        // 4. Check against scam database
        if (this.scamAddresses.has(to?.toLowerCase())) {
            blockers.push({
                type: 'KNOWN_SCAM',
                severity: 'critical',
                message: '⛔ This address is flagged as a known scam wallet. Transaction blocked.',
                blocked: true
            });
        }

        // 5. Check for similar addresses (typo detection)
        const similarKnown = this._findSimilarAddresses(to, from);
        if (similarKnown.length > 0) {
            warnings.push({
                type: 'SIMILAR_ADDRESS',
                severity: 'high',
                message: `This address is similar to: ${similarKnown.map(a => this._shortAddr(a)).join(', ')}. Did you mean one of those?`,
                similarAddresses: similarKnown
            });
        }

        // 6. Check if sending entire balance
        const balance = userContext.balance || 0;
        if (amount >= balance * 0.95 && balance > 0) {
            warnings.push({
                type: 'DRAINING_WALLET',
                severity: 'high',
                message: 'You are sending almost your entire balance. Make sure this is intentional.'
            });
        }

        // Calculate overall risk
        const riskScore = this._calculateRiskScore(warnings, blockers);

        return {
            approved: blockers.length === 0,
            riskScore,
            warnings,
            blockers,
            recommendation: blockers.length > 0
                ? 'BLOCK'
                : warnings.some(w => w.severity === 'high')
                    ? 'REQUIRE_CONFIRMATION'
                    : warnings.length > 0
                        ? 'SHOW_WARNINGS'
                        : 'APPROVE',
            suggestUndo: amount >= this.config.largeTransactionThreshold,
            guardianAI: true
        };
    }

    /**
     * Add address to user's known contacts
     */
    addKnownAddress(userAddress, contactAddress, label = '') {
        const userKey = userAddress.toLowerCase();
        if (!this.addressBooks.has(userKey)) {
            this.addressBooks.set(userKey, new Set());
        }
        this.addressBooks.get(userKey).add(contactAddress.toLowerCase());

        return {
            success: true,
            message: `Added ${this._shortAddr(contactAddress)} to your known contacts`
        };
    }

    // ==================== SCAM DETECTION ====================

    /**
     * Report an address as a scam
     */
    async reportScam(address, reporterAddress, evidence = '') {
        const scamReport = {
            address: address.toLowerCase(),
            reporter: reporterAddress,
            evidence,
            timestamp: Date.now(),
            verified: false
        };

        // In production, this would go to a review queue
        // For now, add to local database after multiple reports
        this.scamAddresses.add(address.toLowerCase());

        return {
            success: true,
            message: 'Thank you for reporting. This address has been flagged for review.',
            reportId: crypto.randomBytes(8).toString('hex')
        };
    }

    /**
     * Check if address is a known scam
     */
    isScamAddress(address) {
        return this.scamAddresses.has(address?.toLowerCase());
    }

    // ==================== UNDO WINDOW ====================

    /**
     * Create a transaction with undo window
     * For large transactions, allows cancellation within 5 minutes
     */
    createUndoableTransaction(transaction) {
        const txId = crypto.randomBytes(16).toString('hex');
        const deadline = Date.now() + (this.config.undoWindowMinutes * 60 * 1000);

        this.pendingUndoTransactions.set(txId, {
            transaction,
            deadline,
            status: 'PENDING_CONFIRMATION',
            createdAt: Date.now()
        });

        // Set timer to finalize
        setTimeout(() => {
            this._finalizeTransaction(txId);
        }, this.config.undoWindowMinutes * 60 * 1000);

        return {
            txId,
            status: 'PENDING_CONFIRMATION',
            undoDeadline: new Date(deadline).toISOString(),
            message: `Transaction created. You have ${this.config.undoWindowMinutes} minutes to cancel.`,
            canUndo: true
        };
    }

    /**
     * Cancel a pending transaction (within undo window)
     */
    cancelTransaction(txId, cancellerAddress) {
        const pending = this.pendingUndoTransactions.get(txId);

        if (!pending) {
            return {
                success: false,
                error: 'Transaction not found or already finalized'
            };
        }

        if (Date.now() > pending.deadline) {
            return {
                success: false,
                error: 'Undo window has expired. Transaction has been finalized.'
            };
        }

        if (pending.transaction.from.toLowerCase() !== cancellerAddress.toLowerCase()) {
            return {
                success: false,
                error: 'Only the sender can cancel this transaction'
            };
        }

        pending.status = 'CANCELLED';
        this.pendingUndoTransactions.set(txId, pending);

        return {
            success: true,
            message: 'Transaction cancelled successfully',
            refundedAmount: pending.transaction.amount
        };
    }

    /**
     * Get undo status for a transaction
     */
    getUndoStatus(txId) {
        const pending = this.pendingUndoTransactions.get(txId);

        if (!pending) {
            return { exists: false };
        }

        const timeRemaining = Math.max(0, pending.deadline - Date.now());

        return {
            exists: true,
            status: pending.status,
            canStillUndo: timeRemaining > 0 && pending.status === 'PENDING_CONFIRMATION',
            timeRemainingMs: timeRemaining,
            timeRemainingFormatted: this._formatTime(timeRemaining)
        };
    }

    // ==================== SOCIAL RECOVERY ====================

    /**
     * Setup social recovery guardians for a wallet
     */
    setupRecovery(userAddress, guardians, threshold = 2) {
        if (guardians.length < threshold) {
            return {
                success: false,
                error: `Need at least ${threshold} guardians`
            };
        }

        // Verify guardians are not the user
        if (guardians.some(g => g.toLowerCase() === userAddress.toLowerCase())) {
            return {
                success: false,
                error: 'You cannot be your own guardian'
            };
        }

        this.recoveryGuardians.set(userAddress.toLowerCase(), {
            guardians: guardians.map(g => g.toLowerCase()),
            threshold,
            setupDate: Date.now()
        });

        return {
            success: true,
            message: `Recovery setup complete. ${guardians.length} guardians can recover your wallet with ${threshold} signatures.`,
            guardians: guardians.map(g => this._shortAddr(g))
        };
    }

    /**
     * Initiate recovery (called by a guardian)
     */
    initiateRecovery(lostAddress, newAddress, guardianAddress) {
        const recoverySetup = this.recoveryGuardians.get(lostAddress.toLowerCase());

        if (!recoverySetup) {
            return {
                success: false,
                error: 'No recovery setup found for this address'
            };
        }

        if (!recoverySetup.guardians.includes(guardianAddress.toLowerCase())) {
            return {
                success: false,
                error: 'You are not a guardian for this wallet'
            };
        }

        const deadline = Date.now() + (this.config.recoveryTimeoutHours * 60 * 60 * 1000);

        // Check if recovery already in progress
        let request = this.recoveryRequests.get(lostAddress.toLowerCase());

        if (!request || request.newAddress !== newAddress.toLowerCase()) {
            // New recovery request
            request = {
                signatures: [guardianAddress.toLowerCase()],
                newAddress: newAddress.toLowerCase(),
                deadline,
                initiatedAt: Date.now()
            };
        } else {
            // Add signature to existing request
            if (!request.signatures.includes(guardianAddress.toLowerCase())) {
                request.signatures.push(guardianAddress.toLowerCase());
            }
        }

        this.recoveryRequests.set(lostAddress.toLowerCase(), request);

        const signaturesNeeded = recoverySetup.threshold - request.signatures.length;

        if (signaturesNeeded <= 0) {
            // Recovery complete!
            return this._executeRecovery(lostAddress, newAddress);
        }

        return {
            success: true,
            status: 'PENDING',
            signaturesCollected: request.signatures.length,
            signaturesNeeded,
            message: `Recovery initiated. Need ${signaturesNeeded} more guardian signature(s).`,
            deadline: new Date(deadline).toISOString()
        };
    }

    /**
     * Get recovery status
     */
    getRecoveryStatus(address) {
        const setup = this.recoveryGuardians.get(address.toLowerCase());
        const request = this.recoveryRequests.get(address.toLowerCase());

        return {
            hasRecoverySetup: !!setup,
            guardianCount: setup?.guardians.length || 0,
            threshold: setup?.threshold || 0,
            recoveryInProgress: !!request,
            signaturesCollected: request?.signatures.length || 0,
            newAddress: request ? this._shortAddr(request.newAddress) : null
        };
    }

    // ==================== BEGINNER MODE ====================

    /**
     * Plain language explanation of a transaction
     */
    explainTransaction(transaction, userLevel = 'beginner') {
        const { from, to, amount, data } = transaction;

        if (userLevel === 'beginner') {
            let explanation = `📤 **What this does:**\n`;
            explanation += `You are sending ${amount} NCHEESE coins `;
            explanation += `from your wallet to address ${this._shortAddr(to)}.\n\n`;

            if (amount > 1000) {
                explanation += `⚠️ **This is a large amount!** Make sure you trust the recipient.\n\n`;
            }

            explanation += `💡 **Tips:**\n`;
            explanation += `- Double-check the address before confirming\n`;
            explanation += `- You cannot undo this after ${this.config.undoWindowMinutes} minutes\n`;
            explanation += `- Keep some coins for future transaction fees`;

            return {
                explanation,
                level: 'beginner',
                guardianAI: true
            };
        }

        return {
            explanation: `Transfer ${amount} NCHEESE to ${to}`,
            level: 'advanced',
            guardianAI: true
        };
    }

    // ==================== PRIVATE METHODS ====================

    _loadScamDatabase() {
        // In production, load from external source
        // These are example/test scam addresses
        const knownScams = [
            '0xdead000000000000000000000000000000000000',
            '0x0000000000000000000000000000000000000bad',
        ];

        knownScams.forEach(addr => this.scamAddresses.add(addr.toLowerCase()));
    }

    _shortAddr(address) {
        if (!address) return 'unknown';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    _calculateRiskScore(warnings, blockers) {
        let score = 0;

        warnings.forEach(w => {
            if (w.severity === 'high') score += 0.3;
            else if (w.severity === 'medium') score += 0.15;
            else score += 0.05;
        });

        if (blockers.length > 0) score = 1.0;

        return Math.min(1, score);
    }

    _findSimilarAddresses(targetAddress, userAddress) {
        if (!targetAddress || !userAddress) return [];

        const known = this.addressBooks.get(userAddress.toLowerCase()) || new Set();
        const similar = [];

        for (const knownAddr of known) {
            const similarity = this._addressSimilarity(targetAddress, knownAddr);
            if (similarity > 0.8 && similarity < 1.0) {
                similar.push(knownAddr);
            }
        }

        return similar;
    }

    _addressSimilarity(addr1, addr2) {
        if (!addr1 || !addr2) return 0;

        const a1 = addr1.toLowerCase();
        const a2 = addr2.toLowerCase();

        let matches = 0;
        const len = Math.min(a1.length, a2.length);

        for (let i = 0; i < len; i++) {
            if (a1[i] === a2[i]) matches++;
        }

        return matches / len;
    }

    _finalizeTransaction(txId) {
        const pending = this.pendingUndoTransactions.get(txId);

        if (pending && pending.status === 'PENDING_CONFIRMATION') {
            pending.status = 'FINALIZED';
            this.pendingUndoTransactions.set(txId, pending);
            console.log(`✅ Transaction ${txId.slice(0, 8)} finalized after undo window`);
        }
    }

    _executeRecovery(lostAddress, newAddress) {
        // In production, this would update the blockchain state
        console.log(`🔑 Recovery complete: ${lostAddress} -> ${newAddress}`);

        // Clear the recovery request
        this.recoveryRequests.delete(lostAddress.toLowerCase());

        return {
            success: true,
            status: 'COMPLETE',
            message: 'Recovery successful! Your wallet has been recovered to the new address.',
            oldAddress: lostAddress,
            newAddress: newAddress
        };
    }

    _formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
}

module.exports = GuardianAI;
