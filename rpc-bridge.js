/**
 * CHEESE EVM RPC BRIDGE
 * Translates standard Ethereum (MetaMask) JSON-RPC calls into Cheese Blockchain API calls.
 * Support for Chain ID 20250 (0x4F1A)
 */

const { ethers } = require('ethers');
const axios = require('axios');

class RPCBridge {
    constructor(blockchain) {
        this.blockchain = blockchain;
        this.chainId = 20250;
        this.chainIdHex = '0x' + this.chainId.toString(16); // 0x4F1A

        // Virtual ERC-20 Token Addresses (Mirrored for recognition across Cheese Wallet & Web3 RPC)
        this.VIRTUAL_TOKENS = {
            '0x55d398326f99059ff775485246999027b3197955': 'USDT',
            '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC',
            '0x000000000000000000000000000000000000c8ee': 'NCH',
            '0x0000000000000000000000000000000000000001': 'BNB',
            '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'BNB',
            '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': 'BTC',
            '0x2170ed0880ac9a755fd29b2688956bd959f933f8': 'ETH',
            '0x570a5d26f7765ecb712c0924e4de54583b2b021b': 'SOL'
        };

        // Virtual Price Oracle (Chainlink-style)
        this.VIRTUAL_ORACLE = '0xDecBCaDe00000000000000000000000000000001';
    }

    async handleRequest(req, res) {
        const { jsonrpc, id, method, params } = req.body;
        if (jsonrpc !== '2.0') {
            return res.status(400).json({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request' } });
        }
        console.log(`📡 RPC: [${method}]`, params);
        try {
            let result;
            switch (method) {
                case 'eth_chainId': result = this.chainIdHex; break;
                case 'eth_blockNumber': result = '0x' + (this.blockchain.chain?.length || 0).toString(16); break;
                case 'eth_getBalance':
                    const balanceData = await this.blockchain.getBalances(params[0]);
                    const balanceVal = balanceData.balance || 0;
                    let balanceWei = 0n;
                    try {
                        const cleanBalance = Number(balanceVal).toFixed(18);
                        balanceWei = ethers.parseUnits(cleanBalance, 18);
                    } catch (e) {
                        balanceWei = BigInt(Math.floor(balanceVal * 1e18));
                    }
                    result = '0x' + balanceWei.toString(16);
                    break;
                case 'eth_getTransactionCount':
                    const txHistory = await this.blockchain.database.getTransactionHistory(params[0]);
                    result = '0x' + (txHistory?.length || 0).toString(16);
                    break;
                case 'eth_gasPrice':
                    result = await this.getDynamicGasPriceWeiHex();
                    break;

                case 'eth_maxPriorityFeePerGas':
                    result = '0x3b9aca00'; // 1 Gwei
                    break;

                case 'eth_feeHistory':
                    const dynamicGasPriceHex = await this.getDynamicGasPriceWeiHex();
                    result = {
                        oldestBlock: '0x0',
                        baseFeePerGas: [dynamicGasPriceHex, dynamicGasPriceHex],
                        reward: [['0x3b9aca00']],
                        gasUsedRatio: [0.1]
                    };
                    break;

                case 'eth_estimateGas':
                    result = '0x5208'; // 21,000 (Standard transfer)
                    break;

                case 'eth_getCode':
                    const addressCode = (params[0] || '').toLowerCase();
                    const isVirtual = Object.keys(this.VIRTUAL_TOKENS).some(k => k.toLowerCase() === addressCode) || 
                                     addressCode === this.VIRTUAL_ORACLE.toLowerCase();
                    
                    if (isVirtual) {
                        // Return dummy ERC-20 contract bytecode (required for MetaMask watchAsset support)
                        result = '0x608060405234801561001057600080fd5b50610150806100206000396000f3fe';
                    } else {
                        result = '0x'; // Regular accounts stay "no code"
                    }
                    break;
                case 'eth_getLogs': result = []; break;
                case 'eth_getBlockByNumber':
                    result = await this.handleGetBlockByNumber(params[0], params[1]);
                    break;
                case 'eth_getBlockByHash':
                    result = await this.handleGetBlockByHash(params[0], params[1]);
                    break;
                case 'eth_getTransactionByHash':
                    result = await this.handleGetTransactionByHash(params[0]);
                    break;
                case 'eth_call':
                    result = await this.handleEthCall(params[0]);
                    break;

                case 'net_version':
                    result = this.chainId.toString();
                    break;

                case 'eth_sendRawTransaction':
                    result = await this.handleSendRawTransaction(params[0]);
                    break;
                case 'eth_getTransactionReceipt':
                    result = await this.handleGetTransactionReceipt(params[0]);
                    break;

                default:
                    console.log(`⚠️ RPC: Unhandled method [${method}]`);
                    return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method [${method}] not found` } });
            }
            return res.json({ jsonrpc: '2.0', id, result });
        } catch (error) {
            console.error(`❌ RPC Error [${method}]:`, error.message);
            return res.status(200).json({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message } });
        }
    }

    /**
     * Handles eth_call for ERC-20 simulation (balanceOf, decimals, etc.)
     * @param {Object} callParams - { to, data }
     */
    async handleEthCall(callParams) {
        if (!callParams || !callParams.to) return '0x';
        
        const addressTo = (callParams.to || '').toLowerCase();
        const data = callParams.data || '0x';
        const sighash = data.slice(0, 10).toLowerCase();

        // Virtual Price Oracle (NCH/USD)
        if (addressTo === this.VIRTUAL_ORACLE.toLowerCase()) {
            // latestAnswer() -> 0xfeaf968c
            if (sighash === '0xfeaf968c' || sighash === '0x50d25bcd') {
                try {
                    const response = await axios.get('https://cheeseblockchain.com/dex/api/dex/price/NCHEESE');
                    const price = response.data.price || 0.15; // Default to 0.15 if fetch fails
                    const priceInt = BigInt(Math.floor(price * 1e8));
                    return '0x' + priceInt.toString(16).padStart(64, '0');
                } catch (e) {
                    console.error('⚠️ Oracle Price Fetch Error:', e.message);
                    return '0x' + (15000000n).toString(16).padStart(64, '0'); // Fallback to $0.15 (8 decimals)
                }
            }
            
            // decimals() -> 0x313ce567 (Return 8 for Chainlink-style aggregator)
            if (sighash === '0x313ce567') {
                return '0x' + (8n).toString(16).padStart(64, '0');
            }
            
            // description() -> 0x7284e416 (Return "NCH / USD")
            if (sighash === '0x7284e416') {
                return ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['NCH / USD']);
            }
            
            // version() -> 0x54fd4d50 (Return 4)
            if (sighash === '0x54fd4d50') {
                return '0x' + (4n).toString(16).padStart(64, '0');
            }
        }

        const tokenSymbolKey = Object.keys(this.VIRTUAL_TOKENS).find(k => k.toLowerCase() === addressTo);
        const tokenSymbol = tokenSymbolKey ? this.VIRTUAL_TOKENS[tokenSymbolKey] : null;
        if (!tokenSymbol) return '0x';

        // balanceOf(address)
        if (sighash === '0x70a08231') {
            const address = ethers.getAddress('0x' + data.slice(34));
            const balanceData = await this.blockchain.getBalances(address);
            
            let balanceVal = 0;
            if (tokenSymbol === 'NCH') {
                balanceVal = balanceData.balance || 0;
            } else {
                const portfolio = balanceData.portfolio || {};
                balanceVal = portfolio[tokenSymbol] || 0;
            }
            
            const decimals = (tokenSymbol === 'USDT' || tokenSymbol === 'USDC') ? 6 : 18;
            let amountWei = 0n;
            try {
                const cleanAmount = Number(balanceVal).toFixed(decimals);
                amountWei = ethers.parseUnits(cleanAmount, decimals);
            } catch (e) {
                amountWei = BigInt(Math.floor(balanceVal * Math.pow(10, decimals)));
            }
            return '0x' + amountWei.toString(16).padStart(64, '0');
        }

        // decimals()
        if (sighash === '0x313ce567') {
            const decimals = (tokenSymbol === 'USDT' || tokenSymbol === 'USDC') ? 6 : 18;
            return '0x' + decimals.toString(16).padStart(64, '0');
        }

        // symbol()
        if (sighash === '0x95d89b41') {
            return ethers.AbiCoder.defaultAbiCoder().encode(['string'], [tokenSymbol]);
        }

        // name()
        if (sighash === '0x06fdde03') {
            let name = tokenSymbol === 'USDT' ? 'Tether USD (Native)' : 'USD Coin (Native)';
            if (tokenSymbol === 'NCH') name = 'Native CHEESE Coin';
            return ethers.AbiCoder.defaultAbiCoder().encode(['string'], [name]);
        }

        return '0x';
    }

    /**
     * Decodes an Ethereum RLP-encoded transaction and maps it to a Cheese transaction.
     * @param {string} rawTx - The 0x-prefixed RLP-encoded signed transaction.
     */
    async handleSendRawTransaction(rawTx) {
        console.log('📦 RPC: Processing eth_sendRawTransaction...');
        try {
            // 1. Decode Raw Transaction
            const tx = ethers.Transaction.from(rawTx);
            if (!tx.to || !tx.from) throw new Error('Invalid Ethereum transaction (missing to/from)');

            // 2. Detect if this is a Token Transfer (ERC-20)
            const txTo = (tx.to || '').toLowerCase();
            const tokenSymbolKey = Object.keys(this.VIRTUAL_TOKENS).find(k => k.toLowerCase() === txTo);
            const tokenSymbol = tokenSymbolKey ? this.VIRTUAL_TOKENS[tokenSymbolKey] : null;
            let finalAmount = parseFloat(ethers.formatEther(tx.value));
            let finalCurrency = 'NCH';
            let finalTo = tx.to;

            if (tokenSymbol && tx.data && tx.data.startsWith('0xa9059cbb')) {
                // ERC-20 transfer(address, uint256)
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['address', 'uint256'], '0x' + tx.data.slice(10));
                finalTo = decoded[0];
                const decimals = (tokenSymbol === 'USDT' || tokenSymbol === 'USDC' || tokenSymbol === 'NCH') ? 6 : 18;
                finalAmount = Number(decoded[1]) / Math.pow(10, decimals);
                finalCurrency = tokenSymbol;
                console.log(`🪙 RPC: Intercepted ${tokenSymbol} transfer: ${finalAmount} to ${finalTo}`);
            }

            // 3. Map to Cheese Blockchain Transaction Format
            const transactionData = {
                from: tx.from,
                to: finalTo,
                amount: finalAmount,
                currency: finalCurrency,
                timestamp: Date.now(),
                data: {
                    eth_hash: tx.hash,
                    eth_nonce: tx.nonce,
                    rawTx: rawTx,
                    type: 'metamask_bridged'
                }
            };

            // 4. Formulate the Signature Object
            const signature = {
                r: tx.signature.r,
                s: tx.signature.s,
                v: tx.signature.v,
                publicKey: tx.from
            };

            // 5. Submit to Blockchain
            const result = await this.blockchain.createTransaction(
                transactionData.from,
                transactionData.to,
                transactionData.amount,
                transactionData.data,
                signature,
                transactionData.timestamp,
                transactionData.currency
            );

            if (!result.success) {
                throw new Error(result.error || 'Transaction injection failed');
            }

            console.log(`✅ RPC: Success! Bridged ${finalCurrency} TX ${tx.hash} -> Cheese Block`);
            return tx.hash;
        } catch (error) {
            console.error('❌ RPC SendRawTransaction Error:', error.message);
            throw error;
        }
    }
    /**
     * Maps a Cheese Block to an Ethereum-compatible block object.
     * @param {Object} block - The Cheese block.
     * @param {boolean} fullTxs - Whether to include full transaction objects.
     */
    mapBlockToEth(block, fullTxs = false) {
        if (!block) {
            const chainLength = this.blockchain.chain?.length || 1;
            block = {
                index: chainLength,
                hash: '0x' + '0'.repeat(64),
                previousHash: '0x' + '0'.repeat(64),
                nonce: 0,
                timestamp: Date.now(),
                transactions: []
            };
        }
        
        const txs = (block.transactions || []).map(tx => {
            if (fullTxs) {
                return {
                    hash: tx.hash || tx.id,
                    nonce: tx.data?.eth_nonce || '0x0',
                    blockHash: block.hash,
                    blockNumber: '0x' + block.index.toString(16),
                    transactionIndex: '0x0',
                    from: tx.from || '0x0000000000000000000000000000000000000000',
                    to: tx.to || '0x0000000000000000000000000000000000000000',
                    value: '0x' + BigInt(Math.floor((tx.amount || 0) * 1e18)).toString(16),
                    gas: '0x5208',
                    gasPrice: '0xba43b7400',
                    input: '0x'
                };
            }
            return tx.hash || tx.id;
        });

        return {
            number: '0x' + block.index.toString(16),
            hash: block.hash,
            parentHash: block.previousHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
            nonce: '0x' + (block.nonce || 0).toString(16).padStart(16, '0'),
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            transactionsRoot: '0x',
            stateRoot: '0x',
            receiptsRoot: '0x',
            miner: '0x0E6ec6713E7b5b7C11d969dA848813d08223598E',
            difficulty: '0x4',
            totalDifficulty: '0x' + (block.index * 4).toString(16),
            extraData: '0x',
            size: '0x' + (JSON.stringify(block).length).toString(16),
            gasLimit: '0x1c9c380',
            gasUsed: '0x0',
            timestamp: '0x' + Math.floor(block.timestamp / 1000).toString(16),
            transactions: txs,
            uncles: []
        };
    }

    async handleGetBlockByNumber(blockTag, fullTxs) {
        let index;
        if (blockTag === 'latest' || blockTag === 'pending') {
            index = Math.max(0, (this.blockchain.chain?.length || 1) - 1);
        } else if (blockTag === 'earliest') {
            index = 0;
        } else {
            index = parseInt(blockTag, 16);
            if (isNaN(index)) index = Math.max(0, (this.blockchain.chain?.length || 1) - 1);
        }

        const block = (this.blockchain.chain && this.blockchain.chain[index]) || null;
        return this.mapBlockToEth(block, fullTxs);
    }

    async handleGetBlockByHash(hash, fullTxs) {
        const block = (this.blockchain.chain && this.blockchain.chain.find(b => b.hash === hash)) || null;
        return this.mapBlockToEth(block, fullTxs);
    }

    async handleGetTransactionByHash(hash) {
        const searchHash = (hash || '').toLowerCase();
        let foundTx = null;
        let foundBlock = null;

        // 1. Search mined blocks
        if (this.blockchain.chain) {
            for (const block of this.blockchain.chain) {
                const tx = (block.transactions || []).find(t => 
                    (t.hash || '').toLowerCase() === searchHash || 
                    (t.id || '').toLowerCase() === searchHash ||
                    (t.data?.eth_hash || '').toLowerCase() === searchHash
                );
                if (tx) {
                    foundTx = tx;
                    foundBlock = block;
                    break;
                }
            }
        }

        // 2. Search pending mempool transactions if not yet in a mined block
        if (!foundTx && this.blockchain.pendingTransactions) {
            const pendingTx = this.blockchain.pendingTransactions.find(t => 
                (t.hash || '').toLowerCase() === searchHash || 
                (t.id || '').toLowerCase() === searchHash ||
                (t.data?.eth_hash || '').toLowerCase() === searchHash
            );
            if (pendingTx) {
                const amountNch = parseFloat(pendingTx.amount || pendingTx.value || 0);
                const weiAmount = BigInt(Math.floor(amountNch * 1e18));
                return {
                    hash: pendingTx.data?.eth_hash || pendingTx.hash || pendingTx.id || searchHash,
                    nonce: pendingTx.data?.eth_nonce || '0x0',
                    blockHash: null,
                    blockNumber: null,
                    transactionIndex: null,
                    from: (pendingTx.from || '0x0000000000000000000000000000000000000000').toLowerCase(),
                    to: (pendingTx.to || '0x0000000000000000000000000000000000000000').toLowerCase(),
                    value: '0x' + weiAmount.toString(16),
                    gas: '0x5208',
                    gasPrice: '0xba43b7400',
                    input: '0x'
                };
            }
        }

        if (!foundTx) return null;

        const amountNch = parseFloat(foundTx.amount || foundTx.value || 0);
        const weiAmount = BigInt(Math.floor(amountNch * 1e18));

        return {
            hash: foundTx.data?.eth_hash || foundTx.hash || foundTx.id,
            nonce: foundTx.data?.eth_nonce || '0x0',
            blockHash: foundBlock.hash,
            blockNumber: '0x' + foundBlock.index.toString(16),
            transactionIndex: '0x0',
            from: (foundTx.from || '0x0000000000000000000000000000000000000000').toLowerCase(),
            to: (foundTx.to || '0x0000000000000000000000000000000000000000').toLowerCase(),
            value: '0x' + weiAmount.toString(16),
            gas: '0x5208',
            gasPrice: '0xba43b7400',
            input: '0x'
        };
    }

    async handleGetTransactionReceipt(hash) {
        const searchHash = (hash || '').toLowerCase();
        let foundTx = null;
        let foundBlock = null;

        if (this.blockchain.chain) {
            for (const block of this.blockchain.chain) {
                const tx = (block.transactions || []).find(t => 
                    (t.hash || '').toLowerCase() === searchHash || 
                    (t.id || '').toLowerCase() === searchHash ||
                    (t.data?.eth_hash || '').toLowerCase() === searchHash
                );
                if (tx) {
                    foundTx = tx;
                    foundBlock = block;
                    break;
                }
            }
        }

        if (!foundTx) return null;

        const txHash = foundTx.hash || foundTx.id;
        const blockNumberHex = '0x' + foundBlock.index.toString(16);
        const fromAddr = foundTx.from || '0x0000000000000000000000000000000000000000';
        const toAddr = foundTx.to || '0x0000000000000000000000000000000000000000';

        const logs = [];

        // Check if this was a stablecoin transaction (USDT or USDC) to generate Transfer logs
        const isStablecoin = foundTx.currency === 'USDT' || foundTx.currency === 'USDC';
        if (isStablecoin) {
            const virtualContractAddress = foundTx.currency === 'USDT' 
                ? '0x55d398326f99059ff775485246999027b3197955'
                : '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';

            const decimals = 6;
            const amountRaw = BigInt(Math.floor((foundTx.amount || 0) * Math.pow(10, decimals)));

            logs.push({
                address: virtualContractAddress,
                topics: [
                    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(...) selector
                    ethers.zeroPadValue(fromAddr, 32).toLowerCase(),
                    ethers.zeroPadValue(toAddr, 32).toLowerCase()
                ],
                data: ethers.zeroPadValue('0x' + amountRaw.toString(16), 32),
                blockNumber: blockNumberHex,
                transactionHash: txHash,
                transactionIndex: '0x0',
                blockHash: foundBlock.hash,
                logIndex: '0x0',
                removed: false
            });
        }

        return {
            transactionHash: txHash,
            transactionIndex: '0x0',
            blockHash: foundBlock.hash,
            blockNumber: blockNumberHex,
            from: fromAddr,
            to: toAddr,
            cumulativeGasUsed: '0x5208',
            gasUsed: '0x5208',
            contractAddress: null,
            logs: logs,
            logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            status: '0x1' // Success status
        };
    }

    async getLiveNchPriceInUsd() {
        if (this._cachedNchPrice && Date.now() - (this._lastPriceFetch || 0) < 10000) {
            return this._cachedNchPrice;
        }
        try {
            const res = await axios.get('https://cheeseblockchain.com/dex/api/dex/price/NCHEESE', { timeout: 3000 });
            if (res.data && parseFloat(res.data.price) > 0) {
                this._cachedNchPrice = parseFloat(res.data.price);
                this._lastPriceFetch = Date.now();
                return this._cachedNchPrice;
            }
        } catch (e) {}

        try {
            const localRes = await axios.get('http://127.0.0.1:5000/api/market-prices', { timeout: 2000 });
            if (localRes.data && localRes.data.prices && localRes.data.prices.NCH) {
                const p = parseFloat(localRes.data.prices.NCH.usd);
                if (p > 0) {
                    this._cachedNchPrice = p;
                    this._lastPriceFetch = Date.now();
                    return this._cachedNchPrice;
                }
            }
        } catch (err) {}

        // ============================================================
        // NO hardcoded fallback price — must come from live sources.
        // ============================================================
        console.error('❌ [RPC] getLiveNchPriceInUsd: All price sources failed. ' +
            'DEX pool or local market-prices API must be online.');
        throw new Error('NCH_PRICE_UNAVAILABLE: Unable to fetch live NCH price from any source. Ensure the DEX pool has liquidity.');
    }

    async getDynamicGasPriceWeiHex() {
        // ============================================================
        // FIXED FEE POLICY: Always exactly $1.00 USD worth of NCH.
        // NO hardcoded fallback prices.
        // ============================================================
        const nchPriceUsdt = await this.getLiveNchPriceInUsd(); // throws if unavailable
        // Fee = exactly $1.00 USD in NCH
        const requiredFeeNch = parseFloat((1.00 / nchPriceUsdt).toFixed(8));
        console.log(`💸 [RPC] Gas fee: $1.00 USD = ${requiredFeeNch} NCH  (NCH price: $${nchPriceUsdt})`);
        // Standard DEX transaction gas limit is 100,000 units (0x186a0)
        // Gas Price (Wei) = (RequiredFeeNCH * 1e18) / 100000
        const gasPriceWei = BigInt(Math.floor((requiredFeeNch * 1e18) / 100000));
        return '0x' + gasPriceWei.toString(16);
    }
}
module.exports = RPCBridge;
