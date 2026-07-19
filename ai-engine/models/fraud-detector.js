/**
 * CHEESE Blockchain - Pure JavaScript Neural Network
 * Genuine neural network implementation without external dependencies
 * 
 * THIS IS REAL AI - A working feedforward neural network
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

class NeuralNetwork {
    constructor(layerSizes) {
        this.layers = layerSizes;
        this.weights = [];
        this.biases = [];

        // Initialize weights and biases with random values
        for (let i = 0; i < layerSizes.length - 1; i++) {
            // Xavier initialization for weights
            const scale = Math.sqrt(2 / (layerSizes[i] + layerSizes[i + 1]));

            const weight = [];
            for (let j = 0; j < layerSizes[i]; j++) {
                const row = [];
                for (let k = 0; k < layerSizes[i + 1]; k++) {
                    row.push((Math.random() * 2 - 1) * scale);
                }
                weight.push(row);
            }
            this.weights.push(weight);

            const bias = [];
            for (let j = 0; j < layerSizes[i + 1]; j++) {
                bias.push(0);
            }
            this.biases.push(bias);
        }
    }

    // Sigmoid activation function
    sigmoid(x) {
        return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
    }

    // Sigmoid derivative
    sigmoidDerivative(x) {
        const s = this.sigmoid(x);
        return s * (1 - s);
    }

    // ReLU activation
    relu(x) {
        return Math.max(0, x);
    }

    // ReLU derivative
    reluDerivative(x) {
        return x > 0 ? 1 : 0;
    }

    // Forward propagation
    forward(input) {
        let activation = input;
        const activations = [input];
        const zValues = [];

        for (let i = 0; i < this.weights.length; i++) {
            const z = [];
            for (let j = 0; j < this.weights[i][0].length; j++) {
                let sum = this.biases[i][j];
                for (let k = 0; k < activation.length; k++) {
                    sum += activation[k] * this.weights[i][k][j];
                }
                z.push(sum);
            }
            zValues.push(z);

            // Use sigmoid for output layer, ReLU for hidden layers
            const isOutputLayer = i === this.weights.length - 1;
            activation = z.map(val => isOutputLayer ? this.sigmoid(val) : this.relu(val));
            activations.push(activation);
        }

        return { output: activation, activations, zValues };
    }

    // Predict
    predict(input) {
        return this.forward(input).output;
    }

    // Train with backpropagation
    train(trainingData, options = {}) {
        const learningRate = options.learningRate || 0.1;
        const iterations = options.iterations || 1000;
        const errorThresh = options.errorThresh || 0.005;
        const logPeriod = options.logPeriod || 100;
        const log = options.log || (() => { });

        let error = 1;
        let iteration = 0;

        while (iteration < iterations && error > errorThresh) {
            let totalError = 0;

            for (const sample of trainingData) {
                const input = sample.input;
                const target = sample.output;

                // Forward pass
                const { output, activations, zValues } = this.forward(input);

                // Calculate output error
                const outputError = [];
                for (let i = 0; i < output.length; i++) {
                    const err = target[i] - output[i];
                    totalError += err * err;
                    outputError.push(err);
                }

                // Backpropagation
                let delta = outputError.map((err, i) =>
                    err * output[i] * (1 - output[i]) // sigmoid derivative
                );

                for (let layer = this.weights.length - 1; layer >= 0; layer--) {
                    const prevActivation = activations[layer];

                    // Update weights and biases
                    for (let j = 0; j < this.weights[layer][0].length; j++) {
                        for (let k = 0; k < this.weights[layer].length; k++) {
                            this.weights[layer][k][j] += learningRate * delta[j] * prevActivation[k];
                        }
                        this.biases[layer][j] += learningRate * delta[j];
                    }

                    // Calculate delta for previous layer
                    if (layer > 0) {
                        const newDelta = [];
                        for (let k = 0; k < this.weights[layer].length; k++) {
                            let sum = 0;
                            for (let j = 0; j < delta.length; j++) {
                                sum += delta[j] * this.weights[layer][k][j];
                            }
                            // ReLU derivative for hidden layers
                            newDelta.push(sum * this.reluDerivative(zValues[layer - 1][k]));
                        }
                        delta = newDelta;
                    }
                }
            }

            error = totalError / trainingData.length;
            iteration++;

            if (iteration % logPeriod === 0) {
                log({ iterations: iteration, error });
            }
        }

        return { iterations: iteration, error };
    }

    // Export model
    toJSON() {
        return {
            layers: this.layers,
            weights: this.weights,
            biases: this.biases
        };
    }

    // Import model
    fromJSON(json) {
        this.layers = json.layers;
        this.weights = json.weights;
        this.biases = json.biases;
    }
}

/**
 * Pure JavaScript Fraud Detector Neural Network
 */
class FraudDetectorNN {
    constructor() {
        // Create a real neural network: 8 inputs -> 16 hidden -> 8 hidden -> 1 output
        this.network = new NeuralNetwork([8, 16, 8, 1]);

        this.isTrained = false;
        this.trainingHistory = [];
        this.accuracy = 0;

        // Feature normalization bounds
        this.bounds = {
            amount: { min: 0, max: 10000000 },
            frequency: { min: 0, max: 100 },
            timeSinceLastTx: { min: 0, max: 86400000 },
            uniqueRecipients: { min: 0, max: 1000 },
            avgAmount: { min: 0, max: 1000000 },
            txCount: { min: 0, max: 10000 },
            accountAge: { min: 0, max: 31536000000 },
            gasPrice: { min: 0, max: 1000 }
        };

        console.log('🧠 Pure JS Neural Network Fraud Detector initialized');
        console.log('   Architecture: 8 → 16 → 8 → 1');
        console.log('   Activation: ReLU (hidden), Sigmoid (output)');
    }

    normalize(value, min, max) {
        if (max === min) return 0.5;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    extractFeatures(transaction, context = {}) {
        return [
            this.normalize(transaction.amount || 0, this.bounds.amount.min, this.bounds.amount.max),
            this.normalize(context.frequency || 0, this.bounds.frequency.min, this.bounds.frequency.max),
            this.normalize(context.timeSinceLastTx || 86400000, this.bounds.timeSinceLastTx.min, this.bounds.timeSinceLastTx.max),
            this.normalize(context.uniqueRecipients || 1, this.bounds.uniqueRecipients.min, this.bounds.uniqueRecipients.max),
            this.normalize(context.avgAmount || transaction.amount || 0, this.bounds.avgAmount.min, this.bounds.avgAmount.max),
            this.normalize(context.txCount || 1, this.bounds.txCount.min, this.bounds.txCount.max),
            this.normalize(context.accountAge || 86400000, this.bounds.accountAge.min, this.bounds.accountAge.max),
            this.normalize(transaction.gasPrice || 0, this.bounds.gasPrice.min, this.bounds.gasPrice.max)
        ];
    }

    async train(trainingData) {
        console.log('🎓 Training fraud detection neural network...');
        console.log(`   Training samples: ${trainingData.length}`);

        const formattedData = trainingData.map(sample => ({
            input: this.extractFeatures(sample.transaction, sample.context || {}),
            output: [sample.isFraud ? 1 : 0]
        }));

        const result = this.network.train(formattedData, {
            iterations: 2000,
            errorThresh: 0.005,
            learningRate: 0.1,
            log: (stats) => console.log(`   Iteration ${stats.iterations}: error = ${stats.error.toFixed(6)}`),
            logPeriod: 500
        });

        this.isTrained = true;
        this.trainingHistory.push({
            timestamp: Date.now(),
            samples: trainingData.length,
            error: result.error,
            iterations: result.iterations
        });

        // Calculate accuracy
        let correct = 0;
        for (const sample of formattedData) {
            const prediction = this.network.predict(sample.input)[0];
            const predicted = prediction > 0.5 ? 1 : 0;
            if (predicted === sample.output[0]) correct++;
        }
        this.accuracy = correct / formattedData.length;

        console.log(`✅ Training complete!`);
        console.log(`   Final error: ${result.error.toFixed(6)}`);
        console.log(`   Iterations: ${result.iterations}`);
        console.log(`   Accuracy: ${(this.accuracy * 100).toFixed(2)}%`);

        return { success: true, error: result.error, iterations: result.iterations, accuracy: this.accuracy };
    }

    predict(transaction, context = {}) {
        const features = this.extractFeatures(transaction, context);
        const output = this.network.predict(features);
        const fraudProbability = output[0];

        return {
            fraudProbability: parseFloat(fraudProbability.toFixed(4)),
            isFraud: fraudProbability > 0.5,
            confidence: Math.abs(fraudProbability - 0.5) * 2,
            riskLevel: fraudProbability > 0.8 ? 'critical' :
                fraudProbability > 0.6 ? 'high' :
                    fraudProbability > 0.4 ? 'medium' :
                        fraudProbability > 0.2 ? 'low' : 'minimal',
            features: features,
            method: 'neural_network',
            modelType: 'pure_js_feedforward_nn',
            isTrained: this.isTrained,
            accuracy: this.accuracy,
            isRealAI: true
        };
    }

    async learnFromFeedback(transaction, context, wasFraud) {
        const features = this.extractFeatures(transaction, context);

        this.network.train([{
            input: features,
            output: [wasFraud ? 1 : 0]
        }], {
            iterations: 100,
            errorThresh: 0.01,
            learningRate: 0.05
        });

        console.log(`🎓 Learned from feedback: ${wasFraud ? 'FRAUD' : 'LEGIT'}`);
        return { success: true, learned: true };
    }

    generateSyntheticTrainingData(count = 1000) {
        const data = [];

        for (let i = 0; i < count; i++) {
            const isFraud = Math.random() > 0.9;

            const transaction = {
                amount: isFraud ? Math.random() * 5000000 + 500000 : Math.random() * 10000,
                gasPrice: isFraud ? Math.random() * 500 + 500 : Math.random() * 100
            };

            const context = {
                frequency: isFraud ? Math.random() * 50 + 50 : Math.random() * 10,
                timeSinceLastTx: isFraud ? Math.random() * 60000 : Math.random() * 86400000,
                uniqueRecipients: isFraud ? Math.random() * 500 + 500 : Math.random() * 50,
                avgAmount: transaction.amount * (0.5 + Math.random()),
                txCount: isFraud ? Math.random() * 5000 + 5000 : Math.random() * 100,
                accountAge: isFraud ? Math.random() * 86400000 : Math.random() * 31536000000
            };

            data.push({ transaction, context, isFraud });
        }

        return data;
    }

    getInfo() {
        return {
            type: 'Neural Network',
            library: 'pure_javascript',
            architecture: '8 → 16 → 8 → 1',
            activation: 'ReLU + Sigmoid',
            isTrained: this.isTrained,
            accuracy: this.accuracy,
            trainingHistory: this.trainingHistory,
            isRealAI: true
        };
    }

    exportModel() {
        return this.network.toJSON();
    }

    importModel(json) {
        this.network.fromJSON(json);
        this.isTrained = true;
        console.log('📥 Neural network model imported');
    }
}

module.exports = { NeuralNetwork, FraudDetectorNN };
