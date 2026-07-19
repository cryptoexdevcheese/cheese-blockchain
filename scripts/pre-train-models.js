/**
 * CHEESE Blockchain - Neural Network Model Pre-training Script
 * This script trains and serializes the 5 active neural networks.
 */

const fs = require('fs');
const path = require('path');
const SimpleNeuralNetwork = require('../simple-nn');

// Create weights directory if it doesn't exist
const weightsDir = path.join(__dirname, '../ai-engine/weights');
if (!fs.existsSync(weightsDir)) {
    fs.mkdirSync(weightsDir, { recursive: true });
}

console.log('🧠 Starting pre-training for all 5 Neural Network models...');

// ==================== 1. Consensus Model (5 -> 10 -> 1) ====================
console.log('\n🏛️  Pre-training Consensus Model...');
const consensusModel = new SimpleNeuralNetwork(5, 10, 1);
const consensusData = [];
for (let i = 0; i < 1000; i++) {
    const isValid = Math.random() < 0.8;
    if (isValid) {
        consensusData.push({
            input: [
                Math.random() * 0.4 + 0.1, // normal block size
                Math.random() * 0.8 + 0.2, // increasing chain length
                Math.random() * 0.2,       // normal block time diff (fast)
                Math.random() * 0.5 + 0.5, // proper difficulty
                Math.random() * 0.3 + 0.1  // typical avg transaction fee
            ],
            target: [0.9] // High confidence
        });
    } else {
        consensusData.push({
            input: [
                Math.random() * 0.3 + 0.7, // bloated block size
                Math.random() * 0.2,       // short chain length
                Math.random() * 0.8 + 0.2, // large time diff (stalled)
                Math.random() * 0.3,       // low difficulty
                Math.random() * 0.7 + 0.3  // abnormal avg transaction fee
            ],
            target: [0.3] // Low confidence
        });
    }
}
// Train
for (let epoch = 0; epoch < 500; epoch++) {
    for (const sample of consensusData) {
        consensusModel.train(sample.input, sample.target);
    }
}
console.log('✅ Consensus Model pre-trained successfully.');
fs.writeFileSync(path.join(weightsDir, 'consensus-weights.json'), JSON.stringify(consensusModel.toJSON(), null, 2));


// ==================== 2. Transaction Validator (8 -> 16 -> 1) ====================
console.log('\n🔒 Pre-training Transaction Validator (Fraud Detector)...');
const validatorModel = new SimpleNeuralNetwork(8, 16, 1);
const validatorData = [];
for (let i = 0; i < 1000; i++) {
    const isFraud = Math.random() < 0.15;
    if (isFraud) {
        validatorData.push({
            input: [
                Math.random() * 0.5 + 0.5, // high amount
                Math.random() * 0.6 + 0.4, // high gas price
                Math.random() * 0.7 + 0.3, // high sender frequency
                Math.random() * 0.4 + 0.6, // high average amount variance
                Math.random() * 0.2,       // low account age (new wallet)
                Math.random() * 0.8 + 0.2, // high unique recipients
                Math.random() * 0.1,       // low time since last tx (bursting)
                0.0                        // invalid signature
            ],
            target: [0.95] // High fraud score
        });
    } else {
        validatorData.push({
            input: [
                Math.random() * 0.3,       // normal amount
                Math.random() * 0.3,       // normal gas price
                Math.random() * 0.3,       // low frequency
                Math.random() * 0.3,       // low average amount variance
                Math.random() * 0.6 + 0.4, // old account (established wallet)
                Math.random() * 0.2,       // low unique recipients
                Math.random() * 0.7 + 0.3, // normal time since last tx
                1.0                        // valid signature
            ],
            target: [0.05] // Minimal fraud score
        });
    }
}
// Train
for (let epoch = 0; epoch < 500; epoch++) {
    for (const sample of validatorData) {
        validatorModel.train(sample.input, sample.target);
    }
}
console.log('✅ Transaction Validator pre-trained successfully.');
fs.writeFileSync(path.join(weightsDir, 'validator-weights.json'), JSON.stringify(validatorModel.toJSON(), null, 2));


// ==================== 3. Scam Detector (8 -> 16 -> 1) ====================
console.log('\n🛡️  Pre-training Scam Detector...');
const scamModel = new SimpleNeuralNetwork(8, 16, 1);
const scamData = [];
for (let i = 0; i < 1000; i++) {
    const isScam = Math.random() < 0.2;
    let features;
    if (isScam) {
        features = [
            Math.random() * 0.3,       // low account age
            Math.random() * 0.5 + 0.5, // high frequency
            Math.random() * 0.3,       // low history
            Math.random() * 0.5 + 0.5, // high amount variance
            Math.random() * 0.3,       // low reputation
            Math.random() * 0.5 + 0.5, // high unique recipients
            Math.random() * 0.5 + 0.5, // unusual timing
            Math.random() * 0.3        // low community score
        ];
    } else {
        features = [
            Math.random() * 0.5 + 0.5, // high account age
            Math.random() * 0.3,       // low frequency
            Math.random() * 0.5 + 0.5, // high history
            Math.random() * 0.3,       // low amount variance
            Math.random() * 0.5 + 0.5, // high reputation
            Math.random() * 0.3,       // low unique recipients
            Math.random() * 0.3,       // normal timing
            Math.random() * 0.5 + 0.5  // high community score
        ];
    }
    scamData.push({ input: features, target: [isScam ? 0.9 : 0.1] });
}
// Train
for (let epoch = 0; epoch < 500; epoch++) {
    for (const sample of scamData) {
        scamModel.train(sample.input, sample.target);
    }
}
console.log('✅ Scam Detector pre-trained successfully.');
fs.writeFileSync(path.join(weightsDir, 'scam-detector-weights.json'), JSON.stringify(scamModel.toJSON(), null, 2));


// ==================== 4. Risk Assessor (10 -> 20 -> 3) ====================
console.log('\n📊 Pre-training Risk Assessor...');
const riskModel = new SimpleNeuralNetwork(10, 20, 3);
const riskData = [];
for (let i = 0; i < 1000; i++) {
    const riskLevel = Math.floor(Math.random() * 3); // 0 = low, 1 = med, 2 = high
    const base = riskLevel * 0.3;
    const features = Array(10).fill(0).map(() => Math.random() * 0.3 + base);
    const target = [
        riskLevel === 0 ? 0.9 : 0.05,
        riskLevel === 1 ? 0.9 : 0.05,
        riskLevel === 2 ? 0.9 : 0.05
    ];
    riskData.push({ input: features, target });
}
// Train
for (let epoch = 0; epoch < 500; epoch++) {
    for (const sample of riskData) {
        riskModel.train(sample.input, sample.target);
    }
}
console.log('✅ Risk Assessor pre-trained successfully.');
fs.writeFileSync(path.join(weightsDir, 'risk-assessor-weights.json'), JSON.stringify(riskModel.toJSON(), null, 2));


// ==================== 5. Behavior Model (12 -> 24 -> 4) ====================
console.log('\n👤 Pre-training Behavior Model...');
const behaviorModel = new SimpleNeuralNetwork(12, 24, 4);
const behaviorData = [];
for (let i = 0; i < 1000; i++) {
    const behaviorType = Math.floor(Math.random() * 4); // 0 = normal, 1 = suspicious, 2 = anomaly, 3 = danger
    const features = Array(12).fill(0).map(() => Math.random() * 0.3);
    features[behaviorType * 3] = Math.random() * 0.3 + 0.7;
    features[behaviorType * 3 + 1] = Math.random() * 0.3 + 0.6;
    
    const target = [
        behaviorType === 0 ? 0.9 : 0.05,
        behaviorType === 1 ? 0.9 : 0.05,
        behaviorType === 2 ? 0.9 : 0.05,
        behaviorType === 3 ? 0.9 : 0.05
    ];
    behaviorData.push({ input: features, target });
}
// Train
for (let epoch = 0; epoch < 500; epoch++) {
    for (const sample of behaviorData) {
        behaviorModel.train(sample.input, sample.target);
    }
}
console.log('✅ Behavior Model pre-trained successfully.');
fs.writeFileSync(path.join(weightsDir, 'behavior-model-weights.json'), JSON.stringify(behaviorModel.toJSON(), null, 2));

console.log('\n🎉 ALL NEURAL NETWORK MODELS PRE-TRAINED & SERIALIZED SUCCESSFULLY!');
