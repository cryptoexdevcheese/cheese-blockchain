/**
 * CHEESE Blockchain - Reusable feedforward Neural Network
 * Pure JavaScript implementation with serialization support (toJSON/fromJSON)
 */

class SimpleNeuralNetwork {
    constructor(inputSize, hiddenSize, outputSize) {
        this.inputSize = inputSize;
        this.hiddenSize = hiddenSize;
        this.outputSize = outputSize;

        // Xavier initialization
        this.weightsIH = this._initWeights(inputSize, hiddenSize);
        this.weightsHO = this._initWeights(hiddenSize, outputSize);
        this.biasH = new Array(hiddenSize).fill(0);
        this.biasO = new Array(outputSize).fill(0);

        this.learningRate = 0.01;
    }

    _initWeights(rows, cols) {
        const weights = [];
        const scale = Math.sqrt(2 / (rows + cols));
        for (let i = 0; i < rows; i++) {
            weights[i] = [];
            for (let j = 0; j < cols; j++) {
                weights[i][j] = (Math.random() - 0.5) * 2 * scale;
            }
        }
        return weights;
    }

    _sigmoid(x) {
        return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
    }

    _sigmoidDerivative(x) {
        return x * (1 - x);
    }

    forward(input) {
        // Input to Hidden
        this.hiddenInputs = new Array(this.hiddenSize).fill(0);
        for (let i = 0; i < this.hiddenSize; i++) {
            for (let j = 0; j < this.inputSize; j++) {
                this.hiddenInputs[i] += input[j] * this.weightsIH[j][i];
            }
            this.hiddenInputs[i] += this.biasH[i];
        }
        this.hiddenOutputs = this.hiddenInputs.map(x => this._sigmoid(x));

        // Hidden to Output
        this.finalInputs = new Array(this.outputSize).fill(0);
        for (let i = 0; i < this.outputSize; i++) {
            for (let j = 0; j < this.hiddenSize; j++) {
                this.finalInputs[i] += this.hiddenOutputs[j] * this.weightsHO[j][i];
            }
            this.finalInputs[i] += this.biasO[i];
        }
        this.outputs = this.finalInputs.map(x => this._sigmoid(x));

        return this.outputs;
    }

    train(input, target) {
        this.forward(input);

        // Output layer error
        const outputErrors = [];
        for (let i = 0; i < this.outputSize; i++) {
            outputErrors[i] = (target[i] - this.outputs[i]) * this._sigmoidDerivative(this.outputs[i]);
        }

        // Hidden layer error
        const hiddenErrors = [];
        for (let i = 0; i < this.hiddenSize; i++) {
            let error = 0;
            for (let j = 0; j < this.outputSize; j++) {
                error += outputErrors[j] * this.weightsHO[i][j];
            }
            hiddenErrors[i] = error * this._sigmoidDerivative(this.hiddenOutputs[i]);
        }

        // Update weights
        for (let i = 0; i < this.hiddenSize; i++) {
            for (let j = 0; j < this.outputSize; j++) {
                this.weightsHO[i][j] += this.learningRate * outputErrors[j] * this.hiddenOutputs[i];
            }
        }

        for (let i = 0; i < this.inputSize; i++) {
            for (let j = 0; j < this.hiddenSize; j++) {
                this.weightsIH[i][j] += this.learningRate * hiddenErrors[j] * input[i];
            }
        }

        return this.outputs;
    }

    toJSON() {
        return {
            weightsIH: this.weightsIH,
            weightsHO: this.weightsHO,
            biasH: this.biasH,
            biasO: this.biasO
        };
    }

    fromJSON(json) {
        if (!json) return;
        if (json.weightsIH) this.weightsIH = json.weightsIH;
        if (json.weightsHO) this.weightsHO = json.weightsHO;
        if (json.biasH) this.biasH = json.biasH;
        if (json.biasO) this.biasO = json.biasO;
    }
}

module.exports = SimpleNeuralNetwork;
