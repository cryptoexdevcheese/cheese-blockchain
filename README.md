# 🧀 CHEESE Blockchain Core, DEX & AI Engine

> **⚠️ PROPRIETARY & CONFIDENTIAL**  
> This is a private repository. All code, algorithms, and intellectual property contained herein are proprietary to CHEESE Blockchain.  
> **Unauthorized copying, distribution, reverse engineering, or use is strictly prohibited.**

---

## 📋 About

CHEESE (NCH) is an advanced hybrid Layer-1 blockchain featuring:
- **27 AI/ML Models** for real-time transaction validation, Whale activity detection, Biometric facial recognition, Smart Contract generation, and consensus optimization.
- **AI-Consensus Layer** combining adaptive difficulty Proof-of-Work with neural whale and security detectors.
- **Integrated DEX** with native NCH ↔ USDT token swaps, automated liquidity pools, and p2p escrow trades.
- **Progressive Web Wallet** supporting passkey (WebAuthn) and facial biometric authentication.
- **Decentralized Explorer** for live block inspection, transaction tracking, and on-chain search.

---

## 🛠️ Repository Architecture

- [ai-engine/](file:///Users/cheeseblockchain/CascadeProjects/cheese-blockchain/ai-engine/) — The 27 AI/ML core models, weights, and tensorflow-engine integration.
- [contracts/](file:///Users/cheeseblockchain/CascadeProjects/cheese-blockchain/contracts/) — Hardhat environment and Solidity contracts for the CHEESE DEX router and pool vaults.
- [public/](file:///Users/cheeseblockchain/CascadeProjects/cheese-blockchain/public/) — Multi-platform Progressive Web Wallet, Explorer frontend, and marketing landing pages.
- [blockchain-core-v33.js](file:///Users/cheeseblockchain/CascadeProjects/cheese-blockchain/blockchain-core-v33.js) — The main L1 blockchain runtime, block miner, and database sync manager.
- [dex-server-fixed.js](file:///Users/cheeseblockchain/CascadeProjects/cheese-blockchain/dex-server-fixed.js) — Core Express API routing engine for swaps, pools, and DEX status.

---

## 🧪 AI Model Categories

The AI architecture consists of exactly 27 active models:
- **Specialized ML Models (8 models):** Fraud detection, transaction prediction, anomaly detection, mining optimization, whale detection, network health, sentiment analysis, and user behavior prediction.
- **Advanced Deep Learning (2 models):** Price prediction and smart contract analysis.
- **AI Governance (1 model):** Automated technical analysis and proposal voting weights.
- **Quantum-Resistant (1 model):** Post-quantum signature verification.
- **Smart Contract Generation (1 model):** Automated solidity generation and optimization.
- **Self-Learning (4 models):** Persistent neural networks with weight persistence on disk.
- **TensorFlow.js (3 models):** WebGL/GPU-accelerated on-chain deep learning.
- **Python AI Service (6 models):** Offloaded intensive model training.
- **OpenAI Integration (1 model):** LLM-based on-chain transaction analysis.

---

## 🔒 Security Notice

**NEVER commit the following configuration files:**
- Private keys or wallet files (`FOUNDER-WALLET.json`, `NEW-SYSTEM-WALLETS.json`)
- System environment variables (`.env` files)
- Firebase credentials (`service-account*.json`)

All runtime secrets must be loaded using PM2 environment variables or system-level configuration files.

---

## ⚙️ Production Operations

### Start Blockchain Server (PM2)
```bash
pm2 start ecosystem.config.js --update-env
```

### Run AI Engine Integration Suite
```bash
node ai-engine/integration-test.js
```

---

## 📄 License

**Copyright © 2025-2026 Robert Terre / CHEESE Blockchain. All Rights Reserved.**

This software and all associated documentation are the exclusive property of CHEESE Blockchain. No license is granted for use, modification, or distribution without explicit written permission from the copyright holder.

---

## 🆘 Support

- Contact: cryptoexdevcheese@gmail.com
- Main Website: https://cheeseblockchain.com
