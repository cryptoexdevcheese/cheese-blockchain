const axios = require('axios');
const admin = require('firebase-admin');

class ChatService {
    constructor(db) {
        this.db = db;
        // Strict Scope Filter
        this.forbiddenKeywords = [
            'block', 'height', 'hashrate', 'mining', 'miner', 'consensus', 'node', 'sync'
        ];
    }

    /**
     * Process a user query with context-awareness
     */
    async processQuery(message, userAddress) {
        const trimmedMsg = message.trim();
        const lowerMsg = trimmedMsg.toLowerCase();

        // 1. STRICT SCOPE CHECK
        if (this.forbiddenKeywords.some(kw => lowerMsg.includes(kw))) {
            return "I focus purely on DEX trading 📊. For block details or mining info, please check the **Blockchain Explorer**.";
        }

        // 2. Fetch Context (Prices & Pools) - Essential for "Thinking"
        const context = await this.getContextData();

        // 3. AI / LLM Integration (Future Proofing)
        // If GEMINI_API_KEY exists, we would call it here with context.
        // For now, we use the "Smart Intent Engine".

        return this.smartFallbackEngine(trimmedMsg, userAddress, context);
    }

    /**
     * Gather real-time data for the bot to "think" with
     */
    async getContextData() {
        try {
            const prices = {};
            const pools = [];

            // 1. Try Firestore First
            if (this.db) {
                try {
                    const poolsSnapshot = await this.db.collection('dex_pools').get();
                    poolsSnapshot.forEach(doc => {
                        const pool = doc.data();
                        pools.push(pool);
                        this.extractPrices(pool, prices);
                    });
                } catch (e) {
                    console.warn('Chat context from Firestore failed, trying local fallback...');
                }
            }

            // 2. Fallback to hardcoded/preset data if Firestore is empty/fails
            if (pools.length === 0) {
                // Mock some active pools for the bot to be useful
                const mockPools = [
                    { token0: 'NCH', token1: 'USDT', reserve0: 500000, reserve1: 500000, pair: 'NCH/USDT' },
                    { token0: 'NCH', token1: 'ETH', reserve0: 10000, reserve1: 5, pair: 'NCH/ETH' }
                ];
                mockPools.forEach(p => {
                    pools.push(p);
                    this.extractPrices(p, prices);
                });
            }

            return { pools, prices };
        } catch (e) {
            console.error('Context Fetch Error:', e);
            return { pools: [], prices: {} };
        }
    }

    extractPrices(pool, prices) {
        const { token0, token1, reserve0, reserve1 } = pool;
        if (reserve0 > 0 && reserve1 > 0) {
            if (token1 === 'USDT' || token1 === 'USDC') prices[token0] = reserve1 / reserve0;
            else if (token0 === 'USDT' || token0 === 'USDC') prices[token1] = reserve0 / reserve1;
            if (token0 === 'USDT' || token0 === 'USDC') prices[token0] = 1.00;
            if (token1 === 'USDT' || token1 === 'USDC') prices[token1] = 1.00;
        }
    }

    /**
     * Rule-based Engine that mimics intelligence via Context
     */
    async smartFallbackEngine(message, userAddress, context) {
        const lowerMsg = message.toLowerCase();

        // A. Transaction Audit (Existing Logic)
        const txHashMatch = message.match(/0x[a-fA-F0-9]{64}/);
        if (txHashMatch) {
            return await this.auditTransaction(txHashMatch[0]);
        }

        // B. Price Check
        if (lowerMsg.includes('price')) {
            const token = Object.keys(context.prices).find(t => lowerMsg.includes(t.toLowerCase()));
            if (token) {
                return `The current price of **${token}** is **$${context.prices[token]}** 💰.`;
            }
            return "I can check prices! Ask me like: 'What is the price of ETH?'";
        }

        // C. Pool Inquiry
        if (lowerMsg.includes('pool') || lowerMsg.includes('trade')) {
            const token = Object.keys(context.prices).find(t => lowerMsg.includes(t.toLowerCase()));
            if (token) {
                const hasPool = context.pools.some(p => p.pair.includes(token));
                return hasPool
                    ? `Yes! We have a liquid **${token}** pool active. You can swap it now.`
                    : `I don't see a **${token}** pool yet. You can create one!`;
            }
            return `We currently have **${context.pools.length}** active liquidity pools.`;
        }

        // D. P2P / Escrow Explanation
        if (lowerMsg.includes('p2p') || lowerMsg.includes('escrow')) {
            return `**P2P Secure Trade** 🛡️\n\n1. **Seller** deposits asset to Vault.\n2. **Buyer** pays Vault.\n3. **Vault** swaps assets instantly.\n\nFunds are never at risk!`;
        }

        // E. General Help
        if (lowerMsg.includes('help') || lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
            return `Hello! I'm **Agent Cheese** 🧀.\n\nI can:\n- Check Prices ("Price of ETH")\n- Find Pools ("Is PEPE traded?")\n- Audit Transactions (Paste Hash)\n- Explain P2P Features\n\n*I do NOT discuss mining or blocks.*`;
        }

        // Default
        return "I didn't quite catch that. Try asking about **Prices**, **Pools**, or paste a **Transaction Hash**.";
    }

    async auditTransaction(txHash) {
        // Reuse existing logic, simplified return
        return `I see transaction ${txHash.substring(0, 6)}... \n\n(Context Audit would go here - integrated in next step)`;
    }
}

module.exports = ChatService;
