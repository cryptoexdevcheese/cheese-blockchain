/**
 * CHEESE Blockchain - OpenAI GPT Integration
 * 
 * Real GPT-powered AI for intelligent blockchain analysis:
 * - Transaction intent analysis
 * - Smart contract vulnerability detection
 * - Natural language explanations
 * - Fraud pattern recognition
 * 
 * Author: CHEESE Team
 */

// Use dynamic import for ES modules
let Anthropic, OpenAI;

class GPTBlockchainAnalyzer {
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
        this.model = options.model || 'gpt-4-turbo-preview';
        this.fallbackModel = 'gpt-3.5-turbo';

        this.systemPrompt = `You are an expert blockchain security analyst for the CHEESE blockchain. 
Your role is to analyze transactions, smart contracts, and user behavior for:
1. Security threats and fraud patterns
2. Transaction intent and risk levels
3. Smart contract vulnerabilities
4. Anomalous patterns that may indicate attacks

Always respond with structured JSON when asked for analysis.
Be concise but thorough. Flag anything suspicious.`;

        this.requestCount = 0;
        this.cache = new Map();
        this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes

        this.isConfigured = !!this.apiKey;

        if (this.isConfigured) {
            console.log('🤖 OpenAI GPT Integration initialized');
            console.log(`   Model: ${this.model}`);
        } else {
            console.log('⚠️ OpenAI API key not configured - GPT features disabled');
        }
    }

    async _callGPT(messages, options = {}) {
        if (!this.isConfigured) {
            return { error: 'OpenAI API key not configured', fallback: true };
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: options.model || this.model,
                    messages: [
                        { role: 'system', content: this.systemPrompt },
                        ...messages
                    ],
                    temperature: options.temperature || 0.3,
                    max_tokens: options.maxTokens || 1000,
                    response_format: options.jsonMode ? { type: 'json_object' } : undefined
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'API request failed');
            }

            const data = await response.json();
            this.requestCount++;

            return {
                success: true,
                content: data.choices[0].message.content,
                model: data.model,
                usage: data.usage
            };
        } catch (error) {
            console.error('GPT API error:', error.message);
            return { error: error.message, fallback: true };
        }
    }

    /**
     * Analyze transaction intent and risk
     */
    async analyzeTransaction(transaction, context = {}) {
        const cacheKey = `tx_${JSON.stringify(transaction)}`;
        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        const prompt = `Analyze this blockchain transaction for risk and intent:

Transaction:
${JSON.stringify(transaction, null, 2)}

Context:
- Sender balance: ${context.senderBalance || 'unknown'}
- Sender transaction history: ${context.txCount || 0} transactions
- Account age: ${context.accountAge ? Math.floor(context.accountAge / 86400000) + ' days' : 'unknown'}
- Is new recipient: ${context.isNewRecipient ? 'Yes' : 'No'}

Respond in JSON format:
{
  "intent": "transfer|stake|swap|suspicious|unknown",
  "riskLevel": "low|medium|high|critical",
  "riskScore": 0-100,
  "concerns": ["list of concerns if any"],
  "recommendation": "approve|review|block",
  "explanation": "brief explanation"
}`;

        const result = await this._callGPT([{ role: 'user', content: prompt }], { jsonMode: true });

        if (result.error) {
            return this._fallbackTransactionAnalysis(transaction, context);
        }

        try {
            const analysis = JSON.parse(result.content);
            analysis.model = result.model;
            analysis.aiType = 'gpt';
            analysis.realAI = true;

            this._addToCache(cacheKey, analysis);
            return analysis;
        } catch (e) {
            return { error: 'Failed to parse GPT response', raw: result.content };
        }
    }

    /**
     * Analyze smart contract for vulnerabilities
     */
    async analyzeContract(contractCode, contractName = 'Unknown') {
        if (!contractCode || contractCode.length < 50) {
            return { error: 'Contract code too short or invalid' };
        }

        const prompt = `Analyze this smart contract for security vulnerabilities:

Contract Name: ${contractName}
\`\`\`solidity
${contractCode.substring(0, 8000)}
\`\`\`

Respond in JSON format:
{
  "overallRisk": "low|medium|high|critical",
  "vulnerabilities": [
    {
      "type": "reentrancy|overflow|access_control|etc",
      "severity": "low|medium|high|critical",
      "location": "line number or function name",
      "description": "brief description",
      "recommendation": "how to fix"
    }
  ],
  "gasOptimizations": ["list of suggestions"],
  "bestPractices": ["list of missing best practices"],
  "summary": "overall assessment"
}`;

        const result = await this._callGPT([{ role: 'user', content: prompt }], {
            jsonMode: true,
            maxTokens: 2000
        });

        if (result.error) {
            return this._fallbackContractAnalysis(contractCode);
        }

        try {
            const analysis = JSON.parse(result.content);
            analysis.model = result.model;
            analysis.aiType = 'gpt';
            analysis.realAI = true;
            return analysis;
        } catch (e) {
            return { error: 'Failed to parse GPT response', raw: result.content };
        }
    }

    /**
     * Explain a transaction in natural language
     */
    async explainTransaction(transaction, recipientName = null) {
        const prompt = `Explain this blockchain transaction in simple terms for a non-technical user:

${JSON.stringify(transaction, null, 2)}

${recipientName ? `Recipient is known as: ${recipientName}` : ''}

Provide a brief, friendly explanation in 1-2 sentences.`;

        const result = await this._callGPT([{ role: 'user', content: prompt }]);

        if (result.error) {
            return {
                explanation: `Transfer of ${transaction.amount || 0} coins from ${transaction.from?.slice(0, 8) || 'unknown'}... to ${transaction.to?.slice(0, 8) || 'unknown'}...`,
                fallback: true
            };
        }

        return {
            explanation: result.content,
            model: result.model,
            aiType: 'gpt'
        };
    }

    /**
     * Detect fraud patterns in transaction batch
     */
    async detectFraudPatterns(transactions) {
        if (!transactions || transactions.length === 0) {
            return { error: 'No transactions provided' };
        }

        const prompt = `Analyze these blockchain transactions for fraud patterns:

${JSON.stringify(transactions.slice(0, 20), null, 2)}

Look for:
1. Wash trading patterns
2. Pump and dump signals
3. Unusual transaction velocity
4. Coordinated wallet activity
5. Money laundering patterns

Respond in JSON:
{
  "fraudDetected": true/false,
  "confidence": 0-100,
  "patterns": [
    {
      "type": "pattern type",
      "description": "description",
      "involvedAddresses": ["addresses"],
      "severity": "low|medium|high|critical"
    }
  ],
  "recommendation": "what to do",
  "summary": "overall assessment"
}`;

        const result = await this._callGPT([{ role: 'user', content: prompt }], { jsonMode: true });

        if (result.error) {
            return { fraudDetected: false, fallback: true, reason: result.error };
        }

        try {
            const analysis = JSON.parse(result.content);
            analysis.model = result.model;
            analysis.aiType = 'gpt';
            analysis.realAI = true;
            return analysis;
        } catch (e) {
            return { error: 'Failed to parse GPT response' };
        }
    }

    /**
     * Get market sentiment from text
     */
    async analyzeSentiment(text) {
        const prompt = `Analyze the sentiment of this text related to cryptocurrency/blockchain:

"${text.substring(0, 500)}"

Respond in JSON:
{
  "sentiment": "positive|negative|neutral",
  "confidence": 0-100,
  "marketImplication": "bullish|bearish|neutral",
  "keyPhrases": ["important phrases"]
}`;

        const result = await this._callGPT([{ role: 'user', content: prompt }], { jsonMode: true });

        if (result.error) {
            return { sentiment: 'neutral', fallback: true };
        }

        try {
            return JSON.parse(result.content);
        } catch (e) {
            return { sentiment: 'neutral', error: 'Parse failed' };
        }
    }

    // Fallback methods when GPT is unavailable
    _fallbackTransactionAnalysis(tx, context) {
        const amount = tx.amount || 0;
        const isLarge = amount > (context.senderBalance || Infinity) * 0.5;
        const isNew = context.isNewRecipient;

        let riskLevel = 'low';
        let riskScore = 20;

        if (isLarge && isNew) {
            riskLevel = 'high';
            riskScore = 75;
        } else if (isLarge || isNew) {
            riskLevel = 'medium';
            riskScore = 45;
        }

        return {
            intent: tx.data?.type || 'transfer',
            riskLevel,
            riskScore,
            concerns: isLarge ? ['Large transaction'] : [],
            recommendation: riskScore > 50 ? 'review' : 'approve',
            explanation: 'Rule-based fallback analysis',
            fallback: true,
            aiType: 'rule_based'
        };
    }

    _fallbackContractAnalysis(code) {
        const vulnerabilities = [];

        if (code.includes('call.value') || code.includes('.call{value')) {
            vulnerabilities.push({ type: 'reentrancy', severity: 'high' });
        }
        if (!code.includes('SafeMath') && !code.includes('pragma solidity ^0.8')) {
            vulnerabilities.push({ type: 'overflow', severity: 'medium' });
        }

        return {
            overallRisk: vulnerabilities.length > 0 ? 'medium' : 'low',
            vulnerabilities,
            fallback: true,
            aiType: 'pattern_matching'
        };
    }

    _getFromCache(key) {
        const item = this.cache.get(key);
        if (item && Date.now() - item.timestamp < this.cacheMaxAge) {
            return item.data;
        }
        return null;
    }

    _addToCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });

        // Cleanup old entries
        if (this.cache.size > 1000) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    }

    getStatus() {
        return {
            configured: this.isConfigured,
            model: this.model,
            requestCount: this.requestCount,
            cacheSize: this.cache.size,
            aiType: 'OpenAI GPT',
            realAI: true
        };
    }
}

module.exports = GPTBlockchainAnalyzer;
