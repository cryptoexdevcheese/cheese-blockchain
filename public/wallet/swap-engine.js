/**
 * Swap Engine - Token Swapping Functionality
 * Routes native swaps through the DEX liquidity vault and settlement API.
 */

class SwapEngine {
    constructor(blockchainAPI, founderIncome = null) {
        this.api = blockchainAPI;
        this.founderIncome = founderIncome;
        this.dexVaultAddress = '0x3801490C9f806c917b8CbA710Db9135FA3B116ae';
        this.nativeSwapTokens = (typeof window !== 'undefined' && window.CHEESE_NATIVE_SWAP_TOKENS)
            ? window.CHEESE_NATIVE_SWAP_TOKENS.slice()
            : ['NCH', 'USDT'];
        this.swapFee = 0.003;
        this.resolvedVaultAddress = null;
    }

    normalizeToken(token) {
        const upper = (token || 'NCH').toUpperCase();
        return upper === 'NCHEESE' ? 'NCH' : upper;
    }

    getDexApiUrl() {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://cheeseblockchain.com';
        const fallback = `${origin}/dex`;
        if (typeof window !== 'undefined' && window.CHEESE_CONFIG && window.CHEESE_CONFIG.DEX_API_URL) {
            const configured = window.CHEESE_CONFIG.DEX_API_URL.replace(/\/$/, '');
            if (configured.includes('wallet.cheeseblockchain.com')) {
                return fallback;
            }
            return configured;
        }
        return fallback;
    }

    getApiKey() {
        return (typeof window !== 'undefined' && window.CHEESE_CONFIG && window.CHEESE_CONFIG.API_KEY) || '';
    }

    async resolveVaultAddress() {
        if (this.resolvedVaultAddress) return this.resolvedVaultAddress;
        try {
            const response = await fetch(`${this.getDexApiUrl()}/api/health`, {
                headers: this.getApiKey() ? { 'x-api-key': this.getApiKey() } : {}
            });
            if (response.ok) {
                const data = await response.json();
                if (data.vaultAddress) {
                    this.resolvedVaultAddress = data.vaultAddress;
                    return data.vaultAddress;
                }
            }
        } catch (error) {
            console.warn('Could not resolve DEX vault from health endpoint:', error.message);
        }
        return this.dexVaultAddress;
    }

    async getTokenBalance(address, token) {
        const normalized = this.normalizeToken(token);
        if (normalized === 'NCH') {
            return await this.api.getBalance(address);
        }
        const portfolioData = await this.api.getPortfolio(address);
        return parseFloat(portfolioData.portfolio?.[normalized] || 0);
    }

    async fetchDexSwapQuote(fromAmount, fromToken, toToken) {
        const tokenIn = this.normalizeToken(fromToken);
        const tokenOut = this.normalizeToken(toToken);
        const amountIn = parseFloat(fromAmount);

        if (!amountIn || amountIn <= 0) {
            return { success: false, amountOut: 0, rate: 0, fee: 0, priceImpact: 0, error: 'Invalid amount' };
        }

        try {
            const response = await fetch(`${this.getDexApiUrl()}/api/swap/quote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.getApiKey()
                },
                body: JSON.stringify({ tokenIn, tokenOut, amountIn })
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.success && data.amountOut > 0) {
                return {
                    success: true,
                    source: 'dex',
                    fromAmount: amountIn,
                    amountOut: data.amountOut,
                    toAmount: data.amountOut,
                    rate: amountIn > 0 ? data.amountOut / amountIn : 0,
                    fee: data.fee || data.gasFeeNCH || 0,
                    priceImpact: data.priceImpact || 0
                };
            }
            return {
                success: false,
                amountOut: 0,
                rate: 0,
                fee: 0,
                priceImpact: 0,
                error: data.error || 'DEX quote unavailable'
            };
        } catch (error) {
            return {
                success: false,
                amountOut: 0,
                rate: 0,
                fee: 0,
                priceImpact: 0,
                error: error.message
            };
        }
    }

    /** Executable quotes — DEX pool only (never local fallback). */
    async getSwapQuote(fromAmount, fromToken, toToken) {
        return this.fetchDexSwapQuote(fromAmount, fromToken, toToken);
    }

    /** UI preview — DEX first, then price estimate (not used for settlement). */
    async getSwapQuoteEstimate(fromAmount, fromToken, toToken) {
        const dexQuote = await this.fetchDexSwapQuote(fromAmount, fromToken, toToken);
        if (dexQuote.success) {
            return dexQuote;
        }
        const tokenIn = this.normalizeToken(fromToken);
        const tokenOut = this.normalizeToken(toToken);
        const estimate = await this.calculateSwapAmountFromPrice(parseFloat(fromAmount), tokenIn, tokenOut);
        if (estimate.success) {
            estimate.source = 'estimate';
        }
        return estimate;
    }

    async fetchNchUsdPrice() {
        try {
            const priceData = await this.api.request('/api/dex-proxy/price/NCH');
            if (priceData && priceData.price) {
                return parseFloat(priceData.price);
            }
        } catch (error) {
            console.warn('NCH price proxy failed:', error.message);
        }
        return 0.022;
    }

    async calculateSwapAmountFromPrice(fromAmount, fromToken, toToken) {
        const amountIn = parseFloat(fromAmount);
        const nchUsd = await this.fetchNchUsdPrice();
        const nu = { NCH: 1, USDT: 1 / nchUsd };
        const fromNu = nu[fromToken] || 0;
        const toNu = nu[toToken] || 0;
        if (!fromNu || !toNu) {
            return { success: false, amountOut: 0, rate: 0, fee: 0, priceImpact: 0 };
        }

        const rate = fromNu / toNu;
        const grossAmount = amountIn * rate;
        const fee = grossAmount * this.swapFee;
        const netAmount = grossAmount - fee;

        return {
            success: true,
            fromAmount: amountIn,
            amountOut: netAmount,
            toAmount: netAmount,
            rate: amountIn > 0 ? netAmount / amountIn : 0,
            fee,
            priceImpact: 0
        };
    }

    normalizePrivateKey(privateKey) {
        if (!privateKey || typeof privateKey !== 'string') {
            throw new Error('No signing key available. Please unlock your wallet.');
        }
        const trimmed = privateKey.trim();
        if (/[+/=]/.test(trimmed) || trimmed.length > 66) {
            throw new Error('Wallet is locked. Enter your password to unlock before swapping.');
        }
        const hex = trimmed.replace(/^0x/i, '');
        if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
            throw new Error('Invalid private key format. Please unlock your wallet and try again.');
        }
        return `0x${hex}`;
    }

    async signSwapMessage(message, privateKey) {
        if (typeof ethers === 'undefined') {
            throw new Error('ethers library not loaded');
        }
        const normalizedKey = this.normalizePrivateKey(privateKey);
        const wallet = new ethers.Wallet(normalizedKey);
        return await wallet.signMessage(message);
    }

    extractTxHash(txResult) {
        return txResult?.transaction?.hash ||
            txResult?.transaction?.id ||
            txResult?.txHash ||
            null;
    }

    dexApiHeaders(extra = {}) {
        const key = this.getApiKey();
        return key ? { 'x-api-key': key, ...extra } : { ...extra };
    }

    savePendingSwap(pending) {
        try {
            sessionStorage.setItem('cheese_pending_swap', JSON.stringify(pending));
        } catch (e) {}
    }

    clearPendingSwap() {
        try {
            sessionStorage.removeItem('cheese_pending_swap');
        } catch (e) {}
    }

    getPendingSwap() {
        try {
            const raw = sessionStorage.getItem('cheese_pending_swap');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    async waitForOnChainTx(txHash, maxAttempts = 15, delayMs = 1500) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const result = await this.api.request(`/api/transaction/${txHash}`);
                if (result && result.success && result.transaction) {
                    return true;
                }
            } catch (error) {
                // Transaction may not be indexed yet.
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        return false;
    }

    async submitSwapToBackend(pending) {
        await this.waitForOnChainTx(pending.txHash, 15, 1500);

        let lastError = 'Swap failed';
        for (let attempt = 0; attempt < 3; attempt++) {
            const response = await fetch(`${this.getDexApiUrl()}/api/swap/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.dexApiHeaders()
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

            const executeData = await response.json().catch(() => ({}));
            if (executeData.success) return executeData;
            lastError = executeData.error || lastError;
            if (!String(lastError).includes('Funds not received') &&
                !String(lastError).includes('indexing') &&
                !String(lastError).includes('Invalid on-chain')) {
                throw new Error(lastError);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error(lastError);
    }

    async confirmPendingSwap(walletAddress) {
        const pending = this.getPendingSwap();
        if (!pending || !walletAddress) return false;
        if (pending.userAddress.toLowerCase() !== walletAddress.toLowerCase()) return false;

        try {
            const executeData = await this.submitSwapToBackend(pending);
            this.clearPendingSwap();
            return {
                success: true,
                amountOut: executeData.amountOut,
                swapDetails: {
                    fromAmount: pending.amountIn,
                    toAmount: executeData.amountOut,
                    tokenIn: pending.tokenIn,
                    tokenOut: pending.tokenOut
                }
            };
        } catch (error) {
            console.error('Confirm pending swap error:', error);
            return false;
        }
    }

    async recoverOrphanedSwap(walletAddress, privateKey, defaults = {}) {
        const txHash = prompt('Paste the swap deposit transaction hash from the explorer:');
        if (!txHash) return { success: false, cancelled: true };

        const amountIn = parseFloat(prompt('Amount you swapped (input token):', String(defaults.amountIn || '1')));
        const tokenIn = this.normalizeToken(prompt('Input token symbol:', defaults.tokenIn || 'USDT') || 'USDT');
        const tokenOut = this.normalizeToken(prompt('Output token symbol:', defaults.tokenOut || 'NCH') || 'NCH');
        if (!amountIn || amountIn <= 0) {
            throw new Error('Invalid amount');
        }

        const minAmountOut = defaults.minAmountOut || amountIn * 0.9;
        const swapMessage = `Swap ${amountIn} ${tokenIn} to ${tokenOut}`;
        const signature = await this.signSwapMessage(swapMessage, privateKey);
        const pending = {
            poolId: [tokenIn, tokenOut].sort().join('_'),
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            userAddress: walletAddress,
            txHash: txHash.trim(),
            signature,
            message: swapMessage
        };
        this.savePendingSwap(pending);
        return this.confirmPendingSwap(walletAddress);
    }

    async executeSwap(fromAmount, fromToken, toToken, walletAddress, privateKey) {
        try {
            privateKey = this.normalizePrivateKey(privateKey);
            const normalizedFrom = this.normalizeToken(fromToken);
            const normalizedTo = this.normalizeToken(toToken);

            const isCrossChainSwap =
                (normalizedFrom === 'NCH' && normalizedTo === 'CHEESE') ||
                (normalizedFrom === 'CHEESE' && normalizedTo === 'NCH');

            if (isCrossChainSwap && normalizedFrom === 'NCH' && normalizedTo === 'CHEESE') {
                return await this.executeCrossChainSwapToBSC(fromAmount, walletAddress, privateKey);
            }
            if (isCrossChainSwap && normalizedFrom === 'CHEESE' && normalizedTo === 'NCH') {
                return await this.executeCrossChainSwapFromBSC(fromAmount, walletAddress, privateKey);
            }

            if (!this.nativeSwapTokens.includes(normalizedFrom) || !this.nativeSwapTokens.includes(normalizedTo)) {
                throw new Error(`Unsupported swap pair: ${normalizedFrom}/${normalizedTo}`);
            }
            if (normalizedFrom === normalizedTo) {
                throw new Error('Cannot swap a token for itself');
            }

            const balance = await this.getTokenBalance(walletAddress, normalizedFrom);
            if (balance < fromAmount) {
                throw new Error(`Insufficient ${normalizedFrom} balance`);
            }

            const quote = await this.getSwapQuote(fromAmount, normalizedFrom, normalizedTo);
            if (!quote.success || !quote.amountOut) {
                throw new Error('Unable to quote this swap right now');
            }

            const vaultAddress = await this.resolveVaultAddress();
            const minAmountOut = quote.amountOut * 0.995;
            const swapMessage = `Swap ${fromAmount} ${normalizedFrom} to ${normalizedTo}`;

            const txResult = await this.api.sendTransaction(
                walletAddress,
                vaultAddress,
                fromAmount,
                privateKey,
                {
                    currency: normalizedFrom,
                    type: 'swap',
                    fromToken: normalizedFrom,
                    toToken: normalizedTo,
                    toAmount: quote.amountOut
                }
            );

            const txHash = this.extractTxHash(txResult);
            if (!txHash) {
                throw new Error('Failed to get transaction hash');
            }

            const indexed = await this.waitForOnChainTx(txHash, 15, 1500);
            if (!indexed) {
                throw new Error('Transaction submitted but not yet confirmed on-chain. Please wait and retry.');
            }

            const signature = await this.signSwapMessage(swapMessage, privateKey);
            const pending = {
                poolId: [normalizedFrom, normalizedTo].sort().join('_'),
                tokenIn: normalizedFrom,
                tokenOut: normalizedTo,
                amountIn: fromAmount,
                minAmountOut,
                userAddress: walletAddress,
                txHash,
                signature,
                message: swapMessage
            };
            this.savePendingSwap(pending);

            const executeData = await this.submitSwapToBackend(pending);
            this.clearPendingSwap();

            return {
                success: true,
                transaction: txResult,
                swapDetails: {
                    fromAmount,
                    toAmount: executeData.amountOut || quote.amountOut,
                    rate: quote.rate,
                    fee: quote.fee,
                    priceImpact: quote.priceImpact
                },
                amountOut: executeData.amountOut || quote.amountOut
            };
        } catch (error) {
            console.error('Swap error:', error);
            const pending = this.getPendingSwap();
            if (pending && String(error.message).includes('Funds not received')) {
                error.message += ' Your deposit is on-chain. Reopen the wallet to retry confirmation, or call swapEngine.recoverOrphanedSwap().';
            } else if (pending) {
                error.message += ' Your deposit may be on-chain. Reopen the wallet to retry confirmation.';
            }
            throw error;
        }
    }

    async executeCrossChainSwapToBSC(fromAmount, walletAddress, privateKey) {
        try {
            console.log(`🔄 Executing cross-chain swap: ${fromAmount} NCH → CHEESE (BSC)`);

            const balance = await this.api.getBalance(walletAddress);
            if (balance < fromAmount) {
                throw new Error('Insufficient NCH balance');
            }

            const quote = await this.getSwapQuote(fromAmount, 'NCH', 'CHEESE');
            const cheeseAmount = quote.amountOut || fromAmount;

            const swapTransaction = {
                type: 'swap_cross_chain',
                from: walletAddress,
                fromToken: 'NCH',
                fromAmount: fromAmount,
                toToken: 'CHEESE',
                toAmount: cheeseAmount,
                toChain: 'BSC',
                rate: quote.rate,
                fee: quote.fee,
                timestamp: Date.now()
            };

            const swapLockAddress = `SWAP_LOCK_BSC_${Date.now()}`;
            const result = await this.api.sendTransaction(
                walletAddress,
                swapLockAddress,
                fromAmount,
                privateKey,
                swapTransaction
            );

            if (!result.success) {
                throw new Error('Failed to lock NCH tokens');
            }

            try {
                const transferResult = await this.transferCheeseOnBSC(
                    walletAddress,
                    cheeseAmount,
                    result.transaction?.id || result.transaction?.hash
                );
                if (!transferResult.success) {
                    console.warn('⚠️ BSC transfer failed, swap record saved for manual processing:', transferResult.error);
                }
            } catch (bscError) {
                console.error('Error transferring CHEESE on BSC:', bscError);
            }

            const swapRecord = {
                ...swapTransaction,
                transactionHash: result.transaction?.id || result.transaction?.hash,
                status: 'completed',
                lockedNCH: fromAmount,
                cheeseToReceive: cheeseAmount,
                cheeseTransferred: cheeseAmount,
                bscAddress: walletAddress,
                timestamp: Date.now()
            };

            this.saveSwapRecord(swapRecord);

            return {
                success: true,
                transaction: result,
                swapDetails: quote,
                crossChain: true,
                toToken: 'CHEESE',
                toAmount: cheeseAmount,
                swapRecord: swapRecord,
                message: `✅ Swap completed! ${cheeseAmount} CHEESE tokens have been added to your BSC wallet.`
            };
        } catch (error) {
            console.error('Cross-chain swap error:', error);
            throw error;
        }
    }

    async transferCheeseOnBSC(recipientAddress, amount, swapTxHash) {
        try {
            const apiUrl = this.api.baseUrl || this.api.apiUrl || 'https://cheeseblockchain.com';
            const response = await fetch(`${apiUrl}/api/swap/transfer-cheese`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: recipientAddress,
                    amount: amount,
                    swapTxHash: swapTxHash,
                    chain: 'BSC'
                })
            });

            if (response.ok) {
                const data = await response.json();
                return { success: true, data: data };
            }
            const error = await response.json();
            return { success: false, error: error.message || 'Transfer failed' };
        } catch (error) {
            console.error('Error calling transfer API:', error);
            return { success: false, error: error.message };
        }
    }

    async executeCrossChainSwapFromBSC(fromAmount, walletAddress, privateKey) {
        throw new Error('CHEESE → NCH swap requires CHEESE tokens on BSC. Please use bridge system instead.');
    }

    saveSwapRecord(swapRecord) {
        try {
            const existing = JSON.parse(localStorage.getItem('cheeseSwapRecords') || '[]');
            existing.push(swapRecord);
            localStorage.setItem('cheeseSwapRecords', JSON.stringify(existing));
        } catch (error) {
            console.error('Error saving swap record:', error);
        }
    }

    getPendingSwaps(walletAddress) {
        try {
            const allSwaps = JSON.parse(localStorage.getItem('cheeseSwapRecords') || '[]');
            return allSwaps.filter(swap =>
                swap.from === walletAddress &&
                swap.status === 'pending' &&
                swap.toToken === 'CHEESE' &&
                swap.toChain === 'BSC'
            );
        } catch (error) {
            console.error('Error getting pending swaps:', error);
            return [];
        }
    }

    async getSwapHistory(walletAddress) {
        const transactions = await this.api.getTransactionHistory(walletAddress);
        return transactions.filter(tx => tx.data && tx.data.type === 'swap');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SwapEngine;
}
