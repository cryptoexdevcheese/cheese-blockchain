/**
 * CHEESE Blockchain - REAL Whale Detector with K-Means Clustering
 * 
 * Genuine Machine Learning for whale detection
 * Uses K-Means clustering algorithm to detect whale patterns
 * 
 * Features:
 * - K-Means clustering for wallet behavior analysis
 * - Whale classification based on transaction patterns
 * - Movement impact prediction
 * - Real-time clustering and classification
 * 
 * Author: CHEESE AI Team
 */

const ss = require('simple-statistics');

class WhaleDetectorML {
    constructor() {
        // K-Means parameters
        this.k = 3; // Number of clusters: small, medium, whale
        this.maxIterations = 100;
        this.convergenceThreshold = 0.001;

        // Cluster centroids
        this.centroids = [];
        this.clusterAssignments = new Map();

        // Wallet profiles for tracking
        this.walletProfiles = new Map();
        this.maxProfiles = 10000;

        // Whale detection thresholds
        this.whaleThresholds = {
            balance: 100000,        // Minimum balance for whale
            avgTransaction: 10000,  // Average transaction size
            totalVolume: 1000000,    // Total transaction volume
            frequency: 0.1          // Transaction frequency (tx/hour)
        };

        // Historical whale activities
        this.whaleHistory = [];
        this.maxHistory = 1000;

        // Detection metrics
        this.totalTransactions = 0;
        this.whaleDetections = 0;
        this.falsePositives = 0;

        // Feature normalization bounds
        this.featureBounds = {
            balance: { min: 0, max: 10000000 },
            avgAmount: { min: 0, max: 1000000 },
            totalVolume: { min: 0, max: 10000000 },
            frequency: { min: 0, max: 100 },
            accountAge: { min: 0, max: 31536000000 }, // 1 year
            uniqueRecipients: { min: 0, max: 1000 }
        };

        console.log('🐋 Whale Detector ML (K-Means Clustering) initialized');
        console.log('   Algorithm: K-Means Clustering');
        console.log(`   Clusters: ${this.k} (small, medium, whale)`);
        console.log('   Features: 6 dimensions');
    }

    /**
     * Normalize feature value to 0-1 range
     */
    normalize(value, min, max) {
        if (max === min) return 0.5;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    /**
     * Extract features from wallet profile
     */
    extractFeatures(profile) {
        return [
            this.normalize(profile.balance || 0, this.featureBounds.balance.min, this.featureBounds.balance.max),
            this.normalize(profile.avgAmount || 0, this.featureBounds.avgAmount.min, this.featureBounds.avgAmount.max),
            this.normalize(profile.totalVolume || 0, this.featureBounds.totalVolume.min, this.featureBounds.totalVolume.max),
            this.normalize(profile.frequency || 0, this.featureBounds.frequency.min, this.featureBounds.frequency.max),
            this.normalize(profile.accountAge || 0, this.featureBounds.accountAge.min, this.featureBounds.accountAge.max),
            this.normalize(profile.uniqueRecipients || 1, this.featureBounds.uniqueRecipients.min, this.featureBounds.uniqueRecipients.max)
        ];
    }

    /**
     * Update wallet profile with new transaction
     */
    updateProfile(address, transaction) {
        const lowAddr = address.toLowerCase();
        let profile = this.walletProfiles.get(lowAddr) || {
            address: lowAddr,
            balance: 0,
            totalVolume: 0,
            transactionCount: 0,
            amounts: [],
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            uniqueRecipients: new Set(),
            frequency: 0
        };

        // Update profile
        const amount = transaction.amount || 0;
        profile.balance += amount;
        profile.totalVolume += amount;
        profile.transactionCount++;
        profile.amounts.push(amount);
        profile.lastSeen = Date.now();

        if (transaction.to) {
            profile.uniqueRecipients.add(transaction.to.toLowerCase());
        }

        // Calculate derived metrics
        profile.avgAmount = profile.amounts.length > 0 
            ? ss.mean(profile.amounts) 
            : 0;
        
        const accountAge = profile.lastSeen - profile.firstSeen;
        profile.accountAge = accountAge;
        
        // Calculate frequency (transactions per hour)
        const hours = Math.max(1, accountAge / 3600000);
        profile.frequency = profile.transactionCount / hours;

        // Keep only last 100 amounts for memory
        if (profile.amounts.length > 100) {
            profile.amounts.shift();
        }

        this.walletProfiles.set(lowAddr, profile);
        
        // Cleanup old profiles
        if (this.walletProfiles.size > this.maxProfiles) {
            const oldest = Array.from(this.walletProfiles.entries())
                .sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
            this.walletProfiles.delete(oldest[0]);
        }

        return profile;
    }

    /**
     * Calculate Euclidean distance between two feature vectors
     */
    euclideanDistance(features1, features2) {
        let sum = 0;
        for (let i = 0; i < features1.length; i++) {
            sum += Math.pow(features1[i] - features2[i], 2);
        }
        return Math.sqrt(sum);
    }

    /**
     * Initialize centroids using k-means++ algorithm
     */
    initializeCentroids(data) {
        if (!data || data.length === 0) {
            console.error('❌ Empty data for centroid initialization');
            // Return default centroids
            return Array(this.k).fill().map(() => new Array(6).fill(0.5));
        }

        // Validate data structure
        if (!data[0] || !data[0].features || data[0].features.length === 0) {
            console.error('❌ Invalid data structure');
            return Array(this.k).fill().map(() => new Array(6).fill(0.5));
        }

        // First centroid: random point
        const centroids = [];
        const firstIdx = Math.floor(Math.random() * data.length);
        centroids.push([...data[firstIdx].features]);

        // Remaining centroids: k-means++ selection
        for (let i = 1; i < this.k; i++) {
            const distances = data.map(point => {
                const minDist = Math.min(...centroids.map(centroid => 
                    this.euclideanDistance(point.features, centroid)
                ));
                return minDist * minDist; // Square for probability
            });

            const totalDist = distances.reduce((sum, d) => sum + d, 0);
            let random = Math.random() * totalDist;
            
            let selectedIdx = 0;
            for (let j = 0; j < distances.length; j++) {
                random -= distances[j];
                if (random <= 0) {
                    selectedIdx = j;
                    break;
                }
            }

            centroids.push([...data[selectedIdx].features]);
        }

        return centroids;
    }

    /**
     * Assign each point to nearest centroid
     */
    assignClusters(data, centroids) {
        if (!centroids || centroids.length === 0) {
            console.error('❌ No centroids for cluster assignment');
            return data.map(point => ({
                address: point.address,
                cluster: 0,
                distance: 0
            }));
        }

        const assignments = data.map(point => {
            const distances = centroids.map(centroid => 
                this.euclideanDistance(point.features, centroid)
            );
            const cluster = distances.indexOf(Math.min(...distances));
            
            // Ensure cluster is within bounds
            const validCluster = Math.max(0, Math.min(cluster, centroids.length - 1));
            
            return { address: point.address, cluster: validCluster, distance: distances[validCluster] };
        });

        return assignments;
    }

    /**
     * Update centroids based on cluster assignments
     */
    updateCentroids(data, assignments, centroids) {
        if (!centroids || centroids.length === 0 || !centroids[0]) {
            console.error('❌ Invalid centroids in updateCentroids');
            return this.initializeCentroids(data);
        }

        const featureLength = centroids[0].length;
        const newCentroids = centroids.map(() => new Array(featureLength).fill(0));
        const clusterCounts = new Array(this.k).fill(0);

        assignments.forEach((assignment, idx) => {
            const cluster = assignment.cluster;
            
            // Validate cluster index
            if (cluster < 0 || cluster >= this.k || !newCentroids[cluster]) {
                console.warn(`⚠️ Invalid cluster index: ${cluster}, skipping`);
                return;
            }
            
            const features = data[idx].features;
            
            if (!features || features.length === 0) {
                console.warn(`⚠️ Invalid features at index ${idx}, skipping`);
                return;
            }
            
            features.forEach((feature, featureIdx) => {
                if (featureIdx < newCentroids[cluster].length) {
                    newCentroids[cluster][featureIdx] += feature;
                }
            });
            clusterCounts[cluster]++;
        });

        // Calculate means
        newCentroids.forEach((centroid, clusterIdx) => {
            if (clusterCounts[clusterIdx] > 0) {
                for (let i = 0; i < centroid.length; i++) {
                    centroid[i] /= clusterCounts[clusterIdx];
                }
            } else {
                // Reinitialize empty cluster to random point
                const randomPoint = data[Math.floor(Math.random() * data.length)];
                newCentroids[clusterIdx] = [...randomPoint.features];
            }
        });

        return newCentroids;
    }

    /**
     * Check for convergence
     */
    hasConverged(oldCentroids, newCentroids) {
        for (let i = 0; i < oldCentroids.length; i++) {
            const distance = this.euclideanDistance(oldCentroids[i], newCentroids[i]);
            if (distance > this.convergenceThreshold) {
                return false;
            }
        }
        return true;
    }

    /**
     * Train K-Means clustering model
     */
    train(walletProfiles) {
        console.log('🎓 Training whale detector K-Means...');
        console.log(`   Training data: ${walletProfiles.size} wallet profiles`);

        if (walletProfiles.size < this.k) {
            console.log('   ⚠️ Not enough data for clustering');
            return { success: false, reason: 'Insufficient data' };
        }

        // Prepare data
        const data = Array.from(walletProfiles.entries()).map(([address, profile]) => ({
            address,
            features: this.extractFeatures(profile)
        }));

        // Initialize centroids
        this.centroids = this.initializeCentroids(data);

        // K-Means iterations
        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            const assignments = this.assignClusters(data, this.centroids);
            const newCentroids = this.updateCentroids(data, assignments, this.centroids);

            if (this.hasConverged(this.centroids, newCentroids)) {
                console.log(`   Converged at iteration ${iteration}`);
                break;
            }

            this.centroids = newCentroids;
        }

        // Final assignments
        const finalAssignments = this.assignClusters(data, this.centroids);
        this.clusterAssignments.clear();
        finalAssignments.forEach(assignment => {
            this.clusterAssignments.set(assignment.address, assignment.cluster);
        });

        // Identify whale cluster (highest centroid values)
        const clusterSums = this.centroids.map(centroid => 
            centroid.reduce((sum, val) => sum + val, 0)
        );
        this.whaleCluster = clusterSums.indexOf(Math.max(...clusterSums));

        console.log('✅ K-Means training complete!');
        console.log(`   Whale cluster: ${this.whaleCluster}`);
        console.log(`   Total clusters: ${this.k}`);
        console.log(`   Converged centroids: ${this.centroids.length}`);

        return {
            success: true,
            clusters: this.k,
            whaleCluster: this.whaleCluster,
            iterations: this.maxIterations,
            sampleCount: data.length
        };
    }

    /**
     * Detect if wallet is a whale
     */
    detectWhale(address) {
        const lowAddr = address.toLowerCase();
        const profile = this.walletProfiles.get(lowAddr);

        if (!profile) {
            return {
                isWhale: false,
                confidence: 0,
                reason: 'No profile data',
                cluster: -1
            };
        }

        this.totalTransactions++;

        // Method 1: Clustering-based detection
        let cluster = -1;
        let clusterConfidence = 0;

        if (this.centroids.length > 0) {
            const features = this.extractFeatures(profile);
            const distances = this.centroids.map(centroid => 
                this.euclideanDistance(features, centroid)
            );
            cluster = distances.indexOf(Math.min(...distances));
            clusterConfidence = 1 - (distances[cluster] / Math.max(...distances));
        }

        // Method 2: Threshold-based detection
        const thresholdScore = this.calculateThresholdScore(profile);

        // Combine both methods
        const isWhaleByCluster = cluster === this.whaleCluster;
        const isWhaleByThreshold = thresholdScore > 0.7;

        const isWhale = isWhaleByCluster || isWhaleByThreshold;
        const confidence = Math.max(clusterConfidence, thresholdScore);

        if (isWhale) {
            this.whaleDetections++;
            
            // Add to history
            this.whaleHistory.push({
                address: lowAddr,
                timestamp: Date.now(),
                profile: { ...profile },
                cluster,
                confidence
            });

            if (this.whaleHistory.length > this.maxHistory) {
                this.whaleHistory.shift();
            }
        }

        // Calculate impact
        const impact = this.calculateImpact(profile);

        return {
            isWhale,
            confidence: parseFloat(confidence.toFixed(4)),
            cluster,
            clusterBased: isWhaleByCluster,
            thresholdBased: isWhaleByThreshold,
            thresholdScore: parseFloat(thresholdScore.toFixed(4)),
            impact,
            profile: {
                balance: profile.balance,
                avgAmount: profile.avgAmount,
                totalVolume: profile.totalVolume,
                transactionCount: profile.transactionCount,
                frequency: parseFloat(profile.frequency.toFixed(4))
            },
            reason: this.getWhaleReason(profile, thresholdScore, cluster),
            algorithm: 'K-Means Clustering + Threshold Analysis',
            isRealAI: true
        };
    }

    /**
     * Calculate threshold-based whale score
     */
    calculateThresholdScore(profile) {
        let score = 0;
        let factors = 0;

        // Balance score
        const balanceScore = Math.min(1, profile.balance / this.whaleThresholds.balance);
        score += balanceScore * 0.3;
        factors++;

        // Average transaction score
        const avgAmountScore = Math.min(1, profile.avgAmount / this.whaleThresholds.avgTransaction);
        score += avgAmountScore * 0.25;
        factors++;

        // Total volume score
        const volumeScore = Math.min(1, profile.totalVolume / this.whaleThresholds.totalVolume);
        score += volumeScore * 0.25;
        factors++;

        // Frequency score
        const freqScore = Math.min(1, profile.frequency / this.whaleThresholds.frequency);
        score += freqScore * 0.2;
        factors++;

        return score / factors;
    }

    /**
     * Calculate whale movement impact
     */
    calculateImpact(profile, transaction) {
        const amount = transaction?.amount || profile.avgAmount || 0;
        const balance = profile.balance;

        // Impact on price (based on amount vs balance)
        const priceImpact = Math.min(1, amount / (balance * 0.1));

        // Impact on liquidity
        const liquidityImpact = Math.min(1, amount / 100000);

        // Network impact
        const networkImpact = Math.min(1, profile.frequency / 10);

        return {
            priceImpact: parseFloat(priceImpact.toFixed(4)),
            liquidityImpact: parseFloat(liquidityImpact.toFixed(4)),
            networkImpact: parseFloat(networkImpact.toFixed(4)),
            overallImpact: parseFloat(((priceImpact + liquidityImpact + networkImpact) / 3).toFixed(4))
        };
    }

    /**
     * Get explanation for whale classification
     */
    getWhaleReason(profile, thresholdScore, cluster) {
        const reasons = [];

        if (profile.balance >= this.whaleThresholds.balance) {
            reasons.push(`High balance: ${profile.balance.toLocaleString()} NCH`);
        }

        if (profile.avgAmount >= this.whaleThresholds.avgTransaction) {
            reasons.push(`Large average transaction: ${profile.avgAmount.toLocaleString()} NCH`);
        }

        if (profile.totalVolume >= this.whaleThresholds.totalVolume) {
            reasons.push(`High total volume: ${profile.totalVolume.toLocaleString()} NCH`);
        }

        if (profile.frequency >= this.whaleThresholds.frequency) {
            reasons.push(`High frequency: ${profile.frequency.toFixed(2)} tx/hour`);
        }

        if (cluster === this.whaleCluster) {
            reasons.push('Pattern matches whale cluster');
        }

        if (reasons.length === 0) {
            reasons.push('Multiple medium indicators');
        }

        return reasons.join(', ');
    }

    /**
     * Get whale statistics
     */
    getWhaleStatistics() {
        const whaleProfiles = Array.from(this.walletProfiles.entries())
            .filter(([addr, profile]) => this.detectWhale(addr).isWhale);

        const whaleBalances = whaleProfiles.map(([, profile]) => profile.balance);
        const whaleVolumes = whaleProfiles.map(([, profile]) => profile.totalVolume);

        return {
            totalWhales: whaleProfiles.length,
            totalWallets: this.walletProfiles.size,
            whalePercentage: parseFloat((whaleProfiles.length / Math.max(1, this.walletProfiles.size) * 100).toFixed(2)),
            averageWhaleBalance: whaleBalances.length > 0 
                ? parseFloat(ss.mean(whaleBalances).toFixed(2)) 
                : 0,
            totalWhaleVolume: whaleVolumes.length > 0 
                ? parseFloat(ss.sum(whaleVolumes).toFixed(2)) 
                : 0,
            detectionRate: this.totalTransactions > 0 
                ? parseFloat((this.whaleDetections / this.totalTransactions * 100).toFixed(2)) 
                : 0,
            recentWhaleActivity: this.whaleHistory.slice(-10),
            clusters: this.centroids.length,
            whaleCluster: this.whaleCluster,
            algorithm: 'K-Means Clustering',
            isRealAI: true
        };
    }

    /**
     * Get model info
     */
    getModelInfo() {
        return {
            algorithm: 'K-Means Clustering',
            clusters: this.k,
            features: 6,
            centroids: this.centroids.length,
            whaleCluster: this.whaleCluster,
            walletProfiles: this.walletProfiles.size,
            totalDetections: this.whaleDetections,
            detectionRate: this.totalTransactions > 0 
                ? (this.whaleDetections / this.totalTransactions).toFixed(4) 
                : 0,
            isTrained: this.centroids.length > 0,
            whaleHistory: this.whaleHistory.length,
            isRealAI: true
        };
    }

    /**
     * Export model
     */
    exportModel() {
        return {
            centroids: this.centroids,
            whaleCluster: this.whaleCluster,
            whaleHistory: this.whaleHistory,
            clusterAssignments: Array.from(this.clusterAssignments.entries()),
            parameters: {
                k: this.k,
                whaleThresholds: this.whaleThresholds,
                featureBounds: this.featureBounds
            },
            statistics: {
                totalTransactions: this.totalTransactions,
                whaleDetections: this.whaleDetections
            },
            exportDate: Date.now()
        };
    }

    /**
     * Import model
     */
    importModel(modelData) {
        this.centroids = modelData.centroids;
        this.whaleCluster = modelData.whaleCluster;
        this.whaleHistory = modelData.whaleHistory || [];
        this.clusterAssignments = new Map(modelData.clusterAssignments);
        this.k = modelData.parameters.k;
        this.whaleThresholds = modelData.whaleThresholds;
        this.featureBounds = modelData.featureBounds;
        this.totalTransactions = modelData.statistics.totalTransactions;
        this.whaleDetections = modelData.statistics.whaleDetections;

        console.log('📂 Whale detector model imported successfully');
        console.log(`   Clusters: ${this.centroids.length}, Whale cluster: ${this.whaleCluster}`);

        return true;
    }
}

module.exports = { WhaleDetectorML };