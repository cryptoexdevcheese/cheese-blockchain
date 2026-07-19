/**
 * Founder Income System
 * Routes transaction fees, swap fees, and bridge fees to founder wallet
 */

class FounderIncome {
    constructor(blockchainAPI) {
        this.api = blockchainAPI;
        
        // Fee rates
        this.transactionFeeRate = 0.001; // 0.1% transaction fee
        this.minTransactionFee = 0.01; // Minimum 0.01 CHEESE
        this.maxTransactionFee = 10; // Maximum 10 CHEESE
        
        // Swap and bridge fees are already defined in their engines
        // This system routes those fees to founder wallet
        
        // Load founder address from localStorage or environment
        this.loadFounderAddress();
    }

    /**
     * Load founder address from localStorage or environment
     */
    loadFounderAddress() {
        // Try localStorage first
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('cheeseFounderAddress');
            if (saved && saved !== 'FOUNDER_WALLET_ADDRESS_HERE') {
                this.founderAddress = saved;
                return;
            }
        }
        
        // Try environment variable
        if (typeof process !== 'undefined' && process.env && process.env.FOUNDER_WALLET) {
            this.founderAddress = process.env.FOUNDER_WALLET;
            return;
        }
        
        // Default to your founder address if not set
        // You can override this by setting in localStorage or environment
        this.founderAddress = '0xa25f52f081c3397bbc8d2ed12146757c470e049d';
    }

    /**
     * Calculate transaction fee
     */
    calculateTransactionFee(amount) {
        const fee = Math.max(
            this.minTransactionFee,
            Math.min(amount * this.transactionFeeRate, this.maxTransactionFee)
        );
        return {
            fee: fee,
            netAmount: amount - fee,
            feePercent: this.transactionFeeRate * 100
        };
    }

    /**
     * Send transaction with fee to founder
     */
    async sendTransactionWithFee(from, to, amount, privateKey, data = {}) {
        try {
            // Calculate fee
            const feeCalc = this.calculateTransactionFee(amount);
            
            // Check balance (user needs amount + fee)
            const balance = await this.api.getBalance(from);
            if (balance < amount + feeCalc.fee) {
                throw new Error(`Insufficient balance. Need ${amount + feeCalc.fee} CHEESE (amount + fee)`);
            }

            // Send main transaction
            console.log('📤 ========== FOUNDER INCOME: Sending main transaction ==========');
            console.log('📤 Transaction details:', {
                from,
                to,
                amount: feeCalc.netAmount,
                originalAmount: amount,
                fee: feeCalc.fee,
                hasPrivateKey: !!privateKey,
                privateKeyLength: privateKey ? privateKey.length : 0
            });
            
            console.log('📤 ========== ABOUT TO CALL API ==========');
            console.log('📤 this.api exists?', !!this.api);
            console.log('📤 this.api type:', typeof this.api);
            if (this.api) {
                console.log('📤 this.api.constructor.name:', this.api.constructor.name);
                console.log('📤 this.api keys:', Object.keys(this.api));
                console.log('📤 this.api.sendTransaction type:', typeof this.api.sendTransaction);
                console.log('📤 this.api.sendTransaction exists?', !!this.api.sendTransaction);
            } else {
                console.error('❌ this.api is NULL or UNDEFINED!');
                throw new Error('this.api is null or undefined - cannot send transaction');
            }
            
            if (!this.api.sendTransaction) {
                console.error('❌ this.api.sendTransaction is NOT A FUNCTION!');
                console.error('❌ Available methods:', Object.keys(this.api).filter(k => typeof this.api[k] === 'function'));
                throw new Error('this.api.sendTransaction is not a function');
            }
            
            console.log('📤 ========== CALLING this.api.sendTransaction() NOW ==========');
            console.log('📤 Parameters:', {
                from: from.substring(0, 10) + '...',
                to: to.substring(0, 10) + '...',
                amount: feeCalc.netAmount,
                hasPrivateKey: !!privateKey,
                privateKeyLength: privateKey ? privateKey.length : 0
            });
            
            let mainTx;
            try {
                // Call the function directly
                const sendTxPromise = this.api.sendTransaction(
                    from,
                    to,
                    feeCalc.netAmount,
                    privateKey,
                    { ...data, originalAmount: amount, fee: feeCalc.fee }
                );
                console.log('📤 Promise created, awaiting...');
                mainTx = await sendTxPromise;
                console.log('✅ this.api.sendTransaction() completed successfully');
            } catch (apiError) {
                console.error('❌ ========== API CALL FAILED ==========');
                console.error('❌ Error type:', apiError?.constructor?.name);
                console.error('❌ Error message:', apiError?.message);
                console.error('❌ Error name:', apiError?.name);
                console.error('❌ Error stack:', apiError?.stack);
                console.error('❌ Full error:', apiError);
                throw apiError; // Re-throw to be caught by caller
            }
            
            console.log('📥 Main transaction response:', mainTx);
            console.log('📥 Main transaction type:', typeof mainTx);
            console.log('📥 Main transaction keys:', mainTx ? Object.keys(mainTx) : 'null');
            
            // Handle different response formats
            if (!mainTx) {
                throw new Error('No response from blockchain server');
            }
            
            // Check if response indicates failure
            if (mainTx.success === false || mainTx.reason) {
                const errorMsg = mainTx.reason || mainTx.error || 'Transaction failed';
                console.error('❌ Main transaction failed:', errorMsg, mainTx);
                throw new Error(errorMsg);
            }
            
            // If response has success: true or has transaction property, it's successful
            if (mainTx.success === true || mainTx.transaction) {
                console.log('✅ Main transaction successful');
            } else if (mainTx.id || mainTx.hash) {
                // Response might be transaction object directly (wrapped in success object)
                console.log('✅ Transaction object received directly');
            } else {
                // Unexpected format but no error - log warning
                console.warn('⚠️ Unexpected response format (but no error):', mainTx);
            }

            // Send fee to founder (if fee > 0)
            let feeTx = null;
            if (feeCalc.fee > 0 && this.founderAddress && this.founderAddress !== 'FOUNDER_WALLET_ADDRESS_HERE') {
                try {
                    feeTx = await this.api.sendTransaction(
                        from,
                        this.founderAddress,
                        feeCalc.fee,
                        privateKey,
                        { 
                            type: 'transaction_fee',
                            originalTransaction: mainTx.transaction?.id || mainTx.transaction?.hash,
                            feeAmount: feeCalc.fee
                        }
                    );
                } catch (feeError) {
                    console.warn('Failed to send fee to founder:', feeError);
                    // Continue even if fee collection fails
                }
            }

            // Return success response
            // mainTx should have { success: true, transaction: {...} } format from blockchain server
            return {
                success: true,
                transaction: mainTx.transaction || mainTx, // Handle both { success: true, transaction: {...} } and direct transaction object
                feeTransaction: feeTx,
                fee: feeCalc.fee,
                netAmount: feeCalc.netAmount,
                originalAmount: amount
            };
        } catch (error) {
            console.error('Send transaction with fee error:', error);
            throw error;
        }
    }

    /**
     * Route swap fee to founder
     */
    async routeSwapFee(feeAmount, fromAddress, privateKey, swapTransactionId) {
        if (!this.founderAddress || this.founderAddress === 'FOUNDER_WALLET_ADDRESS_HERE' || feeAmount <= 0) {
            return null;
        }

        try {
            const feeTx = await this.api.sendTransaction(
                fromAddress,
                this.founderAddress,
                feeAmount,
                privateKey,
                {
                    type: 'swap_fee',
                    swapTransactionId: swapTransactionId,
                    feeAmount: feeAmount
                }
            );
            return feeTx;
        } catch (error) {
            console.warn('Failed to route swap fee to founder:', error);
            return null;
        }
    }

    /**
     * Route bridge fee to founder
     */
    async routeBridgeFee(feeAmount, fromAddress, privateKey, bridgeTransactionId) {
        if (!this.founderAddress || this.founderAddress === 'FOUNDER_WALLET_ADDRESS_HERE' || feeAmount <= 0) {
            return null;
        }

        try {
            const feeTx = await this.api.sendTransaction(
                fromAddress,
                this.founderAddress,
                feeAmount,
                privateKey,
                {
                    type: 'bridge_fee',
                    bridgeTransactionId: bridgeTransactionId,
                    feeAmount: feeAmount
                }
            );
            return feeTx;
        } catch (error) {
            console.warn('Failed to route bridge fee to founder:', error);
            return null;
        }
    }

    /**
     * Get founder income statistics
     */
    async getFounderIncomeStats(founderAddress = null) {
        const address = founderAddress || this.founderAddress;
        if (!address || address === 'FOUNDER_WALLET_ADDRESS_HERE') {
            return {
                totalIncome: 0,
                transactionFees: 0,
                swapFees: 0,
                bridgeFees: 0,
                transactionCount: 0
            };
        }

        try {
            const transactions = await this.api.getTransactionHistory(address);
            
            let transactionFees = 0;
            let swapFees = 0;
            let bridgeFees = 0;
            let transactionCount = 0;

            transactions.forEach(tx => {
                if (tx.data && tx.data.type) {
                    switch (tx.data.type) {
                        case 'transaction_fee':
                            transactionFees += tx.amount || 0;
                            transactionCount++;
                            break;
                        case 'swap_fee':
                            swapFees += tx.amount || 0;
                            transactionCount++;
                            break;
                        case 'bridge_fee':
                            bridgeFees += tx.amount || 0;
                            transactionCount++;
                            break;
                    }
                }
            });

            return {
                totalIncome: transactionFees + swapFees + bridgeFees,
                transactionFees: transactionFees,
                swapFees: swapFees,
                bridgeFees: bridgeFees,
                transactionCount: transactionCount,
                address: address
            };
        } catch (error) {
            console.error('Get founder income stats error:', error);
            return {
                totalIncome: 0,
                transactionFees: 0,
                swapFees: 0,
                bridgeFees: 0,
                transactionCount: 0,
                error: error.message
            };
        }
    }

    /**
     * Set founder wallet address
     */
    setFounderAddress(address) {
        this.founderAddress = address;
        // Save to localStorage
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('cheeseFounderAddress', address);
        }
    }

    /**
     * Get founder wallet address (from localStorage or default)
     */
    getFounderAddress() {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('cheeseFounderAddress');
            if (saved) {
                this.founderAddress = saved;
            }
        }
        return this.founderAddress;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FounderIncome;
}

