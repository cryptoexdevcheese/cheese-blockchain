/**
 * BSC Transaction Verifier
 * Verifies BSC transactions using BSCScan API and Web3
 */

class BSCVerifier {
    constructor() {
        // Browser-safe API key retrieval (process.env not available in browser)
        // You can set this via localStorage or use a public API key
        this.bscscanApiKey = (typeof process !== 'undefined' && process.env && process.env.BSCSCAN_API_KEY)
            ? process.env.BSCSCAN_API_KEY
            : (localStorage.getItem('bscscanApiKey') || ''); // Fallback to localStorage or empty
        this.bscscanUrl = 'https://api.bscscan.com/api';
        this.bscRpcUrl = 'https://bsc-dataseed.binance.org/';
        this.web3 = null;
        this.initWeb3();
    }

    // Initialize Web3
    async initWeb3() {
        try {
            // Try to load Web3 from CDN if not available
            if (typeof window !== 'undefined' && !window.Web3) {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/web3@1.10.0/dist/web3.min.js';
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            if (typeof window !== 'undefined' && window.Web3) {
                this.web3 = new window.Web3(this.bscRpcUrl);
            } else if (typeof Web3 !== 'undefined') {
                this.web3 = new Web3(this.bscRpcUrl);
            }
        } catch (error) {
            console.error('Web3 initialization error:', error);
        }
    }

    // Verify BSC transaction using BSCScan API
    async verifyBSCTransaction(txHash) {
        try {
            if (!this.bscscanApiKey) {
                // Fallback to Web3 if no API key
                return await this.verifyBSCTransactionWeb3(txHash);
            }

            const url = `${this.bscscanUrl}?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${this.bscscanApiKey}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.status === '1' && data.result) {
                const tx = data.result;

                // Get transaction receipt to verify success
                const receiptUrl = `${this.bscscanUrl}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${this.bscscanApiKey}`;
                const receiptResponse = await fetch(receiptUrl);
                const receiptData = await receiptResponse.json();

                if (receiptData.status === '1' && receiptData.result) {
                    const receipt = receiptData.result;

                    return {
                        verified: receipt.status === '0x1',
                        transaction: {
                            hash: tx.hash,
                            from: tx.from,
                            to: tx.to,
                            value: this.weiToEther(tx.value),
                            blockNumber: parseInt(tx.blockNumber, 16),
                            blockHash: tx.blockHash,
                            gasUsed: receipt.gasUsed,
                            status: receipt.status === '0x1' ? 'success' : 'failed'
                        },
                        timestamp: Date.now()
                    };
                }
            }

            throw new Error('Transaction not found or failed');
        } catch (error) {
            console.error('BSCScan verification error:', error);
            // Fallback to Web3
            return await this.verifyBSCTransactionWeb3(txHash);
        }
    }

    // Verify BSC transaction using Web3 (fallback)
    async verifyBSCTransactionWeb3(txHash) {
        try {
            if (!this.web3) {
                await this.initWeb3();
            }

            if (!this.web3) {
                throw new Error('Web3 not available');
            }

            const tx = await this.web3.eth.getTransaction(txHash);
            if (!tx) {
                throw new Error('Transaction not found');
            }

            const receipt = await this.web3.eth.getTransactionReceipt(txHash);
            if (!receipt) {
                throw new Error('Transaction receipt not found');
            }

            const status = receipt.status;
            const value = this.web3.utils.fromWei(tx.value, 'ether');

            return {
                verified: status,
                transaction: {
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: parseFloat(value),
                    blockNumber: tx.blockNumber,
                    blockHash: tx.blockHash,
                    gasUsed: receipt.gasUsed,
                    status: status ? 'success' : 'failed'
                },
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('Web3 verification error:', error);
            throw error;
        }
    }

    // Verify ERC-20 token transfer
    async verifyTokenTransfer(txHash, tokenContract, expectedAmount, expectedRecipient) {
        try {
            const verification = await this.verifyBSCTransaction(txHash);

            if (!verification.verified) {
                return {
                    verified: false,
                    error: 'Transaction failed'
                };
            }

            // Get transaction receipt logs
            if (this.web3) {
                const receipt = await this.web3.eth.getTransactionReceipt(txHash);

                // Check for Transfer event
                const transferEventSignature = this.web3.utils.keccak256('Transfer(address,address,uint256)');

                for (const log of receipt.logs) {
                    if (log.topics[0] === transferEventSignature) {
                        // Decode Transfer event
                        const from = '0x' + log.topics[1].slice(-40);
                        const to = '0x' + log.topics[2].slice(-40);
                        const amount = this.web3.utils.toBN(log.data).toString();
                        const amountInTokens = this.web3.utils.fromWei(amount, 'ether');

                        // Verify token contract
                        if (log.address.toLowerCase() === tokenContract.toLowerCase()) {
                            // Verify recipient
                            if (to.toLowerCase() === expectedRecipient.toLowerCase()) {
                                // Verify amount (with small tolerance for decimals)
                                const expectedAmountBN = this.web3.utils.toBN(
                                    this.web3.utils.toWei(expectedAmount.toString(), 'ether')
                                );
                                const actualAmountBN = this.web3.utils.toBN(amount);

                                // Allow 1% tolerance
                                const tolerance = expectedAmountBN.mul(this.web3.utils.toBN(1)).div(this.web3.utils.toBN(100));
                                const diff = expectedAmountBN.sub(actualAmountBN).abs();

                                if (diff.lte(tolerance)) {
                                    return {
                                        verified: true,
                                        transaction: verification.transaction,
                                        tokenTransfer: {
                                            from,
                                            to,
                                            amount: parseFloat(amountInTokens),
                                            tokenContract: log.address
                                        },
                                        timestamp: Date.now()
                                    };
                                }
                            }
                        }
                    }
                }
            }

            // If Web3 not available, use basic verification
            return {
                verified: verification.verified,
                transaction: verification.transaction,
                warning: 'Token transfer details not verified (Web3 not available)'
            };
        } catch (error) {
            console.error('Token transfer verification error:', error);
            throw error;
        }
    }

    // Convert Wei to Ether
    weiToEther(wei) {
        if (typeof wei === 'string' && wei.startsWith('0x')) {
            // Hex string
            const weiBN = BigInt(wei);
            return Number(weiBN) / 1e18;
        }
        return parseFloat(wei) / 1e18;
    }

    // Get BSC block number
    async getBSCBlockNumber() {
        try {
            if (this.web3) {
                return await this.web3.eth.getBlockNumber();
            }

            // Fallback to BSCScan API
            const url = `${this.bscscanUrl}?module=proxy&action=eth_blockNumber&apikey=${this.bscscanApiKey}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === '1') {
                return parseInt(data.result, 16);
            }

            throw new Error('Failed to get block number');
        } catch (error) {
            console.error('Get block number error:', error);
            throw error;
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BSCVerifier;
}


