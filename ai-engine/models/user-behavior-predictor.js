/**
 * CHEESE Blockchain - User Behavior Predictor
 * 
 * ML model for predicting user actions and detecting anomalies
 * Uses behavioral pattern recognition and clustering
 * 
 * Author: CHEESE Team
 */

class UserBehaviorPredictor {
    constructor() {
        // User profiles (learned)
        this.userProfiles = new Map();

        // Action prediction network
        this.actionNetwork = this._initNetwork(15, 32, 8);
        // Actions: [transfer, stake, unstake, swap, mint, claim, vote, other]

        // Anomaly detection network
        this.anomalyNetwork = this._initNetwork(12, 24, 2); // [normal, anomaly]

        // Behavior clusters
        this.clusters = {
            whale: { minBalance: 100000, minTxValue: 10000 },
            trader: { minTxCount: 50, avgHoldTime: 3600000 },
            holder: { avgHoldTime: 604800000, minTxCount: 1 },
            newUser: { maxAge: 604800000, maxTxCount: 5 }
        };

        this._train();

        console.log('👤 User Behavior Predictor initialized');
    }

    _initNetwork(input, hidden, output) {
        const scale = Math.sqrt(2 / (input + hidden));
        return {
            W1: this._initMatrix(input, hidden, scale),
            b1: new Array(hidden).fill(0),
            W2: this._initMatrix(hidden, output, Math.sqrt(2 / (hidden + output))),
            b2: new Array(output).fill(0)
        };
    }

    _initMatrix(rows, cols, scale) {
        const matrix = [];
        for (let i = 0; i < rows; i++) {
            matrix[i] = [];
            for (let j = 0; j < cols; j++) {
                matrix[i][j] = (Math.random() - 0.5) * 2 * scale;
            }
        }
        return matrix;
    }

    _forward(input, network) {
        // Hidden layer with ReLU
        const hidden = new Array(network.W1[0].length).fill(0);
        for (let j = 0; j < network.W1[0].length; j++) {
            for (let i = 0; i < input.length; i++) {
                hidden[j] += input[i] * network.W1[i][j];
            }
            hidden[j] = Math.max(0, hidden[j] + network.b1[j]);
        }

        // Output layer
        const output = new Array(network.W2[0].length).fill(0);
        for (let j = 0; j < network.W2[0].length; j++) {
            for (let i = 0; i < hidden.length; i++) {
                output[j] += hidden[i] * network.W2[i][j];
            }
            output[j] += network.b2[j];
        }

        // Softmax
        const max = Math.max(...output);
        const exp = output.map(v => Math.exp(v - max));
        const sum = exp.reduce((a, b) => a + b, 0);
        return exp.map(v => v / sum);
    }

    _train() {
        // Train action prediction
        for (let i = 0; i < 300; i++) {
            // Transfer pattern
            this._trainAction([0.5, 0.3, 0.1, 0.2, 0.4, 0.1, 0.2, 0.3, 0.1, 0.2, 0.5, 0.3, 0.1, 0.2, 0.4], [0.8, 0.1, 0.0, 0.05, 0.0, 0.0, 0.0, 0.05]);
            // Stake pattern
            this._trainAction([0.8, 0.7, 0.9, 0.1, 0.1, 0.2, 0.8, 0.1, 0.9, 0.1, 0.2, 0.8, 0.7, 0.1, 0.1], [0.1, 0.7, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1]);
            // Swap pattern
            this._trainAction([0.3, 0.6, 0.2, 0.8, 0.7, 0.5, 0.3, 0.6, 0.2, 0.8, 0.7, 0.5, 0.3, 0.6, 0.2], [0.1, 0.0, 0.0, 0.8, 0.0, 0.0, 0.0, 0.1]);

            // Anomaly training
            this._trainAnomaly([0.2, 0.3, 0.1, 0.2, 0.4, 0.1, 0.2, 0.3, 0.1, 0.2, 0.5, 0.3], [0.9, 0.1]); // Normal
            this._trainAnomaly([0.9, 0.8, 0.9, 0.8, 0.9, 0.9, 0.8, 0.9, 0.9, 0.8, 0.9, 0.9], [0.1, 0.9]); // Anomaly
        }
    }

    _trainAction(input, target) {
        const output = this._forward(input, this.actionNetwork);
        const lr = 0.01;
        const errors = target.map((t, i) => t - output[i]);

        for (let i = 0; i < this.actionNetwork.W2.length; i++) {
            for (let j = 0; j < this.actionNetwork.W2[i].length; j++) {
                this.actionNetwork.W2[i][j] += lr * errors[j];
            }
        }
    }

    _trainAnomaly(input, target) {
        const output = this._forward(input, this.anomalyNetwork);
        const lr = 0.01;
        const errors = target.map((t, i) => t - output[i]);

        for (let i = 0; i < this.anomalyNetwork.W2.length; i++) {
            for (let j = 0; j < this.anomalyNetwork.W2[i].length; j++) {
                this.anomalyNetwork.W2[i][j] += lr * errors[j];
            }
        }
    }

    /**
     * Update user profile with new action
     */
    updateProfile(address, action) {
        const lowAddr = address.toLowerCase();
        let profile = this.userProfiles.get(lowAddr) || {
            address: lowAddr,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            txCount: 0,
            totalVolume: 0,
            actions: [],
            avgTxValue: 0,
            balance: 0
        };

        profile.lastSeen = Date.now();
        profile.txCount++;
        profile.totalVolume += action.amount || 0;
        profile.avgTxValue = profile.totalVolume / profile.txCount;
        profile.balance = action.balance || profile.balance;
        profile.actions.push({
            type: action.type,
            amount: action.amount,
            timestamp: Date.now()
        });

        // Keep only last 100 actions
        if (profile.actions.length > 100) {
            profile.actions.shift();
        }

        this.userProfiles.set(lowAddr, profile);
        return profile;
    }

    /**
     * Predict next user action
     */
    predictNextAction(address) {
        const profile = this.userProfiles.get(address.toLowerCase());

        if (!profile || profile.txCount < 3) {
            return {
                prediction: 'transfer',
                confidence: '50%',
                reason: 'Insufficient history'
            };
        }

        const features = this._extractBehaviorFeatures(profile);
        const probs = this._forward(features, this.actionNetwork);

        const actions = ['transfer', 'stake', 'unstake', 'swap', 'mint', 'claim', 'vote', 'other'];
        const maxIdx = probs.indexOf(Math.max(...probs));

        return {
            prediction: actions[maxIdx],
            confidence: (Math.max(...probs) * 100).toFixed(2) + '%',
            probabilities: Object.fromEntries(actions.map((a, i) => [a, (probs[i] * 100).toFixed(2) + '%'])),
            basedOnTxCount: profile.txCount,
            aiPowered: true
        };
    }

    /**
     * Detect anomalous behavior
     */
    detectAnomaly(address, action) {
        const profile = this.userProfiles.get(address.toLowerCase());
        const features = this._extractAnomalyFeatures(profile, action);
        const probs = this._forward(features, this.anomalyNetwork);

        const isAnomaly = probs[1] > probs[0];
        const anomalyScore = probs[1];

        return {
            isAnomaly,
            anomalyScore: (anomalyScore * 100).toFixed(2) + '%',
            classification: isAnomaly ? 'ANOMALOUS' : 'NORMAL',
            factors: this._identifyAnomalyFactors(profile, action),
            aiPowered: true
        };
    }

    /**
     * Classify user type
     */
    classifyUser(address) {
        const profile = this.userProfiles.get(address.toLowerCase());

        if (!profile) {
            return { userType: 'UNKNOWN', reason: 'No profile found' };
        }

        const age = Date.now() - profile.firstSeen;

        if (age < this.clusters.newUser.maxAge && profile.txCount < this.clusters.newUser.maxTxCount) {
            return { userType: 'NEW_USER', metrics: { age, txCount: profile.txCount } };
        }

        if (profile.balance >= this.clusters.whale.minBalance) {
            return { userType: 'WHALE', metrics: { balance: profile.balance } };
        }

        if (profile.txCount >= this.clusters.trader.minTxCount) {
            return { userType: 'TRADER', metrics: { txCount: profile.txCount } };
        }

        return { userType: 'HOLDER', metrics: { age, balance: profile.balance } };
    }

    _extractBehaviorFeatures(profile) {
        const recentActions = profile.actions.slice(-10);
        const actionTypes = {};
        for (const a of recentActions) {
            actionTypes[a.type] = (actionTypes[a.type] || 0) + 1;
        }

        return [
            Math.min(profile.txCount / 100, 1),
            Math.min(profile.avgTxValue / 10000, 1),
            Math.min((Date.now() - profile.firstSeen) / (30 * 24 * 60 * 60 * 1000), 1),
            Math.min(profile.balance / 100000, 1),
            (actionTypes.transfer || 0) / 10,
            (actionTypes.stake || 0) / 10,
            (actionTypes.swap || 0) / 10,
            (actionTypes.claim || 0) / 10,
            recentActions.length / 10,
            Math.min((Date.now() - profile.lastSeen) / (24 * 60 * 60 * 1000), 1),
            profile.totalVolume > 0 ? 1 : 0,
            Math.min(recentActions.length / profile.txCount, 1),
            0.5, 0.5, 0.5 // Padding
        ];
    }

    _extractAnomalyFeatures(profile, action) {
        if (!profile) {
            return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
        }

        const amountDev = profile.avgTxValue > 0
            ? Math.abs(action.amount - profile.avgTxValue) / profile.avgTxValue
            : 0;

        return [
            Math.min(amountDev, 1),
            action.amount > profile.avgTxValue * 10 ? 1 : 0,
            action.amount > profile.balance * 0.8 ? 1 : 0,
            profile.txCount < 5 ? 1 : 0,
            (Date.now() - profile.lastSeen) < 60000 ? 1 : 0, // Rapid fire
            0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5 // Padding
        ];
    }

    _identifyAnomalyFactors(profile, action) {
        const factors = [];

        if (!profile) {
            factors.push('Unknown user');
            return factors;
        }

        if (action.amount > profile.avgTxValue * 5) {
            factors.push('Unusually large amount');
        }
        if (action.amount > profile.balance * 0.9) {
            factors.push('Near total balance drain');
        }
        if ((Date.now() - profile.lastSeen) < 30000) {
            factors.push('Rapid consecutive transactions');
        }
        if (profile.txCount < 3) {
            factors.push('Low history');
        }

        return factors.length ? factors : ['None identified'];
    }

    getStatus() {
        return {
            models: {
                actionPrediction: '15→32→8',
                anomalyDetection: '12→24→2'
            },
            profilesTracked: this.userProfiles.size,
            clusterTypes: Object.keys(this.clusters)
        };
    }
}

module.exports = UserBehaviorPredictor;
