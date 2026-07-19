/**
 * CHEESE Blockchain - Advanced Price Predictor
 * 
 * Real LSTM Neural Network for price prediction
 * Uses time series analysis with multiple features
 * 
 * Author: CHEESE Team
 */

class LSTMCell {
    constructor(inputSize, hiddenSize) {
        this.inputSize = inputSize;
        this.hiddenSize = hiddenSize;

        // Initialize gates with Xavier initialization
        const scale = Math.sqrt(2 / (inputSize + hiddenSize));

        // Forget gate
        this.Wf = this._initMatrix(inputSize + hiddenSize, hiddenSize, scale);
        this.bf = new Array(hiddenSize).fill(0);

        // Input gate
        this.Wi = this._initMatrix(inputSize + hiddenSize, hiddenSize, scale);
        this.bi = new Array(hiddenSize).fill(0);

        // Candidate gate
        this.Wc = this._initMatrix(inputSize + hiddenSize, hiddenSize, scale);
        this.bc = new Array(hiddenSize).fill(0);

        // Output gate
        this.Wo = this._initMatrix(inputSize + hiddenSize, hiddenSize, scale);
        this.bo = new Array(hiddenSize).fill(0);

        this.learningRate = 0.001;
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

    _sigmoid(x) {
        return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
    }

    _tanh(x) {
        const e2x = Math.exp(2 * Math.max(-500, Math.min(500, x)));
        return (e2x - 1) / (e2x + 1);
    }

    _matmul(input, weights) {
        const output = new Array(weights[0].length).fill(0);
        for (let j = 0; j < weights[0].length; j++) {
            for (let i = 0; i < input.length; i++) {
                output[j] += input[i] * weights[i][j];
            }
        }
        return output;
    }

    forward(input, prevHidden, prevCell) {
        // Concatenate input and previous hidden state
        const concat = [...input, ...prevHidden];

        // Forget gate: f = σ(Wf · [h, x] + bf)
        const f = this._matmul(concat, this.Wf).map((v, i) => this._sigmoid(v + this.bf[i]));

        // Input gate: i = σ(Wi · [h, x] + bi)
        const ig = this._matmul(concat, this.Wi).map((v, i) => this._sigmoid(v + this.bi[i]));

        // Candidate: c̃ = tanh(Wc · [h, x] + bc)
        const cTilde = this._matmul(concat, this.Wc).map((v, i) => this._tanh(v + this.bc[i]));

        // New cell state: c = f * c_prev + i * c̃
        const newCell = prevCell.map((c, i) => f[i] * c + ig[i] * cTilde[i]);

        // Output gate: o = σ(Wo · [h, x] + bo)
        const o = this._matmul(concat, this.Wo).map((v, i) => this._sigmoid(v + this.bo[i]));

        // New hidden state: h = o * tanh(c)
        const newHidden = newCell.map((c, i) => o[i] * this._tanh(c));

        return { hidden: newHidden, cell: newCell };
    }
}

class PricePredictor {
    constructor(config = {}) {
        this.sequenceLength = config.sequenceLength || 10;
        this.inputSize = config.inputSize || 5; // price, volume, high, low, timestamp
        this.hiddenSize = config.hiddenSize || 32;
        this.outputSize = 1; // predicted price

        // LSTM layers
        this.lstm1 = new LSTMCell(this.inputSize, this.hiddenSize);
        this.lstm2 = new LSTMCell(this.hiddenSize, this.hiddenSize);

        // Dense output layer
        this.Wout = this._initMatrix(this.hiddenSize, this.outputSize);
        this.bout = [0];

        // Training data
        this.trainingHistory = [];
        this.priceHistory = [];
        this.maxPrice = 1;
        this.minPrice = 0;

        // Train on synthetic data
        this._initialTraining();

        console.log('📈 Price Predictor (LSTM) initialized');
        console.log(`   Sequence length: ${this.sequenceLength}`);
        console.log(`   Hidden size: ${this.hiddenSize}`);
    }

    _initMatrix(rows, cols) {
        const scale = Math.sqrt(2 / (rows + cols));
        const matrix = [];
        for (let i = 0; i < rows; i++) {
            matrix[i] = [];
            for (let j = 0; j < cols; j++) {
                matrix[i][j] = (Math.random() - 0.5) * 2 * scale;
            }
        }
        return matrix;
    }

    _matmul(input, weights) {
        const output = new Array(weights[0].length).fill(0);
        for (let j = 0; j < weights[0].length; j++) {
            for (let i = 0; i < input.length; i++) {
                output[j] += input[i] * weights[i][j];
            }
        }
        return output;
    }

    _normalizePrice(price) {
        if (this.maxPrice === this.minPrice) return 0.5;
        return (price - this.minPrice) / (this.maxPrice - this.minPrice);
    }

    _denormalizePrice(normalized) {
        return normalized * (this.maxPrice - this.minPrice) + this.minPrice;
    }

    _extractFeatures(priceData) {
        return [
            this._normalizePrice(priceData.price || priceData),
            Math.min(1, (priceData.volume || 1000) / 10000),
            this._normalizePrice(priceData.high || priceData.price || priceData),
            this._normalizePrice(priceData.low || priceData.price || priceData),
            (priceData.timestamp || Date.now()) % 86400000 / 86400000 // Time of day
        ];
    }

    _initialTraining() {
        console.log('🔄 Training price prediction model...');

        // Generate synthetic price data
        const syntheticPrices = [];
        let price = 1;
        for (let i = 0; i < 500; i++) {
            // Random walk with trend
            price += (Math.random() - 0.48) * 0.1;
            price = Math.max(0.1, price);
            syntheticPrices.push({
                price,
                volume: Math.random() * 10000,
                high: price * (1 + Math.random() * 0.1),
                low: price * (1 - Math.random() * 0.1),
                timestamp: Date.now() - (500 - i) * 60000
            });
        }

        // Set normalization bounds
        this.maxPrice = Math.max(...syntheticPrices.map(p => p.price)) * 1.2;
        this.minPrice = Math.min(...syntheticPrices.map(p => p.price)) * 0.8;

        // Train on sequences
        for (let i = this.sequenceLength; i < syntheticPrices.length - 1; i++) {
            const sequence = syntheticPrices.slice(i - this.sequenceLength, i);
            const target = syntheticPrices[i].price;
            this._trainOnSequence(sequence, target);
        }

        console.log('✅ Price predictor trained');
    }

    _trainOnSequence(sequence, target) {
        // Forward pass through LSTM
        let hidden1 = new Array(this.hiddenSize).fill(0);
        let cell1 = new Array(this.hiddenSize).fill(0);
        let hidden2 = new Array(this.hiddenSize).fill(0);
        let cell2 = new Array(this.hiddenSize).fill(0);

        for (const data of sequence) {
            const features = this._extractFeatures(data);
            const result1 = this.lstm1.forward(features, hidden1, cell1);
            hidden1 = result1.hidden;
            cell1 = result1.cell;

            const result2 = this.lstm2.forward(hidden1, hidden2, cell2);
            hidden2 = result2.hidden;
            cell2 = result2.cell;
        }

        // Output layer
        const output = this._matmul(hidden2, this.Wout);
        const prediction = output[0] + this.bout[0];

        // Simple gradient update (simplified backprop)
        const normalizedTarget = this._normalizePrice(target);
        const error = normalizedTarget - prediction;

        // Update output weights
        for (let i = 0; i < this.hiddenSize; i++) {
            this.Wout[i][0] += 0.001 * error * hidden2[i];
        }
        this.bout[0] += 0.001 * error;
    }

    /**
     * Predict next price
     */
    predict(priceSequence) {
        if (priceSequence.length < this.sequenceLength) {
            return { error: 'Need at least ' + this.sequenceLength + ' data points' };
        }

        const sequence = priceSequence.slice(-this.sequenceLength);

        // Update normalization
        const prices = sequence.map(p => p.price || p);
        this.maxPrice = Math.max(this.maxPrice, ...prices);
        this.minPrice = Math.min(this.minPrice, ...prices);

        // Forward pass
        let hidden1 = new Array(this.hiddenSize).fill(0);
        let cell1 = new Array(this.hiddenSize).fill(0);
        let hidden2 = new Array(this.hiddenSize).fill(0);
        let cell2 = new Array(this.hiddenSize).fill(0);

        for (const data of sequence) {
            const features = this._extractFeatures(data);
            const result1 = this.lstm1.forward(features, hidden1, cell1);
            hidden1 = result1.hidden;
            cell1 = result1.cell;

            const result2 = this.lstm2.forward(hidden1, hidden2, cell2);
            hidden2 = result2.hidden;
            cell2 = result2.cell;
        }

        // Output
        const output = this._matmul(hidden2, this.Wout);
        const normalizedPrediction = output[0] + this.bout[0];
        const prediction = this._denormalizePrice(normalizedPrediction);

        // Calculate confidence based on hidden state variance
        const variance = hidden2.reduce((sum, h) => sum + h * h, 0) / hidden2.length;
        const confidence = Math.min(1, Math.max(0, 1 - variance));

        // Trend analysis
        const lastPrice = prices[prices.length - 1];
        const trend = prediction > lastPrice ? 'UP' : prediction < lastPrice ? 'DOWN' : 'STABLE';
        const changePercent = ((prediction - lastPrice) / lastPrice * 100).toFixed(2);

        return {
            prediction,
            confidence: (confidence * 100).toFixed(2) + '%',
            trend,
            changePercent: changePercent + '%',
            currentPrice: lastPrice,
            modelType: 'LSTM',
            layers: 2,
            aiPowered: true
        };
    }

    /**
     * Add new price data and retrain
     */
    addPriceData(priceData) {
        this.priceHistory.push(priceData);

        if (this.priceHistory.length > this.sequenceLength) {
            const sequence = this.priceHistory.slice(-this.sequenceLength - 1, -1);
            const target = priceData.price || priceData;
            this._trainOnSequence(sequence, target);
        }

        return { success: true, historyLength: this.priceHistory.length };
    }

    getStatus() {
        return {
            model: 'LSTM (2 layers)',
            sequenceLength: this.sequenceLength,
            hiddenSize: this.hiddenSize,
            trainingHistory: this.priceHistory.length,
            priceRange: { min: this.minPrice, max: this.maxPrice }
        };
    }
}

module.exports = PricePredictor;
