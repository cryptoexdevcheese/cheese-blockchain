/**
 * CHEESE Blockchain - AI Engine Index
 * Exports all REAL AI/ML components
 * 
 * © 2025 Robert Terre. All Rights Reserved.
 */

// Core AI Engine
const RealAIEngine = require('./real-ai-engine');

// Self-Learning Engine (PERSISTENT - saves weights to disk)
const { SelfLearningEngine, PersistentNeuralNetwork } = require('./self-learning-engine');

// OpenAI GPT Integration (Real GPT-4)
const GPTBlockchainAnalyzer = require('./gpt-analyzer');

// TensorFlow.js Engine (GPU-accelerated deep learning)
let TensorFlowEngine = null;
let DeepFraudDetector = null;
let LSTMPricePredictor = null;
let AnomalyAutoencoder = null;

try {
    const tfModule = require('./tensorflow-engine');
    TensorFlowEngine = tfModule.TensorFlowEngine;
    DeepFraudDetector = tfModule.DeepFraudDetector;
    LSTMPricePredictor = tfModule.LSTMPricePredictor;
    AnomalyAutoencoder = tfModule.AnomalyAutoencoder;
} catch (e) {
    console.warn('⚠️ TensorFlow.js not available (run: npm install @tensorflow/tfjs)');
}

// Neural Network Models
const { FraudDetectorNN } = require('./models/fraud-detector');
const TransactionPredictorLSTM = require('./models/transaction-predictor');
const AnomalyDetectorML = require('./models/anomaly-detector');
const { MiningOptimizerRL } = require('./models/mining-optimizer');
const { WhaleDetectorML } = require('./models/whale-detector');
const NetworkHealthPredictor = require('./models/network-health');

// Advanced ML Models  
const PricePredictor = require('./models/price-predictor');
const SmartContractAnalyzer = require('./models/contract-analyzer');
const { SentimentAnalyzer } = require('./models/sentiment-analyzer');
const UserBehaviorPredictor = require('./models/user-behavior-predictor');

module.exports = {
    // Core
    RealAIEngine,

    // Self-Learning (REAL ML - persistent weights)
    SelfLearningEngine,
    PersistentNeuralNetwork,

    // OpenAI GPT (Real GPT-4 / GPT-3.5)
    GPTBlockchainAnalyzer,

    // TensorFlow.js (GPU-accelerated Deep Learning)
    TensorFlowEngine,
    DeepFraudDetector,
    LSTMPricePredictor,
    AnomalyAutoencoder,

    // Neural Networks (Pure JS)
    FraudDetectorNN,
    TransactionPredictorLSTM,
    AnomalyDetectorML,
    MiningOptimizerRL,
    WhaleDetectorML,
    NetworkHealthPredictor,

    // Advanced ML Models
    PricePredictor,
    SmartContractAnalyzer,
    SentimentAnalyzer,
    UserBehaviorPredictor
};
